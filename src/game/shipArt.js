// src/game/shipArt.js
// 舰船 SVG 建模系统 - 数据驱动生成内联 SVG（俯视视角，船首朝左）
// 阵营 = 调色板 + 装备布局，全部矢量绘制，零外部资源

const HULL_LEN = { BB: 240, CV: 240, CL: 170, DD: 120, SS: 60 };
const HULL_BEAM = { BB: 44, CV: 50, CL: 30, DD: 22, SS: 16 };

// ---------- 调色板 ----------
// hullLo/hullHi: 船体钢板色; deckLo/deckHi: 甲板色; sup: 上层建筑
const PALETTES = {
    us: { hullLo: '#2e4053', hullHi: '#a3b8cc', deckLo: '#52697e', deckHi: '#839cae',
          sup: '#b8c8d8', supLo: '#74889c', outline: '#0c1218', barrel: '#141a20',
          deckStyle: 'steel', plane: '#c3d2e0', accent: '#63b3ed', fun: '#2c3a48' },
    ijn: { hullLo: '#4a3623', hullHi: '#b08a5a', deckLo: '#8a6136', deckHi: '#b58a52',
          sup: '#c0baa4', supLo: '#837c66', outline: '#170f08', barrel: '#1e150c',
          deckStyle: 'wood', plane: '#a8b894', accent: '#ed8936', fun: '#241a10' },
    rn: { hullLo: '#38434f', hullHi: '#9dabb8', deckLo: '#8f6c48', deckHi: '#b08a63',
          sup: '#aab6c2', supLo: '#6f7c89', outline: '#0d1218', barrel: '#161c22',
          deckStyle: 'wood', plane: '#c4cfd8', accent: '#68d391', fun: '#262f38' },
    km: { hullLo: '#565e66', hullHi: '#c4cbd2', deckLo: '#5f6871', deckHi: '#8a939c',
          sup: '#d0d6dc', supLo: '#9099a2', outline: '#14171b', barrel: '#1c2024',
          deckStyle: 'steel', plane: '#d4dade', accent: '#cbd5e0', fun: '#31363b' },
    fn: { hullLo: '#334055', hullHi: '#9aabc4', deckLo: '#8a6138', deckHi: '#b0854f',
          sup: '#b4c2d4', supLo: '#76879c', outline: '#0e131c', barrel: '#151b24',
          deckStyle: 'wood', plane: '#c0cbda', accent: '#fc8181', fun: '#28323f' },
    rm: { hullLo: '#4d5040', hullHi: '#b4b894', deckLo: '#8f7248', deckHi: '#b39263',
          sup: '#c2c6a8', supLo: '#8a8e6e', outline: '#14150f', barrel: '#1e1f18',
          deckStyle: 'wood', plane: '#b6c0a2', accent: '#f6e05e', fun: '#33352a' },
    sn: { hullLo: '#2f3d34', hullHi: '#90a695', deckLo: '#4a5a4e', deckHi: '#75887b',
          sup: '#a8bcae', supLo: '#6d7f72', outline: '#0d130f', barrel: '#151b17',
          deckStyle: 'steel', plane: '#b2beb4', accent: '#f56565', fun: '#222d26' }
};

