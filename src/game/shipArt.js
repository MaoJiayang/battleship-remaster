// src/game/shipArt.js
// 舰船 SVG 建模系统 - 数据驱动生成内联 SVG（俯视视角，船首朝左）
// 阵营 = 调色板 + 装备布局，全部矢量绘制，零外部资源

const HULL_LEN = { BB: 240, CV: 240, CL: 170, DD: 120, SS: 60 };
const HULL_BEAM = { BB: 44, CV: 38, CL: 30, DD: 22, SS: 10 };

// ---------- 调色板 ----------
// hullLo/hullHi: 船体钢板色; deckLo/deckHi: 甲板色; sup: 上层建筑
const PALETTES = {
    us: { hullLo: '#2e4053', hullHi: '#a3b8cc', deckLo: '#52697e', deckHi: '#839cae',
          sup: '#b8c8d8', supLo: '#74889c', outline: '#0c1218', barrel: '#141a20',
          deckStyle: 'steel', plane: '#c3d2e0', air: '#c2d1de', airTrim: '#3c5369', accent: '#63b3ed', fun: '#2c3a48' },
    ijn: { hullLo: '#4a3623', hullHi: '#b08a5a', deckLo: '#8a6136', deckHi: '#b58a52',
          sup: '#c0baa4', supLo: '#837c66', outline: '#170f08', barrel: '#1e150c',
          deckStyle: 'wood', plane: '#a8b894', air: '#b4b78f', airTrim: '#5f5a33', accent: '#ed8936', fun: '#241a10' },
    rn: { hullLo: '#38434f', hullHi: '#9dabb8', deckLo: '#8f6c48', deckHi: '#b08a63',
          sup: '#aab6c2', supLo: '#6f7c89', outline: '#0d1218', barrel: '#161c22',
          deckStyle: 'wood', plane: '#c4cfd8', air: '#b7c3bd', airTrim: '#40564a', accent: '#68d391', fun: '#262f38' },
    km: { hullLo: '#4b555f', hullHi: '#b7c1cb', deckLo: '#5a646e', deckHi: '#828d98',
          sup: '#c8d0d8', supLo: '#818c96', outline: '#14171b', barrel: '#1c2024',
          deckStyle: 'steel', plane: '#d4dade', air: '#c9ced2', airTrim: '#4a545d', accent: '#cbd5e0', fun: '#31363b' },
    fn: { hullLo: '#334055', hullHi: '#9aabc4', deckLo: '#8a6138', deckHi: '#b0854f',
          sup: '#b4c2d4', supLo: '#76879c', outline: '#0e131c', barrel: '#151b24',
          deckStyle: 'wood', plane: '#c0cbda', air: '#b7c5d6', airTrim: '#384d66', accent: '#fc8181', fun: '#28323f' },
    rm: { hullLo: '#4d5040', hullHi: '#b4b894', deckLo: '#8f7248', deckHi: '#b39263',
          sup: '#c2c6a8', supLo: '#8a8e6e', outline: '#14150f', barrel: '#1e1f18',
          deckStyle: 'wood', plane: '#b6c0a2', air: '#c3bc98', airTrim: '#5d5836', accent: '#f6e05e', fun: '#33352a' },
    sn: { hullLo: '#2f3d34', hullHi: '#90a695', deckLo: '#4a5a4e', deckHi: '#75887b',
          sup: '#a8bcae', supLo: '#6d7f72', outline: '#0d130f', barrel: '#151b17',
          deckStyle: 'steel', plane: '#b2beb4', air: '#b1c0b2', airTrim: '#3d5142', accent: '#f56565', fun: '#222d26' }
};

