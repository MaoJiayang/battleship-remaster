#!/usr/bin/env node
/**
 * Agent Arena — 让外部 agent 在文字棋盘上对战项目里的真实 AI
 *
 * 设计约束：
 * - 只读项目源码，不修改线上游戏；敌方决策由真实 AIDecisionEngine 做出
 * - 规则走 SimulationEngine（与线上 HitResolver / SonarResolver 同源）
 * - 对外只展示人类玩家能看到的信息：自己的舰队、敌方公开存活状态、视野棋盘
 * - 对局状态快照落盘，进程重启后从快照继续，不重放、不消耗额外随机数
 * - 不加入任何“追击加成 / 收尾加成”，AI 行为完全来自置信度与期望伤害
 *
 * 会话文件默认位于系统临时目录（可用 HZQ_ARENA_DIR 覆盖），含敌方隐藏布阵，
 * 只应通过 status / log 读取公开信息。
 *
 * 库 API：createSession / loadSession / statusText / move / logText / resignSession
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { deployShips } from '../../src/ai/aiDeployment.js';
import { SHIP_TYPES } from '../../src/data/ships.js';
import { BOARD_SIZE } from '../../src/config/constants.js';
import { VIEW_STATE } from '../../src/game/battle/ViewState.js';
import {
    getAPDamage,
    getAPMaxDamage,
    getAPMaxPenetrations,
    getHEProfile,
    getSonarProfile,
    getDoctrine
} from '../../src/data/doctrines.js';

const OTHER = { A: 'B', B: 'A' };
const CODE_CHAR = { CV: 'C', BB: 'B', CL: 'L', SS: 'S', DD: 'D' };
const WEAPON_NAME = { AP: '主炮', HE: '空袭', SONAR: '水听' };
const VIEW_CHAR = ['.', 'o', 'x', '#', '?', 'S'];
const DEFAULT_SESSION_DIR = process.env.HZQ_ARENA_DIR
    || path.join(os.tmpdir(), 'hzq-agent-arena');

export class ArenaError extends Error {}

// ---------------------------------------------------------------------------
// 随机数
// ---------------------------------------------------------------------------

function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeFleets(seed) {
    const old = Math.random;
    Math.random = mulberry32(seed >>> 0);
    try {
        return { A: deployShips(SHIP_TYPES), B: deployShips(SHIP_TYPES) };
    } finally {
        Math.random = old;
    }
}

/** AI 随机数只由“种子 + 已发生行动数”决定，便于复现单步结果 */
function seedFor(session) {
    const n = session.log.length;
    Math.random = mulberry32((session.seed ^ Math.imul(n + 1, 0x9E3779B1)) >>> 0);
}

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

function serializeSide(side) {
    return {
        config: side.config,
        faction: side.faction,
        ships: side.ships,
        grid: side.grid,
        view: side.view,
        engine: {
            damageDealtGrid: side.engine.damageDealtGrid,
            actionHistory: side.engine.actionHistory || [],
            sonarHistory: [...side.engine.sonarHistory]
        },
        hunt: side.hunt,
        oneLeftPly: side.oneLeftPly,
        stats: side.stats
    };
}

export function serializeEngine(engine) {
    return {
        configA: engine.configA,
        configB: engine.configB,
        maxPlies: engine.maxPlies,
        firstSeat: engine.firstSeat,
        enablePursuit: engine.enablePursuit,
        plies: engine.plies,
        winner: engine.winner,
        currentSeat: engine.currentSeat,
        finished: engine.finished,
        tail: engine.tail,
        sides: {
            A: serializeSide(engine.sides.A),
            B: serializeSide(engine.sides.B)
        }
    };
}

export function reviveEngine(saved) {
    const engine = new SimulationEngine(
        saved.configA,
        saved.configB,
        {
            firstSeat: saved.firstSeat,
            fleetA: saved.sides.A.ships,
            fleetB: saved.sides.B.ships,
            maxPlies: saved.maxPlies,
            enablePursuit: saved.enablePursuit
        }
    );
    const AIEngine = engine.sides.A.engine.constructor;
    const reviveSide = savedSide => {
        const ai = new AIEngine();
        ai.damageDealtGrid = savedSide.engine.damageDealtGrid;
        ai.actionHistory = savedSide.engine.actionHistory || [];
        ai.sonarHistory = new Set(savedSide.engine.sonarHistory);
        return { ...savedSide, engine: ai };
    };
    engine.sides = {
        A: reviveSide(saved.sides.A),
        B: reviveSide(saved.sides.B)
    };
    engine.plies = saved.plies;
    engine.winner = saved.winner;
    engine.currentSeat = saved.currentSeat;
    engine.finished = saved.finished;
    engine.tail = saved.tail;
    return engine;
}

