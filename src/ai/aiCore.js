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
import { coverageHasPotential, isValidActionTarget } from '../game/battle/ActionRules.js';
import {
    getAPDamage,
    getAPMaxDamage,
    getAPMaxPenetrations,
    applyAPDefense,
    applyHEDefense,
    getHEProfile,
    getSonarProfile,
    getAIBias
} from '../data/doctrines.js';

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

function inBounds(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

// 学说形状的静态偏移表，避免热路径反复建数组
const HE_OFFSETS = {
    x: [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]],
    plus: [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]],
    single: [[0, 0]]
};

function heOffsets(shape) {
    return HE_OFFSETS[shape] || HE_OFFSETS.x;
}

/**
 * 无分配地遍历武器覆盖格
 */
function forEachCoverage(weapon, r, c, abilities, fn) {
    if (weapon === 'HE') {
        const offsets = heOffsets(abilities?.heShape || 'x');
        for (let i = 0; i < offsets.length; i++) {
            const nr = r + offsets[i][0];
            const nc = c + offsets[i][1];
            if (inBounds(nr, nc)) fn(nr, nc);
        }
        return;
    }
    if (weapon === 'SONAR') {
        const radius = abilities?.sonarRadius ?? 1;
        for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
                const nr = r + dr;
                const nc = c + dc;
                if (inBounds(nr, nc)) fn(nr, nc);
            }
        }
        return;
    }
    if (inBounds(r, c)) fn(r, c);
}

/**
 * 某武器在给定中心覆盖的格子（按学说形状/半径）
 */
export function getActionCoverage(weapon, r, c, abilities = null) {
    const cells = [];
    forEachCoverage(weapon, r, c, abilities, (nr, nc) => cells.push({ r: nr, c: nc }));
    return cells;
}

// ============================================================================
// 采样加速：静态放置表 + 位掩码
// ============================================================================

const MASK_WORDS = Math.ceil((BOARD_SIZE * BOARD_SIZE) / 32);
const STATIC_PLACEMENTS = new Map();

function popcount32(v) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}

function andPopcount(masks, base, filter) {
    let count = 0;
    for (let w = 0; w < MASK_WORDS; w++) {
        count += popcount32(masks[base + w] & filter[w]);
    }
    return count;
}

function masksOverlap(masks, base, filter) {
    for (let w = 0; w < MASK_WORDS; w++) {
        if (masks[base + w] & filter[w]) return true;
    }
    return false;
}

/**
 * 某舰长的全部棋盘放置（与视角无关，进程内共享）
 * 每项用 121 位掩码表示占格，附带展开后的格子索引
 */
export function getStaticPlacements(len) {
    const key = `${BOARD_SIZE}:${len}`;
    const cached = STATIC_PLACEMENTS.get(key);
    if (cached) return cached;

    const masks = [];
    const cells = [];
    let count = 0;
    for (let vertical = 0; vertical <= 1; vertical++) {
        const isVertical = vertical === 1;
        const maxR = isVertical ? BOARD_SIZE - len : BOARD_SIZE - 1;
        const maxC = isVertical ? BOARD_SIZE - 1 : BOARD_SIZE - len;
        for (let r = 0; r <= maxR; r++) {
            for (let c = 0; c <= maxC; c++) {
                const mask = new Uint32Array(MASK_WORDS);
                for (let i = 0; i < len; i++) {
                    const nr = isVertical ? r + i : r;
                    const nc = isVertical ? c : c + i;
                    const idx = nr * BOARD_SIZE + nc;
                    mask[idx >>> 5] |= 1 << (idx & 31);
                    cells.push(idx);
                }
                masks.push(mask);
                count++;
            }
        }
    }

    const flatMasks = new Uint32Array(count * MASK_WORDS);
    for (let i = 0; i < count; i++) {
        flatMasks.set(masks[i], i * MASK_WORDS);
    }

    const entry = {
        len,
        count,
        masks: flatMasks,
        cells: Int16Array.from(cells)
    };
    STATIC_PLACEMENTS.set(key, entry);
    return entry;
}

// ============================================================================
// 置信状态管理（蒙特卡洛采样）
// ============================================================================

/**
 * 置信状态类：维护对敌舰配置的概率分布
 * 
 * 核心思想：通过蒙特卡洛采样近似所有可行配置的分布
 */
export class BeliefState {
    static fromMarginals(ships, viewGrid, probabilityGrid) {
        const belief = Object.create(BeliefState.prototype);
        belief.ships = ships;
        belief.viewGrid = viewGrid;
        belief.boardSize = BOARD_SIZE;
        belief._sampleCount = 0;
        belief._shipEntries = [];
        belief._probabilityGrid = probabilityGrid;
        belief._entropy = null;
        return belief;
    }