// ---------- 装备布局 ----------
// turrets: [x, 炮管数, 'l'|'r', 是否叠炮(画在上层)]  x = 炮塔中心
// bridge: { x, w, style: 'tower'|'pagoda'|'flat' }
// funnels: [x, 宽, 高, 后倾?]  宽=沿船长轴
// torp: [x] 鱼雷管
const LAYOUTS = {
    BB: {
        us: { beam: 44, turrets: [[36, 3, 'l'], [66, 3, 'l', 1], [176, 3, 'r']],
              bridge: { x: 84, w: 54, style: 'tower' }, funnels: [[128, 10, 15], [141, 8, 12]],
              aa: [100, 150], catapult: 1, plane: 1 },
        ijn: { beam: 48, turrets: [[36, 3, 'l'], [66, 3, 'l', 1], [148, 3, 'r'], [178, 3, 'r', 1]],
              bridge: { x: 84, w: 44, style: 'pagoda' }, funnels: [[126, 15, 23]],
              aa: [100], catapult: 2, plane: 2 },
        rn: { beam: 44, turrets: [[36, 3, 'l'], [66, 3, 'l', 1], [96, 3, 'l', 1]],
              bridge: { x: 114, w: 48, style: 'tower' }, funnels: [[136, 10, 15], [149, 8, 12]],
              aa: [140, 172], catapult: 1, plane: 1 },
        km: { beam: 44, bow: 'clipper', turrets: [[38, 2, 'l'], [68, 2, 'l', 1], [162, 2, 'r'], [192, 2, 'r', 1]],
              bridge: { x: 88, w: 60, style: 'flat' }, funnels: [[124, 15, 23]],
              aa: [120], crane: 1 },
        fn: { beam: 44, bow: 'clipper', turrets: [[42, 4, 'l'], [80, 4, 'l', 1]],
              bridge: { x: 100, w: 60, style: 'tower' }, funnels: [[152, 10, 14], [165, 8, 11]],
              aa: [130], crane: 1, plane: 1 },
        rm: { beam: 44, turrets: [[36, 3, 'l'], [66, 3, 'l', 1], [186, 3, 'r']],
              bridge: { x: 84, w: 52, style: 'tower' }, funnels: [[146, 9, 14, 1], [158, 8, 11, 1]],
              aa: [110], catapult: 1, plane: 1 },
        sn: { beam: 48, turrets: [[36, 3, 'l'], [66, 3, 'l', 1], [136, 3, 'r'], [168, 3, 'r', 1]],
              bridge: { x: 84, w: 36, style: 'tower' }, funnels: [[96, 12, 19]],
              aa: [110], badge: 1, catapult: 1 }
    },
    CV: {
        us: { mark: 'runway', num: '18', islandX: 152, elev: [72, 94], catapults: 2, planes: 4 },
        ijn: { mark: 'ring', num: '16', islandX: 150, elev: [56, 80], sidefun: [146, 158], planes: 2 },
        rn: { closedBow: 1, mark: 'runway', num: '67', islandX: 168, elev: [86], catapults: 2, planes: 2 },
        km: { mark: 'runway', num: '80', islandX: 156, elev: [72], catapults: 4, planes: 1 },
        fn: { mark: 'runway', num: '06', islandX: 194, elev: [82], sidefun: [54, 66], planes: 3 },
        rm: { mark: 'runway', num: '55', islandX: 156, elev: [76, 88], twinFun: 1, planes: 3 },
        sn: { mark: 'runway', num: '71', islandX: 156, elev: [76], planes: 2 }
    },
    CL: {
        us: { turrets: [[26, 2, 'l'], [52, 2, 'l', 1], [104, 2, 'r'], [126, 2, 'r'], [146, 2, 'r', 1]],
              bridge: { x: 64, w: 24, style: 'tower' }, funnels: [[90, 7, 11]], aa: [70] },
        ijn: { turrets: [[26, 2, 'l'], [54, 2, 'l', 1], [146, 2, 'r']],
              bridge: { x: 64, w: 30, style: 'pagoda' }, funnels: [[90, 9, 16, 1], [102, 9, 16, 1]],
              torp: [112, 124], aa: [70] },
        rn: { turrets: [[26, 2, 'l'], [54, 2, 'l', 1], [118, 2, 'r'], [142, 2, 'r']],
              bridge: { x: 64, w: 28, style: 'tower' }, funnels: [[94, 9, 14], [104, 8, 12]], aa: [70] },
        km: { turrets: [[26, 2, 'l'], [52, 2, 'l', 1], [76, 2, 'l', 1], [138, 2, 'r']],
              bridge: { x: 88, w: 30, style: 'tower' }, funnels: [[122, 9, 16, 1]], aa: [92] },
        fn: { turrets: [[26, 2, 'l'], [54, 2, 'l', 1], [122, 2, 'r'], [146, 2, 'r']],
              bridge: { x: 64, w: 28, style: 'tower' }, funnels: [[94, 9, 16, 1], [106, 9, 16, 1]] },
        rm: { turrets: [[26, 2, 'l'], [54, 2, 'l', 1], [136, 2, 'r']],
              bridge: { x: 64, w: 28, style: 'tower' }, funnels: [[92, 9, 16, 1], [104, 9, 16, 1]], torp: [112] },
        sn: { turrets: [[26, 2, 'l'], [54, 2, 'l', 1], [108, 2, 'r'], [130, 2, 'r']],
              bridge: { x: 64, w: 28, style: 'tower' }, funnels: [[92, 9, 15]], badge: 1 }
    },
    DD: {
        us: { turrets: [[20, 1, 'l'], [38, 1, 'l', 1], [100, 1, 'r']],
              bridge: { x: 48, w: 16, style: 'tower' }, funnels: [[67, 6, 10], [86, 6, 9]], torp: [72] },
        ijn: { turrets: [[22, 2, 'l'], [102, 2, 'r']],
              bridge: { x: 34, w: 14, style: 'pagoda' }, funnels: [[54, 7, 12, 1], [68, 7, 12, 1]], torp: [76] },
        rn: { turrets: [[20, 1, 'l'], [38, 1, 'l', 1], [100, 1, 'r']],
              bridge: { x: 48, w: 16, style: 'tower' }, funnels: [[65, 6, 10], [84, 6, 9]], torp: [70] },
        km: { turrets: [[20, 1, 'l'], [38, 1, 'l', 1], [100, 1, 'r']],
              bridge: { x: 48, w: 16, style: 'flat' }, funnels: [[65, 6, 10], [84, 6, 9]], torp: [70] },
        fn: { turrets: [[20, 1, 'l'], [40, 1, 'l'], [102, 1, 'r']],
              bridge: { x: 50, w: 16, style: 'tower' }, funnels: [[63, 6, 10, 1], [75, 6, 9, 1]], torp: [81] },
        rm: { turrets: [[22, 2, 'l'], [98, 2, 'r']],
              bridge: { x: 36, w: 14, style: 'tower' }, funnels: [[54, 7, 12, 1], [66, 7, 12, 1]], torp: [76] },
        sn: { turrets: [[20, 1, 'l'], [38, 1, 'l'], [98, 1, 'r']],
              bridge: { x: 48, w: 16, style: 'tower' }, funnels: [[66, 6, 10]], torp: [72], badge: 1 }
    },
    SS: {
        us: { gun: 1, sailX: 26, sailLen: 10, periscope: 1, snorkel: 1 },
        ijn: { hangar: 1, sailX: 22, sailLen: 9, periscope: 1, catapult: 1 },
        rn: { gun: 1, sailX: 24, sailLen: 16, periscope: 1, snorkel: 1 },
        km: { saddle: 1, gun: 1, sailX: 30, sailLen: 10, snorkel: 1 },
        fn: { gun: 1, gunBig: 1, sailX: 24, sailLen: 11, periscope: 1 },
        rm: { sailX: 27, sailLen: 12, periscope: 1 },
        sn: { sailX: 25, sailLen: 10, snorkel: 1, periscope: 1 }
    }
};

