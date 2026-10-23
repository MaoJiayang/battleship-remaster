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
// 导入共享的核心模块
import {
    BeliefState,
    CellState,
    checkAIAbilities,
    enumerateAllActions,
    evaluateAction,
    makeRandomDecision,
    findFallbackTarget,
    simulateMultiStepThreats,
    calculateRiskBonus,
    getActionCoverage,
    DEFAULT_OPPONENT_SAMPLE_COUNT,
    DEFAULT_LOOKAHEAD_STEPS
} from './aiCore.js';

// ============================================================================
// 常量定义
// ============================================================================

/** 最大回合数限制（防止死循环） */
const MAX_TURNS = 70;

/** 蒙特卡洛采样数量（模拟时使用较小值以提高速度） */
const SAMPLE_COUNT = 60;

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
     * @param {number} options.opponentSampleCount - 对手推演采样数量（默认 DEFAULT_OPPONENT_SAMPLE_COUNT）
     * @param {number} options.lookaheadSteps - 向前推演步数（默认 DEFAULT_LOOKAHEAD_STEPS）
     */
    constructor(configA, configB, options = {}) {
        this.configA = { alpha: 0.5, randomness: 0, riskAwareness: 0, ...configA };
        this.configB = { alpha: 0.5, randomness: 0, riskAwareness: 0, ...configB };
        this.verbose = options.verbose || false;
        this.maxTurns = options.maxTurns || MAX_TURNS;
        
        // 风险评估参数（可覆盖）
        this.opponentSampleCount = options.opponentSampleCount ?? DEFAULT_OPPONENT_SAMPLE_COUNT;
        this.lookaheadSteps = options.lookaheadSteps ?? DEFAULT_LOOKAHEAD_STEPS;
        
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
        
        // 声纳历史（每方独立）
        // TODO: 将来应使用真正的收益式方法解决此问题，而非硬约束
        this.sonarHistoryA = new Set();
        this.sonarHistoryB = new Set();
        
        // 对战统计
        this.stats = {
            turns: 0,
            hitsA: 0,
            hitsB: 0,
            damageA: 0,  // A 造成的总伤害
            damageB: 0,  // B 造成的总伤害
            winner: null
        };
        
        // 历史记录（用于可视化回放）
        this.history = [];
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
    
    /**
     * 运行一场对战并返回详细结果（用于可视化）
     * 
     * @returns {Object} 详细结果 { winner, turns, history }
     */
    runGame() {
        const result = this.run();
        return {
            winner: result.winner,
            turns: result.stats.turns,
            history: this.history
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
        const abilities = checkAIAbilities(myShips);
        
        // 2. 获取存活目标
        const aliveTargets = enemyShips.filter(s => !s.sunk);
        if (aliveTargets.length === 0) return;
        
        // 3. 随机决策检查
        if (Math.random() < config.randomness) {
            const action = makeRandomDecision(viewGrid, abilities);
            this._executeAction(action, abilities, enemyGrid, enemyShips, viewGrid, damageGrid, side);
            return;
        }
        
        // 4. 构建置信状态（使用共享的 BeliefState 类）
        const beliefState = new BeliefState(aliveTargets, viewGrid, SAMPLE_COUNT);
        
        // 5. 枚举所有行动（使用共享函数）并过滤已使用的声呐点
        let actions = enumerateAllActions(viewGrid, abilities);
        
        // 硬约束：移除已使用过的声呐中心点
        // TODO: 将来应使用真正的收益式方法，让评估函数自然避免低效声呐
        const sonarHistory = side === 'A' ? this.sonarHistoryA : this.sonarHistoryB;
        if (sonarHistory.size > 0) {
            actions = actions.filter(action => {
                if (action.weapon === 'SONAR') {
                    const key = `${action.r},${action.c}`;
                    return !sonarHistory.has(key);
                }
                return true;
            });
        }
        
        if (actions.length === 0) {
            const fallback = findFallbackTarget(viewGrid);
            this._executeAction(fallback, abilities, enemyGrid, enemyShips, viewGrid, damageGrid, side);
            return;
        }
        
        // 6. 【新增】风险评估：与 aiStrategy.js 保持一致
        // 获取对手视角（模拟对局中双方视角都可用）
        let shipThreats = null;
        if (config.riskAwareness > 0) {
            const opponentViewGrid = side === 'A' ? this.viewGridB : this.viewGridA;
            shipThreats = simulateMultiStepThreats(
                opponentViewGrid,
                myShips,
                enemyShips,
                config.alpha,
                this.lookaheadSteps,      // 使用配置的推演步数
                this.opponentSampleCount  // 使用配置的采样数量
            );
        }
        
        // 7. 评估所有行动（使用共享的 evaluateAction 函数）
        let bestAction = null;
        let bestScore = -Infinity;
        const candidates = [];
        const maxShipHp = Math.max(...aliveTargets.map(s => s.maxHp ?? 1));
        
        for (const action of actions) {
            // 基础评分
            const baseUtility = evaluateAction(
                beliefState, action, abilities, config.alpha, damageGrid, maxShipHp
            );
            
            // 【新增】风险调整（与 aiStrategy.js 一致）
            let score = baseUtility;
            if (shipThreats && config.riskAwareness > 0) {
                const normRiskBonus = calculateRiskBonus(
                    action, shipThreats, beliefState, abilities, myShips, config.alpha
                );
                score = baseUtility * (1 + config.riskAwareness * normRiskBonus);
            }
            
            if (score > bestScore + 1e-9) {
                bestScore = score;
                candidates.length = 0;
                candidates.push(action);
            } else if (Math.abs(score - bestScore) < 1e-9) {
                candidates.push(action);
            }
        }
        
        // 从并列最优中随机选择
        bestAction = candidates[Math.floor(Math.random() * candidates.length)];
        
        // 8. 记录声呐使用
        if (bestAction.weapon === 'SONAR') {
            const key = `${bestAction.r},${bestAction.c}`;
            sonarHistory.add(key);
        }
        
        // 9. 执行最优行动（传入side以记录历史）
        this._executeAction(bestAction, abilities, enemyGrid, enemyShips, viewGrid, damageGrid, side);
    }
    
    // ========================================================================
    // 注：_checkAbilities、_enumerateActions、_evaluateAction 等已移至 aiCore.js
    // 此处直接调用共享函数，避免重复维护
    // ========================================================================
    
    /**
     * 获取武器覆盖范围
     */
    _getWeaponCoverage(weapon, r, c, abilities = null) {
        return getActionCoverage(weapon, r, c, abilities);
    }
    
    /**
     * 执行行动并更新状态
     */
    _executeAction(action, abilities, enemyGrid, enemyShips, viewGrid, damageGrid, side) {
        const { weapon, r, c } = action;
        
        // 初始化历史记录
        const historyEntry = {
            attacker: side,
            weapon,
            target: { row: r, col: c },
            result: { hits: 0, damage: 0, detected: false },
            affectedCells: [],
            sunkShips: []
        };
        
        if (weapon === 'SONAR') {
            // 声纳扫描
            const sonarResult = this._executeSonar(r, c, enemyGrid, viewGrid, abilities);
            historyEntry.result.detected = sonarResult.detected;
            
            // 记录受影响的格子
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                        historyEntry.affectedCells.push({
                            row: nr,
                            col: nc,
                            state: viewGrid[nr][nc]
                        });
                    }
                }
            }
        } else {
            // 攻击类武器
            const cells = this._getWeaponCoverage(weapon, r, c, abilities);
            
            for (const cell of cells) {
                if (cell.r < 0 || cell.r >= BOARD_SIZE || cell.c < 0 || cell.c >= BOARD_SIZE) continue;
                
                const isCenter = cell.r === r && cell.c === c;
                let damage;
                if (weapon === 'AP') {
                    const isSuspect = viewGrid[cell.r][cell.c] === CellState.SUSPECT;
                    damage = isSuspect
                        ? (abilities.apDamageVsSuspect ?? abilities.apDamage)
                        : abilities.apDamage;
                } else {
                    damage = isCenter
                        ? (abilities.heCenterDamage ?? 1)
                        : (abilities.heOuterDamage ?? 1);
                }
                const penetrate = weapon === 'AP'
                    || (weapon === 'HE' && isCenter && damage > 1);
                const maxPenetrations = weapon === 'AP'
                    ? (abilities.apMaxPenetrations ?? 1)
                    : 1;
                const result = this._resolveHit(cell.r, cell.c, damage, enemyGrid, enemyShips, penetrate, maxPenetrations);
                
                // 更新视图 / 伤害记录（穿甲会连带揭示相邻舱室）
                for (const hitCell of result.cells) {
                    viewGrid[hitCell.r][hitCell.c] = hitCell.state;
                    historyEntry.affectedCells.push({
                        row: hitCell.r,
                        col: hitCell.c,
                        state: hitCell.state
                    });
                    damageGrid[hitCell.r][hitCell.c] += hitCell.dealt;
                }
                
                if (result.hit) {
                    historyEntry.result.hits++;
                    historyEntry.result.damage += result.damage;
                    
                    if (side === 'A') {
                        this.stats.hitsA++;
                        this.stats.damageA += result.damage;
                    } else {
                        this.stats.hitsB++;
                        this.stats.damageB += result.damage;
                    }
                }
                
                if (result.sunk) {
                    this._markSunkShip(result.ship, viewGrid);
                    historyEntry.sunkShips.push({
                        code: result.ship.code,
                        name: result.ship.name
                    });
                }
            }
        }
        
        // 添加到历史记录
        this.history.push(historyEntry);
    }
    
    /**
     * 解析命中结果
     */
    _resolveHit(r, c, damage, grid, ships, penetrate = false, maxPenetrations = 1) {
        const cell = grid[r][c];
        
        if (cell.hit && cell.shipId === -1) {
            return { hit: false, cellState: null, damage: 0, cells: [] };
        }
        
        cell.hit = true;
        
        if (cell.shipId === -1) {
            return {
                hit: false,
                cellState: CellState.MISS,
                damage: 0,
                cells: [{ r, c, state: CellState.MISS, dealt: 0 }]
            };
        }
        
        const ship = ships[cell.shipId];
        const segIdx = cell.segmentIndex;
        
        if (ship.hp[segIdx] <= 0) {
            return { hit: true, cellState: CellState.DESTROYED, damage: 0, ship, cells: [] };
        }
        
        // 与 HitResolver 保持一致：默认向两侧相邻舱室各传 1 舱，连续穿甲沿舰体向两端延伸
        const limit = Math.max(1, maxPenetrations);
        const order = [segIdx];
        if (penetrate) {
            if (limit > 1) {
                for (let d = 1; d < ship.len; d++) {
                    if (segIdx + d < ship.len) order.push(segIdx + d);
                    if (segIdx - d >= 0) order.push(segIdx - d);
                }
            } else {
                if (segIdx + 1 < ship.len) order.push(segIdx + 1);
                if (segIdx - 1 >= 0) order.push(segIdx - 1);
            }
        }
        
        let remaining = Math.max(0, damage);
        let actualDamage = 0;
        let penetrated = 0;
        const cells = [];
        
        for (let k = 0; k < order.length && remaining > 0; k++) {
            if (k > 0 && penetrated >= limit) break;
            const idx = order[k];
            if (ship.hp[idx] <= 0) continue;
            const applied = Math.min(ship.hp[idx], remaining);
            ship.hp[idx] -= applied;
            remaining -= applied;
            actualDamage += applied;
            
            const target = k === 0 ? { r, c } : this._segmentCell(ship, idx);
            if (k > 0) {
                penetrated++;
                grid[target.r][target.c].hit = true;
            }
            cells.push({
                r: target.r,
                c: target.c,
                state: ship.hp[idx] <= 0 ? CellState.DESTROYED : CellState.HIT,
                dealt: applied,
                secondary: k > 0
            });
        }
        
        const cellState = cells[0]?.state ?? CellState.DESTROYED;
        const isSunk = ship.hp.every(h => h <= 0) && !ship.sunk;
        
        if (isSunk) {
            ship.sunk = true;
        }
        
        return { hit: true, cellState, damage: actualDamage, sunk: isSunk, ship, cells };
    }
    
    _segmentCell(ship, idx) {
        const isVertical = ship.v ?? ship.vertical ?? false;
        return {
            r: isVertical ? ship.r + idx : ship.r,
            c: isVertical ? ship.c : ship.c + idx
        };
    }
    
    /**
     * 执行声纳扫描
     * 逻辑：
     * - 有信号：中心点揭示真实状态（HIT/MISS），周围8格标记SUSPECT
     * - 无信号：全部9格标记MISS
     */
    _executeSonar(r, c, enemyGrid, viewGrid, abilities = null) {
        const radius = abilities?.sonarRadius ?? 1;
        const reveal = abilities?.sonarReveal || 'center';
        const scanCells = [];
        let detected = false;
        let nearest = null;
        
        // 扫描区域检测是否有未暴露的船只
        for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                scanCells.push({ r: nr, c: nc });
                
                const cell = enemyGrid[nr][nc];
                if (cell.shipId !== -1 && !cell.hit) {
                    detected = true;
                    const dist2 = dr * dr + dc * dc;
                    if (!nearest || dist2 < nearest.dist2) {
                        nearest = { r: nr, c: nc, dist2 };
                    }
                }
            }
        }
        
        if (detected) {
            // 有信号：揭示中心点，RN 标定最近接触；其余未知格标记疑似
            const revealCell = reveal === 'nearest' && nearest ? nearest : { r, c };
            const targetCell = enemyGrid[revealCell.r][revealCell.c];
            if (viewGrid[revealCell.r][revealCell.c] === CellState.UNKNOWN) {
                targetCell.hit = true;
                viewGrid[revealCell.r][revealCell.c] =
                    targetCell.shipId !== -1 ? CellState.HIT : CellState.MISS;
            }
            
            for (const { r: nr, c: nc } of scanCells) {
                if (nr === revealCell.r && nc === revealCell.c) continue;
                if (viewGrid[nr][nc] === CellState.UNKNOWN) {
                    viewGrid[nr][nc] = CellState.SUSPECT;
                }
            }
        } else {
            for (const { r: nr, c: nc } of scanCells) {
                if (viewGrid[nr][nc] === CellState.UNKNOWN) {
                    enemyGrid[nr][nc].hit = true;
                    viewGrid[nr][nc] = CellState.MISS;
                }
            }
        }
        
        return { detected };
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
    
    // _makeRandomDecision 和 _findFallbackTarget 已迁移至 aiCore.js
    
    /**
     * 检查是否全部沉没
     */
    _isAllSunk(ships) {
        return ships.every(s => s.sunk);
    }
}

// ============================================================================
// 注：SimBeliefState 类已移除，直接使用 aiCore.js 中的 BeliefState
// 采样数通过构造函数参数控制（SAMPLE_COUNT = 40 用于模拟场景）
// ============================================================================

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
