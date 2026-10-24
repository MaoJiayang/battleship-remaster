import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MemoryNeuralNetwork } from '../../src/ai/memoryNetwork.js';

const [, , modelPath, parityPath] = process.argv;
if (!modelPath || !parityPath) throw new Error('用法：node tools/training/validate-memory.mjs <模型.json> <数值对照.json>');
const model = new MemoryNeuralNetwork(JSON.parse(fs.readFileSync(modelPath, 'utf8')));
const fixtures = JSON.parse(fs.readFileSync(parityPath, 'utf8'));
assert.ok(fixtures.length > 0);
let maximumError = 0;
for (const fixture of fixtures) {
    const prediction = model.predict(fixture.observation, fixture.events);
    maximumError = Math.max(maximumError, Math.abs(prediction.valueLogit - fixture.expected.valueLogit),
        ...prediction.logits.map((value, index) => Math.abs(value - fixture.expected.logits[index])));
    let state = model.initialState();
    for (let offset = 0; offset < fixture.events.length; offset += 3) state = model.predict(fixture.observation, fixture.events.slice(offset, offset + 3), state).state;
    const incremental = model.predict(fixture.observation, [], state);
    assert.ok(Math.abs(incremental.value - prediction.value) < 0.00001, '增量历史与完整历史价值不一致');
    assert.ok(incremental.logits.every((value, index) => Math.abs(value - prediction.logits[index]) < 0.00001), '增量历史与完整历史策略不一致');
    assert.equal(state.count, fixture.events.length);
    assert.ok(Number.isFinite(prediction.value) && prediction.logits.every(Number.isFinite));
}
assert.ok(maximumError < 0.0001, `历史模型跨语言误差过大：${maximumError}`);
const times = [];
for (let iteration = 0; iteration < 330; iteration++) {
    const fixture = fixtures[iteration % fixtures.length];
    const state = model.predict(fixture.observation, fixture.events.slice(0, -1)).state;
    const started = performance.now();
    model.predict(fixture.observation, fixture.events.slice(-1), state);
    if (iteration >= 30) times.push(performance.now() - started);
}
times.sort((left, right) => left - right);
console.log(JSON.stringify({ memoryKind: model.metadata.memoryKind, maximumError, fixtures: fixtures.length,
    p50Ms: times[150], p95Ms: times[285], parameters: [...Object.values(model.layers), ...Object.values(model.base.layers)]
        .reduce((total, layer) => total + layer.weight.length + layer.bias.length, 0) }));