// ---------- 路径工具 ----------

// Catmull-Rom → Bezier 平滑闭合路径
function crPath(pts) {
    const n = pts.length;
    const P = (i) => pts[((i % n) + n) % n];
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
        const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
        const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d + ' Z';
}

// 上边缘关键点（y 为相对中线的归一化 -1..1），自动镜像出闭合轮廓
function mirrorPts(top, L, beam) {
    const cy = beam / 2;
    const full = top.map(([fx, fy]) => [fx * L, cy + fy * (beam / 2)]);
    const bottom = full.slice(0, -1).reverse().map(([x, y]) => [x, 2 * cy - y]);
    return full.concat(bottom);
}

// 甲板内缩轮廓（船首端额外收进）
function insetPts(pts, cy, fy, dx) {
    return pts.map(([x, y]) => [x < 8 ? x + dx : x, cy + (y - cy) * fy]);
}

// ---------- 部件绘制 ----------

function turret(x, cy, size, n, dir, elev, P, id) {
    const w = 26 * size, h = 21 * size;
    const bl = 18 * size, bw = 2.4 * size, gap = 4.9 * size;
    const n0 = (n - 1) / 2;
    let s = '';
    if (elev) s += `<ellipse cx="${x}" cy="${cy}" rx="${w * 0.7}" ry="${h * 0.8}" fill="${P.outline}" opacity="0.55"/>`;
    s += `<g transform="translate(${x},${cy})">`;
    for (let i = 0; i < n; i++) {
        const y = (i - n0) * gap;
        const bx = dir === 'l' ? -bl - w * 0.28 : w * 0.28;
        s += `<rect x="${bx.toFixed(1)}" y="${(y - bw / 2).toFixed(1)}" width="${bl.toFixed(1)}" height="${bw.toFixed(1)}" rx="${(bw / 2).toFixed(1)}" fill="url(#${id}-gBarrel)"/>`;
    }
    const hx = -w / 2;
    s += `<rect x="${hx.toFixed(1)}" y="${(-h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(4 * size).toFixed(1)}" fill="url(#${id}-gTur)" stroke="${P.outline}" stroke-width="${(0.8 * size).toFixed(2)}"/>`;
    // 炮塔顶部的测距仪小凸起
    const capX = dir === 'l' ? w * 0.2 : -w * 0.2;
    s += `<circle cx="${capX.toFixed(1)}" cy="0" r="${(2.2 * size).toFixed(1)}" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.5"/>`;
    s += '</g>';
    return s;
}

