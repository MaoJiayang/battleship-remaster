// 对局数据采集：本地结构化记录，供赛后分析使用
// 只记录公开结算结果与逐手动作，不记录任何隐藏布阵（敌方布阵仅在对局结束后写入）

import { VIEW_STATE } from './battle/ViewState.js';
import { getHEOffsets } from '../data/doctrines.js';

const STORAGE_KEY = 'hzq_match_log_v1';
const STORE_VERSION = 1;
const SCHEMA = 'hzq-match-log';
const MAX_MATCHES = 200;

const DISK_FLAG_KEY = 'hzq_matchlog_disk_v1';
const DISK_ENDPOINT = '/__matchlog';
const FS_DB_NAME = 'hzq-matchlog';
const FS_STORE = 'handles';
const FS_HANDLE_KEY = 'dir';

let active = null;

let diskEnabled = readDiskFlag();
let diskAvailable = null;
let diskTransport = 'none'; // 'http'（开发服务器）| 'fs'（目录句柄）| 'none'
let dirHandle = null;
let permissionNeeded = false;
let diskFile = 'match-logs';
let diskWritten = 0;
let diskFailed = 0;
let diskError = null;
let diskQueue = Promise.resolve();
const diskListeners = new Set();

function nowIso() {
    return new Date().toISOString();
}

function todayFileName() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `hzq-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.jsonl`;
}

function fsSupported() {
    return typeof globalThis.showDirectoryPicker === 'function';
}

function readDiskFlag() {
    try {
        return globalThis.localStorage?.getItem(DISK_FLAG_KEY) === 'on';
    } catch {
        return false;
    }
}

function writeDiskFlag() {
    try {
        globalThis.localStorage?.setItem(DISK_FLAG_KEY, diskEnabled ? 'on' : 'off');
    } catch {
        // 存储不可用时只影响记忆开关状态，不影响本局记录
    }
}

function diskSnapshot() {
    const needsPermission = diskEnabled
        && diskTransport !== 'http'
        && (permissionNeeded || !dirHandle);
    return {
        enabled: diskEnabled,
        available: diskAvailable,
        transport: diskTransport,
        needsPermission,
        file: diskTransport === 'fs' && dirHandle
            ? `${dirHandle.name}/match-logs/${todayFileName()}`
            : diskFile,
        written: diskWritten,
        failed: diskFailed,
        error: diskError
    };
}

function emitDiskState() {
    const snapshot = diskSnapshot();
    for (const fn of diskListeners) {
        try {
            fn(snapshot);
        } catch {
            // 监听器异常不影响写盘队列
        }
    }
}

