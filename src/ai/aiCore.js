/**
 * AI 核心模块 - 纯数据层实现
 * 
 * 提取 AI 决策的核心逻辑，供 aiStrategy（实战）和 SimulationEngine（模拟）共享
 * 这样避免了在两个模块中维护重复代码
 * 
 * ============================================================================
 * 导出内容
 * ============================================================================
 * 
 * 【类】
 * - BeliefState: 置信状态管理（蒙特卡洛采样）
 * 
 * 【函数】
 * - checkAIAbilities: 检查 AI 可用的武器能力
 * - enumerateAllActions: 枚举所有可用行动
 * - evaluateAction: 统一评估行动效用值
 * - calculateExpectedDamage: 计算期望有效伤害
 * - makeRandomDecision: 随机决策（低难度或随机性触发）
 * - findFallbackTarget: 兜底目标查找
 * 
 * 【常量】
 * - CellState: 格子状态枚举
 * - MIN_PROB: 最小概率阈值
 */

import { BOARD_SIZE } from '../config/constants.js';
import { APWeapon } from '../game/weapons/APWeapon.js';
import { HEWeapon } from '../game/weapons/HEWeapon.js';
import { SonarWeapon } from '../game/weapons/SonarWeapon.js';

// ============================================================================
// 常量定义
// ============================================================================

/** 格子状态枚举 */
export const CellState = {
    UNKNOWN: 0,     // 未知（战争迷雾）
    MISS: 1,        // 未命中
    HIT: 2,         // 命中但未摧毁
    DESTROYED: 3,   // 已摧毁
    SUSPECT: 4,     // 疑似（声纳标记）
    SUNK: 5         // 已沉没船只占位
};

/** 最小概率阈值，防止数值问题 */
export const MIN_PROB = 1e-10;

/** 默认蒙特卡洛采样数量 */
export const DEFAULT_SAMPLE_COUNT = 700;

// 创建武器实例用于获取范围
const weaponInstances = {
    AP: new APWeapon(),
    HE: new HEWeapon(),
    SONAR: new SonarWeapon()
};

// ============================================================================
// 置信状态管理（蒙特卡洛采样）
// ============================================================================

/**
 * 置信状态类：维护对敌舰配置的概率分布
 * 
 * 核心思想：通过蒙特卡洛采样近似所有可行配置的分布
 */
export class BeliefState {
    /**
     * @param {Ship[]} ships - 目标船只
     * @param {number[][]} viewGrid - 视角网格
     * @param {number} [sampleCount=DEFAULT_SAMPLE_COUNT] - 采样数量
     */
    constructor(ships, viewGrid, sampleCount = DEFAULT_SAMPLE_COUNT) {
        this.ships = ships;
        this.viewGrid = viewGrid;
        this.boardSize = BOARD_SIZE;
        
        // 预计算约束信息
        this.constraints = this._buildConstraints();
        
        // 检查是否为空盘面（第一回合）
        this.isFirstTurn = this._checkIfFirstTurn();

        // 蒙特卡洛采样（使用传入的采样数）
        // 如果是第一回合，跳过采样以保持概率图完全平均
        if (this.isFirstTurn) {
            this.samples = [];
        } else {
            this.samples = this._sampleConfigurations(sampleCount);
        }
        
        // 缓存边缘概率分布
        this._probabilityGrid = null;
        this._entropy = null;
    }