// ---------- 装备布局 ----------
// turrets: [x, 炮管数, 'l'|'r', 是否叠炮(画在上层)]  x = 炮塔中心
// bridge: { x, w, style: 'tower'|'pagoda'|'flat' }
// funnels: [x, 宽, 高, 后倾?]  宽=沿船长轴
// torp: [x] 鱼雷管
const LAYOUTS = {
    // 布局按各国代表舰型：美/日/意/苏三座三联装，德四座双联装，
    // 英「两座四联装 + 一座双联装」首尾布置，法两座四联装全前置
    BB: {
        us: { beam: 44, turrets: [[42, 3, 'l'], [70, 3, 'l', 1], [178, 3, 'r']],
              bridge: { x: 86, w: 40, style: 'tower' }, funnels: [[136, 15, 10], [150, 12, 8]],
              aa: [112, 160], aa40: [95, 120, 166], rafts: [34, 106, 120, 168],
              boats: [[130, -1, 15], [130, 1, 15], [151, -1, 11], [151, 1, 11]],
              catapult: 1, plane: 1 },
        ijn: { beam: 48, turrets: [[42, 3, 'l'], [70, 3, 'l', 1], [178, 3, 'r']],
              bridge: { x: 86, w: 42, style: 'pagoda' }, funnels: [[142, 22, 15, 1]],
              aa: [110], aa40: [98, 120, 166], rafts: [34, 92, 120, 166],
              boats: [[132, -1, 14], [132, 1, 14], [154, -1, 11], [154, 1, 11]],
              catapult: 2, plane: 2 },
        rn: { beam: 44, turrets: [[42, 4, 'l'], [70, 4, 'l', 1], [184, 2, 'r']],
              bridge: { x: 92, w: 44, style: 'tower' }, funnels: [[150, 15, 10], [164, 12, 8]],
              aa: [144, 176], aa40: [104, 138, 186], rafts: [34, 110, 168],
              boats: [[126, -1, 14], [126, 1, 14], [158, -1, 14], [158, 1, 14]],
              catapult: 1, plane: 1 },
        km: { beam: 44, turrets: [[42, 2, 'l'], [70, 2, 'l', 1], [172, 2, 'r', 1], [200, 2, 'r']],
              bridge: { x: 86, w: 42, style: 'flat' }, funnels: [[140, 21, 14]],
              aa: [118, 156], aa40: [104, 170, 184], rafts: [34, 108, 138, 178],
              boats: [[130, -1, 14], [130, 1, 14], [146, -1, 11], [146, 1, 11]] },
        // 黎塞留：两座四联装全前置；后部上层建筑三座三联 152 副炮（艏向一座 + 艉向叠炮两座）
        fn: { beam: 44, turrets: [[44, 4, 'l'], [84, 4, 'l', 1]],
              sec: [[170, 3, 'l'], [200, 3, 'r'], [186, 3, 'r', 1]],
              bridge: { x: 104, w: 38, style: 'tower' }, funnels: [[148, 15, 12]],
              aa: [150, 194], aa40: [112, 128, 184], rafts: [34, 120, 176],
              boats: [[138, -1, 12], [138, 1, 12], [160, -1, 10], [160, 1, 10]],
              plane: 1 },
        rm: { beam: 44, turrets: [[42, 3, 'l'], [70, 3, 'l', 1], [180, 3, 'r']],
              bridge: { x: 88, w: 40, style: 'tower' }, funnels: [[142, 14, 9, 1], [155, 11, 8, 1]],
              aa: [136, 166], aa40: [110, 146, 176], rafts: [34, 118, 188],
              boats: [[124, -1, 14], [124, 1, 14], [156, -1, 11], [156, 1, 11]],
              catapult: 1, plane: 1 },
        sn: { beam: 48, turrets: [[42, 3, 'l'], [70, 3, 'l', 1], [180, 3, 'r']],
              bridge: { x: 86, w: 36, style: 'tower' }, funnels: [[132, 19, 12], [151, 13, 9]],
              aa: [112, 160], aa40: [102, 124, 170], rafts: [34, 106, 186],
              boats: [[134, -1, 14], [134, 1, 14], [148, -1, 11], [148, 1, 11]],
              badge: 1, catapult: 1 }
    },
    CV: {
        // deck 按各国实舰俯视平面：hw=甲板半宽, nose=艏端半宽, stern=艉部圆弧深度
        // 美：长方甲板 + 方艉；日：长艏收尖 + 大圆艉；英：长圆艉 + 甲板边线；
        // 法：短阔钝艏 + 大圆艉；意/苏：窄长尖艏
        us: { island: 'us', num: '9', islandX: 154, span: [2, 238],
              deck: { hw: 15.2, nose: 12.0, bowLen: 20, corner: 2.8, stern: 4 },
              elev: [76, 168], elevSize: [13, 11.5], edgeElev: 122, cats: 2, planes: 4,
              sponsons: [[62, -1], [96, 1], [204, -1], [212, 1]], aa: [54, 218] },
        ijn: { island: 'ijn', islandX: 140, span: [2, 238],
              deck: { hw: 14.2, nose: 6.4, bowLen: 30, corner: 1.8, stern: 11 },
              elev: [72, 134, 196], elevSize: [12, 10.5], sidefun: [164], planes: 2,
              planeSpots: [[150, 8.5, 180], [176, 7.5, 176]],
              sponsons: [[56, -1], [56, 1], [80, -1], [80, 1], [104, -1], [104, 1], [176, -1], [176, 1], [212, -1], [212, 1]],
              aa: [64, 190] },
        rn: { island: 'rn', islandX: 142, span: [6, 234],
              deck: { hw: 14.5, nose: 8.6, bowLen: 32, corner: 2.6, stern: 8 },
              elev: [70, 128, 196], elevSize: [11.5, 10], cats: 2, catLen: 22,
              edgeLines: 2, planes: 3,
              planeSpots: [[98, -8.8, 180], [116, 8.8, 176], [136, -8.8, 184]],
              sponsons: [[58, -1], [86, 1], [172, -1], [192, 1]], aa: [50, 206] },
        km: { island: 'km', islandX: 150, span: [2, 238],
              deck: { hw: 15.0, nose: 11.0, bowLen: 22, corner: 2.4, stern: 5 },
              elev: [68, 130, 194], elevSize: [13, 11], oct: 1, cats: 2, planes: 1,
              planeSpots: [[112, 8.2, 178]],
              sponsons: [[60, -1], [60, 1], [212, -1], [212, 1]], aa: [76, 188] },
        fn: { island: 'fn', islandX: 124, span: [22, 216],
              deck: { hw: 16.3, nose: 12.2, bowLen: 15, corner: 3.4, stern: 12 },
              elev: [66, 128, 198], elevSize: [12, 11], edgeLines: 1, planes: 3,
              planeSpots: [[74, -8.8, 180], [92, 8.8, 176], [108, -8.8, 184]],
              sponsons: [[58, -1], [90, 1], [176, -1], [212, 1]], aa: [86, 190] },
        rm: { island: 'rm', islandX: 140, span: [14, 228],
              deck: { hw: 14.0, nose: 6.0, bowLen: 30, corner: 2.0, stern: 7 },
              elev: [82, 174], elevSize: [12, 10.5], cats: 2, planes: 3,
              planeSpots: [[96, -8.8, 180], [114, 8.8, 176], [152, -8.8, 184]],
              sponsons: [[66, -1], [66, 1], [196, -1], [196, 1]], aa: [108, 204] },
        sn: { island: 'sn', islandX: 146, span: [16, 226],
              deck: { hw: 14.7, nose: 6.8, bowLen: 30, corner: 2.0, stern: 6 },
              elev: [80, 172], elevSize: [12, 10.5], cats: 2, planes: 2,
              planeSpots: [[96, -8.8, 180], [118, 8.8, 176]],
              sponsons: [[64, -1], [64, 1], [202, -1], [202, 1]], aa: [62, 196] }
    },
    CL: {
        // 克利夫兰级：4 座三联装；巴尔的摩式重巡也归入本类
        us: { turrets: [[28, 3, 'l'], [50, 3, 'l', 1], [120, 3, 'r', 1], [140, 3, 'r']],
              bridge: { x: 68, w: 22, style: 'tower' }, funnels: [[96, 10, 6], [107, 10, 6]],
              aa: [58], aa40: [78, 116, 136], rafts: [84, 130, 152],
              boats: [[94, -1, 9], [94, 1, 9], [106, -1, 7], [106, 1, 7]] },
        // 最上级（建造时）：5 座三联装，艏部两座叠炮、烟囱后一座前向、艉部两座
        ijn: { turrets: [[26, 3, 'l'], [44, 3, 'l', 1], [127, 3, 'l'], [141, 3, 'r', 1], [156, 3, 'r']],
              bridge: { x: 72, w: 24, style: 'pagoda' }, funnels: [[96, 12, 8, 1], [108, 10, 8, 1]],
              aa: [94], aa40: [82, 128, 146], rafts: [64, 86, 152],
              boats: [[104, -1, 9], [104, 1, 9], [118, -1, 7], [118, 1, 7]],
              torp: [[134, 3, -1, 7], [134, 3, 1, 7]] },
        // 城级：4 座三联装，两舷各一具三联鱼雷发射管
        rn: { turrets: [[30, 3, 'l'], [54, 3, 'l', 1], [127, 3, 'r', 1], [147, 3, 'r']],
              bridge: { x: 74, w: 22, style: 'tower' }, funnels: [[103, 10, 8], [113, 10, 8]],
              aa: [66], aa40: [82, 130, 144], rafts: [54, 88, 154],
              boats: [[100, -1, 9], [100, 1, 9], [112, -1, 7], [112, 1, 7]],
              torp: [[121, 3, -1, 7], [121, 3, 1, 7]] },
        // 希佩尔级：4 座双联装，两舷各两具三联鱼雷发射管
        km: { turrets: [[30, 2, 'l'], [54, 2, 'l', 1], [130, 2, 'r', 1], [148, 2, 'r']],
              bridge: { x: 78, w: 26, style: 'tower' }, funnels: [[112, 16, 9, 1]],
              aa: [70], aa40: [80, 110, 142], rafts: [60, 96, 156],
              boats: [[122, -1, 9], [122, 1, 9], [136, -1, 7], [136, 1, 7]],
              torp: [[90, 3, -1, 6.5], [99, 3, -1, 6.5], [90, 3, 1, 6.5], [99, 3, 1, 6.5]] },
        // 拉加利索尼埃级：3 座三联装（前二后一），两舷各一具三联鱼雷发射管
        fn: { turrets: [[28, 3, 'l'], [52, 3, 'l', 1], [142, 3, 'r']],
              bridge: { x: 70, w: 22, style: 'tower' }, funnels: [[100, 11, 9, 1], [111, 10, 8, 1]],
              aa: [66], aa40: [80, 128, 142], rafts: [60, 88, 152],
              boats: [[96, -1, 9], [96, 1, 9], [108, -1, 7], [108, 1, 7]],
              torp: [[122, 3, -1, 7], [122, 3, 1, 7]] },
        // 扎拉级：4 座双联装，无鱼雷管
        rm: { turrets: [[30, 2, 'l'], [54, 2, 'l', 1], [127, 2, 'r', 1], [147, 2, 'r']],
              bridge: { x: 76, w: 20, style: 'tower' }, funnels: [[102, 12, 8, 1], [113, 10, 7, 1]],
              aa: [64], aa40: [84, 122, 140], rafts: [60, 88, 152],
              boats: [[98, -1, 9], [98, 1, 9], [112, -1, 7], [112, 1, 7]] },
        // 基洛夫级：3 座三联装，两舷各一具三联鱼雷发射管
        sn: { turrets: [[30, 3, 'l'], [58, 3, 'l', 1], [140, 3, 'r']],
              bridge: { x: 74, w: 24, style: 'tower' }, funnels: [[104, 12, 8], [116, 12, 8]],
              aa: [66], aa40: [84, 126, 142], rafts: [62, 88, 156],
              boats: [[100, -1, 9], [100, 1, 9], [112, -1, 7], [112, 1, 7]],
              torp: [[120, 3, -1, 6.5], [120, 3, 1, 6.5]], badge: 1 }
    },
    DD: {
        // 弗莱彻级：5 座单装（前二后三），两具五联装鱼雷
        us: { turrets: [[19, 1, 'l'], [34, 1, 'l', 1], [88, 1, 'r', 1], [98.5, 1, 'r'], [109, 1, 'r']],
              bridge: { x: 41, w: 11, style: 'tower' }, funnels: [[56, 8, 5], [64, 7, 5]],
              torp: [[71, 5, 0, 6.2], [79, 5, 0, 6.2]] },
        // 阳炎级：3 座双联装（前二后一），两具四联装鱼雷
        ijn: { turrets: [[20, 2, 'l'], [36, 2, 'l', 1], [106, 2, 'r']],
              bridge: { x: 46, w: 13, style: 'pagoda' }, funnels: [[64, 10, 6, 1], [75, 9, 6, 1]],
              torp: [[84, 4, 0, 8], [93, 4, 0, 8]] },
        // 部族级：4 座双联装，一具四联装鱼雷
        rn: { turrets: [[20, 2, 'l'], [36, 2, 'l', 1], [95, 2, 'r', 1], [106.5, 2, 'r']],
              bridge: { x: 46, w: 12, style: 'tower' }, funnels: [[63, 10, 5], [74, 9, 5]],
              torp: [[82.5, 4, 0, 7.2]] },
        // 1936A 型：前 1 座双联装，后 3 座单装；两具四联装鱼雷
        km: { turrets: [[22, 2, 'l'], [88, 1, 'r', 1], [98.5, 1, 'r'], [109, 1, 'r']],
              bridge: { x: 42, w: 10, style: 'flat' }, funnels: [[57, 7, 5], [64, 7, 5]],
              torp: [[71.5, 4, 0, 6.2], [79.5, 4, 0, 6.2]] },
        // 空想级：5 座单装（前二后三），三具三联装鱼雷
        fn: { turrets: [[19, 1, 'l'], [34, 1, 'l', 1], [88, 1, 'r', 1], [98.5, 1, 'r'], [109, 1, 'r']],
              bridge: { x: 41, w: 11, style: 'tower' }, funnels: [[56, 7, 5, 1], [64, 7, 5, 1]],
              torp: [[71, 3, 0, 6.2], [78.5, 3, -1, 6.2], [78.5, 3, 1, 6.2]] },
        // 士兵级：2 座双联装（前一后一），两具三联装鱼雷
        rm: { turrets: [[20, 2, 'l'], [105, 2, 'r']],
              bridge: { x: 44, w: 13, style: 'tower' }, funnels: [[62, 8, 5], [71, 8, 5]],
              torp: [[79.5, 3, 0, 7.5], [88, 3, 0, 7.5]] },
        // 愤怒级：4 座单装，两舷各一具三联装鱼雷
        sn: { turrets: [[20, 1, 'l'], [36, 1, 'l', 1], [96, 1, 'r', 1], [108, 1, 'r']],
              bridge: { x: 46, w: 13, style: 'tower' }, funnels: [[68, 11, 6]],
              torp: [[80, 3, -1, 7], [80, 3, 1, 7]] }
    },
    SS: {
        us: { gun: 1, sailX: 26, sailLen: 10, periscope: 1, snorkel: 1 },
        // 伊四百：艏部弹射器 → 前部机库 → 围壳 → 尾部 14cm 甲板炮
        ijn: { hangar: 1, sailX: 29, sailLen: 8, periscope: 1, catapultFwd: 1, seaplane: 1, gun: 1, gunAft: 1 },
        rn: { gun: 1, sailX: 24, sailLen: 16, periscope: 1, snorkel: 1 },
        km: { saddle: 1, gun: 1, sailX: 30, sailLen: 10, snorkel: 1 },
        // 絮库夫：双联 203mm 炮塔 + 围壳后方机库
        fn: { gun: 1, gunBig: 1, hangarAft: 1, sailX: 25, sailLen: 10, periscope: 1 },
        rm: { gun: 1, sailX: 27, sailLen: 12, periscope: 1 },
        sn: { gun: 1, sailX: 25, sailLen: 10, snorkel: 1, periscope: 1 }
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
// 中线上的点不参与镜像，避免首尾出现重复点被曲线拉出尖角
function mirrorPts(top, L, beam) {
    const cy = beam / 2;
    const full = top.map(([fx, fy]) => [fx * L, cy + fy * (beam / 2)]);
    const bottom = [];
    for (let i = full.length - 1; i >= 0; i--) {
        if (Math.abs(full[i][1] - cy) < 0.01) continue;
        bottom.push([full[i][0], 2 * cy - full[i][1]]);
    }
    return full.concat(bottom);
}

// 颜色混合（用于从调色板推导船体侧面/暗部）
function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (sh) => {
        const va = (pa >> sh) & 255, vb = (pb >> sh) & 255;
        return Math.round(va + (vb - va) * t);
    };
    return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('');
}

// 甲板内缩轮廓（船首端额外收进，收进量沿首部平滑衰减，避免折线抖动）
function insetPts(pts, cy, fy, dx) {
    const k = 20;
    return pts.map(([x, y]) => {
        const t = Math.max(0, 1 - x / k);
        return [x + dx * t * t, cy + (y - cy) * fy];
    });
}

// ---------- 部件绘制 ----------

function turret(x, cy, size, n, dir, elev, P, id, factionId) {
    // 俯视炮塔比例：按真实炮塔/舰宽比压窄；联装数越多横向越宽，纵深（船长向）保持扁长
    const trait = TURRET_TRAITS[factionId] || TURRET_TRAITS.us;
    const w = (n === 1 ? 12 : n === 2 ? 14 : n === 4 ? 19 : 15) * size * (trait.wMul || 1);
    const h = (n === 1 ? 12.5 : n === 2 ? 12.5 : n === 4 ? 16 : 13.5) * size;
    // 炮管长度按舰种分级：主力舰长身管，小舰炮管相对短，避免顶出艏艉
    const blFactor = size >= 0.7 ? 24 : (size >= 0.5 ? 18 : 12);
    const bl = blFactor * size * (trait.blMul || 1), bw = (n >= 3 ? 1.35 : 1.5) * size * (trait.bwMul || 1), gap = (n >= 4 ? 3.6 : 3.9) * size;
    const n0 = (n - 1) / 2;
    const hw = w / 2, hh = h / 2;
    const ch = Math.min(trait.ch * size, hh * 0.42);
    const rnd = Math.min((trait.round || 0) * size, Math.min(hw, hh) * 0.55);
    const face = dir === 'l' ? -1 : 1;
    const f = (v) => v.toFixed(1);
    let s = '';
    // 叠炮落在下层炮塔上的投影
    if (elev) s += `<ellipse cx="${f(x + 2.6 * size)}" cy="${f(cy + 3.4 * size)}" rx="${f(w * 0.7)}" ry="${f(h * 0.66)}" fill="${P.outline}" opacity="0.3" filter="url(#${id}-fPart)"/>`;
    s += `<g transform="translate(${x},${cy})">`;
    // 炮塔俯视轮廓：日/意/苏/法用圆角，美/英/德用切角，形成国别剪影差异
    const shield = rnd > 0.25
        ? `M ${f(-hw + rnd)} ${f(-hh)} L ${f(hw - rnd)} ${f(-hh)} Q ${f(hw)} ${f(-hh)} ${f(hw)} ${f(-hh + rnd)} L ${f(hw)} ${f(hh - rnd)} Q ${f(hw)} ${f(hh)} ${f(hw - rnd)} ${f(hh)} L ${f(-hw + rnd)} ${f(hh)} Q ${f(-hw)} ${f(hh)} ${f(-hw)} ${f(hh - rnd)} L ${f(-hw)} ${f(-hh + rnd)} Q ${f(-hw)} ${f(-hh)} ${f(-hw + rnd)} ${f(-hh)} Z`
        : `M ${f(-hw + ch)} ${f(-hh)} L ${f(hw - ch)} ${f(-hh)} L ${f(hw)} ${f(-hh + ch)} L ${f(hw)} ${f(hh - ch)} L ${f(hw - ch)} ${f(hh)} L ${f(-hw + ch)} ${f(hh)} L ${f(-hw)} ${f(hh - ch)} L ${f(-hw)} ${f(-hh + ch)} Z`;
    // 座圈
    s += `<path d="${shield}" transform="translate(0,${f(0.55 * size)}) scale(1.05)" fill="${mixHex(P.supLo, P.outline, 0.55)}" stroke="${P.outline}" stroke-width="${f(0.32 * size + 0.12)}"/>`;
    // 右下侧壁：俯视下的垂直装甲厚度
    s += `<path d="${shield}" transform="translate(${f(1.25 * size)},${f(1.85 * size)})" fill="url(#${id}-gTurSide)" stroke="${P.outline}" stroke-width="${f(0.42 * size + 0.1)}"/>`;
    // 炮管：投影 + 身管 + 炮口制退环 + 炮口内孔
    for (let i = 0; i < n; i++) {
        const y = (i - n0) * gap;
        const bx = face < 0 ? -bl - w * 0.18 : w * 0.18;
        s += `<rect x="${f(bx)}" y="${f(y - bw * 0.27 + 0.42 * size)}" width="${f(bl)}" height="${f(bw * 0.54)}" rx="${f(bw * 0.27)}" fill="${P.outline}" opacity="0.24"/>`;
        s += `<rect x="${f(bx)}" y="${f(y - bw / 2)}" width="${f(bl)}" height="${f(bw)}" rx="${f(bw / 2)}" fill="url(#${id}-gBarrel)" stroke="${mixHex(P.barrel, P.outline, 0.5)}" stroke-width="0.18"/>`;
        s += `<line x1="${f(bx + 1.0 * size)}" y1="${f(y - bw * 0.22)}" x2="${f(bx + bl - 1.6 * size)}" y2="${f(y - bw * 0.22)}" stroke="#8d99a3" stroke-width="${f(0.16 * size + 0.06)}" opacity="0.75"/>`;
        const mw = 1.9 * size, mh = bw * 1.6;
        const mx = face < 0 ? bx - 0.25 * size : bx + bl - mw + 0.25 * size;
        s += `<rect x="${f(mx)}" y="${f(y - mh / 2)}" width="${f(mw)}" height="${f(mh)}" rx="${f(mw * 0.18)}" fill="${mixHex(P.outline, P.barrel, 0.25)}" stroke="${P.outline}" stroke-width="0.16"/>`;
        s += `<line x1="${f(mx + 0.25)}" y1="${f(y - mh / 2 + 0.22)}" x2="${f(mx + mw - 0.25)}" y2="${f(y - mh / 2 + 0.22)}" stroke="${P.supLo}" stroke-width="0.14" opacity="0.6"/>`;
        const mx0 = face < 0 ? mx : mx + mw - 0.34 * size;
        s += `<rect x="${f(mx0)}" y="${f(y - bw * 0.28)}" width="${f(0.34 * size)}" height="${f(bw * 0.56)}" rx="${f(bw * 0.25)}" fill="#05080a"/>`;
    }
    // 屋顶
    s += `<path d="${shield}" fill="url(#${id}-gTur)" stroke="${P.outline}" stroke-width="${f(0.62 * size + 0.12)}" filter="url(#${id}-fPart)"/>`;
    // 屋顶内缘与上缘受光
    s += `<path d="${shield}" fill="none" stroke="${P.sup}" stroke-width="${f(0.28 * size + 0.08)}" opacity="0.26" transform="scale(0.9)"/>`;
    s += `<line x1="${f(-hw + ch + 0.7)}" y1="${f(-hh + 0.75 * size)}" x2="${f(hw - ch - 0.7)}" y2="${f(-hh + 0.75 * size)}" stroke="${P.sup}" stroke-width="${f(0.42 * size + 0.12)}" opacity="0.6"/>`;
    // 倾斜枪盾正面：位于屋顶前缘外侧，炮管从面板穿出
    const fw = 1.6 * size;
    const fp = face < 0
        ? `M ${f(-hw)} ${f(-hh + ch)} L ${f(-hw - fw)} ${f(-hh + ch * 0.45)} L ${f(-hw - fw)} ${f(hh - ch * 0.45)} L ${f(-hw)} ${f(hh - ch)} Z`
        : `M ${f(hw)} ${f(-hh + ch)} L ${f(hw + fw)} ${f(-hh + ch * 0.45)} L ${f(hw + fw)} ${f(hh - ch * 0.45)} L ${f(hw)} ${f(hh - ch)} Z`;
    s += `<path d="${fp}" fill="url(#${id}-gTurFace)" stroke="${P.outline}" stroke-width="${f(0.32 * size + 0.1)}"/>`;
    const fx = face < 0 ? -hw - fw : hw + fw;
    s += `<line x1="${f(fx)}" y1="${f(-hh + ch * 0.65)}" x2="${f(fx)}" y2="${f(hh - ch * 0.65)}" stroke="${P.sup}" stroke-width="${f(0.26 * size + 0.08)}" opacity="0.5"/>`;
    // 后部舱盖
    const hx = face < 0 ? hw * 0.4 : -hw * 0.4;
    const cw = 3.8 * size, chh = 2.2 * size;
    s += `<rect x="${f(hx - cw / 2)}" y="${f(-chh / 2)}" width="${f(cw)}" height="${f(chh)}" rx="${f(0.55 * size)}" fill="${mixHex(P.supLo, P.sup, 0.34)}" stroke="${P.outline}" stroke-width="${f(0.22 * size + 0.06)}"/>`;
    s += `<line x1="${f(hx - cw / 2 + 0.5 * size)}" y1="${f(-chh / 2 + 0.45 * size)}" x2="${f(hx + cw / 2 - 0.5 * size)}" y2="${f(-chh / 2 + 0.45 * size)}" stroke="${P.sup}" stroke-width="0.16" opacity="0.55"/>`;
    s += `<circle cx="${f(hx + cw * 0.3)}" cy="0" r="${f(0.22 * size)}" fill="${P.outline}" opacity="0.5"/>`;
    // 前部潜望镜与通风口
    const vx = face < 0 ? -hw * 0.38 : hw * 0.38;
    s += `<circle cx="${f(vx)}" cy="${f(-hh * 0.42)}" r="${f(0.7 * size)}" fill="${mixHex(P.supLo, P.outline, 0.12)}" stroke="${P.outline}" stroke-width="0.18"/>`;
    s += `<circle cx="${f(vx - 0.16 * size)}" cy="${f(-hh * 0.42 - 0.16 * size)}" r="${f(0.24 * size)}" fill="${P.sup}" opacity="0.55"/>`;
    s += `<line x1="${f(vx - 0.9 * size)}" y1="${f(hh * 0.42)}" x2="${f(vx + 0.9 * size)}" y2="${f(hh * 0.42)}" stroke="${P.outline}" stroke-width="0.2" opacity="0.32"/>`;
    s += `<line x1="${f(vx - 0.9 * size)}" y1="${f(hh * 0.55)}" x2="${f(vx + 0.9 * size)}" y2="${f(hh * 0.55)}" stroke="${P.outline}" stroke-width="0.2" opacity="0.26"/>`;
    // 后部测距仪耳台
    for (const sy of [-1, 1]) {
        const ex = face < 0 ? hw - 0.9 * size : -hw - 1.9 * size;
        s += `<rect x="${f(ex)}" y="${f(sy * (hh - 1.4 * size) - 1.1 * size)}" width="${f(trait.ear * size)}" height="${f(2.2 * size)}" rx="${f(0.7 * size)}" fill="${P.supLo}" stroke="${P.outline}" stroke-width="${f(0.28 * size + 0.08)}"/>`;
        s += `<line x1="${f(ex + 0.5 * size)}" y1="${f(sy * (hh - 1.4 * size) - 0.95 * size)}" x2="${f(ex + trait.ear * size - 0.5 * size)}" y2="${f(sy * (hh - 1.4 * size) - 0.95 * size)}" stroke="${P.sup}" stroke-width="0.14" opacity="0.45"/>`;
    }
    s += '</g>';
    return s;
}

function funnel(x, cy, w, h, raked, P, id, smoke = true) {
    // 俯视烟囱：沿舰轴拉长的圆角壳体，烟道口偏后，避免“圆环/舷窗”感
    const rw = w / 2, rh = h / 2;
    const el = raked ? 1.16 : 1;
    const orx = rw * el;
    const f = (v) => v.toFixed(1);
    const casingDark = mixHex(P.fun, P.outline, 0.42);
    const casingHi = mixHex(P.fun, P.sup, 0.7);
    const rimHi = mixHex(P.fun, '#ffffff', 0.42);
    const x0 = x - orx, y0 = cy - rh, ww = 2 * orx, hh = 2 * rh;
    const rr = f(Math.min(rh * 0.8, orx * 0.48));
    let s = '';
    // 基座投影 + 壳体厚度
    s += `<rect x="${f(x0 + 1.5)}" y="${f(y0 + 2.2)}" width="${f(ww)}" height="${f(hh)}" rx="${rr}" fill="${P.outline}" opacity="0.45"/>`;
    s += `<rect x="${f(x0)}" y="${f(y0 + 1.0)}" width="${f(ww)}" height="${f(hh)}" rx="${rr}" fill="${casingDark}" stroke="${P.outline}" stroke-width="0.65"/>`;
    // 壳体顶面
    s += `<rect x="${f(x0)}" y="${f(y0)}" width="${f(ww)}" height="${f(hh)}" rx="${rr}" fill="url(#${id}-gFun2)" stroke="${P.outline}" stroke-width="0.8"/>`;
    // 顶缘受光 + 前缘板缝
    s += `<line x1="${f(x0 + rh * 0.8)}" y1="${f(y0 + 0.7)}" x2="${f(x0 + ww - rh * 0.8)}" y2="${f(y0 + 0.7)}" stroke="${rimHi}" stroke-width="0.75" opacity="0.8"/>`;
    s += `<line x1="${f(x0 + orx * 0.3)}" y1="${f(y0 + rh * 0.5)}" x2="${f(x0 + ww - orx * 0.3)}" y2="${f(y0 + rh * 0.5)}" stroke="${P.outline}" stroke-width="0.35" opacity="0.3"/>`;
    // 烟道口：收小、后偏，四周留出厚实的壳体
    const ix0 = x0 + orx * 0.3, iy0 = y0 + rh * 0.34;
    const iw = ww - orx * 0.6, ih = hh - rh * 0.68;
    const irr = f(Math.min(rh * 0.5, iw * 0.24));
    // 内圈围板（受光）+ 口部
    s += `<rect x="${f(ix0 - 0.9)}" y="${f(iy0 - 0.9)}" width="${f(iw + 1.8)}" height="${f(ih + 1.8)}" rx="${irr}" fill="none" stroke="${casingHi}" stroke-width="1.5"/>`;
    s += `<rect x="${f(ix0)}" y="${f(iy0)}" width="${f(iw)}" height="${f(ih)}" rx="${irr}" fill="url(#${id}-gFlue)" stroke="${P.outline}" stroke-width="0.5"/>`;
    // 炉栅（纵向隔板，透视下呈短横线）
    for (let i = -1; i <= 1; i++) {
        s += `<line x1="${f(ix0 + iw * 0.26)}" y1="${f(iy0 + ih * (0.5 + i * 0.2))}" x2="${f(ix0 + iw * 0.74)}" y2="${f(iy0 + ih * (0.5 + i * 0.2))}" stroke="#4a555e" stroke-width="0.4" opacity="0.75"/>`;
    }
    s += `<rect x="${f(ix0 + 0.55)}" y="${f(iy0 + 0.55)}" width="${f(iw - 1.1)}" height="${f(ih - 1.1)}" rx="${f(Math.min(rh * 0.4, iw * 0.2))}" fill="none" stroke="#66727c" stroke-width="0.3" opacity="0.45"/>`;
    // 蒸汽管与汽笛
    s += `<line x1="${f(x + orx - 1)}" y1="${f(cy + rh * 0.55)}" x2="${f(x + orx + 3.2)}" y2="${f(cy + rh * 0.55)}" stroke="${P.supLo}" stroke-width="0.8" stroke-linecap="round" opacity="0.8"/>`;
    s += `<circle cx="${f(x + orx + 3.6)}" cy="${f(cy + rh * 0.55)}" r="0.6" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.3"/>`;
    s += `<circle cx="${f(x0 + orx * 1.4)}" cy="${f(y0 + 1)}" r="0.7" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.3"/>`;
    // 向舰尾飘散的烟迹
    if (smoke) for (const [dx, dy, rx, ry, op, fill] of [
        [orx + 5.5, -rh * 0.25, 4.6, 1.9, 0.22, '#b6c4cf'],
        [orx + 11.5, rh * 0.15, 5.8, 2.4, 0.16, '#93a3af'],
        [orx + 18.5, -rh * 0.05, 6.8, 2.8, 0.11, '#7e8f9b']
    ]) {
        s += `<ellipse cx="${f(x + dx)}" cy="${f(cy + dy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}" opacity="${op}" filter="url(#${id}-fSmoke)"/>`;
    }
    return s;
}

function superstructure(x, w, cy, beam, style, P, id) {
    const f = (v) => (+v).toFixed(1);
    const h = beam * (style === 'flat' ? 0.46 : 0.5);
    const top = cy - h / 2;
    const cham = (bx, by, bw, bh, c = 1.4) =>
        `M ${f(bx + c)} ${f(by)} L ${f(bx + bw - c)} ${f(by)} L ${f(bx + bw)} ${f(by + c)} L ${f(bx + bw)} ${f(by + bh - c)} L ${f(bx + bw - c)} ${f(by + bh)} L ${f(bx + c)} ${f(by + bh)} L ${f(bx)} ${f(by + bh - c)} L ${f(bx)} ${f(by + c)} Z`;
    // 全部细节按俯视屋顶绘制：只做浅投影，不画立面窗带
    const block = (bx, by, bw, bh, c, fill, opt = {}) => {
        let q = `<path d="${cham(bx + 1.0, by + 1.3, bw, bh, c)}" fill="${P.outline}" opacity="${opt.shadow ?? 0.36}"/>`;
        q += `<path d="${cham(bx, by, bw, bh, c)}" fill="${fill}" stroke="${P.outline}" stroke-width="${opt.sw ?? 0.55}"/>`;
        q += `<path d="${cham(bx + 0.85, by + 0.85, bw - 1.7, bh - 1.7, Math.max(0.4, c - 0.35))}" fill="none" stroke="${opt.rim || P.sup}" stroke-width="0.24" opacity="${opt.rimOp ?? 0.34}"/>`;
        if (opt.rail) {
            q += `<path d="${cham(bx + 1.8, by + 1.8, bw - 3.6, bh - 3.6, Math.max(0.35, c - 0.6))}" fill="none" stroke="${mixHex(P.sup, '#ffffff', 0.25)}" stroke-width="0.28" stroke-dasharray="1.6 1.9" opacity="0.24"/>`;
        }
        return q;
    };
    // 两舷舰桥翼台：敞开式平台，颜色压深以区别于舰桥顶面
    const wings = (bx, by, bw, bh) => {
        let q = '';
        for (const sy of [-1, 1]) {
            const wy = sy < 0 ? by - 1.9 : by + bh;
            const wingFill = mixHex(P.supLo, P.outline, 0.2);
            q += `<rect x="${f(bx + 2.2)}" y="${f(wy)}" width="${f(bw - 4.4)}" height="1.9" rx="0.35" fill="${wingFill}" stroke="${P.outline}" stroke-width="0.3"/>`;
            q += `<line x1="${f(bx + 3.0)}" y1="${f(wy + 0.62)}" x2="${f(bx + bw - 3.0)}" y2="${f(wy + 0.62)}" stroke="${P.sup}" stroke-width="0.2" opacity="0.4"/>`;
            q += `<line x1="${f(bx + 3.0)}" y1="${f(wy + (sy < 0 ? 0.16 : 1.74))}" x2="${f(bx + bw - 3.0)}" y2="${f(wy + (sy < 0 ? 0.16 : 1.74))}" stroke="${P.sup}" stroke-width="0.24" stroke-dasharray="1.1 1.3" opacity="0.5"/>`;
        }
        return q;
    };
    const hatch = (hx, hy, hw = 2.4, hh = 1.5) => {
        let q = `<rect x="${f(hx)}" y="${f(hy)}" width="${f(hw)}" height="${f(hh)}" rx="0.4" fill="${mixHex(P.supLo, P.outline, 0.26)}" stroke="${P.outline}" stroke-width="0.26"/>`;
        q += `<line x1="${f(hx + 0.4)}" y1="${f(hy + 0.35)}" x2="${f(hx + hw - 0.4)}" y2="${f(hy + 0.35)}" stroke="${P.sup}" stroke-width="0.22" opacity="0.5"/>`;
        return q;
    };
    const fan = (cx, cy0, r = 0.9) => {
        let q = `<circle cx="${f(cx + 0.5)}" cy="${f(cy0 + 0.7)}" r="${f(r)}" fill="${P.outline}" opacity="0.35"/>`;
        q += `<circle cx="${f(cx)}" cy="${f(cy0)}" r="${f(r)}" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.28"/>`;
        q += `<path d="M ${f(cx - r * 0.55)} ${f(cy0 - r * 0.15)} A ${f(r * 0.55)} ${f(r * 0.55)} 0 0 1 ${f(cx + r * 0.35)} ${f(cy0 - r * 0.5)}" fill="none" stroke="${P.sup}" stroke-width="0.24" opacity="0.7"/>`;
        return q;
    };
    const director = (cx, cy0, r) => {
        let q = `<circle cx="${f(cx + 0.7)}" cy="${f(cy0 + 1.0)}" r="${f(r)}" fill="${P.outline}" opacity="0.38"/>`;
        q += `<circle cx="${f(cx)}" cy="${f(cy0)}" r="${f(r)}" fill="${mixHex(P.supLo, P.outline, 0.18)}" stroke="${P.outline}" stroke-width="0.4"/>`;
        q += `<circle cx="${f(cx)}" cy="${f(cy0)}" r="${f(r * 0.5)}" fill="${mixHex(P.sup, P.supLo, 0.25)}" stroke="${P.outline}" stroke-width="0.26"/>`;
        q += `<line x1="${f(cx - r * 0.55)}" y1="${f(cy0)}" x2="${f(cx + r * 0.55)}" y2="${f(cy0)}" stroke="${P.outline}" stroke-width="0.3" opacity="0.55"/>`;
        return q;
    };
    const mastBase = (mx, my) => {
        let q = `<circle cx="${f(mx + 0.6)}" cy="${f(my + 0.9)}" r="1.4" fill="${P.outline}" opacity="0.3"/>`;
        q += `<circle cx="${f(mx)}" cy="${f(my)}" r="1.25" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.35"/>`;
        q += `<circle cx="${f(mx)}" cy="${f(my)}" r="0.5" fill="${mixHex(P.sup, '#ffffff', 0.2)}" stroke="${P.outline}" stroke-width="0.22"/>`;
        q += `<line x1="${f(mx)}" y1="${f(my)}" x2="${f(mx)}" y2="${f(my + 3.2)}" stroke="${P.outline}" stroke-width="0.26" opacity="0.35"/>`;
        return q;
    };

    // 底层深色甲板室：大块压底，上部再叠浅色阶梯，避免整块亮色屋顶
    let s = block(x + 0.6, top + 1.1, w - 1.2, h - 2.2, 1.7, `url(#${id}-gSupBase)`,
        { sw: 0.85, shadow: 0.44, rim: P.hullHi, rimOp: 0.2, rail: true });
    for (let sx = x + 5.5; sx < x + w - 4.5; sx += 6.4) {
        s += `<line x1="${f(sx)}" y1="${f(top + 3)}" x2="${f(sx)}" y2="${f(top + h - 3)}" stroke="${P.outline}" stroke-width="0.2" opacity="0.16"/>`;
    }
    for (const ty of [0.33, 0.67]) {
        s += `<line x1="${f(x + 2.2)}" y1="${f(top + h * ty)}" x2="${f(x + w - 2.2)}" y2="${f(top + h * ty)}" stroke="${P.outline}" stroke-width="0.24" opacity="0.12"/>`;
    }
    s += hatch(x + w * 0.035, top + h * 0.46, 2.2, 1.4);
    s += fan(x + w * 0.035, top + h * 0.68, 0.75);

    if (style === 'pagoda') {
        // 日系塔式舰桥：深色基座 + 逐层收窄的浅色屋顶平台
        const t1 = [x + w * 0.10, top + h * 0.20, w * 0.62, h * 0.60];
        s += block(t1[0], t1[1], t1[2], t1[3], 1.4, mixHex(P.sup, P.supLo, 0.48), { rail: true, shadow: 0.4, sw: 0.6 });
        s += `<line x1="${f(t1[0] + 1.2)}" y1="${f(t1[1] + t1[3] * 0.22)}" x2="${f(t1[0] + 1.2)}" y2="${f(t1[1] + t1[3] * 0.78)}" stroke="${P.outline}" stroke-width="1.05" opacity="0.5"/>`;
        s += wings(t1[0], t1[1], t1[2], t1[3]);
        const t2 = [t1[0] + w * 0.10, t1[1] + h * 0.10, t1[2] * 0.58, t1[3] * 0.6];
        s += block(t2[0], t2[1], t2[2], t2[3], 1.1, mixHex(P.sup, P.supLo, 0.18), { shadow: 0.34, sw: 0.45, rail: true, rim: P.sup, rimOp: 0.22 });
        const t3 = [t2[0] + t2[2] * 0.16, t2[1] + t2[3] * 0.25, t2[2] * 0.52, t2[3] * 0.5];
        s += block(t3[0], t3[1], t3[2], t3[3], 0.8, mixHex(P.sup, '#ffffff', 0.03), { shadow: 0.26, sw: 0.4 });
        s += director(t3[0] + t3[2] * 0.5, t3[1] + t3[3] * 0.56, Math.min(1.5, t3[2] * 0.3));
        s += mastBase(t2[0] + t2[2] * 0.78, t2[1] + t2[3] * 0.36);
        const af = [x + w * 0.76, top + h * 0.3, w * 0.19, h * 0.4];
        s += block(af[0], af[1], af[2], af[3], 0.9, mixHex(P.supLo, P.sup, 0.35), { shadow: 0.28, sw: 0.4 });
        s += hatch(af[0] + af[2] * 0.24, af[1] + af[3] * 0.5, 1.8, 1.2);
    } else if (style === 'flat') {
        // 德系：方正装甲舰桥 + 圆形装甲指挥塔
        const b = [x + w * 0.14, top + h * 0.18, w * 0.52, h * 0.64];
        s += block(b[0], b[1], b[2], b[3], 1.3, mixHex(P.sup, P.supLo, 0.52), { rail: true, shadow: 0.42, sw: 0.6 });
        s += `<line x1="${f(b[0] + 1.2)}" y1="${f(b[1] + b[3] * 0.2)}" x2="${f(b[0] + 1.2)}" y2="${f(b[1] + b[3] * 0.8)}" stroke="${P.outline}" stroke-width="1.15" opacity="0.55"/>`;
        s += wings(b[0], b[1], b[2], b[3]);
        const arm = [b[0] + b[2] * 0.10, b[1] + b[3] * 0.25, b[2] * 0.40, b[3] * 0.5];
        s += block(arm[0], arm[1], arm[2], arm[3], 1.0, mixHex(P.sup, P.supLo, 0.28), { shadow: 0.34, sw: 0.5, rail: true, rim: P.sup, rimOp: 0.22 });
        const cxx = arm[0] + arm[2] * 0.34, cyy = arm[1] + arm[3] * 0.58, cr = Math.min(3.0, arm[3] * 0.28);
        s += `<circle cx="${f(cxx + 0.7)}" cy="${f(cyy + 0.9)}" r="${f(cr)}" fill="${P.outline}" opacity="0.38"/>`;
        s += `<circle cx="${f(cxx)}" cy="${f(cyy)}" r="${f(cr)}" fill="${mixHex(P.supLo, P.outline, 0.22)}" stroke="${P.outline}" stroke-width="0.5"/>`;
        s += `<circle cx="${f(cxx)}" cy="${f(cyy)}" r="${f(cr * 0.55)}" fill="url(#${id}-gTur)" stroke="${P.outline}" stroke-width="0.3"/>`;
        s += `<path d="M ${f(cxx - cr * 0.8)} ${f(cyy - cr * 0.2)} A ${f(cr * 0.8)} ${f(cr * 0.8)} 0 0 1 ${f(cxx + cr * 0.2)} ${f(cyy - cr * 0.76)}" fill="none" stroke="${P.sup}" stroke-width="0.35" opacity="0.6"/>`;
        s += director(arm[0] + arm[2] * 0.78, arm[1] + arm[3] * 0.3, Math.min(1.5, arm[2] * 0.18));
        s += hatch(arm[0] + arm[2] * 0.36, arm[1] + arm[3] * 0.82, 2.2, 1.3);
        s += mastBase(arm[0] + arm[2] * 0.62, arm[1] + arm[3] * 0.14);
        const af = [x + w * 0.70, top + h * 0.28, w * 0.26, h * 0.44];
        s += block(af[0], af[1], af[2], af[3], 0.9, mixHex(P.supLo, P.sup, 0.35), { shadow: 0.28, sw: 0.45 });
        s += hatch(af[0] + af[2] * 0.26, af[1] + af[3] * 0.5, 2.0, 1.3);
        s += fan(af[0] + af[2] * 0.72, af[1] + af[3] * 0.52, 0.6);
    } else {
        // 美/英/法/意/苏：前部航海舰桥 + 后部甲板室
        const b = [x + w * 0.15, top + h * 0.17, w * 0.48, h * 0.66];
        s += block(b[0], b[1], b[2], b[3], 1.3, mixHex(P.sup, P.supLo, 0.55), { rail: true, shadow: 0.42, sw: 0.6, rim: P.sup, rimOp: 0.26 });
        for (const sy of [0.3, 0.55, 0.8]) {
            s += `<line x1="${f(b[0] + 1.8)}" y1="${f(b[1] + b[3] * sy)}" x2="${f(b[0] + b[2] - 1.8)}" y2="${f(b[1] + b[3] * sy)}" stroke="${P.outline}" stroke-width="0.2" opacity="0.14"/>`;
        }
        for (const sx of [0.34, 0.62]) {
            s += `<line x1="${f(b[0] + b[2] * sx)}" y1="${f(b[1] + 1.6)}" x2="${f(b[0] + b[2] * sx)}" y2="${f(b[1] + b[3] - 1.6)}" stroke="${P.outline}" stroke-width="0.2" opacity="0.12"/>`;
        }
        s += `<line x1="${f(b[0] + 1.2)}" y1="${f(b[1] + b[3] * 0.2)}" x2="${f(b[0] + 1.2)}" y2="${f(b[1] + b[3] * 0.8)}" stroke="${P.outline}" stroke-width="1.15" opacity="0.55"/>`;
        s += `<line x1="${f(b[0] + 2.3)}" y1="${f(b[1] + b[3] * 0.24)}" x2="${f(b[0] + 2.3)}" y2="${f(b[1] + b[3] * 0.76)}" stroke="${P.sup}" stroke-width="0.3" opacity="0.3"/>`;
        s += wings(b[0], b[1], b[2], b[3]);
        // 中层装甲指挥室压深，顶层再抬一层小罗经平台
        const u = [b[0] + b[2] * 0.28, b[1] + b[3] * 0.28, b[2] * 0.42, b[3] * 0.44];
        s += block(u[0], u[1], u[2], u[3], 0.8, mixHex(P.sup, P.supLo, 0.22), { shadow: 0.36, sw: 0.45, rail: true, rim: P.sup, rimOp: 0.24 });
        s += hatch(u[0] + u[2] * 0.56, u[1] + u[3] * 0.8, 1.6, 1.0);
        const t = [u[0] + u[2] * 0.24, u[1] + u[3] * 0.23, u[2] * 0.5, u[3] * 0.54];
        s += block(t[0], t[1], t[2], t[3], 0.6, mixHex(P.sup, '#ffffff', 0.04), { shadow: 0.26, sw: 0.35 });
        s += director(t[0] + t[2] * 0.66, t[1] + t[3] * 0.5, Math.min(1.2, t[2] * 0.28));
        s += hatch(b[0] + b[2] * 0.56, b[1] + b[3] * 0.03, 1.5, 0.9);
        s += hatch(b[0] + b[2] * 0.56, b[1] + b[3] * 0.9, 1.5, 0.9);
        const af = [x + w * 0.68, top + h * 0.28, w * 0.28, h * 0.44];
        s += block(af[0], af[1], af[2], af[3], 0.9, mixHex(P.supLo, P.sup, 0.35), { shadow: 0.28, sw: 0.45 });
        s += hatch(af[0] + af[2] * 0.22, af[1] + af[3] * 0.5, 2.0, 1.3);
        s += fan(af[0] + af[2] * 0.74, af[1] + af[3] * 0.55, 0.6);
    }
    return s;
}

function aaMounts(xs, cy, beam, P, xs40 = [], code = 'BB') {
    // 两舷的双联高平两用炮座，以及 40mm 四联装炮座
    const y1 = cy - beam * 0.38, y2 = cy + beam * 0.38;
    let s = '';
    for (const x of (xs || [])) {
        for (const [y, sy] of [[y1, -1], [y2, 1]]) {
            s += `<g transform="translate(${x},${y})">`;
            s += `<rect x="-3.4" y="-1.7" width="6.8" height="3.4" rx="1.1" fill="${mixHex(P.supLo, P.outline, 0.3)}" stroke="${P.outline}" stroke-width="0.4"/>`;
            s += `<line x1="-1" y1="${sy * 1.1}" x2="-1.9" y2="${sy * 3.9}" stroke="${P.barrel}" stroke-width="0.7" stroke-linecap="round"/>`;
            s += `<line x1="1" y1="${sy * 1.1}" x2="1.9" y2="${sy * 3.9}" stroke="${P.barrel}" stroke-width="0.7" stroke-linecap="round"/>`;
            s += `<line x1="-2.4" y1="-0.9" x2="2.4" y2="-0.9" stroke="${P.sup}" stroke-width="0.4" opacity="0.55"/>`;
            s += `</g>`;
        }
    }
    const k = code === 'CL' ? 0.82 : 1;
    for (const x of (xs40 || [])) {
        for (const [y, sy] of [[cy - beam * 0.355, -1], [cy + beam * 0.355, 1]]) {
            s += quadAA(x, y, P, sy, k);
        }
    }
    return s;
}

// 三联/四联/五联鱼雷发射管：深色训练盘 + 金属管束，艏端管口决定俯视辨识度
function torpMount(x, cy, P, id, tubes = 3, len = 10.6, side = 0) {
    const f = (v) => (+v).toFixed(1);
    const n = Math.max(1, Math.min(5, tubes | 0));
    const th = n >= 5 ? 0.82 : (n === 4 ? 0.92 : 1.06);
    const gap = th + 0.28;
    const span = (n - 1) * gap + th;
    const half = span / 2;
    const x0 = -len / 2, x1 = len / 2;
    let s = `<g transform="translate(${f(x)},${f(cy)}) rotate(${f(side * -7)})">`;
    // 训练盘：只作暗色衬底，托架与管束压在上面
    const rr = half + 0.7;
    s += `<circle cx="0" cy="0" r="${f(rr)}" fill="${mixHex(P.deckLo, '#000000', 0.18)}" stroke="${P.outline}" stroke-width="0.26" opacity="0.78"/>`;
    s += `<circle cx="0" cy="0" r="${f(rr - 0.55)}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.2"/>`;
    // 前后横向托架，两端略伸出管束
    for (const bx of [x0 + len * 0.26, x1 - len * 0.3]) {
        s += `<rect x="${f(bx - 0.6)}" y="${f(-half - 0.5)}" width="1.2" height="${f(span + 1.0)}" rx="0.4" fill="${mixHex(P.supLo, P.outline, 0.4)}" stroke="${P.outline}" stroke-width="0.24"/>`;
    }
    for (let i = 0; i < n; i++) {
        const y = -half + th / 2 + i * gap;
        // 管体：暗金属圆柱 + 顶部受光线 + 底部压暗
        s += `<rect x="${f(x0)}" y="${f(y - th / 2)}" width="${f(len)}" height="${f(th)}" rx="${f(th / 2)}" fill="url(#${id}-gTorp)" stroke="${P.outline}" stroke-width="0.22"/>`;
        s += `<line x1="${f(x0 + 1.3)}" y1="${f(y - th * 0.27)}" x2="${f(x1 - 1.1)}" y2="${f(y - th * 0.27)}" stroke="#cfdbe3" stroke-width="0.17" opacity="0.38"/>`;
        // 艏端管口：深孔 + 细金属唇缘，向舰艏开口
        s += `<ellipse cx="${f(x0)}" cy="${f(y)}" rx="0.32" ry="${f(th / 2 - 0.04)}" fill="#05080a" stroke="${mixHex(P.supLo, '#8fa0ab', 0.4)}" stroke-width="0.14"/>`;
        // 艉端铰接盖与锁扣：暗金属端盖，避免两端都出现亮圈
        s += `<rect x="${f(x1 - 0.86)}" y="${f(y - th / 2)}" width="0.86" height="${f(th)}" rx="${f(th / 2)}" fill="${mixHex(P.supLo, P.outline, 0.46)}" stroke="${P.outline}" stroke-width="0.16"/>`;
        s += `<circle cx="${f(x1 - 0.43)}" cy="${f(y)}" r="0.13" fill="${P.outline}" opacity="0.7"/>`;
    }
    s += '</g>';
    return s;
}

// 通用二战舰载机俯视：星型发动机、可折主翼、三点式起落架（收起）
// 各国只做涂装分色，不区分机型
function deckPlane(x, y, rot, P) {
    const body = P.air || P.plane;
    const trim = P.airTrim || mixHex(P.plane, P.outline, 0.4);
    const hi = mixHex(body, '#ffffff', 0.35);
    const f = (v) => v.toFixed(2);
    const wing = 'M 0.55 -0.72 L 2.72 -0.78 Q 2.66 -2.5 2.08 -4.35 L 1.52 -5.45 Q 1.2 -5.82 0.64 -5.7 L -0.12 -5.52 Q 0.04 -3.45 0.2 -1.8 L 0.28 -0.72 Z';
    const tail = 'M -3.7 -0.36 L -2.15 -0.46 L -1.98 -2.15 Q -1.94 -2.42 -2.32 -2.36 L -3.95 -2.18 Q -4.24 -2.1 -4.16 -1.62 Z';
    const fus = 'M -5.65 -0.28 L -2.5 -0.58 Q 1.2 -0.88 3.6 -0.82 L 4.5 -0.76 Q 5.25 -0.62 5.25 0 Q 5.25 0.62 4.5 0.76 L 3.6 0.82 Q 1.2 0.88 -2.5 0.58 L -5.65 0.28 Q -5.95 0 -5.65 -0.28 Z';
    const wingArt = `<path d="${wing}" fill="${body}" stroke="${P.outline}" stroke-width="0.42"/>`
        + `<path d="M 2.53 -1.02 Q 2.4 -2.62 1.4 -5.3" fill="none" stroke="${hi}" stroke-width="0.28" opacity="0.55"/>`
        + `<line x1="2.32" y1="-3.15" x2="0.02" y2="-3.15" stroke="${P.outline}" stroke-width="0.16" opacity="0.35"/>`
        + `<line x1="0.06" y1="-2.35" x2="0.34" y2="-5.2" stroke="${P.outline}" stroke-width="0.16" opacity="0.3"/>`
        + `<path d="M 0.1 -5.4 L 0.62 -5.64 L 1.4 -5.46 L 1.12 -5.02 L 0.26 -5.08 Z" fill="${trim}" stroke="${P.outline}" stroke-width="0.16"/>`;
    const tailArt = `<path d="${tail}" fill="${body}" stroke="${P.outline}" stroke-width="0.34"/>`
        + `<path d="M -4.16 -1.66 L -4.28 -2.13 L -3.3 -2.25 L -3.18 -1.78 Z" fill="${trim}" opacity="0.9"/>`;
    let s = `<g transform="translate(${x},${y}) rotate(${rot})">`;
    // 机体投影
    s += `<g transform="translate(0.7,1.0)" fill="${P.outline}" opacity="0.26">`
        + `<path d="${wing}"/><path d="${wing}" transform="scale(1,-1)"/>`
        + `<path d="${tail}"/><path d="${tail}" transform="scale(1,-1)"/>`
        + `<path d="${fus}"/></g>`;
    // 主翼（双侧镜像）
    s += wingArt + `<g transform="scale(1,-1)">${wingArt}</g>`;
    // 平尾（双侧镜像）
    s += tailArt + `<g transform="scale(1,-1)">${tailArt}</g>`;
    // 机身 + 背脊高光 + 排气管
    s += `<path d="${fus}" fill="${body}" stroke="${P.outline}" stroke-width="0.45"/>`;
    s += `<path d="M -4.9 -0.2 Q 0 -0.5 4.7 -0.42" fill="none" stroke="${hi}" stroke-width="0.3" opacity="0.45"/>`;
    for (const sy of [-1, 1]) {
        s += `<line x1="3.35" y1="${f(sy * 0.6)}" x2="3.85" y2="${f(sy * 0.66)}" stroke="${P.outline}" stroke-width="0.22" opacity="0.6"/>`;
    }
    // 座舱
    s += `<path d="M 0.55 0 L 1.05 -0.5 L 2.45 -0.44 Q 2.9 0 2.45 0.44 L 1.05 0.5 Z" fill="#17232c" stroke="${P.outline}" stroke-width="0.22"/>`;
    s += `<line x1="1.35" y1="-0.38" x2="1.35" y2="0.38" stroke="#9fb4c2" stroke-width="0.14" opacity="0.5"/>`;
    s += `<line x1="1.75" y1="-0.3" x2="2.35" y2="-0.18" stroke="#d6e4ec" stroke-width="0.14" opacity="0.55"/>`;
    // 星型发动机整流罩 + 三叶螺旋桨
    s += `<ellipse cx="4.55" cy="0" rx="0.62" ry="0.76" fill="${trim}" stroke="${P.outline}" stroke-width="0.24"/>`;
    s += `<ellipse cx="4.72" cy="0" rx="0.3" ry="0.44" fill="${P.outline}" opacity="0.5"/>`;
    for (const aa of [-42, 78, 198]) {
        const rad = aa * Math.PI / 180;
        s += `<line x1="5.1" y1="0" x2="${f(5.1 + Math.cos(rad) * 1.95)}" y2="${f(Math.sin(rad) * 1.95)}" stroke="${P.outline}" stroke-width="0.24" stroke-linecap="round" opacity="0.9"/>`;
    }
    s += `<circle cx="5.1" cy="0" r="0.28" fill="${mixHex(trim, '#ffffff', 0.3)}" stroke="${P.outline}" stroke-width="0.14"/>`;
    // 垂尾（俯视为中线上的窄条）
    s += `<path d="M -2.9 -0.14 L -5.25 -0.2 L -5.85 0 L -5.25 0.2 L -2.9 0.14 Z" fill="${trim}" stroke="${P.outline}" stroke-width="0.2"/>`;
    s += '</g>';
    return s;
}

function catapult(x, y, len, P, scale = 1) {
    const s = scale;
    let out = `<circle cx="${x}" cy="${y}" r="${4.2 * s}" fill="${P.supLo}" stroke="${P.outline}" stroke-width="${0.55 * s + 0.15}"/>`;
    out += `<circle cx="${x}" cy="${y}" r="${1.9 * s}" fill="${P.outline}" opacity="0.5"/>`;
    for (const dy of [-1.6 * s, 1.6 * s]) {
        out += `<line x1="${x + 2.5 * s}" y1="${y + dy}" x2="${x + len}" y2="${y + 3 * s + dy}" stroke="${P.sup}" stroke-width="${1.05 * s}" stroke-linecap="round"/>`;
        out += `<line x1="${x + 2.5 * s}" y1="${y + dy + 0.7 * s}" x2="${x + len}" y2="${y + 3 * s + dy + 0.7 * s}" stroke="${P.outline}" stroke-width="0.35" opacity="0.55"/>`;
    }
    for (let i = 0; i < 4; i++) {
        const t = (i + 1) / 5;
        const px = x + 2.5 * s + (len - 2.5 * s) * t;
        const py = y + 3 * s * t;
        out += `<line x1="${px}" y1="${py - 1.6 * s}" x2="${px}" y2="${py + 1.6 * s}" stroke="${P.supLo}" stroke-width="${0.55 * s + 0.1}" opacity="0.8"/>`;
    }
    return out;
}

// ---------- 甲板属具（俯视线图细节） ----------

// 甲板边缘在指定 x 处的半宽：取船体上缘折线插值
function hullEdgeAt(pts, x, cy) {
    let y = null;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (a[1] > cy + 0.01 || b[1] > cy + 0.01) continue;
        const dx = b[0] - a[0];
        if (Math.abs(dx) < 0.001) continue;
        const t = (x - a[0]) / dx;
        if (t >= -0.001 && t <= 1.001) y = a[1] + (b[1] - a[1]) * t;
    }
    return y == null ? cy : y;
}

