/**
 * 模拟对战引擎 - 纯数据层实现
 * 
 * 用于在不涉及 DOM 的情况下进行完整的 AI vs AI 对战模拟。
 * 主要用于参数调优和策略测试。
 * 
 * ============================================================================
 * 导出接口
 * ============================================================================
 * 
 * - runSimulatedGame(configA, configB, options): 运行一场模拟对战
 * - SimulationEngine 类: 完整的模拟引擎封装
 */

import { BOARD_SIZE } from '../config/constants.js';
import { SHIP_TYPES } from '../data/ships.js';
import { deployShips } from './aiDeployment.js';
import { APWeapon } from '../game/weapons/APWeapon.js';
import { HEWeapon } from '../game/weapons/HEWeapon.js';
import { SonarWeapon } from '../game/weapons/SonarWeapon.js';

// ============================================================================
// 常量定义
// ============================================================================

/** 格子状态枚举（与 aiStrategy.js 保持一致） */
const CellState = {
    UNKNOWN: 0,
    MISS: 1,
    HIT: 2,
    DESTROYED: 3,
    SUSPECT: 4,
    SUNK: 5
};

/** 最大回合数限制（防止死循环） */
const MAX_TURNS = 200;

/** 蒙特卡洛采样数量（模拟时使用较小值以提高速度） */
const SAMPLE_COUNT = 200;

/** 最小概率阈值 */
const MIN_PROB = 1e-10;

// ============================================================================
// 武器实例（用于获取攻击范围）
// ============================================================================

const weaponInstances = {
    AP: new APWeapon(),
    HE: new HEWeapon(),
    SONAR: new SonarWeapon()
};

// ============================================================================
// 核心模拟引擎
// ============================================================================

/**
 * 模拟对战引擎类
 * 
 * 完全独立于 DOM，使用纯数据结构进行对战模拟
 */
export class SimulationEngine {
    /**
     * @param {Object} configA - A 方（先手）的 AI 配置 { alpha, randomness, riskAwareness }
     * @param {Object} configB - B 方（后手）的 AI 配置
     * @param {Object} options - 可选配置
     * @param {boolean} options.verbose - 是否输出详细日志
     * @param {number} options.maxTurns - 最大回合数
     */
    constructor(configA, configB, options = {}) {
        this.configA = { alpha: 0.5, randomness: 0, riskAwareness: 0, ...configA };
        this.configB = { alpha: 0.5, randomness: 0, riskAwareness: 0, ...configB };
        this.verbose = options.verbose || false;
        this.maxTurns = options.maxTurns || MAX_TURNS;
        
        // 初始化对战状态
        this.reset();
    }
    
    /**
     * 重置对战状态
     */
    reset() {
        // 部署双方船只
        this.shipsA = this._deployShips();
        this.shipsB = this._deployShips();
        
        // 初始化网格（存储船只位置和命中状态）
        this.gridA = this._createGrid(this.shipsA);  // A 方的船只所在网格
        this.gridB = this._createGrid(this.shipsB);  // B 方的船只所在网格
        
        // 初始化视图网格（对方视角，模拟战争迷雾）
        this.viewGridA = this._createViewGrid();  // A 看 B 的视图
        this.viewGridB = this._createViewGrid();  // B 看 A 的视图
        
        // 伤害记录（用于伤害溢出优化）
        this.damageGridA = this._createDamageGrid();  // A 对 B 造成的伤害
        this.damageGridB = this._createDamageGrid();  // B 对 A 造成的伤害
        
        // 对战统计
        this.stats = {
            turns: 0,
            hitsA: 0,
            hitsB: 0,
            damageA: 0,  // A 造成的总伤害
            damageB: 0,  // B 造成的总伤害
            winner: null
        };
    }
    
