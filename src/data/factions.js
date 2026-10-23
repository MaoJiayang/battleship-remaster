// src/data/factions.js
// 阵营定义表 - 风格化虚构舰队，不与现实国家对应
// 舰船建模（配色 + 装备布局）见 src/game/shipArt.js

export const FACTIONS = {
    us: { name: '蓝钢舰队', mark: '#63b3ed', bloc: 'allied' },
    ijn: { name: '绯木联合', mark: '#ed8936', bloc: 'axis' },
    rn: { name: '狮心舰队', mark: '#68d391', bloc: 'allied' },
    km: { name: '铁雾军团', mark: '#cbd5e0', bloc: 'axis' },
    fn: { name: '鸢尾舰队', mark: '#fc8181', bloc: null }, // 每局随机归属
    rm: { name: '苍鹰舰队', mark: '#f6e05e', bloc: 'axis' },
    sn: { name: '赤潮舰队', mark: '#f56565', bloc: 'allied' }
};

export const DEFAULT_PLAYER_FACTION = 'us';
export const DEFAULT_ENEMY_FACTION = 'ijn';

/** 敌方阵营下拉的随机项 */
export const RANDOM_FACTION = 'random';

/**
 * 抽取随机敌方阵营
 * - 玩家属同盟则抽轴心，玩家属轴心则抽同盟
 * - 鸢尾（fn）无固定归属，每次抽取前先掷一次归属
 * @param {string} playerFactionId
 * @param {() => number} [rng]
 * @returns {string} 阵营 id
 */
export function pickRandomEnemyFaction(playerFactionId, rng = Math.random) {
    const franceAllied = rng() < 0.5;
    const blocOf = id => (id === 'fn' ? (franceAllied ? 'allied' : 'axis') : FACTIONS[id]?.bloc);
    const playerBloc = blocOf(playerFactionId);
    const candidates = Object.keys(FACTIONS).filter(id =>
        id !== playerFactionId && blocOf(id) !== playerBloc
    );
    return candidates[Math.floor(rng() * candidates.length)];
}
