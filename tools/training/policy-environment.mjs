import readline from 'node:readline';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { deployFleet } from '../sim/layouts.mjs';
import { encodeNeuralObservation, neuralAction, neuralActionIndex } from '../../src/ai/neuralObservation.js';
import { encodePublicEvent } from '../../src/ai/neuralHistory.js';
import { FACTIONS, hashSeed, mulberry32 } from '../sim/core.mjs';

let games = [];
let cursors = [];

function observation(index, seat = games[index].currentSeat) {
    const game = games[index];
    const side = game.sides[seat];
    const context = game._decisionContext(side, game.sides[seat === 'A' ? 'B' : 'A']);
    const previous = side.engine.actionHistory.at(-1);
    if (previous && !previous.afterView) previous.afterView = context.viewGrid.map(row => [...row]);
    const encoded = encodeNeuralObservation(context, {
        history: side.engine.actionHistory, damageGrid: side.engine.damageDealtGrid, sonarHistory: side.engine.sonarHistory
    });
    const events = game.publicHistory.slice(cursors[index][seat]).map(event => Array.from(encodePublicEvent(event, seat)));
    cursors[index][seat] = game.publicHistory.length;
    return { index, seat, planes: Array.from(encoded.planes), globals: Array.from(encoded.globals), mask: Array.from(encoded.mask),
        schema: encoded.schema, rulesId: encoded.rulesId, events };
}

function reset(spec) {
    if (!Number.isInteger(spec.games) || spec.games < 2 || !Number.isInteger(spec.maxPlies) || spec.maxPlies < 1) throw new Error('环境配置无效');
    if (spec.learnerSeats && (!Array.isArray(spec.learnerSeats) || spec.learnerSeats.length !== spec.games
        || spec.learnerSeats.some(seat => seat !== 'A' && seat !== 'B'))) throw new Error('学习座位配置无效');
    games = [];
    cursors = [];
    const saved = Math.random;
    try {
        for (let index = 0; index < spec.games; index++) {
            const group = spec.paired === false ? index : Math.floor(index / 2);
            const seed = hashSeed(`ppo-layout|${spec.seed}|${group}`);
            const layout = hashSeed(`ppo-layout-kind|${spec.seed}|${group}`) % 2 ? 'uniform' : 'spread';
            Math.random = mulberry32(seed);
            const fleetA = deployFleet(layout);
            Math.random = mulberry32(seed ^ 0x9E3779B9);
            const fleetB = deployFleet(layout);
            const factionA = FACTIONS[group % 7];
            const factionB = FACTIONS[Math.floor(group / 7) % 7];
            const learnerSeat = spec.learnerSeats?.[index];
            const nextSeat = spec.maxPlies % 2 === 0 ? 'A' : 'B';
            const maxPlies = spec.maxPlies + Number(Boolean(learnerSeat && learnerSeat !== nextSeat));
            const game = new SimulationEngine({ faction: factionA }, { faction: factionB }, {
                fleetA, fleetB, maxPlies, recordPublicHistory: true
            });
            game.policySeed = seed;
            game.learnerSeat = learnerSeat;
            game.layout = layout;
            games.push(game);
            cursors.push({ A: 0, B: 0 });
        }
    } finally { Math.random = saved; }
    return { observations: games.map((_, index) => observation(index)),
        configurations: games.map((game, index) => ({ index, seed: game.policySeed, layout: game.layout,
            factions: [game.configA.faction, game.configB.faction], tuning: game.configA.tuning })) };
}

function step(commands) {
    const observations = [];
    const results = [];
    const actions = [];
    for (const command of commands) {
        const { index } = command;
        const game = games[index];
        if (!game || game.finished) throw new Error('对局不存在或已经结束');
        const seat = game.currentSeat;
        const side = game.sides[seat];
        const original = side.engine.decide;
        const random = Math.random;
        try {
            Math.random = mulberry32(hashSeed(`ppo-turn|${game.policySeed}|${seat}|${game.plies}`));
            if (command.action !== null) {
                if (!Number.isInteger(command.action) || command.action < 0 || command.action >= 363) throw new Error('行动编号无效');
                const context = game._decisionContext(side, game.sides[seat === 'A' ? 'B' : 'A']);
                const encoded = encodeNeuralObservation(context, { sonarHistory: side.engine.sonarHistory });
                if (!encoded.mask[command.action]) throw new Error('外部策略选择了非法行动');
                const action = neuralAction(command.action);
                side.engine.decide = () => side.engine.recordDecision(action, game._abilities(side, game.sides[seat === 'A' ? 'B' : 'A']), side.view);
            }
            const action = game.step();
            if (action && command.action !== null && neuralActionIndex(action) !== command.action) throw new Error('实际执行行动不一致');
            if (action) actions.push({ index, seat, action: neuralActionIndex(action) });
            if (!game.finished && game.plies >= game.maxPlies) game.step();
        } finally {
            side.engine.decide = original;
            Math.random = random;
        }
        if (!game.finished) observations.push(observation(index));
        else {
            const result = game.getResult();
            results.push({ index, winner: game.winner, terminated: result.terminated, truncated: result.truncated,
                currentSeat: game.currentSeat, learnerSeat: game.learnerSeat,
                plies: game.plies, damage: [result.A.stats.damage, result.B.stats.damage],
                finalObservations: result.truncated ? [observation(index, 'A'), observation(index, 'B')] : [] });
        }
    }
    return { observations, results, actions };
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
    try {
        const request = JSON.parse(line);
        const result = request.type === 'reset' ? reset(request) : request.type === 'step' ? step(request.actions) : null;
        if (!result) throw new Error('环境命令无效');
        process.stdout.write(JSON.stringify(result) + '\n');
    } catch (error) {
        process.stdout.write(JSON.stringify({ error: error.message }) + '\n');
    }
}