function funnel(x, cy, w, h, raked, P, id) {
    const rx = w / 2, ry = h / 2;
    const el = raked ? 1.25 : 1;
    let s = `<ellipse cx="${x}" cy="${cy}" rx="${(rx * el).toFixed(1)}" ry="${ry.toFixed(1)}" fill="url(#${id}-gFun)" stroke="${P.outline}" stroke-width="0.7"/>`;
    s += `<ellipse cx="${(x + (raked ? 1.5 : 0)).toFixed(1)}" cy="${cy}" rx="${(rx * 0.58).toFixed(1)}" ry="${(ry * 0.62).toFixed(1)}" fill="#151a1f"/>`;
    s += `<circle class="smk" cx="${x + rx + 5}" cy="${cy - 1}" r="2.4" fill="#c9d3d9"/>`;
    s += `<circle class="smk s2" cx="${x + rx + 12}" cy="${cy + 2}" r="1.8" fill="#b9c4cb"/>`;
    return s;
}

function superstructure(x, w, cy, beam, style, P, id) {
    const h = beam * (style === 'flat' ? 0.5 : 0.6);
    const top = cy - h / 2;
    let s = '';
    // 主甲板室
    s += `<rect x="${x}" y="${top.toFixed(1)}" width="${w}" height="${h.toFixed(1)}" rx="3" fill="url(#${id}-gSup)" stroke="${P.outline}" stroke-width="0.8"/>`;
    if (style === 'pagoda') {
        // 层叠宝塔桅
        const tiers = [[x + w * 0.18, w * 0.64, h * 0.62], [x + w * 0.30, w * 0.40, h * 0.40]];
        let ty = top;
        for (const [tx, tw, th] of tiers) {
            s += `<rect x="${tx.toFixed(1)}" y="${(ty - th * 0.35).toFixed(1)}" width="${tw.toFixed(1)}" height="${(th).toFixed(1)}" rx="2" fill="url(#${id}-gSup)" stroke="${P.outline}" stroke-width="0.7"/>`;
            ty -= th * 0.35;
        }
        s += `<line x1="${(x + w * 0.5).toFixed(1)}" y1="${(top - beam * 0.16).toFixed(1)}" x2="${(x + w * 0.5).toFixed(1)}" y2="${(top + 2).toFixed(1)}" stroke="${P.outline}" stroke-width="1.4"/>`;
        s += `<circle cx="${(x + w * 0.5).toFixed(1)}" cy="${(top - beam * 0.16).toFixed(1)}" r="1.8" fill="${P.sup}" stroke="${P.outline}" stroke-width="0.5"/>`;
    } else if (style === 'flat') {
        // 低平舰桥 + 小司令塔
        s += `<rect x="${(x + w * 0.32).toFixed(1)}" y="${(top - beam * 0.07).toFixed(1)}" width="${(w * 0.34).toFixed(1)}" height="${(beam * 0.34).toFixed(1)}" rx="2" fill="url(#${id}-gSup)" stroke="${P.outline}" stroke-width="0.7"/>`;
    } else {
        // 双层塔式舰桥
        s += `<rect x="${(x + w * 0.22).toFixed(1)}" y="${(top - beam * 0.06).toFixed(1)}" width="${(w * 0.52).toFixed(1)}" height="${(h * 0.7).toFixed(1)}" rx="2" fill="url(#${id}-gSup)" stroke="${P.outline}" stroke-width="0.7"/>`;
        s += `<line x1="${(x + w * 0.48).toFixed(1)}" y1="${(top - beam * 0.12).toFixed(1)}" x2="${(x + w * 0.48).toFixed(1)}" y2="${(top + 2).toFixed(1)}" stroke="${P.outline}" stroke-width="1.2"/>`;
        s += `<circle cx="${(x + w * 0.48).toFixed(1)}" cy="${(top - beam * 0.12).toFixed(1)}" r="1.6" fill="${P.sup}" stroke="${P.outline}" stroke-width="0.5"/>`;
    }
    // 两端的小舷窗点
    s += `<circle cx="${(x + w - 3).toFixed(1)}" cy="${(cy - h * 0.28).toFixed(1)}" r="1" fill="${P.outline}" opacity="0.6"/>`;
    return s;
}

