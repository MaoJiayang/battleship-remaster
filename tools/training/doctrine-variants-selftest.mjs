import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOCTRINES, createDoctrineVariant, getDoctrine, DOCTRINE_PARAMETER_RANGES } from '../../src/data/doctrines.js';
import { neuralRulesId } from '../../src/ai/neuralRules.js';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { encodeGameUnifiedObservation } from '../../src/ai/unifiedAdapter.js';
import { encodeNeuralObservation } from '../../src/ai/neuralObservation.js';
import { SHIP_TYPES } from '../../src/data/ships.js';
import { createDoctrineCatalog, validateDoctrineCatalog } from './doctrine-variants.mjs';

const before = JSON.stringify(DOCTRINES);
const originalRules = neuralRulesId();
const catalog = createDoctrineCatalog();
const families = validateDoctrineCatalog(JSON.parse(JSON.stringify(catalog)));
assert.equal(originalRules, '4bce9d7c');
assert.notEqual(catalog.rulesId, originalRules);
const own = SHIP_TYPES.map((ship, index) => ({ ...ship, r: index * 2, c: 0, vertical: false }));
const target = [{ code: 'BB', name: '测试舰', len: 1, maxHp: 8, r: 4, c: 4, vertical: false }];
const makeGame = (base, parameters, defender = 'us', defense) => new SimulationEngine({ faction: base,
    ...(parameters ? { doctrine: createDoctrineVariant(base, parameters) } : {}) }, { faction: defender,
    ...(defense ? { doctrine: createDoctrineVariant(defender, defense) } : {}) }, { fleetA: own, fleetB: target, recordPublicHistory: true });
const observe = game => encodeGameUnifiedObservation(game._decisionContext(game.sides.A, game.sides.B));
function execute(game, weapon, r = 4, c = 4) {
    const side = game.sides.A;
    side.engine.decide = () => side.engine.recordDecision({ weapon, r, c }, game._abilities(side, game.sides.B), side.view);
    return game.step();
}

for (const base of Object.keys(DOCTRINE_PARAMETER_RANGES)) {
    const regular = observe(makeGame(base));
    const anchor = observe(makeGame(base, {}));
    assert.equal(anchor.rulesId, catalog.rulesId);
    assert.deepEqual({ ...regular, rulesId: catalog.rulesId }, anchor, '原始参数的变体改变了实际能力编码');
    for (const variant of families[base]) {
        const game = makeGame(base, variant.parameters);
        const observation = observe(game);
        const serialized = JSON.parse(JSON.stringify(variant));
        assert.deepEqual(getDoctrine(serialized), getDoctrine(variant));
        assert.equal(observation.rulesId, catalog.rulesId);
        assert.ok(observation.weapons.every(weapon => weapon.features.every(Number.isFinite)));
        const context = game._decisionContext(game.sides.A, game.sides.B);
        assert.throws(() => encodeGameUnifiedObservation({ ...context, doctrineVariants: false }), /独立/);
        assert.throws(() => encodeNeuralObservation(context), /旧观测/);
        execute(game, 'AP');
        assert.ok(game.sides.A.stats.damage > 0);
    }
}

let game = makeGame('us', { 'ap.suspectBonus': 2 });
game.sides.A.view[4][4] = 4;
assert.equal(observe(game).weapons[0].offsets[0][3], 5 / 8);
execute(game, 'AP');
assert.equal(game.sides.A.stats.damage, 5);
for (const [base, parameters, weapon, damage] of [
    ['ijn', { 'he.centerDamage': 4 }, 'HE', 4],
    ['fn', { 'ap.quadDamage': 5 }, 'AP', 5],
    ['sn', { 'he.centerDamage': 3 }, 'HE', 3]
]) {
    game = makeGame(base, parameters);
    assert.equal(observe(game).weapons[weapon === 'AP' ? 0 : 1].offsets[0][2], damage / 8);
    execute(game, weapon);
    assert.equal(game.sides.A.stats.damage, damage);
}
game = makeGame('us', undefined, 'rm', { 'defense.apReduction': 2 });
assert.equal(observe(game).weapons[0].offsets[0][2], 1 / 8);
execute(game, 'AP');
assert.equal(game.sides.A.stats.damage, 1);
game = makeGame('rn', { 'sonar.radius': 2 });
assert.equal(observe(game).weapons[2].positions.length, 25);
execute(game, 'SONAR', 5, 5);
assert.equal(game.sides.A.view.flat().filter(state => state !== 0).length, 25);
game = new SimulationEngine({ faction: 'km', doctrine: createDoctrineVariant('km', { 'ap.sunkBonus': 2 }) }, { faction: 'us' },
    { fleetA: own, fleetB: [...target, { code: 'DD', name: '测试护航舰', len: 1, maxHp: 1, r: 10, c: 10 }] });
game.sides.B.ships[1].sunk = true;
game.sides.B.ships[1].hp[0] = 0;
assert.equal(observe(game).weapons[0].offsets[0][2], 5 / 8);
execute(game, 'AP');
assert.equal(game.sides.A.stats.damage, 5);

assert.throws(() => createDoctrineVariant('unknown'), /原型/);
for (const parameters of [{ 'ap.suspectBonus': 99 }, { 'ap.suspectBonus': 0.5 }, { 'sonar.radius': 2 }, { toString: 1 }]) {
    assert.throws(() => createDoctrineVariant('us', parameters), /参数/);
}
assert.throws(() => getDoctrine({ base: 'us', parameters: {} }), /协议/);
assert.throws(() => new SimulationEngine({ faction: 'rn', doctrine: createDoctrineVariant('us') }, {}), /原型/);
assert.throws(() => validateDoctrineCatalog({ ...catalog, rulesId: originalRules }), /规则/);
assert.throws(() => validateDoctrineCatalog({ ...catalog, variants: [...catalog.variants, catalog.variants[0]] }), /重复/);
assert.equal(JSON.stringify(DOCTRINES), before);
assert.equal(neuralRulesId(), originalRules);

const reset = { type: 'reset', encoding: 'unified', games: 14, seed: 251052, maxPlies: 2, doctrineCatalog: catalog };
const requests = [reset, reset, { ...reset, encoding: 'legacy' }, reset,
    { type: 'step', actions: Array.from({ length: 14 }, (_, index) => ({ index, action: null })) }];
const processResult = spawnSync(process.execPath, [fileURLToPath(new URL('./policy-environment.mjs', import.meta.url))], {
    input: requests.map(request => JSON.stringify(request)).join('\n') + '\n', encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024
});
assert.equal(processResult.status, 0, processResult.stderr);
const responses = processResult.stdout.trim().split('\n').map(line => JSON.parse(line));
assert.deepEqual(responses[0], responses[1], '变体采样未保持相同种子确定性');
assert.match(responses[2].error, /统一观测/);
assert.equal(responses[4].actions.length, 14);
assert.ok(responses[4].observations.every(item => item.observation.rulesId === catalog.rulesId && item.events.length === 1));
assert.ok(responses[0].configurations.some(config => config.doctrines.some(variant => Object.keys(variant.parameters).length)));
for (let index = 0; index < 14; index += 2) {
    assert.deepEqual(responses[0].configurations[index].doctrines, responses[0].configurations[index + 1].doctrines,
        '交换学习座位时，配对规则参数必须保持一致');
}
console.log(`DOCTRINE VARIANTS SELFTEST OK: ${catalog.variants.length} 参数描述，七原型锚点、真实结算、输入、规则隔离与确定性采样`);
