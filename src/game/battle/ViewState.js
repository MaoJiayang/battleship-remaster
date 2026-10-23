// 战斗视野状态（AI 与武器共用的数值枚举，0~5 与既有 AI 视角保持一致）
export const VIEW_STATE = Object.freeze({
    UNKNOWN: 0,
    MISS: 1,
    HIT: 2,
    DESTROYED: 3,
    SUSPECT: 4,
    SUNK: 5
});