    /**
     * @param {Ship[]} ships - 目标船只
     * @param {number[][]} viewGrid - 视角网格
     * @param {number} [sampleCount=DEFAULT_SAMPLE_COUNT] - 采样数量
     * @param {Object} [options]
     * @param {Object} [options.placementPrior] - 玩家历史布阵先验 { byLen: { [len]: { cells, strength } } }
     */
    constructor(ships, viewGrid, sampleCount = DEFAULT_SAMPLE_COUNT, options = {}) {
        this.ships = ships;
        this.viewGrid = viewGrid;
        this.boardSize = BOARD_SIZE;
        this.placementPrior = options?.placementPrior?.byLen ? options.placementPrior : null;
        this.sampleFirstTurn = !!options.sampleFirstTurn;
        this.posterior = !!options.posterior;
        this.fastSampling = !!options.fastSampling;
        this.deadline = options.deadline ?? Infinity;
        this._deadlineReached = false;
        
        // 预计算约束信息
        this.constraints = this._buildConstraints();
        
        // 检查是否为空盘面（第一回合）
        this.isFirstTurn = this._checkIfFirstTurn();

        // 蒙特卡洛采样（使用传入的采样数）
        // 第一回合且没有历史先验时跳过采样，保持概率图完全平均
        if (this.isFirstTurn && !this.placementPrior && !this.sampleFirstTurn) {
            this._sampleCount = 0;
        } else {
            this._placementCache = this._buildPlacementCache();
            this._sortedShips = [...this.ships].sort((a, b) => b.len - a.len);
            this._shipEntries = this._sortedShips.map(ship => ({
                ship,
                entry: this._placementCache.get(ship.len)
            }));
            this._occupied = new Uint8Array(this.boardSize * this.boardSize);
            this._covered = new Uint8Array(this.boardSize * this.boardSize);
            this._hitFlags = new Uint8Array(this.boardSize * this.boardSize);
            for (const { r, c } of this.constraints.mustHit) {
                this._hitFlags[r * this.boardSize + c] = 1;
            }
            this._mustHitCount = this.constraints.mustHit.length;
            this._chosenPlacements = new Int32Array(this._sortedShips.length);
            this._samplePlacements = null;
            this._sampleCount = 0;
            this._sampleConfigurations(sampleCount);
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
     * 样本以“每艘船的放置索引”扁平存储，避免每轮分配对象
     */
    _sampleConfigurations(n) {
        const shipCount = this._sortedShips.length;
        this._samplePlacements = new Int16Array(n * shipCount);
        if (this.posterior) this._sampleLogWeights = new Float64Array(n);
        let attempts = 0;
        const maxAttempts = n * 20; // 防止死循环
        let filled = 0;
        
        while (filled < n && attempts < maxAttempts) {
            if (this.deadline !== Infinity && attempts % 16 === 0 && performance.now() >= this.deadline) { this._deadlineReached = true; break; }
            attempts++;
            if (this._sampleOneConfiguration()) {
                this._samplePlacements.set(this._chosenPlacements, filled * shipCount);
                if (this.posterior) this._sampleLogWeights[filled] = this._chosenLogWeight;
                filled++;
            }
        }
        
        // 如果采样不足，用已有样本填充
        while (filled < n && filled > 0 && !this._deadlineReached) {
            const src = Math.floor(Math.random() * filled) * shipCount;
            this._samplePlacements.copyWithin(filled * shipCount, src, src + shipCount);
            if (this.posterior) this._sampleLogWeights[filled] = this._sampleLogWeights[src / shipCount];
            filled++;
        }
        
        this._sampleCount = filled;
        this.sampleAttempts = attempts;
        if (this.posterior && filled) {
            const maximum = Math.max(...this._sampleLogWeights.subarray(0, filled));
            this._sampleWeights = Float64Array.from(this._sampleLogWeights.subarray(0, filled), value => Math.exp(value - maximum));
            const total = this._sampleWeights.reduce((sum, value) => sum + value, 0);
            for (let sample = 0; sample < filled; sample++) this._sampleWeights[sample] /= total;
        }
    }

    /**
     * 预计算每种舰长在当前视角下的合法放置与权重
     * 静态放置表全进程共享，这里只做一次掩码过滤
     */
    _buildPlacementCache() {
        const blockedMask = new Uint32Array(MASK_WORDS);
        const hitMask = new Uint32Array(MASK_WORDS);
        const suspectMask = new Uint32Array(MASK_WORDS);
        
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const state = this.viewGrid[r][c];
                const idx = r * this.boardSize + c;
                if (state === CellState.MISS || state === CellState.SUNK) {
                    blockedMask[idx >>> 5] |= 1 << (idx & 31);
                } else if (state === CellState.HIT || state === CellState.DESTROYED) {
                    hitMask[idx >>> 5] |= 1 << (idx & 31);
                } else if (state === CellState.SUSPECT) {
                    suspectMask[idx >>> 5] |= 1 << (idx & 31);
                }
            }
        }
        
        const cache = new Map();
        const lengths = new Set(this.ships.map(s => s.len));
        
        for (const len of lengths) {
            const entry = this._buildLengthCache(len, blockedMask, hitMask, suspectMask);
            cache.set(len, entry);
        }
        
        return cache;
    }

