# AI 系统增强方案（简化版）

## 一、当前架构分析

### 1.1 现有决策框架

当前 AI 采用**信息论驱动的单向决策模型**：

```
utility = α × 归一化信息增益 + (1-α) × 归一化期望伤害
```

**核心组件：**
- `BeliefState`: 蒙特卡洛采样维护对玩家舰船配置的置信分布
- `evaluateAction()`: 统一评估所有可用行动（AP/HE/SONAR）
- `calculateExpectedDamage()`: 计算期望有效伤害（含伤害溢出优化）
- `checkAIAbilities()`: 检查 AI 武器可用性

### 1.2 核心缺陷

| 缺陷 | 描述 |
|-----|------|
| **无敌方建模** | AI 不预测玩家可能的攻击行为，无法评估己方风险 |
| **无时序意识** | 不知道"趁 CV 还在多用空袭"这类策略 |

---

## 二、增强方案：对称推演

### 2.1 核心思想

**复用现有框架，对称地模拟玩家视角**

关键洞察：玩家攻击 AI 的决策过程，与 AI 攻击玩家的决策过程是**对称的**。

- AI 用 `BeliefState` + `evaluateAction()` 决定攻击玩家
- 玩家（假设理性）也会用类似逻辑决定攻击 AI

因此，我们可以：
1. 构建「玩家视角的 AI 棋盘」
2. 用**同样的算法、同样的参数**模拟玩家决策
3. 将模拟结果作为「己方风险」纳入 AI 决策

### 2.2 新效用函数

```
utility = 原始评分 + riskAwareness × 风险调整项
```

**只引入一个新参数**：`riskAwareness`（风险意识，0~1）

- `riskAwareness = 0`: 完全不考虑己方风险（当前行为）
- `riskAwareness = 1`: 高度重视己方风险

### 2.3 为什么这样设计？

| 设计原则 | 实现方式 |
|---------|---------|
| **最小化超参数** | 只加一个 `riskAwareness`，复用现有 `alpha` |
| **无硬编码权重** | 不给舰船定义战略权重，风险自然来自能力丧失 |
| **代码复用** | 复用 `BeliefState` 和 `evaluateAction` |
| **对称性** | 假设玩家与 AI 使用相同策略 |

---

## 三、对称推演实现

### 3.1 获取玩家视角数据

```javascript
/**
 * 获取玩家视角的 AI 棋盘状态
 * （与 getAiViewGrid 对称）
 * 
 * 注意：此函数需要由 game.js 提供，因为需要访问 DOM 和 enemyShips
 * AI 模块通过 context 参数接收此数据
 * 
 * @returns {number[][]} 10x10 数组
 *   0=未知, 1=miss, 2=hit, 3=destroyed, 4=suspect, 5=sunk
 */
function getPlayerViewGrid(enemyShips) {
    const grid = Array(10).fill(0).map(() => Array(10).fill(0));
    
    document.querySelectorAll('#enemy-grid .cell').forEach(cell => {
        const r = parseInt(cell.dataset.r);
        const c = parseInt(cell.dataset.c);
        if (cell.classList.contains('destroyed')) grid[r][c] = 3;
        else if (cell.classList.contains('hit')) grid[r][c] = 2;
        else if (cell.classList.contains('miss')) grid[r][c] = 1;
        else if (cell.classList.contains('suspect')) grid[r][c] = 4;
    });
    
    // 标记已沉没的 AI 船只
    enemyShips.forEach(s => {
        if (s.sunk) {
            for (let i = 0; i < s.len; i++) {
                const nr = s.v ? s.r + i : s.r;
                const nc = s.v ? s.c : s.c + i;
                if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10) {
                    grid[nr][nc] = 5;
                }
            }
        }
    });
    
    return grid;
}
```

### 3.2 多步对称推演

#### 3.2.1 设计思路

单步推演只能预测「玩家下一步打哪」，但无法评估「几步之后 CV 会沉」。

