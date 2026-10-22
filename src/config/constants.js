export const BOARD_SIZE = 11;
export const CELL_SIZE = 40;
export const GAME_TITLE = "海权:决战深蓝";
export const GAME_VERSION = "v3.1α";

// 交互时间配置 (单位: ms)
export const INTERACTION_TIMING = {
    MOBILE_BREAKPOINT: 768, // 像素，小于此宽度视为移动端
    
    // 移动端延迟设置 (为了配合视角切换动画)
    MOBILE: {
        VIEW_SWITCH_DELAY: 750,   // 玩家操作后，切换到我方视角的延迟
        AI_ACTION_DELAY: 800,    // 玩家操作后，AI 开始行动的延迟 (应 > VIEW_SWITCH_DELAY)
        TURN_BACK_DELAY: 1000     // AI 操作后，切换回敌方视角的延迟
    },
    
    // 桌面端延迟设置 (无视角切换，但保留攻击动画的展示时间)
    DESKTOP: {
        VIEW_SWITCH_DELAY: 0,     // 桌面端无视角切换，设为0
        AI_ACTION_DELAY: 700,    // 留出爆炸/沉船动画时间再让 AI 行动
        TURN_BACK_DELAY: 0        // 桌面端无视角切换
    }
};
