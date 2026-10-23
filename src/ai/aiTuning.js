/**
 * AI 难度计算预算
 *
 * 统一机制：困难模式使用完整的采样与推演预算，中等/简单只降低预算与理性程度，
 * 不修改规则、不读取隐藏信息。
 */

const HARD_TUNING = Object.freeze({
    sampleCount: 1400,
    opponentSampleCount: 80,
    lookaheadSteps: 4,
    search: import.meta.env?.MODE === 'ai-lab',
    pairedSearch: true,
    rolloutOpponent: 'probability',
    modelSamples: 96,
    searchIterations: 64,
    validationIterations: 64,
    searchRisk: 0.05,
    rolloutLimit: 160,
    searchDepth: 12,
    searchBatchSize: 4,
    searchTimeMs: 120,
    policyCacheLimit: 2048
});

const NORMAL_TUNING = Object.freeze({
    sampleCount: 550,
    opponentSampleCount: 32,
    lookaheadSteps: 2
});

const EASY_TUNING = Object.freeze({
    sampleCount: 260,
    opponentSampleCount: 16,
    lookaheadSteps: 1
});

export const AI_TUNING = Object.freeze({
    HARD: HARD_TUNING,
    NORMAL: NORMAL_TUNING,
    EASY: EASY_TUNING
});

export function getAITuning(level = 'HARD') {
    return AI_TUNING[level] || AI_TUNING.HARD;
}