多步推演的核心思想：
```
推演 k 步，累积计算关键船只的生存概率
```

**关键洞察**：我们不需要精确模拟每一步的结果，只需要估算「k 步内某船被击沉的概率」。

#### 3.2.2 完整多步推演

```javascript
/** 对称推演配置 */
const OPPONENT_SAMPLE_COUNT = 100;  // 每步采样数（较小以平衡多步开销）
const LOOKAHEAD_STEPS = 3;          // 向前看 3 步

/**
 * 多步推演：估算 k 步内各船的累积威胁
 * 
 * 每一步都进行完整的推演：
 * 1. 重新构建置信状态（采样）
 * 2. 评估所有行动
 * 3. 选择最优行动
 * 4. 更新模拟状态
 * 
 * @returns {Map<shipId, { totalExpectedDamage, sinkProbability }>}
 */
function simulateMultiStepThreats(playerViewGrid, aiShips, playerShips, alpha, steps = LOOKAHEAD_STEPS) {
    const playerAbilities = checkAIAbilities(playerShips);
    const aliveTargets = aiShips.filter(s => !s.sunk);
    if (aliveTargets.length === 0) return new Map();
    
    // 初始化每艘船的累积威胁
    const threats = new Map();
    for (const ship of aliveTargets) {
        threats.set(ship.id, {
            totalExpectedDamage: 0,
            remainingHp: ship.hp.reduce((a, b) => a + b, 0)
        });
    }
    
    // 模拟状态（会随推演更新）
    let simViewGrid = playerViewGrid.map(row => [...row]);
    let simDamageGrid = Array(10).fill(0).map(() => Array(10).fill(0));
    
    for (let step = 0; step < steps; step++) {
        // 【每步都完整推演】构建玩家置信状态
        const playerBelief = new BeliefState(aliveTargets, simViewGrid, OPPONENT_SAMPLE_COUNT);
        const probGrid = playerBelief.getProbabilityGrid();
        
        // 枚举玩家可用行动
        const actions = enumerateAllActions(simViewGrid, playerAbilities);
        if (actions.length === 0) break;
        
        // 【完整评估】用原版 evaluateAction
        let bestAction = null;
        let bestScore = -Infinity;
        
        for (const action of actions) {
            const score = evaluateAction(playerBelief, action, playerAbilities, alpha);
            if (score > bestScore) {
                bestScore = score;
                bestAction = action;
            }
        }
        
        if (!bestAction) break;
        
        // 累积该攻击对各船的威胁
        accumulateThreat(bestAction, probGrid, playerAbilities, aiShips, threats);
        
        // 更新模拟状态
        updateSimulatedState(simViewGrid, simDamageGrid, bestAction, playerAbilities, probGrid);
    }
    
    // 计算沉没概率
    for (const [shipId, threat] of threats) {
        const ship = aiShips.find(s => s.id === shipId);
        if (ship) {
            const remainingHp = ship.hp.reduce((a, b) => a + b, 0);
            threat.sinkProbability = Math.min(1, threat.totalExpectedDamage / Math.max(1, remainingHp));
        }
    }
    
    return threats;
}

/**
 * 累积攻击对各船的威胁
 */
function accumulateThreat(action, probGrid, abilities, aiShips, threats) {
    const { weapon, r, c } = action;
    const cells = getWeaponCoverage(weapon, r, c);
    const dmg = weapon === 'AP' ? abilities.apDamage : 1;
    
    for (const cell of cells) {
        if (cell.r < 0 || cell.r >= 10 || cell.c < 0 || cell.c >= 10) continue;
        
        // 找出该格子属于哪艘船（AI 知道自己船的真实位置）
        for (const ship of aiShips) {
            if (ship.sunk) continue;
            const shipCells = getShipCells(ship);
            const isOnShip = shipCells.some(sc => sc.r === cell.r && sc.c === cell.c);
            
            if (isOnShip) {
                const threat = threats.get(ship.id);
                if (threat) {
                    // 期望伤害 = 玩家攻击该格的概率 × 伤害
                    threat.totalExpectedDamage += probGrid[cell.r][cell.c] * dmg;
                }
            }
        }
    }
}

/**
 * 更新模拟状态
 * 根据攻击结果更新视角网格，使后续步骤的采样更准确
 */
function updateSimulatedState(simViewGrid, simDamageGrid, action, abilities, probGrid) {
    const { weapon, r, c } = action;
    const cells = getWeaponCoverage(weapon, r, c);
    const dmg = weapon === 'AP' ? abilities.apDamage : 1;
    
    for (const cell of cells) {
        if (cell.r >= 0 && cell.r < 10 && cell.c >= 0 && cell.c < 10) {
            simDamageGrid[cell.r][cell.c] += dmg;
            
            // 根据概率决定模拟结果（简化：高概率格子视为命中）
            if (probGrid[cell.r][cell.c] > 0.5) {
                simViewGrid[cell.r][cell.c] = 2;  // HIT
            } else if (simViewGrid[cell.r][cell.c] === 0) {
                simViewGrid[cell.r][cell.c] = 1;  // MISS
            }
        }
    }
}

/**
 * 获取武器覆盖范围
 */
function getWeaponCoverage(weapon, r, c) {
    if (weapon === 'AP' || weapon === 'SONAR') {
        return [{ r, c }];
    } else if (weapon === 'HE') {
        return [
            { r, c },
            { r: r - 1, c: c - 1 },
            { r: r - 1, c: c + 1 },
            { r: r + 1, c: c - 1 },
            { r: r + 1, c: c + 1 }
        ];
    }
    return [{ r, c }];
}

/**
 * 获取船只占用的格子
 */
function getShipCells(ship) {
    const cells = [];
    for (let i = 0; i < ship.len; i++) {
        cells.push({
            r: ship.v ? ship.r + i : ship.r,
            c: ship.v ? ship.c : ship.c + i
        });
    }
    return cells;
}
```