function aaMounts(xs, cy, beam, P) {
    // 沿两舷的高炮群（上层建筑两侧）
    const y1 = cy - beam * 0.42, y2 = cy + beam * 0.42;
    let s = '';
    for (const x of (xs || [])) {
        for (const y of [y1, y2]) {
            for (let i = 0; i < 3; i++) {
                s += `<circle cx="${(x + i * 5.5).toFixed(1)}" cy="${y.toFixed(1)}" r="1.4" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.4"/>`;
            }
        }
    }
    return s;
}

function torpMount(x, cy, P, id) {
    return `<g>
        <rect x="${x}" y="${(cy - 4).toFixed(1)}" width="11" height="8" rx="2.5" fill="url(#${id}-gSup)" stroke="${P.outline}" stroke-width="0.6"/>
        <circle cx="${x + 4}" cy="${cy}" r="1.3" fill="${P.barrel}"/>
        <circle cx="${x + 7.5}" cy="${cy}" r="1.3" fill="${P.barrel}"/>
    </g>`;
}

function deckPlane(x, y, rot, P) {
    return `<g transform="translate(${x},${y}) rotate(${rot})">
        <path d="M -7 0 L -2 -1.3 L 4 -1.1 L 7.5 0 L 4 1.1 L -2 1.3 Z" fill="${P.plane}" stroke="${P.outline}" stroke-width="0.5"/>
        <path d="M -1.6 0 L 0.6 -4.4 L 1.9 -4.1 L 1.6 0 L 1.9 4.1 L 0.6 4.4 Z" fill="${P.plane}" stroke="${P.outline}" stroke-width="0.4"/>
        <circle cx="6" cy="0" r="0.9" fill="${P.outline}"/>
    </g>`;
}

function catapult(x, y, len, P) {
    return `<line x1="${x}" y1="${y}" x2="${x + len}" y2="${y + 3}" stroke="${P.supLo}" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>`;
}

// ---------- 船体轮廓点集 ----------

const HULL_SHAPES = {
    BB: [[0, 0], [0.04, -0.55], [0.10, -0.80], [0.17, -0.92], [0.30, -0.97], [0.55, -0.97], [0.75, -0.95], [0.88, -0.85], [0.955, -0.55], [0.995, 0]],
    BB_CLIPPER: [[0, 0], [0.05, -0.45], [0.13, -0.82], [0.22, -0.94], [0.36, -0.97], [0.58, -0.97], [0.76, -0.95], [0.885, -0.85], [0.955, -0.55], [0.995, 0]],
    CL: [[0, 0], [0.045, -0.50], [0.12, -0.78], [0.20, -0.90], [0.38, -0.95], [0.62, -0.95], [0.80, -0.92], [0.91, -0.78], [0.975, -0.45], [1.0, 0]],
    DD: [[0, 0], [0.05, -0.50], [0.13, -0.76], [0.22, -0.88], [0.40, -0.93], [0.60, -0.93], [0.78, -0.90], [0.90, -0.74], [0.965, -0.42], [1.0, 0]]
};

// ---------- 渐变与滤镜 ----------

function svgDefs(id, P) {
    return `<defs>
        <linearGradient id="${id}-gHull" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${P.hullLo}"/><stop offset="0.5" stop-color="${P.hullHi}"/><stop offset="1" stop-color="${P.hullLo}"/>
        </linearGradient>
        <linearGradient id="${id}-gDeck" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${P.deckLo}"/><stop offset="0.5" stop-color="${P.deckHi}"/><stop offset="1" stop-color="${P.deckLo}"/>
        </linearGradient>
        <linearGradient id="${id}-gTur" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${P.supLo}"/><stop offset="0.5" stop-color="${P.sup}"/><stop offset="1" stop-color="${P.supLo}"/>
        </linearGradient>
        <linearGradient id="${id}-gSup" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${P.supLo}"/><stop offset="0.5" stop-color="${P.sup}"/><stop offset="1" stop-color="${P.supLo}"/>
        </linearGradient>
        <linearGradient id="${id}-gBarrel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${P.barrel}"/><stop offset="1" stop-color="#3a4249"/>
        </linearGradient>
        <radialGradient id="${id}-gFun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.6" stop-color="${P.fun}"/><stop offset="1" stop-color="${P.outline}"/>
        </radialGradient>
        <filter id="${id}-fSh" x="-15%" y="-40%" width="130%" height="180%">
            <feDropShadow dx="1.2" dy="2" stdDeviation="1.4" flood-color="#000" flood-opacity="0.45"/>
        </filter>
    </defs>`;
}