function openFsDb() {
    return new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open(FS_DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(FS_STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function idbGet(key) {
    const db = await openFsDb();
    return new Promise((resolve, reject) => {
        const request = db.transaction(FS_STORE, 'readonly').objectStore(FS_STORE).get(key);
        request.onsuccess = () => {
            db.close();
            resolve(request.result);
        };
        request.onerror = () => {
            db.close();
            reject(request.error);
        };
    });
}

async function idbSet(key, value) {
    const db = await openFsDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FS_STORE, 'readwrite');
        tx.objectStore(FS_STORE).put(value, key);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

async function loadDirHandle() {
    if (!globalThis.indexedDB) return;
    try {
        const stored = await idbGet(FS_HANDLE_KEY);
        if (!stored || typeof stored.queryPermission !== 'function') return;
        dirHandle = stored;
        const permission = await stored.queryPermission({ mode: 'readwrite' });
        permissionNeeded = permission !== 'granted';
    } catch {
        dirHandle = null;
        permissionNeeded = false;
    }
}

async function ensureFsAccess() {
    if (dirHandle) {
        try {
            let permission = await dirHandle.queryPermission({ mode: 'readwrite' });
            if (permission !== 'granted') {
                permission = await dirHandle.requestPermission({ mode: 'readwrite' });
            }
            if (permission === 'granted') {
                permissionNeeded = false;
                return true;
            }
        } catch {
            // 句柄失效时重新选择目录
        }
    }
    try {
        const handle = await globalThis.showDirectoryPicker({ id: 'hzq-matchlog', mode: 'readwrite' });
        dirHandle = handle;
        permissionNeeded = false;
        try {
            await idbSet(FS_HANDLE_KEY, handle);
        } catch {
            // 句柄存不进 IndexedDB 时，本次会话仍可继续写入
        }
        return true;
    } catch (err) {
        if (err?.name !== 'AbortError') console.warn('[matchlog] 目录授权失败', err);
        if (dirHandle) permissionNeeded = true;
        return false;
    }
}

async function appendFsLine(text) {
    if (!dirHandle) throw new Error('未选择文件夹');
    const dir = await dirHandle.getDirectoryHandle('match-logs', { create: true });
    const file = await dir.getFileHandle(todayFileName(), { create: true });
    const existing = await file.getFile();
    const writable = await file.createWritable({ keepExistingData: true });
    try {
        await writable.seek(existing.size);
        await writable.write(text);
    } finally {
        await writable.close();
    }
}

function postLine(payload) {
    if (!diskEnabled) return;
    if (diskTransport === 'none') return;
    if (diskTransport === 'fs' && permissionNeeded) return;
    const transport = diskTransport;
    let line;
    try {
        line = JSON.stringify({ ...payload, loggedAt: nowIso() });
    } catch {
        return;
    }
    diskQueue = diskQueue.then(async () => {
        if (transport === 'http') {
            const response = await fetch(DISK_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: line,
                keepalive: payload.type === 'match_end' || payload.type === 'match_abort'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
        } else {
            await appendFsLine(`${line}\n`);
        }
        diskWritten++;
        diskError = null;
    }).catch(err => {
        diskFailed++;
        diskError = err?.message || String(err);
        if (diskFailed === 1) console.warn('[matchlog] 落盘失败', err);
    });
    diskQueue.then(emitDiskState);
}

export function getDiskLogState() {
    return diskSnapshot();
}

export function onDiskLogStateChange(fn) {
    diskListeners.add(fn);
    return () => diskListeners.delete(fn);
}

export function isDiskLoggingEnabled() {
    return diskEnabled;
}

export async function probeDiskLog() {
    let httpFile = null;
    let httpOk = false;
    const protocol = globalThis.location?.protocol;
    if (protocol !== 'file:') {
        try {
            const response = await fetch(`${DISK_ENDPOINT}/status`, { cache: 'no-store' });
            const data = await response.json().catch(() => null);
            httpOk = Boolean(response.ok && data?.ok);
            if (httpOk && typeof data.file === 'string') httpFile = data.file;
        } catch {
            httpOk = false;
        }
    }

    diskAvailable = httpOk || fsSupported();
    if (httpOk) {
        if (!diskEnabled || diskTransport !== 'fs' || !dirHandle || permissionNeeded) {
            diskTransport = 'http';
        }
        if (httpFile) diskFile = httpFile;
    } else if (diskTransport === 'http') {
        diskTransport = fsSupported() && dirHandle && !permissionNeeded ? 'fs' : 'none';
    } else if (diskTransport === 'none' && fsSupported() && dirHandle && !permissionNeeded) {
        diskTransport = 'fs';
    }
    emitDiskState();
    return diskAvailable;
}

export async function setDiskLoggingEnabled(enabled) {
    if (!enabled) {
        diskEnabled = false;
        writeDiskFlag();
        emitDiskState();
        return false;
    }

    if (diskEnabled && !permissionNeeded && diskTransport !== 'none') {
        emitDiskState();
        return true;
    }

    const protocol = globalThis.location?.protocol;
    if (diskTransport === 'http' || (diskTransport === 'none' && (protocol === 'http:' || protocol === 'https:'))) {
        // 开关关闭期间开发服务器可能已退出，重新确认后再决定走哪条通道
        await probeDiskLog();
    }

    if (diskTransport === 'http' && diskAvailable === true) {
        // 开发服务器通道已就绪，无需授权
    } else if (fsSupported()) {
        if (!await ensureFsAccess()) {
            diskEnabled = false;
            writeDiskFlag();
            emitDiskState();
            return false;
        }
        diskTransport = 'fs';
        diskAvailable = true;
    } else if (diskAvailable !== true) {
        diskEnabled = false;
        writeDiskFlag();
        emitDiskState();
        return false;
    }

    diskEnabled = true;
    writeDiskFlag();
    const current = getActiveMatch();
    if (current) {
        // 中途开启：补一份此前的手数快照，避免这段动作只留在浏览器里
        postLine({
            type: 'match_resume',
            at: nowIso(),
            matchId: current.id,
            priorPlies: current.actions.length,
            priorActions: current.actions
        });
    } else {
        postLine({ type: 'session', at: nowIso(), event: 'logging_on' });
    }
    emitDiskState();
    return diskEnabled;
}

// 启动时恢复上次选择的文件夹；权限未授予时保持开关，等用户点击后再请求
loadDirHandle().then(() => {
    if (!dirHandle) return;
    if (fsSupported()) {
        diskAvailable = true;
        if (diskTransport !== 'http') diskTransport = 'fs';
    }
    emitDiskState();
});

function makeId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeShips(ships, withHp = false) {
    return (ships || []).map(ship => {
        const cell = {
            code: ship.code,
            len: ship.len,
            r: ship.r,
            c: ship.c,
            vertical: Boolean(ship.v ?? ship.vertical),
            sunk: Boolean(ship.sunk)
        };
        if (withHp) cell.hp = Array.isArray(ship.hp) ? ship.hp.map(v => Math.max(0, v)) : [];
        return cell;
    });
}

function emptyStore() {
    return { version: STORE_VERSION, matches: [] };
}

function loadStore() {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) return emptyStore();
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.matches)) return emptyStore();
        return parsed;
    } catch (err) {
        console.warn('[matchlog] 读取失败，使用空记录', err);
        return emptyStore();
    }
}

