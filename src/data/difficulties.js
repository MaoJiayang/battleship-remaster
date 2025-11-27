/**
 * AI 难度配置 v2.0 - 简化版（基于信息论框架）
 * 
 * 核心参数说明：
 * - alpha: 探索权重 (0~1)
 *   - 值越高，AI 越倾向于收集信息（使用声纳、覆盖未知区域）
 *   - 值越低，AI 越倾向于直接输出伤害（集火已知目标）
 * 
 * - randomness: 随机决策概率 (0~1)
 *   - 每回合有此概率放弃理性决策，改为随机攻击
 *   - 用于模拟 AI 的"失误"，降低难度
 * 
 * 设计理念：
 * - EASY: 高随机性，经常犯错，给玩家喘息机会
 * - NORMAL: 适度随机，偶有失误，但基本理性
 * - HARD: 完全理性，信息收集与伤害输出平衡最优
 */

export const DIFFICULTY_SETTINGS = {
    EASY: {
        alpha: 0.2,         // 偏重伤害，较少侦查
        randomness: 0.5     // 60% 概率随机决策
    },
    NORMAL: {
        alpha: 0.4,         // 平衡探索与利用
        randomness: 0.25    // 25% 概率随机决策
    },
    HARD: {
        alpha: 0.6,        // 略偏信息收集，先侦查后集火0.65
        randomness: 0.0     // 完全理性
    }
};

export const DEFAULT_DIFFICULTY = "EASY";
