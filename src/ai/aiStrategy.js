/**
 * AI 策略模块
 * 
 * 职责：根据当前战场状态做出攻击决策
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

const MIN_PLACEMENT_WEIGHT = 0.0001; // 防止极小船型被归零

/**
 * AI 决策主入口
 * 
 * @param {Object} context - 决策上下文
 * @param {Array<Array<number>>} context.viewGrid - AI 视角棋盘 (10x10)
 * @param {Array} context.myShips - 玩家舰船状态
 * @param {Array} context.enemyShips - 敌方舰船状态
 * @param {Object} context.difficultyConfig - 难度配置
 * @returns {{ weapon: string, r: number, c: number }} 攻击指令
 */
export function makeAIDecision(context) {
    const { viewGrid, myShips, enemyShips, difficultyConfig } = context;

    // 1. 资源与能力检查
    const abilities = checkAIAbilities(enemyShips);
    
    // 2. 构建目标列表与概率图
    const targets = myShips.filter(s => !s.sunk);
    const largestAliveLen = targets.reduce((max, ship) => Math.max(max, ship.len), 0);
    const probabilityGrid = calculateProbabilityGrid(viewGrid, targets, difficultyConfig);

    // 3. 决策制定
    let bestAction = { r: -1, c: -1, score: 0, weapon: 'AP' };

    // === 难度控制：随机性干扰 ===
    if (Math.random() < difficultyConfig.randomness) {
        bestAction = makeRandomDecision(viewGrid, abilities);
    } else {
        // === 理性决策流程 ===
        bestAction = makeRationalDecision(
            probabilityGrid,
            viewGrid,
            abilities,
            difficultyConfig,
            largestAliveLen
        );
    }

    // 4. Fallback：确保始终有有效目标
    if (bestAction.r === -1) {
        bestAction = findFallbackTarget(viewGrid);
    }

    return bestAction;
}

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
    
    // 尝试找一个有效点 (0或4)
    do {
        r = Math.floor(Math.random() * BOARD_SIZE);
        c = Math.floor(Math.random() * BOARD_SIZE);
        attempts++;
    } while ((viewGrid[r][c] === 1 || viewGrid[r][c] === 3 || viewGrid[r][c] === 5) && attempts < 200);
    
    // 随机模式下，偶尔也会用特殊武器 (纯随机)
    if (abilities.canUseAir && Math.random() < 0.1) {
        return { r, c, weapon: 'HE' };
    } else if (abilities.canUseSonar && Math.random() < 0.1) {
        return { r, c, weapon: 'SONAR' };
    } else {
        return { r, c, weapon: 'AP' };
    }
}

/**
 * 理性决策（基于概率图和武器评估）
 */
function makeRationalDecision(probabilityGrid, viewGrid, abilities, difficultyConfig, largestAliveLen) {
    // 3.1 基础：寻找最高分的单点 (用于 AP)
    const bestPoint = findBestPoint(probabilityGrid, viewGrid, abilities.apDamage);
    const scoreStats = evaluateScoreStats(probabilityGrid, viewGrid, abilities.apDamage);
    let bestAction = { ...bestPoint, weapon: 'AP' };

    // 3.2 进阶：如果有空袭，寻找最高分的 X 型区域
    if (abilities.canUseAir) {
        const bestArea = findBestArea(probabilityGrid, viewGrid, 1);
        if (bestArea.score > bestPoint.score * difficultyConfig.airstrikeAdvantage) {
            bestAction = { r: bestArea.r, c: bestArea.c, weapon: 'HE' };
        }
    }

    // 3.3 侦查：概率不足时用声纳扩大情报
    if (abilities.canUseSonar) {
        const scanPoint = findBestScanPoint(probabilityGrid, viewGrid);
        const clarityIndex = 1 - (scoreStats.normEntropy ?? 0);
        const needRecon = clarityIndex < difficultyConfig.sonarEntropyGate;
        const requiredUnknown = Math.max(1, largestAliveLen);
        console.log(`[AI调试] 声纳判定 clarity=${clarityIndex.toFixed(3)} gate=${difficultyConfig.sonarEntropyGate} needRecon=${needRecon}`);
        
        if (scanPoint.r !== -1 && scanPoint.unknownCount >= requiredUnknown && needRecon) {
            bestAction = { r: scanPoint.r, c: scanPoint.c, weapon: 'SONAR' };
        }
    }

    return bestAction;
}

/**
 * 兜底：找一个可攻击的点
 */
function findFallbackTarget(viewGrid) {
    let r, c;
    do {
        r = Math.floor(Math.random() * BOARD_SIZE);
        c = Math.floor(Math.random() * BOARD_SIZE);
    } while (viewGrid[r][c] === 1 || viewGrid[r][c] === 3 || viewGrid[r][c] === 5);
    return { r, c, weapon: 'AP' };
}

/**
 * 计算概率热力图
 * （导出供调试热力图显示使用）
 */
