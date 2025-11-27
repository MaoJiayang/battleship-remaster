/**
 * AI 策略模块 v2.0 - 基于信息论的统一决策框架
 * 
 * 设计思想：信息增益最大化 (Max Information Gain)
 * - 将所有武器（主炮/空袭/声纳）统一评估为"信息获取 + 伤害输出"的组合
 * - 用信息熵作为统一度量，消除多个启发式超参数
 * - 唯一核心参数：alpha（探索权重）控制信息收集 vs 伤害输出的平衡
 * 
 * 输入接口：
 * - viewGrid: AI 视角下的棋盘状态（0=未知，1=未命中，2=命中，3=摧毁，4=疑似，5=已沉没）
 * - myShips: 玩家舰船列表（用于推断存活船型）
 * - enemyShips: 敌方舰船列表（用于判断自身能力）
 * - difficultyConfig: 难度配置参数
 * 
 * 输出接口：
 * - { weapon: 'AP'|'HE'|'SONAR', r: number, c: number } 攻击指令
 */

import { BOARD_SIZE } from '../config/constants.js';

// 导入武器类用于获取范围（避免重复定义）
import { APWeapon } from '../game/weapons/APWeapon.js';
import { HEWeapon } from '../game/weapons/HEWeapon.js';
import { SonarWeapon } from '../game/weapons/SonarWeapon.js';

// 创建武器实例用于获取范围
const weaponInstances = {
    AP: new APWeapon(),
    HE: new HEWeapon(),
    SONAR: new SonarWeapon()
};

// ============================================================================
// 常量定义
// ============================================================================

/** 格子状态枚举 */
const CellState = {
    UNKNOWN: 0,     // 未知（战争迷雾）
    MISS: 1,        // 未命中
    HIT: 2,         // 命中但未摧毁
    DESTROYED: 3,   // 已摧毁
    SUSPECT: 4,     // 疑似（声纳标记）
    SUNK: 5         // 已沉没船只占位
};

/** 蒙特卡洛采样数量 */
const SAMPLE_COUNT = 500;

/** 最小概率阈值，防止数值问题 */
const MIN_PROB = 1e-10;

// ============================================================================
// 主入口
// ============================================================================

/**
 * AI 决策主入口
 * 
 * @param {Object} context - 决策上下文
 * @param {Array<Array<number>>} context.viewGrid - AI 视角棋盘 (10x10)
 * @param {Array} context.myShips - 玩家舰船状态（AI 的攻击目标）
 * @param {Array} context.enemyShips - 敌方舰船状态（AI 自身的船）
 * @param {Object} context.difficultyConfig - 难度配置
 * @returns {{ weapon: string, r: number, c: number }} 攻击指令
 */
export function makeAIDecision(context) {
    const { viewGrid, myShips, enemyShips, difficultyConfig } = context;

    // 1. 检查 AI 可用的武器能力
    const abilities = checkAIAbilities(enemyShips);
    
    // 2. 获取存活的目标船只
    const aliveTargets = myShips.filter(s => !s.sunk);
    if (aliveTargets.length === 0) {
        return findFallbackTarget(viewGrid);
    }

    // 3. 难度控制：随机扰动
    if (Math.random() < (difficultyConfig.randomness ?? 0)) {
        return makeRandomDecision(viewGrid, abilities);
    }

    // 4. 构建置信状态（蒙特卡洛采样）
    const beliefState = new BeliefState(aliveTargets, viewGrid);
    
    // 5. 枚举所有可用行动并统一评估
    const alpha = difficultyConfig.alpha ?? 0.5;
    const actions = enumerateAllActions(viewGrid, abilities);
    
    if (actions.length === 0) {
        return findFallbackTarget(viewGrid);
    }

    // 6. 找到最优行动
    let bestAction = null;
    let bestScore = -Infinity;
    const candidates = [];

    for (const action of actions) {
        const score = evaluateAction(beliefState, action, abilities, alpha);
        
        if (score > bestScore + 1e-9) {
            bestScore = score;
            candidates.length = 0;
            candidates.push(action);
        } else if (Math.abs(score - bestScore) < 1e-9) {
            candidates.push(action);
        }
    }

    // 从并列最优中随机选择（增加不可预测性）
    bestAction = candidates[Math.floor(Math.random() * candidates.length)];
    
    return bestAction;
}

