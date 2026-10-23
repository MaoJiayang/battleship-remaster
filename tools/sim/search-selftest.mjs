import assert from 'node:assert/strict';
import { AIDecisionEngine } from '../../src/ai/aiStrategy.js';
import { BeliefState } from '../../src/ai/aiCore.js';
import { getAITuning } from '../../src/ai/aiTuning.js';
import { resolveHit } from '../../src/game/battle/HitResolver.js';
import { resolveSonar } from '../../src/game/battle/SonarResolver.js';
import { mulberry32 } from './core.mjs';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { BeliefSearch } from '../../src/ai/beliefSearch.js';

function board(state = 0) {
    return Array.from({ length: 11 }, () => Array(11).fill(state));
}

function context() {
    const view = board(1);
    view[5][5] = 2;
    view[8][8] = 0;
    const opponentView = board(1);
    opponentView[0][0] = 2;
    return {
        viewGrid: view, playerViewGrid: opponentView,
        myShips: [{ id: 0, code: 'SS', len: 1, maxHp: 2, sunk: false }],
        enemyShips: [{ id: 0, code: 'SS', len: 1, maxHp: 2, hp: [1], sunk: false, r: 0, c: 0, vertical: false }],
        aiFaction: 'us', playerFaction: 'us',
        difficultyConfig: { level: 'HARD', alpha: 0.84, randomness: 0, riskAwareness: 0.46, tuning: { ...getAITuning('HARD'), search: true, searchIterations: 64 } }
    };
}

function damageState() {
    const ships = [{ id: 0, name: '验证舰', code: 'BB', len: 4, maxHp: 3, hp: [1, 1, 3, 3], r: 3, c: 3, vertical: false, sunk: false }];
    const grid = Array.from({ length: 11 }, () => Array.from({ length: 11 }, () => ({ shipId: -1, segmentIndex: -1, hit: false })));
    for (let segment = 0; segment < 4; segment++) grid[3][3 + segment] = { shipId: 0, segmentIndex: segment, hit: false };
    return { ships, grid };
}

for (const maxPenetrations of [1, 2]) {
    const visible = damageState();
    const silent = damageState();
    const actual = resolveHit(3, 3, 4, visible.grid, visible.ships, true, { penetrate: true, maxPenetrations });
    const forecast = resolveHit(3, 3, 4, silent.grid, silent.ships, true, { penetrate: true, maxPenetrations, emitEvents: false });
    assert.deepEqual(silent, visible);
    assert.equal(forecast.dealt, actual.dealt);
    assert.equal(forecast.sunk, actual.sunk);
    assert.equal(forecast.events.length, 0);
}
for (const reveal of ['center', 'nearest']) {
    const visible = damageState();
    const silent = damageState();
    const actual = resolveSonar(2, 4, visible.grid, visible.ships, true, 1, reveal);
    const forecast = resolveSonar(2, 4, silent.grid, silent.ships, true, 1, reveal, { emitEvents: false });
    assert.deepEqual(silent, visible);
    assert.equal(forecast.hasSignal, actual.hasSignal);
    assert.equal(forecast.events.length, 0);
}

Math.random = mulberry32(20261024);
const decision = new AIDecisionEngine().decide(context());
assert.deepEqual(decision, { weapon: 'AP', r: 5, c: 5 });

const privateVariant = context();
privateVariant.myShips[0].r = 10;
privateVariant.myShips[0].c = 10;
privateVariant.myShips[0].hp = [0];
Math.random = mulberry32(20261024);
assert.deepEqual(new AIDecisionEngine().decide(privateVariant), decision);

const view = board(1);
view[2][2] = 2;
Math.random = mulberry32(7);
const belief = new BeliefState([{ id: 0, code: 'SS', len: 1, maxHp: 2 }], view, 128, { posterior: true, sampleFirstTurn: true });
assert.equal(belief.getProbabilityGrid()[2][2], 1);
assert.equal(belief.getProbabilityGrid().flat().reduce((sum, value) => sum + value, 0), 1);