function saveStore(store) {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(store));
        return true;
    } catch (err) {
        console.warn('[matchlog] 写入失败（可能是存储已满）', err);
        return false;
    }
}

function offsetsFor(weapon, shape, radius) {
    if (weapon === 'HE') return getHEOffsets(shape || 'x');
    if (weapon === 'SONAR') {
        const r = Math.max(1, radius || 1);
        const cells = [];
        for (let dr = -r; dr <= r; dr++) {
            for (let dc = -r; dc <= r; dc++) cells.push([dr, dc]);
        }
        return cells;
    }
    return [[0, 0]];
}

function summarizeFootprint(view, r, c, offsets) {
    const counts = { cells: 0, unknown: 0, miss: 0, hit: 0, destroyed: 0, suspect: 0, sunk: 0, outside: 0 };
    if (!Array.isArray(view)) return counts;
    for (const [dr, dc] of offsets) {
        const nr = r + dr;
        const nc = c + dc;
        const row = view[nr];
        if (!Array.isArray(row) || row[nc] === undefined) {
            counts.outside++;
            continue;
        }
        counts.cells++;
        const state = row[nc];
        if (state === VIEW_STATE.UNKNOWN) counts.unknown++;
        else if (state === VIEW_STATE.MISS) counts.miss++;
        else if (state === VIEW_STATE.HIT) counts.hit++;
        else if (state === VIEW_STATE.DESTROYED) counts.destroyed++;
        else if (state === VIEW_STATE.SUSPECT) counts.suspect++;
        else if (state === VIEW_STATE.SUNK) counts.sunk++;
    }
    return counts;
}

export function beginMatch({ playerFaction, enemyFaction, level, firstTurn, playerShips, playerHE, aiHE, aiPolicy }) {
    active = {
        id: makeId(),
        schemaVersion: STORE_VERSION,
        startedAt: nowIso(),
        endedAt: null,
        durationMs: null,
        playerFaction,
        enemyFaction,
        level,
        ...(aiPolicy ? { aiPolicy: { ...aiPolicy } } : {}),
        firstTurn,
        playerShips: normalizeShips(playerShips),
        playerHE: playerHE ? { shape: playerHE.shape, centerDamage: playerHE.centerDamage, outerDamage: playerHE.outerDamage } : null,
        aiHE: aiHE ? { shape: aiHE.shape, centerDamage: aiHE.centerDamage, outerDamage: aiHE.outerDamage } : null,
        plies: 0,
        result: null,
        actions: [],
        stats: null,
        playerShipsFinal: null,
        enemyShipsFinal: null
    };
    postLine({
        type: 'match_start',
        at: active.startedAt,
        matchId: active.id,
        schemaVersion: STORE_VERSION,
        playerFaction: active.playerFaction,
        enemyFaction: active.enemyFaction,
        level: active.level,
        ...(active.aiPolicy ? { aiPolicy: active.aiPolicy } : {}),
        firstTurn: active.firstTurn,
        playerShips: active.playerShips,
        playerHE: active.playerHE,
        aiHE: active.aiHE
    });
    return active;
}