// ============================================================================
// 置信状态管理（蒙特卡洛采样）
// ============================================================================

/**
 * 置信状态类：维护对敌舰配置的概率分布
 * 
 * 核心思想：通过蒙特卡洛采样近似所有可行配置的分布
 */
class BeliefState {
    constructor(ships, viewGrid) {
        this.ships = ships;
        this.viewGrid = viewGrid;
        this.boardSize = BOARD_SIZE;
        
        // 预计算约束信息
        this.constraints = this._buildConstraints();
        
        // 蒙特卡洛采样
        this.samples = this._sampleConfigurations(SAMPLE_COUNT);
        
        // 缓存边缘概率分布
        this._probabilityGrid = null;
        this._entropy = null;
    }

    /**
     * 构建约束条件
     */
    _buildConstraints() {
        const mustHit = [];      // 必须包含的命中点
        const mustAvoid = [];    // 必须避开的点（miss/sunk）
        const suspect = [];      // 疑似点（软约束，增加权重）
        
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const state = this.viewGrid[r][c];
                if (state === CellState.HIT || state === CellState.DESTROYED) {
                    mustHit.push({ r, c });
                } else if (state === CellState.MISS || state === CellState.SUNK) {
                    mustAvoid.push({ r, c });
                } else if (state === CellState.SUSPECT) {
                    suspect.push({ r, c });
                }
            }
        }
        
        return { mustHit, mustAvoid, suspect };
    }

    /**
     * 蒙特卡洛采样：生成 n 个与观测一致的配置
     */
    _sampleConfigurations(n) {
        const samples = [];
        let attempts = 0;
        const maxAttempts = n * 20; // 防止死循环
        
        while (samples.length < n && attempts < maxAttempts) {
            attempts++;
            const config = this._sampleOneConfiguration();
            if (config) {
                samples.push(config);
            }
        }
        
        // 如果采样不足，用已有样本填充
        while (samples.length < n && samples.length > 0) {
            samples.push(samples[Math.floor(Math.random() * samples.length)]);
        }
        
        return samples;
    }

    /**
     * 采样单个配置：逐船随机放置
     */
    _sampleOneConfiguration() {
        const occupied = new Set();
        const config = [];
        
        // 按船只长度降序排列，大船先放
        const sortedShips = [...this.ships].sort((a, b) => b.len - a.len);
        
        for (const ship of sortedShips) {
            const placement = this._sampleShipPlacement(ship, occupied);
            if (!placement) {
                return null; // 放置失败，整个配置作废
            }
            config.push(placement);
            placement.cells.forEach(cell => occupied.add(`${cell.r},${cell.c}`));
        }
        
        // 验证配置是否满足 mustHit 约束
        if (!this._validateMustHit(config)) {
            return null;
        }
        
        return config;
    }

    /**
     * 为单艘船采样一个合法放置位置
     */
    _sampleShipPlacement(ship, occupied) {
        const validPlacements = [];
        
        // 枚举所有可能的放置
        for (let vertical = 0; vertical <= 1; vertical++) {
            const isVertical = vertical === 1;
            const maxR = isVertical ? this.boardSize - ship.len : this.boardSize - 1;
            const maxC = isVertical ? this.boardSize - 1 : this.boardSize - ship.len;
            
            for (let r = 0; r <= maxR; r++) {
                for (let c = 0; c <= maxC; c++) {
                    const cells = [];
                    let valid = true;
                    let hitCount = 0;
                    let suspectCount = 0;
                    
                    for (let i = 0; i < ship.len; i++) {
                        const nr = isVertical ? r + i : r;
                        const nc = isVertical ? c : c + i;
                        const key = `${nr},${nc}`;
                        
                        // 检查是否与已放置船只重叠
                        if (occupied.has(key)) {
                            valid = false;
                            break;
                        }
                        
                        const state = this.viewGrid[nr][nc];
                        
                        // 不能穿越 miss 或已沉没的船
                        if (state === CellState.MISS || state === CellState.SUNK) {
                            valid = false;
                            break;
                        }
                        
                        cells.push({ r: nr, c: nc });
                        
                        if (state === CellState.HIT || state === CellState.DESTROYED) {
                            hitCount++;
                        }
                        if (state === CellState.SUSPECT) {
                            suspectCount++;
                        }
                    }
                    
                    if (valid) {
                        // 权重：命中点越多权重越高，疑似点也有加成
                        const weight = 1 + hitCount * 10 + suspectCount * 2;
                        validPlacements.push({ cells, weight, shipId: ship.id });
                    }
                }
            }
        }
        
        if (validPlacements.length === 0) {
            return null;
        }
        
        // 加权随机选择
        const totalWeight = validPlacements.reduce((sum, p) => sum + p.weight, 0);
        let rand = Math.random() * totalWeight;
        
        for (const placement of validPlacements) {
            rand -= placement.weight;
            if (rand <= 0) {
                return placement;
            }
        }
        
        return validPlacements[validPlacements.length - 1];
    }

    /**
     * 验证配置是否覆盖所有 mustHit 点
     */
    _validateMustHit(config) {
        const coveredHits = new Set();
        
        for (const placement of config) {
            for (const cell of placement.cells) {
                const state = this.viewGrid[cell.r][cell.c];
                if (state === CellState.HIT || state === CellState.DESTROYED) {
                    coveredHits.add(`${cell.r},${cell.c}`);
                }
            }
        }
        
        for (const hit of this.constraints.mustHit) {
            if (!coveredHits.has(`${hit.r},${hit.c}`)) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * 获取边缘概率分布（每格有船的概率）
     */
    getProbabilityGrid() {
        if (this._probabilityGrid) {
            return this._probabilityGrid;
        }
        
        const grid = Array(this.boardSize).fill(0)
            .map(() => Array(this.boardSize).fill(0));
        
        if (this.samples.length === 0) {
            return grid;
        }
        
        // 统计每个格子在采样中出现的频率
        for (const config of this.samples) {
            for (const placement of config) {
                for (const cell of placement.cells) {
                    grid[cell.r][cell.c]++;
                }
            }
        }
        
        // 归一化为概率
        const sampleCount = this.samples.length;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                grid[r][c] /= sampleCount;
            }
        }
        
        // 已命中点设为 1，无效点设为 0
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const state = this.viewGrid[r][c];
                if (state === CellState.HIT) {
                    grid[r][c] = 1;
                } else if (state === CellState.MISS || state === CellState.DESTROYED || state === CellState.SUNK) {
                    grid[r][c] = 0;
                }
            }
        }
        
        this._probabilityGrid = grid;
        return grid;
    }

    /**
     * 计算当前信息熵
     */
    getEntropy() {
        if (this._entropy !== null) {
            return this._entropy;
        }
        
        const probGrid = this.getProbabilityGrid();
        let entropy = 0;
        
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const state = this.viewGrid[r][c];
                // 只计算未确定的格子
                if (state === CellState.UNKNOWN || state === CellState.SUSPECT) {
                    const p = probGrid[r][c];
                    if (p > MIN_PROB && p < 1 - MIN_PROB) {
                        entropy -= p * Math.log2(p) + (1 - p) * Math.log2(1 - p);
                    }
                }
            }
        }
        
        this._entropy = entropy;
        return entropy;
    }

    /**
     * 计算执行某行动后的条件熵（近似）
     */
    getConditionalEntropy(action) {
        const { weapon, r, c } = action;
        const probGrid = this.getProbabilityGrid();
        
        if (weapon === 'SONAR') {
            return this._getSonarConditionalEntropy(r, c, probGrid);
        } else {
            // AP 和 HE 都是攻击类武器
            return this._getAttackConditionalEntropy(action, probGrid);
        }
    }

    /**
     * 声纳的条件熵计算
     * 声纳揭示 3x3 区域的信息
     */
    _getSonarConditionalEntropy(r, c, probGrid) {
        // 声纳结果分两种情况：有船 / 无船
        // 中心点概率
        const centerProb = (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize) 
            ? probGrid[r][c] : 0;
        
        // 计算 3x3 区域的总不确定性
        let areaEntropy = 0;
        let unknownCount = 0;
        
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                const nr = r + i;
                const nc = c + j;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize) {
                    const state = this.viewGrid[nr][nc];
                    if (state === CellState.UNKNOWN || state === CellState.SUSPECT) {
                        const p = probGrid[nr][nc];
                        if (p > MIN_PROB && p < 1 - MIN_PROB) {
                            areaEntropy += -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
                            unknownCount++;
                        }
                    }
                }
            }
        }
        
        if (unknownCount === 0) {
            return this.getEntropy(); // 无信息增益
        }
        
        // 简化模型：声纳成功时消除中心点的不确定性，失败时消除整个区域
        const currentEntropy = this.getEntropy();
        
        // 期望条件熵 = P(有船) * (当前熵 - 中心熵) + P(无船) * (当前熵 - 区域熵)
        const centerEntropy = this._cellEntropy(centerProb);
        
        const expectedEntropy = centerProb * (currentEntropy - centerEntropy) 
                        + (1 - centerProb) * (currentEntropy - areaEntropy);
        
        // 确保条件熵非负
        return Math.max(0, currentEntropy - Math.max(0, currentEntropy - expectedEntropy));
    }

    /**
     * 攻击类武器的条件熵计算
     */
    _getAttackConditionalEntropy(action, probGrid) {
        const { weapon, r, c } = action;
        const currentEntropy = this.getEntropy();
        
        // 获取攻击覆盖的格子
        const cells = this._getWeaponCoverage(weapon, r, c);
        
        // 计算这些格子的总熵
        let coveredEntropy = 0;
        for (const cell of cells) {
            if (cell.r >= 0 && cell.r < this.boardSize && 
                cell.c >= 0 && cell.c < this.boardSize) {
                const state = this.viewGrid[cell.r][cell.c];
                if (state === CellState.UNKNOWN || state === CellState.SUSPECT) {
                    const p = probGrid[cell.r][cell.c];
                    coveredEntropy += this._cellEntropy(p);
                }
            }
        }
        
        // 攻击后这些格子的状态将被揭示
        return Math.max(0, currentEntropy - coveredEntropy);
    }

    /**
     * 单格的二元熵
     */
    _cellEntropy(p) {
        if (p < MIN_PROB || p > 1 - MIN_PROB) return 0;
        return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
    }

    /**
     * 获取武器覆盖的格子
     * 使用武器类的 previewArea 方法，保持一致性
     */
    _getWeaponCoverage(weapon, r, c) {
        const instance = weaponInstances[weapon];
        if (instance) {
            return instance.previewArea({ r, c }).cells;
        }
        return [{ r, c }];
    }
}