function deckEdgeY(deckPts, x, cy, side) {
    const y = hullEdgeAt(deckPts, x, cy);
    return side < 0 ? y : 2 * cy - y;
}

function deckCapstan(x, y, P, id, k = 1) {
    const f = (v) => (+v).toFixed(1);
    let s = `<circle cx="${f(x + 0.5 * k)}" cy="${f(y + 0.8 * k)}" r="${f(2 * k)}" fill="${P.outline}" opacity="0.28"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.9 * k)}" fill="${mixHex(P.supLo, P.outline, 0.18)}" stroke="${P.outline}" stroke-width="0.4"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.2 * k)}" fill="url(#${id}-gTur)" stroke="${P.outline}" stroke-width="0.26"/>`;
    for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + 0.5;
        s += `<line x1="${f(x + Math.cos(a) * 0.45 * k)}" y1="${f(y + Math.sin(a) * 0.45 * k)}" x2="${f(x + Math.cos(a) * 1.02 * k)}" y2="${f(y + Math.sin(a) * 1.02 * k)}" stroke="${P.outline}" stroke-width="0.18" opacity="0.7"/>`;
    }
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.35 * k)}" fill="${mixHex(P.sup, '#ffffff', 0.25)}" stroke="${P.outline}" stroke-width="0.14"/>`;
    return s;
}

