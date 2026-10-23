/**
 * 玩家历史学习 - 跨对局习惯画像
 *
 * 只在对局结束时写入：按舰长统计玩家的布阵格子频率，并统计玩家的射击格子频率。
 * 读取端只拿到聚合先验，不包含任何当前对局的隐藏信息。
 *
 * - 指数衰减：每完成一局，旧计数乘以 DECAY（半衰期约 11 局）
 * - 冷启动：数据不足时先验接近均匀，强度随样本数增长
 * - 布阵先验：BeliefState 的放置权重与首回合概率图
 * - 射击热图：AI 布阵时轻度避开玩家常搜的格子
 */

import { BOARD_SIZE } from '../config/constants.js';

const STORAGE_KEY = 'hzq_player_model_v1';
const PROFILE_VERSION = 1;
const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;
const DECAY = 0.94;
const SMOOTH_SAMPLES = 4;
const PRIOR_STRENGTH_SAMPLES = 10;
const PRIOR_MIN = 0.25;
const PRIOR_MAX = 4;

let cachedModel = null;

function createEmptyProfile() {
    return {
        version: PROFILE_VERSION,
        matches: 0,
        placement: {},
        placementSamples: {},
        shots: new Array(TOTAL_CELLS).fill(0),
        shotSamples: 0
    };
}

function getStorage() {
    try {
        return globalThis.localStorage || null;
    } catch (e) {
        return null;
    }
}

function isCellIndex(v) {
    return Number.isInteger(v) && v >= 0 && v < TOTAL_CELLS;
}

function normalizeProfile(data) {
    if (!data || data.version !== PROFILE_VERSION || typeof data !== 'object') {
        return createEmptyProfile();
    }
    const profile = createEmptyProfile();
    profile.matches = Number.isFinite(data.matches) ? Math.max(0, data.matches) : 0;
    profile.shotSamples = Number.isFinite(data.shotSamples) ? Math.max(0, data.shotSamples) : 0;
    if (Array.isArray(data.shots) && data.shots.length === TOTAL_CELLS) {
        for (let i = 0; i < TOTAL_CELLS; i++) {
            profile.shots[i] = Number.isFinite(data.shots[i]) ? Math.max(0, data.shots[i]) : 0;
        }
    }
    for (const [lenKey, counts] of Object.entries(data.placement || {})) {
        const len = Number(lenKey);
        if (!Number.isInteger(len) || len < 1 || len > BOARD_SIZE) continue;
        const samples = Number(data.placementSamples?.[lenKey]);
        if (!Number.isFinite(samples) || samples <= 0) continue;
        if (!Array.isArray(counts) || counts.length !== TOTAL_CELLS) continue;
        profile.placement[len] = counts.map(v => (Number.isFinite(v) ? Math.max(0, v) : 0));
        profile.placementSamples[len] = samples;
    }
    return profile;
}

export function loadProfile() {
    const storage = getStorage();
    if (!storage) return createEmptyProfile();
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return createEmptyProfile();
        return normalizeProfile(JSON.parse(raw));
    } catch (e) {
        return createEmptyProfile();
    }
}

function saveProfile(profile) {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
        // 隐私模式或配额不足时静默放弃，不影响对局
    }
}

function hullCellIndexes(ship) {
    const cells = [];
    const len = Math.max(1, Math.min(BOARD_SIZE, Number(ship.len) || 1));
    const r = Number(ship.r);
    const c = Number(ship.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return cells;
    const vertical = !!(ship.v ?? ship.vertical);
    for (let i = 0; i < len; i++) {
        const nr = vertical ? r + i : r;
        const nc = vertical ? c : c + i;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
        cells.push(nr * BOARD_SIZE + nc);
    }
    return cells;
}

function decayProfile(profile) {
    if (profile.matches <= 0) return;
    for (const counts of Object.values(profile.placement)) {
        for (let i = 0; i < TOTAL_CELLS; i++) counts[i] *= DECAY;
    }
    for (const len of Object.keys(profile.placementSamples)) {
        profile.placementSamples[len] *= DECAY;
    }
    for (let i = 0; i < TOTAL_CELLS; i++) profile.shots[i] *= DECAY;
    profile.shotSamples *= DECAY;
}

/**
 * 记录一局已完成的战斗（玩家视角）
 * @param {{ ships: Array<{len:number,r:number,c:number,v?:boolean,vertical?:boolean}>, shotCells: number[] }} match
 */
export function recordCompletedMatch({ ships, shotCells } = {}) {
    if (!Array.isArray(ships) || ships.length === 0) return null;
    const profile = loadProfile();
    decayProfile(profile);

    for (const ship of ships) {
        const cells = hullCellIndexes(ship);
        if (cells.length === 0) continue;
        const len = cells.length;
        if (!profile.placement[len]) {
            profile.placement[len] = new Array(TOTAL_CELLS).fill(0);
            profile.placementSamples[len] = 0;
        }
        profile.placementSamples[len] += 1;
        for (const idx of cells) profile.placement[len][idx] += 1;
    }

    const uniqueShots = new Set();
    for (const idx of shotCells || []) {
        if (isCellIndex(idx)) uniqueShots.add(idx);
    }
    for (const idx of uniqueShots) profile.shots[idx] += 1;
    profile.shotSamples += uniqueShots.size;
    profile.matches += 1;

    saveProfile(profile);
    cachedModel = null;
    return profile;
}

function buildPlacementPrior(profile) {
    const byLen = {};
    let confidence = 0;
    for (const [lenKey, counts] of Object.entries(profile.placement)) {
        const len = Number(lenKey);
        const samples = profile.placementSamples[len] || 0;
        if (samples <= 0) continue;
        const uniformPerCell = len / TOTAL_CELLS;
        const strength = samples / (samples + PRIOR_STRENGTH_SAMPLES);
        const cells = new Array(TOTAL_CELLS);
        for (let i = 0; i < TOTAL_CELLS; i++) {
            const frequency = (counts[i] + SMOOTH_SAMPLES * uniformPerCell)
                / (samples + SMOOTH_SAMPLES);
            const ratio = Math.min(PRIOR_MAX, Math.max(PRIOR_MIN, frequency / uniformPerCell));
            cells[i] = Math.pow(ratio, strength);
        }
        byLen[len] = { cells, strength };
        confidence = Math.max(confidence, strength);
    }
    if (Object.keys(byLen).length === 0) return null;
    return { byLen, confidence };
}

function buildShotAttention(profile) {
    if (profile.shotSamples < TOTAL_CELLS * 0.5) return null;
    const mean = profile.shotSamples / TOTAL_CELLS;
    if (mean <= 0) return null;
    const attention = new Array(TOTAL_CELLS);
    for (let i = 0; i < TOTAL_CELLS; i++) {
        attention[i] = Math.min(3, Math.max(0, profile.shots[i] / mean - 1));
    }
    return attention;
}

function buildModel(profile) {
    return {
        matches: profile.matches,
        placementPrior: buildPlacementPrior(profile),
        shotAttention: buildShotAttention(profile)
    };
}

/**
 * AI 使用的玩家画像（进程内缓存，记录新对局后自动失效）
 */
export function getPlayerModel() {
    if (!cachedModel) {
        cachedModel = buildModel(loadProfile());
    }
    return cachedModel;
}

export function resetPlayerModelCache() {
    cachedModel = null;
}
