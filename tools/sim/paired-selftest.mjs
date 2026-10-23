import assert from 'node:assert/strict';
import { PairedEvidence, scenarioRandom } from '../../src/ai/pairedEvidence.js';
import { AIDecisionEngine } from '../../src/ai/aiStrategy.js';
import { BeliefState } from '../../src/ai/aiCore.js';
import { BeliefSearch } from '../../src/ai/beliefSearch.js';
import { getAITuning } from '../../src/ai/aiTuning.js';
import { approximatePosterior, activeSensorRegions } from '../../src/ai/rolloutBelief.js';

const neutral = new PairedEvidence();
for (let sample = 0; sample < 1000; sample++) neutral.observe(sample % 2, sample % 2);
assert.equal(neutral.logEvidence, 0);
assert.equal(neutral.accepted, false);
const positive = new PairedEvidence();
const negative = new PairedEvidence();
for (let sample = 0; sample < 7; sample++) {
    positive.observe(1, 0);
    negative.observe(0, 1);
}
assert.ok(positive.accepted);
assert.ok(negative.rejected);
assert.equal(negative.accepted, false);

let falseAccepts = 0;
for (let sequence = 0; sequence < 4096; sequence++) {
    const evidence = new PairedEvidence();
    for (let sample = 0; sample < 12; sample++) {
        const win = (sequence >>> sample) & 1;
        evidence.observe(win, 1 - win);
        if (evidence.accepted) { falseAccepts++; break; }
    }
}
assert.ok(falseAccepts / 4096 <= 0.05, '无真实优势时，允许提前停止的误接受率须受控');

const sensorView = new Uint8Array(121);
sensorView[60] = 1;
const region = [48, 49, 50, 59, 61, 70, 71, 72];
for (const cell of region) sensorView[cell] = 4;
const sensorTargets = [{ code: 'SS', len: 1, maxHp: 2 }];
const probabilities = approximatePosterior(sensorTargets, sensorView, [region]);
for (let cell = 0; cell < 121; cell++) assert.ok(Math.abs(probabilities[cell] - (region.includes(cell) ? 0.125 : 0)) < 1e-12, '单舰水听阳性且中心未中时，后验须集中到其余八格');
assert.deepEqual(approximatePosterior(sensorTargets, sensorView, [region, region]), probabilities, '重复的相同观测不能重复增加证据');
sensorView[48] = 2;
assert.equal(activeSensorRegions([region], sensorView).length, 0, '观测已经由后续接触解释时不能继续要求另一个目标');

const view = Array.from({ length: 11 }, () => Array(11).fill(1));
view[5][5] = 2;
view[8][8] = 0;
const opponentView = Array.from({ length: 11 }, () => Array(11).fill(1));
opponentView[0][0] = 2;
const targets = [{ id: 0, code: 'SS', len: 1, maxHp: 2, sunk: false }];
const tuning = { ...getAITuning('HARD'), searchIterations: 512, sampleCount: 128, searchFixedIterations: true };
const context = { viewGrid: view, playerViewGrid: opponentView, myShips: targets,
    enemyShips: [{ id: 0, code: 'SS', len: 1, maxHp: 2, hp: [1], sunk: false, r: 0, c: 0 }],
    aiFaction: 'us', playerFaction: 'us', difficultyConfig: { level: 'HARD', alpha: 0.84, randomness: 0, riskAwareness: 0.46, tuning } };
const baseline = { weapon: 'AP', r: 8, c: 8 };
const factory = () => {
    const engine = new AIDecisionEngine();
    engine.decide = () => baseline;
    return engine;
};
Math.random = scenarioRandom(20261024);
const belief = new BeliefState(targets, view, 128, { posterior: true, sampleFirstTurn: true });
const search = new BeliefSearch(context, belief, [], view.map(row => row.map(() => 0)), tuning, factory);
assert.deepEqual(search.decision().action, baseline, '证据不足时保留基准行动');
const scenario = search.makeScenario();
const savedRandom = Math.random;
assert.equal(search.evaluateScenario(baseline, scenario), search.evaluateScenario(baseline, scenario), '相同场景与行动须得到完全一致的终局结果');
assert.equal(Math.random, savedRandom, '场景内随机数须与外部随机源隔离');
while (!search.finished) search.advance(8);
assert.deepEqual(search.decision().action, { weapon: 'AP', r: 5, c: 5 });
assert.equal(search.decision().improved, true, '独立复核支持明显制胜行动时须允许替换基准');

const stopped = new BeliefSearch(context, belief, [], view.map(row => row.map(() => 0)), tuning, factory);
stopped.setDeadline(-1);
stopped.advance(8);
assert.equal(stopped.decision().stopReason, 'time');
assert.deepEqual(stopped.decision().action, baseline, '预算耗尽时不能采纳未经复核的候选');

Math.random = scenarioRandom(11);
const legacyAction = new AIDecisionEngine().decide({ ...context, difficultyConfig: { ...context.difficultyConfig, tuning: { ...tuning, search: false } } });
Math.random = scenarioRandom(11);
const timedEngine = new AIDecisionEngine();
const timedAction = timedEngine.decide({ ...context, difficultyConfig: { ...context.difficultyConfig,
    tuning: { ...tuning, search: true, searchFixedIterations: false, searchTimeMs: 0 } } });
assert.deepEqual(timedAction, legacyAction, '初始化阶段预算耗尽也须直接返回原基准行动');
assert.equal(timedEngine.lastDecisionStats.iterations, 0);
assert.equal(timedEngine.lastDecisionStats.stopReason, 'time');
Math.random = scenarioRandom(11);
const asyncTimed = await new AIDecisionEngine().decideAsync({ ...context, difficultyConfig: { ...context.difficultyConfig,
    tuning: { ...tuning, searchTimeMs: 0 } } });
assert.deepEqual(asyncTimed, legacyAction, '异步入口使用相同的超时返回规则');
const expiredBelief = new BeliefState(targets, view, 128, { posterior: true, sampleFirstTurn: true, deadline: -1 });
assert.equal(expiredBelief.getSampleFleets().length, 0, '过期的推断任务须停止产生新样本');
const unavailable = new BeliefSearch(context, { _sampleCount: 0, getSampleFleets: () => [] }, [], view.map(row => row.map(() => 0)), tuning, factory, baseline);
assert.deepEqual(unavailable.decision().action, baseline, '推断无可用模型时保留已经算好的基准，避免重复随机决策');
assert.equal(unavailable.decision().inferenceFallback, true);
console.log(`PAIRED SELFTEST OK: 零优势提前停止误接受率 ${falseAccepts / 4096}`);