function deckBollard(x, y, P, k = 1) {
    const f = (v) => (+v).toFixed(1);
    let s = `<rect x="${f(x - 1.9 * k)}" y="${f(y - 0.75 * k)}" width="${f(3.8 * k)}" height="${f(1.5 * k)}" rx="${f(0.4 * k)}" fill="${mixHex(P.deckLo, P.outline, 0.28)}" stroke="${P.outline}" stroke-width="0.2" opacity="0.85"/>`;
    for (const dx of [-0.75, 0.75]) {
        s += `<circle cx="${f(x + dx * k)}" cy="${f(y)}" r="${f(0.5 * k)}" fill="${mixHex(P.supLo, P.outline, 0.35)}" stroke="${P.outline}" stroke-width="0.2"/>`;
        s += `<circle cx="${f(x + (dx - 0.12) * k)}" cy="${f(y - 0.14 * k)}" r="${f(0.16 * k)}" fill="${mixHex(P.sup, '#ffffff', 0.5)}" opacity="0.6"/>`;
    }
    return s;
}

function deckHatch(x, y, w, h, P, rot = 0) {
    const f = (v) => (+v).toFixed(1);
    let s = `<g transform="translate(${f(x)},${f(y)}) rotate(${rot})">`;
    s += `<rect x="${f(-w / 2 - 0.4)}" y="${f(-h / 2 - 0.4)}" width="${f(w + 0.8)}" height="${f(h + 0.8)}" rx="0.5" fill="${P.outline}" opacity="0.25"/>`;
    s += `<rect x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" rx="0.45" fill="${mixHex(P.deckLo, P.supLo, 0.5)}" stroke="${P.outline}" stroke-width="0.28"/>`;
    s += `<rect x="${f(-w / 2 + 0.45)}" y="${f(-h / 2 + 0.45)}" width="${f(w - 0.9)}" height="${f(h - 0.9)}" rx="0.3" fill="none" stroke="${P.hullHi}" stroke-width="0.18" opacity="0.32"/>`;
    s += `<line x1="${f(-w * 0.22)}" y1="${f(-h / 2 + 0.2)}" x2="${f(-w * 0.22)}" y2="${f(h / 2 - 0.2)}" stroke="${P.outline}" stroke-width="0.16" opacity="0.35"/>`;
    s += `<line x1="${f(w * 0.2)}" y1="${f(-h / 2 + 0.2)}" x2="${f(w * 0.2)}" y2="${f(h / 2 - 0.2)}" stroke="${P.outline}" stroke-width="0.16" opacity="0.22"/>`;
    s += `</g>`;
    return s;
}

function deckVent(x, y, r, P, cowl = false, dir = 1) {
    const f = (v) => (+v).toFixed(1);
    if (cowl) {
        let s = `<path d="M ${f(x)} ${f(y)} q ${f(r * 1.1)} ${f(dir * r * 0.2)} ${f(r * 1.7)} ${f(dir * r * 1.3)}" fill="none" stroke="${P.outline}" stroke-width="${f(r * 0.85 + 0.2)}" opacity="0.5"/>`;
        s += `<path d="M ${f(x)} ${f(y)} q ${f(r * 1.1)} ${f(dir * r * 0.2)} ${f(r * 1.7)} ${f(dir * r * 1.3)}" fill="none" stroke="${mixHex(P.supLo, P.outline, 0.1)}" stroke-width="${f(r * 0.85)}"/>`;
        s += `<ellipse cx="${f(x + r * 1.75)}" cy="${f(y + dir * r * 1.35)}" rx="${f(r * 0.7)}" ry="${f(r * 0.48)}" fill="${P.outline}" stroke="${P.supLo}" stroke-width="0.2"/>`;
        s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.62)}" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.2"/>`;
        return s;
    }
    let s = `<circle cx="${f(x + 0.35)}" cy="${f(y + 0.55)}" r="${f(r)}" fill="${P.outline}" opacity="0.25"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${mixHex(P.supLo, P.outline, 0.12)}" stroke="${P.outline}" stroke-width="0.28"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.52)}" fill="${P.sup}" stroke="${P.outline}" stroke-width="0.2"/>`;
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4;
        s += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x + Math.cos(a) * r * 0.9)}" y2="${f(y + Math.sin(a) * r * 0.9)}" stroke="${P.outline}" stroke-width="0.14" opacity="0.45"/>`;
    }
    return s;
}

function deckRaft(x, y, w, P) {
    const f = (v) => (+v).toFixed(1);
    const rx = w / 2, ry = w * 0.21;
    let s = `<ellipse cx="${f(x + 0.3)}" cy="${f(y + 0.45)}" rx="${f(rx)}" ry="${f(ry)}" fill="${P.outline}" opacity="0.22"/>`;
    s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${mixHex(P.sup, P.hullHi, 0.4)}" fill-opacity="0.9" stroke="${P.outline}" stroke-width="0.22"/>`;
    s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx * 0.58)}" ry="${f(ry * 0.55)}" fill="${P.deckLo}" stroke="${P.outline}" stroke-width="0.16" opacity="0.65"/>`;
    s += `<line x1="${f(x - rx * 0.8)}" y1="${f(y)}" x2="${f(x + rx * 0.8)}" y2="${f(y)}" stroke="${P.outline}" stroke-width="0.14" opacity="0.4"/>`;
    return s;
}

function shipBoat(x, y, len, wid, P, side, k = 1) {
    const f = (v) => (+v).toFixed(1);
    const hw = wid / 2;
    const bow = x + len / 2, stern = x - len / 2;
    const boatD = `M ${f(bow)} ${f(y)} C ${f(bow - len * 0.06)} ${f(y - hw * 0.55)} ${f(bow - len * 0.14)} ${f(y - hw * 0.9)} ${f(bow - len * 0.26)} ${f(y - hw)} L ${f(stern + len * 0.1)} ${f(y - hw * 0.94)} Q ${f(stern)} ${f(y - hw * 0.82)} ${f(stern)} ${f(y)} Q ${f(stern)} ${f(y + hw * 0.82)} ${f(stern + len * 0.1)} ${f(y + hw * 0.94)} L ${f(bow - len * 0.26)} ${f(y + hw)} C ${f(bow - len * 0.14)} ${f(y + hw * 0.9)} ${f(bow - len * 0.06)} ${f(y + hw * 0.55)} ${f(bow)} ${f(y)} Z`;
    let s = '';
    for (const dx of [-len * 0.28, len * 0.28]) {
        const bx = x + dx, by = y + side * hw * 0.55;
        s += `<path d="M ${f(bx)} ${f(by)} q ${f(0.5 * k)} ${f(side * 1.1 * k)} ${f(-0.4 * k)} ${f(side * 2.7 * k)}" fill="none" stroke="${P.outline}" stroke-width="${f(0.55 * k)}" opacity="0.8" stroke-linecap="round"/>`;
        s += `<circle cx="${f(bx - 0.4 * k)}" cy="${f(by + side * 2.7 * k)}" r="${f(0.34 * k)}" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.16"/>`;
    }
    s += `<path d="${boatD}" transform="translate(0.7,1.1)" fill="${P.outline}" opacity="0.3"/>`;
    s += `<path d="${boatD}" fill="${mixHex(P.sup, '#ffffff', 0.3)}" stroke="${P.outline}" stroke-width="0.4"/>`;
    s += `<g transform="translate(${f(x)},${f(y)}) scale(0.86) translate(${f(-x)},${f(-y)})">`;
    s += `<path d="${boatD}" fill="${mixHex(P.deckHi, P.supLo, 0.35)}" stroke="${P.outline}" stroke-width="0.18" opacity="0.92"/>`;
    s += `</g>`;
    for (const t of [-0.18, 0.06, 0.28]) {
        const tx = x + len * t;
        s += `<line x1="${f(tx)}" y1="${f(y - hw * 0.55)}" x2="${f(tx)}" y2="${f(y + hw * 0.55)}" stroke="${P.outline}" stroke-width="0.22" opacity="0.45"/>`;
    }
    s += `<line x1="${f(stern + len * 0.16)}" y1="${f(y)}" x2="${f(bow - len * 0.3)}" y2="${f(y)}" stroke="${P.outline}" stroke-width="0.18" opacity="0.35"/>`;
    s += `<rect x="${f(stern + len * 0.06)}" y="${f(y - hw * 0.56)}" width="${f(len * 0.15)}" height="${f(hw * 1.12)}" rx="0.3" fill="${mixHex(P.supLo, P.outline, 0.2)}" stroke="${P.outline}" stroke-width="0.2"/>`;
    return s;
}

function mastTop(x, y, P, span, k = 1) {
    const f = (v) => (+v).toFixed(1);
    let s = `<line x1="${f(x)}" y1="${f(y - span)}" x2="${f(x)}" y2="${f(y + span)}" stroke="${P.outline}" stroke-width="${f(0.55 * k)}" opacity="0.7"/>`;
    s += `<line x1="${f(x + 1.1 * k)}" y1="${f(y - span * 0.6)}" x2="${f(x + 1.1 * k)}" y2="${f(y + span * 0.6)}" stroke="${P.outline}" stroke-width="${f(0.32 * k)}" opacity="0.45"/>`;
    for (const sy of [-1, 1]) s += `<circle cx="${f(x)}" cy="${f(y + sy * span)}" r="${f(0.3 * k)}" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.14"/>`;
    s += `<line x1="${f(x + 2.5 * k)}" y1="${f(y)}" x2="${f(x + 7 * k)}" y2="${f(y - span * 0.85)}" stroke="${P.outline}" stroke-width="0.18" opacity="0.25"/>`;
    s += `<line x1="${f(x + 2.5 * k)}" y1="${f(y)}" x2="${f(x + 7 * k)}" y2="${f(y + span * 0.85)}" stroke="${P.outline}" stroke-width="0.18" opacity="0.25"/>`;
    s += `<circle cx="${f(x + 0.5)}" cy="${f(y + 0.7)}" r="${f(1.4 * k)}" fill="${P.outline}" opacity="0.28"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.45 * k)}" fill="${mixHex(P.supLo, P.outline, 0.12)}" stroke="${P.outline}" stroke-width="0.32"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.55 * k)}" fill="${mixHex(P.sup, '#ffffff', 0.2)}" stroke="${P.outline}" stroke-width="0.18"/>`;
    return s;
}

function searchlight(x, y, P, k = 1) {
    const f = (v) => (+v).toFixed(1);
    let s = `<circle cx="${f(x + 0.4)}" cy="${f(y + 0.6)}" r="${f(1.5 * k)}" fill="${P.outline}" opacity="0.28"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.45 * k)}" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.3"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.95 * k)}" fill="${mixHex(P.sup, '#b9b49c', 0.3)}" stroke="${P.outline}" stroke-width="0.18"/>`;
    s += `<circle cx="${f(x - 0.2 * k)}" cy="${f(y - 0.2 * k)}" r="${f(0.28 * k)}" fill="#dfd8c2" opacity="0.35"/>`;
    return s;
}

function quadAA(x, y, P, side, k = 1) {
    const f = (v) => (+v).toFixed(1);
    let s = `<circle cx="${f(x + 0.3)}" cy="${f(y + 0.5)}" r="${f(2 * k)}" fill="${P.outline}" opacity="0.28"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.95 * k)}" fill="${mixHex(P.deckLo, P.outline, 0.2)}" stroke="${P.outline}" stroke-width="0.3"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.55 * k)}" fill="${mixHex(P.supLo, P.outline, 0.28)}" stroke="${P.outline}" stroke-width="0.24"/>`;
    s += `<path d="M ${f(x - 1.7 * k)} ${f(y)} A ${f(1.7 * k)} ${f(1.7 * k)} 0 0 ${side < 0 ? 1 : 0} ${f(x + 1.7 * k)} ${f(y)}" fill="none" stroke="${P.hullHi}" stroke-width="${f(0.45 * k)}" opacity="0.3"/>`;
    for (const dx of [-0.55, 0.55]) {
        s += `<line x1="${f(x + dx * k)}" y1="${f(y + side * 0.5 * k)}" x2="${f(x + dx * 2.1 * k)}" y2="${f(y + side * 3.1 * k)}" stroke="${P.barrel}" stroke-width="${f(0.55 * k)}" stroke-linecap="round"/>`;
        s += `<line x1="${f(x + dx * 1.6 * k)}" y1="${f(y + side * 0.5 * k)}" x2="${f(x + dx * 2.9 * k)}" y2="${f(y + side * 3 * k)}" stroke="${P.barrel}" stroke-width="${f(0.55 * k)}" stroke-linecap="round"/>`;
    }
    return s;
}

function deckCrane(x, y, P, id, dir = 1, k = 1) {
    const f = (v) => (+v).toFixed(1);
    const len = 17 * k;
    const tx = x + len, ty = y + dir * len * 0.3;
    let s = `<circle cx="${f(x + 0.5)}" cy="${f(y + 0.8)}" r="${f(2.6 * k)}" fill="${P.outline}" opacity="0.3"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(2.5 * k)}" fill="${mixHex(P.supLo, P.outline, 0.18)}" stroke="${P.outline}" stroke-width="0.35"/>`;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.1 * k)}" fill="url(#${id}-gTur)" stroke="${P.outline}" stroke-width="0.25"/>`;
    s += `<rect x="${f(x - 3.4 * k)}" y="${f(y - 1.6 * k)}" width="${f(4.2 * k)}" height="${f(3.2 * k)}" rx="0.5" fill="${mixHex(P.sup, P.supLo, 0.3)}" stroke="${P.outline}" stroke-width="0.28"/>`;
    s += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(tx)}" y2="${f(ty)}" stroke="${P.outline}" stroke-width="${f(2.2 * k)}" opacity="0.45"/>`;
    s += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(tx)}" y2="${f(ty)}" stroke="${mixHex(P.supLo, P.sup, 0.45)}" stroke-width="${f(0.8 * k)}"/>`;
    for (let i = 1; i <= 4; i++) {
        const t = i / 5, px = x + (tx - x) * t, py = y + (ty - y) * t;
        s += `<line x1="${f(px - 0.7 * k)}" y1="${f(py - 0.7 * k)}" x2="${f(px + 0.7 * k)}" y2="${f(py + 0.7 * k)}" stroke="${P.outline}" stroke-width="0.2" opacity="0.5"/>`;
    }
    s += `<circle cx="${f(tx)}" cy="${f(ty)}" r="${f(0.7 * k)}" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.22"/>`;
    s += `<line x1="${f(tx)}" y1="${f(ty)}" x2="${f(tx + 2.4 * k)}" y2="${f(ty + dir * 3.2 * k)}" stroke="${P.outline}" stroke-width="0.28" stroke-dasharray="0.9 0.8" opacity="0.55"/>`;
    s += `<path d="M ${f(tx + 2.1 * k)} ${f(ty + dir * 3 * k)} q 0.9 1.1 0 1.6" fill="none" stroke="${P.outline}" stroke-width="0.3" opacity="0.7"/>`;
    return s;
}

// 低层属具：锚链、系缆、舱口、通风筒、救生筏、舰载艇（压在炮塔与上层建筑之下）
function deckDetailsLow(code, lay, deckPts, cy, B, L, P, id) {
    if (code !== 'BB' && code !== 'CL') return '';
    const k = code === 'BB' ? 1 : 0.8;
    const f = (v) => (+v).toFixed(1);
    let s = '';

    for (const side of [-1, 1]) {
        const hx = 7.5, hy = deckEdgeY(deckPts, hx, cy, side);
        const capX = 25, capY = cy + side * B * 0.055;
        const chain = `M ${f(hx)} ${f(hy)} Q ${f(hx + 7)} ${f(hy + side * 0.6)} ${f(capX)} ${f(capY)}`;
        s += `<path d="${chain}" fill="none" stroke="${mixHex(P.deckLo, '#000000', 0.4)}" stroke-width="${f(2.2 * k)}" opacity="0.26"/>`;
        s += `<path d="${chain}" fill="none" stroke="${P.outline}" stroke-width="${f(1.05 * k)}" stroke-dasharray="${f(0.9 * k)} ${f(0.8 * k)}" opacity="0.72"/>`;
        s += `<circle cx="${f(hx)}" cy="${f(hy)}" r="${f(1.15 * k)}" fill="${P.outline}" opacity="0.55"/>`;
        s += `<circle cx="${f(hx)}" cy="${f(hy)}" r="${f(1.6 * k)}" fill="none" stroke="${P.hullHi}" stroke-width="0.28" opacity="0.35"/>`;
        s += deckCapstan(capX, capY, P, id, k * 0.9);
        s += deckBollard(36, cy + side * B * 0.14, P, k * 0.9);
        s += deckBollard(L - 14, cy + side * B * 0.1, P, k * 0.9);
    }

    // 艏部防浪板：炮座前方的 V 形挡浪板
    const t0 = lay.turrets?.[0];
    if (t0) {
        const bx = t0[0] - 9 * k, ex = bx + 6 * k;
        const hw = cy - deckEdgeY(deckPts, ex, cy, -1);
        const bw = `M ${f(ex)} ${f(cy - hw * 0.9)} Q ${f(bx)} ${f(cy)} ${f(ex)} ${f(cy + hw * 0.9)}`;
        s += `<path d="${bw}" fill="none" stroke="${mixHex(P.hullLo, '#000000', 0.3)}" stroke-width="${f(1.7 * k)}" stroke-linecap="round" opacity="0.8"/>`;
        s += `<path d="${bw}" fill="none" stroke="${P.hullHi}" stroke-width="${f(0.55 * k)}" stroke-linecap="round" opacity="0.35" transform="translate(0.7,0.6)"/>`;
    }

    const hy = (dy) => cy + dy * B;
    if (code === 'BB') {
        s += deckHatch(15, hy(-0.1), 3.4, 2.2, P);
        s += deckHatch(15, hy(0.1), 3.4, 2.2, P);
        s += deckHatch(162, hy(0), 4.6, 3, P);
        s += deckHatch(205, hy(-0.17), 2.6, 1.8, P, 12);
        s += deckHatch(226, hy(0.1), 2.4, 1.6, P);
    } else {
        const lastT = (lay.turrets || []).reduce((m, t) => Math.max(m, t[0]), 0);
        s += deckHatch(14, hy(-0.12), 2.8, 1.7, P);
        s += deckHatch(14, hy(0.12), 2.8, 1.7, P);
        s += deckHatch(60, hy(-0.16), 2.5, 1.6, P);
        s += deckHatch((lastT + L) / 2, hy(0), 2.6, 1.7, P);
    }

    const bxx = lay.bridge?.x ?? L * 0.4, bww = lay.bridge?.w ?? 30;
    for (const side of [-1, 1]) {
        s += deckVent(bxx - 8 * k, cy + side * B * 0.2, 1.15 * k, P, false);
        s += deckVent(bxx + bww + 7 * k, cy + side * B * 0.2, 1 * k, P, true, side);
    }

    for (const side of [-1, 1]) {
        for (const rx of (lay.rafts || [])) {
            s += deckRaft(rx, deckEdgeY(deckPts, rx, cy, side) - side * 1.25 * k, 2.8 * k, P);
        }
    }

    for (const [bx, side, bl] of (lay.boats || [])) {
        s += shipBoat(bx, cy + side * B * 0.33, bl, bl * 0.3, P, side, k);
    }
    return s;
}

// 高层属具：桅杆、探照灯、航空吊车（压在上层建筑与烟囱之上）
function deckDetailsHigh(code, lay, deckPts, cy, B, L, P, id) {
    if (code !== 'BB' && code !== 'CL') return '';
    const k = code === 'BB' ? 1 : 0.78;
    const f = (v) => (+v).toFixed(1);
    let s = '';
    const bx = lay.bridge?.x ?? L * 0.4, bw = lay.bridge?.w ?? 30;
    const funs = lay.funnels || [];
    s += mastTop(bx + bw * 0.62, cy, P, B * 0.17, k);
    if (funs.length) {
        const lf = funs[funs.length - 1];
        let mx;
        if (code === 'BB') {
            const nextT = (lay.turrets || []).filter(t => t[0] > lf[0] + lf[1] / 2).sort((a, b) => a[0] - b[0])[0];
            mx = nextT ? (lf[0] + lf[1] / 2 + nextT[0] - 7) / 2 : lf[0] + lf[1] / 2 + 6;
        } else {
            mx = lf[0] - lf[1] / 2 - 4;
        }
        s += mastTop(mx, cy, P, B * 0.15, k * 0.9);
    }
    for (const side of [-1, 1]) {
        s += searchlight(bx + bw * 0.34, cy + side * (B * 0.17 + 0.9), P, k * 0.78);
    }
    if (code === 'BB' && (lay.catapult || lay.plane)) {
        s += deckCrane(L - 54, cy - B * 0.18, P, id, -1, k);
    }
    return s;
}