    /**
     * 运行一场完整对战
     * 
     * @returns {Object} 对战结果 { winner: 'A'|'B'|'DRAW', stats: {...} }
     */
    run() {
        let currentTurn = 'A';
        
        while (this.stats.turns < this.maxTurns) {
            this.stats.turns++;
            
            if (currentTurn === 'A') {
                // A 方行动
                this._executeTurn(
                    this.configA,
                    this.shipsA,
                    this.shipsB,
                    this.gridB,
                    this.viewGridA,
                    this.damageGridA,
                    'A'
                );
                
                // 检查 B 是否全灭
                if (this._isAllSunk(this.shipsB)) {
                    this.stats.winner = 'A';
                    break;
                }
                
                currentTurn = 'B';
            } else {
                // B 方行动
                this._executeTurn(
                    this.configB,
                    this.shipsB,
                    this.shipsA,
                    this.gridA,
                    this.viewGridB,
                    this.damageGridB,
                    'B'
                );
                
                // 检查 A 是否全灭
                if (this._isAllSunk(this.shipsA)) {
                    this.stats.winner = 'B';
                    break;
                }
                
                currentTurn = 'A';
            }
        }
        
        // 超时判定
        if (!this.stats.winner) {
            this.stats.winner = 'DRAW';
        }
        
        return {
            winner: this.stats.winner,
            stats: { ...this.stats }
        };
    }
    
    // ========================================================================
    // 私有方法：初始化
    // ========================================================================
    
    /**
     * 部署船只（使用现有的 AI 部署模块）
     */
    _deployShips() {
        const placements = deployShips(SHIP_TYPES, BOARD_SIZE);
        
        return placements.map((p, idx) => ({
            id: idx,
            name: p.name,
            code: p.code,
            len: p.len,
            maxHp: p.maxHp,
            hp: Array(p.len).fill(p.maxHp),
            r: p.r,
            c: p.c,
            v: p.v,
            vertical: p.v,
            sunk: false
        }));
    }
    
    /**
     * 创建网格（标记船只位置）
     */
    _createGrid(ships) {
        const grid = Array(BOARD_SIZE).fill(null).map(() => 
            Array(BOARD_SIZE).fill(null).map(() => ({
                hit: false,
                shipId: -1,
                segmentIndex: -1
            }))
        );
        
        for (const ship of ships) {
            for (let i = 0; i < ship.len; i++) {
                const r = ship.v ? ship.r + i : ship.r;
                const c = ship.v ? ship.c : ship.c + i;
                grid[r][c].shipId = ship.id;
                grid[r][c].segmentIndex = i;
            }
        }
        
        return grid;
    }
    
    /**
     * 创建视图网格（战争迷雾）
     */
    _createViewGrid() {
        return Array(BOARD_SIZE).fill(null).map(() => 
            Array(BOARD_SIZE).fill(CellState.UNKNOWN)
        );
    }
    
    /**
     * 创建伤害记录网格
     */
    _createDamageGrid() {
        return Array(BOARD_SIZE).fill(null).map(() => 
            Array(BOARD_SIZE).fill(0)
        );
    }
    
    // ========================================================================
    // 私有方法：回合执行
    // ========================================================================
    