export function calculateProbabilityGrid(viewGrid, targets, difficultyConfig = null) {
    const map = Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
    let totalWeight = 0;

    // 获取配置参数
    const sonarFocus = difficultyConfig?.sonarFocus ?? 2.0;

    targets.forEach(ship => {
        const placements = enumerateShipPlacements(ship, viewGrid, difficultyConfig);
        placements.forEach(({ cells, weight }) => {
            const viableCells = cells.filter(cell => {
                const state = viewGrid[cell.r][cell.c];
                return state === 0 || state === 4;  // 只计算未知和疑似点，不包括已命中(2)
            });
            if (viableCells.length === 0) return;
            
            const contribution = weight / viableCells.length;
            viableCells.forEach(cell => {
                map[cell.r][cell.c] += contribution;
                totalWeight += contribution;
            });
        });
    });

    // 归一化
    if (totalWeight > 0) {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                map[r][c] = map[r][c] / totalWeight;
            }
        }
    }

    // 清除无效点
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const state = viewGrid[r][c];
            if (state === 2) {
                map[r][c] = 1; // 已命中未摧毁的点优先级最高
            }
            if (state === 1 || state === 3 || state === 5) {
                map[r][c] = 0; // 无效点归零
            }
        }
    }

    return map;
}

/**
 * 枚举船只可能的放置位置
 */
function enumerateShipPlacements(ship, viewGrid, difficultyConfig = null) {
    const placements = [];
    const len = ship.len;
    const aliveSegments = Math.max(1, ship.hp.filter(h => h > 0).length);
    const scale = aliveSegments / len;

    // 使用配置参数或默认值
    const hitFocus = difficultyConfig?.hitFocus ?? 5.5;  // 默认使用 HARD 难度参数
    const sonarFocus = difficultyConfig?.sonarFocus ?? 2.0;

    // 水平放置
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c <= BOARD_SIZE - len; c++) {
            pushPlacement(r, c, false);
        }
    }
    
    // 垂直放置
    for (let r = 0; r <= BOARD_SIZE - len; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            pushPlacement(r, c, true);
        }
    }

    return placements;

    function pushPlacement(r, c, vertical) {
        const cells = [];
        let focusScore = 1;

        for (let i = 0; i < len; i++) {
            const nr = vertical ? r + i : r;
            const nc = vertical ? c : c + i;
            const state = viewGrid[nr][nc];

            if (state === 1 || state === 5) return; // 不可穿越
            cells.push({ r: nr, c: nc });
            // 使用配置参数进行累加，避免权重爆炸
            if (state === 2 || state === 3) focusScore += hitFocus; // 已知命中点权重提升
            else if (state === 4) focusScore += sonarFocus; // 疑似点权重适当增加
        }

        const weight = Math.max(MIN_PLACEMENT_WEIGHT, focusScore * scale);
        placements.push({ cells, weight });
    }
}

/**
 * 寻找最佳单点攻击目标
*  - **单点筛选实现细节 (`findBestPoint`)**：
    1. 遍历整张 10x10 棋盘，仅保留仍可攻击的格子（排除 `state ∈ {1,3,5}` 的 Miss/毁坏/沉没格）。
    2. 若格子已经是已知命中 (`state === 2`)，直接视为概率 1，用来优先“补刀”；其余格子的基础概率取自 `probabilityGrid`（无值视为 0）。
    3. 将基础概率乘以当前主炮伤害 `aiAPDamage` 得到收益 `score = baseProb * damage`，持续维护全局最高收益，并把并列最高的坐标收集为候选列表。
    4. 最终在候选列表中等概率随机挑选一个格子，以避免高分点完全重合时的机械重复，从而制造少量不可预测性。
 */
function findBestPoint(probMap, viewGrid, damagePerHit = 1) {
    let bestScore = -1;
    const candidates = [];

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const state = viewGrid[r][c];
            if (state === 1 || state === 3 || state === 5) continue; // 跳过无效点
            
            const baseProb = state === 2 ? 1 : (probMap[r][c] || 0);
            const score = baseProb * damagePerHit;
            
            if (score > bestScore + 1e-6) {
                bestScore = score;
                candidates.length = 0;
                candidates.push({ r, c });
            } else if (Math.abs(score - bestScore) < 1e-6) {
                candidates.push({ r, c });
            }
        }
    }

    if (candidates.length === 0) return { r: -1, c: -1, score: 0 };
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    return { ...choice, score: bestScore };
}

/**
 * 寻找最佳 X 型区域攻击目标（空袭）
 */