// ---------- 船体轮廓点集 ----------
// 各海军的设计流派不同：舰首（clipper 前倾锐角 / plumb 垂直 / raked 微倾 / full 丰满）
// 与舰尾（cruiser 圆尾 / transom 方尾 / canoe 尖尾）决定整体剪影

// 舰首平面轮廓：入口长度与丰满度决定国籍特征
const BOW_STYLES = {
    // 日系：长而内凹的刀锋艏
    clipper: [[0, 0], [0.012, -0.10], [0.030, -0.24], [0.060, -0.40], [0.100, -0.55], [0.150, -0.68],
              [0.210, -0.79], [0.280, -0.87], [0.360, -0.935], [0.440, -0.975], [0.500, -0.992]],
    // 美系：直斜艏，入口均匀
    raked:   [[0, 0], [0.016, -0.17], [0.040, -0.33], [0.075, -0.49], [0.120, -0.63], [0.175, -0.75],
              [0.240, -0.85], [0.315, -0.925], [0.395, -0.972], [0.450, -0.990]],
    // 英系：短而钝的垂直艏
    plumb:   [[0, 0], [0.014, -0.30], [0.036, -0.50], [0.068, -0.66], [0.110, -0.78], [0.160, -0.86],
              [0.220, -0.92], [0.290, -0.96], [0.375, -0.985]],
    // 德系：大西洋艏，长入口带轻微外飘
    atlantic: [[0, 0], [0.014, -0.13], [0.036, -0.28], [0.070, -0.44], [0.115, -0.58], [0.170, -0.71],
               [0.235, -0.81], [0.305, -0.89], [0.380, -0.95], [0.455, -0.985]],
    // 法系：极细长的空想级艏
    fine:    [[0, 0], [0.010, -0.08], [0.028, -0.19], [0.055, -0.32], [0.095, -0.45], [0.145, -0.57],
              [0.205, -0.68], [0.275, -0.78], [0.350, -0.865], [0.430, -0.93], [0.505, -0.975], [0.545, -0.990]],
    // 意系：丰满的圆弧艏
    full:    [[0, 0], [0.012, -0.34], [0.032, -0.56], [0.062, -0.72], [0.102, -0.83], [0.152, -0.90],
              [0.212, -0.945], [0.282, -0.972], [0.360, -0.990]],
    // 苏系：短钝并带轻微球鼻艏感
    bulbous: [[0, 0], [0.015, -0.28], [0.040, -0.49], [0.076, -0.66], [0.120, -0.79], [0.175, -0.875],
              [0.240, -0.935], [0.315, -0.970], [0.400, -0.990]]
};

// 舰首丰满度：战列舰较饱满，航母/驱逐舰首部更瘦削，避免“圆头”
const BOW_FULLNESS = { BB: 1.0, CV: 0.8, CL: 0.9, DD: 0.76 };

// 舰尾平面轮廓：方艉宽度与圆艉收束决定国籍特征
const STERN_STYLES = {
    // 美系：宽平直方艉
    transom:      [[0.845, -0.955], [0.905, -0.915], [0.955, -0.835], [0.988, -0.710], [1.0, -0.560], [1.0, -0.380]],
    // 英/法/苏：圆角方艉
    transomRound: [[0.840, -0.950], [0.900, -0.900], [0.950, -0.820], [0.985, -0.700], [1.0, -0.540], [1.0, -0.340]],
    // 德系：极宽的平直艉板
    transomWide:  [[0.855, -0.965], [0.910, -0.930], [0.960, -0.870], [0.990, -0.780], [1.0, -0.660], [1.0, -0.460]],
    // 日系：圆润收束到中线的巡洋舰艉
    cruiser:      [[0.820, -0.930], [0.880, -0.850], [0.930, -0.720], [0.970, -0.520], [0.990, -0.260], [1.0, 0]],
    // 意系：细长尖艉
    canoe:        [[0.800, -0.920], [0.860, -0.820], [0.910, -0.640], [0.950, -0.400], [0.980, -0.160], [1.0, 0]]
};

const MID_SECTION = {
    BB: [[0.560, -0.990], [0.720, -0.982]],
    CV: [[0.560, -0.995], [0.740, -0.990]],
    CL: [[0.560, -0.978], [0.720, -0.962]],
    DD: [[0.560, -0.962], [0.720, -0.932]]
};

const HULL_TRAITS = {
    us:  { bow: 'raked',    stern: 'transom',      bowEnd: 0.44, sternStart: 0.85, midScale: 1.000 },
    ijn: { bow: 'clipper',  stern: 'cruiser',      bowEnd: 0.50, sternStart: 0.82, midScale: 0.980 },
    rn:  { bow: 'plumb',    stern: 'transomRound', bowEnd: 0.37, sternStart: 0.86, midScale: 1.000 },
    km:  { bow: 'atlantic', stern: 'transomWide',  bowEnd: 0.46, sternStart: 0.86, midScale: 0.995 },
    fn:  { bow: 'fine',     stern: 'transomRound', bowEnd: 0.52, sternStart: 0.85, midScale: 0.990 },
    rm:  { bow: 'full',     stern: 'canoe',        bowEnd: 0.38, sternStart: 0.81, midScale: 0.980 },
    sn:  { bow: 'bulbous',  stern: 'transomRound', bowEnd: 0.41, sternStart: 0.86, midScale: 0.985 }
};

// 炮塔装甲外形：英/德偏方正，法/美偏圆润，日系测距仪耳台更大
const TURRET_TRAITS = {
    // ch=切角量, round=圆角半径, ear=后部测距仪耳台, blMul=炮管长度系数,
    // wMul=炮塔宽系数（按俯视图炮塔/舰宽比）, bwMul=炮管粗细系数（口径差异）
    us:  { ch: 3.8, round: 0.0, ear: 3.4, blMul: 1.00, wMul: 1.04, bwMul: 1.00 },
    ijn: { ch: 0.0, round: 2.4, ear: 5.0, blMul: 1.00, wMul: 1.07, bwMul: 1.12 },
    rn:  { ch: 1.4, round: 0.0, ear: 4.0, blMul: 0.90, wMul: 1.06, bwMul: 0.90 },
    km:  { ch: 1.0, round: 0.0, ear: 2.4, blMul: 0.95, wMul: 0.99, bwMul: 1.02 },
    fn:  { ch: 4.4, round: 1.3, ear: 2.8, blMul: 1.00, wMul: 1.05, bwMul: 1.00 },
    rm:  { ch: 0.0, round: 2.2, ear: 2.8, blMul: 0.95, wMul: 1.06, bwMul: 1.00 },
    sn:  { ch: 0.0, round: 1.8, ear: 2.4, blMul: 0.90, wMul: 1.03, bwMul: 1.04 }
};

function hullProfile(code, factionId) {
    const t = HULL_TRAITS[factionId] || HULL_TRAITS.us;
    const k = BOW_FULLNESS[code] ?? 0.9;
    const rawBow = BOW_STYLES[t.bow];
    const bowXEnd = rawBow[rawBow.length - 1][0];
    const bow = rawBow.map(([x, y]) => [
        x / bowXEnd * t.bowEnd,
        y * (k + (1 - k) * Math.min(1, x / bowXEnd))
    ]);
    const span = t.sternStart - t.bowEnd;
    const mid = MID_SECTION[code].map(([x, y], i) => [
        t.bowEnd + span * (i === 0 ? 0.2 : 0.72),
        y * t.midScale
    ]);
    const rawStern = STERN_STYLES[t.stern];
    const sternX0 = rawStern[0][0];
    const stern = rawStern.map(([x, y]) => [
        t.sternStart + (x - sternX0) / (1 - sternX0) * (1 - t.sternStart),
        y * t.midScale
    ]);
    return [...bow, ...mid, ...stern];
}

// 各国舰宽的细微差异：日系修长、意/法紧凑、德/美偏宽
const FACTION_BEAM = {
    CL: { us: 31, ijn: 28.5, rn: 29.5, km: 30.5, fn: 29, rm: 30.5, sn: 30 },
    DD: { us: 22.6, ijn: 21, rn: 21.4, km: 22.4, fn: 20.6, rm: 20.2, sn: 20.8 },
    SS: { us: 10, ijn: 10.8, rn: 10.2, km: 9.6, fn: 10.6, rm: 10, sn: 9.6 }
};

// 全局舰宽系数：史实主力舰长宽比约 8:1 以上，原建模偏胖，统一收窄
const BEAM_SCALE = 0.85;

function beamFor(code, factionId, lay) {
    const base = lay?.beam || FACTION_BEAM[code]?.[factionId] || HULL_BEAM[code];
    return base * BEAM_SCALE;
}

// ---------- 渐变与滤镜 ----------

function svgDefs(id, P) {
    // 光照来自左上方：受光面偏亮、背光舷侧压暗，形成俯视 2.5D 的圆柱体积
    const hullMid = mixHex(P.hullLo, P.hullHi, 0.55);
    const hullDeep = mixHex(P.hullLo, '#000000', 0.38);
    return `<defs>
        <linearGradient id="${id}-gHull" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${P.hullLo}"/><stop offset="0.20" stop-color="${P.hullHi}"/>
            <stop offset="0.52" stop-color="${hullMid}"/><stop offset="1" stop-color="${hullDeep}"/>
        </linearGradient>
        <linearGradient id="${id}-gDeck" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${P.deckHi}"/><stop offset="0.45" stop-color="${P.deckLo}"/><stop offset="1" stop-color="${P.deckLo}"/>
        </linearGradient>
        <linearGradient id="${id}-gCase" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mixHex(P.deckLo, '#000000', 0.28)}"/>
            <stop offset="0.2" stop-color="${P.deckHi}"/>
            <stop offset="0.55" stop-color="${P.deckLo}"/>
            <stop offset="1" stop-color="${mixHex(P.deckLo, '#000000', 0.34)}"/>
        </linearGradient>
        <linearGradient id="${id}-gSide" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mixHex(P.hullLo, '#000', 0.15)}"/><stop offset="1" stop-color="${mixHex(P.hullLo, '#000', 0.62)}"/>
        </linearGradient>
        <linearGradient id="${id}-gSub" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mixHex(P.hullHi, '#eaf3f8', 0.1)}"/>
            <stop offset="0.14" stop-color="${P.hullHi}"/>
            <stop offset="0.38" stop-color="${mixHex(P.hullLo, P.hullHi, 0.42)}"/>
            <stop offset="0.72" stop-color="${mixHex(P.hullLo, '#000000', 0.2)}"/>
            <stop offset="1" stop-color="${mixHex(P.hullLo, '#000000', 0.52)}"/>
        </linearGradient>
        <linearGradient id="${id}-gSheen" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#eaf4fa" stop-opacity="0"/>
            <stop offset="0.3" stop-color="#eaf4fa" stop-opacity="0.55"/>
            <stop offset="0.72" stop-color="#d3e3ed" stop-opacity="0.38"/>
            <stop offset="1" stop-color="#eaf4fa" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="${id}-gTur" x1="0.15" y1="0" x2="0.35" y2="1">
            <stop offset="0" stop-color="${mixHex(P.sup, '#ffffff', 0.08)}"/>
            <stop offset="0.45" stop-color="${mixHex(P.sup, P.supLo, 0.25)}"/>
            <stop offset="1" stop-color="${mixHex(P.supLo, '#000000', 0.42)}"/>
        </linearGradient>
        <linearGradient id="${id}-gTurSide" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mixHex(P.supLo, '#000000', 0.2)}"/>
            <stop offset="1" stop-color="${mixHex(P.supLo, '#000000', 0.62)}"/>
        </linearGradient>
        <linearGradient id="${id}-gTurFace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mixHex(P.sup, '#000000', 0.12)}"/>
            <stop offset="0.6" stop-color="${mixHex(P.supLo, '#000000', 0.22)}"/>
            <stop offset="1" stop-color="${mixHex(P.supLo, '#000000', 0.5)}"/>
        </linearGradient>
        <linearGradient id="${id}-gSup" x1="0.1" y1="0" x2="0.4" y2="1">
            <stop offset="0" stop-color="${mixHex(P.sup, '#ffffff', 0.14)}"/>
            <stop offset="0.45" stop-color="${mixHex(P.sup, P.supLo, 0.18)}"/>
            <stop offset="1" stop-color="${mixHex(P.supLo, '#000000', 0.24)}"/>
        </linearGradient>
        <linearGradient id="${id}-gSupBase" x1="0.12" y1="0" x2="0.45" y2="1">
            <stop offset="0" stop-color="${mixHex(P.supLo, P.outline, 0.06)}"/>
            <stop offset="0.5" stop-color="${mixHex(P.supLo, P.outline, 0.26)}"/>
            <stop offset="1" stop-color="${mixHex(P.supLo, P.outline, 0.5)}"/>
        </linearGradient>
        <linearGradient id="${id}-gIsl" x1="0.08" y1="0" x2="0.4" y2="1">
            <stop offset="0" stop-color="${mixHex(P.sup, '#ffffff', 0.12)}"/>
            <stop offset="0.5" stop-color="${mixHex(P.sup, P.supLo, 0.55)}"/>
            <stop offset="1" stop-color="${mixHex(P.supLo, '#000000', 0.22)}"/>
        </linearGradient>
        <linearGradient id="${id}-gBarrel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mixHex(P.barrel, '#88939c', 0.35)}"/>
            <stop offset="0.5" stop-color="${P.barrel}"/>
            <stop offset="1" stop-color="${mixHex(P.barrel, '#000000', 0.45)}"/>
        </linearGradient>
        <linearGradient id="${id}-gTorp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${mixHex(P.supLo, '#dfe7ed', 0.38)}"/>
            <stop offset="0.42" stop-color="${mixHex(P.supLo, P.barrel, 0.45)}"/>
            <stop offset="1" stop-color="${mixHex(P.barrel, '#000000', 0.3)}"/>
        </linearGradient>
        <linearGradient id="${id}-gFun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.6" stop-color="${P.fun}"/><stop offset="1" stop-color="${P.outline}"/>
        </linearGradient>
        <linearGradient id="${id}-gFun2" x1="0.1" y1="0" x2="0.65" y2="1">
            <stop offset="0" stop-color="${mixHex(P.fun, P.hullHi, 0.72)}"/>
            <stop offset="0.42" stop-color="${mixHex(P.fun, P.supLo, 0.3)}"/>
            <stop offset="1" stop-color="${mixHex(P.fun, '#000000', 0.42)}"/>
        </linearGradient>
        <filter id="${id}-fSh" x="-15%" y="-40%" width="130%" height="180%">
            <feDropShadow dx="1.2" dy="2" stdDeviation="1.4" flood-color="#000" flood-opacity="0.45"/>
        </filter>
        <filter id="${id}-fPart" x="-40%" y="-70%" width="180%" height="240%">
            <feDropShadow dx="0.9" dy="1.6" stdDeviation="0.85" flood-color="#000" flood-opacity="0.55"/>
        </filter>
        <filter id="${id}-fSmoke" x="-60%" y="-80%" width="220%" height="260%">
            <feGaussianBlur stdDeviation="1.7"/>
        </filter>
        <filter id="${id}-fBlur" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="0.45"/>
        </filter>
        <radialGradient id="${id}-gFlue" cx="0.42" cy="0.38" r="0.68">
            <stop offset="0" stop-color="#1b232a"/>
            <stop offset="0.55" stop-color="#121920"/>
            <stop offset="1" stop-color="#39434b"/>
        </radialGradient>
    </defs>`;
}

// ---------- 各舰种绘制 ----------

function drawWarship(code, lay, P, id, factionId) {
    const L = HULL_LEN[code], B = beamFor(code, factionId, lay);
    const cy = B / 2;
    const hullPts = mirrorPts(hullProfile(code, factionId), L, B);
    const deckPts = insetPts(hullPts, cy, 0.86, 6);
    const scale = code === 'BB' ? 0.78 : (code === 'CL' ? 0.52 : 0.44);
    const hullD = crPath(hullPts);
    const sideDrop = code === 'BB' ? 3.2 : (code === 'CL' ? 2.4 : 1.8);
    const f = (v) => v.toFixed(1);

    // 船体侧面（向下偏移）→ 俯视下的厚度；再叠船体顶面
    let s = `<path d="${hullD}" transform="translate(0,${sideDrop})" fill="url(#${id}-gSide)"/>`;
    s += `<path d="${hullD}" fill="url(#${id}-gHull)" stroke="${P.outline}" stroke-width="1.5" vector-effect="non-scaling-stroke" filter="url(#${id}-fSh)"/>`;
    // 舷墙：甲板边缘的深色围板
    s += `<path d="${crPath(deckPts)}" fill="none" stroke="${mixHex(P.hullLo, '#000000', 0.3)}" stroke-width="3" vector-effect="non-scaling-stroke" opacity="0.95"/>`;
    // 甲板
    s += `<path d="${crPath(deckPts)}" fill="url(#${id}-gDeck)" stroke="${P.outline}" stroke-width="0.7" vector-effect="non-scaling-stroke"/>`;
    // 舷侧栏杆
    s += `<path d="${crPath(insetPts(deckPts, cy, 0.94, 3))}" fill="none" stroke="rgba(222,236,248,0.3)" stroke-width="0.55" stroke-dasharray="3 2.6" vector-effect="non-scaling-stroke"/>`;
    // 甲板铺装纹理
    s += `<clipPath id="${id}-clipDeck"><path d="${crPath(deckPts)}"/></clipPath>`;
    s += `<g clip-path="url(#${id}-clipDeck)">`;
    // 甲板铺装：木板沿舰体纵向铺设（俯视时是横线），钢板则按分块焊缝
    if (P.deckStyle === 'wood') {
        let n = 0;
        for (let y = 2.2; y < B - 1.2; y += 3.4) {
            s += `<line x1="0" y1="${f(y)}" x2="${L}" y2="${f(y)}" stroke="${P.deckLo}" stroke-width="0.55" opacity="${n % 4 === 0 ? 0.85 : 0.45}"/>`;
            n++;
        }
        // 横向的甲板接缝
        for (let x = 22; x < L - 12; x += 46) {
            s += `<line x1="${x}" y1="0" x2="${x}" y2="${B}" stroke="${P.deckLo}" stroke-width="0.4" opacity="0.28"/>`;
        }
    } else {
        for (let y = 2.4; y < B - 1.4; y += 5.4) {
            s += `<line x1="0" y1="${f(y)}" x2="${L}" y2="${f(y)}" stroke="${P.deckHi}" stroke-width="0.5" opacity="0.3"/>`;
        }
        for (let x = 18; x < L - 10; x += 32) {
            s += `<line x1="${x}" y1="0" x2="${x}" y2="${B}" stroke="${P.deckHi}" stroke-width="0.5" opacity="0.22"/>`;
        }
    }
    s += `</g>`;

    // 甲板属具：锚链、系缆、舱口、通风、救生筏、舰载艇
    s += deckDetailsLow(code, lay, deckPts, cy, B, L, P, id);
    // 防浪板（战列舰/巡洋舰）
    if (code === 'BB' || code === 'CL') {
        const bx0 = lay.bridge ? lay.bridge.x - 4.5 : L * 0.4;
        const hw = B * (code === 'BB' ? 0.31 : 0.33);
        const sw = code === 'BB' ? 1.8 : 1.35;
        const bw = `M ${f(bx0)} ${f(cy - hw)} Q ${f(bx0 + 5)} ${f(cy)} ${f(bx0)} ${f(cy + hw)}`;
        s += `<path d="${bw}" fill="none" stroke="${mixHex(P.hullLo, '#000000', 0.3)}" stroke-width="${sw}" stroke-linecap="round" opacity="0.85"/>`;
        s += `<path d="${bw}" fill="none" stroke="${P.hullHi}" stroke-width="${sw * 0.33}" stroke-linecap="round" opacity="0.4" transform="translate(0.8,0.7)"/>`;
    }

    // 鱼雷发射管是低矮甲板装备，压在下层炮塔与上层建筑之下
    for (const t of (lay.torp || [])) {
        const [tx, tubes = 3, side = 0, tl = 10.6] = Array.isArray(t) ? t : [t, 3];
        s += torpMount(tx, cy + side * B * 0.33, P, id, tubes, tl, side);
    }
    // 分层绘制：下层炮塔 → 上层建筑 → 叠炮 → 烟囱 → 杂项
    const turrets = lay.turrets || [];
    const secTurrets = lay.sec || [];
    const secScale = code === 'BB' ? 0.5 : scale;
    for (const t of turrets) {
        if (!t[3]) s += turret(t[0], cy, scale, t[1], t[2], false, P, id, factionId);
    }
    for (const t of secTurrets) {
        if (!t[3]) s += turret(t[0], cy, secScale, t[1], t[2], false, P, id, factionId);
    }
    if (lay.bridge) {
        s += superstructure(lay.bridge.x, lay.bridge.w, cy, B, lay.bridge.style, P, id);
        if (lay.aa || lay.aa40) s += aaMounts(lay.aa, cy, B, P, lay.aa40, code);
    }
    for (const t of turrets) {
        if (t[3]) s += turret(t[0], cy, scale, t[1], t[2], true, P, id, factionId);
    }
    for (const t of secTurrets) {
        if (t[3]) s += turret(t[0], cy, secScale, t[1], t[2], true, P, id, factionId);
    }
    for (const f of (lay.funnels || [])) {
        s += funnel(f[0], cy, f[1], f[2], !!f[3], P, id);
    }
    s += deckDetailsHigh(code, lay, deckPts, cy, B, L, P, id);
    if (lay.catapult) {
        s += catapult(L - 42, cy - B * 0.28, 26, P);
        if (lay.catapult > 1) s += catapult(L - 42, cy + B * 0.28, 26, P);
        s += deckPlane(L - 22, cy, 90, P);
        if (lay.plane > 1) s += deckPlane(L - 34, cy + B * 0.3, 90, P);
    } else if (lay.plane) {
        s += deckPlane(L - 22, cy, 90, P);
    }
    if (lay.badge) {
        const bx = L - 16, by = cy - B * 0.26, r = 3.4;
        const pts = [];
        for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + i * Math.PI / 5;
            const rr = i % 2 ? r * 0.42 : r;
            pts.push(`${f(bx + Math.cos(a) * rr)},${f(by + Math.sin(a) * rr)}`);
        }
        s += `<path d="M ${pts.join(' L ')} Z" fill="${P.accent}" stroke="#f2f5f7" stroke-width="0.7" opacity="0.92"/>`;
    }
    return s;
}

