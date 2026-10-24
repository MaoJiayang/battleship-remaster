import assert from 'node:assert/strict';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { DOCTRINES } from '../../src/data/doctrines.js';
import { getAITuning } from '../../src/ai/aiTuning.js';
import { encodeNeuralObservation, neuralRulesId, neuralActionIndex } from '../../src/ai/neuralObservation.js';
import { mulberry32 } from '../sim/core.mjs';

const game = new SimulationEngine('HARD', 'HARD');
const context = game._decisionContext(game.sides.A, game.sides.B);
const original = encodeNeuralObservation(context);
assert.equal(original.globals.length, 86);
assert.ok([...original.planes, ...original.globals].every(Number.isFinite));
const guarded = { ...context, myShips: context.myShips.map(ship => Object.defineProperties({ ...ship }, {
    r: { get() { throw new Error('读取了真实敌舰位置'); } },
    c: { get() { throw new Error('读取了真实敌舰位置'); } },
    hp: { get() { throw new Error('读取了真实敌舰血量'); } }
})) };
assert.deepEqual(encodeNeuralObservation(guarded), original);
const bias = DOCTRINES.us.ai.weaponBias.AP;
try {
    DOCTRINES.us.ai.weaponBias.AP = 999;
    assert.deepEqual(encodeNeuralObservation(context), original, '行为偏好不能作为规则输入');
} finally { DOCTRINES.us.ai.weaponBias.AP = bias; }
const mechanic = DOCTRINES.us.ap.suspectBonus;
try {
    DOCTRINES.us.ap.suspectBonus++;
    assert.notEqual(neuralRulesId(), original.rulesId, '机制变动需要使旧模型版本失效');
    assert.notDeepEqual(encodeNeuralObservation(context).globals, original.globals);
} finally { DOCTRINES.us.ap.suspectBonus = mechanic; }
let calls = 0;
game.sides.A.engine.neuralModel = { metadata: { policyTrained: false }, predict(observation) {
    calls++;
    assert.ok([...observation.planes, ...observation.globals].every(Number.isFinite));
    return { value: 0.5, logits: new Float32Array(363) };
} };
game.sides.A.config.tuning = { ...getAITuning('HARD'), search: true, pairedSearch: false,
    searchFixedIterations: true, searchIterations: 8, modelSamples: 8, sampleCount: 96 };
const action = game.step();
assert.ok(calls > 0, '搜索没有调用叶节点网络');
assert.ok(original.mask[neuralActionIndex(action)], '搜索选中了非法行动');
const policy = game.sides.A.engine.lastTrainingPolicy;
assert.ok(policy && Math.abs(policy.reduce((sum, value) => sum + value, 0) - 1) < 0.00001);
assert.ok(policy.every((value, index) => Number.isFinite(value) && value >= 0 && (!value || original.mask[index])));
game.sides.A.engine.reset();
assert.equal(game.sides.A.engine.lastTrainingPolicy, null);
function valueOnlyDecision(policyTrained) {
    const saved = Math.random;
    try {
        Math.random = mulberry32(240124);
        const comparison = new SimulationEngine('HARD', 'HARD');
        comparison.sides.A.engine.neuralModel = {
            metadata: { policyTrained },
            predict() { return { value: 0.5, logits: Float32Array.from({ length: 363 }, (_, index) => policyTrained ? index : 0) }; }
        };
        comparison.sides.A.config.tuning = { ...game.sides.A.config.tuning, neuralPolicy: false };
        return { action: comparison.step(), policy: comparison.sides.A.engine.lastTrainingPolicy };
    } finally { Math.random = saved; }
}
assert.deepEqual(valueOnlyDecision(true), valueOnlyDecision(false), '关闭策略头后选招不能受其逻辑值影响');
const limitedGame = new SimulationEngine('HARD', 'HARD');
limitedGame.sides.A.engine.neuralModel = game.sides.A.engine.neuralModel;
const limitedContext = limitedGame._decisionContext(limitedGame.sides.A, limitedGame.sides.B);
const limited = limitedGame.sides.A.engine.createSearch(limitedContext, game.sides.A.config.tuning);
limited.setDeadline(-Infinity);
limited.advance(1);
assert.ok(encodeNeuralObservation(limitedContext).mask[neuralActionIndex(limited.decision().action)], '零次推演的超时退路必须合法');
assert.equal(limited.trainingPolicy(), null, '没有推演证据时不能伪造训练策略');
for (const milliseconds of [0, 0.01, 0.1, 1, 4, 16]) {
    const timedGame = new SimulationEngine('HARD', 'HARD');
    timedGame.sides.A.engine.neuralModel = game.sides.A.engine.neuralModel;
    timedGame.sides.A.config.tuning = { ...game.sides.A.config.tuning,
        searchFixedIterations: false, searchTimeMs: milliseconds };
    const timedContext = timedGame._decisionContext(timedGame.sides.A, timedGame.sides.B);
    const timedObservation = encodeNeuralObservation(timedContext);
    const timedAction = timedGame.step();
    assert.ok(timedObservation.mask[neuralActionIndex(timedAction)], '极短预算下也必须返回合法行动');
}
const lateGame = new SimulationEngine('HARD', 'HARD');
while (!lateGame.finished && !Object.values(lateGame.sides).some(side => side.ships.some(ship => ship.sunk))) lateGame.step();
if (!lateGame.finished) {
    const seat = lateGame.currentSeat;
    lateGame.sides[seat].engine.neuralModel = { ...game.sides.A.engine.neuralModel, metadata: { policyTrained: true } };
    lateGame.sides[seat].config.tuning = { ...game.sides.A.config.tuning, searchIterations: 4, trainingTemperature: 1 };
    const lateContext = lateGame._decisionContext(lateGame.sides[seat], lateGame.sides[seat === 'A' ? 'B' : 'A']);
    const observation = encodeNeuralObservation(lateContext, { sonarHistory: lateGame.sides[seat].engine.sonarHistory });
    const lateAction = lateGame.step();
    assert.ok(observation.mask[neuralActionIndex(lateAction)], '带沉没历史的网络搜索选中了非法行动');
}
console.log('NEURAL SELFTEST OK');
