import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { DirectNeuralPolicy } from '../../src/ai/directPolicy.js';
import { MemoryNeuralNetwork } from '../../src/ai/memoryNetwork.js';
import { UnifiedNeuralNetwork } from '../../src/ai/unifiedNetwork.js';
import { PreviewDecisionHistory, PreviewPolicyRuntime } from '../../src/ai/previewPolicyRuntime.js';
import { mulberry32 } from '../sim/core.mjs';
import { beginMatch, abandonMatch } from '../../src/game/matchRecorder.js';

const filename = process.env.NAVAL_PREVIEW_MODEL;
assert.ok(filename, '请通过 NAVAL_PREVIEW_MODEL 指定体验模型');
const model = JSON.parse(fs.readFileSync(filename, 'utf8'));
const Network = model.format === 'naval-unified-v1' ? UnifiedNeuralNetwork : MemoryNeuralNetwork;
Math.random = mulberry32(641235);
for (const firstSeat of ['A', 'B']) {
    for (const faction of ['us', 'ijn', 'rn', 'km', 'fn', 'rm', 'sn']) {
        const history = new PreviewDecisionHistory();
        const runtime = new PreviewPolicyRuntime(model);
        const fallback = new PreviewPolicyRuntime(model);
        const game = new SimulationEngine({ level: 'HARD', faction: 'rn' }, { level: 'HARD', faction }, {
            firstSeat, maxPlies: 40, recordPublicHistory: true
        });
        const reference = game.sides.B.engine;
        reference.directPolicy = new DirectNeuralPolicy(new Network(model));
        while (!game.finished && game.plies < game.maxPlies) {
            const seat = game.currentSeat;
            const attacker = game.sides[seat];
            const defender = game.sides[seat === 'A' ? 'B' : 'A'];
            const context = game._decisionContext(attacker, defender);
            const original = attacker.engine.decide.bind(attacker.engine);
            let action;
            if (seat === 'B') {
                const previewContext = structuredClone({ ...context, ...history.context(context.viewGrid) });
                action = await runtime.decide(previewContext);
                assert.deepEqual(action, original(context), '实机接入与模拟直接策略的走棋不同');
                fallback.reset();
                assert.deepEqual(await fallback.decide(previewContext), action, '后台线程失效后的主线程恢复走棋不同');
                assert.equal(runtime.policy.memory.count, game.publicHistory.length);
                attacker.engine.decide = () => action;
            }
            const before = context.viewGrid.map(row => [...row]);
            const shipsBefore = structuredClone(attacker.ships);
            const targetsBefore = structuredClone(defender.ships);
            action = game.step();
            attacker.engine.decide = original;
            if (!action) break;
            const snapshot = history.capture(seat === 'B' ? 'ai' : 'player', action, before,
                shipsBefore, targetsBefore, attacker.faction, defender.faction);
            const event = game.publicHistory.at(-1);
            history.complete(snapshot, Array.from({ length: 11 }, (_, row) => event.after.slice(row * 11, row * 11 + 11)));
            assert.deepEqual({ ...history.events.at(-1), seat }, event, '实机历史与模拟历史不一致');
        }
        runtime.reset();
        history.reset();
        assert.equal(history.context().publicEvents.length, 0);
        assert.equal(runtime.policy.cursor, 0);
        assert.equal(runtime.engine.actionHistory.length, 0);
    }
}
const privacyGame = new SimulationEngine('HARD', 'HARD');
const privacyContext = privacyGame._decisionContext(privacyGame.sides.A, privacyGame.sides.B);
privacyContext.myShips = privacyContext.myShips.map(ship => new Proxy(ship, {
    get(target, key) {
        assert.ok(!['r', 'c', 'hp', 'v', 'vertical'].includes(key), `读取了敌舰隐藏字段：${key}`);
        return Reflect.get(target, key);
    }
}));
Object.assign(privacyContext, new PreviewDecisionHistory().context());
const privacyRuntime = new PreviewPolicyRuntime(model);
let predictions = 0;
const predict = privacyRuntime.policy.network.predict.bind(privacyRuntime.policy.network);
privacyRuntime.policy.network.predict = (...arguments_) => { predictions++; return predict(...arguments_); };
await privacyRuntime.decide({ ...privacyContext, difficultyConfig: { ...privacyContext.difficultyConfig, level: 'NORMAL',
    tuning: { ...privacyContext.difficultyConfig.tuning, sampleCount: 16, search: false } } });
assert.equal(predictions, 0, '中等难度不能启用体验模型');
await privacyRuntime.decide(privacyContext);
assert.equal(predictions, 1, '困难难度须实际调用体验模型');
const metadata = { kind: 'gru', iteration: 48, sha256: 'test-hash' };
const recorded = beginMatch({ playerFaction: 'us', enemyFaction: 'sn', level: 'HARD', playerShips: [], aiPolicy: metadata });
assert.deepEqual(recorded.aiPolicy, metadata, '对局记录须保留体验模型来源');
abandonMatch();
assert.equal(Object.hasOwn(beginMatch({ playerFaction: 'us', enemyFaction: 'sn', level: 'HARD', playerShips: [] }), 'aiPolicy'), false);
abandonMatch();
console.log('PREVIEW SELFTEST OK');
