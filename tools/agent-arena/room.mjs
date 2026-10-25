#!/usr/bin/env node
/**
 * Room — 多人模式房间 stub（纯数据）
 *
 * 设计目标：把“对局状态 / 玩家操作 / 广播事件”全部收敛成可 JSON 化的报文，
 * 将来接服务器时只需把 submit() 放到服务端、viewFor() 发给对应座位。
 *
 * 座位：A / B，各带 controller（human | ai）。AI 座位由服务端在回合内自动行动。
 * 状态：room 本身可 JSON.stringify；提交动作带 version 做乐观锁。
 * 报文：
 *   客户端 → 服务端  { type:'action', roomId, seat, version, weapon, r, c }
 *   客户端 → 服务端  { type:'resign', roomId, seat, version }
 *   服务端 → 客户端  viewFor(room, seat)（不含敌方布阵）
 *   服务端 → 客户端  { room, events }（events 可只广播公开字段）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { deployShips } from '../../src/ai/aiDeployment.js';
import { SHIP_TYPES } from '../../src/data/ships.js';
import { getAITuning } from '../../src/ai/aiTuning.js';
import { VIEW_STATE } from '../../src/game/battle/ViewState.js';
import { isValidActionTarget } from '../../src/game/battle/ActionRules.js';
import { ArenaError, reviveEngine, serializeEngine, statusText, validateAction } from './arena.mjs';

const OTHER = { A: 'B', B: 'A' };
const PROTOCOL = 1;
const WEAPON_NAME = { AP: '主炮', HE: '空袭', SONAR: '水听' };
const ROOM_DIR = process.env.HZQ_ROOM_DIR || path.join(os.tmpdir(), 'hzq-arena-rooms');

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

// AI 的随机数只由“种子 + 已发生行动数”决定，和 arena 的推进方式保持一致
function seedFor(room) {
    const n = room.log.length;
    Math.random = mulberry32((room.seed ^ Math.imul(n + 1, 0x9E3779B1)) >>> 0);
}

function roomPath(id) {
    const sid = String(id);
    if (!/^[\w.-]+$/.test(sid)) throw new ArenaError(`房间 id 不合法：${sid}`);
    return path.join(ROOM_DIR, `${sid}.json`);
}

function snapshotSide(side) {
    return {
        hp: side.ships.map(ship => ship.hp.map(v => Math.max(0, v))),
        sunk: side.ships.map(ship => ship.sunk),
        view: side.view.map(row => row.slice())
    };
}

function hpTotal(hp) {
    return hp.reduce((sum, list) => sum + list.reduce((a, b) => a + b, 0), 0);
}

function viewDelta(before, after) {
    const delta = { miss: 0, hit: 0, destroyed: 0, suspect: 0, sunk: 0 };
    for (let r = 0; r < after.length; r++) {
        for (let c = 0; c < after[r].length; c++) {
            const next = after[r][c];
            if (next === before[r][c]) continue;
            if (next === VIEW_STATE.MISS) delta.miss++;
            else if (next === VIEW_STATE.HIT) delta.hit++;
            else if (next === VIEW_STATE.DESTROYED) delta.destroyed++;
            else if (next === VIEW_STATE.SUSPECT) delta.suspect++;
            else if (next === VIEW_STATE.SUNK) delta.sunk++;
        }
    }
    return delta;
}

function makeEvent(engine, seat, action, before, beforeAttackerView) {
    const defender = engine.sides[OTHER[seat]];
    const attacker = engine.sides[seat];
    const sunk = [];
    for (let i = 0; i < defender.ships.length; i++) {
        if (!before.sunk[i] && defender.ships[i].sunk) {
            sunk.push({ code: defender.ships[i].code, name: defender.ships[i].name });
        }
    }
    let contact = null;
    if (action.weapon === 'SONAR') {
        for (let r = 0; r < attacker.view.length && !contact; r++) {
            for (let c = 0; c < attacker.view[r].length; c++) {
                if (attacker.view[r][c] === VIEW_STATE.HIT && beforeAttackerView[r][c] !== VIEW_STATE.HIT) {
                    contact = { r, c };
                    break;
                }
            }
        }
    }
    return {
        ply: engine.plies,
        seat,
        weapon: action.weapon,
        r: action.r,
        c: action.c,
        damage: hpTotal(before.hp) - hpTotal(defender.ships.map(s => s.hp)),
        sunk,
        contact,
        viewDelta: viewDelta(beforeAttackerView, attacker.view),
        finished: engine.finished,
        winner: engine.winner
    };
}

export function contactsFor(room, seat) {
    const contacts = new Set();
    for (const entry of room.log) {
        if (entry.seat === seat && entry.contact) contacts.add(`${entry.contact.r},${entry.contact.c}`);
    }
    return contacts;
}

function coord(r, c) {
    return `${String.fromCharCode(65 + c)}${r + 1}`;
}

function describeEvent(entry, viewerSeat) {
    if (entry.legacyText && viewerSeat === 'A') return entry.legacyText;
    const actor = entry.seat === viewerSeat ? '你' : '敌方';
    const at = coord(entry.r, entry.c);
    const prefix = `${actor} ${WEAPON_NAME[entry.weapon] || entry.weapon} ${at} → `;
    if (entry.weapon === 'SONAR') {
        const d = entry.viewDelta || {};
        if (entry.contact) {
            return `${prefix}有信号，接触 ${coord(entry.contact.r, entry.contact.c)}，周边新增 ${d.suspect || 0} 格疑似`;
        }
        return `${prefix}无信号，新增 ${d.miss || 0} 格未中`;
    }
    let text = `${prefix}${entry.damage ? `命中 ${entry.damage} 伤` : '未命中'}`;
    if (entry.sunk?.length) text += `；击沉 ${entry.sunk.map(s => s.code).join('、')}`;
    return text;
}

function isOver(room) {
    return room.finished || room.resignedSeat !== null;
}

function seal(room, engine) {
    room.engine = serializeEngine(engine);
    room.finished = engine.finished;
    room.winner = engine.winner;
}

function applyAction(engine, seat, action) {
    if (engine.plies >= engine.maxPlies) {
        engine._finish(null);
        return null;
    }
    const attacker = engine.sides[seat];
    const defender = engine.sides[OTHER[seat]];
    const abilities = engine._abilities(attacker, defender);
    if (!isValidActionTarget(action, attacker.view, abilities, attacker.sonarEvidence)) throw new ArenaError('行动无效：没有可更新的海域');
    engine.plies++;
    engine._executeAction(attacker, defender, action, abilities);
    if (defender.ships.every(s => s.sunk)) {
        engine._finish(seat);
        return action;
    }
    engine.currentSeat = OTHER[seat];
    return action;
}

function runAiTurns(room, engine, events) {
    let guard = 0;
    while (!room.finished && !room.resignedSeat
        && room.seats[engine.currentSeat]?.controller === 'ai') {
        if (guard++ > room.maxPlies + 8) throw new ArenaError('AI 回合推进异常（连续行动过多）');
        seedFor(room);
        const seat = engine.currentSeat;
        const before = snapshotSide(engine.sides[OTHER[seat]]);
        const beforeView = engine.sides[seat].view.map(row => row.slice());
        const action = engine.step();
        if (!action) break;
        const event = makeEvent(engine, seat, action, before, beforeView);
        room.log.push(event);
        room.version++;
        events.push(event);
    }
}

// ---------------------------------------------------------------------------
// 房间生命周期
// ---------------------------------------------------------------------------

export function createRoom({
    id,
    seats,
    seed = Date.now(),
    level = 'HARD',
    maxPlies = 150,
    firstSeat = 'A',
    fleets = null,
    aiMode = 'default'
}) {
    const sid = String(id);
    if (fs.existsSync(roomPath(sid))) throw new ArenaError(`房间 ${sid} 已存在`);
    if (!seats?.A?.faction || !seats?.B?.faction) throw new ArenaError('房间需要 A/B 两个座位');
    for (const seat of ['A', 'B']) {
        const controller = seats[seat].controller || 'human';
        if (!['human', 'ai'].includes(controller)) {
            throw new ArenaError(`座位 ${seat} 的 controller 必须是 human / ai`);
        }
        seats[seat] = { faction: seats[seat].faction, controller };
    }
    if (!['A', 'B'].includes(firstSeat)) throw new ArenaError('firstSeat 必须是 A / B');
    if (!['default', 'search'].includes(aiMode)) throw new ArenaError('AI 策略必须是 default / search');
    if (aiMode === 'search' && level !== 'HARD') throw new ArenaError('实验搜索仅支持 HARD 难度');

    const dealt = fleets || makeFleets(seed >>> 0);
    const configFor = seat => ({ faction: seats[seat].faction, level,
        tuning: seats[seat].controller === 'ai' && aiMode === 'search'
            ? { ...getAITuning(level), search: true } : undefined });
    const engine = new SimulationEngine(
        configFor('A'),
        configFor('B'),
        {
            firstSeat,
            fleetA: dealt.A,
            fleetB: dealt.B,
            maxPlies
        }
    );

    const room = {
        protocol: PROTOCOL,
        id: sid,
        version: 0,
        seed: seed >>> 0,
        level,
        aiMode,
        maxPlies,
        seats,
        engine: serializeEngine(engine),
        log: [],
        resignedSeat: null,
        finished: false,
        winner: null,
        createdAt: new Date().toISOString()
    };
    const events = [];
    runAiTurns(room, engine, events);
    seal(room, engine);
    return { room, events };
}

export function submit(room, message) {
    if (!message || typeof message !== 'object') throw new ArenaError('报文必须是对象');
    if (message.roomId && message.roomId !== room.id) throw new ArenaError('房间 id 不匹配');
    if (message.protocol && message.protocol !== PROTOCOL) throw new ArenaError('协议版本不匹配');
    if (isOver(room)) throw new ArenaError('对局已结束');
    if (!['A', 'B'].includes(message.seat)) throw new ArenaError('seat 必须是 A / B');
    if (message.version !== room.version) {
        throw new ArenaError(`状态版本过期：当前 ${room.version}，收到 ${message.version}`);
    }
    if (room.seats[message.seat].controller !== 'human') {
        throw new ArenaError(`座位 ${message.seat} 由服务端控制，不能提交动作`);
    }

    const engine = reviveEngine(room.engine);
    if (engine.currentSeat !== message.seat) throw new ArenaError('还没轮到这个座位');
    const events = [];

    if (message.type === 'resign') {
        room.resignedSeat = message.seat;
        room.finished = true;
        room.winner = OTHER[message.seat];
        room.version++;
        return { room, events };
    }
    if (message.type !== 'action') throw new ArenaError(`未知报文类型：${message.type}`);

    const weapon = String(message.weapon || '').toUpperCase();
    const r = Number(message.r) - 1;
    const c = Number(message.c) - 1;
    const error = validateAction(engine, {
        resigned: false,
        playerSeat: message.seat,
        enemySeat: OTHER[message.seat]
    }, weapon, r, c);
    if (error) throw new ArenaError(error);

    const action = { weapon, r, c };
    const before = snapshotSide(engine.sides[OTHER[message.seat]]);
    const beforeView = engine.sides[message.seat].view.map(row => row.slice());
    const applied = applyAction(engine, message.seat, action);
    if (applied) {
        const event = makeEvent(engine, message.seat, action, before, beforeView);
        room.log.push(event);
        room.version++;
        events.push(event);
    }
    runAiTurns(room, engine, events);
    seal(room, engine);
    return { room, events };
}

export function viewFor(room, seat) {
    if (!['A', 'B'].includes(seat)) throw new ArenaError('seat 必须是 A / B');
    const engine = reviveEngine(room.engine);
    if (room.resignedSeat) {
        engine.finished = true;
        engine.winner = OTHER[room.resignedSeat];
    }
    const me = engine.sides[seat];
    const foe = engine.sides[OTHER[seat]];
    const view = {
        protocol: PROTOCOL,
        type: 'view',
        roomId: room.id,
        version: room.version,
        seat,
        faction: me.faction,
        level: room.level,
        aiMode: room.aiMode || 'default',
        plies: engine.plies,
        currentSeat: engine.currentSeat,
        yourTurn: !isOver(room) && engine.currentSeat === seat
            && room.seats[seat].controller === 'human',
        finished: isOver(room),
        winner: room.winner,
        resignedSeat: room.resignedSeat,
        yourShips: me.ships.map(ship => ({
            id: ship.id,
            code: ship.code,
            name: ship.name,
            len: ship.len,
            hp: ship.hp.map(v => Math.max(0, v)),
            sunk: ship.sunk,
            r: ship.r,
            c: ship.c,
            vertical: ship.vertical
        })),
        yourWaters: foe.view.map(row => row.slice()),
        enemyWaters: me.view.map(row => row.slice()),
        enemyContacts: [...contactsFor(room, seat)].map(key => {
            const [r, c] = key.split(',').map(Number);
            return { r, c };
        }),
        enemyShips: foe.ships.map(ship => ({
            code: ship.code,
            name: ship.name,
            len: ship.len,
            sunk: ship.sunk
        })),
        yourStats: me.stats,
        enemyStats: foe.stats,
        log: room.log.map(entry => ({
            ply: entry.ply,
            seat: entry.seat,
            weapon: entry.weapon,
            r: entry.r,
            c: entry.c,
            damage: entry.damage,
            sunk: entry.sunk,
            text: describeEvent(entry, seat)
        }))
    };
    if (isOver(room)) {
        view.enemyReveal = foe.ships.map(ship => ({
            code: ship.code,
            name: ship.name,
            len: ship.len,
            hp: ship.hp.map(v => Math.max(0, v)),
            sunk: ship.sunk,
            r: ship.r,
            c: ship.c,
            vertical: ship.vertical
        }));
    }
    return view;
}

export function roomStatusText(room, seat = 'A') {
    const engine = reviveEngine(room.engine);
    if (room.resignedSeat) {
        engine.finished = true;
        engine.winner = OTHER[room.resignedSeat];
    }
    const pseudo = {
        playerSeat: seat,
        enemySeat: OTHER[seat],
        level: room.level,
        resigned: room.resignedSeat === seat,
        log: room.log.map(entry => ({ ply: entry.ply, text: describeEvent(entry, seat) }))
    };
    return `${statusText(engine, pseudo, contactsFor(room, seat))}\nAI 策略：${room.aiMode === 'search' ? '实验搜索' : '默认策略'}`;
}

// ---------------------------------------------------------------------------
// 房间存储
// ---------------------------------------------------------------------------

export function saveRoom(room) {
    fs.mkdirSync(ROOM_DIR, { recursive: true });
    room.updatedAt = new Date().toISOString();
    fs.writeFileSync(roomPath(room.id), JSON.stringify(room), 'utf8');
    return room;
}

export function loadRoom(id) {
    const file = roomPath(id);
    if (!fs.existsSync(file)) throw new ArenaError(`房间 ${id} 不存在`);
    const room = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (room.protocol !== PROTOCOL) throw new ArenaError(`房间 ${id} 协议版本不兼容`);
    return room;
}

export function listRooms() {
    if (!fs.existsSync(ROOM_DIR)) return [];
    return fs.readdirSync(ROOM_DIR)
        .filter(name => name.endsWith('.json'))
        .map(name => JSON.parse(fs.readFileSync(path.join(ROOM_DIR, name), 'utf8')))
        .map(room => ({
            id: room.id,
            version: room.version,
            seats: room.seats,
            plies: room.engine.plies,
            finished: isOver(room),
            winner: room.winner,
            updatedAt: room.updatedAt
        }));
}

export function deleteRoom(id) {
    const file = roomPath(id);
    if (!fs.existsSync(file)) throw new ArenaError(`房间 ${id} 不存在`);
    fs.unlinkSync(file);
}

/** 把旧 arena 会话（单人对 AI）导入为房间，保留引擎快照与战报，不重开 */
export function importArenaSession(session, roomId = session.id) {
    const room = {
        protocol: PROTOCOL,
        id: String(roomId),
        version: session.engine.plies,
        seed: session.seed,
        level: session.level,
        maxPlies: session.engine.maxPlies,
        seats: {
            A: { faction: session.engine.sides.A.faction, controller: 'human' },
            B: { faction: session.engine.sides.B.faction, controller: 'ai' }
        },
        engine: session.engine,
        log: session.log.map(entry => ({
            ply: entry.ply,
            seat: entry.isPlayer ? 'A' : 'B',
            weapon: entry.weapon,
            r: entry.r,
            c: entry.c,
            damage: null,
            sunk: [],
            legacyText: entry.text
        })),
        resignedSeat: session.resigned ? 'A' : null,
        finished: session.engine.finished,
        winner: session.engine.winner,
        createdAt: session.createdAt || new Date().toISOString()
    };
    return room;
}