function findBestArea(probMap, viewGrid, damagePerCell = 1) {
    const offsets = [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    let bestScore = -1;
    const candidates = [];

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            let score = 0;
            offsets.forEach(off => {
                const nr = r + off[0];
                const nc = c + off[1];
                if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                    const state = viewGrid[nr][nc];
                    const baseProb = state === 2 ? 1 : (probMap[nr][nc] || 0);
                    score += baseProb * damagePerCell;
                }
            });
            
            if (score > bestScore + 1e-6) {
                bestScore = score;
                candidates.length = 0;
                candidates.push({ r, c });
            } else if (Math.abs(score - bestScore) < 1e-6) {
                candidates.push({ r, c });
            }
        }
    }

    if (candidates.length === 0) return { r: -1, c: -1, score: 0 };
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    return { ...choice, score: bestScore };
}

/**
 * 评估当前概率图的统计特征
 */
function evaluateScoreStats(probMap, viewGrid, damagePerHit = 1) {
    const scores = [];
    let maxScore = 0;

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const state = viewGrid[r][c];
            if (state === 1 || state === 3 || state === 5) continue;
            
            const baseProb = state === 2 ? 1 : (probMap[r][c] || 0);
            const s = baseProb * damagePerHit;
            scores.push(s);
            if (s > maxScore) maxScore = s;
        }
    }

    if (!scores.length) return { mean: 0, variance: 0, maxScore: 0, normEntropy: 1 };

    const mean = scores.reduce((sum, v) => sum + v, 0) / scores.length;
    const variance = scores.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / scores.length;
    
    let normEntropy = 1;
    const positiveScores = scores.filter(v => v > 0);
    if (positiveScores.length > 0) {
        const total = positiveScores.reduce((sum, v) => sum + v, 0);
        if (total > 0) {
            const entropy = positiveScores.reduce((sum, v) => {
                const p = v / total;
                return sum - p * Math.log(p);
            }, 0);
            const maxEntropy = Math.log(positiveScores.length);
            if (maxEntropy > 0) {
                normEntropy = entropy / maxEntropy;
            } else {
                normEntropy = 0;
            }
        }
    }

    return { mean, variance, maxScore, normEntropy };
}

/**
 * 寻找最佳声纳扫描点
 * 
 * 策略说明：
 * 声纳扫描是一种侦查武器，覆盖 3x3 区域，不造成伤害，但可以：
 * - 揭示中心点的真实状态（是否有船）
 * - 若有目标，周围 8 格标记为"疑似"(state=4)
 * - 若无目标，周围 8 格标记为"未命中"(state=1)
 * 
 * 评分机制：
 * 1. **覆盖率 (coverage)**：3x3 区域内"未知"或"疑似"格子的占比
 *    - 完全未知 (state=0)：全价值，计入 unknown
 *    - 疑似格子 (state=4)：全价值，计入 unknown（优化策略：允许重叠扫描以缩小范围）
 *    - 已命中/未命中/已沉没：不计入
 *    - 覆盖率越高 = 可获取的新信息越多
 * 
 * 2. **密度 (density)**：该区域未知格子的平均概率质量
 *    - density = Σ(probMap[格子]) / unknown
 *    - 密度越高 = 该区域越可能藏有敌舰
 * 
 * 3. **选择规则**：
 *    - 优先选择覆盖率最高的点（信息增益最大化）
 *    - 覆盖率相同时，选择密度最高的点（命中期望最大化）
 * 
 * 注意：当前实现将"疑似"格子视为有价值目标，可能导致同一区域被重复扫描。
 * 这是有意为之的优化尝试：通过多次重叠扫描，可以利用"排除法"缩小目标范围。
 * 例如：区域 A 扫描有目标，区域 B 扫描无目标，交集可确定敌舰位置。
 * 
 * @param {Array<Array<number>>} probMap - 概率热力图 (0-1)
 * @param {Array<Array<number>>} viewGrid - AI 视角棋盘状态
 * @returns {{ r: number, c: number, score: number, density: number, unknownCount: number }}
 */
function findBestScanPoint(probMap, viewGrid) {
    let best = { r: -1, c: -1, score: 0, density: 0, unknownCount: 0 };

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            let unknown = 0;      // 未知格子数量
            let mass = 0;         // 概率质量总和
            
            // 遍历以 (r, c) 为中心的 3x3 区域
            for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                    const nr = r + i;
                    const nc = c + j;
                    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                        const state = viewGrid[nr][nc];
                        // 统计未知 (0) 格子
                        if (state === 0) {
                            unknown++;
                            mass += probMap[nr][nc] || 0;
                        }
                        if (state === 4) {
                            // unknown++;// 疑似格子不计入未知
                            mass += probMap[nr][nc] || 0;// 但是会增加概率质量
                        }
                    }
                }
            }
            
            // 跳过无信息增益的点
            if (unknown === 0) continue;
            
            const coverage = unknown / 9;      // 覆盖率 (0-1)
            const density = mass / unknown;    // 平均密度
            
            // 优先级：覆盖率 > 密度
            if (coverage > best.score + 1e-6 || 
                (Math.abs(coverage - best.score) < 1e-6 && density > best.density)) {
                best = { r, c, score: coverage, density, unknownCount: unknown };
            }
        }
    }

    return best;
}
