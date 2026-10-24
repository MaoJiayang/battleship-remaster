/**
 * AI 策略模块 v3.0 - 统一信息论框架 + 阵营学说
 *
 * 设计思想：信息增益最大化 + 期望伤害 + 对称推演
 * - 所有武器统一评估为「信息获取 + 伤害输出」的组合
 * - 阵营学说同时作用于武器结算与 AI 倾向（同一套数据，无特殊 patch）
 * - 难度差异只来自计算预算与理性程度（采样数 / 推演步数 / 随机率）
 *
 * ============================================================================
 * 导出接口（公开 API）
 * ============================================================================
 *
 * - AIDecisionEngine: 独立决策实例（自对弈/模拟时每方一个，互不污染状态）
 * - makeAIDecision(context): 默认实例的决策入口
 * - resetAIState(): 重置默认实例
 * - calculateProbabilityGrid(viewGrid, targets, difficultyConfig): 调试热力图
 *
 * context 字段：
 *   viewGrid        AI 视角棋盘（0未知 1未中 2命中 3摧毁 4疑似 5沉没）
 *   myShips         目标舰船（只读取 id/len/maxHp/sunk，不含位置）
 *   enemyShips      AI 自己的舰船（真实状态，用于能力与推演）
 *   difficultyConfig { alpha, randomness, riskAwareness, level }
 *   playerViewGrid  [可选] 玩家视角的 AI 棋盘（对称推演）
 *   aiFaction       己方阵营
 *   playerFaction   对方阵营
 *
 * ============================================================================
 */

import { BOARD_SIZE } from '../config/constants.js';
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
    getActionCoverage
} from './aiCore.js';
import { getAITuning } from './aiTuning.js';
import { BeliefSearch, describeAttack } from './beliefSearch.js';

// ============================================================================
// 内部状态
// ============================================================================

function createEmptyDamageGrid() {
    return Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
}

/**
 * 独立 AI 决策引擎
 * 自对弈时每方持有一个实例，伤害记录与声呐历史彼此隔离
 */
export class AIDecisionEngine {
    constructor() {
        this.reset();
    }

    reset() {
        this.damageDealtGrid = createEmptyDamageGrid();
        this.sonarHistory = new Set();
        this.actionHistory = [];
        this.generation = (this.generation || 0) + 1;
    }

    /**
     * 记录本次决策预计造成的伤害（供后续回合的溢出估计）
     */
    recordDamageDealt(action, abilities, viewGrid = null) {
        if (!this.damageDealtGrid) this.damageDealtGrid = createEmptyDamageGrid();
        const { weapon, r, c } = action;
        if (weapon === 'SONAR') return;

        const cells = getActionCoverage(weapon, r, c, abilities);
        for (const cell of cells) {
            let amount = 1;
            if (weapon === 'AP') {
                const isSuspect = viewGrid?.[cell.r]?.[cell.c] === CellState.SUSPECT;
                amount = isSuspect
                    ? (abilities.apDamageVsSuspect ?? abilities.apDamage)
                    : abilities.apDamage;
            } else if (weapon === 'HE') {
                amount = (cell.r === r && cell.c === c)
                    ? (abilities.heCenterDamage ?? 1)
                    : (abilities.heOuterDamage ?? 1);
            }
            this.damageDealtGrid[cell.r][cell.c] += amount;
        }
    }

    recordDecision(action, abilities, viewGrid) {
        this.recordDamageDealt(action, abilities, viewGrid);
        if (action.weapon === 'SONAR') this.sonarHistory.add(`${action.r},${action.c}`);
        if (!this.actionHistory) this.actionHistory = [];
        this.actionHistory.push({ ...describeAttack(action, abilities, viewGrid), beforeView: viewGrid.map(row => [...row]) });
        return action;
    }

    createSearch(context, tuning, deadline = Infinity) {
        const started = performance.now();
        let baseline;
        if (tuning.pairedSearch) {
            const engine = new AIDecisionEngine();
            engine.damageDealtGrid = this.damageDealtGrid.map(row => [...row]);
            engine.sonarHistory = new Set(this.sonarHistory);
            baseline = engine.decide({ ...context, difficultyConfig: { ...context.difficultyConfig, tuning: { ...tuning, search: false } } });
        }
        const baselineMs = performance.now() - started;
        const previous = this.actionHistory?.at(-1);
        if (previous && !previous.afterView) previous.afterView = context.viewGrid.map(row => [...row]);
        const targets = context.myShips.filter(ship => !ship.sunk);
        const createBelief = deadline => new BeliefState(targets, context.viewGrid, tuning.sampleCount, {
            placementPrior: context.placementPrior, areaContact: context.areaContact,
            sampleFirstTurn: true, posterior: true, fastSampling: tuning.fastSampling, deadline
        });
        const belief = baseline && performance.now() >= deadline ? null : createBelief(deadline);
        const search = new BeliefSearch(context, belief, this.actionHistory || [], this.damageDealtGrid, tuning, () => new AIDecisionEngine(), baseline, deadline, createBelief);
        search.baselineMs = baselineMs;
        search.inferenceMs = performance.now() - started - baselineMs;
        return search;
    }

    finishSearch(context, search) {
        const result = search.decision();
        if (!result) return null;
        const { action, ...stats } = result;
        this.lastDecisionStats = stats;
        const abilities = checkAIAbilities(context.enemyShips, context.aiFaction, context.playerFaction, {
            sunkEnemyShips: context.myShips.filter(ship => ship.sunk).length, neutralBias: true
        });
        return this.recordDecision(action, abilities, context.viewGrid);
    }

