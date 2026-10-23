export const BOARD_SIZE = 11;
export const CELL_SIZE = 40;
export const GAME_TITLE = "海权:决战深蓝";

// 交互时间配置 (单位: ms)
export const INTERACTION_TIMING = {
    MOBILE_BREAKPOINT: 768, // 像素，小于此宽度视为移动端
    
    // 移动端延迟设置 (为了配合视角切换动画)
    MOBILE: {
        VIEW_SWITCH_DELAY: 1100,  // 玩家操作后，等敌方棋盘打击特效播完再切视角
        AI_ACTION_DELAY: 1350,    // 切到我方视角并完成入场后再让 AI 行动
        TURN_BACK_DELAY: 1250     // AI 打击特效播完再切回敌方视角
    },
    
    // 桌面端延迟设置 (无视角切换，但保留攻击动画的展示时间)
    DESKTOP: {
        VIEW_SWITCH_DELAY: 0,     // 桌面端无视角切换，设为0
        AI_ACTION_DELAY: 700,    // 留出爆炸/沉船动画时间再让 AI 行动
        TURN_BACK_DELAY: 0        // 桌面端无视角切换
    }
};
