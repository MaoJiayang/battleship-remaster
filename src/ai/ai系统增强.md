# AI 系统增强方案

## 一、当前实现状态（v2.2）

### 1.1 已实现功能

当前 AI 采用**信息论驱动 + 对称推演**的决策模型：

```javascript
// 当前评分公式
baseScore = α × 归一化信息增益 + (1-α) × 归一化期望伤害
finalScore = baseScore + riskAwareness × riskBonus
```

**核心组件：**
- `BeliefState`: 蒙特卡洛采样维护对玩家舰船配置的置信分布
- `evaluateAction()`: 统一评估所有可用行动（AP/HE/SONAR）
- `simulateMultiStepThreats()`: 多步对称推演，预测己方舰船威胁
- `calculateRiskBonusMultiStep()`: 基于威胁计算风险加成

### 1.2 难度参数

| 参数 | 范围 | 说明 |
|-----|------|------|
| `alpha` | 0~1 | 信息 vs 伤害的平衡 |
| `randomness` | 0~1 | 随机决策概率 |
| `riskAwareness` | 0~1 | 风险意识强度 |

---

## 二、待解决问题：三量度量不统一

### 2.1 问题描述

当前公式中存在三个量：

| 量 | 当前归一化方式 | 问题 |
|---|--------------|------|
| **信息增益** | `infoGain / currentEntropy` | 范围 [0, 1]，语义清晰 |
| **期望伤害** | `expectedDamage / maxWeaponDamage` | 范围 [0, 1]，但与信息增益不可比 |
| **风险加成** | `sinkProb × abilityLoss` | 范围 [0, 1]，但直接加到 baseScore 上 |

**具体问题：**

1. **信息增益 vs 期望伤害**：两者虽然都归一化到 [0, 1]，但语义不同
   - 信息增益 = 1 意味着"消除所有不确定性"
   - 期望伤害 = 1 意味着"达到武器最大伤害"
   - 这两者的"价值"是否相等？

2. **风险加成的叠加方式**：当前直接加法叠加
   - `finalScore = baseScore + riskAwareness × riskBonus`
   - 但 baseScore ∈ [0, 1]，riskBonus ∈ [0, 1]
   - 若 riskAwareness = 1，则 finalScore 可能达到 2
   - 这破坏了评分的一致性

3. **alpha 和 riskAwareness 的交互**：
   - 两个参数独立作用，但实际上相互影响
   - 例如：高 alpha（重信息）+ 高 riskAwareness 时，行为难以预测

---

## 三、解决方案探索

### 3.1 方案 A：统一信息论框架

**核心思想**：将所有量统一到"信息价值"度量下

```
utility = 期望信息增益 + 期望能力保持信息
```

**信息增益**（攻击收益）：
- 当前已有：攻击后减少的棋盘不确定性

**能力保持信息**（风险代价）：
- 将"能力丧失"转换为"未来可获取信息的损失"
- 例如：CV 沉没 → 丧失 HE 武器 → 丧失 5 格/回合的信息获取能力

```javascript
// 概念性公式
abilityInfoValue = 能力存活概率 × 该能力的期望信息获取率
riskPenalty = Σ(sinkProb[ship] × abilityInfoValue[ship])
utility = infoGain - riskPenalty  // 统一在信息度量下
```

**优点**：
- 理论上优美，所有量都用"比特"衡量
- 消除了 alpha 和 riskAwareness 的交互问题

**缺点**：
- "能力的信息价值"难以精确估算
- 需要估算"未来回合数"等复杂因素

---

### 3.2 方案 B：期望收益框架

**核心思想**：将所有量统一到"游戏收益"度量下

```
utility = 期望己方收益 - 期望敌方收益
```

定义"收益"为击沉敌舰的期望价值：

```javascript
// 每回合的期望收益
expectedGain = Σ(攻击格概率 × 格子所属船 × 击沉该船的边际收益)

// 边际收益 = 船只被击沉时，敌方丧失的"战力"
// 战力可定义为：该船存活时，敌方每回合期望造成的伤害
```

**对称推演**：
```javascript
// 我方收益
myGain = evaluateAttack(我攻击敌)

// 敌方收益（通过对称推演估算）
enemyGain = evaluateAttack(敌攻击我)  // 用相同算法

// 综合评估
utility = myGain - riskAwareness × enemyGain
```

**优点**：
- 语义直观：最大化"净收益"
- 自然包含风险：敌方收益即我方风险

**缺点**：
- 需要定义"船只战力"，又引入了硬编码
- 信息价值难以纳入

---

### 3.3 方案 C：归一化 + 加权融合（渐进式改进）

**核心思想**：保持当前框架，改进归一化和融合方式

#### Step 1: 统一评分范围

将所有评分归一化到 [0, 1]，使用**凸组合**：

```javascript
// 三个基础分量，各自 ∈ [0, 1]
infoScore = normalize(infoGain)      // 已有
damageScore = normalize(damage)       // 已有
riskScore = normalize(riskBonus)      // 需改进

// 凸组合（权重和为 1）
utility = w_info × infoScore + w_damage × damageScore + w_risk × riskScore
```

#### Step 2: 参数重映射

将现有参数映射到三元权重：

```javascript
// 两个用户参数
alpha ∈ [0, 1]        // 信息 vs 伤害偏好
riskAwareness ∈ [0, 1] // 风险意识

// 映射到三元权重
base_info = alpha
base_damage = 1 - alpha

// 风险意识"分走"一部分权重
w_risk = riskAwareness × 0.3  // 风险最多占 30%
remaining = 1 - w_risk
w_info = base_info × remaining
w_damage = base_damage × remaining

// 验证：w_info + w_damage + w_risk = 1 ✓
```

