# AI 系统增强：信火一体的统一评估框架

> **状态**：📋 设计中（待实现）
> **版本**：v3.0 设计稿

## 背景与动机

### 当前问题

现有 AI 决策框架（v2.3）：
```
utility = α × 归一化信息增益 + (1-α) × 归一化期望伤害
```

**问题**：
1. **量纲不统一**：信息增益（比特）和期望伤害（HP）是不同物理量
2. **归一化漂移**：信息增益除以「当前总熵」，导致同样的信息量在不同游戏阶段得分差异巨大
3. **α 语义模糊**：只是一个无法解释的权衡系数

### 新思路：信火一体

借鉴现代军事「信火一体」理念：**信息即火力，发现即命中**。

核心思想：将侦查行动的价值转化为**未来期望伤害的提升量**，实现真正的量纲统一。

---

## 统一评估框架

### 核心公式

```
行动效用 = 直接伤害 + 信息的伤害转化增益
```

其中：
- **直接伤害**：攻击类武器的当回合期望伤害（已有实现）
- **信息的伤害转化增益**：相比于直接攻击，该行动能为下一步攻击带来多少额外伤害

### 关键洞察：利用多步推演计算信息转化

**核心思想**：不使用硬编码的转化率参数，而是通过**模拟推演**直接计算：

```
侦查的伤害转化增益 = E[下一步最优攻击伤害 | 先侦查] - E[本回合最优攻击伤害 | 直接攻击]
```

这个差值就是侦查相比直接攻击的**边际收益**。

---

## 两类行动的评估

### 类型一：攻击行动（AP / HE）

攻击行动的效用 = **直接伤害** + **信息副产品的伤害转化**

```javascript
/**
 * 评估攻击行动
 * 
 * 攻击会：
 * 1. 造成直接伤害
 * 2. 揭示格子状态（命中/未命中），产生信息副产品
 * 
 * 信息副产品的价值通过推演下一步攻击来计算
 */
function evaluateAttackAction(beliefState, action, abilities, context) {
    const probGrid = beliefState.getProbabilityGrid();
    
    // 1. 当回合直接伤害（已有实现）
    const directDamage = calculateExpectedDamage(action, probGrid, abilities);
    
    // 2. 信息副产品的伤害转化增益
    // 通过模拟攻击后的状态，计算下一步最优攻击的期望伤害提升
    const infoBonus = calculateAttackInfoBonus(beliefState, action, abilities, context);
    
    return directDamage + infoBonus;
}
```

### 类型二：侦查行动（SONAR）

侦查行动的效用 = **信息的伤害转化增益**（无直接伤害）

```javascript
/**
 * 评估侦查行动
 * 
 * 侦查不造成直接伤害，其价值完全来自信息转化：
 * - 相比于本回合直接选择最优攻击
 * - 侦查后下一步能带来多少额外伤害？
 * 
 * 这个差值必须为正，侦查才值得选择
 */
function evaluateReconAction(beliefState, action, abilities, context) {
    // 基准：本回合直接攻击的最优期望伤害
    const baselineAttackDamage = calculateBestAttackDamage(beliefState, abilities);
    
    // 侦查后下一步的期望伤害
    const nextStepDamage = calculatePostReconExpectedDamage(
        beliefState, action, abilities, context
    );
    
    // 侦查的边际收益 = 下一步伤害 - 本回合放弃的伤害
    // 注意：这可能是负值（侦查不划算）
    return nextStepDamage - baselineAttackDamage;
}
```

---

## 核心算法：基于推演的信息转化计算

### 侦查后的期望伤害推演