    /**
     * 执行一个回合
     */
    _executeTurn(config, myShips, enemyShips, enemyGrid, viewGrid, damageGrid, side) {
        // 1. 获取可用能力
        const abilities = this._checkAbilities(myShips);
        
        // 2. 获取存活目标
        const aliveTargets = enemyShips.filter(s => !s.sunk);
        if (aliveTargets.length === 0) return;
        
        // 3. 随机决策检查
        if (Math.random() < config.randomness) {
            const action = this._makeRandomDecision(viewGrid, abilities);
            this._executeAction(action, abilities, enemyGrid, enemyShips, viewGrid, damageGrid, side);
            return;
        }
        
        // 4. 构建置信状态
        const beliefState = new SimBeliefState(aliveTargets, viewGrid, SAMPLE_COUNT);
        
        // 5. 枚举所有行动
        const actions = this._enumerateActions(viewGrid, abilities);
        if (actions.length === 0) {
            const fallback = this._findFallbackTarget(viewGrid);
            this._executeAction(fallback, abilities, enemyGrid, enemyShips, viewGrid, damageGrid, side);
            return;
        }
        
        // 6. 简化版风险计算（不做多步推演，提高速度）
        // 完整版可选择启用，但会显著降低模拟速度
        
        // 7. 评估所有行动
        let bestAction = null;
        let bestScore = -Infinity;
        const maxShipHp = Math.max(...aliveTargets.map(s => s.maxHp ?? 1));
        
        for (const action of actions) {
            const score = this._evaluateAction(
                beliefState, action, abilities, config.alpha, damageGrid, maxShipHp
            );
            
            if (score > bestScore + 1e-9) {
                bestScore = score;
                bestAction = action;
            } else if (Math.abs(score - bestScore) < 1e-9 && Math.random() < 0.3) {
                // 相同分数时有概率替换（增加随机性）
                bestAction = action;
            }
        }
        
        // 8. 执行最优行动
        this._executeAction(bestAction, abilities, enemyGrid, enemyShips, viewGrid, damageGrid, side);
    }
    
    /**
     * 检查 AI 可用能力
     */
    _checkAbilities(ships) {
        const aiCV = ships.some(s => s.code === 'CV' && !s.sunk);
        const aiCL = ships.some(s => s.code === 'CL' && !s.sunk);
        const aiBB = ships.some(s => s.code === 'BB' && !s.sunk);
        const aiSS = ships.some(s => s.code === 'SS' && !s.sunk);
        const aiDD = ships.some(s => s.code === 'DD' && !s.sunk);
        
        let apDamage = 1;
        if (aiBB) apDamage = 3;
        else if (aiSS || aiCL) apDamage = 2;
        
        return {
            canUseAir: aiCV,
            canUseSonar: aiDD || aiSS,
            apDamage
        };
    }
    
