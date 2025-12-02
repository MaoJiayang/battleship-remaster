# AI 系统增强：风险感知的信息论统一

> **状态**：✅ 已实现（v2.3）

## 背景

当前 AI 决策框架：
- **攻击评估**：`utility = α × 归一化信息增益 + (1-α) × 归一化期望伤害`
- **风险评估**：`riskBonus = sinkProbability × abilityLoss × usesEndangeredAbility`

**问题**：
1. 风险评估使用启发式公式，与信息论框架不统一
2. 需要硬编码武器-能力映射（`checkUsesEndangeredAbility`）
3. `abilityLoss` 的权重手工设定，难以调优
4. 新增武器需要修改多处代码

## 统一方案：边际效用损失

### 核心思想

**能力的价值 = 拥有该能力时的最优效用 − 失去该能力后的最优效用**

这就是经济学中的「边际效用」概念，可以用同一个 `evaluateAction` 函数计算，实现理论统一。

### 公式定义

```
marginalUtilityLoss(ship) = max_a∈A(current) U(a) − max_a∈A(after_loss) U(a)

riskAdjustedUtility(action) = U(action) × (1 + riskAwareness × normRiskBonus)
```

其中：
- `U(a)` = `evaluateAction(beliefState, a, abilities, α)` ∈ [0, 1]
- `A(current)` = 当前能力下的所有可用行动
- `A(after_loss)` = 某船沉没后的可用行动集合
- `P_sink[ship]` = 多步推演得到的沉没概率 ∈ [0, 1]
- `relevance(action, ship)` = 该行动是否「利用」了该船提供的能力（0 或 1）
- `normRiskBonus` = 归一化后的风险加成 ∈ [0, 1]
- `riskAwareness` ∈ [0, 1]，控制风险对效用的最大影响比例

### 量纲分析

| 量 | 范围 | 说明 |
|---|------|------|
| `baseUtility` | [0, 1] | α × normInfoGain + (1-α) × normDamage |
| `sinkProbability × utilityLoss` | [0, 1] | 单艘船的风险贡献 |
| `riskBonus`（求和） | [0, 船只数] | ⚠️ 需要归一化 |
| `normRiskBonus` | [0, 1] | 除以高威胁船只数量 |
| `riskAwareness` | [0, 1] | 配置参数 |
| `finalScore` | [0, 2] | 当 riskAwareness=1 时最多翻倍 |

### 关键改进：relevance 的自动推导

不再硬编码 `checkUsesEndangeredAbility`，而是通过效用差自动计算：

```javascript
// 如果 action 在 A(current) 中存在，但在 A(after_loss) 中不存在
// 则 utilityLoss = 当前效用（完全丧失）
// 如果 action 仍可用但效用降低（如 AP 伤害降级）
// 则 utilityLoss = currentUtility - reducedUtility（部分丧失）
```

### 简化版本（推荐先实现）

如果不想每次都重新枚举行动集合，可以用近似：

```javascript
/**
 * 简化版：只比较「当前行动」在两种能力下的效用差
 * 
 * 如果当前行动在能力降级后不可用，返回该行动的当前效用
 * 如果当前行动仍可用但效用降低，返回效用差
 */
function actionUtilityLoss(action, beliefState, currentAbilities, afterAbilities, alpha) {
    // 检查该行动是否在降级后仍可用
    const stillAvailable = isActionAvailable(action, afterAbilities);
    
    if (!stillAvailable) {
        // 行动完全不可用，返回当前效用作为损失
        return evaluateAction(beliefState, action, currentAbilities, alpha);
    }
    
    // 行动仍可用，计算效用差（主要针对 AP 伤害降级）
    const currentUtility = evaluateAction(beliefState, action, currentAbilities, alpha);
    const reducedUtility = evaluateAction(beliefState, action, afterAbilities, alpha);
    
    return Math.max(0, currentUtility - reducedUtility);
}

function isActionAvailable(action, abilities) {
    if (action.weapon === 'HE') return abilities.canUseAir;
    if (action.weapon === 'SONAR') return abilities.canUseSonar;
    return true; // AP 始终可用
}
```

### 新的风险加成计算（含归一化）

```javascript
/**
 * 计算归一化的风险加成
 * 
 * @param {Object} action - 当前评估的行动
 * @param {Map} shipThreats - 各船的威胁信息
 * @param {BeliefState} beliefState - 置信状态
 * @param {Object} abilities - 当前能力
 * @param {Ship[]} aiShips - AI 船只列表
 * @param {number} alpha - 探索权重
 * @returns {number} 归一化风险加成 ∈ [0, 1]
 */
function calculateRiskBonusUnified(action, shipThreats, beliefState, abilities, aiShips, alpha) {
    let totalBonus = 0;
    let highThreatCount = 0;
    
    for (const ship of aiShips) {
        if (ship.sunk) continue;
        
        const threat = shipThreats.get(ship.id);
        if (!threat || threat.sinkProbability < 0.2) continue;
        
        highThreatCount++;
        
        // 模拟该船沉没后的能力
        const afterAbilities = simulateAbilitiesAfterLoss(aiShips, ship);
        
        // 计算该行动在能力降级后的效用损失
        const utilityLoss = actionUtilityLoss(action, beliefState, abilities, afterAbilities, alpha);
        
        // 风险加成 = 沉没概率 × 效用损失
        totalBonus += threat.sinkProbability * utilityLoss;
    }
    
    // 归一化到 [0, 1]
    return highThreatCount > 0 ? totalBonus / highThreatCount : 0;
}

/**
 * 计算最终得分
 * 
 * @param {number} baseUtility - 基础效用 ∈ [0, 1]
 * @param {number} normRiskBonus - 归一化风险加成 ∈ [0, 1]
 * @param {number} riskAwareness - 风险意识参数 ∈ [0, 1]
 * @returns {number} 最终得分 ∈ [0, 2]
 */
function calculateFinalScore(baseUtility, normRiskBonus, riskAwareness) {
    // 乘法形式：风险加成作为效用的放大系数
    // riskAwareness = 1 时，风险最多让效用翻倍
    return baseUtility * (1 + riskAwareness * normRiskBonus);
}
```