// ---------- 各舰种绘制 ----------

function drawWarship(code, lay, P, id) {
    const L = HULL_LEN[code], B = lay.beam || HULL_BEAM[code];
    const cy = B / 2;
    const shape = lay.bow === 'clipper' ? HULL_SHAPES.BB_CLIPPER : HULL_SHAPES[code];
    const hullPts = mirrorPts(shape, L, B);
    const deckPts = insetPts(hullPts, cy, 0.84, 7);
    const scale = code === 'BB' ? 1 : (code === 'CL' ? 0.72 : 0.55);

    let s = `<path d="${crPath(hullPts)}" fill="url(#${id}-gHull)" stroke="${P.outline}" stroke-width="1.5" vector-effect="non-scaling-stroke" filter="url(#${id}-fSh)"/>`;
    // 甲板
    s += `<path d="${crPath(deckPts)}" fill="url(#${id}-gDeck)" stroke="${P.outline}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>`;
    // 甲板铺装纹理
    s += `<clipPath id="${id}-clipDeck"><path d="${crPath(deckPts)}"/></clipPath>`;
    s += `<g clip-path="url(#${id}-clipDeck)">`;
    if (P.deckStyle === 'wood') {
        for (let x = 10; x < L - 8; x += 6) {
            s += `<line x1="${x}" y1="0" x2="${x}" y2="${B}" stroke="${P.deckLo}" stroke-width="0.7" opacity="0.55"/>`;
        }
    } else {
        for (let x = 14; x < L - 8; x += 13) {
            s += `<line x1="${x}" y1="0" x2="${x}" y2="${B}" stroke="${P.deckHi}" stroke-width="0.6" opacity="0.4"/>`;
        }
    }
    s += `</g>`;

    // 分层绘制：下层炮塔 → 上层建筑 → 叠炮 → 烟囱 → 杂项
    const turrets = lay.turrets || [];
    for (const t of turrets) {
        if (!t[3]) s += turret(t[0], cy, scale, t[1], t[2], false, P, id);
    }
    if (lay.bridge) {
        s += superstructure(lay.bridge.x, lay.bridge.w, cy, B, lay.bridge.style, P, id);
        if (lay.aa) s += aaMounts(lay.aa, cy, B, P);
    }
    for (const t of turrets) {
        if (t[3]) s += turret(t[0], cy, scale, t[1], t[2], true, P, id);
    }
    for (const f of (lay.funnels || [])) {
        s += funnel(f[0], cy, f[1], f[2], !!f[3], P, id);
    }
    for (const x of (lay.torp || [])) {
        s += torpMount(x, cy, P, id);
    }
    if (lay.catapult) {
        s += catapult(L - 42, cy - B * 0.28, 26, P);
        if (lay.catapult > 1) s += catapult(L - 42, cy + B * 0.28, 26, P);
        s += deckPlane(L - 22, cy, 90, P);
        if (lay.plane > 1) s += deckPlane(L - 34, cy + B * 0.3, 90, P);
    } else if (lay.plane) {
        s += deckPlane(L - 22, cy, 90, P);
    }
    if (lay.crane) {
        s += `<line x1="${L - 30}" y1="${cy - B * 0.3}" x2="${L - 18}" y2="${cy + B * 0.25}" stroke="${P.supLo}" stroke-width="1.4" stroke-linecap="round"/>`;
        if (lay.plane) s += deckPlane(L - 38, cy - B * 0.25, 90, P);
    }
    if (lay.badge) {
        s += `<circle cx="${L - 16}" cy="${cy - B * 0.26}" r="3.2" fill="${P.accent}" stroke="#fff" stroke-width="0.8"/>`;
    }
    return s;
}