    /**
     * 枚举所有可用行动
     */
    _enumerateActions(viewGrid, abilities) {
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
                
                if (abilities.canUseSonar && 
                    (state === CellState.UNKNOWN || state === CellState.SUSPECT)) {
                    actions.push({ weapon: 'SONAR', r, c });
                }
            }
        }
        
        return actions;
    }
    
    /**
     * 评估行动效用（简化版）
     */
    _evaluateAction(beliefState, action, abilities, alpha, damageGrid, maxShipHp) {
        const { weapon, r, c } = action;
        const probGrid = beliefState.getProbabilityGrid();
        
        // 计算信息增益
        const currentEntropy = beliefState.getEntropy();
        const conditionalEntropy = beliefState.getConditionalEntropy(action);
        const infoGain = Math.max(0, currentEntropy - conditionalEntropy);
        const normInfoGain = currentEntropy > MIN_PROB ? infoGain / currentEntropy : 0;
        
        // 计算期望伤害
        const expectedDamage = this._calculateExpectedDamage(
            action, probGrid, abilities, damageGrid, maxShipHp
        );
        
        const maxDamage = weapon === 'HE' ? 5 : (weapon === 'AP' ? abilities.apDamage : 0);
        const normDamage = maxDamage > 0 ? expectedDamage / maxDamage : 0;
        
        if (weapon === 'SONAR') {
            return alpha * normInfoGain;
        }
        
        return alpha * normInfoGain + (1 - alpha) * normDamage;
    }
    
    /**
     * 计算期望伤害（考虑伤害溢出）
     */
    _calculateExpectedDamage(action, probGrid, abilities, damageGrid, maxShipHp) {
        const { weapon, r, c } = action;
        
        if (weapon === 'SONAR') return 0;
        
        let expectedDamage = 0;
        const baseDamage = weapon === 'AP' ? abilities.apDamage : 1;
        
        const cells = this._getWeaponCoverage(weapon, r, c);
        
        for (const cell of cells) {
            if (cell.r >= 0 && cell.r < BOARD_SIZE && cell.c >= 0 && cell.c < BOARD_SIZE) {
                const dealtDamage = damageGrid[cell.r][cell.c];
                const estimatedRemaining = Math.max(0, maxShipHp - dealtDamage);
                const effectiveDamage = Math.min(baseDamage, estimatedRemaining);
                expectedDamage += probGrid[cell.r][cell.c] * effectiveDamage;
            }
        }
        
        return expectedDamage;
    }
    
    /**
     * 获取武器覆盖范围
     */
    _getWeaponCoverage(weapon, r, c) {
        const instance = weaponInstances[weapon];
        if (instance) {
            return instance.previewArea({ r, c }).cells;
        }
        return [{ r, c }];
    }
    
    /**
     * 执行行动并更新状态
     */
    _executeAction(action, abilities, enemyGrid, enemyShips, viewGrid, damageGrid, side) {
        const { weapon, r, c } = action;
        
        if (weapon === 'SONAR') {
            // 声纳扫描
            this._executeSonar(r, c, enemyGrid, viewGrid);
        } else {
            // 攻击类武器
            const cells = this._getWeaponCoverage(weapon, r, c);
            const damage = weapon === 'AP' ? abilities.apDamage : 1;
            
            for (const cell of cells) {
                if (cell.r >= 0 && cell.r < BOARD_SIZE && cell.c >= 0 && cell.c < BOARD_SIZE) {
                    const result = this._resolveHit(cell.r, cell.c, damage, enemyGrid, enemyShips);
                    
                    // 更新视图
                    if (result.cellState) {
                        viewGrid[cell.r][cell.c] = result.cellState;
                    }
                    
                    // 更新伤害记录
                    damageGrid[cell.r][cell.c] += damage;
                    
                    // 更新统计
                    if (result.hit) {
                        if (side === 'A') {
                            this.stats.hitsA++;
                            this.stats.damageA += result.damage;
                        } else {
                            this.stats.hitsB++;
                            this.stats.damageB += result.damage;
                        }
                    }
                    
                    // 标记沉没船只
                    if (result.sunk) {
                        this._markSunkShip(result.ship, viewGrid);
                    }
                }
            }
        }
    }
    
    /**
     * 解析命中结果
     */
    _resolveHit(r, c, damage, grid, ships) {
        const cell = grid[r][c];
        
        if (cell.hit && cell.shipId === -1) {
            return { hit: false, cellState: null, damage: 0 };
        }
        
        cell.hit = true;
        
        if (cell.shipId !== -1) {
            const ship = ships[cell.shipId];
            const segIdx = cell.segmentIndex;
            
            if (ship.hp[segIdx] <= 0) {
                return { hit: true, cellState: CellState.DESTROYED, damage: 0, ship };
            }
            
            const actualDamage = Math.min(damage, ship.hp[segIdx]);
            ship.hp[segIdx] -= damage;
            
            const cellState = ship.hp[segIdx] <= 0 ? CellState.DESTROYED : CellState.HIT;
            const isSunk = ship.hp.every(h => h <= 0) && !ship.sunk;
            
            if (isSunk) {
                ship.sunk = true;
            }
            
            return { hit: true, cellState, damage: actualDamage, sunk: isSunk, ship };
        } else {
            return { hit: false, cellState: CellState.MISS, damage: 0 };
        }
    }
    
    /**
     * 执行声纳扫描
     */
    _executeSonar(r, c, enemyGrid, viewGrid) {
        let detected = false;
        
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const nr = r + dr;
                const nc = c + dc;
                
                if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                    if (enemyGrid[nr][nc].shipId !== -1 && viewGrid[nr][nc] === CellState.UNKNOWN) {
                        detected = true;
                        break;
                    }
                }
            }
            if (detected) break;
        }
        
        if (detected && viewGrid[r][c] === CellState.UNKNOWN) {
            viewGrid[r][c] = CellState.SUSPECT;
        } else if (!detected) {
            // 标记周围区域为安全
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                        if (viewGrid[nr][nc] === CellState.UNKNOWN) {
                            viewGrid[nr][nc] = CellState.MISS;
                        }
                    }
                }
            }
        }
    }
    
    /**
     * 标记沉没船只
     */
    _markSunkShip(ship, viewGrid) {
        for (let i = 0; i < ship.len; i++) {
            const r = ship.v ? ship.r + i : ship.r;
            const c = ship.v ? ship.c : ship.c + i;
            viewGrid[r][c] = CellState.SUNK;
        }
    }
    
    /**
     * 随机决策
     */
    _makeRandomDecision(viewGrid, abilities) {
        let r, c;
        let attempts = 0;
        
        do {
            r = Math.floor(Math.random() * BOARD_SIZE);
            c = Math.floor(Math.random() * BOARD_SIZE);
            attempts++;
        } while ((viewGrid[r][c] === CellState.MISS || 
                  viewGrid[r][c] === CellState.DESTROYED || 
                  viewGrid[r][c] === CellState.SUNK) && attempts < 200);
        
        if (abilities.canUseAir && Math.random() < 0.1) {
            return { r, c, weapon: 'HE' };
        } else if (abilities.canUseSonar && Math.random() < 0.1) {
            return { r, c, weapon: 'SONAR' };
        }
        return { r, c, weapon: 'AP' };
    }
    
    /**
     * 兜底目标
     */
    _findFallbackTarget(viewGrid) {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const state = viewGrid[r][c];
                if (state !== CellState.MISS && state !== CellState.DESTROYED && state !== CellState.SUNK) {
                    return { r, c, weapon: 'AP' };
                }
            }
        }
        return { r: 0, c: 0, weapon: 'AP' };
    }
    
    /**
     * 检查是否全部沉没
     */
    _isAllSunk(ships) {
        return ships.every(s => s.sunk);
    }
}