    /**
     * 检查是否为第一回合（无任何探测记录）
     */
    _checkIfFirstTurn() {
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.viewGrid[r][c] !== CellState.UNKNOWN) {
                    return false;
                }
            }
        }
        return true;
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
                        const weight = 1 + hitCount * 10 + suspectCount * 6;
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
        
        // 特殊处理第一回合：返回完全平均的概率
        if (this.isFirstTurn) {
            const totalShipCells = this.ships.reduce((sum, s) => sum + s.len, 0);
            const totalCells = this.boardSize * this.boardSize;
            const avgProb = totalCells > 0 ? totalShipCells / totalCells : 0;
            
            const grid = Array(this.boardSize).fill(0).map(() => Array(this.boardSize).fill(avgProb));
            this._probabilityGrid = grid;
            return grid;
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
 * 
 * @param {BeliefState} beliefState - 置信状态
 * @param {Object} action - 行动 { weapon, r, c }
 * @param {Object} abilities - 能力 { canUseAir, canUseSonar, apDamage }
 * @param {number} alpha - 探索权重 [0, 1]
 * @param {number[][]} [damageGrid] - 已造成伤害记录（可选）
 * @param {number} [maxShipHp] - 最大船只血量（用于伤害溢出计算，可选）
 * @returns {number} 效用值 [0, 1]
 */
export function evaluateAction(beliefState, action, abilities, alpha, damageGrid = null, maxShipHp = null) {
    const { weapon, r, c } = action;
    const probGrid = beliefState.getProbabilityGrid();
    
    // 1. 计算信息增益
    const currentEntropy = beliefState.getEntropy();
    const conditionalEntropy = beliefState.getConditionalEntropy(action);
    const infoGain = Math.max(0, currentEntropy - conditionalEntropy);
    
    // 归一化信息增益（除以当前总熵）
    const normInfoGain = currentEntropy > MIN_PROB ? infoGain / currentEntropy : 0;
    
    // 2. 计算期望伤害
    // 如果未提供 maxShipHp，从 beliefState 中获取
    const effectiveMaxHp = maxShipHp ?? Math.max(...beliefState.ships.map(s => s.maxHp ?? 1));
    const expectedDamage = calculateExpectedDamage(action, probGrid, abilities, damageGrid, effectiveMaxHp);
    
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
 * 计算期望有效伤害
 * 
 * 考虑伤害溢出：已造成的伤害会减少后续攻击的有效伤害
 * 有效伤害 = min(武器伤害, 估计剩余血量)
 * 估计剩余血量 = max(0, 最大可能血量 - 已造成伤害)
 * 
 * 注意：AI 不知道格子的真实血量（信息对等原则），
 * 只能基于已知的「我打了多少」来估计「还能打多少」
 * 
 * @param {Object} action - 攻击行动
 * @param {Array<Array<number>>} probGrid - 概率网格
 * @param {Object} abilities - AI 能力
 * @param {Array<Array<number>>} [damageGrid] - 已造成伤害记录（可选）
 * @param {number} maxShipHp - 当前存活船只的最大血量
 * @returns {number} 期望有效伤害
 */
export function calculateExpectedDamage(action, probGrid, abilities, damageGrid = null, maxShipHp) {
    const { weapon, r, c } = action;
    
    if (weapon === 'SONAR') {
        return 0; // 声纳不造成伤害
    }
    
    let expectedDamage = 0;
    const baseDamage = weapon === 'AP' ? abilities.apDamage : 1;
    
    if (weapon === 'AP') {
        // 单点攻击
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
            const effectiveDamage = getEffectiveDamage(r, c, baseDamage, damageGrid, maxShipHp);
            expectedDamage = probGrid[r][c] * effectiveDamage;
        }
    } else if (weapon === 'HE') {
        // X 型攻击
        const offsets = [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (const [dr, dc] of offsets) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                const effectiveDamage = getEffectiveDamage(nr, nc, 1, damageGrid, maxShipHp);
                expectedDamage += probGrid[nr][nc] * effectiveDamage;
            }
        }
    }
    
    return expectedDamage;
}

/**
 * 计算单格的有效伤害
 * 
 * @param {number} r - 行坐标
 * @param {number} c - 列坐标  
 * @param {number} weaponDamage - 武器基础伤害
 * @param {Array<Array<number>>} [damageGrid] - 已造成伤害记录（可选）
 * @param {number} maxShipHp - 当前存活船只的最大血量
 * @returns {number} 有效伤害（考虑伤害溢出后）
 */