```javascript
/**
 * 计算侦查后下一步的期望伤害
 * 
 * 复用已实现的多步推演框架，模拟侦查结果并计算后续最优攻击
 * 
 * @param {BeliefState} beliefState - 当前置信状态
 * @param {Object} action - 侦查行动 { weapon: 'SONAR', r, c }
 * @param {Object} abilities - 能力
 * @param {Object} context - 上下文
 * @returns {number} 期望伤害
 */
function calculatePostReconExpectedDamage(beliefState, action, abilities, context) {
    const { r, c } = action;
    const probGrid = beliefState.getProbabilityGrid();
    const p = probGrid[r][c];  // 中心有船的概率
    
    // 情况1：声纳发现有船（概率 p）
    // 中心标记为疑似，概率分布更新
    const damageIfShip = simulatePostReconDamage(
        beliefState, action, abilities, context, true  // hasShip = true
    );
    
    // 情况2：声纳发现无船（概率 1-p）
    // 3×3 区域排除，概率密度重新分配
    const damageIfNoShip = simulatePostReconDamage(
        beliefState, action, abilities, context, false  // hasShip = false
    );
    
    // 期望伤害 = 加权平均
    return p * damageIfShip + (1 - p) * damageIfNoShip;
}

/**
 * 模拟侦查结果后的最优攻击伤害
 * 
 * @param {BeliefState} beliefState - 当前置信状态
 * @param {Object} action - 侦查行动
 * @param {Object} abilities - 能力
 * @param {Object} context - 上下文
 * @param {boolean} hasShip - 侦查结果：是否发现有船
 * @returns {number} 该情况下的最优攻击期望伤害
 */
function simulatePostReconDamage(beliefState, action, abilities, context, hasShip) {
    const { r, c } = action;
    
    // 1. 构建侦查后的模拟视角网格
    const simViewGrid = beliefState.viewGrid.map(row => [...row]);
    
    if (hasShip) {
        // 发现有船：中心标记为疑似
        simViewGrid[r][c] = CellState.SUSPECT;
    } else {
        // 发现无船：3×3 区域可标记为安全（或保持未知但降低概率）
        // 简化处理：中心标记为 MISS（排除）
        simViewGrid[r][c] = CellState.MISS;
        // 可选：周围 8 格也标记为低概率区域
    }
    
    // 2. 用更新后的视角构建新的置信状态
    const aliveTargets = context.enemyShips.filter(s => !s.sunk);
    const simBeliefState = new BeliefState(aliveTargets, simViewGrid);
    const simProbGrid = simBeliefState.getProbabilityGrid();
    
    // 3. 枚举所有攻击行动，找到最优
    const attackActions = enumerateAttackActions(simViewGrid, abilities);
    
    let bestDamage = 0;
    for (const attackAction of attackActions) {
        const damage = calculateExpectedDamage(attackAction, simProbGrid, abilities);
        bestDamage = Math.max(bestDamage, damage);
    }
    
    return bestDamage;
}

/**
 * 计算当前状态下的最优攻击伤害（基准线）
 */
function calculateBestAttackDamage(beliefState, abilities) {
    const probGrid = beliefState.getProbabilityGrid();
    const attackActions = enumerateAttackActions(beliefState.viewGrid, abilities);
    
    let bestDamage = 0;
    for (const action of attackActions) {
        const damage = calculateExpectedDamage(action, probGrid, abilities);
        bestDamage = Math.max(bestDamage, damage);
    }
    
    return bestDamage;
}

/**
 * 枚举所有攻击行动（不含侦查）
 */
function enumerateAttackActions(viewGrid, abilities) {
    const actions = [];
    
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const state = viewGrid[r][c];
            
            if (state === CellState.MISS || state === CellState.SUNK) continue;
            
            if (state === CellState.DESTROYED) {
                if (abilities.canUseAir) {
                    actions.push({ weapon: 'HE', r, c });
                }
                continue;
            }
            
            actions.push({ weapon: 'AP', r, c });
            
            if (abilities.canUseAir) {
                actions.push({ weapon: 'HE', r, c });
            }
        }
    }
    
    return actions;
}
```

---

## 攻击行动的信息副产品

攻击不仅造成伤害，还会揭示信息。这个信息副产品也有价值：