export function abandonMatch() {
    if (active) {
        postLine({
            type: 'match_abort',
            at: nowIso(),
            matchId: active.id,
            plies: active.actions.length
        });
    }
    active = null;
}

export function damageFromEvents(events) {
    let damage = 0;
    for (const ev of events || []) {
        if (ev.type === 'EFFECT' && ev.payload?.kind === 'DAMAGE') damage += ev.payload.amount || 0;
    }
    return damage;
}

export function sunkCodesFromIds(ids, ships) {
    const found = [];
    for (const id of ids || []) {
        const ship = (ships || []).find(s => s.id === id);
        if (ship) found.push(ship.code);
    }
    return found;
}

/**
 * 记录一手已成功结算的动作（无效点击不要调用）
 * @param {Object} action
 * @param {'player'|'ai'} action.seat
 * @param {'AP'|'HE'|'SONAR'} action.weapon
 * @param {number} action.r
 * @param {number} action.c
 * @param {number[][]} [action.view] 出手前该座位对目标海域的视野
 * @param {number} [action.damage]
 * @param {string[]} [action.sunk]
 * @param {string} [action.shape] 空袭形状（当前状态，可能因 CV 沉没降级）
 * @param {number} [action.radius] 水听半径
 */
export function recordAction({ seat, weapon, r, c, view, damage = 0, sunk = [], shape = 'x', radius = 1 }) {
    if (!active) return null;
    const footprint = summarizeFootprint(view, r, c, offsetsFor(weapon, shape, radius));
    const targetState = Array.isArray(view?.[r]) ? (view[r][c] ?? null) : null;
    const entry = {
        ply: active.actions.length + 1,
        seat,
        weapon,
        r,
        c,
        targetState,
        footprint,
        damage: Math.max(0, damage),
        sunk
    };
    active.actions.push(entry);
    postLine({ type: 'action', at: nowIso(), matchId: active.id, ...entry });
    return entry;
}

export function finishMatch({ result, stats, playerShips, enemyShips }) {
    if (!active) return null;
    active.endedAt = nowIso();
    active.durationMs = Date.now() - Date.parse(active.startedAt);
    active.result = result;
    active.stats = stats ? JSON.parse(JSON.stringify(stats)) : null;
    active.plies = active.actions.length;
    active.playerShipsFinal = normalizeShips(playerShips, true);
    active.enemyShipsFinal = normalizeShips(enemyShips, true);

    const record = active;
    postLine({
        type: 'match_end',
        at: record.endedAt,
        matchId: record.id,
        result: record.result,
        plies: record.plies,
        durationMs: record.durationMs,
        stats: record.stats,
        playerShipsFinal: record.playerShipsFinal,
        enemyShipsFinal: record.enemyShipsFinal
    });
    active = null;

    const store = loadStore();
    store.matches.push(record);
    if (store.matches.length > MAX_MATCHES) {
        store.matches.splice(0, store.matches.length - MAX_MATCHES);
    }
    if (!saveStore(store)) {
        // 存储写满时至少保留本次对局的返回值，不静默丢弃
        return record;
    }
    return record;
}

export function getActiveMatch() {
    return active;
}

export function getMatches() {
    return loadStore().matches;
}

export function getMatchCount() {
    return loadStore().matches.length;
}

export function getFactionSummary() {
    const summary = {};
    for (const match of loadStore().matches) {
        const key = match.playerFaction || 'unknown';
        summary[key] ??= { matches: 0, wins: 0, losses: 0 };
        summary[key].matches++;
        if (match.result === 'win') summary[key].wins++;
        else if (match.result === 'loss') summary[key].losses++;
    }
    return summary;
}

export function buildExportPayload() {
    const store = loadStore();
    return {
        schema: SCHEMA,
        schemaVersion: STORE_VERSION,
        exportedAt: nowIso(),
        matchCount: store.matches.length,
        matches: store.matches
    };
}

export function exportMatchesToFile() {
    const payload = buildExportPayload();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const filename = `hzq-matches-${stamp}.json`;
    if (typeof document === 'undefined') return { payload, filename };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { payload, filename };
}

export function clearMatches() {
    saveStore(emptyStore());
}
