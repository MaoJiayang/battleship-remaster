// 阵营学说 - 玩家与 AI 共用的武器修正与行为倾向
// 史实依据：
// us  雷达火控 / 射击指挥仪（对已标定目标跨射）
// ijn 精锐舰载航空队（先制航空打击）
// rn  ASDIC 护航反潜体系（大范围水声搜索，标定后集火）
// km  潜艇狼群与通商破坏（战果累积后更凶猛的近战火力）
// fn  全前置四联装主炮（单发火力极强，依赖战列舰核心）
// rm  高速舰队规避炮火（对主炮弹道机动，但难防航空打击）
// sn  舰载火箭齐射（不依赖航母的饱和覆盖，主炮口径受限）

export const DOCTRINES = {
    us: {
        name: '雷达火控',
        aiHint: '水听锁定后集中跨射',
        en: 'RADAR FIRE CONTROL',
        brief: '主炮对疑似格 +1 伤，可连穿 2 舱',
        desc: '依托舰载雷达与射击指挥仪，对已标定海域实施精确跨射，命中后沿舰体向相邻舱室传导。',
        ap: { suspectBonus: 1, maxPenetrations: 2 },
        ai: {
            weaponBias: { AP: 1.06, HE: 1.0, SONAR: 1.05 },
            hitAffinity: 0.10,
            suspectAffinity: 0.20
        }
    },
    ijn: {
        name: '精锐航空队',
        aiHint: '优先航空打击与补刀',
        en: 'ELITE AIR GROUPS',
        brief: '空袭中心 3 伤并传导，外围 1 伤；航母存活时主炮 +1，沉没后改为陆基单点空袭（2 伤）',
        desc: '以精锐舰载航空兵实施先制打击，航弹中心命中造成三重破坏，外围仅有破片杀伤；舰载机同时为战列线校射，航母损失后改由陆基航空队维持有限的单点空中打击。',
        he: {
            centerDamage: 3,
            outerDamage: 1,
            fallback: { centerDamage: 2, outerDamage: 1, shape: 'single' }
        },
        ap: { cvBonus: 1 },
        ai: {
            weaponBias: { AP: 1.06, HE: 1.08, SONAR: 0.96 },
            hitAffinity: 0.30
        }
    },
    rn: {
        name: 'ASDIC 猎潜',
        aiHint: '反复广域搜索再集火',
        en: 'ASDIC SWEEP',
        brief: '水听有信号时，标定最近的接触格',
        desc: '以护航反潜体系实施水声搜索，接触信号可直接引导精确打击。',
        sonar: { radius: 1, reveal: 'nearest' },
        ai: {
            weaponBias: { AP: 1.02, HE: 1.0, SONAR: 1.02 },
            hitAffinity: 0.22,
            suspectAffinity: 0.32
        }
    },
    km: {
        name: '狼群战果',
        aiHint: '追击受创目标滚雪球',
        en: 'WOLFPACK',
        brief: '每击沉 1 艘敌舰，主炮伤害 +1（最多 +2）',
        desc: '潜艇狼群与水面袭击舰持续追击残舰，战果会转化为更强的主炮火力。',
        ap: { sunkBonus: 1, sunkBonusCap: 2 },
        ai: {
            weaponBias: { AP: 1.08, HE: 1.0, SONAR: 0.98 },
            hitAffinity: 0.24
        }
    },
    fn: {
        name: '四联装主炮',
        aiHint: '围绕战列舰打爆发',
        en: 'QUAD TURRETS',
        brief: '战列舰存活时主炮 4 伤',
        desc: '全前置四联装炮塔带来最强单发火力；火力核心失去后，主炮输出减半。',
        ap: {
            quadTurrets: true,
            fallbackDamage: 2,
            maxPenetrations: 1
        },
        ai: {
            weaponBias: { AP: 1.12, HE: 0.98, SONAR: 0.98 },
            hitAffinity: 0.24
        }
    },
    rm: {
        name: '高速规避',
        aiHint: '规避炮火并以主炮反击',
        en: 'HIGH-SPEED EVASION',
        brief: '重炮伤害 -1，轻弹不受影响；空袭中心至少 2 伤',
        desc: '以高航速与机动规避重炮，轻弹难以完全规避；舰体防空薄弱，空袭中心落弹至少造成 2 伤。',
        defense: { apReduction: 1, apReductionMinDamage: 3, heVulnerability: 1 },
        ai: {
            weaponBias: { AP: 1.06, HE: 0.96, SONAR: 1.02 },
            hitAffinity: 0.16
        }
    },
    sn: {
        name: '喀秋莎齐射',
        aiHint: '火箭覆盖压制散布目标',
        en: 'ROCKET SALVO',
        brief: '空袭无需航母，覆盖十字 5 格、中心 2 伤；主炮伤害 -1',
        desc: '以舰载火箭实施饱和覆盖，不依赖航母航空兵，中心落点可击穿甲板；为搭载火箭发射装置，主炮威力有所下降。',
        he: { requiresCV: false, shape: 'plus', centerDamage: 2 },
        ap: { damagePenalty: 1 },
        ai: {
            weaponBias: { AP: 1.0, HE: 1.10, SONAR: 0.96 },
            hitAffinity: 0.18
        }
    }
};