// ============================================================================
// 行动评估
// ============================================================================

/**
 * 统一评估行动的效用值
 * 
 * utility = alpha * 归一化信息增益 + (1 - alpha) * 归一化期望伤害
 */
function evaluateAction(beliefState, action, abilities, alpha) {
    const { weapon, r, c } = action;
    const probGrid = beliefState.getProbabilityGrid();
    
    // 1. 计算信息增益
    const currentEntropy = beliefState.getEntropy();
    const conditionalEntropy = beliefState.getConditionalEntropy(action);
    const infoGain = Math.max(0, currentEntropy - conditionalEntropy);
    
    // 归一化信息增益（除以当前总熵）
    const normInfoGain = currentEntropy > MIN_PROB ? infoGain / currentEntropy : 0;
    
    // 2. 计算期望伤害
    const expectedDamage = calculateExpectedDamage(action, probGrid, abilities);
    
    // 归一化期望伤害（除以最大可能伤害）
    const maxDamage = weapon === 'HE' ? 5 : (weapon === 'AP' ? abilities.apDamage : 0);
    const normDamage = maxDamage > 0 ? expectedDamage / maxDamage : 0;
    
    // 3. 综合评分
    // 声纳不造成伤害，但信息价值高
    if (weapon === 'SONAR') {
        return alpha * normInfoGain;
    }
    
    return alpha * normInfoGain + (1 - alpha) * normDamage;
}