### riskAwareness 参数说明

| 取值 | 含义 | 效果 |
|------|------|------|
| 0 | 忽略风险 | `finalScore = baseUtility` |
| 0.5 | 中等风险意识 | 风险最多让效用提升 50% |
| 1 | 高风险意识 | 风险最多让效用翻倍 |

**语义**：`riskAwareness` 控制「风险对决策的最大影响比例」

**设计优点**：
- 有界参数 [0, 1]，便于调参
- 乘法形式保证：基础效用为 0 的行动不会因风险而变得有吸引力

## 实现步骤

1. **添加 `isActionAvailable(action, abilities)` 函数**
   - 判断给定能力下某行动是否可用
   - 替代硬编码的 `checkUsesEndangeredAbility`

2. **添加 `actionUtilityLoss(action, ...)` 函数**
   - 计算行动在能力降级后的效用损失
   - 复用现有的 `evaluateAction` 函数

3. **重构 `calculateRiskBonusMultiStep` → `calculateRiskBonusUnified`**
   - 传入 `beliefState` 和 `alpha`
   - 添加归一化逻辑
   - 删除 `calculateAbilityLoss` 和 `checkUsesEndangeredAbility`

4. **修改 `makeAIDecision` 调用**
   - 将 `beliefState` 和 `alpha` 传给风险计算函数
   - 使用乘法形式计算最终得分

5. **清理废弃代码**
   - 删除 `calculateAbilityLoss`
   - 删除 `checkUsesEndangeredAbility`

## 改进对比

| 方面 | 改进前 | 改进后 |
|------|--------|--------|
| 理论基础 | 启发式公式 | 信息论统一（边际效用） |
| 武器扩展 | 需修改 `checkUsesEndangeredAbility` | 自动（通过 `isActionAvailable`） |
| 归一化 | 手工设定权重 | 自然（效用本身已归一化） |
| 能力价值 | 固定权重 | 动态（依赖游戏状态） |
| 参数数量 | 多个隐式权重 | 单一 `riskAwareness` ∈ [0, 1] |
| 量纲 | 不统一 | 统一到 [0, 1] |

## 注意事项

- **计算开销**：略有增加（需调用 `evaluateAction`），但 `beliefState` 已缓存，影响可控
- **武器依赖**：`isActionAvailable` 仍需知道武器-能力映射，可放在武器类中声明
- **阈值选择**：`sinkProbability < 0.2` 时跳过计算，可根据需要调整
- **乘法语义**：`baseUtility = 0` 的行动不会因风险获得加分，这是合理的

## 未来可选优化

### 武器类声明能力依赖

```javascript
// 在 WeaponBase 或各武器类中
class HEWeapon extends WeaponBase {
    static requiredAbilities = ['canUseAir'];
}

class SonarWeapon extends WeaponBase {
    static requiredAbilities = ['canUseSonar'];
}

// isActionAvailable 改为查询武器类
function isActionAvailable(action, abilities) {
    const weapon = weaponRegistry.get(action.weapon);
    for (const ability of weapon.requiredAbilities || []) {
        if (!abilities[ability]) return false;
    }
    return true;
}
```

这样新增武器时只需在武器类中声明依赖，AI 模块无需修改。

### 伤害缩放声明

```javascript
class APWeapon extends WeaponBase {
    static requiredAbilities = [];  // 始终可用
    static damageScalesWithAbility = 'apDamage';  // 伤害随此能力变化
}
```

## 示例：风险如何影响决策

假设当前状态：
- CV 沉没概率 = 0.6
- DD 沉没概率 = 0.3（低于阈值 0.2，会被计入）
- `riskAwareness = 0.5`

评估两个行动：

| 行动 | baseUtility | CV 沉没后可用？ | utilityLoss | normRiskBonus | finalScore |
|------|-------------|----------------|-------------|---------------|------------|
| HE (3,4) | 0.7 | ❌ 不可用 | 0.7 | 0.6×0.7/1=0.42 | 0.7×(1+0.5×0.42)=0.85 |
| AP (3,4) | 0.5 | ✓ 可用 | 0 | 0 | 0.5×(1+0)=0.50 |

**结论**：HE 行动因风险加成从 0.7 提升到 0.85，更可能被选中。

## 与现有系统的兼容性

- **多步推演**：`simulateMultiStepThreats` 保持不变，仍然产出 `shipThreats` Map
- **难度配置**：`riskAwareness` 可继续放在 `difficultyConfig` 中
- **调试热力图**：不受影响，`calculateProbabilityGrid` 独立运作