function drawCV(lay, P, id) {
    const L = 240, B = 50;
    const cy = B / 2;
    const closed = !!lay.closedBow;
    // 飞行甲板轮廓
    const top = closed
        ? [[0.02, -0.80], [0.08, -0.94], [0.90, -0.94], [0.97, -0.86], [1.0, -0.5], [1.0, 0]]
        : [[0.0, -0.55], [0.06, -0.90], [0.90, -0.94], [0.97, -0.86], [1.0, -0.5], [1.0, 0]];
    const deckPts = mirrorPts(top, L, B);
    let s = `<path d="${crPath(deckPts)}" fill="url(#${id}-gDeck)" stroke="${P.outline}" stroke-width="1.5" vector-effect="non-scaling-stroke" filter="url(#${id}-fSh)"/>`;
    s += `<clipPath id="${id}-clipDeck"><path d="${crPath(deckPts)}"/></clipPath>`;
    s += `<g clip-path="url(#${id}-clipDeck)">`;
    // 甲板中线
    s += `<line x1="${closed ? 14 : 20}" y1="${cy}" x2="${L - 12}" y2="${cy}" stroke="rgba(255,255,255,0.85)" stroke-width="1.6" stroke-dasharray="14 8"/>`;
    // 跑道端部横纹
    for (let i = 0; i < 5; i++) {
        s += `<line x1="${26 + i * 5}" y1="${cy - 9 + i * 0.8}" x2="${26 + i * 5}" y2="${cy + 9 - i * 0.8}" stroke="rgba(255,255,255,0.6)" stroke-width="1.4"/>`;
    }
    if (lay.mark === 'ring') {
        s += `<circle cx="${L * 0.42}" cy="${cy}" r="13" fill="none" stroke="#d64b4b" stroke-width="3.2"/>`;
        s += `<line x1="${L * 0.62}" y1="${cy - 8}" x2="${L * 0.70}" y2="${cy - 14}" stroke="rgba(255,255,255,0.75)" stroke-width="2.6"/>`;
        s += `<line x1="${L * 0.62}" y1="${cy + 8}" x2="${L * 0.70}" y2="${cy + 14}" stroke="rgba(255,255,255,0.75)" stroke-width="2.6"/>`;
    }
    // 升降机
    for (const ex of (lay.elev || [])) {
        s += `<rect x="${ex}" y="${cy - 10}" width="14" height="20" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1" stroke-dasharray="3 2"/>`;
        s += `<rect x="${ex + 1}" y="${cy - 9}" width="12" height="18" fill="rgba(0,0,0,0.14)"/>`;
    }
    s += `</g>`;
    // 舷侧烟囱
    for (const fx of (lay.sidefun || [])) {
        s += `<ellipse cx="${fx}" cy="${cy + 15}" rx="4.5" ry="3" fill="url(#${id}-gFun)" stroke="${P.outline}" stroke-width="0.6"/>`;
    }
    // 舰岛（右舷 = 下侧，保持在画布内）
    const ix = lay.islandX, iy = B - 15;
    s += `<rect x="${ix}" y="${iy - 4}" width="42" height="16" rx="3" fill="url(#${id}-gSup)" stroke="${P.outline}" stroke-width="0.9"/>`;
    s += `<rect x="${ix + 8}" y="${iy - 9}" width="22" height="10" rx="2" fill="url(#${id}-gSup)" stroke="${P.outline}" stroke-width="0.7"/>`;
    if (lay.twinFun) {
        s += funnel(ix + 10, iy + 4, 7, 9, false, P, id);
        s += funnel(ix + 26, iy + 4, 7, 9, false, P, id);
    } else {
        s += funnel(ix + 18, iy + 4, 9, 11, false, P, id);
    }
    s += `<line x1="${ix + 36}" y1="${iy - 8}" x2="${ix + 36}" y2="${iy - 2}" stroke="${P.outline}" stroke-width="1.3"/>`;
    s += `<circle cx="${ix + 36}" cy="${iy - 9}" r="1.8" fill="${P.sup}" stroke="${P.outline}" stroke-width="0.5"/>`;
    // 弹射器
    if (lay.catapults) {
        s += catapult(L - 46, cy + 6, 30, P);
        if (lay.catapults > 2) s += catapult(L - 76, cy + 8, 26, P);
    }
    // 停放的舰载机
    const planePos = { 1: [[128, cy - 12, 0]], 2: [[112, cy - 12, 0], [120, cy + 12, 0]],
        3: [[100, cy - 12, 0], [108, cy + 12, 0], [150, cy - 12, 0]],
        4: [[104, cy - 12, 0], [112, cy + 12, 0], [148, cy - 12, 90], [156, cy + 12, 90]] };
    for (const [px, py, rot] of (planePos[lay.planes] || [])) {
        s += deckPlane(px, py, rot, P);
    }
    // 舷号
    s += `<text x="${L - 10}" y="${cy + 4}" text-anchor="end" font-size="11" font-weight="bold" fill="rgba(255,255,255,0.8)" font-family="monospace">${lay.num}</text>`;
    return s;
}