### 3.3 修改 BeliefState 支持自定义采样数

```javascript
class BeliefState {
    /**
     * @param {Ship[]} ships - 目标船只
     * @param {number[][]} viewGrid - 视角网格
     * @param {number} [sampleCount=SAMPLE_COUNT] - 采样数量
     */
    constructor(ships, viewGrid, sampleCount = SAMPLE_COUNT) {
        this.ships = ships;
        this.viewGrid = viewGrid;
        this.boardSize = BOARD_SIZE;
        
        this.constraints = this._buildConstraints();
        this.samples = this._sampleConfigurations(sampleCount);  // 使用传入的采样数
        
        this._probabilityGrid = null;
        this._entropy = null;
    }
    // ... 其余不变
}
```

### 3.4 风险感知决策（多步版）

```javascript
/**
 * 修改后的 makeAIDecision（多步推演版）
 * 
 * context 新增字段：
 * - playerViewGrid: 玩家视角的 AI 棋盘（由 game.js 提供）
 */
export function makeAIDecision(context) {
    const { viewGrid, myShips, enemyShips, difficultyConfig, playerViewGrid } = context;
    const { alpha = 0.5, randomness = 0, riskAwareness = 0 } = difficultyConfig;
    
    // 1. 检查 AI 可用的武器能力
    const abilities = checkAIAbilities(enemyShips);
    
    // 2. 获取存活的目标船只
    const aliveTargets = myShips.filter(s => !s.sunk);
    if (aliveTargets.length === 0) {
        return findFallbackTarget(viewGrid);
    }

    // 3. 难度控制：随机扰动
    if (Math.random() < randomness) {
        return makeRandomDecision(viewGrid, abilities);
    }

    // 4. 构建置信状态（蒙特卡洛采样）
    const beliefState = new BeliefState(aliveTargets, viewGrid);
    
    // 5. 枚举所有可用行动
    const actions = enumerateAllActions(viewGrid, abilities);
    if (actions.length === 0) {
        return findFallbackTarget(viewGrid);
    }

    // 6. 【改进】多步推演：评估各船的累积威胁
    let shipThreats = null;
    if (riskAwareness > 0 && playerViewGrid) {
        shipThreats = simulateMultiStepThreats(
            playerViewGrid, 
            enemyShips, 
            myShips, 
            alpha,
            LOOKAHEAD_STEPS
        );
    }

    // 7. 找到最优行动
    let bestAction = null;
    let bestScore = -Infinity;
    const candidates = [];

    for (const action of actions) {
        // 基础评分（原有逻辑）
        let score = evaluateAction(beliefState, action, abilities, alpha);
        
        // 【改进】基于多步威胁的风险调整
        if (shipThreats && riskAwareness > 0) {
            const riskBonus = calculateRiskBonusMultiStep(action, shipThreats, abilities, enemyShips);
            score += riskAwareness * riskBonus;
        }
        
        if (score > bestScore + 1e-9) {
            bestScore = score;
            candidates.length = 0;
            candidates.push(action);
        } else if (Math.abs(score - bestScore) < 1e-9) {
            candidates.push(action);
        }
    }

    bestAction = candidates[Math.floor(Math.random() * candidates.length)];
    recordDamageDealt(bestAction, abilities);
    
    return bestAction;
}
```

