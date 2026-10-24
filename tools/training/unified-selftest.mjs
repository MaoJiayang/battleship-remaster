import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { DOCTRINES } from '../../src/data/doctrines.js';
import { FACTIONS, hashSeed, mulberry32 } from '../sim/core.mjs';
import { encodeGameUnifiedObservation, encodeGameUnifiedEvent } from '../../src/ai/unifiedAdapter.js';
import { encodeUnifiedObservation, encodeUnifiedEvent, unifiedAction, unifiedActionIndex, UNIFIED_VARIANT_FEATURES } from '../../src/ai/unifiedObservation.js';

const records = [];
const saved = Math.random;
try {
    for (let factionIndex = 0; factionIndex < FACTIONS.length; factionIndex++) {
        const faction = FACTIONS[factionIndex];
        Math.random = mulberry32(hashSeed(`unified-fixture|${faction}`));
        const game = new SimulationEngine({ faction }, { faction: FACTIONS[(factionIndex + 1) % 7] }, { recordPublicHistory: true });
        for (let turn = 0; turn < 4; turn++) {
            const side = game.sides[game.currentSeat];
            const context = game._decisionContext(side, game.sides[game.currentSeat === 'A' ? 'B' : 'A']);
            const previous = side.engine.actionHistory.at(-1);
            if (previous && !previous.afterView) previous.afterView = context.viewGrid.map(row => [...row]);
            const hiddenFields = ['r', 'c', 'hp', 'vertical', 'v'];
            context.myShips = context.myShips.map(ship => {
                const target = { id: ship.id, code: ship.code, len: ship.len, maxHp: ship.maxHp, sunk: ship.sunk };
                for (const field of hiddenFields) Object.defineProperty(target, field, { get() { throw new Error(`读取敌方隐藏字段：${field}`); } });
                return target;
            });
            const observation = encodeGameUnifiedObservation(context, { history: side.engine.actionHistory, damageGrid: side.engine.damageDealtGrid });
            assert.equal(observation.planes.length, 22 * 121);
            assert.equal(observation.mask.length, 3 * 121);
            assert.ok(observation.ships.every(ship => ship.length === 6));
            assert.ok(observation.weapons.every(weapon => weapon.variants.every(variant => variant.features.length === UNIFIED_VARIANT_FEATURES)));
            const history = game.publicHistory.map(event => encodeGameUnifiedEvent(event, game.currentSeat));
            for (let action = 0; action < observation.mask.length; action++) {
                assert.equal(unifiedActionIndex(unifiedAction(action, observation), observation), action);
            }
            const prior = { byLen: Object.fromEntries(context.myShips.map(ship => [ship.len, { cells: Array(121).fill(2), strength: 0.5 }])) };
            const personalized = encodeGameUnifiedObservation({ ...context, placementPrior: prior });
            assert.ok(personalized.planes[18 * 121] > 0);
            assert.equal(personalized.planes[19 * 121], 0.5);
            assert.equal(observation.planes[19 * 121], 0);
            if (turn === 0 && faction === 'us') {
                const old = DOCTRINES.us.he;
                try {
                    DOCTRINES.us.he = { ...old, requiresCV: false };
                    const independent = encodeGameUnifiedObservation(context);
                    assert.deepEqual(independent.weapons[1].features, observation.weapons[1].features);
                    assert.notDeepEqual(independent.weapons[1].variants, observation.weapons[1].variants,
                        '相同当前火力下，失去能力提供舰的后果必须进入参数输入');
                } finally { DOCTRINES.us.he = old; }
            }
            const executed = game.step();
            const action = unifiedActionIndex(executed, observation);
            assert.equal(observation.mask[action], 1);
            records.push({ observation, history, action, label: `${faction}/${turn}` });
        }
    }
} finally { Math.random = saved; }

for (const [height, width, weaponCount] of [[5, 7, 2], [8, 4, 4]]) {
    const cells = height * width;
    const weapons = Array.from({ length: weaponCount }, (_, index) => ({ id: `test-${index}`, kind: index % 2 ? 'information' : 'damage',
        available: true, offsets: [{ r: 0, c: 0, damage: index + 1 }, { r: 0, c: 1, damage: 1 }] }));
    const view = Array.from({ length: height }, () => Array(width).fill(0));
    const ownShips = [{ len: 3, maxHp: 4, hp: [4, 1, 0], r: 0, c: 0, vertical: false, sunk: false }];
    const legalActions = weapons.map(weapon => ({ weapon: weapon.id, r: height - 1, c: width - 1 }));
    const input = { height, width, rulesId: 'structural-test', viewGrid: view, ownViewGrid: view, ownShips,
        targetShips: [{ len: 5, maxHp: 7, sunk: false }], ownWeapons: weapons, opponentWeapons: [],
        posterior: new Float32Array(cells).fill(0.2), legalActions };
    const observation = encodeUnifiedObservation(input);
    assert.equal(observation.mask.length, cells * weaponCount);
    assert.equal(observation.mask.reduce((sum, value) => sum + value, 0), weaponCount);
    assert.equal(unifiedAction(observation.mask.length - 1, observation).c, width - 1);
    assert.throws(() => encodeUnifiedObservation({ ...input, posterior: new Float32Array(cells - 1) }), /概率/);
    const after = view.flat();
    after[0] = 2;
    const history = [encodeUnifiedEvent({ seat: 'A', action: { r: 0, c: 0 }, coverage: [{ r: 0, c: 0, damage: 3 }],
        kind: 'damage', before: view.flat(), after }, 'A', height, width)];
    assert.equal(history[0].length, 18 * cells);
    records.push({ observation, history, label: `shape-${height}x${width}` });
}

const requests = [{ type: 'reset', encoding: 'unified', games: 2, seed: 251026, maxPlies: 2, learnerSeats: ['A', 'B'] },
    ...Array.from({ length: 3 }, (_, ply) => ({ type: 'step', actions: (ply < 2 ? [0, 1] : [1]).map(index => ({ index, action: null })) }))];
const processResult = spawnSync(process.execPath, [fileURLToPath(new URL('./policy-environment.mjs', import.meta.url))], {
    input: requests.map(request => JSON.stringify(request)).join('\n') + '\n', encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024
});
assert.equal(processResult.status, 0, processResult.stderr);
const responses = processResult.stdout.trim().split('\n').map(line => JSON.parse(line));
assert.ok(responses.every(response => !response.error), processResult.stdout);
assert.ok(responses[0].observations.every(item => item.observation.schema === 'naval-grid-v1' && item.events.length === 0));
const results = responses.flatMap(response => response.results ?? []);
assert.equal(results.length, 2);
for (const result of results) {
    assert.equal(result.currentSeat, ['A', 'B'][result.index]);
    assert.ok(result.truncated && !result.terminated);
    assert.ok(result.finalObservations.every(item => item.observation.mask.some(Boolean)));
}

if (process.argv[2]) {
    const output = path.resolve(process.argv[2]);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(records, (_, value) => ArrayBuffer.isView(value) ? Array.from(value) : value));
}
console.log(`UNIFIED OBSERVATION SELFTEST OK: ${records.length} 公平局面，三种尺寸，变长武器及能力条件`);