const DEFAULT_FACTION = 'us';

export function getDoctrine(factionId) {
    return DOCTRINES[factionId] || DOCTRINES[DEFAULT_FACTION];
}

export function getAIBias(factionId) {
    return getDoctrine(factionId).ai;
}

function hasAliveCode(ships, code) {
    return (ships || []).some(s => s.code === code && !s.sunk);
}

/**
 * 主炮基础伤害（不含目标状态修正，不含防守方减伤）
 * @param {string} factionId
 * @param {Array} ships - 攻击方舰船（Ship 或 ShipState）
 * @param {Object} opts
 * @param {boolean} opts.targetSuspect - 目标是否被水听标定为疑似
 * @param {number} opts.sunkEnemyShips - 已击沉敌舰数
 * @returns {number}
 */
export function getAPDamage(factionId, ships = [], opts = {}) {
    const doctrine = getDoctrine(factionId);
    const { targetSuspect = false, sunkEnemyShips = 0 } = opts;
    let damage = 1;

    if (doctrine.ap?.quadTurrets) {
        // 法国四联装：火力核心是战列舰，损失后由巡洋舰炮维持
        damage = hasAliveCode(ships, 'BB')
            ? 4
            : (doctrine.ap.fallbackDamage ?? 1);
    } else if (hasAliveCode(ships, 'BB')) {
        damage = 3;
    } else if (hasAliveCode(ships, 'SS') || hasAliveCode(ships, 'CL')) {
        damage = 2;
    }

    if (doctrine.ap?.sunkBonus) {
        damage += Math.min(
            doctrine.ap.sunkBonusCap ?? Infinity,
            sunkEnemyShips * doctrine.ap.sunkBonus
        );
    }
    if (doctrine.ap?.suspectBonus && targetSuspect) {
        damage += doctrine.ap.suspectBonus;
    }
    if (doctrine.ap?.cvBonus && hasAliveCode(ships, 'CV')) {
        damage += doctrine.ap.cvBonus;
    }
    if (doctrine.ap?.damagePenalty) {
        damage -= doctrine.ap.damagePenalty;
    }

    return Math.max(1, Math.round(damage));
}

/** 当前可达到的最高主炮伤害（用于 AI 归一化与界面展示） */
export function getAPMaxDamage(factionId, ships = [], opts = {}) {
    return getAPDamage(factionId, ships, { ...opts, targetSuspect: true });
}

/** 主炮穿甲最多额外传导的舱室数（默认 1；法国四联装需战列舰存活） */
export function getAPMaxPenetrations(factionId, ships = []) {
    const ap = getDoctrine(factionId).ap || {};
    const limit = ap.maxPenetrations ?? 1;
    if (limit > 1 && ap.maxPenetrationsRequiresBB && !hasAliveCode(ships, 'BB')) {
        return 1;
    }
    return limit;
}