### 3.5 风险调整计算（多步版）

```javascript
/**
 * 基于多步威胁计算风险调整
 * 
 * 设计原则：无硬编码权重
 * - 不给 HE/SONAR/AP 定义固定系数
 * - 风险加成 = 沉没概率 × 能力损失的「归一化影响」
 * 
 * @param {Object} action - AI 当前考虑的行动
 * @param {Map} shipThreats - 各船的累积威胁 Map<shipId, {sinkProbability, ...}>
 * @param {Object} abilities - AI 当前能力
 * @param {Ship[]} aiShips - AI 的船只
 * @returns {number} 风险调整加成
 */
function calculateRiskBonusMultiStep(action, shipThreats, abilities, aiShips) {
    let totalBonus = 0;
    
    for (const ship of aiShips) {
        if (ship.sunk) continue;
        
        const threat = shipThreats.get(ship.id);
        if (!threat || threat.sinkProbability < 0.2) continue;
        
        // 模拟该船沉没后的能力变化
        const afterAbilities = simulateAbilitiesAfterLoss(aiShips, ship);
        
        // 计算能力损失的归一化影响（0~1 范围）
        const abilityLoss = calculateAbilityLoss(abilities, afterAbilities);
        
        // 如果当前行动使用了即将丧失的能力，给予加成
        const usesEndangeredAbility = checkUsesEndangeredAbility(action, abilities, afterAbilities);
        
        if (usesEndangeredAbility) {
            // 风险加成 = 沉没概率 × 能力损失影响
            totalBonus += threat.sinkProbability * abilityLoss;
        }
    }
    
    return totalBonus;
}

/**
 * 计算能力损失的归一化影响
 * 
 * 将各种能力损失映射到 0~1 范围，无需手动设定权重
 * 
 * @returns {number} 0~1，1 表示丧失全部额外能力
 */
function calculateAbilityLoss(before, after) {
    let loss = 0;
    let maxPossibleLoss = 0;
    
    // 空袭能力：二元，丧失 = 1
    maxPossibleLoss += 1;
    if (before.canUseAir && !after.canUseAir) {
        loss += 1;
    }
    
    // 水听能力：二元，丧失 = 1
    maxPossibleLoss += 1;
    if (before.canUseSonar && !after.canUseSonar) {
        loss += 1;
    }
    
    // 主炮伤害：连续，从 3 降到 1 = 丧失 2/3 的额外伤害
    // 额外伤害 = apDamage - 1（基础伤害为 1）
    const beforeExtra = before.apDamage - 1;  // 0, 1, 或 2
    const afterExtra = after.apDamage - 1;
    const maxExtra = 2;  // 最大额外伤害
    
    maxPossibleLoss += 1;
    if (beforeExtra > afterExtra) {
        loss += (beforeExtra - afterExtra) / maxExtra;
    }
    
    // 归一化到 0~1
    return maxPossibleLoss > 0 ? loss / maxPossibleLoss : 0;
}

/**
 * 检查当前行动是否使用了即将丧失的能力
 */
function checkUsesEndangeredAbility(action, before, after) {
    // 空袭能力即将丧失，且当前使用空袭
    if (before.canUseAir && !after.canUseAir && action.weapon === 'HE') {
        return true;
    }
    
    // 水听能力即将丧失，且当前使用水听
    if (before.canUseSonar && !after.canUseSonar && action.weapon === 'SONAR') {
        return true;
    }
    
    // 主炮伤害即将降级，且当前使用主炮
    if (before.apDamage > after.apDamage && action.weapon === 'AP') {
        return true;
    }
    
    return false;
}

/**
 * 模拟某船沉没后的能力
 */
function simulateAbilitiesAfterLoss(ships, lostShip) {
    const remaining = ships.filter(s => s.id !== lostShip.id && !s.sunk);
    return checkAIAbilities(remaining);
}
```