    /**
     * 单个舰长的合法放置与权重
     */
    _buildLengthCache(len, blockedMask, hitMask, suspectMask) {
        const staticEntry = getStaticPlacements(len);
        const { count, masks, cells: flatCells } = staticEntry;
        const priorCells = this.placementPrior?.byLen?.[len]?.cells || null;
        const viable = new Int32Array(count);
        const weights = new Float64Array(count);
        const priorWeights = this.posterior ? new Float64Array(count) : null;
        const proposalWeights = this.posterior ? new Float64Array(count) : null;
        const cumulative = new Float64Array(count);
        let totalWeight = 0;
        let n = 0;
        
        for (let p = 0; p < count; p++) {
            const base = p * MASK_WORDS;
            if (masksOverlap(masks, base, blockedMask)) continue;
            // 原权重：基础上 1，每个命中舱 +10，每个疑似格 +1.25
            let weight = 1
                + 10 * andPopcount(masks, base, hitMask)
                + 1.25 * andPopcount(masks, base, suspectMask);
            // 玩家历史布阵先验：取船体各格先验的几何平均
            let priorWeight = 1;
            if (priorCells) {
                const cellBase = p * len;
                let product = 1;
                for (let k = 0; k < len; k++) product *= priorCells[flatCells[cellBase + k]];
                priorWeight = Math.pow(product, 1 / len);
                weight *= priorWeight;
            }
            if (this.posterior) {
                priorWeights[p] = priorWeight;
                proposalWeights[p] = weight;
            }
            viable[n] = p;
            weights[n] = weight;
            totalWeight += weight;
            cumulative[n] = totalWeight;
            n++;
        }
        
        return {
            staticEntry,
            n,
            viable,
            weights,
            priorWeights,
            proposalWeights,
            cumulative,
            totalWeight,
            // 每次抽船复用的临时数组
            tmpViable: new Int32Array(n),
            tmpCumulative: new Float64Array(n)
        };
    }

    /**
     * 采样单个配置：逐船随机放置
     */
    _sampleOneConfiguration() {
        const occupied = this._occupied;
        const covered = this._covered;
        const hitFlags = this._hitFlags;
        occupied.fill(0);
        covered.fill(0);
        let coveredCount = 0;
        this._chosenLogWeight = 0;
        const chosen = this._chosenPlacements;
        
        for (let i = 0; i < this._shipEntries.length; i++) {
            const { entry } = this._shipEntries[i];
            const independent = this.fastSampling && this.posterior;
            const placement = independent ? this._drawPlacement(entry) : this._sampleShipPlacement(entry, occupied);
            if (placement < 0) {
                return false; // 放置失败，整个配置作废
            }
            chosen[i] = placement;
            if (independent) this._chosenLogWeight += Math.log(entry.totalWeight / entry.proposalWeights[placement]) + Math.log(entry.priorWeights[placement]);
            const { staticEntry } = entry;
            const base = placement * staticEntry.len;
            for (let k = 0; k < staticEntry.len; k++) {
                const cell = staticEntry.cells[base + k];
                if (occupied[cell]) return false;
                occupied[cell] = 1;
                if (hitFlags[cell] && !covered[cell]) {
                    covered[cell] = 1;
                    coveredCount++;
                }
            }
        }
        
        return coveredCount === this._mustHitCount;
    }