// ---------- 航母：飞行甲板 / 舰岛 ----------

// 飞行甲板轮廓：平行舷边 + 方艉 + 短过渡的平直钝艏
// 俯视平面图上航母甲板前端是一段有宽度的直边，而不是两段弧线交汇的尖锥
function cvDeckPath(cy, o, d = 0) {
    const f = (v) => (+v).toFixed(1);
    const hw = Math.max(3, o.hw - d);
    const bowLen = Math.max(7, o.bowLen - d * 0.7);
    const sx = o.sx - d;
    const c = Math.max(0.6, o.corner - d * 0.3);
    const x0 = o.x0 + d * 1.2;
    const shoulder = x0 + bowLen;
    const yT = cy - hw, yB = cy + hw;
    const tip = Math.max(2.4, o.nose - d * 0.3);
    const rc = Math.min(1.3, tip * 0.24);
    // 艉部：stern>0 时用半椭圆艉，数值越大越圆；0 为方艉
    const st = Math.max(0, Math.min((o.stern || 0) - d * 0.4, hw * 1.3));
    const b1x = f(x0 + bowLen * 0.58), b2x = f(x0 + bowLen * 0.16);
    const sternD = st > 1.2
        ? ` L ${f(sx - st)} ${f(yT)} A ${f(st)} ${f(hw)} 0 0 1 ${f(sx - st)} ${f(yB)}`
        : ` L ${f(sx - c)} ${f(yT)} Q ${f(sx)} ${f(yT)} ${f(sx)} ${f(yT + c)}`
          + ` L ${f(sx)} ${f(yB - c)} Q ${f(sx)} ${f(yB)} ${f(sx - c)} ${f(yB)}`;
    return `M ${f(shoulder)} ${f(yT)}`
        + sternD
        + ` L ${f(shoulder)} ${f(yB)}`
        + ` C ${b1x} ${f(yB)} ${b2x} ${f(cy + tip * 1.1)} ${f(x0 + rc)} ${f(cy + tip)}`
        + ` Q ${f(x0)} ${f(cy + tip)} ${f(x0)} ${f(cy + tip - rc)}`
        + ` L ${f(x0)} ${f(cy - tip + rc)}`
        + ` Q ${f(x0)} ${f(cy - tip)} ${f(x0 + rc)} ${f(cy - tip)}`
        + ` C ${b2x} ${f(cy - tip * 1.1)} ${b1x} ${f(yT)} ${f(shoulder)} ${f(yT)} Z`;
}

// 升降机：矩形 / 德系八边形，带下沉边框与交叉加强筋
function cvElevator(cx, cy, w, h, oct, P, id) {
    const f = (v) => (+v).toFixed(1);
    const x0 = cx - w / 2, y0 = cy - h / 2;
    const fill = mixHex(P.deckLo, '#000000', 0.16);
    const joint = mixHex(P.deckLo, '#000000', 0.4);
    const octD = (bx, by, bw, bh, c) => `M ${f(bx + c)} ${f(by)} L ${f(bx + bw - c)} ${f(by)} L ${f(bx + bw)} ${f(by + c)} L ${f(bx + bw)} ${f(by + bh - c)} L ${f(bx + bw - c)} ${f(by + bh)} L ${f(bx + c)} ${f(by + bh)} L ${f(bx)} ${f(by + bh - c)} L ${f(bx)} ${f(by + c)} Z`;
    let s = '';
    if (oct) {
        const d = octD(x0, y0, w, h, 2.4);
        s += `<path d="${d}" transform="translate(0.8,1.2)" fill="${P.outline}" opacity="0.38"/>`;
        s += `<path d="${d}" fill="${fill}" stroke="${P.outline}" stroke-width="0.6"/>`;
        s += `<path d="${octD(x0 + 1.2, y0 + 1.2, w - 2.4, h - 2.4, 1.8)}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="0.45"/>`;
    } else {
        s += `<rect x="${f(x0 + 0.8)}" y="${f(y0 + 1.2)}" width="${f(w)}" height="${f(h)}" rx="0.8" fill="${P.outline}" opacity="0.38"/>`;
        s += `<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" rx="0.8" fill="${fill}" stroke="${P.outline}" stroke-width="0.6"/>`;
        s += `<rect x="${f(x0 + 1.1)}" y="${f(y0 + 1.1)}" width="${f(w - 2.2)}" height="${f(h - 2.2)}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="0.4"/>`;
    }
    s += `<line x1="${f(x0 + 1.4)}" y1="${f(y0 + 1.4)}" x2="${f(x0 + w - 1.4)}" y2="${f(y0 + h - 1.4)}" stroke="${joint}" stroke-width="0.35" opacity="0.5"/>`;
    s += `<line x1="${f(x0 + w - 1.4)}" y1="${f(y0 + 1.4)}" x2="${f(x0 + 1.4)}" y2="${f(y0 + h - 1.4)}" stroke="${joint}" stroke-width="0.35" opacity="0.5"/>`;
    return s;
}

// 弹射器：凹槽滑轨 + 滑块，避免旧版的“长矛”造型
function cvCatapult(x1, y1, x2, y2, P, id) {
    const f = (v) => (+v).toFixed(1);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    let s = `<g transform="translate(${f(x1)},${f(y1)}) rotate(${f(ang)})">`;
    // 凹槽滑轨：窄而深，中央导槽 + 前端挡焰板 + 滑块
    s += `<rect x="-0.6" y="-1.15" width="${f(len + 0.6)}" height="2.3" rx="1.15" fill="${mixHex(P.deckLo, '#000000', 0.45)}" opacity="0.85"/>`;
    s += `<rect x="-0.6" y="-1.15" width="${f(len + 0.6)}" height="2.3" rx="1.15" fill="none" stroke="${P.outline}" stroke-width="0.2" opacity="0.55"/>`;
    s += `<line x1="0.4" y1="0" x2="${f(len - 0.5)}" y2="0" stroke="rgba(255,255,255,0.2)" stroke-width="0.26"/>`;
    s += `<rect x="-0.2" y="-0.9" width="2.1" height="1.8" rx="0.3" fill="${mixHex(P.supLo, P.outline, 0.4)}" stroke="${P.outline}" stroke-width="0.2"/>`;
    s += `<path d="M ${f(len)} -1.35 L ${f(len + 0.9)} -1.5 L ${f(len + 0.55)} 0 L ${f(len + 0.9)} 1.5 L ${f(len)} 1.35 Z" fill="${mixHex(P.supLo, P.outline, 0.55)}" stroke="${P.outline}" stroke-width="0.16"/>`;
    s += `</g>`;
    return s;
}

// 舰岛上的紧凑烟囱（俯视：壳体顶面 + 收小的烟道口）
function islFunnel(cx, cy, w, h, P, id) {
    const f = (v) => (+v).toFixed(1);
    const rw = w / 2, rh = h / 2;
    const rr = f(Math.min(2.1, rh * 0.45));
    let s = `<rect x="${f(cx - rw + 0.9)}" y="${f(cy - rh + 1.3)}" width="${f(w)}" height="${f(h)}" rx="${rr}" fill="${P.outline}" opacity="0.45"/>`;
    s += `<rect x="${f(cx - rw)}" y="${f(cy - rh)}" width="${f(w)}" height="${f(h)}" rx="${rr}" fill="url(#${id}-gFun2)" stroke="${P.outline}" stroke-width="0.55"/>`;
    s += `<line x1="${f(cx - rw + 1.1)}" y1="${f(cy - rh + 0.5)}" x2="${f(cx + rw - 1.1)}" y2="${f(cy - rh + 0.5)}" stroke="${P.sup}" stroke-width="0.42" opacity="0.5"/>`;
    // 烟道：后偏的暗槽，四周留出厚实的壳体
    const iw = w * 0.44, ih = h * 0.5;
    const ix = cx - iw / 2 + w * 0.06, iy = cy - ih / 2 + 0.3;
    s += `<rect x="${f(ix - 0.4)}" y="${f(iy - 0.4)}" width="${f(iw + 0.8)}" height="${f(ih + 0.8)}" rx="${f(Math.min(1.4, ih * 0.35))}" fill="none" stroke="${mixHex(P.fun, '#dde6ec', 0.5)}" stroke-width="0.4" opacity="0.45"/>`;
    s += `<rect x="${f(ix)}" y="${f(iy)}" width="${f(iw)}" height="${f(ih)}" rx="${f(Math.min(1.3, ih * 0.32))}" fill="#0b1014" stroke="${P.outline}" stroke-width="0.35"/>`;
    s += `<line x1="${f(ix + 0.7)}" y1="${f(iy + ih * 0.35)}" x2="${f(ix + iw - 0.7)}" y2="${f(iy + ih * 0.35)}" stroke="#333d44" stroke-width="0.28" opacity="0.85"/>`;
    s += `<line x1="${f(ix + 0.7)}" y1="${f(iy + ih * 0.66)}" x2="${f(ix + iw - 0.7)}" y2="${f(iy + ih * 0.66)}" stroke="#2a333a" stroke-width="0.26" opacity="0.8"/>`;
    s += `<line x1="${f(cx + rw - 0.6)}" y1="${f(cy + rh * 0.2)}" x2="${f(cx + rw + 1.8)}" y2="${f(cy + rh * 0.2)}" stroke="${P.supLo}" stroke-width="0.55" stroke-linecap="round" opacity="0.75"/>`;
    return s;
}

// 舷侧炮廓：从甲板边缘外伸的炮座，打破飞行甲板的“胶囊”轮廓
function cvSponson(x, side, cy, hw, P, id) {
    const f = (v) => (+v).toFixed(1);
    const py = cy + side * (hw - 1.0);
    const w = 6.2, h = 4.2;
    const y0 = py - h / 2;
    let s = `<rect x="${f(x - w / 2 + 0.7)}" y="${f(y0 + 0.9)}" width="${f(w)}" height="${f(h)}" rx="1.0" fill="${P.outline}" opacity="0.38"/>`;
    s += `<rect x="${f(x - w / 2)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" rx="1.0" fill="${mixHex(P.supLo, P.outline, 0.3)}" stroke="${P.outline}" stroke-width="0.5"/>`;
    s += `<line x1="${f(x - w / 2 + 1.4)}" y1="${f(y0 + (side < 0 ? 0.7 : h - 0.7))}" x2="${f(x + w / 2 - 1.4)}" y2="${f(y0 + (side < 0 ? 0.7 : h - 0.7))}" stroke="${P.sup}" stroke-width="0.3" opacity="0.4"/>`;
    for (const dx of [-1.2, 1.2]) {
        s += `<line x1="${f(x + dx)}" y1="${f(py + side * 0.8)}" x2="${f(x + dx)}" y2="${f(py + side * 3.0)}" stroke="${P.barrel}" stroke-width="0.8" stroke-linecap="round"/>`;
    }
    return s;
}

const CV_TRAITS = {
    // hullK=舰体相对甲板宽度；islW/islH=舰岛平面尺寸
    us: { hullK: 0.72, islW: 27, islH: 7.0 },
    ijn: { hullK: 0.67, islW: 18, islH: 5.4 },
    rn: { hullK: 0.70, islW: 24, islH: 5.8 },
    km: { hullK: 0.74, islW: 32, islH: 7.6 },
    fn: { hullK: 0.82, islW: 11, islH: 3.6 },
    rm: { hullK: 0.72, islW: 18, islH: 5.4 },
    sn: { hullK: 0.70, islW: 20, islH: 5.8 }
};

// 右舷舰岛：底座 + 驾驶室顶 + 顶部测距仪/探照灯 + 烟囱/桅杆，全部按俯视屋顶绘制
function carrierIsland(ix, iy, iw, ih, factionId, P, id) {
    const f = (v) => (+v).toFixed(1);
    const roof = (bx, by, bw, bh, rad = 0.9, fill = `url(#${id}-gTur)`) => {
        let q = `<rect x="${f(bx + 0.6)}" y="${f(by + 0.8)}" width="${f(bw)}" height="${f(bh)}" rx="${f(rad)}" fill="${P.outline}" opacity="0.35"/>`;
        q += `<rect x="${f(bx)}" y="${f(by)}" width="${f(bw)}" height="${f(bh)}" rx="${f(rad)}" fill="${fill}" stroke="${P.outline}" stroke-width="0.5"/>`;
        q += `<line x1="${f(bx + 0.9)}" y1="${f(by + 0.55)}" x2="${f(bx + bw - 0.9)}" y2="${f(by + 0.55)}" stroke="${P.sup}" stroke-width="0.38" opacity="0.65"/>`;
        return q;
    };
    // 测距仪横杆（沿舷宽方向）+ 中央指挥仪
    const rangefinder = (cx, cy0, len) => {
        let q = `<rect x="${f(cx - 0.6)}" y="${f(cy0 - len / 2 + 0.7)}" width="2.2" height="${f(len)}" rx="1.1" fill="${P.outline}" opacity="0.32"/>`;
        q += `<rect x="${f(cx - 1.1)}" y="${f(cy0 - len / 2)}" width="2.2" height="${f(len)}" rx="1.1" fill="${mixHex(P.supLo, P.outline, 0.16)}" stroke="${P.outline}" stroke-width="0.3"/>`;
        q += `<circle cx="${f(cx)}" cy="${f(cy0)}" r="1.15" fill="url(#${id}-gTur)" stroke="${P.outline}" stroke-width="0.3"/>`;
        q += `<circle cx="${f(cx - 0.2)}" cy="${f(cy0 - 0.2)}" r="0.38" fill="${P.sup}" opacity="0.55"/>`;
        return q;
    };
    const searchlight = (cx, cy0) => {
        let q = `<circle cx="${f(cx + 0.4)}" cy="${f(cy0 + 0.6)}" r="1.2" fill="${P.outline}" opacity="0.32"/>`;
        q += `<circle cx="${f(cx)}" cy="${f(cy0)}" r="1.15" fill="${mixHex(P.supLo, P.outline, 0.22)}" stroke="${P.outline}" stroke-width="0.3"/>`;
        q += `<circle cx="${f(cx - 0.15)}" cy="${f(cy0 - 0.15)}" r="0.52" fill="#dbe6ec" stroke="${P.outline}" stroke-width="0.18"/>`;
        return q;
    };
    const mast = (mx, my) => {
        let q = `<line x1="${f(mx)}" y1="${f(my)}" x2="${f(mx - 2.2)}" y2="${f(my + 3)}" stroke="${P.outline}" stroke-width="0.22" opacity="0.28"/>`;
        q += `<line x1="${f(mx)}" y1="${f(my)}" x2="${f(mx + 2.2)}" y2="${f(my + 3)}" stroke="${P.outline}" stroke-width="0.22" opacity="0.28"/>`;
        q += `<line x1="${f(mx)}" y1="${f(my)}" x2="${f(mx + 6.4)}" y2="${f(my)}" stroke="${P.outline}" stroke-width="0.2" opacity="0.28"/>`;
        q += `<circle cx="${f(mx + 6.4)}" cy="${f(my)}" r="0.28" fill="${P.outline}" opacity="0.5"/>`;
        q += `<circle cx="${f(mx + 0.5)}" cy="${f(my + 0.7)}" r="1.05" fill="${P.outline}" opacity="0.3"/>`;
        q += `<circle cx="${f(mx)}" cy="${f(my)}" r="1" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.28"/>`;
        q += `<circle cx="${f(mx)}" cy="${f(my)}" r="0.32" fill="${P.sup}" opacity="0.85"/>`;
        return q;
    };
    // 方形烟囱（美/德）：厚重外壳 + 下沉炉口
    const boxFunnel = (fx, fy, fw, fh, flue = 0.56) => {
        let q = `<rect x="${f(fx + 0.8)}" y="${f(fy + 1.0)}" width="${f(fw)}" height="${f(fh)}" rx="0.5" fill="${P.outline}" opacity="0.42"/>`;
        q += `<rect x="${f(fx)}" y="${f(fy)}" width="${f(fw)}" height="${f(fh)}" rx="0.4" fill="url(#${id}-gFun2)" stroke="${P.outline}" stroke-width="0.55"/>`;
        q += `<rect x="${f(fx + fw * 0.18)}" y="${f(fy + fh * 0.16)}" width="${f(fw * flue)}" height="${f(fh * 0.68)}" rx="0.3" fill="#0b1014" stroke="${P.outline}" stroke-width="0.35"/>`;
        q += `<line x1="${f(fx + 0.7)}" y1="${f(fy + 0.55)}" x2="${f(fx + fw - 0.7)}" y2="${f(fy + 0.55)}" stroke="${P.sup}" stroke-width="0.4" opacity="0.55"/>`;
        for (let gy = fy + fh * 0.3; gy < fy + fh * 0.8; gy += 1.1) {
            q += `<line x1="${f(fx + fw * 0.22)}" y1="${f(gy)}" x2="${f(fx + fw * 0.78)}" y2="${f(gy)}" stroke="#39434a" stroke-width="0.28" opacity="0.85"/>`;
        }
        return q;
    };
    // 舷侧平烟囱 / 一体式烟道（英/法）：低矮圆角壳体，炉口细长
    const flushFunnel = (fx, fy, fw, fh) => {
        let q = `<rect x="${f(fx + 0.7)}" y="${f(fy + 0.9)}" width="${f(fw)}" height="${f(fh)}" rx="${f(fh * 0.42)}" fill="${P.outline}" opacity="0.4"/>`;
        q += `<rect x="${f(fx)}" y="${f(fy)}" width="${f(fw)}" height="${f(fh)}" rx="${f(fh * 0.42)}" fill="url(#${id}-gFun2)" stroke="${P.outline}" stroke-width="0.5"/>`;
        q += `<rect x="${f(fx + fw * 0.16)}" y="${f(fy + fh * 0.22)}" width="${f(fw * 0.68)}" height="${f(fh * 0.56)}" rx="${f(fh * 0.2)}" fill="#0c1217" stroke="${P.outline}" stroke-width="0.3"/>`;
        q += `<line x1="${f(fx + 0.8)}" y1="${f(fy + 0.5)}" x2="${f(fx + fw - 0.8)}" y2="${f(fy + 0.5)}" stroke="${P.sup}" stroke-width="0.36" opacity="0.5"/>`;
        for (let gx = fx + fw * 0.28; gx < fx + fw * 0.8; gx += 1.2) {
            q += `<line x1="${f(gx)}" y1="${f(fy + fh * 0.25)}" x2="${f(gx)}" y2="${f(fy + fh * 0.75)}" stroke="#3a444b" stroke-width="0.24" opacity="0.7"/>`;
        }
        return q;
    };
    // 棱角化屋顶（德）：前端切角更大，带斜面板缝
    const wedgeRoof = (bx, by, bw, bh, cut = 2.2) => {
        const d = `M ${f(bx + cut)} ${f(by)} L ${f(bx + bw)} ${f(by)} L ${f(bx + bw)} ${f(by + bh)} L ${f(bx + cut)} ${f(by + bh)} L ${f(bx)} ${f(by + bh - cut)} L ${f(bx)} ${f(by + cut)} Z`;
        let q = `<path d="${d}" transform="translate(0.7,0.9)" fill="${P.outline}" opacity="0.38"/>`;
        q += `<path d="${d}" fill="url(#${id}-gTur)" stroke="${P.outline}" stroke-width="0.55"/>`;
        q += `<line x1="${f(bx + cut)}" y1="${f(by + 0.6)}" x2="${f(bx + bw - 1)}" y2="${f(by + 0.6)}" stroke="${P.sup}" stroke-width="0.4" opacity="0.6"/>`;
        q += `<line x1="${f(bx + bw * 0.62)}" y1="${f(by + 1)}" x2="${f(bx + bw * 0.38)}" y2="${f(by + bh - 1)}" stroke="${P.outline}" stroke-width="0.3" opacity="0.35"/>`;
        return q;
    };

    let s = `<rect x="${f(ix + 1.0)}" y="${f(iy + 1.2)}" width="${f(iw)}" height="${f(ih)}" rx="0.8" fill="${P.outline}" opacity="0.4" filter="url(#${id}-fPart)"/>`;
    s += `<rect x="${f(ix)}" y="${f(iy)}" width="${f(iw)}" height="${f(ih)}" rx="0.8" fill="url(#${id}-gIsl)" stroke="${P.outline}" stroke-width="0.8" filter="url(#${id}-fPart)"/>`;
    s += `<line x1="${f(ix + 1.7)}" y1="${f(iy + 0.5)}" x2="${f(ix + iw - 1.7)}" y2="${f(iy + 0.5)}" stroke="${P.sup}" stroke-width="0.5" opacity="0.6"/>`;
    s += `<line x1="${f(ix + 2)}" y1="${f(iy + ih - 0.5)}" x2="${f(ix + iw - 2)}" y2="${f(iy + ih - 0.5)}" stroke="${P.outline}" stroke-width="0.6" opacity="0.3"/>`;
    for (let sx = ix + 4.5; sx < ix + iw - 3; sx += 5.6) {
        s += `<line x1="${f(sx)}" y1="${f(iy + 1.4)}" x2="${f(sx)}" y2="${f(iy + ih - 1.4)}" stroke="${P.outline}" stroke-width="0.2" opacity="0.1"/>`;
    }

    if (factionId === 'us') {
        // 埃塞克斯：紧凑方块舰岛 + 后部方形烟囱，前后双桅平台
        const bw = iw * 0.36, bx = ix + 1.2, by = iy + ih * 0.14, bh = ih * 0.64;
        s += roof(bx, by, bw, bh, 0.7);
        s += `<rect x="${f(bx + 0.35)}" y="${f(by + bh * 0.18)}" width="1.15" height="${f(bh * 0.64)}" rx="0.3" fill="${P.outline}" opacity="0.35"/>`;
        s += rangefinder(bx + bw * 0.54, by + bh * 0.52, Math.min(4.2, bh * 0.78));
        s += searchlight(bx + bw * 0.85, by + bh * 0.22);
        s += boxFunnel(ix + iw - iw * 0.29 - 1.1, iy + ih * 0.1, iw * 0.29, ih * 0.8);
        s += mast(ix + iw * 0.42, iy + ih * 0.9);
        s += `<rect x="${f(ix + iw * 0.44)}" y="${f(iy + ih - 0.75)}" width="${f(iw * 0.2)}" height="2.0" rx="0.9" fill="${mixHex(P.supLo, P.sup, 0.25)}" stroke="${P.outline}" stroke-width="0.28"/>`;
    } else if (factionId === 'ijn') {
        // 翔鹤：小型右舷舰岛，后部三脚桅，大烟囱另绘于舷侧
        const bw = iw * 0.6, bx = ix + 0.9, by = iy + ih * 0.12, bh = ih * 0.6;
        s += roof(bx, by, bw, bh, 0.6);
        s += rangefinder(bx + bw * 0.42, by + bh * 0.52, Math.min(3.8, bh * 0.78));
        s += searchlight(bx + bw * 0.78, by + bh * 0.2);
        s += `<rect x="${f(bx + bw + 0.6)}" y="${f(by + bh * 0.18)}" width="${f(iw * 0.17)}" height="${f(bh * 0.64)}" rx="0.45" fill="url(#${id}-gIsl)" stroke="${P.outline}" stroke-width="0.4"/>`;
        s += mast(ix + iw * 0.8, iy + ih * 0.84);
        s += `<rect x="${f(ix + iw * 0.5)}" y="${f(iy + ih - 0.55)}" width="${f(iw * 0.24)}" height="1.8" rx="0.8" fill="${mixHex(P.supLo, P.outline, 0.15)}" stroke="${P.outline}" stroke-width="0.26"/>`;
    } else if (factionId === 'rn') {
        // 皇家方舟：低矮长舰岛，烟囱与舰岛一体、齐平甲板
        const bw = iw * 0.28, bx = ix + 1.1, by = iy + ih * 0.12, bh = ih * 0.68;
        s += roof(bx, by, bw, bh, 0.9);
        s += `<rect x="${f(bx + 0.4)}" y="${f(by + bh * 0.2)}" width="1.0" height="${f(bh * 0.6)}" rx="0.3" fill="${P.outline}" opacity="0.34"/>`;
        s += rangefinder(bx + bw * 0.55, by + bh * 0.52, Math.min(3.6, bh * 0.7));
        s += searchlight(ix + iw * 0.34, iy + ih * 0.3);
        s += flushFunnel(ix + iw * 0.38, iy + ih * 0.2, iw * 0.56, ih * 0.6);
        s += mast(ix + iw * 0.44, iy + ih * 0.86);
    } else if (factionId === 'km') {
        // 齐柏林：大型棱角舰岛 + 后部高方烟囱
        const bw = iw * 0.4, bx = ix + 1.2, by = iy + ih * 0.1, bh = ih * 0.66;
        s += wedgeRoof(bx, by, bw, bh, 2.4);
        s += rangefinder(bx + bw * 0.52, by + bh * 0.52, Math.min(4.4, bh * 0.78));
        s += searchlight(bx + bw * 0.84, by + bh * 0.2);
        s += boxFunnel(ix + iw * 0.63, iy + ih * 0.07, iw * 0.34, ih * 0.86, 0.6);
        s += mast(ix + iw * 0.58, iy + ih * 0.9);
        s += `<rect x="${f(bx + bw + 0.5)}" y="${f(by + bh * 0.26)}" width="${f(iw * 0.1)}" height="${f(bh * 0.48)}" rx="0.3" fill="${mixHex(P.supLo, P.outline, 0.2)}" stroke="${P.outline}" stroke-width="0.26"/>`;
    } else if (factionId === 'fn') {
        // 贝亚恩：几乎无舰岛，只有右舷低矮的飞行指挥台与一根小桅
        s += roof(ix, iy + ih * 0.18, iw, ih * 0.54, 0.8);
        s += `<rect x="${f(ix + 0.5)}" y="${f(iy + ih * 0.3)}" width="1.0" height="${f(ih * 0.3)}" rx="0.3" fill="${P.outline}" opacity="0.3"/>`;
        s += rangefinder(ix + iw * 0.52, iy + ih * 0.45, 3.0);
        s += mast(ix + iw * 0.82, iy + ih * 0.78);
    } else if (factionId === 'rm') {
        // 天鹰：小型舰岛 + 向外下弯的整流烟囱
        const bw = iw * 0.42, bx = ix + 0.9, by = iy + ih * 0.1, bh = ih * 0.66;
        s += roof(bx, by, bw, bh, 0.85);
        s += rangefinder(bx + bw * 0.52, by + bh * 0.52, Math.min(3.8, bh * 0.76));
        const fx = ix + iw * 0.62, fy = iy + ih * 0.4;
        s += `<g transform="rotate(-13 ${f(fx)} ${f(fy)})">${islFunnel(fx, fy, iw * 0.4, ih * 0.6, P, id)}</g>`;
        s += mast(ix + iw * 0.5, iy + ih * 0.9);
    } else {
        // 苏联方案舰：紧凑舰岛 + 后倾板式烟囱
        const bw = iw * 0.44, bx = ix + 0.9, by = iy + ih * 0.1, bh = ih * 0.66;
        s += roof(bx, by, bw, bh, 0.7);
        s += rangefinder(bx + bw * 0.52, by + bh * 0.52, Math.min(3.6, bh * 0.72));
        const fx = ix + iw * 0.6, fy = iy + ih * 0.42;
        s += `<g transform="translate(${f(fx)},${f(fy)}) skewX(-9) translate(${f(-fx)},${f(-fy)})">${islFunnel(fx, fy, iw * 0.38, ih * 0.56, P, id)}</g>`;
        s += mast(ix + iw * 0.42, iy + ih * 0.88);
    }
    return s;
}

