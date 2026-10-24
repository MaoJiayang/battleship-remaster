import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { encodePublicEvent, HISTORY_FEATURES } from '../../src/ai/neuralHistory.js';
import { deployFleet } from '../sim/layouts.mjs';

const game = new SimulationEngine('HARD', 'HARD', { recordPublicHistory: true, maxPlies: 2 });
assert.deepEqual(game._decisionContext(game.sides.A, game.sides.B).publicEvents, []);
game.step();
assert.equal(game.publicHistory.length, 1);
const saved = JSON.stringify(game.publicHistory[0]);
const own = encodePublicEvent(game.publicHistory[0], 'A');
const other = encodePublicEvent(game.publicHistory[0], 'B');
assert.equal(own.length, HISTORY_FEATURES);
assert.ok(own.every(Number.isFinite));
assert.equal(own[0], 1);
assert.equal(other[0], -1);
assert.deepEqual(own.slice(1), other.slice(1));
game.step();
assert.equal(JSON.stringify(game.publicHistory[0]), saved, '后续行动不能改写历史观测');
assert.equal(game.publicHistory.length, 2);
assert.equal(game.step(), null);
assert.equal(game.getResult().truncated, true);
assert.equal(game.getResult().terminated, false);
assert.equal(game.publicHistory.length, 2, '截断不能伪造行动');
const finisher = new SimulationEngine('HARD', 'HARD', {
    maxPlies: 1,
    fleetA: [{ code: 'DD', len: 1, maxHp: 1, r: 0, c: 0, v: false }],
    fleetB: [{ code: 'DD', len: 1, maxHp: 1, r: 4, c: 4, v: false }]
});
finisher.sides.A.engine.decide = () => ({ weapon: 'AP', r: 4, c: 4 });
finisher.step();
assert.equal(finisher.getResult().winner, 'A');
assert.equal(finisher.getResult().terminated, true, '手数上限的真实制胜仍须按终局处理');
assert.equal(finisher.getResult().truncated, false);
const input = [{ type: 'reset', games: 2, seed: 240124, maxPlies: 1 },
    { type: 'step', actions: [{ index: 0, action: null }, { index: 1, action: null }] }].map(value => JSON.stringify(value)).join('\n') + '\n';
const process = spawnSync(globalThis.process.execPath, [fileURLToPath(new URL('./policy-environment.mjs', import.meta.url))],
    { input, encoding: 'utf8', windowsHide: true });
assert.equal(process.status, 0, process.stderr);
const [reset, completed] = process.stdout.trim().split('\n').map(line => JSON.parse(line));
assert.equal(reset.observations.length, 2);
assert.ok(reset.observations.every(observation => observation.events.length === 0));
assert.deepEqual(reset.observations[0].planes, reset.observations[1].planes, '配对对局的起始舰队不同');
assert.deepEqual(reset.observations[0].globals, reset.observations[1].globals);
assert.equal(completed.observations.length, 0);
assert.equal(completed.results.length, 2);
assert.ok(completed.results.every(result => result.truncated && !result.terminated && result.winner === null));
assert.ok(completed.results.every(result => result.finalObservations.length === 2
    && result.finalObservations.every(observation => observation.events.length === 1)));
for (let attempt = 0; attempt < 100; attempt++) {
    const fleet = deployFleet('uniform');
    const cells = new Set();
    for (const ship of fleet) {
        for (let segment = 0; segment < ship.len; segment++) {
            const row = ship.r + (ship.v ? segment : 0);
            const col = ship.c + (ship.v ? 0 : segment);
            assert.ok(row >= 0 && row < 11 && col >= 0 && col < 11);
            const cell = row * 11 + col;
            assert.ok(!cells.has(cell), '联合均匀布阵出现舰体重叠');
            cells.add(cell);
        }
    }
    assert.equal(cells.size, 14);
}
console.log('POLICY SELFTEST OK');