```javascript
/**
 * 计算攻击的信息副产品价值
 * 
 * 攻击会揭示目标格的真实状态，这个信息对后续攻击有价值
 * 但由于攻击本身就消耗了一回合，信息副产品的价值需要折扣
 * 
 * 使用推演：比较攻击后下一步 vs 不攻击下一步的伤害差
 */
function calculateAttackInfoBonus(beliefState, action, abilities, context) {
    const { weapon, r, c } = action;
    const probGrid = beliefState.getProbabilityGrid();
    
    // 获取攻击覆盖的格子
    const cells = getWeaponCoverage(weapon, r, c);
    
    // 计算攻击后各种结果的概率
    // 简化：只考虑「至少命中一格」vs「全部未命中」
    let hitProb = 0;
    for (const cell of cells) {
        if (cell.r >= 0 && cell.r < BOARD_SIZE && cell.c >= 0 && cell.c < BOARD_SIZE) {
            hitProb = Math.max(hitProb, probGrid[cell.r][cell.c]);
        }
    }
    
    // 命中时：揭示船只位置，后续攻击更精准
    const damageIfHit = simulatePostAttackDamage(beliefState, action, abilities, context, true);
    
    // 未命中时：排除这些格子，概率重新分配
    const damageIfMiss = simulatePostAttackDamage(beliefState, action, abilities, context, false);
    
    // 期望的下一步伤害
    const expectedNextDamage = hitProb * damageIfHit + (1 - hitProb) * damageIfMiss;
    
    // 基准：如果不进行任何行动（纯理论），下一步伤害不变
    // 但实际上我们要比较的是：攻击带来的信息是否有额外价值
    // 这个价值 = 期望下一步伤害 - 当前最优攻击伤害
    const baseline = calculateBestAttackDamage(beliefState, abilities);
    
    // 信息副产品价值（可能为 0 或负值）
    return Math.max(0, expectedNextDamage - baseline);
}

/**
 * 模拟攻击后的下一步最优伤害
 */
function simulatePostAttackDamage(beliefState, action, abilities, context, isHit) {
    const { weapon, r, c } = action;
    const cells = getWeaponCoverage(weapon, r, c);
    
    // 构建攻击后的模拟视角
    const simViewGrid = beliefState.viewGrid.map(row => [...row]);
    
    for (const cell of cells) {
        if (cell.r >= 0 && cell.r < BOARD_SIZE && cell.c >= 0 && cell.c < BOARD_SIZE) {
            if (simViewGrid[cell.r][cell.c] === CellState.UNKNOWN || 
                simViewGrid[cell.r][cell.c] === CellState.SUSPECT) {
                // 简化：命中时标记为 HIT，未命中时标记为 MISS
                simViewGrid[cell.r][cell.c] = isHit ? CellState.HIT : CellState.MISS;
            }
        }
    }
    
    // 用更新后的视角计算最优攻击
    const aliveTargets = context.enemyShips.filter(s => !s.sunk);
    const simBeliefState = new BeliefState(aliveTargets, simViewGrid);
    
    return calculateBestAttackDamage(simBeliefState, abilities);
}
```

---

## 统一评估函数

### 完整实现

```javascript
/**
 * 统一评估行动的效用值（信火一体版 v3.0）
 * 
 * 所有行动统一用「期望伤害」评估：
 * - 攻击类：直接伤害 + 信息副产品价值
 * - 侦查类：信息转化增益（相对于直接攻击的边际收益）
 * 
 * 关键特性：
 * - 无需 α 参数，完全由推演计算
 * - 量纲统一（全部是伤害）
 * - 自动平衡攻击与侦查
 * 
 * @param {BeliefState} beliefState - 置信状态
 * @param {Object} action - 行动 { weapon, r, c }
 * @param {Object} abilities - 能力
 * @param {Object} context - 上下文
 * @returns {number} 期望伤害（统一量纲）
 */
function evaluateActionUnified(beliefState, action, abilities, context) {
    const { weapon } = action;
    
    if (weapon === 'SONAR') {
        // 侦查行动：计算相对于直接攻击的边际收益
        return evaluateReconAction(beliefState, action, abilities, context);
    } else {
        // 攻击行动：直接伤害 + 信息副产品
        return evaluateAttackAction(beliefState, action, abilities, context);
    }
}
```

---

## 与风险感知模块的整合

### 利用已实现的多步推演