function drawCV(lay, P, id, factionId) {
    const L = 240, B = beamFor('CV', factionId, lay);
    const cy = B / 2;
    const f = (v) => (+v).toFixed(1);
    const tr = CV_TRAITS[factionId] || CV_TRAITS.us;
    const dc = lay.deck || {};
    const hw = dc.hw || 14.6;
    // span：舰体在 240 视框内的实际首尾范围，用来体现各国航母的长度差
    const span = lay.span || [2, 238];
    const kx = (span[1] - span[0]) / 236;
    const X = (v) => span[0] + (v - 2) * kx;
    const o = { hw, nose: dc.nose || 9, bowLen: (dc.bowLen || 24) * kx, corner: dc.corner || 2.2, stern: dc.stern || 0, sx: span[1], x0: span[0] };
    const deckD = cvDeckPath(cy, o);
    const elevs = lay.elev || [];
    const lastElev = elevs.length ? Math.max(...elevs) : 160;
    const wireStart = Math.min(216, lastElev + 10);
    const wireGap = Math.min(6.2, (232 - wireStart) / 5);
    const elevW = ((lay.elevSize && lay.elevSize[0]) || 13) * kx;
    const elevH = (lay.elevSize && lay.elevSize[1]) || 11.5;

    // 舰体比飞行甲板窄，首尾收在甲板投影内，甲板外伸形成舷侧悬挑
    const hullPts = mirrorPts(hullProfile('CV', factionId), L, B).map(([hx, hy]) => [X(hx * 0.97 + 4), cy + (hy - cy) * tr.hullK]);
    const hullD = crPath(hullPts);

    let s = '';
    s += `<path d="${deckD}" transform="translate(1.0,1.8)" fill="${P.outline}" opacity="0.38" filter="url(#${id}-fSh)"/>`;
    s += `<path d="${hullD}" transform="translate(0,1.6)" fill="url(#${id}-gSide)"/>`;
    s += `<path d="${hullD}" fill="url(#${id}-gHull)" stroke="${P.outline}" stroke-width="1.2" vector-effect="non-scaling-stroke" filter="url(#${id}-fSh)"/>`;
    // 甲板厚度 + 深色舷缘
    s += `<path d="${deckD}" transform="translate(0,1.3)" fill="${mixHex(P.deckLo, '#000000', 0.58)}"/>`;
    s += `<path d="${deckD}" fill="url(#${id}-gDeck)" stroke="${mixHex(P.hullLo, '#000000', 0.34)}" stroke-width="1.8" filter="url(#${id}-fSh)"/>`;
    s += `<path d="${deckD}" fill="none" stroke="${P.outline}" stroke-width="0.6" vector-effect="non-scaling-stroke"/>`;

    s += `<clipPath id="${id}-clipCv"><path d="${deckD}"/></clipPath>`;
    s += `<g clip-path="url(#${id}-clipCv)">`;
    // 甲板铺装：纵向板缝 + 少量横向接缝
    const seam = mixHex(P.deckLo, '#000000', 0.35);
    for (let y = cy - hw + 2.4; y < cy + hw - 1; y += 3.0) {
        s += `<line x1="0" y1="${f(y)}" x2="${L}" y2="${f(y)}" stroke="${seam}" stroke-width="0.35" opacity="0.26"/>`;
    }
    for (let x = 26; x < 234; x += 52) {
        s += `<line x1="${f(X(x))}" y1="${f(cy - hw)}" x2="${f(X(x))}" y2="${f(cy + hw)}" stroke="${seam}" stroke-width="0.3" opacity="0.14"/>`;
    }
    // 甲板边缘虚线
    s += `<path d="${cvDeckPath(cy, o, 2.0)}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="0.55" stroke-dasharray="3 5"/>`;
    // 中线
    s += `<line x1="${f(X(14))}" y1="${cy}" x2="${f(X(234))}" y2="${cy}" stroke="rgba(255,255,255,0.34)" stroke-width="0.7" stroke-dasharray="8 7"/>`;
    // 阻拦索
    for (let i = 0; i < 6; i++) {
        const wx = X(wireStart + i * wireGap);
        s += `<line x1="${f(wx)}" y1="${f(cy - 10.8)}" x2="${f(wx)}" y2="${f(cy + 10.8)}" stroke="rgba(232,240,246,0.18)" stroke-width="0.4"/>`;
    }
    s += `<line x1="${f(X(wireStart - 5))}" y1="${f(cy - 9)}" x2="${f(X(wireStart - 5))}" y2="${f(cy + 9)}" stroke="rgba(255,255,255,0.16)" stroke-width="0.45"/>`;
    // 升降机
    for (const ex of elevs) {
        s += cvElevator(X(ex), cy, elevW, elevH, !!lay.oct, P, id);
    }
    // 甲板边线：英系双线、法系单线，均为实舰甲板识别线
    if (lay.edgeLines) {
        const insets = lay.edgeLines >= 2 ? [2.2, 4.3] : [3.1];
        for (const sy of [-1, 1]) {
            for (const inset of insets) {
                s += `<line x1="${f(X(10))}" y1="${f(cy + sy * (hw - inset))}" x2="${f(X(234))}" y2="${f(cy + sy * (hw - inset))}" stroke="rgba(240,244,240,0.5)" stroke-width="0.55"/>`;
            }
        }
    }
    // 飞行甲板标识按实舰俯视图绘制，不涂国籍徽：
    // 日系为艏部十度放射线 + 艉部着舰白圈；英系为前部着舰白圈；美系仅保留艏部舷号。
    if (factionId === 'ijn') {
        const fx0 = X(38);
        const ln = 38 * kx;
        for (let i = -3; i <= 3; i++) {
            const aa = i * 10 * Math.PI / 180;
            s += `<line x1="${f(fx0)}" y1="${cy}" x2="${f(fx0 + Math.cos(aa) * ln)}" y2="${f(cy + Math.sin(aa) * ln)}" stroke="rgba(240,244,240,0.45)" stroke-width="0.5"/>`;
        }
        s += `<circle cx="${f(X(218))}" cy="${cy}" r="${f(5.8 * kx + 1.2)}" fill="none" stroke="rgba(240,244,240,0.55)" stroke-width="0.85"/>`;
    } else if (factionId === 'rn') {
        s += `<circle cx="${f(X(47))}" cy="${cy}" r="${f(7.0 * kx + 1.0)}" fill="none" stroke="rgba(240,244,240,0.55)" stroke-width="0.8"/>`;
    }
    if (lay.num) {
        const nx = X(26);
        s += `<text x="${f(nx)}" y="${f(cy)}" text-anchor="middle" transform="rotate(-90 ${f(nx)} ${f(cy)})" font-size="11" font-weight="700" letter-spacing="0.4" fill="rgba(255,255,255,0.82)" stroke="rgba(0,0,0,0.25)" stroke-width="0.25" font-family="ui-monospace, Menlo, Consolas, monospace">${lay.num}</text>`;
    }
    s += `</g>`;

    // 左舷外伸升降机（美/英）
    if (lay.edgeElev != null) {
        const ew = 14 * kx, eh = 5.0;
        const ex0 = X(lay.edgeElev) - ew / 2;
        const ey0 = cy + hw - 4.6;
        s += `<rect x="${f(ex0 + 0.7)}" y="${f(ey0 + 0.9)}" width="${f(ew)}" height="${f(eh)}" rx="0.8" fill="${P.outline}" opacity="0.4"/>`;
        s += `<rect x="${f(ex0)}" y="${f(ey0)}" width="${f(ew)}" height="${f(eh)}" rx="0.8" fill="${mixHex(P.deckLo, '#000000', 0.16)}" stroke="${P.outline}" stroke-width="0.6"/>`;
        s += `<rect x="${f(ex0 + 0.9)}" y="${f(ey0 + 0.9)}" width="${f(ew - 1.8)}" height="${f(eh - 1.8)}" rx="0.5" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="0.4"/>`;
        s += `<line x1="${f(ex0 + 0.9)}" y1="${f(ey0 + 0.9)}" x2="${f(ex0 + ew - 0.9)}" y2="${f(ey0 + eh - 0.9)}" stroke="rgba(255,255,255,0.1)" stroke-width="0.35"/>`;
    }

    // 舷侧炮廓与两舷防空炮座
    for (const [sx, side] of (lay.sponsons || [])) s += cvSponson(X(sx), side, cy, hw, P, id);
    s += aaMounts((lay.aa || [58, 222]).map(X), cy, B, P);

    // 舰首弹射器（日/法无）
    if (lay.cats) {
        const cl = (lay.catLen || 28) * kx;
        s += cvCatapult(X(48), cy - 7.6, X(48) + cl, cy - 10.2, P, id);
        s += cvCatapult(X(48), cy + 7.6, X(48) + cl, cy + 10.2, P, id);
    }

    // 舰载机停放位置按国别布置
    const spots = lay.planeSpots
        ? lay.planeSpots.map(([px, dy, rot]) => [X(px), cy + dy * 0.86, rot])
        : [[X(92), cy - 7.9, 180], [X(110), cy + 7.9, 176], [X(132), cy - 7.9, 184], [X(148), cy + 7.9, 178]];
    for (let i = 0; i < Math.min(lay.planes || 0, spots.length); i++) {
        const [px, py, rot] = spots[i];
        s += deckPlane(px, py, rot, P);
    }

    // 日系右舷大烟囱：向外下弯，突出甲板边缘
    for (const fx of (lay.sidefun || [])) {
        const fy = cy - hw + 3.4;
        const fxX = X(fx);
        s += `<g transform="rotate(-7 ${f(fxX)} ${f(fy)})">${funnel(fxX, fy, 20 * kx, 7.2, true, P, id, false)}</g>`;
    }
    // 法系贝亚恩：无舰岛，右舷甲板边缘平烟囱
    if (factionId === 'fn') {
        const fx2 = X(146), fy2 = cy - hw + 1.8;
        s += `<rect x="${f(fx2 - 9.2)}" y="${f(fy2 - 1.4)}" width="20" height="4.8" rx="2.0" fill="${P.outline}" opacity="0.42"/>`;
        s += `<rect x="${f(fx2 - 10)}" y="${f(fy2 - 2.4)}" width="20" height="4.8" rx="2.0" fill="url(#${id}-gFun2)" stroke="${P.outline}" stroke-width="0.55"/>`;
        s += `<rect x="${f(fx2 - 8.4)}" y="${f(fy2 - 1.5)}" width="16.8" height="3.0" rx="1.4" fill="#0c1217" stroke="${P.outline}" stroke-width="0.3"/>`;
        for (let gx = fx2 - 6; gx <= fx2 + 6; gx += 2.2) {
            s += `<line x1="${gx}" y1="${f(fy2 - 1.2)}" x2="${gx}" y2="${f(fy2 + 1.2)}" stroke="#3a444b" stroke-width="0.28" opacity="0.8"/>`;
        }
    }

    // 右舷舰岛
    s += carrierIsland(X(lay.islandX), cy - hw + 0.4, tr.islW, tr.islH, factionId, P, id);
    return s;
}