function getEffectiveDamage(r, c, weaponDamage, damageGrid, maxShipHp) {
    if (!damageGrid) {
        // 无伤害记录，返回完整伤害
        return weaponDamage;
    }
    
    const dealtDamage = damageGrid[r][c];
    
    // 估计剩余血量：当前存活船只的最大血量 - 已造成伤害
    const estimatedRemainingHP = Math.max(0, maxShipHp - dealtDamage);
    
    // 有效伤害不超过估计剩余血量
    return Math.min(weaponDamage, estimatedRemainingHP);
}

// ============================================================================
// 能力检查
// ============================================================================

/**
 * 检查 AI 可用的武器能力
 * 
 * @param {Ship[]} ships - 舰船列表
 * @returns {Object} { canUseAir: boolean, canUseSonar: boolean, apDamage: number }
 */
export function checkAIAbilities(ships) {
    const aiCV = ships.some(s => s.code === 'CV' && !s.sunk);
    const aiCL = ships.some(s => s.code === 'CL' && !s.sunk);
    const aiBB = ships.some(s => s.code === 'BB' && !s.sunk);
    const aiSS = ships.some(s => s.code === 'SS' && !s.sunk);
    const aiDD = ships.some(s => s.code === 'DD' && !s.sunk);
    
    let aiAPDamage = 1;
    if (aiBB) aiAPDamage = 3;
    else if (aiSS || aiCL) aiAPDamage = 2;

    return {
        canUseAir: aiCV,
        canUseSonar: aiDD || aiSS,
        apDamage: aiAPDamage
    };
}

// ============================================================================
// 行动枚举
// ============================================================================

/**
 * 枚举所有可用行动
 * 
 * @param {number[][]} viewGrid - 视角网格
 * @param {Object} abilities - 能力状态
 * @returns {Array<{weapon: string, r: number, c: number}>} 行动列表
 */