function drawSS(lay, P, id) {
    const L = 60, B = 16, cy = B / 2;
    let s = `<rect x="1" y="1.5" width="${L - 2}" height="${B - 3}" rx="7.5" fill="url(#${id}-gHull)" stroke="${P.outline}" stroke-width="1.3" vector-effect="non-scaling-stroke" filter="url(#${id}-fSh)"/>`;
    if (lay.saddle) {
        s += `<rect x="14" y="1" width="30" height="3" rx="1.5" fill="${P.hullLo}" stroke="${P.outline}" stroke-width="0.5"/>`;
        s += `<rect x="14" y="${B - 4}" width="30" height="3" rx="1.5" fill="${P.hullLo}" stroke="${P.outline}" stroke-width="0.5"/>`;
    }
    if (lay.hangar) {
        s += `<rect x="34" y="${cy - 3.5}" width="12" height="7" rx="2" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.5"/>`;
    }
    if (lay.gun) {
        const r = lay.gunBig ? 2.6 : 2;
        s += `<circle cx="${lay.hangar ? 12 : 9}" cy="${cy}" r="${r}" fill="url(#${id}-gTur)" stroke="${P.outline}" stroke-width="0.5"/>`;
        s += `<line x1="${(lay.hangar ? 12 : 9) - r}" y1="${cy}" x2="${(lay.hangar ? 12 : 9) - r - 6}" y2="${cy}" stroke="${P.barrel}" stroke-width="1.4" stroke-linecap="round"/>`;
    }
    if (lay.catapult) {
        s += catapult(40, cy - 4, 12, P);
    }
    // 指挥台围壳（长度沿船长轴，宽度受艇宽约束）
    const sLen = lay.sailLen || 9;
    const sWid = Math.min(lay.sailW || 8, B - 6);
    const sx = lay.sailX || 26;
    s += `<rect x="${sx}" y="${(cy - sWid / 2).toFixed(1)}" width="${sLen}" height="${sWid.toFixed(1)}" rx="2.5" fill="url(#${id}-gSup)" stroke="${P.outline}" stroke-width="0.7"/>`;
    if (lay.periscope) s += `<line x1="${sx + sLen - 2}" y1="${cy - 2}" x2="${sx + sLen + 2}" y2="${cy - 2}" stroke="#aab6bd" stroke-width="1.1"/>`;
    if (lay.snorkel) s += `<line x1="${sx + sLen - 2}" y1="${cy + 2.5}" x2="${sx + sLen + 3}" y2="${cy + 2.5}" stroke="#8b979e" stroke-width="1.3"/>`;
    // 艇身压载舱分段线
    s += `<line x1="6" y1="${cy - 5.5}" x2="${L - 8}" y2="${cy - 5.5}" stroke="${P.outline}" stroke-width="0.4" opacity="0.45"/>`;
    s += `<line x1="6" y1="${cy + 5.5}" x2="${L - 8}" y2="${cy + 5.5}" stroke="${P.outline}" stroke-width="0.4" opacity="0.45"/>`;
    return s;
}

// ---------- 主入口 ----------

// 渐变/滤镜的 id 必须逐实例唯一：同款舰船会在船坞、帮助弹窗、棋盘上同时存在，
// 重复 id 会让浏览器解析到先出现的（可能处于 display:none 的）defs，填充直接失效
let artSeq = 0;

export function getShipSvg(code, factionId = 'us') {
    const P = PALETTES[factionId] || PALETTES.us;
    const lay = (LAYOUTS[code] || {})[factionId] || (LAYOUTS[code] || {}).us;
    if (!lay) return '';
    const L = HULL_LEN[code];
    const B = (code === 'CV' || code === 'SS') ? HULL_BEAM[code] : (lay.beam || HULL_BEAM[code]);
    const id = `${code.toLowerCase()}-${factionId}-${++artSeq}`;

    let body = '';
    if (code === 'CV') body = drawCV(lay, P, id);
    else if (code === 'SS') body = drawSS(lay, P, id);
    else body = drawWarship(code, lay, P, id);

    return `<svg class="ship-svg" viewBox="0 0 ${L} ${B}" width="${L}" height="${B}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${svgDefs(id, P)}${body}</svg>`;
}

export const SHIP_ART_BEAM = HULL_BEAM;
export const SHIP_ART_LAYOUTS = LAYOUTS;
