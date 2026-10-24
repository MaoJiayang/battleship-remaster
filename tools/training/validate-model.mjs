import fs from 'node:fs';
import assert from 'node:assert/strict';
import { NavalNeuralNetwork } from '../../src/ai/neuralNetwork.js';

const [, , modelPath, fixturesPath] = process.argv;
if (!modelPath || !fixturesPath) throw new Error('用法：node tools/training/validate-model.mjs <模型.json> <数值对照.json>');
const network = new NavalNeuralNetwork(JSON.parse(fs.readFileSync(modelPath, 'utf8')));
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
assert.ok(fixtures.length > 0, '没有数值对照局面');
let maximumError = 0;
for (const fixture of fixtures) {
    const prediction = network.predict(fixture.observation);
    maximumError = Math.max(maximumError, Math.abs(prediction.valueLogit - fixture.expected.valueLogit),
        ...prediction.logits.map((value, index) => Math.abs(value - fixture.expected.logits[index])));
    assert.ok(Number.isFinite(prediction.value) && prediction.value >= 0 && prediction.value <= 1, '胜率输出无效');
}
assert.ok(maximumError < 0.0001, `JavaScript 与 PyTorch 预测不一致：${maximumError}`);
for (let warmup = 0; warmup < 30; warmup++) network.predict(fixtures[warmup % fixtures.length].observation);
const times = [];
for (let iteration = 0; iteration < 300; iteration++) {
    const started = performance.now();
    network.predict(fixtures[iteration % fixtures.length].observation);
    times.push(performance.now() - started);
}
times.sort((left, right) => left - right);
console.log(JSON.stringify({ maximumError, fixtures: fixtures.length, p50Ms: times[150], p95Ms: times[285], architecture: network.metadata.architecture,
    parameters: Object.values(network.layers).reduce((total, layer) => total + layer.weight.length + layer.bias.length, 0) }));