---

## 四、难度配置

### 4.1 参数说明

| 参数 | 范围 | 说明 |
|-----|------|------|
| `alpha` | 0~1 | 信息 vs 伤害的平衡（现有） |
| `randomness` | 0~1 | 随机决策概率（现有） |
| `riskAwareness` | 0~1 | 风险意识强度（**新增**） |

**内部常量**（可在代码中调整，不暴露给难度配置）：

| 常量 | 默认值 | 说明 |
|-----|--------|------|
| `OPPONENT_SAMPLE_COUNT` | 200 | 对称推演采样数 |
| `LOOKAHEAD_STEPS` | 3 | 向前推演步数 |

### 4.2 难度预设

```javascript
export const DIFFICULTY_SETTINGS = {
    EASY: {
        alpha: 0.1,
        randomness: 0.5,
        riskAwareness: 0.0    // 完全不考虑风险
    },
    NORMAL: {
        alpha: 0.4,
        randomness: 0.25,
        riskAwareness: 0.3    // 轻微风险意识
    },
    HARD: {
        alpha: 0.7,
        randomness: 0.0,
        riskAwareness: 0.6    // 较强风险意识
    }
};
```

---

## 五、game.js 对接

### 5.1 提供 playerViewGrid

在 `aiTurn()` 中构建 context 时，新增 `playerViewGrid` 字段：

```javascript
function aiTurn() {
    // ...existing code...
    
    const aiDecisionContext = {
        viewGrid,
        myShips,
        enemyShips,
        difficultyConfig: AI_PROB_CONFIG,
        playerViewGrid: getPlayerViewGrid()  // 新增
    };
    
    const decision = makeAIDecision(aiDecisionContext);
    // ...
}

/**
 * 获取玩家视角的 AI 棋盘
 * （放在 game.js 中，因为需要访问 DOM 和 enemyShips）
 */
function getPlayerViewGrid() {
    const grid = Array(10).fill(0).map(() => Array(10).fill(0));
    
    document.querySelectorAll('#enemy-grid .cell').forEach(cell => {
        const r = parseInt(cell.dataset.r);
        const c = parseInt(cell.dataset.c);
        if (cell.classList.contains('destroyed')) grid[r][c] = 3;
        else if (cell.classList.contains('hit')) grid[r][c] = 2;
        else if (cell.classList.contains('miss')) grid[r][c] = 1;
        // suspect 状态在敌方网格上的表现需确认
    });
    
    // 标记已沉没的 AI 船只
    enemyShips.forEach(s => {
        if (s.sunk) {
            for (let i = 0; i < s.len; i++) {
                const nr = s.v ? s.r + i : s.r;
                const nc = s.v ? s.c : s.c + i;
                if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10) {
                    grid[nr][nc] = 5;
                }
            }
        }
    });
    
    return grid;
}
```

