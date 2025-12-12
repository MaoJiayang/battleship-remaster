/**
 * AI 策略模块 v2.3 - 基于信息论的统一决策框架（边际效用损失版）
 * 
 * 设计思想：信息增益最大化 (Max Information Gain) + 对称推演
 * - 将所有武器（主炮/空袭/声纳）统一评估为"信息获取 + 伤害输出"的组合
 * - 用信息熵作为统一度量，消除多个启发式超参数
 * - 唯一核心参数：alpha（探索权重）控制信息收集 vs 伤害输出的平衡
 * - 伤害溢出优化：记录已造成伤害，避免重复攻击已被"打穿"的格子
 * 
 * v2.3 改进（边际效用损失）：
 * - 风险评估与信息论框架统一：用 evaluateAction 计算能力价值
 * - 删除启发式的 calculateAbilityLoss 和 checkUsesEndangeredAbility
 * - 风险加成公式：finalScore = baseUtility × (1 + riskAwareness × normRiskBonus)
 * - 量纲统一：所有值归一化到 [0, 1]，乘法形式保证有界
 * 
 * v2.2 功能（保留）：
 * - 对称推演：复用现有框架模拟玩家攻击行为，预测己方舰船威胁
 * - 多步推演：向前看 k 步，累积评估各船的沉没概率
 * - 风险感知：当关键船只受威胁时，优先使用即将丧失的能力
 * 
 * ============================================================================
 * 导出接口（公开 API）
 * ============================================================================
 * 
 * 【生命周期管理】
 * - resetAIState(): 重置 AI 内部状态，每局游戏开始前必须调用
 * 
 * 【决策接口】
 * - makeAIDecision(context): AI 决策主入口，返回攻击指令
 *   - context.viewGrid: AI 视角下的棋盘状态（0=未知，1=未命中，2=命中，3=摧毁，4=疑似，5=已沉没）
 *   - context.myShips: 玩家舰船列表（AI 的攻击目标）
 *   - context.enemyShips: 敌方舰船列表（用于判断 AI 自身能力）
 *   - context.difficultyConfig: 难度配置参数（含 alpha, randomness, riskAwareness）
 *   - context.playerViewGrid: [可选] 玩家视角的 AI 棋盘（用于对称推演，提升风险感知）
 *   - 返回值: { weapon: 'AP'|'HE'|'SONAR', r: number, c: number }
 * 
 * 【调试接口】
 * - calculateProbabilityGrid(viewGrid, targets): 计算概率热力图，供调试显示
 * 
 * ============================================================================
 * 注意事项
 * ============================================================================
 * - AI 模块维护内部状态（伤害记录），不再是完全无状态
 * - 每局游戏开始前必须调用 resetAIState() 重置状态
 * - makeAIDecision() 返回的决策假定一定会被执行，AI 会据此更新内部状态
 * - 对称推演需要 playerViewGrid，若未提供则跳过风险计算（优雅降级）
 */

import { BOARD_SIZE } from '../config/constants.js';

// 导入共享的核心模块
import {
    BeliefState,
    CellState,
    MIN_PROB,
    checkAIAbilities,
    enumerateAllActions,
    evaluateAction,
    makeRandomDecision,
    findFallbackTarget,
    simulateMultiStepThreats,
    calculateRiskBonus
} from './aiCore.js';



// ============================================================================
// 常量定义（特定于 aiStrategy）
// ============================================================================

/** 蒙特卡洛采样数量（实战默认值） */
const SAMPLE_COUNT = 700;



// ============================================================================
// AI 内部状态（模块级）
// ============================================================================

/**
 * AI 已造成伤害记录
 * damageDealtGrid[r][c] = 该格子已承受的总伤害
 * 用于计算期望有效伤害，避免伤害溢出
 */
let damageDealtGrid = null;

/**
 * 创建空的伤害记录网格
 */
function createEmptyDamageGrid() {
    return Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
}

/**
 * 重置 AI 内部状态
 * 每局游戏开始前必须调用此函数
 * 
 * @export
 */
export function resetAIState() {
    damageDealtGrid = createEmptyDamageGrid();
}

/**
 * 记录 AI 攻击造成的伤害
 * 在 makeAIDecision 返回前调用，假设决策一定会被执行
 * 
 * @param {Object} action - 攻击行动 { weapon, r, c }
 * @param {Object} abilities - AI 能力（含 apDamage）
 */
function recordDamageDealt(action, abilities) {
    if (!damageDealtGrid) {
        damageDealtGrid = createEmptyDamageGrid();
    }
    
    const { weapon, r, c } = action;
    
    if (weapon === 'SONAR') {
        return; // 声纳不造成伤害
    }
    
    if (weapon === 'AP') {
        // AP 单点攻击
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
            damageDealtGrid[r][c] += abilities.apDamage;
        }
    } else if (weapon === 'HE') {
        // HE X 型攻击，每格 1 点伤害
        const offsets = [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (const [dr, dc] of offsets) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                damageDealtGrid[nr][nc] += 1;
            }
        }
    }
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * AI 决策主入口（增强版：支持多步推演与风险感知）
 * 
 * @param {Object} context - 决策上下文
 * @param {Array<Array<number>>} context.viewGrid - AI 视角棋盘 (BOARD_SIZE x BOARD_SIZE)
 * @param {Array} context.myShips - 玩家舰船状态（AI 的攻击目标）
 * @param {Array} context.enemyShips - 敌方舰船状态（AI 自身的船）
 * @param {Object} context.difficultyConfig - 难度配置
 * @param {Array<Array<number>>} [context.playerViewGrid] - 玩家视角的 AI 棋盘（用于对称推演）
 * @returns {{ weapon: string, r: number, c: number }} 攻击指令
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

    // 6. 【增强】多步推演：评估各船的累积威胁
    let shipThreats = null;
    if (riskAwareness > 0 && playerViewGrid) {
        shipThreats = simulateMultiStepThreats(
            playerViewGrid, 
            enemyShips, 
            myShips, 
            alpha
        );
    }

    // 7. 找到最优行动
    let bestAction = null;
    let bestScore = -Infinity;
    const candidates = [];

    for (const action of actions) {
        // 基础评分（使用共享模块的 evaluateAction）
        // 注意：此处调用不传 damageGrid，因为伤害记录由 aiStrategy 本地维护
        const baseUtility = evaluateAction(
            beliefState, 
            action, 
            abilities, 
            alpha, 
            damageDealtGrid,  // 传入本地伤害记录
            Math.max(...aliveTargets.map(s => s.maxHp ?? 1))
        );
        
        // 【增强】基于边际效用损失的风险调整（乘法形式）
        // finalScore = baseUtility × (1 + riskAwareness × normRiskBonus)
        // riskAwareness = 1 时，风险最多让效用翻倍
        let score = baseUtility;
        if (shipThreats && riskAwareness > 0) {
            const normRiskBonus = calculateRiskBonus(
                action, shipThreats, beliefState, abilities, enemyShips, alpha
            );
            score = baseUtility * (1 + riskAwareness * normRiskBonus);
        }
        
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
    
    // 记录即将造成的伤害（假设决策一定会被执行）
    recordDamageDealt(bestAction, abilities);
    
    return bestAction;
}

// ============================================================================
// 注：BeliefState、evaluateAction、checkAIAbilities 等核心函数
// 已提取到 aiCore.js，此处复用共享逻辑
// ============================================================================



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