const engine = new AIDecisionEngine();
const pending = engine.decideAsync(context());
engine.reset();
assert.equal(await pending, null);
assert.equal(engine.actionHistory.length, 0);

const posteriorView = board(1);
const cells = [];
for (let row = 4; row <= 6; row++) {
    for (let col = 4; col <= 6; col++) {
        cells.push(row * 11 + col);
        posteriorView[row][col] = 0;
    }
}
posteriorView[5][5] = 2;
posteriorView[4][4] = 4;
const longPlacements = [];
for (const cell of cells) {
    if (cells.includes(cell + 1)) longPlacements.push([cell, cell + 1]);
    if (cells.includes(cell + 11)) longPlacements.push([cell, cell + 11]);
}
const exact = new Float64Array(121);
let configurations = 0;
for (const long of longPlacements) {
    for (const single of cells) {
        if (long.includes(single) || (!long.includes(60) && single !== 60)) continue;
        configurations++;
        for (const cell of [...long, single]) exact[cell]++;
    }
}
Math.random = mulberry32(20261024);
const posterior = new BeliefState([{ code: 'DD', len: 2, maxHp: 1 }, { code: 'SS', len: 1, maxHp: 2 }], posteriorView, 8192, { posterior: true, sampleFirstTurn: true }).getProbabilityGrid().flat();
for (const cell of cells) assert.ok(Math.abs(posterior[cell] - exact[cell] / configurations) < 0.035, '加权后验须接近可穷举的真实分布，疑似提议偏好不能冒充观测');

let pursuitContacts = 0;
for (const faction of ['us', 'ijn', 'rn', 'km', 'fn', 'rm', 'sn']) {
    Math.random = mulberry32(20261024);
    const simulation = new SimulationEngine({ faction, tuning: { ...getAITuning('HARD'), search: false } }, { faction: 'rm', tuning: { ...getAITuning('HARD'), search: false } });
    while (!simulation.finished) {
        const seat = simulation.currentSeat;
        const attacker = simulation.sides[seat];
        const defender = simulation.sides[seat === 'A' ? 'B' : 'A'];
        const current = simulation._decisionContext(attacker, defender);
        const previous = attacker.engine.actionHistory.at(-1);
        if (previous) previous.afterView = current.viewGrid.map(row => [...row]);
        const actualFleet = defender.ships.filter(ship => !ship.sunk).map(ship => ({
            ship,
            cells: Array.from({ length: ship.len }, (_, segment) => (ship.r + (ship.vertical ? segment : 0)) * 11 + ship.c + (ship.vertical ? 0 : segment))
        }));
        const search = new BeliefSearch(current, { getSampleFleets: () => [actualFleet], _sampleCount: 1 }, attacker.engine.actionHistory, attacker.engine.damageDealtGrid, getAITuning('HARD'));
        assert.equal(search.particles.length, 1, `${faction} 第 ${simulation.plies} 手的真实布局须满足公开历史`);
        const state = { models: [search.own, search.particles[0]], views: [Uint8Array.from(search.view), Uint8Array.from(search.opponentView)], dealt: [Float64Array.from(search.damageGrid), new Float64Array(121)] };
        const action = simulation.step();
        if (!action) break;
        search.play(state, 0, action);
        assert.deepEqual(Array.from(state.views[0]), attacker.view.flat(), `${faction} 第 ${simulation.plies} 手的预测视野须等于实际视野`);
        assert.deepEqual(Array.from(state.dealt[0]), attacker.engine.damageDealtGrid.flat(), `${faction} 第 ${simulation.plies} 手的推演伤害记账须等于实际决策器`);
        for (const predicted of state.models[1].ships) {
            const actual = defender.ships.find(ship => ship.code === predicted.code);
            assert.deepEqual(predicted.hp, actual.hp, `${faction} ${actual.code} 的预测血量须等于实际血量`);
        }
    }
    pursuitContacts += simulation.sides.A.stats.pursuitContacts + simulation.sides.B.stats.pursuitContacts;
}
assert.ok(pursuitContacts > 0, '逐手一致性验证须实际覆盖残局接触区刷新');

console.log('SEARCH SELFTEST OK');