    /**
     * 为单艘船采样一个合法放置位置
     * 单次遍历可行放置并累积权重，再按累计权重抽样
     */
    _sampleShipPlacement(entry, occupied) {
        const { staticEntry, n, viable, weights, tmpViable, tmpCumulative } = entry;
        if (!n) return -1;
        
        const { cells, len } = staticEntry;
        if (this.fastSampling && !this.posterior) {
            for (let attempt = 0; attempt < 8; attempt++) {
                const placement = this._drawPlacement(entry);
                let blocked = false;
                for (let segment = 0; segment < len; segment++) {
                    if (occupied[cells[placement * len + segment]]) { blocked = true; break; }
                }
                if (!blocked) return placement;
            }
        }
        let count = 0;
        let totalWeight = 0;
        
        for (let i = 0; i < n; i++) {
            const p = viable[i];
            const base = p * len;
            let blocked = false;
            for (let k = 0; k < len; k++) {
                if (occupied[cells[base + k]]) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) continue;
            
            totalWeight += weights[i];
            tmpCumulative[count] = totalWeight;
            tmpViable[count] = p;
            count++;
        }
        
        if (count === 0) {
            return -1;
        }
        
        const rand = Math.random() * totalWeight;
        let lo = 0;
        let hi = count - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (tmpCumulative[mid] < rand) lo = mid + 1;
            else hi = mid;
        }
        