v2.3 已实现的 `simulateMultiStepThreats` 可以复用来估算信息转化的风险：

```javascript
/**
 * 计算侦查的风险调整后伤害转化
 * 
 * 考虑：在我侦查的这一回合，敌方可能击沉我的关键船只
 * 导致下一步攻击能力下降
 * 
 * @param {BeliefState} beliefState - 置信状态
 * @param {Object} action - 侦查行动
 * @param {Object} abilities - 当前能力
 * @param {Object} context - 上下文
 * @returns {number} 风险调整后的伤害转化增益
 */
function evaluateReconActionWithRisk(beliefState, action, abilities, context) {
    const { enemyShips, myShips, playerViewGrid, difficultyConfig } = context;
    const { riskAwareness = 0 } = difficultyConfig;
    
    // 1. 计算基础的侦查边际收益
    const baseReconGain = evaluateReconAction(beliefState, action, abilities, context);
    
    // 2. 如果启用风险感知，计算能力降级的期望影响
    if (riskAwareness > 0 && playerViewGrid) {
        // 利用已实现的多步推演获取各船威胁
        const shipThreats = simulateMultiStepThreats(
            playerViewGrid, myShips, enemyShips, 0.5, 1  // 只推演 1 步
        );
        
        // 计算期望的能力损失
        let expectedAbilityLoss = 0;
        for (const ship of myShips) {
            if (ship.sunk) continue;
            const threat = shipThreats.get(ship.id);
            if (!threat) continue;
            
            // 该船沉没后的能力
            const afterAbilities = simulateAbilitiesAfterLoss(myShips, ship);
            
            // 能力降级导致的伤害损失
            const currentBestDamage = calculateBestAttackDamage(beliefState, abilities);
            const reducedBestDamage = calculateBestAttackDamage(beliefState, afterAbilities);
            const damageLoss = currentBestDamage - reducedBestDamage;
            
            // 期望损失 = 沉没概率 × 伤害损失
            expectedAbilityLoss += threat.sinkProbability * damageLoss;
        }
        
        // 侦查的风险调整收益 = 基础收益 - 期望能力损失
        return baseReconGain - riskAwareness * expectedAbilityLoss;
    }
    
    return baseReconGain;
}
```

---

## 参数变化

### 旧框架参数

| 参数 | 含义 | 问题 |
|------|------|------|
| alpha | 信息 vs 伤害权重 | 语义模糊，无物理意义 |

### 新框架参数

| 参数 | 含义 | 来源 |
|------|------|------|
| ~~alpha~~ | ~~信息权重~~ | ❌ **已删除**，由推演自动计算 |
| randomness | 随机失误率 | ✅ 保留，控制难度 |
| riskAwareness | 风险意识 | ✅ 保留，控制风险敏感度 |

### 新难度配置

```javascript
DIFFICULTY_SETTINGS = {
    EASY: {
        randomness: 0.6,      // 60% 随机决策
        riskAwareness: 0.05   // 几乎不考虑风险
    },
    NORMAL: {
        randomness: 0.3,      // 30% 随机决策
        riskAwareness: 0.1    // 轻微风险意识
    },
    HARD: {
        randomness: 0.0,      // 完全理性
        riskAwareness: 0.15   // 较强风险意识
    }
}
```

---

## 算法复杂度分析

### 推演开销

| 操作 | 复杂度 | 优化方案 |
|------|--------|---------|
| 单次置信状态构建 | O(样本数 × 船只数 × 格子数) | 缓存 probGrid |
| 侦查后推演（2 种结果） | 2 × O(置信状态) | 可并行 |
| 攻击后推演（2 种结果） | 2 × O(置信状态) | 可并行 |
| 枚举最优攻击 | O(格子数 × 武器数) | 可剪枝 |

### 性能优化策略

1. **缓存当前最优攻击**：`calculateBestAttackDamage` 的结果在同一决策周期内不变
2. **惰性推演**：只对候选行动进行完整推演
3. **采样数动态调整**：侦查推演可用较少样本（如 100）
4. **提前剪枝**：如果直接伤害已经很高，跳过信息副产品计算

