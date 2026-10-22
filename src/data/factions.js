// src/data/factions.js
// 阵营定义表 - 风格化虚构舰队，不与现实国家对应
// 舰船建模（配色 + 装备布局）见 src/game/shipArt.js

export const FACTIONS = {
    us: { name: '蓝钢舰队', mark: '#63b3ed' },
    ijn: { name: '绯木联合', mark: '#ed8936' },
    rn: { name: '狮心舰队', mark: '#68d391' },
    km: { name: '铁雾军团', mark: '#cbd5e0' },
    fn: { name: '鸢尾舰队', mark: '#fc8181' },
    rm: { name: '苍鹰舰队', mark: '#f6e05e' },
    sn: { name: '赤潮舰队', mark: '#f56565' }
};

export const DEFAULT_PLAYER_FACTION = 'us';
export const DEFAULT_ENEMY_FACTION = 'ijn';