/**
 * 计算期望伤害
 */
function calculateExpectedDamage(action, probGrid, abilities) {
    const { weapon, r, c } = action;
    
    if (weapon === 'SONAR') {
        return 0; // 声纳不造成伤害
    }
    
    let expectedDamage = 0;
    const damage = weapon === 'AP' ? abilities.apDamage : 1;
    
    if (weapon === 'AP') {
        // 单点攻击
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
            expectedDamage = probGrid[r][c] * damage;
        }
    } else if (weapon === 'HE') {
        // X 型攻击
        const offsets = [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (const [dr, dc] of offsets) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                expectedDamage += probGrid[nr][nc] * 1; // HE 每格伤害 1
            }
        }
    }
    
    return expectedDamage;
}

// ============================================================================
// 行动枚举
// ============================================================================

/**
 * 枚举所有可用行动
 */
function enumerateAllActions(viewGrid, abilities) {
    const actions = [];
    
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const state = viewGrid[r][c];
            
            // 跳过已确定的无效点
            if (state === CellState.MISS || state === CellState.SUNK) {
                continue;
            }
            
            // 已摧毁的点也跳过（除非是 HE 可能覆盖到）
            if (state === CellState.DESTROYED) {
                // 只有 HE 的中心可以是已摧毁点（用于打击周围）
                if (abilities.canUseAir) {
                    actions.push({ weapon: 'HE', r, c });
                }
                continue;
            }
            
            // 主炮：始终可用
            actions.push({ weapon: 'AP', r, c });
            
            // 空袭：需要 CV 存活
            if (abilities.canUseAir) {
                actions.push({ weapon: 'HE', r, c });
            }
            
            // 声纳：需要 DD 存活，且优先扫描未知区域
            if (abilities.canUseSonar && (state === CellState.UNKNOWN || state === CellState.SUSPECT)) {
                actions.push({ weapon: 'SONAR', r, c });
            }
        }
    }
    
    return actions;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 检查 AI 可用的武器能力
 */
