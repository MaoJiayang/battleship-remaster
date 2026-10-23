#!/usr/bin/env node
/**
 * Agent Arena CLI — 通过命令行与项目里的真实 AI 对战
 *
 * 对局状态与行动都是纯 JSON，可直接作为多人模式的服务端房间状态：
 *   session.engine  可序列化/复活的完整对局状态
 *   { weapon, r, c } 行动报文（r/c 从 1 开始）
 *
 * 用法：
 *   node tools/agent-arena/cli.mjs new <id> <我方阵营> <敌方阵营> [--first=enemy] [--seed=1] [--level=HARD] [--maxPlies=150]
 *   node tools/agent-arena/cli.mjs status <id>
 *   node tools/agent-arena/cli.mjs fire <id> <AP|HE|SONAR> <row> <col>
 *   node tools/agent-arena/cli.mjs log <id>
 *   node tools/agent-arena/cli.mjs list
 *   node tools/agent-arena/cli.mjs resign <id>
 *   node tools/agent-arena/cli.mjs delete <id>
 *   node tools/agent-arena/cli.mjs selftest
 */

import {
    ArenaError,
    createSession,
    deleteSession,
    listSessions,
    loadSession,
    logText,
    move,
    resignSession,
    runSelfTest,
    status
} from './arena.mjs';
import { FACTIONS } from '../../src/data/factions.js';

const USAGE = [
    '用法：',
    '  new <id> <我方阵营> <敌方阵营> [--first=enemy] [--seed=1] [--level=HARD] [--maxPlies=150]',
    '  status <id>',
    '  fire <id> <AP|HE|SONAR> <row> <col>',
    '  log <id>',
    '  list',
    '  resign <id>',
    '  delete <id>',
    '  selftest',
    '',
    `阵营：${Object.keys(FACTIONS).join(' / ')}`,
    '坐标：行、列均为 1–11（例如第 8 行第 7 列 = 8 7）'
].join('\n');

function parseOptions(args) {
    const options = {};
    for (const arg of args) {
        const match = /^--([^=]+)=(.*)$/.exec(arg);
        if (match) options[match[1]] = match[2];
    }
    return options;
}

function fail(message) {
    console.error(message);
    console.error('');
    console.error(USAGE);
    process.exit(1);
}

function requireArgs(args, count, example) {
    if (args.length < count) fail(`参数不足。例如：${example}`);
}

function validateFaction(id, label) {
    if (!FACTIONS[id]) fail(`${label}阵营不存在：${id}`);
}

function printLastActions(session, count = 2) {
    for (const entry of session.log.slice(-count)) {
        console.log(`第 ${entry.ply} 手 ${entry.text}`);
    }
    console.log('');
}

const [, , command, ...args] = process.argv;

try {
    switch (command) {
        case 'new': {
            requireArgs(args, 3, 'new g1 us rn --first=enemy');
            const [id, playerFaction, enemyFaction] = args;
            validateFaction(playerFaction, '我方');
            validateFaction(enemyFaction, '敌方');
            const options = parseOptions(args.slice(3));
            const seed = options.seed === undefined ? Date.now() : Number(options.seed);
            createSession({
                id,
                playerFaction,
                enemyFaction,
                playerFirst: options.first !== 'enemy',
                seed,
                level: options.level || 'HARD',
                maxPlies: options.maxPlies === undefined ? 150 : Number(options.maxPlies)
            });
            console.log(status(id));
            break;
        }

        case 'status': {
            requireArgs(args, 1, 'status g1');
            console.log(status(args[0]));
            break;
        }

        case 'fire': {
            requireArgs(args, 4, 'fire g1 AP 6 6');
            const [id, weaponArg, row, col] = args;
            const weapon = weaponArg.toUpperCase();
            if (!['AP', 'HE', 'SONAR'].includes(weapon)) fail(`武器必须是 AP / HE / SONAR：${weaponArg}`);
            const result = move(id, weapon, Number(row), Number(col));
            printLastActions(result.session);
            console.log(status(id));
            break;
        }

        case 'log': {
            requireArgs(args, 1, 'log g1');
            const { session } = loadSession(args[0]);
            console.log(logText(session));
            break;
        }

        case 'list': {
            const sessions = listSessions();
            if (!sessions.length) {
                console.log('暂无对局。');
                break;
            }
            console.log('id                 我方 敌方 难度  手数  状态        更新时间');
            for (const s of sessions) {
                const state = s.resigned ? '认输' : (s.finished ? `结束（${s.winner}胜）` : '进行中');
                console.log(`${String(s.id).padEnd(18)} ${String(s.player).padEnd(4)} ${String(s.enemy).padEnd(4)} `
                    + `${String(s.level).padEnd(5)} ${String(s.plies).padStart(4)}  ${state.padEnd(10)} ${s.updatedAt || ''}`);
            }
            break;
        }

        case 'resign': {
            requireArgs(args, 1, 'resign g1');
            resignSession(args[0]);
            console.log(status(args[0]));
            break;
        }

        case 'delete': {
            requireArgs(args, 1, 'delete g1');
            deleteSession(args[0]);
            console.log(`已删除对局 ${args[0]}`);
            break;
        }

        case 'selftest': {
            console.log(runSelfTest());
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