function drawSS(lay, P, id, factionId) {
    const L = 60, B = beamFor('SS', factionId, lay), cy = B / 2;
    const k = B / 16;                       // 设计基准是 16 宽，细节按比例压扁
    const Y = (v) => cy + v * k;
    const f = (v) => (+v).toFixed(1);
    // 艇体：长平行中体 + 细长首尾，避免飞艇感
    const prof = [[0.008, 0], [0.025, -0.16], [0.050, -0.32], [0.092, -0.50], [0.145, -0.65],
                  [0.205, -0.75], [0.285, -0.80], [0.400, -0.82], [0.640, -0.82],
                  [0.780, -0.78], [0.865, -0.68], [0.930, -0.50], [0.972, -0.24], [0.995, 0]];
    const hullD = crPath(mirrorPts(prof, L, B));
    const casingSide = mixHex(P.deckLo, '#000000', 0.5);
    let s = `<path d="${hullD}" transform="translate(0,${f(1.15 * k)})" fill="url(#${id}-gSide)"/>`;
    s += `<path d="${hullD}" fill="url(#${id}-gSub)" stroke="${P.outline}" stroke-width="1.1" vector-effect="non-scaling-stroke" filter="url(#${id}-fPart)"/>`;
    // 艇壳反光：沿受光舷的长条高光 + 背光侧冷色反射光
    s += `<clipPath id="${id}-clipSub"><path d="${hullD}"/></clipPath>`;
    s += `<g clip-path="url(#${id}-clipSub)">`;
    s += `<path d="M 2 ${f(cy)} Q 9 ${f(Y(-4.6))} 18 ${f(Y(-5.5))} L 40 ${f(Y(-5.6))} Q 52 ${f(Y(-5.0))} 58 ${f(cy)}" fill="none" stroke="url(#${id}-gSheen)" stroke-width="${f(0.85 * k)}" opacity="0.7" filter="url(#${id}-fBlur)"/>`;
    s += `<path d="M 9 ${f(Y(-5.2))} Q 18 ${f(Y(-6.0))} 32 ${f(Y(-6.05))} L 46 ${f(Y(-5.7))}" fill="none" stroke="${mixHex(P.hullHi, '#eaf4fa', 0.35)}" stroke-width="${f(1.2 * k)}" opacity="0.3" filter="url(#${id}-fBlur)"/>`;
    s += `<path d="M 14 ${f(Y(5.2))} L 42 ${f(Y(5.3))} Q 50 ${f(Y(4.8))} 55 ${f(Y(3.2))}" fill="none" stroke="${mixHex(P.hullHi, '#dbe8f0', 0.5)}" stroke-width="${f(0.35 * k)}" opacity="0.22" filter="url(#${id}-fBlur)"/>`;
    s += `<ellipse cx="34" cy="${f(Y(-3.4))}" rx="12" ry="${f(1.5 * k)}" fill="#dcebf4" opacity="0.08" filter="url(#${id}-fSmoke)"/>`;
    s += `</g>`;
    // 首部受光脊线与背光舷缘
    s += `<path d="M 3 ${cy} Q 7 ${f(Y(-2.6))} 14 ${f(Y(-3.6))}" fill="none" stroke="${P.hullHi}" stroke-width="0.55" opacity="0.55"/>`;
    s += `<path d="M 3.4 ${cy} Q 7.4 ${f(Y(2.6))} 14 ${f(Y(3.6))}" fill="none" stroke="${P.hullHi}" stroke-width="0.4" opacity="0.22"/>`;
    // 德系鞍形压载舱
    if (lay.saddle) {
        for (const sy of [-1, 1]) {
            s += `<path d="M 17 ${f(Y(sy * 3.9))} Q 20 ${f(Y(sy * 7.3))} 30 ${f(Y(sy * 7.5))} Q 42 ${f(Y(sy * 7.3))} 45 ${f(Y(sy * 3.9))} Z" fill="url(#${id}-gSide)" stroke="${P.outline}" stroke-width="0.4"/>`;
            s += `<path d="M 19 ${f(Y(sy * 4.8))} Q 23 ${f(Y(sy * 6.8))} 31 ${f(Y(sy * 6.9))}" fill="none" stroke="${P.hullHi}" stroke-width="0.3" opacity="0.35"/>`;
        }
    }
    // 首水平舵 / 尾水平舵：薄刃片，受光面朝上，避免黑色鱼鳍感
    for (const sy of [-1, 1]) {
        s += `<path d="M 10.2 ${f(Y(sy * 2.9))} L 13.4 ${f(Y(sy * 6.0))} Q 13.9 ${f(Y(sy * 6.9))} 14.6 ${f(Y(sy * 6.5))} L 12.9 ${f(Y(sy * 2.8))} Z" fill="${mixHex(P.hullLo, P.hullHi, 0.35)}" stroke="${P.outline}" stroke-width="0.3"/>`;
        s += `<line x1="10.8" y1="${f(Y(sy * 3.4))}" x2="13.8" y2="${f(Y(sy * 6.1))}" stroke="${P.hullHi}" stroke-width="0.26" opacity="0.55"/>`;
        s += `<path d="M 48.1 ${f(Y(sy * 2.8))} L 49.8 ${f(Y(sy * 5.4))} Q 50.3 ${f(Y(sy * 6.3))} 50.9 ${f(Y(sy * 5.9))} L 49.6 ${f(Y(sy * 2.7))} Z" fill="${mixHex(P.hullLo, P.hullHi, 0.3)}" stroke="${P.outline}" stroke-width="0.28"/>`;
    }
    // 舵（水面状态的舵叶只露出尾部一点）
    s += `<path d="M 57.6 ${f(Y(-0.7))} L 59.7 ${cy} L 57.6 ${f(Y(0.7))} Z" fill="${P.hullLo}" stroke="${P.outline}" stroke-width="0.4"/>`;

    // 甲板围壳（非耐压艇体）：带厚度与纵向铺板
    const ct = [[5.4, cy], [7.6, Y(-1.9)], [11.5, Y(-3.1)], [16, Y(-3.7)], [24, Y(-3.95)],
                [38, Y(-3.9)], [46, Y(-3.5)], [51, Y(-2.4)], [54, Y(-0.9)], [55, cy]];
    const casingPts = ct.concat(ct.slice(0, -1).reverse().map(([x, y]) => [x, 2 * cy - y]));
    const casingD = crPath(casingPts);
    s += `<path d="${casingD}" transform="translate(0,${f(0.4 * k)})" fill="${casingSide}" opacity="0.75"/>`;
    s += `<path d="${casingD}" fill="url(#${id}-gCase)" stroke="${mixHex(P.outline, '#000000', 0.15)}" stroke-width="0.42" vector-effect="non-scaling-stroke"/>`;
    // 围壳内缘的浅色压条，形成平板甲板的厚度
    s += `<path d="${casingD}" fill="none" stroke="${P.deckHi}" stroke-width="0.22" opacity="0.35" transform="translate(0,${f(-0.22 * k)})"/>`;
    s += `<clipPath id="${id}-clipCase"><path d="${casingD}"/></clipPath>`;
    s += `<g clip-path="url(#${id}-clipCase)">`;
    for (let dyv = -2.7; dyv <= 2.7; dyv += 1.2) {
        s += `<line x1="8" y1="${f(Y(dyv))}" x2="54" y2="${f(Y(dyv))}" stroke="${P.deckLo}" stroke-width="0.35" opacity="0.5"/>`;
    }
    for (const x of [18, 37, 46]) {
        s += `<line x1="${x}" y1="${f(cy - 4)}" x2="${x}" y2="${f(cy + 4)}" stroke="${P.deckLo}" stroke-width="0.3" opacity="0.35"/>`;
    }
    // 中部走道纵向缝
    s += `<line x1="11" y1="${f(cy)}" x2="50" y2="${f(cy)}" stroke="${mixHex(P.deckLo, '#000000', 0.25)}" stroke-width="0.28" opacity="0.5"/>`;
    s += `</g>`;
    // 泄水孔：沿围壳两舷的黑色小孔，是潜艇俯视最典型的一排细节
    for (const sy of [-1, 1]) {
        for (let lx = 13; lx <= 47; lx += 3.4) {
            s += `<ellipse cx="${lx}" cy="${f(Y(sy * 3.45))}" rx="0.3" ry="${f(0.22 * k)}" fill="${mixHex(P.deckLo, '#000000', 0.5)}" opacity="0.55"/>`;
        }
    }
    // 围壳顶缘受光
    s += `<path d="M 11 ${f(Y(-3.5))} L 26 ${f(Y(-3.9))} L 40 ${f(Y(-3.7))} L 45 ${f(Y(-3.1))}" fill="none" stroke="${P.deckHi}" stroke-width="0.45" opacity="0.55"/>`;
    // 甲板舱口
    const hatches = [[17.5, 1.0], [39.5, -1.0], [46, 0.9]];
    for (const [hx, hy] of hatches) {
        s += `<circle cx="${hx}" cy="${f(Y(hy))}" r="0.9" fill="${mixHex(P.deckLo, '#000000', 0.4)}" stroke="${P.outline}" stroke-width="0.25"/>`;
        s += `<circle cx="${hx}" cy="${f(Y(hy))}" r="0.62" fill="${mixHex(P.deckHi, P.deckLo, 0.45)}" stroke="${P.outline}" stroke-width="0.22" opacity="0.9"/>`;
        s += `<line x1="${hx - 0.5}" y1="${f(Y(hy) - 0.1)}" x2="${hx + 0.5}" y2="${f(Y(hy) - 0.1)}" stroke="${P.outline}" stroke-width="0.18" opacity="0.5"/>`;
    }
    s += `<rect x="43" y="${f(Y(-2.6))}" width="3" height="${f(1.5 * k)}" rx="0.4" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.3"/>`;

    // 日系前部机库（圆筒形水密机库，位于围壳之前，舱门朝舰首）
    if (lay.hangar) {
        const hlen = 11.8;
        const hx = Math.max(12.6, (lay.sailX || 29) - hlen - 2.4);
        const hh2 = 5.9 * k;
        const hy = Y(-2.55);
        s += `<rect x="${f(hx + 0.8)}" y="${f(hy + 0.8)}" width="${f(hlen)}" height="${f(hh2)}" rx="${f(hh2 / 2)}" fill="${P.outline}" opacity="0.4"/>`;
        s += `<rect x="${f(hx)}" y="${f(hy)}" width="${f(hlen)}" height="${f(hh2)}" rx="${f(hh2 / 2)}" fill="url(#${id}-gSup)" stroke="${P.outline}" stroke-width="0.55" filter="url(#${id}-fPart)"/>`;
        s += `<line x1="${f(hx + 2.2)}" y1="${f(hy + 0.8)}" x2="${f(hx + hlen - 2.2)}" y2="${f(hy + 0.8)}" stroke="${P.sup}" stroke-width="0.4" opacity="0.6"/>`;
        // 前端舱门与门缝
        s += `<line x1="${f(hx + 1.25)}" y1="${f(hy + 0.55)}" x2="${f(hx + 1.25)}" y2="${f(hy + hh2 - 0.55)}" stroke="${P.outline}" stroke-width="0.65" opacity="0.8"/>`;
        s += `<line x1="${f(hx + 1.85)}" y1="${f(hy + 0.55)}" x2="${f(hx + 1.85)}" y2="${f(hy + hh2 - 0.55)}" stroke="${P.supLo}" stroke-width="0.28" opacity="0.55"/>`;
        s += `<circle cx="${f(hx + 0.8)}" cy="${f(hy + hh2 / 2)}" r="0.55" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.24"/>`;
    }

    // 絮库夫：围壳后方的水密机库（舱门朝舰尾）
    if (lay.hangarAft) {
        const hx = (lay.sailX || 25) + (lay.sailLen || 10) + 2.2;
        const hlen = 11.5;
        const hy = Y(-2.9), hh2 = 5.8 * k;
        s += `<rect x="${f(hx + 0.7)}" y="${f(hy + 0.8)}" width="${f(hlen)}" height="${f(hh2)}" rx="${f(hh2 / 2)}" fill="${P.outline}" opacity="0.4"/>`;
        s += `<rect x="${f(hx)}" y="${f(hy)}" width="${f(hlen)}" height="${f(hh2)}" rx="${f(hh2 / 2)}" fill="url(#${id}-gSup)" stroke="${P.outline}" stroke-width="0.5" filter="url(#${id}-fPart)"/>`;
        s += `<line x1="${f(hx + 2)}" y1="${f(hy + 0.9)}" x2="${f(hx + hlen - 2)}" y2="${f(hy + 0.9)}" stroke="${P.sup}" stroke-width="0.4" opacity="0.6"/>`;
        s += `<line x1="${f(hx + hlen - 1.6)}" y1="${f(hy + 0.6)}" x2="${f(hx + hlen - 1.6)}" y2="${f(hy + hh2 - 0.6)}" stroke="${P.outline}" stroke-width="0.6" opacity="0.75"/>`;
        s += `<line x1="${f(hx + 3)}" y1="${f(hy + hh2 * 0.5)}" x2="${f(hx + hlen - 3)}" y2="${f(hy + hh2 * 0.5)}" stroke="${P.outline}" stroke-width="0.3" opacity="0.4"/>`;
        // 机库后方的小吊车
        s += `<line x1="${f(hx + hlen + 0.6)}" y1="${f(cy)}" x2="${f(hx + hlen + 5)}" y2="${f(Y(-1.7))}" stroke="${P.supLo}" stroke-width="0.7" stroke-linecap="round"/>`;
        s += `<circle cx="${f(hx + hlen + 0.6)}" cy="${f(cy)}" r="0.65" fill="${P.supLo}" stroke="${P.outline}" stroke-width="0.24"/>`;
    }

    // 甲板炮：低矮装甲炮座 + 细长炮管；炮座在首部或尾部（伊四百的 14cm 炮在围壳之后）
    if (lay.gun) {
        const aft = !!lay.gunAft;
        const gx = aft ? 43.5 : 12.4;
        const gw = lay.gunBig ? 4.4 : 3.2, gh = lay.gunBig ? 3.0 : 2.2;
        const x0 = gx - gw / 2, x1 = gx + gw / 2, ch = 0.7;
        const shield = `M ${f(x0 + ch)} ${f(cy - gh / 2)} L ${f(x1 - ch)} ${f(cy - gh / 2)} L ${f(x1)} ${f(cy - gh / 2 + ch)} L ${f(x1)} ${f(cy + gh / 2 - ch)} L ${f(x1 - ch)} ${f(cy + gh / 2)} L ${f(x0 + ch)} ${f(cy + gh / 2)} L ${f(x0)} ${f(cy + gh / 2 - ch)} L ${f(x0)} ${f(cy - gh / 2 + ch)} Z`;
        s += `<path d="${shield}" transform="translate(0.6,0.9)" fill="${P.outline}" opacity="0.35"/>`;
        s += `<path d="${shield}" fill="url(#${id}-gTur)" stroke="${P.outline}" stroke-width="0.42"/>`;
        s += `<line x1="${f(x0 + ch + 0.3)}" y1="${f(cy - gh / 2 + 0.35)}" x2="${f(x1 - ch - 0.3)}" y2="${f(cy - gh / 2 + 0.35)}" stroke="${P.sup}" stroke-width="0.3" opacity="0.6"/>`;
        const nb = lay.gunBig ? 2 : 1;
        for (let i = 0; i < nb; i++) {
            const by = cy + (i - (nb - 1) / 2) * 1.2;
            const bx = aft ? x1 + 0.2 : x0 - 6.4;
            s += `<rect x="${f(bx)}" y="${f(by - 0.42)}" width="6.6" height="0.84" rx="0.35" fill="url(#${id}-gBarrel)" stroke="${P.outline}" stroke-width="0.2"/>`;
            s += `<rect x="${f(aft ? bx + 5.5 : bx - 0.3)}" y="${f(by - 0.58)}" width="1.2" height="1.16" rx="0.25" fill="${P.outline}"/>`;
        }
    }

    // 指挥台围壳：流线型，前缘圆钝、后缘收窄
    const sLen = lay.sailLen || 9;
    const sx = lay.sailX || 26;
    const sx2 = Math.min(sx + sLen, 48);
    const sailD = `M ${f(sx + 1.1)} ${f(Y(-2.6))} L ${f(sx2 - 1.5)} ${f(Y(-2.25))} Q ${f(sx2 - 0.2)} ${f(Y(-2.15))} ${f(sx2)} ${f(Y(-1.2))} L ${f(sx2)} ${f(Y(1.2))} Q ${f(sx2 - 0.2)} ${f(Y(2.15))} ${f(sx2 - 1.5)} ${f(Y(2.25))} L ${f(sx + 1.1)} ${f(Y(2.6))} L ${f(sx + 0.3)} ${f(Y(1.9))} L ${f(sx + 0.3)} ${f(Y(-1.9))} Z`;
    s += `<path d="${sailD}" transform="translate(0.8,1.0)" fill="${P.outline}" opacity="0.4"/>`;
    s += `<path d="${sailD}" fill="url(#${id}-gSup)" stroke="${P.outline}" stroke-width="0.55" filter="url(#${id}-fPart)"/>`;
    s += `<line x1="${f(sx + 1.8)}" y1="${f(Y(-2.1))}" x2="${f(sx2 - 2.6)}" y2="${f(Y(-1.95))}" stroke="${P.sup}" stroke-width="0.45" opacity="0.7"/>`;
    // 驾驶台围板与风挡
    const cw = Math.min(3.2, sLen * 0.3);
    s += `<rect x="${f(sx + 0.9)}" y="${f(cy - 0.8)}" width="${f(cw)}" height="1.6" rx="0.6" fill="${mixHex(P.supLo, P.outline, 0.3)}" stroke="${P.outline}" stroke-width="0.3"/>`;
    s += `<line x1="${f(sx + 1.3)}" y1="${f(cy - 0.3)}" x2="${f(sx + 0.9 + cw - 0.3)}" y2="${f(cy - 0.3)}" stroke="${P.sup}" stroke-width="0.25" opacity="0.5"/>`;
    s += `<line x1="${f(sx + 1.3)}" y1="${f(cy + 0.3)}" x2="${f(sx + 0.9 + cw - 0.3)}" y2="${f(cy + 0.3)}" stroke="${P.outline}" stroke-width="0.22" opacity="0.4"/>`;
    // 潜望镜围井
    const mx = sx2 - 2.2;
    s += `<rect x="${f(mx - 1.1)}" y="${f(Y(-1.5))}" width="4.2" height="${f(3.0 * k)}" rx="0.6" fill="${mixHex(P.supLo, P.sup, 0.35)}" stroke="${P.outline}" stroke-width="0.3"/>`;
    if (lay.periscope) {
        s += `<line x1="${f(mx)}" y1="${f(cy - 0.6)}" x2="${f(mx)}" y2="${f(cy - 3.9)}" stroke="${P.outline}" stroke-width="1.1"/>`;
        s += `<line x1="${f(mx)}" y1="${f(cy - 0.6)}" x2="${f(mx)}" y2="${f(cy - 3.9)}" stroke="#7f8c95" stroke-width="0.5"/>`;
        s += `<circle cx="${f(mx)}" cy="${f(cy - 4.05)}" r="0.5" fill="#aab6bf" stroke="${P.outline}" stroke-width="0.24"/>`;
    }
    if (lay.snorkel) {
        const nx = mx - 1.9;
        s += `<line x1="${f(nx)}" y1="${f(cy - 0.5)}" x2="${f(nx)}" y2="${f(cy - 3.3)}" stroke="${P.outline}" stroke-width="1.7"/>`;
        s += `<line x1="${f(nx)}" y1="${f(cy - 0.5)}" x2="${f(nx)}" y2="${f(cy - 3.3)}" stroke="#7f8c95" stroke-width="0.8"/>`;
        s += `<path d="M ${f(nx)} ${f(cy - 3.3)} L ${f(nx - 1.1)} ${f(cy - 3.75)}" stroke="${P.outline}" stroke-width="0.65" stroke-linecap="round"/>`;
    }

    // 艏部弹射器（伊四百）：压缩空气滑轨 + 晴岚水侦
    if (lay.catapultFwd) {
        const cx = 4.4, ry = Y(-1.2);
        s += `<rect x="${f(cx + 0.6)}" y="${f(ry - 0.4)}" width="9.6" height="2.2" rx="1.1" fill="${P.outline}" opacity="0.4"/>`;
        s += `<rect x="${f(cx)}" y="${f(ry - 1.1)}" width="9.6" height="2.2" rx="1.1" fill="${mixHex(P.supLo, P.outline, 0.25)}" stroke="${P.outline}" stroke-width="0.38"/>`;
        s += `<line x1="${f(cx + 1.3)}" y1="${f(ry - 0.45)}" x2="${f(cx + 8.3)}" y2="${f(ry - 0.45)}" stroke="${P.sup}" stroke-width="0.4" opacity="0.7"/>`;
        s += `<rect x="${f(cx + 3.3)}" y="${f(ry - 0.2)}" width="2.2" height="${f(2.6 * k)}" rx="0.5" fill="${P.sup}" stroke="${P.outline}" stroke-width="0.28"/>`;
        s += `<circle cx="${f(cx + 1.4)}" cy="${f(ry - 0.45)}" r="0.4" fill="${P.outline}"/>`;
        if (lay.seaplane) {
            s += `<g transform="translate(${f(cx + 4.8)},${f(ry - 0.6)}) rotate(180) scale(0.4)">${deckPlane(0, 0, 0, P)}</g>`;
        }
    }
    return s;
}

// ---------- 主入口 ----------

// 渐变/滤镜的 id 必须逐实例唯一：同款舰船会在船坞、帮助弹窗、棋盘上同时存在，
// 重复 id 会让浏览器解析到先出现的（可能处于 display:none 的）defs，填充直接失效
let artSeq = 0;

// 潜艇专用涂装：深灰近黑、低反差；日系保留暗木色甲板
const SUB_TONES = {
    us:  { hullLo: '#3a4850', hullHi: '#7d909b', deckLo: '#2f3a40', deckHi: '#4d5c66', sup: '#5d6b74', supLo: '#414e56' },
    ijn: { hullLo: '#3f4034', hullHi: '#807d66', deckLo: '#4a4030', deckHi: '#6a5c45', sup: '#5c5a4a', supLo: '#41402f' },
    rn:  { hullLo: '#39444b', hullHi: '#78888f', deckLo: '#2f393f', deckHi: '#4b5860', sup: '#596970', supLo: '#3f4c53' },
    km:  { hullLo: '#353f46', hullHi: '#73838d', deckLo: '#2b343a', deckHi: '#46535c', sup: '#56646d', supLo: '#3d4951' },
    fn:  { hullLo: '#3a464e', hullHi: '#7b8c97', deckLo: '#303a41', deckHi: '#4c5862', sup: '#5a6873', supLo: '#404d56' },
    rm:  { hullLo: '#3f443c', hullHi: '#818874', deckLo: '#33372e', deckHi: '#4d5344', sup: '#5e6353', supLo: '#43483b' },
    sn:  { hullLo: '#37463e', hullHi: '#788d7f', deckLo: '#2d3832', deckHi: '#48564d', sup: '#586b60', supLo: '#3e4c44' }
};

function subPalette(P, factionId) {
    return { ...P, ...(SUB_TONES[factionId] || SUB_TONES.us) };
}

export function getShipSvg(code, factionId = 'us') {
    let P = PALETTES[factionId] || PALETTES.us;
    if (code === 'SS') P = subPalette(P, factionId);
    const lay = (LAYOUTS[code] || {})[factionId] || (LAYOUTS[code] || {}).us;
    if (!lay) return '';
    const L = HULL_LEN[code];
    const B = beamFor(code, factionId, lay);
    const id = `${code.toLowerCase()}-${factionId}-${++artSeq}`;

    let body = '';
    if (code === 'CV') body = drawCV(lay, P, id, factionId);
    else if (code === 'SS') body = drawSS(lay, P, id, factionId);
    else body = drawWarship(code, lay, P, id, factionId);

    return `<svg class="ship-svg" viewBox="0 0 ${L} ${B}" width="${L}" height="${B}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${svgDefs(id, P)}${body}</svg>`;
}

// 空袭掠海特效用的舰载机俯视图（与航母甲板上的机型同源）
export function getPlaneSvg(factionId = 'us') {
    const P = PALETTES[factionId] || PALETTES.us;
    return `<svg class="plane-svg" viewBox="-6.4 -6.2 14 13.6" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${deckPlane(0, 0, 0, P)}</svg>`;
}

// 三机楔形编队：机模只画一遍，用 <use> 复用，缩小并排成小编队
export function getPlaneSquadronSvg(factionId = 'us') {
    const P = PALETTES[factionId] || PALETTES.us;
    const id = `sqd-${factionId}-${++artSeq}`;
    return `<svg class="plane-squadron-svg" viewBox="0 0 34 26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
        + `<defs><g id="${id}">${deckPlane(0, 0, 0, P)}</g></defs>`
        + `<use href="#${id}" transform="translate(10 7) scale(0.9)"/>`
        + `<use href="#${id}" transform="translate(10 19) scale(0.9)"/>`
        + `<use href="#${id}" transform="translate(25 13)"/>`
        + '</svg>';
}

// 编队图片按位图使用：同一阵营复用同一 data URL，浏览器只需解码/栅格化一次
const squadronUrlCache = new Map();
export function getPlaneSquadronDataUrl(factionId = 'us') {
    const key = PALETTES[factionId] ? factionId : 'us';
    if (!squadronUrlCache.has(key)) {
        squadronUrlCache.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(getPlaneSquadronSvg(key)));
    }
    return squadronUrlCache.get(key);
}

export const SHIP_ART_BEAM = HULL_BEAM;
export const SHIP_ART_LAYOUTS = LAYOUTS;
