/**
 * AI 参数说明（典型范围仅作参考，可按需微调）：
 * - hitFocus：命中格权重放大倍率，0~无界；值越大越偏好沿着已命中点追击。
 * - sonarFocus：疑似格权重放大倍率，0~无界；决定声呐提示对概率图的影响力。
 * - airstrikeAdvantage：空袭收益阈值系数，0~无界；越低越容易触发空袭（更激进）。
 * - sonarEntropyGate：基于 1-熵 的集中度门限 (0~1)；越低越容易认为“缺乏突破口”从而动用声呐。
 * - randomness：纯随机出手概率，0~1；高难度通常维持 0 以保证理性打法。
 */
export const DIFFICULTY_SETTINGS = {
  EASY: {
    hitFocus: 0.3, // 命中追击欲望最低，确保新手局更松散
    sonarFocus: 0.2, // 对疑似目标反应弱，减少压迫感
    airstrikeAdvantage: 1.5, // 只有空袭收益极佳时才投放
    sonarEntropyGate: 0.3, // 集中度低时更倾向声呐
    randomness: 0.5 // 大量随机射击，主要依靠运气
  },
  NORMAL: {
    hitFocus: 2.0, // 有明显连线意识但仍会分散火力
    sonarFocus: 1.2, // 会把疑似区域纳入决策
    airstrikeAdvantage: 1.1, // 空袭门槛适中，偶尔使用
    sonarEntropyGate: 0.15, // 当集中度不足时会开声呐
    randomness: 0.3 // 仍保留少量随机，避免全程最优
  },
  HARD: {
    hitFocus: 5.5, // 几乎不会放弃已命中线索
    sonarFocus: 2.0, // 大幅信任疑似情报
    airstrikeAdvantage: 0.85, // 只要空袭稍优就会出手
    sonarEntropyGate: 0.05, // 稍有集中度即继续攻击
    randomness: 0.0 // 完全理性，零随机干扰
  }
};

export const DEFAULT_DIFFICULTY = "EASY";