// ============================================================================
// 简化版置信状态（用于模拟）
// ============================================================================

/**
 * 模拟用置信状态类
 * 
 * 与 aiStrategy.js 中的 BeliefState 类似，但针对模拟场景优化
 */
class SimBeliefState {
    constructor(ships, viewGrid, sampleCount = SAMPLE_COUNT) {
        this.ships = ships;
        this.viewGrid = viewGrid;
        this.boardSize = BOARD_SIZE;
        
        this.constraints = this._buildConstraints();
        this.samples = this._sampleConfigurations(sampleCount);
        
        this._probabilityGrid = null;
        this._entropy = null;
    }
    
    _buildConstraints() {
        const mustHit = [];
        const mustAvoid = [];
        const suspect = [];
        
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
    
    _sampleConfigurations(n) {
        const samples = [];
        let attempts = 0;
        const maxAttempts = n * 20;
        
        while (samples.length < n && attempts < maxAttempts) {
            attempts++;
            const config = this._sampleOneConfiguration();
            if (config) samples.push(config);
        }
        
        while (samples.length < n && samples.length > 0) {
            samples.push(samples[Math.floor(Math.random() * samples.length)]);
        }
        
        return samples;
    }
    
    _sampleOneConfiguration() {
        const occupied = new Set();
        const config = [];
        
        const sortedShips = [...this.ships].sort((a, b) => b.len - a.len);
        
        for (const ship of sortedShips) {
            const placement = this._sampleShipPlacement(ship, occupied);
            if (!placement) return null;
            config.push(placement);
            placement.cells.forEach(cell => occupied.add(`${cell.r},${cell.c}`));
        }
        
        if (!this._validateMustHit(config)) return null;
        
        return config;
    }
    
    _sampleShipPlacement(ship, occupied) {
        const validPlacements = [];
        
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
                        
                        if (occupied.has(key)) { valid = false; break; }
                        
                        const state = this.viewGrid[nr][nc];
                        if (state === CellState.MISS || state === CellState.SUNK) {
                            valid = false; break;
                        }
                        
                        cells.push({ r: nr, c: nc });
                        
                        if (state === CellState.HIT || state === CellState.DESTROYED) hitCount++;
                        if (state === CellState.SUSPECT) suspectCount++;
                    }
                    
                    if (valid) {
                        const weight = 1 + hitCount * 10 + suspectCount * 2;
                        validPlacements.push({ cells, weight, shipId: ship.id });
                    }
                }
            }
        }
        
        if (validPlacements.length === 0) return null;
        
        const totalWeight = validPlacements.reduce((sum, p) => sum + p.weight, 0);
        let rand = Math.random() * totalWeight;
        
        for (const placement of validPlacements) {
            rand -= placement.weight;
            if (rand <= 0) return placement;
        }
        
        return validPlacements[validPlacements.length - 1];
    }
    
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
            if (!coveredHits.has(`${hit.r},${hit.c}`)) return false;
        }
        
        return true;
    }
    
    getProbabilityGrid() {
        if (this._probabilityGrid) return this._probabilityGrid;
        
        const grid = Array(this.boardSize).fill(0).map(() => Array(this.boardSize).fill(0));
        
        if (this.samples.length === 0) return grid;
        
        for (const config of this.samples) {
            for (const placement of config) {
                for (const cell of placement.cells) {
                    grid[cell.r][cell.c]++;
                }
            }
        }
        
        const sampleCount = this.samples.length;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                grid[r][c] /= sampleCount;
            }
        }
        
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const state = this.viewGrid[r][c];
                if (state === CellState.HIT) grid[r][c] = 1;
                else if (state === CellState.MISS || state === CellState.DESTROYED || state === CellState.SUNK) {
                    grid[r][c] = 0;
                }
            }
        }
        
        this._probabilityGrid = grid;
        return grid;
    }
    
    getEntropy() {
        if (this._entropy !== null) return this._entropy;
        
        const probGrid = this.getProbabilityGrid();
        let entropy = 0;
        
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const state = this.viewGrid[r][c];
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
    
    getConditionalEntropy(action) {
        const { weapon, r, c } = action;
        const probGrid = this.getProbabilityGrid();
        const currentEntropy = this.getEntropy();
        
        if (weapon === 'SONAR') {
            const centerProb = (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize) 
                ? probGrid[r][c] : 0;
            
            let areaEntropy = 0;
            for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                    const nr = r + i, nc = c + j;
                    if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize) {
                        const state = this.viewGrid[nr][nc];
                        if (state === CellState.UNKNOWN || state === CellState.SUSPECT) {
                            const p = probGrid[nr][nc];
                            if (p > MIN_PROB && p < 1 - MIN_PROB) {
                                areaEntropy += -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
                            }
                        }
                    }
                }
            }
            
            const centerEntropy = this._cellEntropy(centerProb);
            const expectedEntropy = centerProb * (currentEntropy - centerEntropy) 
                + (1 - centerProb) * (currentEntropy - areaEntropy);
            
            return Math.max(0, currentEntropy - Math.max(0, currentEntropy - expectedEntropy));
        } else {
            const cells = this._getWeaponCoverage(weapon, r, c);
            let coveredEntropy = 0;
            
            for (const cell of cells) {
                if (cell.r >= 0 && cell.r < this.boardSize && cell.c >= 0 && cell.c < this.boardSize) {
                    const state = this.viewGrid[cell.r][cell.c];
                    if (state === CellState.UNKNOWN || state === CellState.SUSPECT) {
                        const p = probGrid[cell.r][cell.c];
                        coveredEntropy += this._cellEntropy(p);
                    }
                }
            }
            
            return Math.max(0, currentEntropy - coveredEntropy);
        }
    }
    
    _cellEntropy(p) {
        if (p < MIN_PROB || p > 1 - MIN_PROB) return 0;
        return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
    }
    
    _getWeaponCoverage(weapon, r, c) {
        const instance = weaponInstances[weapon];
        if (instance) return instance.previewArea({ r, c }).cells;
        return [{ r, c }];
    }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 运行单场模拟对战
 * 
 * @param {Object} configA - A 方配置 { alpha, randomness, riskAwareness }
 * @param {Object} configB - B 方配置
 * @param {Object} options - 可选配置
 * @returns {Object} 对战结果
 */
