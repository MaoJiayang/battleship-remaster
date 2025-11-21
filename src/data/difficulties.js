export const DIFFICULTY_SETTINGS = {
  EASY: {
    hitFocus: 0.5,
    sonarFocus: 0.5,
    airstrikeAdvantage: 1.6,
    sonarVarianceGate: 0.4,
    sonarUnknownRatio: 8 / 9,
    randomness: 0.8
  },
  NORMAL: {
    hitFocus: 2.0,
    sonarFocus: 1.2,
    airstrikeAdvantage: 1.1,
    sonarVarianceGate: 0.25,
    sonarUnknownRatio: 2 / 3,
    randomness: 0.2
  },
  HARD: {
    hitFocus: 5,
    sonarFocus: 1.8,
    airstrikeAdvantage: 0.85,
    sonarVarianceGate: 0.085,
    sonarUnknownRatio: 5 / 9,
    randomness: 0.0
  }
};

export const DEFAULT_DIFFICULTY = "HARD";