export function enumerateAllActions(viewGrid, abilities) {
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
// 风险评估模块（对称推演）
// ============================================================================

/** 对称推演采样数量（较小以平衡多步开销） */
const OPPONENT_SAMPLE_COUNT = 25;

/** 向前推演步数 */
const LOOKAHEAD_STEPS = 5;

/**
 * 获取武器覆盖范围
 * 
 * @param {string} weapon - 武器类型 'AP' | 'HE' | 'SONAR'
 * @param {number} r - 中心行
 * @param {number} c - 中心列
 * @returns {{ r: number, c: number }[]} 覆盖的格子数组
 */
function getWeaponCoverage(weapon, r, c) {
    const instance = weaponInstances[weapon];
    if (instance) {
        return instance.previewArea({ r, c }).cells;
    }
    return [{ r, c }];
}

/**
 * 获取船只占用的格子
 * 
 * @param {Object} ship - 船只对象
 * @returns {{ r: number, c: number }[]} 船只占用的格子数组
 */
function getShipCells(ship) {
    const cells = [];
    const isVertical = ship.v ?? ship.vertical ?? false;
    for (let i = 0; i < ship.len; i++) {
        cells.push({
            r: isVertical ? ship.r + i : ship.r,
            c: isVertical ? ship.c : ship.c + i
        });
    }
    return cells;
}

/**
 * 多步推演：估算 k 步内各船的累积威胁
 * 
 * 每一步都进行完整的推演：
 * 1. 重新构建置信状态（采样）
 * 2. 评估所有行动
 * 3. 选择最优行动
 * 4. 更新模拟状态
 * 
 * @param {number[][]} opponentViewGrid - 对手视角的我方棋盘
 * @param {Ship[]} myShips - 我方船只（真实位置）
 * @param {Ship[]} opponentShips - 对手船只（用于判断对手能力）
 * @param {number} alpha - 探索权重
 * @param {number} [steps=LOOKAHEAD_STEPS] - 推演步数
 * @returns {Map<string, { totalExpectedDamage: number, sinkProbability: number, remainingHp: number }>}
 * @export
 */
export function simulateMultiStepThreats(opponentViewGrid, myShips, opponentShips, alpha, steps = LOOKAHEAD_STEPS) {
    const opponentAbilities = checkAIAbilities(opponentShips);
    const aliveTargets = myShips.filter(s => !s.sunk);
    if (aliveTargets.length === 0) return new Map();
    
    // 初始化每艘船的累积威胁
    const threats = new Map();
    for (const ship of aliveTargets) {
        const currentHp = Array.isArray(ship.hp) 
            ? ship.hp.reduce((a, b) => a + b, 0) 
            : (ship.hp ?? ship.len);
        threats.set(ship.id, {
            totalExpectedDamage: 0,
            remainingHp: currentHp
        });
    }
    
    // 模拟状态（会随推演更新）
    let simViewGrid = opponentViewGrid.map(row => [...row]);
    
    for (let step = 0; step < steps; step++) {
        // 【每步都完整推演】构建对手置信状态
        const opponentBelief = new BeliefState(aliveTargets, simViewGrid, OPPONENT_SAMPLE_COUNT);
        const probGrid = opponentBelief.getProbabilityGrid();
        
        // 枚举对手可用行动
        const actions = enumerateAllActions(simViewGrid, opponentAbilities);
        if (actions.length === 0) break;
        
        // 【完整评估】用 evaluateAction
        let bestAction = null;
        let bestScore = -Infinity;
        
        for (const action of actions) {
            // 对称推演中不需要伤害记录，传 null 即可
            const score = evaluateAction(opponentBelief, action, opponentAbilities, alpha, null, null);
            if (score > bestScore) {
                bestScore = score;
                bestAction = action;
            }
        }
        
        if (!bestAction) break;
        
        // 累积该攻击对各船的威胁
        accumulateThreat(bestAction, probGrid, opponentAbilities, myShips, threats);
        
        // 更新模拟状态
        updateSimulatedState(simViewGrid, bestAction, opponentAbilities, probGrid);
    }
    
    // 计算沉没概率
    for (const [shipId, threat] of threats) {
        const ship = myShips.find(s => s.id === shipId);
        if (ship) {
            const currentHp = Array.isArray(ship.hp) 
                ? ship.hp.reduce((a, b) => a + b, 0) 
                : (ship.hp ?? ship.len);
            threat.sinkProbability = Math.min(1, threat.totalExpectedDamage / Math.max(1, currentHp));
        }
    }
    
    return threats;
}

/**
 * 累积攻击对各船的威胁
 * 
 * @param {Object} action - 攻击行动 { weapon, r, c }
 * @param {number[][]} probGrid - 概率网格
 * @param {Object} abilities - 攻击方能力
 * @param {Ship[]} targetShips - 被攻击方的船只
 * @param {Map} threats - 威胁累积 Map
 */
function accumulateThreat(action, probGrid, abilities, targetShips, threats) {
    const { weapon, r, c } = action;
    
    // 声纳不造成伤害
    if (weapon === 'SONAR') return;
    
    const cells = getWeaponCoverage(weapon, r, c);
    const dmg = weapon === 'AP' ? abilities.apDamage : 1;
    
    for (const cell of cells) {
        if (cell.r < 0 || cell.r >= BOARD_SIZE || cell.c < 0 || cell.c >= BOARD_SIZE) continue;
        
        // 找出该格子属于哪艘船（我方知道自己船的真实位置）
        for (const ship of targetShips) {
            if (ship.sunk) continue;
            const shipCells = getShipCells(ship);
            const isOnShip = shipCells.some(sc => sc.r === cell.r && sc.c === cell.c);
            
            if (isOnShip) {
                const threat = threats.get(ship.id);
                if (threat) {
                    // 期望伤害 = 对手攻击该格的概率 × 伤害
                    threat.totalExpectedDamage += probGrid[cell.r][cell.c] * dmg;
                }
            }
        }
    }
}

/**
 * 更新模拟状态
 * 根据攻击结果更新视角网格，使后续步骤的采样更准确
 * 
 * @param {number[][]} simViewGrid - 模拟视角网格（会被修改）
 * @param {Object} action - 攻击行动
 * @param {Object} abilities - 攻击方能力
 * @param {number[][]} probGrid - 概率网格
 */
function updateSimulatedState(simViewGrid, action, abilities, probGrid) {
    const { weapon, r, c } = action;
    const cells = getWeaponCoverage(weapon, r, c);
    
    for (const cell of cells) {
        if (cell.r >= 0 && cell.r < BOARD_SIZE && cell.c >= 0 && cell.c < BOARD_SIZE) {
            // 只更新未知或疑似的格子
            if (simViewGrid[cell.r][cell.c] === CellState.UNKNOWN || 
                simViewGrid[cell.r][cell.c] === CellState.SUSPECT) {
                // 根据概率决定模拟结果（简化：高概率格子视为命中）
                if (probGrid[cell.r][cell.c] > 0.5) {
                    simViewGrid[cell.r][cell.c] = CellState.HIT;
                } else {
                    simViewGrid[cell.r][cell.c] = CellState.MISS;
                }
            }
        }
    }
}

/**
 * 判断给定能力下某行动是否可用
 * 
 * @param {Object} action - 行动 { weapon, r, c }
 * @param {Object} abilities - 能力状态
 * @returns {boolean} 该行动是否可用
 */
function isActionAvailable(action, abilities) {
    if (action.weapon === 'HE') return abilities.canUseAir;
    if (action.weapon === 'SONAR') return abilities.canUseSonar;
    return true; // AP 始终可用
}

/**
 * 模拟某船沉没后的能力
 * 
 * @param {Ship[]} ships - 当前船只列表
 * @param {Object} lostShip - 假设沉没的船
 * @returns {Object} 沉没后的能力
 */
function simulateAbilitiesAfterLoss(ships, lostShip) {
    const remaining = ships.filter(s => s.id !== lostShip.id && !s.sunk);
    return checkAIAbilities(remaining);
}

/**
 * 计算归一化的风险加成（统一版）
 * 
 * 基于边际效用损失理论，用 evaluateAction 统一计算能力价值
 * - 不再使用启发式的 calculateAbilityLoss
 * - 不再需要硬编码的 checkUsesEndangeredAbility
 * - 风险加成 = Σ(沉没概率 × 效用损失) / 高威胁船只数
 * 
 * @param {Object} action - 当前评估的行动
 * @param {Map} shipThreats - 各船的威胁信息 Map<shipId, {sinkProbability, ...}>
 * @param {BeliefState} beliefState - 置信状态
 * @param {Object} abilities - 当前能力
 * @param {Ship[]} myShips - 我方船只列表
 * @param {number} alpha - 探索权重
 * @returns {number} 归一化风险加成 ∈ [0, 1]
 * @export
 */
export function calculateRiskBonus(action, shipThreats, beliefState, abilities, myShips, alpha) {
    let totalBonus = 0;
    let highThreatCount = 0;
    
    for (const ship of myShips) {
        if (ship.sunk) continue;
        
        const threat = shipThreats.get(ship.id);
        if (!threat || threat.sinkProbability < 0.2) continue;
        
        highThreatCount++;
        
        // 模拟该船沉没后的能力
        const afterAbilities = simulateAbilitiesAfterLoss(myShips, ship);
        
        // 计算该行动在能力降级后的效用损失
        // 这里使用 evaluateAction，不传伤害记录（风险计算不需要）
        const currentUtility = evaluateAction(beliefState, action, abilities, alpha, null, null);
        const reducedUtility = evaluateAction(beliefState, action, afterAbilities, alpha, null, null);
        const utilityLoss = Math.max(0, currentUtility - reducedUtility);
        
        // 风险加成 = 沉没概率 × 效用损失
        totalBonus += threat.sinkProbability * utilityLoss;
    }
    
    // 归一化到 [0, 1]
    return highThreatCount > 0 ? totalBonus / highThreatCount : 0;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 随机决策（低难度或随机性触发）
 * 
 * @param {number[][]} viewGrid - 视角网格
 * @param {Object} abilities - 能力状态
 * @returns {{r: number, c: number, weapon: string}} 随机行动
 */
export function makeRandomDecision(viewGrid, abilities) {
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
 * 
 * @param {number[][]} viewGrid - 视角网格
 * @returns {{r: number, c: number, weapon: string}} 兜底行动
 */
export function findFallbackTarget(viewGrid) {
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