    async decideAsync(context) {
        const tuning = context.difficultyConfig?.tuning || getAITuning(context.difficultyConfig?.level || 'HARD');
        if (!tuning.search) return this.decide(context);
        const generation = this.generation;
        const started = performance.now();
        const search = this.createSearch(context, tuning, started + (tuning.searchTimeMs ?? 120));
        if (!search.root) {
            this.lastDecisionStats = { iterations: 0, particles: 0, inferenceFallback: true };
            return this.decide({ ...context, difficultyConfig: { ...context.difficultyConfig, tuning: { ...tuning, search: false } } });
        }
        do {
            search.advance(tuning.searchBatchSize ?? 4);
            await new Promise(resolve => setTimeout(resolve, 1));
            if (generation !== this.generation) return null;
        } while (!search.finished);
        return this.finishSearch(context, search);
    }

    /**
     * AI 决策主入口
     */
    decide(context) {
        const {
            viewGrid,
            myShips,
            enemyShips,
            difficultyConfig,
            playerViewGrid,
            placementPrior = null,
            areaContact = null,
            aiFaction = 'us',
            playerFaction = 'us'
        } = context;

        const { alpha = 0.5, randomness = 0, riskAwareness = 0, neutralBias = false } = difficultyConfig;
        const tuning = difficultyConfig?.tuning
            || getAITuning(difficultyConfig?.level || context.difficultyLevel || 'HARD');

        if (tuning.search) {
            const started = performance.now();
            const deadline = tuning.searchFixedIterations ? Infinity : started + (tuning.searchTimeMs ?? 120);
            const search = this.createSearch(context, tuning, deadline);
            if (search.root) {
                while (!search.finished) search.advance(tuning.searchBatchSize ?? 4);
                return this.finishSearch(context, search);
            }
            this.lastDecisionStats = { iterations: 0, particles: 0, inferenceFallback: true };
        }

        // 1. 己方能力（含学说；狼群战果取决于已击沉敌舰数）
        const abilities = checkAIAbilities(enemyShips, aiFaction, playerFaction, {
            sunkEnemyShips: myShips.filter(s => s.sunk).length,
            neutralBias
        });

        // 2. 存活目标
        const aliveTargets = myShips.filter(s => !s.sunk);
        if (aliveTargets.length === 0) {
            return findFallbackTarget(viewGrid);
        }

        // 3. 难度控制：随机扰动
        if (Math.random() < randomness) {
            return this.recordDecision(makeRandomDecision(viewGrid, abilities), abilities, viewGrid);
        }

        // 4. 构建置信状态（蒙特卡洛采样；历史布阵先验与区域接触观测参与概率更新）
        const beliefState = new BeliefState(aliveTargets, viewGrid, tuning.sampleCount, { placementPrior, areaContact, fastSampling: tuning.fastSampling });

        // 5. 枚举行动，过滤已用过的声呐点
        let actions = enumerateAllActions(viewGrid, abilities);
        if (this.sonarHistory.size > 0) {
            actions = actions.filter(action => {
                if (action.weapon === 'SONAR') {
                    return !this.sonarHistory.has(`${action.r},${action.c}`);
                }
                return true;
            });
        }

        if (actions.length === 0) {
            return findFallbackTarget(viewGrid);
        }

        // 6. 对称推演：评估己方舰船受到的威胁
        let shipThreats = null;
        if (riskAwareness > 0 && playerViewGrid) {
            shipThreats = simulateMultiStepThreats(
                playerViewGrid,
                enemyShips,
                myShips,
                alpha,
                tuning.lookaheadSteps,
                tuning.opponentSampleCount,
                { opponentFaction: playerFaction, myFaction: aiFaction, fastSampling: tuning.fastSampling }
            );
        }

        // 7. 找到最优行动
        const maxShipHp = Math.max(...aliveTargets.map(s => s.maxHp ?? 1));
        let bestScore = -Infinity;
        const candidates = [];

        for (const action of actions) {
            const baseUtility = evaluateAction(
                beliefState,
                action,
                abilities,
                alpha,
                this.damageDealtGrid,
                maxShipHp
            );

            // finalScore = baseUtility × (1 + riskAwareness × normRiskBonus)
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

        const bestAction = candidates[Math.floor(Math.random() * candidates.length)];

        // 8. 记账：预计伤害与声呐使用
        return this.recordDecision(bestAction, abilities, viewGrid);
    }
}

// ============================================================================
// 默认实例（实战 AI）
// ============================================================================

const defaultEngine = new AIDecisionEngine();

export function makeAIDecision(context) {
    return defaultEngine.decide(context);
}

export function makeAIDecisionAsync(context) {
    return defaultEngine.decideAsync(context);
}

export function resetAIState() {
    defaultEngine.reset();
}

// ============================================================================
// 调试热力图
// ============================================================================

/**
 * 计算概率热力图，供 AI 视角调试显示
 */
export function calculateProbabilityGrid(viewGrid, targets, difficultyConfig = null, placementPrior = null, areaContact = null) {
    if (!targets || targets.length === 0) {
        return Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
    }

    const aliveTargets = targets.filter(s => !s.sunk);
    if (aliveTargets.length === 0) {
        return Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
    }

    const tuning = difficultyConfig?.tuning
        || getAITuning(difficultyConfig?.level || 'HARD');
    const beliefState = new BeliefState(aliveTargets, viewGrid, tuning.sampleCount, { placementPrior, areaContact });
    return beliefState.getProbabilityGrid();
}