```javascript
// 性能优化版
function evaluateActionUnified_Optimized(beliefState, action, abilities, context) {
    const { weapon } = action;
    const probGrid = beliefState.getProbabilityGrid();
    
    // 缓存基准线（只计算一次）
    if (!context._cachedBestDamage) {
        context._cachedBestDamage = calculateBestAttackDamage(beliefState, abilities);
    }
    
    if (weapon === 'SONAR') {
        return evaluateReconAction(beliefState, action, abilities, context);
    } else {
        // 快速路径：如果直接伤害已经接近最大，跳过信息副产品
        const directDamage = calculateExpectedDamage(action, probGrid, abilities);
        const maxPossibleDamage = weapon === 'HE' ? 5 : abilities.apDamage;
        
        if (directDamage > maxPossibleDamage * 0.8) {
            return directDamage;  // 高伤害行动，信息副产品可忽略
        }
        
        return evaluateAttackAction(beliefState, action, abilities, context);
    }
}
```

---

## 实现计划

### 阶段一：核心重构
1. [ ] 实现 `evaluateAttackAction` 函数
2. [ ] 实现 `evaluateReconAction` 函数
3. [ ] 实现 `simulatePostReconDamage` 函数
4. [ ] 实现 `simulatePostAttackDamage` 函数
5. [ ] 实现 `calculateBestAttackDamage` 函数
6. [ ] 重构 `evaluateAction` → `evaluateActionUnified`

### 阶段二：风险整合
1. [ ] 实现 `evaluateReconActionWithRisk` 函数
2. [ ] 整合现有的 `simulateMultiStepThreats`
3. [ ] 调整 `makeAIDecision` 主流程

### 阶段三：优化与测试
1. [ ] 实现缓存机制
2. [ ] 性能基准测试
3. [ ] 不同游戏阶段的行为测试
4. [ ] 对比新旧框架的决策差异

### 阶段四：难度配置
1. [ ] 移除 alpha 参数
2. [ ] 更新难度配置
3. [ ] 重新平衡各难度

---

## 理论优势

| 方面 | 旧框架（v2.3） | 新框架（v3.0） |
|------|---------------|---------------|
| 量纲 | 比特 + 伤害（不统一） | 纯伤害（统一） |
| 核心参数 | α 需要手工调节 | 无，完全由推演计算 |
| 物理意义 | 弱 | 强（信火一体） |
| 游戏进程稳定性 | 熵归一化导致漂移 | 稳定（直接计算伤害） |
| 可解释性 | 低 | 高（每个值都是伤害差） |
| 扩展性 | 新武器需调 α | 新武器自动适配 |

---

## 附录：决策流程对比

### 旧流程（v2.3）

```
1. 计算信息增益 (比特)
2. 归一化: normInfoGain = infoGain / currentEntropy  ← 问题所在
3. 计算期望伤害
4. 归一化: normDamage = damage / maxDamage
5. utility = α × normInfoGain + (1-α) × normDamage
```

### 新流程（v3.0）

```
攻击行动:
1. 计算当回合直接伤害
2. 推演攻击后状态，计算下一步最优伤害
3. utility = 直接伤害 + max(0, 下一步伤害 - 当前最优伤害)

侦查行动:
1. 计算当前最优攻击伤害（基准线）
2. 分情况推演侦查结果（有船/无船）
3. 计算各情况下下一步最优攻击伤害
4. utility = E[下一步伤害] - 基准线
```

### 决策语义对比

| 场景 | 旧框架决策 | 新框架决策 |
|------|-----------|-----------|
| 游戏初期，信息稀缺 | 高 α 倾向侦查 | 推演显示侦查能显著提升下一步伤害 → 选侦查 |
| 游戏后期，目标明确 | 低 α 倾向攻击 | 推演显示侦查边际收益为负 → 选攻击 |
| 发现疑似点 | 取决于 α 设定 | 推演显示攻击疑似点伤害更高 → 选攻击 |
| CV 即将沉没 | riskAwareness 调整 | 同样机制 + 更精确的伤害量化 |
