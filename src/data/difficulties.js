/**
 * AI 参数说明（典型范围仅作参考，可按需微调）：
 * - hitFocus：命中格权重放大倍率，0~无界；值越大越偏好沿着已命中点追击。
 * - sonarFocus：疑似格权重放大倍率，0~无界；决定声呐提示对概率图的影响力。
 * - airstrikeAdvantage：空袭收益阈值系数，0~无界；越低越容易触发空袭（更激进）。
 * - sonarVarianceGate：触发声呐的分布方差门限，0~1；数值越低越倾向在热点明显时保守不开启声呐。
 * - sonarUnknownRatio：声呐期望覆盖率阈值，0~1；越接近 1 要求越大的未知区域才会扫描。
 * - randomness：纯随机出手概率，0~1；高难度通常维持 0 以保证理性打法。
 */
export const DIFFICULTY_SETTINGS = {
  EASY: {
    hitFocus: 0.5, // 命中追击欲望最低，确保新手局更松散
    sonarFocus: 0.5, // 对疑似目标反应弱，减少压迫感
    airstrikeAdvantage: 1.6, // 只有空袭收益极佳时才投放
    sonarVarianceGate: 0.4, // 仅在概率分布很平时才考虑声呐
    sonarUnknownRatio: 1, // 必须几乎全是未知水域才扫描
    randomness: 0.6 // 大量随机射击，主要依靠运气
  },
  NORMAL: {
    hitFocus: 2.0, // 有明显连线意识但仍会分散火力
    sonarFocus: 1.2, // 会把疑似区域纳入决策
    airstrikeAdvantage: 1.1, // 空袭门槛适中，偶尔使用
    sonarVarianceGate: 0.25, // 当热点不够突出时会开声呐
    sonarUnknownRatio: 2 / 3, // 中等规模未知区域即可侦查
    randomness: 0.35 // 仍保留少量随机，避免全程最优
  },
  HARD: {
    hitFocus: 5.5, // 几乎不会放弃已命中线索
    sonarFocus: 2.0, // 大幅信任疑似情报
    airstrikeAdvantage: 0.85, // 只要空袭稍优就会出手
    sonarVarianceGate: 0.085, // 稍有热点即考虑攻击
    sonarUnknownRatio: 5 / 9, // 小片未知区也会考量侦测
    randomness: 0.0 // 完全理性，零随机干扰
  }
};

export const DEFAULT_DIFFICULTY = "EASY";