// ---------------------------------------------------------------------------
// 会话存储
// ---------------------------------------------------------------------------

function sessionsDir() {
    return path.join(DEFAULT_SESSION_DIR, 'sessions');
}

export function getSessionDir() {
    return sessionsDir();
}

function sessionPath(id) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new ArenaError('对局 id 只能包含字母、数字、_ 和 -');
    return path.join(sessionsDir(), `${id}.json`);
}

function ensureDir() {
    fs.mkdirSync(sessionsDir(), { recursive: true });
}

function saveSession(session) {
    ensureDir();
    session.updatedAt = new Date().toISOString();
    fs.writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2));
}

function rawLoad(id) {
    const file = sessionPath(id);
    if (!fs.existsSync(file)) throw new ArenaError(`对局 ${id} 不存在`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadSession(id) {
    const session = rawLoad(id);
    return {
        session,
        engine: reviveEngine(session.engine),
        contacts: new Set(session.contacts || [])
    };
}

export function listSessions() {
    ensureDir();
    return fs.readdirSync(sessionsDir())
        .filter(file => file.endsWith('.json'))
        .map(file => {
            try {
                const s = JSON.parse(fs.readFileSync(path.join(sessionsDir(), file), 'utf8'));
                return {
                    id: s.id,
                    player: s.engine.sides.A.faction,
                    enemy: s.engine.sides.B.faction,
                    level: s.level,
                    plies: s.engine.plies,
                    finished: s.engine.finished,
                    resigned: s.resigned,
                    winner: s.resigned ? 'B' : s.engine.winner,
                    updatedAt: s.updatedAt
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function deleteSession(id) {
    const file = sessionPath(id);
    if (!fs.existsSync(file)) throw new ArenaError(`对局 ${id} 不存在`);
    fs.unlinkSync(file);
}

// ---------------------------------------------------------------------------
// 行动执行
// ---------------------------------------------------------------------------

function snapshot(engine, session) {
    const p = engine.sides[session.playerSeat];
    const e = engine.sides[session.enemySeat];
    return {
        pHp: p.ships.map(s => s.hp.slice()),
        pSunk: p.ships.map(s => s.sunk),
        eHp: e.ships.map(s => s.hp.slice()),
        eSunk: e.ships.map(s => s.sunk),
        playerView: p.view.map(row => row.slice()),
        aiView: e.view.map(row => row.slice())
    };
}

function applyPlayerAction(engine, session, action) {
    if (engine.finished) return;
    if (engine.plies >= engine.maxPlies) {
        engine._finish(null);
        return;
    }
    engine.plies++;
    const seat = engine.currentSeat;
    const attacker = engine.sides[seat];
    const defender = engine.sides[OTHER[seat]];
    const abilities = engine._abilities(attacker, defender);
    engine._executeAction(attacker, defender, action, abilities);

    if (defender.ships.every(s => s.sunk)) {
        engine._finish(seat);
        return;
    }
    if (engine.enablePursuit) engine._tickPursuit(attacker, defender);
    engine.currentSeat = OTHER[seat];
}

function advanceAI(engine, session) {
    let guard = 0;
    while (!engine.finished && engine.currentSeat === session.enemySeat) {
        if (guard++ >= 4) break;
        seedFor(session);
        const before = snapshot(engine, session);
        const chosen = engine.step();
        if (!chosen) break;
        session.log.push(makeEntry(engine, session, before, {
            seat: session.enemySeat,
            weapon: chosen.weapon,
            r: chosen.r,
            c: chosen.c
        }));
    }
}

function makeEntry(engine, session, before, action) {
    const after = snapshot(engine, session);
    const isPlayer = action.seat === session.playerSeat;
    const actor = isPlayer ? '你' : '敌方';
    const at = coord(action.r, action.c);
    const prefix = `${actor} ${WEAPON_NAME[action.weapon]} ${at} → `;
    let text;

    if (action.weapon === 'SONAR') {
        const side = engine.sides[action.seat];
        const profile = getSonarProfile(side.faction);
        const viewBefore = isPlayer ? before.playerView : before.aiView;
        const viewAfter = isPlayer ? after.playerView : after.aiView;
        const diff = sonarDiff(viewBefore, viewAfter, action.r, action.c, profile.radius);
        if (diff.signal) {
            const contactText = diff.contact
                ? `标定 ${coord(diff.contact.r, diff.contact.c)}`
                : '中心显形';
            text = isPlayer
                ? `${prefix}有信号：${contactText}，新增 ${diff.newSuspect} 格疑似`
                : `${prefix}有信号：${contactText}，你方 ${diff.newSuspect} 格被标为疑似`;
        } else {
            text = isPlayer
                ? `${prefix}无信号，${diff.newMiss} 格标记未中`
                : `${prefix}无信号，你方 ${diff.newMiss} 格被扫为未中`;
        }
        return { ply: engine.plies, isPlayer, weapon: action.weapon, r: action.r, c: action.c, text };
    }

    const defender = isPlayer ? engine.sides[session.enemySeat] : engine.sides[session.playerSeat];
    const hpBefore = isPlayer ? before.eHp : before.pHp;
    const hpAfter = isPlayer ? after.eHp : after.pHp;
    const sunkBefore = isPlayer ? before.eSunk : before.pSunk;
    const sunkAfter = isPlayer ? after.eSunk : after.pSunk;
    const diff = damagedState(hpBefore, hpAfter, defender.ships);

    if (diff.damage === 0) {
        text = prefix + '未命中';
    } else if (action.weapon === 'HE') {
        text = prefix + `命中 ${diff.cellCount} 格，${diff.damage} 伤`;
    } else {
        text = prefix + `命中 ${diff.damage} 伤`
            + (diff.cellCount > 1 ? `，波及 ${diff.cellCount - 1} 舱` : '');
    }

    const sunkNames = [];
    for (let i = 0; i < sunkBefore.length; i++) {
        if (!sunkBefore[i] && sunkAfter[i]) sunkNames.push(defender.ships[i].name);
    }
    if (sunkNames.length) {
        text += isPlayer
            ? `；击沉敌方 ${sunkNames.join('、')}`
            : `；击沉你的 ${sunkNames.join('、')}`;
    }

    return { ply: engine.plies, isPlayer, weapon: action.weapon, r: action.r, c: action.c, text };
}

function updateContacts(engine, session, action, before, contacts) {
    const p = engine.sides[session.playerSeat];
    if (action.weapon === 'SONAR') {
        const profile = getSonarProfile(p.faction);
        for (let dr = -profile.radius; dr <= profile.radius; dr++) {
            for (let dc = -profile.radius; dc <= profile.radius; dc++) {
                const r = action.r + dr;
                const c = action.c + dc;
                if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;
                if (before.playerView[r][c] !== VIEW_STATE.HIT && p.view[r][c] === VIEW_STATE.HIT) {
                    contacts.add(`${r},${c}`);
                }
            }
        }
    } else {
        const e = engine.sides[session.enemySeat];
        const diff = damagedState(before.eHp, e.ships.map(s => s.hp), e.ships);
        for (const cell of diff.cells) contacts.delete(`${cell.r},${cell.c}`);
    }
    for (const key of [...contacts]) {
        const [r, c] = key.split(',').map(Number);
        if (p.view[r][c] !== VIEW_STATE.HIT) contacts.delete(key);
    }
}

// ---------------------------------------------------------------------------
// 摘要辅助
// ---------------------------------------------------------------------------

export function coord(r, c) {
    return `${String.fromCharCode(65 + c)}${r + 1}`;
}

function segmentCells(ship) {
    const cells = [];
    for (let i = 0; i < ship.len; i++) {
        cells.push({
            r: ship.vertical ? ship.r + i : ship.r,
            c: ship.vertical ? ship.c : ship.c + i
        });
    }
    return cells;
}

function damagedState(beforeHp, afterHp, ships) {
    const cells = new Map();
    let damage = 0;
    for (let i = 0; i < beforeHp.length; i++) {
        const segs = segmentCells(ships[i]);
        for (let j = 0; j < beforeHp[i].length; j++) {
            const loss = beforeHp[i][j] - afterHp[i][j];
            if (loss > 0) {
                damage += loss;
                cells.set(`${segs[j].r},${segs[j].c}`, segs[j]);
            }
        }
    }
    return { damage, cellCount: cells.size, cells: [...cells.values()] };
}

function sonarDiff(beforeView, afterView, centerR, centerC, radius) {
    let newSuspect = 0;
    let newMiss = 0;
    let contact = null;
    let signal = false;
    for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
            const r = centerR + dr;
            const c = centerC + dc;
            if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;
            const b = beforeView[r][c];
            const a = afterView[r][c];
            if (a === b) continue;
            if (a === VIEW_STATE.SUSPECT) {
                newSuspect++;
                signal = true;
            } else if (a === VIEW_STATE.HIT) {
                signal = true;
                contact = { r, c };
            } else if (a === VIEW_STATE.MISS) {
                newMiss++;
            }
        }
    }
    return { newSuspect, newMiss, contact, signal };
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export function validateAction(engine, session, weapon, r, c) {
    if (session.resigned) return '你已经认输';
    if (engine.finished) return '对局已结束';
    if (engine.currentSeat !== session.playerSeat) return '还没轮到你';
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) {
        return '坐标超出棋盘（行/列均为 1–11）';
    }
    const attacker = engine.sides[session.playerSeat];
    const defender = engine.sides[session.enemySeat];

    if (weapon === 'AP') {
        const cell = defender.grid[r][c];
        if (cell.hit && cell.shipId === -1) return '该格已确认未中，不能再用主炮';
        if (cell.hit && cell.shipId !== -1) {
            const ship = defender.ships[cell.shipId];
            if (ship.hp[cell.segmentIndex] <= 0) return '该舱室已被摧毁，不能再用主炮';
        }
        return null;
    }
    if (weapon === 'HE') {
        const profile = getHEProfile(attacker.faction, attacker.ships);
        if (!profile.available) return '空袭不可用：航母已沉没';
        return null;
    }
    if (weapon === 'SONAR') {
        const usable = attacker.ships.some(s => (s.code === 'DD' || s.code === 'SS') && !s.sunk);
        if (!usable) return '水听不可用：DD/SS 已沉没';
        return null;
    }
    return `未知武器 ${weapon}`;
}

// ---------------------------------------------------------------------------
// 公开操作
// ---------------------------------------------------------------------------

export function createSession({
    id,
    playerFaction,
    enemyFaction,
    playerFirst = true,
    seed,
    level = 'HARD',
    maxPlies = 150
}) {
    const sid = String(id);
    sessionPath(sid);
    if (fs.existsSync(sessionPath(sid))) throw new ArenaError(`对局 ${sid} 已存在`);

    const fleets = makeFleets(seed);
    const engine = new SimulationEngine(
        { faction: playerFaction, level },
        { faction: enemyFaction, level },
        {
            firstSeat: playerFirst ? 'A' : 'B',
            fleetA: fleets.A,
            fleetB: fleets.B,
            maxPlies,
            enablePursuit: true
        }
    );

    const session = {
        id: sid,
        playerSeat: 'A',
        enemySeat: 'B',
        seed: seed >>> 0,
        level,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        resigned: false,
        contacts: [],
        log: [],
        engine: null
    };

    const contacts = new Set();
    advanceAI(engine, session);
    session.engine = serializeEngine(engine);
    session.contacts = [...contacts];
    saveSession(session);
    return { session, engine, contacts };
}

export function ensurePlayerTurn(session, engine, contacts) {
    if (!session.resigned && !engine.finished && engine.currentSeat !== session.playerSeat) {
        advanceAI(engine, session);
        session.engine = serializeEngine(engine);
        session.contacts = [...contacts];
        saveSession(session);
    }
}

export function statusText(engine, session, contacts) {
    const p = engine.sides[session.playerSeat];
    const e = engine.sides[session.enemySeat];
    const pAlive = p.ships.filter(s => !s.sunk).length;
    const eAlive = e.ships.filter(s => !s.sunk).length;
    const over = engine.finished || session.resigned;
    const lines = [];

    lines.push(over
        ? `=== 海战棋 · 对局结束 · ${engine.plies} 手 ===`
        : `=== 海战棋 · 第 ${engine.plies + 1} 手 · 你方回合 ===`);
    lines.push(`你：${p.faction.toUpperCase()} ${getDoctrine(p.faction).name}`
        + `   敌：${e.faction.toUpperCase()} ${getDoctrine(e.faction).name}`
        + `   难度：${session.level}   先手：${engine.firstSeat === session.playerSeat ? '你' : '敌方'}`);
    lines.push(`存活：你 ${pAlive}/5，敌方 ${eAlive}/5`);
    lines.push(`你的学说：${getDoctrine(p.faction).brief}`);
    lines.push(`敌方学说：${getDoctrine(e.faction).brief}`);

    if (over) {
        lines.push('');
        lines.push(`结果：${resultText(engine, session)}`);
        lines.push('');
        lines.push('== 双方统计 ==');
        lines.push(statsText(engine, session));
    }

    lines.push('');
    lines.push('== 敌方海域（你的视角）==');
    lines.push(renderEnemyView(p.view, contacts));
    lines.push('. 未知  o 未中  x 命中  * 声呐接触  # 已摧毁  ? 疑似  S 已沉没');

    lines.push('');
    lines.push('== 你的海域（敌方对你的标记）==');
    lines.push(renderOwnBoard(engine, session));
    lines.push('C/B/L/S/D 你的舰体（大写完好，小写受损）  X 已摧毁  o 敌方未中  ? 敌方声呐疑似  . 未探明');
    const intel = suspectList(engine, session);
    if (intel) lines.push(intel);

    lines.push('');
    lines.push('== 舰队 ==');
    lines.push('你：');
    lines.push(ownFleetText(engine, session));
    lines.push('敌方（公开状态）：');
    lines.push(enemyFleetText(engine, session));

    if (!over) {
        lines.push('');
        lines.push('== 本回合武器 ==');
        lines.push(weaponsText(engine, session));
        lines.push('每次行动消耗一回合。坐标用 行 列（1–11），例如第 8 行第 7 列 = G8。');
    }

    if (session.log.length) {
        lines.push('');
        lines.push('== 最近战报 ==');
        for (const entry of session.log.slice(-10)) {
            lines.push(`第 ${entry.ply} 手 ${entry.text}`);
        }
    }

    if (eAlive === 1 && !over) {
        lines.push('');
        lines.push('追击：敌方只剩 1 舰，你的视野会周期性出现 3×3 疑似区（黄色 ?）。');
    }
    if (pAlive === 1 && !over) {
        lines.push('');
        lines.push('警告：你只剩 1 舰，敌方会周期性获得你舰周围的 3×3 追击区。');
    }

    if (over) {
        lines.push('');
        lines.push('== 复盘：敌方最终布阵 ==');
        for (const ship of e.ships) {
            const hp = ship.hp.map(v => (v <= 0 ? '0' : String(v))).join('/');
            lines.push(`${ship.code} ${ship.name} ${shipCellsText(ship)}  舱HP ${hp}  [${ship.sunk ? '已沉没' : '存活'}]`);
        }
        lines.push('');
        lines.push('对局已结束。请停止行动并提交复盘报告。');
    }

    return lines.join('\n');
}

export function logText(session) {
    const lines = [
        `=== ${session.id} 战报（${session.engine.sides.A.faction.toUpperCase()} vs `
        + `${session.engine.sides.B.faction.toUpperCase()}）===`
    ];
    for (const entry of session.log) {
        lines.push(`第 ${entry.ply} 手 ${entry.text}`);
    }
    return lines.join('\n');
}

export function move(id, weapon, row, col) {
    const { session, engine, contacts } = loadSession(id);
    ensurePlayerTurn(session, engine, contacts);

    if (session.resigned) throw new ArenaError('你已经认输，不能再行动');
    if (engine.finished) throw new ArenaError('对局已结束');

    const r = Number(row) - 1;
    const c = Number(col) - 1;
    const error = validateAction(engine, session, weapon, r, c);
    if (error) throw new ArenaError(error);

    const before = snapshot(engine, session);
    const action = { weapon, r, c };
    applyPlayerAction(engine, session, action);
    session.log.push(makeEntry(engine, session, before, { seat: session.playerSeat, ...action }));
    updateContacts(engine, session, action, before, contacts);
    advanceAI(engine, session);

    session.engine = serializeEngine(engine);
    session.contacts = [...contacts];
    saveSession(session);
    return { session, engine, contacts };
}

export function resignSession(id) {
    const { session, engine, contacts } = loadSession(id);
    if (session.resigned) throw new ArenaError('已经认输过');
    if (engine.finished) throw new ArenaError('对局已结束');
    session.resigned = true;
    session.engine = serializeEngine(engine);
    session.contacts = [...contacts];
    saveSession(session);
    return { session, engine, contacts };
}

export function status(id) {
    const { session, engine, contacts } = loadSession(id);
    ensurePlayerTurn(session, engine, contacts);
    return statusText(engine, session, contacts);
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function boardHeader() {
    const letters = Array.from({ length: BOARD_SIZE }, (_, c) => String.fromCharCode(65 + c).padStart(2)).join(' ');
    const numbers = Array.from({ length: BOARD_SIZE }, (_, c) => String(c + 1).padStart(2)).join(' ');
    return `      ${letters}\n      ${numbers}`;
}

function rowLabel(r) {
    return String(r + 1).padStart(2) + '   ';
}

function renderEnemyView(view, contacts) {
    const lines = [boardHeader()];
    for (let r = 0; r < BOARD_SIZE; r++) {
        const cells = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            const state = view[r][c];
            let ch = VIEW_CHAR[state] ?? '?';
            if (state === VIEW_STATE.HIT && contacts?.has(`${r},${c}`)) ch = '*';
            cells.push(ch.padStart(2));
        }
        lines.push(rowLabel(r) + cells.join(' '));
    }
    return lines.join('\n');
}

function renderOwnBoard(engine, session) {
    const p = engine.sides[session.playerSeat];
    const ai = engine.sides[session.enemySeat];
    const lines = [boardHeader()];
    for (let r = 0; r < BOARD_SIZE; r++) {
        const cells = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            const g = p.grid[r][c];
            let ch;
            if (g.shipId !== -1) {
                const ship = p.ships[g.shipId];
                const hp = ship.hp[g.segmentIndex];
                const base = CODE_CHAR[ship.code] || '?';
                if (hp <= 0) ch = 'X';
                else if (hp < ship.maxHp) ch = base.toLowerCase();
                else ch = base;
            } else if (g.hit) {
                ch = 'o';
            } else if (ai.view[r][c] === VIEW_STATE.SUSPECT) {
                ch = '?';
            } else {
                ch = '.';
            }
            cells.push(ch.padStart(2));
        }
        lines.push(rowLabel(r) + cells.join(' '));
    }
    return lines.join('\n');
}

function shipCellsText(ship) {
    const cells = segmentCells(ship);
    const first = cells[0];
    const last = cells[cells.length - 1];
    return first.r === last.r && first.c === last.c
        ? coord(first.r, first.c)
        : `${coord(first.r, first.c)}-${coord(last.r, last.c)}`;
}

function ownFleetText(engine, session) {
    const p = engine.sides[session.playerSeat];
    return p.ships.map(ship => {
        const hp = ship.hp.map(v => (v <= 0 ? '0' : String(v))).join('/');
        return `${ship.code} ${ship.name} ${shipCellsText(ship)}  舱HP ${hp}  [${ship.sunk ? '已沉没' : '存活'}]`;
    }).join('\n');
}

function enemyFleetText(engine, session) {
    const e = engine.sides[session.enemySeat];
    return e.ships.map(ship => {
        return `${ship.code} ${ship.name}  ${ship.len} 舱  [${ship.sunk ? '已沉没' : '存活'}]`;
    }).join('\n');
}

function suspectList(engine, session) {
    const ai = engine.sides[session.enemySeat];
    const p = engine.sides[session.playerSeat];
    const suspects = [];
    const contacts = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const view = ai.view[r][c];
            if (view !== VIEW_STATE.SUSPECT && view !== VIEW_STATE.HIT) continue;
            const g = p.grid[r][c];
            let shipName = '';
            if (g.shipId !== -1) {
                const ship = p.ships[g.shipId];
                if (view === VIEW_STATE.HIT && ship.hp[g.segmentIndex] < ship.maxHp) continue;
                shipName = `（你的 ${ship.code}）`;
            }
            if (view === VIEW_STATE.SUSPECT) suspects.push(coord(r, c) + shipName);
            else contacts.push(coord(r, c) + shipName);
        }
    }
    const lines = [];
    if (contacts.length) lines.push(`敌方水听标定：${contacts.join('、')}`);
    if (suspects.length) lines.push(`敌方水听疑似：${suspects.join('、')}`);
    return lines.join('\n');
}

function weaponsText(engine, session) {
    const p = engine.sides[session.playerSeat];
    const e = engine.sides[session.enemySeat];
    const sunkEnemyShips = e.ships.filter(s => s.sunk).length;
    const ap = getAPDamage(p.faction, p.ships, { sunkEnemyShips });
    const apSuspect = getAPMaxDamage(p.faction, p.ships, { sunkEnemyShips });
    const apText = apSuspect > ap ? `${ap} 伤（对疑似 ${apSuspect}）` : `${ap} 伤`;
    const he = getHEProfile(p.faction, p.ships);
    const sonar = getSonarProfile(p.faction);
    const sonarUsable = p.ships.some(s => (s.code === 'DD' || s.code === 'SS') && !s.sunk);
    return [
        `主炮 AP：${apText}，穿甲至多 ${getAPMaxPenetrations(p.faction, p.ships)} 舱  [可用]`,
        `空袭 HE：${he.meta}  [${he.available ? (he.degraded ? '陆基可用' : '可用') : '不可用：航母已沉没'}]`,
        `水听 SONAR：${sonar.label}，${sonar.reveal === 'nearest' ? '标定最近接触' : '中心显形'}`
            + `  [${sonarUsable ? '可用' : '不可用：DD/SS 已沉没'}]`
    ].join('\n');
}

function statsText(engine, session) {
    const p = engine.sides[session.playerSeat];
    const e = engine.sides[session.enemySeat];
    const line = side => {
        const s = side.stats;
        const rate = s.shots ? ((s.hits / s.shots) * 100).toFixed(1) : '0.0';
        const weapons = `AP ${s.weapons.AP || 0} / HE ${s.weapons.HE || 0} / 声呐 ${s.weapons.SONAR || 0}`;
        return `${side.faction.toUpperCase()}  伤害 ${s.damage}  命中 ${s.hits}/${s.shots}（${rate}%）`
            + `  声呐 ${s.pings}  行动 ${weapons}`;
    };
    return [`你：${line(p)}`, `敌：${line(e)}`].join('\n');
}

function resultText(engine, session) {
    if (session.resigned) return '你认输了。';
    if (!engine.finished) return '';
    if (engine.winner === null) return '达到手数上限，平局。';
    return engine.winner === session.playerSeat ? '你赢了。' : '你输了。';
}

// ---------------------------------------------------------------------------
// 自测
// ---------------------------------------------------------------------------

export function runSelfTest() {
    const idA = 'selftest-a';
    const idB = 'selftest-b';
    for (const id of [idA, idB]) {
        try {
            deleteSession(id);
        } catch (err) {
            if (!(err instanceof ArenaError)) throw err;
        }
    }

    createSession({
        id: idA,
        playerFaction: 'us',
        enemyFaction: 'rn',
        playerFirst: true,
        seed: 424242
    });
    const a = move(idA, 'AP', 6, 6);
    const aiA = a.session.log.at(-1);

    createSession({
        id: idB,
        playerFaction: 'us',
        enemyFaction: 'rn',
        playerFirst: true,
        seed: 424242
    });
    const b = move(idB, 'AP', 6, 6);
    const aiB = b.session.log.at(-1);

    if (JSON.stringify(aiA) !== JSON.stringify(aiB)) {
        throw new ArenaError('同一状态 + 同一玩家行动，AI 回复不一致');
    }

    const rng = mulberry32(0xC0FFEE);
    let guard = 0;
    while (guard++ < 200) {
        const loaded = loadSession(idA);
        if (loaded.engine.finished || loaded.session.resigned) break;
        ensurePlayerTurn(loaded.session, loaded.engine, loaded.contacts);
        const engine = loaded.engine;
        const session = loaded.session;
        const actions = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (validateAction(engine, session, 'AP', r, c) === null) {
                    actions.push({ r, c });
                }
            }
        }
        if (!actions.length) throw new ArenaError('没有合法的主炮目标');
        const pick = actions[Math.floor(rng() * actions.length)];
        move(idA, 'AP', pick.r + 1, pick.c + 1);
    }

    const final = loadSession(idA);
    const text = statusText(final.engine, final.session, final.contacts);
    if (!text.includes('对局已结束')) throw new ArenaError('自测对局未结束');
    deleteSession(idA);
    deleteSession(idB);
    return 'SELFTEST OK';
}
