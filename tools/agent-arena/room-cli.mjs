#!/usr/bin/env node
/**
 * 多人房间 CLI — 与 arena CLI 平行，但走座位/版本号/纯 JSON 报文
 *
 *   node tools/agent-arena/room-cli.mjs new <id> <A阵营> <B阵营> [--controllers=human,ai] [--first=A] [--seed=1]
 *   node tools/agent-arena/room-cli.mjs status <id> [--seat=A]
 *   node tools/agent-arena/room-cli.mjs fire <id> <AP|HE|SONAR> <row> <col> [--seat=A]
 *   node tools/agent-arena/room-cli.mjs log <id> [--seat=A]
 *   node tools/agent-arena/room-cli.mjs list
 *   node tools/agent-arena/room-cli.mjs resign <id> [--seat=A]
 *   node tools/agent-arena/room-cli.mjs delete <id>
 *   node tools/agent-arena/room-cli.mjs import <arenaSessionId> [<roomId>]
 *   node tools/agent-arena/room-cli.mjs selftest
 *
 * 房间文件位于系统临时目录（可用 HZQ_ROOM_DIR 覆盖），含未结束对局的隐藏布阵。
 */

import { FACTIONS } from '../../src/data/factions.js';
import { ArenaError, loadSession } from './arena.mjs';
import {
    createRoom,
    deleteRoom,
    importArenaSession,
    listRooms,
    loadRoom,
    roomStatusText,
    runRoomSelfTest,
    saveRoom,
    submit,
    viewFor
} from './room.mjs';

const USAGE = [
    '用法：',
    '  new <id> <A阵营> <B阵营> [--controllers=human,ai] [--first=A] [--seed=1] [--level=HARD] [--maxPlies=150]',
    '  status <id> [--seat=A]',
    '  fire <id> <AP|HE|SONAR> <row> <col> [--seat=A]',
    '  log <id> [--seat=A]',
    '  list',
    '  resign <id> [--seat=A]',
    '  delete <id>',
    '  import <arenaSessionId> [<roomId>]',
    '  selftest',
    '',
    `阵营：${Object.keys(FACTIONS).join(' / ')}`,
    '坐标：行、列均为 1–11（例如第 8 行第 7 列 = 8 7）'
].join('\n');

function parseOptions(args) {
    const options = {};
    for (const arg of args.filter(a => a.startsWith('--'))) {
        const match = /^--([^=]+)=(.*)$/.exec(arg);
        if (match) options[match[1]] = match[2];
    }
    return options;
}

function positional(args) {
    return args.filter(arg => !arg.startsWith('--'));
}

function fail(message) {
    console.error(message);
    console.error('');
    console.error(USAGE);
    process.exit(1);
}

function requireArgs(args, count, example) {
    if (positional(args).length < count) fail(`参数不足。例如：${example}`);
}

function seatOf(options) {
    const seat = (options.seat || 'A').toUpperCase();
    if (!['A', 'B'].includes(seat)) fail('--seat 必须是 A / B');
    return seat;
}

function validateFaction(id, label) {
    if (!FACTIONS[id]) fail(`${label}阵营不存在：${id}`);
}

function printNewEvents(room, seat, count) {
    if (!count) return;
    const view = viewFor(room, seat);
    for (const entry of view.log.slice(-count)) {
        console.log(`第 ${entry.ply} 手 ${entry.text}`);
    }
    console.log('');
}

const [, , command, ...args] = process.argv;