/** 防守方学说对主炮伤害的修正 */
export function applyAPDefense(defenderFaction, damage) {
    const doctrine = getDoctrine(defenderFaction);
    const reduction = doctrine.defense?.apReduction || 0;
    const minDamage = doctrine.defense?.apReductionMinDamage ?? 0;
    if (damage < minDamage) return damage;
    return Math.max(1, damage - reduction);
}

/** 防守方学说对空袭伤害的弱点修正 */
export function getHEVulnerability(defenderFaction) {
    return getDoctrine(defenderFaction).defense?.heVulnerability || 0;
}

export function applyHEDefense(defenderFaction, damage) {
    // 防空薄弱抬高空袭中心伤害下限，重弹不再额外叠伤
    const floor = 1 + getHEVulnerability(defenderFaction);
    return Math.max(floor, damage);
}

/** 空袭武器档案（形状 / 是否依赖航母 / 中心伤害） */
export function getHEProfile(factionId, ships = []) {
    const doctrine = getDoctrine(factionId);
    const he = doctrine.he || {};
    const requiresCV = he.requiresCV !== false;
    const cvAlive = hasAliveCode(ships, 'CV');
    const fallback = he.fallback;
    const degraded = requiresCV && !cvAlive && !!fallback;
    const shape = degraded ? (fallback.shape || he.shape || 'x') : (he.shape || 'x');
    const centerDamage = degraded ? (fallback.centerDamage ?? 1) : (he.centerDamage ?? 1);
    const outerDamage = degraded ? (fallback.outerDamage ?? 1) : (he.outerDamage ?? 1);
    const available = requiresCV ? (cvAlive || !!fallback) : true;

    const centerPenetrates = centerDamage > 1;
    const mode = degraded ? '（陆基）' : '';
    const cellCount = getHEOffsets(shape).length;

    const shapeLabel = shape === 'plus'
        ? '十字型 5 格'
        : shape === 'single' ? '单点 1 格' : 'X 型 5 格';
    const damageLabel = shape === 'single'
        ? `单点，中心 ${centerDamage} 伤，可传导`
        : shape === 'plus'
            ? (centerDamage > 1 ? `十字，中心 ${centerDamage} 伤，可传导` : '十字，无需航母')
            : (centerDamage > 1
                ? `X 型，中心 ${centerDamage} 伤${outerDamage !== centerDamage ? `，外围 ${outerDamage} 伤` : ''}，可传导`
                : 'X 型 1 伤');
    // 武器按钮空间有限，单独提供紧凑版本
    const compact = degraded && shape === 'single'
        ? `陆基单点 ${centerDamage} 伤`
        : shape === 'single'
            ? `单点 ${centerDamage} 伤`
            : shape === 'plus'
                ? `十字 ${centerDamage} 伤`
                : `X 型 ${centerDamage}${outerDamage !== centerDamage ? `/${outerDamage}` : ''} 伤`;

    return {
        requiresCV,
        available,
        degraded,
        shape,
        centerDamage,
        outerDamage,
        centerPenetrates,
        maxDamage: centerDamage + outerDamage * (cellCount - 1),
        label: shapeLabel,
        meta: damageLabel + mode,
        compact
    };
}

export function getHEOffsets(shape = 'x') {
    if (shape === 'plus') return [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
    if (shape === 'single') return [[0, 0]];
    return [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
}

/** 水听档案 */
export function getSonarProfile(factionId) {
    const doctrine = getDoctrine(factionId);
    const radius = doctrine.sonar?.radius ?? 1;
    return {
        radius,
        side: radius * 2 + 1,
        reveal: doctrine.sonar?.reveal || 'center',
        label: `${radius * 2 + 1}×${radius * 2 + 1}`
    };
}
