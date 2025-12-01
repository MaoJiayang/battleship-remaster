/**
 * AI 难度配置 v2.1 - 增强版（基于信息论框架 + 对称推演）
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
 * - riskAwareness: 风险意识强度 (0~1) [v2.1 新增]
 *   - 值越高，AI 越重视己方舰船的生存风险
 *   - 会优先使用即将丧失的能力（如 CV 受威胁时多用空袭）
 *   - 基于多步对称推演，预测玩家攻击意图
 * 
 * 设计理念：
 * - EASY: 高随机性，经常犯错，不考虑风险
 * - NORMAL: 适度随机，偶有失误，轻微风险意识
 * - HARD: 完全理性，高度重视己方风险，战术性更强
 */

export const DIFFICULTY_SETTINGS = {
    EASY: {
        alpha: 0.1,           // 偏重伤害，较少侦查
        randomness: 0.6,      // 60% 概率随机决策
        riskAwareness: 0.1    // 几乎不考虑风险
    },
    NORMAL: {
        alpha: 0.4,           // 平衡探索与利用
        randomness: 0.3,     // 30% 概率随机决策
        riskAwareness: 0.2    // 轻微风险意识
    },
    HARD: {
        alpha: 0.7,           // 偏信息收集，先侦查后集火
        randomness: 0.0,      // 完全理性
        riskAwareness: 0.4    // 较强风险意识
    }
};

export const DEFAULT_DIFFICULTY = "EASY";