#### Step 3: 风险评分归一化

当前 riskBonus 的问题：只有使用濒危能力时才有加成，导致稀疏。

改进方案：**将风险转换为机会成本**

```javascript
// 当前：只有使用濒危能力才加分
riskBonus = usesEndangered ? (sinkProb × abilityLoss) : 0

// 改进：所有行动都计算"能力保持价值"
// 不使用濒危能力 = 浪费机会
opportunityCost = 0
for (ship of endangeredShips) {
    if (actionUsesAbility(action, ship)) {
        // 使用了濒危能力，获得正向收益
        opportunityCost -= sinkProb × abilityValue
    } else {
        // 未使用濒危能力，存在机会成本
        opportunityCost += sinkProb × abilityValue × (1 - 使用该能力的其他行动占比)
    }
}
riskScore = sigmoid(-opportunityCost)  // 映射到 [0, 1]
```

**优点**：
- 渐进式改进，风险可控
- 保持了现有参数语义
- 评分范围统一

**缺点**：
- 权重映射是启发式的，缺乏理论基础
- 0.3 等常数仍是硬编码

---

### 3.4 方案 D：多目标优化视角

**核心思想**：不试图将多目标合并为单一分数，而是使用帕累托最优

```javascript
// 每个行动有三个目标值
action.objectives = {
    info: infoGain,
    damage: expectedDamage,
    survival: -riskPenalty  // 负的风险 = 生存价值
}

// 找出帕累托前沿
paretoFront = computeParetoFront(actions)

// 从前沿中选择（可用偏好参数引导）
selectedAction = selectFromFront(paretoFront, { alpha, riskAwareness })
```

**选择策略**：
- 简单：在前沿中随机选（保证不会选到被支配的解）
- 偏好：用参数作为权重，选加权和最高的

**优点**：
- 理论上最"正确"：多目标问题本就不该有唯一解
- 避免了不同度量直接比较的问题

**缺点**：
- 实现复杂度高
- 帕累托前沿可能只有一个点（目标高度相关时）
- 难以向玩家解释 AI 行为

---

## 四、推荐方案

### 4.1 短期：方案 C（归一化 + 加权融合）

理由：
- 改动最小，与现有代码兼容
- 解决了评分范围不一致的问题
- 保持了参数语义的直观性

关键改动：
1. 将 riskBonus 改为凸组合的一部分
2. 引入权重映射函数
3. （可选）将风险改为机会成本模式

### 4.2 长期：方案 A（统一信息论框架）

理由：
- 理论上最优美
- 与现有信息论框架一脉相承
- 消除了多参数交互的复杂性

需要的研究：
- 如何量化"能力的信息价值"
- 如何处理"未来回合"的折扣因子

---

## 五、实现建议（方案 C）

### 5.1 代码改动点

```javascript
// aiStrategy.js - evaluateAction 函数

function evaluateActionUnified(beliefState, action, abilities, alpha, riskAwareness, shipThreats, aiShips) {
    // 1. 计算三个基础分量
    const infoScore = calculateInfoScore(beliefState, action);      // [0, 1]
    const damageScore = calculateDamageScore(action, beliefState, abilities);  // [0, 1]
    const riskScore = calculateRiskScore(action, shipThreats, abilities, aiShips);  // [0, 1]
    
    // 2. 计算权重（凸组合）
    const maxRiskWeight = 0.3;
    const riskWeight = riskAwareness * maxRiskWeight;
    const remaining = 1 - riskWeight;
    const infoWeight = alpha * remaining;
    const damageWeight = (1 - alpha) * remaining;
    
    // 3. 加权求和
    return infoWeight * infoScore + damageWeight * damageScore + riskWeight * riskScore;
}
```

### 5.2 新增的 calculateRiskScore

```javascript
function calculateRiskScore(action, shipThreats, abilities, aiShips) {
    if (!shipThreats) return 0.5;  // 无威胁信息时返回中性值
    
    let score = 0.5;  // 基准分
    
    for (const ship of aiShips) {
        if (ship.sunk) continue;
        const threat = shipThreats.get(ship.id);
        if (!threat || threat.sinkProbability < 0.1) continue;
        
        const afterAbilities = simulateAbilitiesAfterLoss(aiShips, ship);
        const abilityLoss = calculateAbilityLoss(abilities, afterAbilities);
        
        if (abilityLoss > 0) {
            const usesIt = checkUsesEndangeredAbility(action, abilities, afterAbilities);
            const urgency = threat.sinkProbability * abilityLoss;
            
            if (usesIt) {
                score += urgency * 0.5;  // 使用濒危能力，加分
            } else {
                score -= urgency * 0.25;  // 未使用，轻微扣分（机会成本）
            }
        }
    }
    
    return Math.max(0, Math.min(1, score));  // 钳制到 [0, 1]
}
```

---

## 六、测试验证

### 6.1 行为一致性

- [ ] `riskAwareness = 0` 时，行为与 v2.1 完全一致
- [ ] 评分范围始终在 [0, 1]

### 6.2 预期行为

- [ ] CV 高威胁时，HE 使用频率上升
- [ ] DD 高威胁时，SONAR 使用频率上升
- [ ] 无威胁时，行为由 alpha 主导

### 6.3 参数敏感性

- [ ] alpha 从 0 到 1 平滑过渡
- [ ] riskAwareness 从 0 到 1 平滑过渡
- [ ] 两参数同时变化时无异常跳变
