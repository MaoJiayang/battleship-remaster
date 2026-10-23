// 阵营循环赛的共享常量与确定性随机数
export const FACTIONS = ['us', 'ijn', 'rn', 'km', 'fn', 'rm', 'sn'];

export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 字符串 → 32 位种子 */
export function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function boundedMeanInterval(values, risk = 0.05) {
    if (!values.length) return [0, 1];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const threshold = Math.log(2 / risk) / values.length;
    const divergence = probability => (mean ? mean * Math.log(mean / probability) : 0)
        + (mean < 1 ? (1 - mean) * Math.log((1 - mean) / (1 - probability)) : 0);
    let lower = 0;
    let upper = mean;
    for (let step = 0; step < 60; step++) {
        const middle = (lower + upper) / 2;
        if (divergence(middle) > threshold) lower = middle;
        else upper = middle;
    }
    const minimum = upper;
    lower = mean;
    upper = 1;
    for (let step = 0; step < 60; step++) {
        const middle = (lower + upper) / 2;
        if (divergence(middle) > threshold) upper = middle;
        else lower = middle;
    }
    return [minimum, lower];
}
