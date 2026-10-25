import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { UnifiedNeuralNetwork } from '../../src/ai/unifiedNetwork.js';

const root = process.argv[2];
if (!root) throw new Error('用法：node tools/training/unified-parity.mjs <对照目录>');
const reports = [];
function difference(first, second) {
    assert.equal(first.length, second.length);
    return Math.max(0, ...Array.from(first, (value, index) => Math.abs(value - second[index])));
}
function close(first, second) {
    assert.equal(first.length, second.length);
    assert.ok(Array.from(first, (value, index) => Number.isFinite(value) && Number.isFinite(second[index])
        && Math.abs(value - second[index]) <= 1e-5 + 1.3e-6 * Math.abs(second[index])).every(Boolean), '单精度数值对照不一致');
}
function probabilities(logits, mask) {
    const legal = Array.from(logits).filter((_, index) => mask[index]);
    assert.ok(legal.length, '数值对照缺少合法行动');
    const maximum = Math.max(...legal);
    const weights = legal.map(value => Math.exp(value - maximum));
    const total = weights.reduce((sum, value) => sum + value, 0);
    return weights.map(value => value / total);
}
close([-100, 0], [-100.0001, 0.000001]);
assert.throws(() => close([-100, 0], [-100.01, 0.000001]), /单精度/);
assert.throws(() => close([0], [0.00002]), /单精度/);
assert.throws(() => close([NaN], [0]), /单精度/);
for (const kind of ['gru', 'attention']) {
    const model = JSON.parse(fs.readFileSync(path.join(root, `${kind}.json`)));
    const network = new UnifiedNeuralNetwork(model);
    const fixtures = JSON.parse(fs.readFileSync(path.join(root, `${kind}-parity.json`)));
    let error = 0;
    let permutationError = 0;
    let probabilityError = 0;
    for (const fixture of fixtures) {
        const observation = fixture.observation;
        const actual = network.predict(observation, fixture.history);
        error = Math.max(error, difference(actual.logits, fixture.expected.logits), Math.abs(actual.valueLogit - fixture.expected.valueLogit));
        close([...actual.logits, actual.valueLogit], [...fixture.expected.logits, fixture.expected.valueLogit]);
        const actualProbabilities = probabilities(actual.logits, observation.mask);
        const expectedProbabilities = probabilities(fixture.expected.logits, observation.mask);
        const currentProbabilityError = difference(actualProbabilities, expectedProbabilities);
        probabilityError = Math.max(probabilityError, currentProbabilityError, Math.abs(actual.value - fixture.expected.value));
        assert.ok(currentProbabilityError < 1e-5 && Math.abs(actual.value - fixture.expected.value) < 1e-5, '策略或胜率概率不一致');
        const boundary = Math.floor(fixture.history.length / 2);
        const prefix = network.predict(observation, fixture.history.slice(0, boundary));
        const incremental = network.predict(observation, fixture.history.slice(boundary), prefix.state);
        assert.ok(difference(actual.logits, incremental.logits) < 1e-6, '完整与增量空间历史不一致');
        assert.ok(Math.abs(actual.valueLogit - incremental.valueLogit) < 1e-6);
        const own = observation.actionWeapons.length;
        const reversed = { ...observation, ships: [...observation.ships].reverse(), actionWeapons: [...observation.actionWeapons].reverse(),
            weapons: [...observation.weapons.slice(0, own).reverse(), ...observation.weapons.slice(own).reverse()].map(weapon => ({ ...weapon,
                offsets: [...weapon.offsets].reverse(), positions: [...weapon.positions].reverse(), variants: [...weapon.variants].reverse() })) };
        const permuted = network.predict(reversed, fixture.history);
        const cells = observation.height * observation.width;
        const reordered = new Float32Array(actual.logits.length);
        for (let weapon = 0; weapon < own; weapon++) reordered.set(permuted.logits.subarray((own - weapon - 1) * cells, (own - weapon) * cells), weapon * cells);
        permutationError = Math.max(permutationError, difference(actual.logits, reordered), Math.abs(actual.valueLogit - permuted.valueLogit));
        close([...reordered, permuted.valueLogit], [...actual.logits, actual.valueLogit]);
        assert.throws(() => network.predict({ ...observation, rulesId: 'not-validated' }), /不兼容/);
    }
    const fixture = fixtures.find(item => item.history.length >= 2 && item.observation.height === 11);
    for (let warmup = 0; warmup < 10; warmup++) network.predict(fixture.observation, fixture.history);
    const times = [];
    for (let iteration = 0; iteration < 50; iteration++) {
        const start = performance.now();
        network.predict(fixture.observation, fixture.history);
        times.push(performance.now() - start);
    }
    times.sort((first, second) => first - second);
    reports.push({ kind, cases: fixtures.length, error, permutationError, probabilityError,
        networkFullHistoryMedianMs: times[25], networkFullHistoryP95Ms: times[47] });
}
fs.writeFileSync(path.join(root, 'javascript-report.json'), JSON.stringify({ node: process.version,
    tolerance: { absolute: 1e-5, relative: 1.3e-6, probabilityAbsolute: 1e-5 }, reports }, null, 2));
console.log(JSON.stringify(reports));