---

## 六、实现清单

### Phase 1: 基础设施

- [ ] 修改 `BeliefState` 构造函数，添加 `sampleCount` 参数
- [ ] 在 `game.js` 中实现 `getPlayerViewGrid()`
- [ ] 在 `difficulties.js` 中添加 `riskAwareness` 参数

### Phase 2: 多步推演

- [ ] 实现 `simulateMultiStepThreats()` 多步威胁评估
- [ ] 实现 `evaluateActionSimplified()` 简化行动评估
- [ ] 实现辅助函数：`accumulateThreat()`、`updateSimulatedState()`、`getWeaponCoverage()`、`getShipCells()`
- [ ] 实现 `calculateRiskBonusMultiStep()` 多步风险加成
- [ ] 修改 `makeAIDecision()` 集成多步推演

### Phase 3: 测试与调优

- [ ] 验证 `riskAwareness = 0` 时行为不变
- [ ] 验证 CV 受多步威胁时增加 HE 使用
- [ ] 验证性能（多步推演额外延迟 < 30ms）
- [ ] 调整 `LOOKAHEAD_STEPS`（1~5）和 `OPPONENT_SAMPLE_COUNT`（100~500）

---

## 七、测试要点

### 7.1 行为验证

- [ ] `riskAwareness = 0` 时行为与当前完全一致
- [ ] 当 CV 受多步累积威胁时，应增加 HE 使用频率
- [ ] 当 DD 受多步累积威胁时，应增加 SONAR 使用频率
- [ ] 多步推演应能检测到「连续几次攻击可击沉 CV」的情况

### 7.2 性能验证

- [ ] 多步推演（3步）额外延迟 < 30ms
- [ ] 总决策延迟 < 60ms
- [ ] `LOOKAHEAD_STEPS = 5` 时仍可接受（<100ms）

### 7.3 边界情况

- [ ] 玩家所有船沉没时不报错
- [ ] AI 所有船沉没时不报错
- [ ] 游戏开局（无攻击记录）时正常工作
- [ ] `playerViewGrid` 未提供时优雅降级（跳过风险计算）

---

## 八、设计备注

### Q: 为什么不引入战略权重？

战略权重（如 CV=5, DD=4）看似直观，但存在问题：
1. 引入硬编码常数，难以调优
2. 权重与游戏状态无关（例如 CV 只剩 1 格血时价值更高？还是更低？）
3. 需要同时考虑攻击价值和防御价值，复杂度翻倍

对称推演自然解决了这些问题：
- 能力丧失的影响通过 `simulateAbilitiesAfterLoss` 自动计算
- 不需要人工定义权重

### Q: 小采样（200 次）× 多步（3步）足够吗？

足够。关键洞察：
- 我们只需要估算「各船的累积威胁」，不需要精确的攻击序列
- 多步推演的主要价值是检测「需要多次攻击才能击沉」的情况
- 3 步足以覆盖大部分场景（最高 HP 的 BB 需要 3 次 1 伤攻击）

### Q: 为什么假设玩家与 AI 使用相同策略？

1. **简洁性**：不引入额外的「玩家模型参数」
2. **鲁棒性**：高估玩家能力比低估更安全
3. **可扩展**：未来可通过调整模拟时的 alpha 来模拟不同水平玩家

---

## 九、未来扩展（暂不实现）

1. **适应性对手建模**：根据玩家历史行为调整模拟时的 alpha
2. **多步推演**：预测 2-3 回合后的局面
3. **防御性部署**：部署阶段就考虑关键船只的隐蔽性
