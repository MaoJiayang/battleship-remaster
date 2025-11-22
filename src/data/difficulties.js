/**
 * AI 参数说明（典型范围仅作参考，可按需微调）：
 * - hitFocus：命中格权重放大倍率，0~无界；值越大越偏好沿着已命中点追击。每次访问会添加 ±0.5 的随机扰动。
 * - sonarFocus：疑似格权重放大倍率，0~无界；决定声呐提示对概率图的影响力。每次访问会添加 ±0.5 的随机扰动。
 * - airstrikeAdvantage：空袭收益阈值系数，0~无界；越低越容易触发空袭（更激进）。
 * - sonarEntropyGate：基于 1-熵 的集中度门限 (0~1)；越低越容易认为“缺乏突破口”从而动用声呐。
 * - randomness：纯随机出手概率，0~1；高难度通常维持 0 以保证理性打法。
 */

// 内部基础配置（不直接导出）
const BASE_SETTINGS = {
  EASY: {
    _hitFocusBase: 5.0,
    _sonarFocusBase: 2.5,
    airstrikeAdvantage: 0.9,
    sonarEntropyGate: 0.04,
    randomness: 0.8 // 大量随机射击，主要依靠运气
  },
  NORMAL: {
    _hitFocusBase: 7.5,
    _sonarFocusBase: 3.75,
    airstrikeAdvantage: 0.9,
    sonarEntropyGate: 0.04,
    randomness: 0.4 // 仍保留少量随机，避免全程最优
  },
  HARD: {
    _hitFocusBase: 10.0, // 几乎不会放弃已命中线索
    _sonarFocusBase: 5.0, // 大幅信任疑似情报
    airstrikeAdvantage: 0.9, // 只要空袭稍优就会出手
    sonarEntropyGate: 0.04, // 稍有集中度即继续攻击
    randomness: 0.0 // 完全理性，零随机干扰
  }
};
const jitterRange = 0.5;
// 为每个难度配置添加带随机扰动的 getter
function createDifficultyConfig(baseConfig) {
  return {
    ...baseConfig,
    get hitFocus() {
      return Math.max(0, baseConfig._hitFocusBase + (Math.random() - jitterRange));
    },
    get sonarFocus() {
      return Math.max(0, baseConfig._sonarFocusBase + (Math.random() - jitterRange));
    }
  };
}

export const DIFFICULTY_SETTINGS = {
  EASY: createDifficultyConfig(BASE_SETTINGS.EASY),
  NORMAL: createDifficultyConfig(BASE_SETTINGS.NORMAL),
  HARD: createDifficultyConfig(BASE_SETTINGS.HARD)
};

export const DEFAULT_DIFFICULTY = "EASY";