        const placement = tmpViable[lo];
        if (this.posterior) this._chosenLogWeight += Math.log(totalWeight / entry.proposalWeights[placement]) + Math.log(entry.priorWeights[placement]);
        return placement;
    }

    _drawPlacement(entry) {
        if (!entry.n) return -1;
        const position = Math.random() * entry.totalWeight;
        let lower = 0;
        let upper = entry.n - 1;
        while (lower < upper) {
            const middle = (lower + upper) >> 1;
            if (entry.cumulative[middle] < position) lower = middle + 1;
            else upper = middle;
        }
        return entry.viable[lower];
    }

    getSampleFleets(limit = this._sampleCount) {
        return [...this.iterateSampleFleets(limit)];
    }

    *iterateSampleFleets(limit = this._sampleCount, shuffled = false) {
        const count = Math.min(limit, this._sampleCount);
        const indices = new Int32Array(count);
        let weightIndex = 0;
        let cumulativeWeight = this._sampleWeights?.[0] || 0;
        for (let sample = 0; sample < count; sample++) {
            let sampleIndex = Math.floor(sample * this._sampleCount / count);
            if (this.posterior && this._sampleWeights) {
                const position = (sample + 0.5) / count;
                while (weightIndex < this._sampleCount - 1 && cumulativeWeight < position) cumulativeWeight += this._sampleWeights[++weightIndex];
                sampleIndex = weightIndex;
            }
            indices[sample] = sampleIndex;
        }
        if (shuffled) {
            for (let index = count - 1; index > 0; index--) {
                const target = Math.floor(Math.random() * (index + 1));
                [indices[index], indices[target]] = [indices[target], indices[index]];
            }
        }
        for (const sampleIndex of indices) {
            yield this._shipEntries.map(({ ship, entry }, shipIndex) => {
                const placement = this._samplePlacements[sampleIndex * this._shipEntries.length + shipIndex];
                const offset = placement * entry.staticEntry.len;
                return { ship, cells: Array.from(entry.staticEntry.cells.subarray(offset, offset + ship.len)) };
            });
        }
    }

    /**
     * 获取边缘概率分布（每格有船的概率）
     */
    getProbabilityGrid() {
        if (this._probabilityGrid) {
            return this._probabilityGrid;
        }
        
        // 特殊处理第一回合：无历史先验时返回完全平均的概率
        if (this.isFirstTurn && !this.placementPrior && !this.sampleFirstTurn) {
            const totalShipCells = this.ships.reduce((sum, s) => sum + s.len, 0);
            const totalCells = this.boardSize * this.boardSize;
            const avgProb = totalCells > 0 ? totalShipCells / totalCells : 0;
            
            const grid = Array(this.boardSize).fill(0).map(() => Array(this.boardSize).fill(avgProb));
            this._probabilityGrid = grid;
            return grid;
        }

        const grid = Array(this.boardSize).fill(0)
            .map(() => Array(this.boardSize).fill(0));
        
        if (this._sampleCount === 0) {
            return grid;
        }
        
        // 统计每个格子在采样中出现的频率
        const boardSize = this.boardSize;
        const shipCount = this._shipEntries.length;
        const counts = this.posterior ? new Float64Array(boardSize * boardSize) : new Uint32Array(boardSize * boardSize);
        for (let s = 0; s < this._sampleCount; s++) {
            const rowBase = s * shipCount;
            for (let i = 0; i < shipCount; i++) {
                const { staticEntry } = this._shipEntries[i].entry;
                const base = this._samplePlacements[rowBase + i] * staticEntry.len;
                for (let k = 0; k < staticEntry.len; k++) {
                    counts[staticEntry.cells[base + k]] += this.posterior ? this._sampleWeights[s] : 1;
                }
            }
        }
        
        // 归一化为概率
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                grid[r][c] = counts[r * boardSize + c] / (this.posterior ? 1 : this._sampleCount);
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
     * @param {Object} action - 行动
     * @param {Object} [abilities] - 能力状态（决定水听半径 / 空袭形状）
     */
    getConditionalEntropy(action, abilities = null) {
        const { weapon, r, c } = action;
        const probGrid = this.getProbabilityGrid();
        
        if (weapon === 'SONAR') {
            return this._getSonarConditionalEntropy(
                r, c, probGrid,
                abilities?.sonarRadius ?? 1,
                abilities?.sonarReveal ?? 'center'
            );
        } else {
            // AP 和 HE 都是攻击类武器
            return this._getAttackConditionalEntropy(action, probGrid, abilities);
        }
    }

    /**
     * 声纳的条件熵计算
     * - 有信号概率由区域内至少一艘未暴露舰船决定
     * - 无信号：清空整片区域
     * - 有信号：center 只揭示中心格；nearest 标定区域内最可能/最近接触
     */
    _getSonarConditionalEntropy(r, c, probGrid, radius = 1, reveal = 'center') {
        const centerState = (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize)
            ? this.viewGrid[r][c] : CellState.MISS;
        const centerProb = (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize)
            ? probGrid[r][c] : 0;
        
        let areaEntropy = 0;
        let unknownCount = 0;
        let noShipProb = 1;
        let maxCellEntropy = 0;
        
        for (let i = -radius; i <= radius; i++) {
            for (let j = -radius; j <= radius; j++) {
                const nr = r + i;
                const nc = c + j;
                if (nr >= 0 && nr < this.boardSize && nc >= 0 && nc < this.boardSize) {
                    const state = this.viewGrid[nr][nc];
                    if (state === CellState.UNKNOWN){
                        const p = probGrid[nr][nc];
                        const cellEntropy = this._cellEntropy(p);
                        areaEntropy += cellEntropy;
                        maxCellEntropy = Math.max(maxCellEntropy, cellEntropy);
                        noShipProb *= (1 - p);
                        unknownCount++;
                    }
                }
            }
        }
        
        if (unknownCount === 0) {
            return this.getEntropy(); // 无信息增益
        }
        
        const currentEntropy = this.getEntropy();
        const signalProb = 1 - Math.max(0, noShipProb);
        
        // 有信号时只揭示一个接触格；其余格仅标记疑似，不消除概率
        const revealEntropy = reveal === 'nearest'
            ? maxCellEntropy
            : (centerState === CellState.UNKNOWN ? this._cellEntropy(centerProb) : 0);
        
        const expectedEntropy = signalProb * (currentEntropy - revealEntropy)
                        + (1 - signalProb) * (currentEntropy - areaEntropy);
        
        return Math.max(0, Math.min(currentEntropy, expectedEntropy));
    }

    /**
     * 攻击类武器的条件熵计算
     */
    _getAttackConditionalEntropy(action, probGrid, abilities = null) {
        const { weapon, r, c } = action;
        const currentEntropy = this.getEntropy();
        
        // 计算覆盖格的总熵（无临时数组）
        let coveredEntropy = 0;
        forEachCoverage(weapon, r, c, abilities, (nr, nc) => {
            const state = this.viewGrid[nr][nc];
            if (state === CellState.UNKNOWN || state === CellState.SUSPECT) {
                coveredEntropy += this._cellEntropy(probGrid[nr][nc]);
            }
        });
        
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

}

// ============================================================================
// 行动评估
// ============================================================================

/**
 * 统一评估行动的效用值
 * 
 * utility = alpha * 归一化信息增益 + (1 - alpha) * 归一化期望伤害
 * 再乘以阵营学说倾向（武器偏好、补刀/疑似目标亲和）
 * 
 * @param {BeliefState} beliefState - 置信状态
 * @param {Object} action - 行动 { weapon, r, c }
 * @param {Object} abilities - 能力（包含学说档案）
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
    const conditionalEntropy = beliefState.getConditionalEntropy(action, abilities);
    const infoGain = Math.max(0, currentEntropy - conditionalEntropy);
    
    // 归一化信息增益（除以当前总熵）
    const normInfoGain = currentEntropy > MIN_PROB ? infoGain / currentEntropy : 0;
    
    // 2. 计算期望伤害
    // 如果未提供 maxShipHp，从 beliefState 中获取
    const effectiveMaxHp = maxShipHp ?? Math.max(...beliefState.ships.map(s => s.maxHp ?? 1));
    const expectedDamage = calculateExpectedDamage(
        action, probGrid, abilities, damageGrid, effectiveMaxHp, beliefState.viewGrid
    );
    
    // 归一化期望伤害（除以最大可能伤害）
    const maxDamage = weapon === 'HE'
        ? Math.max(1, abilities.heProfile?.maxDamage ?? 5)
        : (weapon === 'AP' ? Math.max(1, abilities.apMaxDamage ?? abilities.apDamage ?? 1) : 0);
    const normDamage = maxDamage > 0 ? expectedDamage / maxDamage : 0;
    
    // 3. 综合评分
    // 声纳不造成伤害，但信息价值高
    let utility = weapon === 'SONAR'
        ? alpha * normInfoGain
        : alpha * normInfoGain + (1 - alpha) * normDamage;
    
    // 4. 阵营学说倾向（只使用公开视野中的格子状态）
    const bias = abilities?.weaponBias?.[weapon] ?? 1;
    utility *= bias;
    
    const hitAffinity = abilities?.hitAffinity ?? 0;
    const suspectAffinity = abilities?.suspectAffinity ?? 0;
    if (weapon !== 'SONAR' && (hitAffinity > 0 || suspectAffinity > 0)) {
        let hitCells = 0;
        let suspectCells = 0;
        forEachCoverage(weapon, r, c, abilities, (nr, nc) => {
            const state = beliefState.viewGrid[nr][nc];
            if (state === CellState.HIT || state === CellState.DESTROYED) hitCells++;
            else if (state === CellState.SUSPECT) suspectCells++;
        });
        utility *= 1 + hitAffinity * Math.min(hitCells, 2)
                       + suspectAffinity * Math.min(suspectCells, 2);
    }
    
    return utility;
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
 * @param {Object} abilities - AI 能力（含学说伤害档案）
 * @param {Array<Array<number>>} [damageGrid] - 已造成伤害记录（可选）
 * @param {number} maxShipHp - 当前存活船只的最大血量
 * @param {Array<Array<number>>} [viewGrid] - 视角网格（用于雷达锁定判定）
 * @returns {number} 期望有效伤害
 */
export function calculateExpectedDamage(action, probGrid, abilities, damageGrid = null, maxShipHp, viewGrid = null) {
    const { weapon, r, c } = action;
    
    if (weapon === 'SONAR') {
        return 0; // 声纳不造成伤害
    }
    
    let expectedDamage = 0;
    
    if (weapon === 'AP') {
        // 单点攻击（雷达火控对疑似目标有额外伤害）
        // 穿甲传导收益不额外计入：连续穿甲是上限，不是每发都能吃满
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
            const isSuspect = viewGrid?.[r]?.[c] === CellState.SUSPECT;
            const baseDamage = isSuspect
                ? (abilities.apDamageVsSuspect ?? abilities.apDamage)
                : abilities.apDamage;
            expectedDamage = probGrid[r][c] * baseDamage;
        }
    } else if (weapon === 'HE') {
        // 学说形状攻击（X 型 / 十字型），中心伤害可被学说强化
        const offsets = heOffsets(abilities.heShape || 'x');
        const centerDamage = abilities.heCenterDamage ?? 1;
        const outerDamage = abilities.heOuterDamage ?? 1;
        for (let i = 0; i < offsets.length; i++) {
            const dr = offsets[i][0];
            const dc = offsets[i][1];
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                const cellDamage = (dr === 0 && dc === 0) ? centerDamage : outerDamage;
                const effectiveDamage = getEffectiveDamage(nr, nc, cellDamage, damageGrid, maxShipHp);
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
 * 检查 AI 可用的武器能力（含阵营学说）
 * 
 * @param {Ship[]} ships - 己方舰船列表
 * @param {string} [factionId='us'] - 己方阵营
 * @param {string|null} [opponentFaction=null] - 敌方阵营（用于规避类减伤）
 * @param {Object} [options]
 * @param {number} [options.sunkEnemyShips=0] - 已击沉敌舰数（狼群战果）
 * @returns {Object} 能力与学说档案
 */
export function checkAIAbilities(ships, factionId = 'us', opponentFaction = null, options = {}) {
    const sunkEnemyShips = options.sunkEnemyShips || 0;
    const aiCV = ships.some(s => s.code === 'CV' && !s.sunk);
    const aiCL = ships.some(s => s.code === 'CL' && !s.sunk);
    const aiBB = ships.some(s => s.code === 'BB' && !s.sunk);
    const aiSS = ships.some(s => s.code === 'SS' && !s.sunk);
    const aiDD = ships.some(s => s.code === 'DD' && !s.sunk);
    
    const heProfile = getHEProfile(factionId, ships);
    const heCenterDamage = opponentFaction
        ? applyHEDefense(opponentFaction, heProfile.centerDamage)
        : heProfile.centerDamage;
    const sonarProfile = getSonarProfile(factionId);
    // 平衡基准可关闭学说人格层，只保留机制推导出的期望伤害/信息价值
    const bias = options.neutralBias ? {} : (getAIBias(factionId) || {});
    const rawAP = getAPDamage(factionId, ships, { sunkEnemyShips });
    const rawAPSuspect = getAPMaxDamage(factionId, ships, { sunkEnemyShips });
    const apDamage = opponentFaction ? applyAPDefense(opponentFaction, rawAP) : rawAP;
    const apDamageVsSuspect = opponentFaction
        ? applyAPDefense(opponentFaction, rawAPSuspect)
        : rawAPSuspect;
    
    return {
        factionId,
        opponentFaction,
        sunkEnemyShips,
        canUseAir: heProfile.available,
        canUseSonar: aiDD || aiSS,
        apDamage,
        apDamageVsSuspect,
        apMaxDamage: Math.max(apDamage, apDamageVsSuspect),
        apSuspectBonus: Math.max(0, apDamageVsSuspect - apDamage),
        apMaxPenetrations: getAPMaxPenetrations(factionId, ships),
        heProfile,
        heShape: heProfile.shape,
        heCenterDamage,
        heOuterDamage: heProfile.outerDamage,
        sonarRadius: sonarProfile.radius,
        sonarReveal: sonarProfile.reveal,
        apPenetrates: true,
        weaponBias: bias.weaponBias || { AP: 1, HE: 1, SONAR: 1 },
        hitAffinity: bias.hitAffinity || 0,
        suspectAffinity: bias.suspectAffinity || 0,
        // 兼容旧字段
        aiCV,
        aiCL,
        aiBB,
        aiSS,
        aiDD
    };
}

// ============================================================================
// 行动枚举
// ============================================================================

/**
 * 枚举所有可用行动
 * - 主炮可打未知/命中/疑似格
 * - 空袭中心可落在水面（用于覆盖周围未知格）
 * - 水听排除根据已有观测可以确定无效的扫描
 * 
 * @param {number[][]} viewGrid - 视角网格
 * @param {Object} abilities - 能力状态
 * @returns {Array<{weapon: string, r: number, c: number}>} 行动列表
 */
export function enumerateAllActions(viewGrid, abilities, evidence = []) {
    const actions = [];
    
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const state = viewGrid[r][c];
            
            // 水听：排除根据已有观测可以确定无效的扫描
            if (isValidActionTarget({ weapon: 'SONAR', r, c }, viewGrid, abilities, evidence)) {
                actions.push({ weapon: 'SONAR', r, c });
            }
            
            if (state === CellState.MISS) {
                // 空袭中心可以落在已探明水面，覆盖周围未知格
                if (abilities.canUseAir && coverageHasPotential(viewGrid, 'HE', r, c, abilities)) {
                    actions.push({ weapon: 'HE', r, c });
                }
                continue;
            }
            
            if (state === CellState.DESTROYED || state === CellState.SUNK) {
                if (abilities.canUseAir && coverageHasPotential(viewGrid, 'HE', r, c, abilities)) {
                    actions.push({ weapon: 'HE', r, c });
                }
                continue;
            }
            
            // 主炮：始终可用
            actions.push({ weapon: 'AP', r, c });
            
            // 空袭：需要航母存活（部分学说无需航母）
            if (abilities.canUseAir && coverageHasPotential(viewGrid, 'HE', r, c, abilities)) {
                actions.push({ weapon: 'HE', r, c });
            }
        }
    }
    
    return actions;
}

// ============================================================================
// 风险评估模块（对称推演）
// ============================================================================

/** 对称推演采样数量（较小以平衡多步开销） */
export const DEFAULT_OPPONENT_SAMPLE_COUNT = 50;

/** 向前推演步数 */
export const DEFAULT_LOOKAHEAD_STEPS = 3;

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
 * @param {number} [steps=DEFAULT_LOOKAHEAD_STEPS] - 推演步数
 * @param {number} [sampleCount=DEFAULT_OPPONENT_SAMPLE_COUNT] - 对手采样数量
 * @param {Object} [options]
 * @param {string} [options.opponentFaction='us'] - 对手阵营（学说）
 * @param {string} [options.myFaction='us'] - 我方阵营（用于规避减伤）
 * @returns {Map<string, { totalExpectedDamage: number, sinkProbability: number, remainingHp: number }>}
 * @export
 */
export function simulateMultiStepThreats(opponentViewGrid, myShips, opponentShips, alpha, steps = DEFAULT_LOOKAHEAD_STEPS, sampleCount = DEFAULT_OPPONENT_SAMPLE_COUNT, options = {}) {
    const { opponentFaction = 'us', myFaction = 'us' } = options;
    const opponentAbilities = checkAIAbilities(opponentShips, opponentFaction, myFaction, {
        sunkEnemyShips: myShips.filter(s => s.sunk).length
    });
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
        const opponentBelief = new BeliefState(aliveTargets, simViewGrid, sampleCount, { fastSampling: options.fastSampling });
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
        accumulateThreat(bestAction, probGrid, opponentAbilities, myShips, threats, simViewGrid);
        
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
 * @param {number[][]} [viewGrid] - 攻击方视角（判定雷达锁定加成）
 */
function accumulateThreat(action, probGrid, abilities, targetShips, threats, viewGrid = null) {
    const { weapon, r, c } = action;
    
    // 声纳不造成伤害
    if (weapon === 'SONAR') return;
    
    const cells = getActionCoverage(weapon, r, c, abilities);
    
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
                    let cellDamage = 1;
                    if (weapon === 'AP') {
                        const isSuspect = viewGrid?.[cell.r]?.[cell.c] === CellState.SUSPECT;
                        cellDamage = isSuspect
                            ? (abilities.apDamageVsSuspect ?? abilities.apDamage)
                            : abilities.apDamage;
                    } else if (weapon === 'HE') {
                        cellDamage = (cell.r === r && cell.c === c)
                            ? (abilities.heCenterDamage ?? 1)
                            : (abilities.heOuterDamage ?? 1);
                    }
                    // 期望伤害 = 对手攻击该格的概率 × 伤害
                    threat.totalExpectedDamage += probGrid[cell.r][cell.c] * cellDamage;
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
    
    if (weapon === 'SONAR') {
        const radius = abilities.sonarRadius ?? 1;
        
        if (abilities.sonarReveal === 'nearest') {
            // 最近接触：区域内最可能的未暴露格显形，其余标记疑似
            let contact = null;
            for (let dr = -radius; dr <= radius; dr++) {
                for (let dc = -radius; dc <= radius; dc++) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (!inBounds(nr, nc) || simViewGrid[nr][nc] !== CellState.UNKNOWN) continue;
                    if (!contact || probGrid[nr][nc] > contact.p) {
                        contact = { r: nr, c: nc, p: probGrid[nr][nc] };
                    }
                }
            }
            if (contact && contact.p > 0.5) {
                simViewGrid[contact.r][contact.c] = CellState.HIT;
            } else if (simViewGrid[r][c] === CellState.UNKNOWN) {
                simViewGrid[r][c] = probGrid[r][c] > 0.5 ? CellState.HIT : CellState.MISS;
            }
            for (let dr = -radius; dr <= radius; dr++) {
                for (let dc = -radius; dc <= radius; dc++) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (!inBounds(nr, nc)) continue;
                    if (simViewGrid[nr][nc] === CellState.UNKNOWN) {
                        simViewGrid[nr][nc] = CellState.SUSPECT;
                    }
                }
            }
            return;
        }
        
        // 中心按概率揭示，周围未知标记为疑似
        if (simViewGrid[r][c] === CellState.UNKNOWN) {
            simViewGrid[r][c] = probGrid[r][c] > 0.5 ? CellState.HIT : CellState.MISS;
        }
        for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
                const nr = r + dr;
                const nc = c + dc;
                if ((dr === 0 && dc === 0) || !inBounds(nr, nc)) continue;
                if (simViewGrid[nr][nc] === CellState.UNKNOWN) {
                    simViewGrid[nr][nc] = CellState.SUSPECT;
                }
            }
        }
        return;
    }
    
    const cells = getActionCoverage(weapon, r, c, abilities);
    
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
function simulateAbilitiesAfterLoss(ships, lostShip, abilities = null) {
    const remaining = ships.filter(s => s.id !== lostShip.id && !s.sunk);
    return checkAIAbilities(
        remaining,
        abilities?.factionId || 'us',
        abilities?.opponentFaction || null,
        { sunkEnemyShips: abilities?.sunkEnemyShips || 0 }
    );
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
        const afterAbilities = simulateAbilitiesAfterLoss(myShips, ship, abilities);
        
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
export function makeRandomDecision(viewGrid, abilities, evidence = []) {
    const actions = enumerateAllActions(viewGrid, abilities, evidence);
    let weapon = 'AP';
    // 随机选择武器
    if (abilities.canUseAir && Math.random() < 0.1) {
        weapon = 'HE';
    } else if (abilities.canUseSonar && Math.random() < 0.1) {
        weapon = 'SONAR';
    }
    const selected = actions.filter(action => action.weapon === weapon);
    const choices = selected.length ? selected : actions;
    return choices.length ? choices[Math.floor(Math.random() * choices.length)] : findFallbackTarget(viewGrid);
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