export function runSimulatedGame(configA, configB, options = {}) {
    const engine = new SimulationEngine(configA, configB, options);
    return engine.run();
}

/**
 * 批量运行模拟对战
 * 
 * @param {Object} configA - A 方配置
 * @param {Object} configB - B 方配置
 * @param {number} count - 对战次数
 * @param {Object} options - 可选配置
 * @returns {Object} 统计结果 { winsA, winsB, draws, avgTurns, winRateA }
 */
export function runSimulationBatch(configA, configB, count, options = {}) {
    let winsA = 0, winsB = 0, draws = 0;
    let totalTurns = 0;
    
    for (let i = 0; i < count; i++) {
        const result = runSimulatedGame(configA, configB, options);
        
        if (result.winner === 'A') winsA++;
        else if (result.winner === 'B') winsB++;
        else draws++;
        
        totalTurns += result.stats.turns;
    }
    
    return {
        winsA,
        winsB,
        draws,
        avgTurns: totalTurns / count,
        winRateA: winsA / count
    };
}

/**
 * 运行单场模拟对战（带进度回调，支持让出主线程）
 * 
 * 用于网格搜索时显示模拟进度，每隔若干步让出主线程以更新 UI
 * 
 * @param {Object} configA - A 方配置 { alpha, randomness, riskAwareness }
 * @param {Object} configB - B 方配置
 * @param {Object} options - 可选配置
 * @param {Function} options.onTurn - 每回合回调 (turnNumber) => void
 * @param {number} options.yieldInterval - 每隔多少回合让出主线程（默认10）
 * @returns {Promise<Object>} 对战结果
 */