// ---------------------------------------------------------------------------
// 自测
// ---------------------------------------------------------------------------

export function runRoomSelfTest() {
    const saveDir = process.env.HZQ_ROOM_DIR;
    delete process.env.HZQ_ROOM_DIR;

    const { room } = createRoom({
        id: `room-selftest-${Date.now()}`,
        seats: { A: { faction: 'us' }, B: { faction: 'rn', controller: 'ai' } },
        seed: 424242,
        level: 'HARD',
        maxPlies: 200,
        firstSeat: 'A'
    });
    if (room.version !== 0 || room.log.length !== 0) throw new ArenaError('开局版本/日志不正确');

    const viewA = viewFor(room, 'A');
    if (viewA.enemyShips.some(ship => 'hp' in ship || 'r' in ship)) {
        throw new ArenaError('未结束的对局泄露了敌方布阵');
    }
    if (JSON.stringify(viewA) === JSON.stringify(viewFor(room, 'B'))) {
        throw new ArenaError('两个座位的视图不应相同');
    }

    const first = submit(room, {
        type: 'action', roomId: room.id, seat: 'A', version: room.version,
        weapon: 'AP', r: 6, c: 6
    });
    if (first.events.length < 2) throw new ArenaError('AI 座位没有自动回应');
    const afterAi = viewFor(first.room, 'A');
    if (afterAi.finished) throw new ArenaError('对局不应在首手结束');
    if (afterAi.currentSeat !== 'A') throw new ArenaError('AI 行动后没有轮回到人类座位');

    const experimental = createRoom({
        id: `room-selftest-search-${Date.now()}`,
        seats: { A: { faction: 'us' }, B: { faction: 'us', controller: 'ai' } },
        seed: 17, firstSeat: 'B', aiMode: 'search'
    }).room;
    const experimentalView = viewFor(JSON.parse(JSON.stringify(experimental)), 'A');
    if (experimentalView.aiMode !== 'search' || experimentalView.log.length !== 1 || !experimentalView.yourTurn) {
        throw new ArenaError('实验搜索房间没有正常完成 AI 首手或保存模式');
    }
    if (experimentalView.enemyShips.some(ship => 'r' in ship || 'hp' in ship)) throw new ArenaError('实验搜索房间泄露隐藏信息');

    let staleBlocked = false;
    try {
        submit(first.room, {
            type: 'action', roomId: room.id, seat: 'A', version: 0,
            weapon: 'AP', r: 1, c: 1
        });
    } catch (error) {
        staleBlocked = /版本过期/.test(error.message);
    }
    if (!staleBlocked) throw new ArenaError('过期版本没有被拒绝');

    const cloned = JSON.parse(JSON.stringify(first.room));
    const viewCloned = viewFor(cloned, 'A');
    if (viewCloned.version !== first.room.version) throw new ArenaError('房间 JSON 往返失败');

    let wrongTurn = false;
    try {
        submit(cloned, {
            type: 'action', roomId: room.id, seat: 'B', version: cloned.version,
            weapon: 'AP', r: 1, c: 1
        });
    } catch (error) {
        wrongTurn = /服务端控制|还没轮到/.test(error.message);
    }
    if (!wrongTurn) throw new ArenaError('AI 座位不应接受外部动作');

    const hotseat = createRoom({
        id: `room-selftest-hot-${Date.now()}`,
        seats: { A: { faction: 'fn' }, B: { faction: 'km' } },
        seed: 7,
        level: 'HARD',
        maxPlies: 200,
        firstSeat: 'B'
    }).room;
    if (hotseat.engine.currentSeat !== 'B') throw new ArenaError('先手座位不正确');
    const hotView = viewFor(hotseat, 'B');
    if (!hotView.yourTurn) throw new ArenaError('先手座位没有轮到行动');
    if (hotView.enemyShips.some(ship => 'r' in ship)) throw new ArenaError('hotseat 视图泄露布阵');

    // 两真人座位：随机合法 AP 收尾，验证能正常结束
    let guard = 0;
    while (!isOver(hotseat) && guard++ < 400) {
        const seat = hotseat.engine.currentSeat;
        const engine = reviveEngine(hotseat.engine);
        let picked = null;
        for (let r = 0; r < 11 && !picked; r++) {
            for (let c = 0; c < 11 && !picked; c++) {
                const error = validateAction(engine, {
                    resigned: false, playerSeat: seat, enemySeat: OTHER[seat]
                }, 'AP', r, c);
                if (error === null) picked = { r, c };
            }
        }
        if (!picked) throw new ArenaError('没有合法的主炮目标');
        submit(hotseat, {
            type: 'action', roomId: hotseat.id, seat, version: hotseat.version,
            weapon: 'AP', r: picked.r + 1, c: picked.c + 1
        });
    }
    if (!isOver(hotseat)) throw new ArenaError('hotseat 对局未能结束');
    const finalView = viewFor(hotseat, 'A');
    if (!finalView.enemyReveal?.length) throw new ArenaError('结束后没有公开敌方布阵');
    if (!finalView.log.length) throw new ArenaError('战报为空');

    if (saveDir !== undefined) process.env.HZQ_ROOM_DIR = saveDir;
    return 'ROOM SELFTEST OK';
}