try {
    switch (command) {
        case 'new': {
            requireArgs(args, 3, 'new r1 us rn --first=B');
            const [id, factionA, factionB] = positional(args);
            validateFaction(factionA, 'A 座位');
            validateFaction(factionB, 'B 座位');
            const options = parseOptions(args);
            const controllers = (options.controllers || 'human,ai').split(',').map(v => v.trim());
            if (controllers.length !== 2 || controllers.some(v => !['human', 'ai'].includes(v))) {
                fail('--controllers 必须形如 human,ai');
            }
            const firstSeat = (options.first || 'A').toUpperCase();
            const seed = options.seed === undefined ? Date.now() : Number(options.seed);
            const { room } = createRoom({
                id,
                seats: {
                    A: { faction: factionA, controller: controllers[0] },
                    B: { faction: factionB, controller: controllers[1] }
                },
                firstSeat,
                seed,
                level: options.level || 'HARD',
                maxPlies: options.maxPlies === undefined ? 150 : Number(options.maxPlies)
            });
            saveRoom(room);
            console.log(roomStatusText(room, 'A'));
            break;
        }

        case 'status': {
            requireArgs(args, 1, 'status r1 --seat=A');
            const [id] = positional(args);
            console.log(roomStatusText(loadRoom(id), seatOf(parseOptions(args))));
            break;
        }

        case 'fire': {
            requireArgs(args, 4, 'fire r1 AP 6 6');
            const [id, weaponArg, row, col] = positional(args);
            const options = parseOptions(args);
            const seat = seatOf(options);
            const room = loadRoom(id);
            const { room: next, events } = submit(room, {
                type: 'action',
                roomId: room.id,
                seat,
                version: room.version,
                weapon: weaponArg.toUpperCase(),
                r: Number(row),
                c: Number(col)
            });
            saveRoom(next);
            printNewEvents(next, seat, events.length);
            console.log(roomStatusText(next, seat));
            break;
        }

        case 'log': {
            requireArgs(args, 1, 'log r1');
            const [id] = positional(args);
            const seat = seatOf(parseOptions(args));
            const view = viewFor(loadRoom(id), seat);
            console.log(`=== ${view.roomId} 战报（${view.seat} 座位视角）===`);
            for (const entry of view.log) {
                console.log(`第 ${entry.ply} 手 ${entry.text}`);
            }
            break;
        }

        case 'list': {
            const rooms = listRooms();
            if (!rooms.length) {
                console.log('暂无房间。');
                break;
            }
            console.log('id                 座位              版本  手数  状态        更新时间');
            for (const room of rooms) {
                const seats = ['A', 'B']
                    .map(seat => `${room.seats[seat].faction.toUpperCase()}/${room.seats[seat].controller}`)
                    .join(' vs ');
                const state = room.finished ? `结束（${room.winner || '平'}胜）` : '进行中';
                console.log(`${String(room.id).padEnd(18)} ${seats.padEnd(16)} `
                    + `${String(room.version).padStart(4)}  ${String(room.plies).padStart(4)}  `
                    + `${state.padEnd(10)} ${room.updatedAt || ''}`);
            }
            break;
        }

        case 'resign': {
            requireArgs(args, 1, 'resign r1 --seat=A');
            const [id] = positional(args);
            const seat = seatOf(parseOptions(args));
            const room = loadRoom(id);
            const { room: next } = submit(room, {
                type: 'resign',
                roomId: room.id,
                seat,
                version: room.version
            });
            saveRoom(next);
            console.log(roomStatusText(next, seat));
            break;
        }

        case 'delete': {
            requireArgs(args, 1, 'delete r1');
            deleteRoom(positional(args)[0]);
            console.log(`已删除房间 ${positional(args)[0]}`);
            break;
        }

        case 'import': {
            requireArgs(args, 1, 'import sub1-us-rm sub1-room');
            const [arenaId, roomId = `${arenaId}-room`] = positional(args);
            const { session } = loadSession(arenaId);
            const room = importArenaSession(session, roomId);
            saveRoom(room);
            console.log(roomStatusText(room, 'A'));
            break;
        }

        case 'selftest': {
            console.log(runRoomSelfTest());
            break;
        }

        case 'help':
        case '--help':
        case '-h':
        case undefined: {
            console.log(USAGE);
            break;
        }

        default:
            fail(`未知命令：${command}`);
    }
} catch (error) {
    if (error instanceof ArenaError || error instanceof Error) {
        console.error(error.message);
        process.exit(1);
    }
    throw error;
}