export async function runSimulatedGameWithProgress(configA, configB, options = {}) {
    const { onTurn, yieldInterval = 10 } = options;
    
    // 创建引擎但不直接运行，而是手动控制循环
    const engine = new SimulationEngine(configA, configB, options);
    
    let currentTurn = 'A';
    
    while (engine.stats.turns < engine.maxTurns) {
        engine.stats.turns++;
        
        // 回调当前回合数
        if (onTurn) {
            onTurn(engine.stats.turns);
        }
        
        if (currentTurn === 'A') {
            // A 方行动
            engine._executeTurn(
                engine.configA,
                engine.shipsA,
                engine.shipsB,
                engine.gridB,
                engine.viewGridA,
                engine.damageGridA,
                'A'
            );
            
            // 检查 B 是否全灭
            if (engine._isAllSunk(engine.shipsB)) {
                engine.stats.winner = 'A';
                break;
            }
            
            currentTurn = 'B';
        } else {
            // B 方行动
            engine._executeTurn(
                engine.configB,
                engine.shipsB,
                engine.shipsA,
                engine.gridA,
                engine.viewGridB,
                engine.damageGridB,
                'B'
            );
            
            // 检查 A 是否全灭
            if (engine._isAllSunk(engine.shipsA)) {
                engine.stats.winner = 'B';
                break;
            }
            
            currentTurn = 'A';
        }
        
        // 每隔 yieldInterval 回合让出主线程
        if (engine.stats.turns % yieldInterval === 0) {
            await new Promise(resolve => {
                if (typeof requestAnimationFrame !== 'undefined') {
                    requestAnimationFrame(() => setTimeout(resolve, 0));
                } else {
                    setTimeout(resolve, 0);
                }
            });
        }
    }
    
    // 超时判定
    if (!engine.stats.winner) {
        engine.stats.winner = 'DRAW';
    }
    
    return {
        winner: engine.stats.winner,
        stats: { ...engine.stats }
    };
}