function checkAIAbilities(enemyShips) {
    const aiCV = enemyShips.some(s => s.code === 'CV' && !s.sunk);
    const aiCL = enemyShips.some(s => s.code === 'CL' && !s.sunk);
    const aiBB = enemyShips.some(s => s.code === 'BB' && !s.sunk);
    const aiSS = enemyShips.some(s => s.code === 'SS' && !s.sunk);
    const aiDD = enemyShips.some(s => s.code === 'DD' && !s.sunk);
    
    let aiAPDamage = 1;
    if (aiBB || aiSS) aiAPDamage = 3;
    else if (aiCL) aiAPDamage = 2;

    return {
        canUseAir: aiCV,
        canUseSonar: aiDD,
        apDamage: aiAPDamage
    };
}

/**
 * 随机决策（低难度或随机性触发）
 */
function makeRandomDecision(viewGrid, abilities) {
    let r, c;
    let attempts = 0;
    
    do {
        r = Math.floor(Math.random() * BOARD_SIZE);
        c = Math.floor(Math.random() * BOARD_SIZE);
        attempts++;
    } while ((viewGrid[r][c] === CellState.MISS || 
              viewGrid[r][c] === CellState.DESTROYED || 
              viewGrid[r][c] === CellState.SUNK) && attempts < 200);
    
    // 随机选择武器
    if (abilities.canUseAir && Math.random() < 0.1) {
        return { r, c, weapon: 'HE' };
    } else if (abilities.canUseSonar && Math.random() < 0.1) {
        return { r, c, weapon: 'SONAR' };
    }
    return { r, c, weapon: 'AP' };
}

/**
 * 兜底：找一个可攻击的点
 */
function findFallbackTarget(viewGrid) {
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const state = viewGrid[r][c];
            if (state !== CellState.MISS && state !== CellState.DESTROYED && state !== CellState.SUNK) {
                return { r, c, weapon: 'AP' };
            }
        }
    }
    // 实在找不到就返回 (0,0)
    return { r: 0, c: 0, weapon: 'AP' };
}

// ============================================================================
// 导出：供调试热力图使用（保持兼容）
// ============================================================================

/**
 * 计算概率热力图
 * 保持与原接口兼容，供 game.js 调试功能使用
 */
export function calculateProbabilityGrid(viewGrid, targets, difficultyConfig = null) {
    if (!targets || targets.length === 0) {
        return Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
    }
    
    const aliveTargets = targets.filter(s => !s.sunk);
    if (aliveTargets.length === 0) {
        return Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
    }
    
    const beliefState = new BeliefState(aliveTargets, viewGrid);
    return beliefState.getProbabilityGrid();
}
