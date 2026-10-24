import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { UnifiedNeuralNetwork } from '../../src/ai/unifiedNetwork.js';
import { DirectNeuralPolicy } from '../../src/ai/directPolicy.js';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { mulberry32, hashSeed } from '../sim/core.mjs';

const root = process.argv[2];
if (!root) throw new Error('用法：node tools/training/unified-runtime-selftest.mjs <显卡自测输出目录>');
const reports = [];
const saved = Math.random;
try {
    for (const kind of ['gru', 'attention']) {
        const model = JSON.parse(fs.readFileSync(path.join(root, `${kind}.json`)));
        const network = new UnifiedNeuralNetwork(model);
        const times = [];
        const encodingTimes = [];
        let truncated = 0;
        const plies = [];
        for (const [faction, opponent] of [['us', 'sn'], ['ijn', 'rn']]) {
            Math.random = mulberry32(hashSeed(`unified-runtime|${kind}|${faction}`));
            const game = new SimulationEngine({ faction }, { faction: opponent }, { recordPublicHistory: true, maxPlies: 320 });
            for (const side of Object.values(game.sides)) {
                side.engine.directPolicy = new DirectNeuralPolicy(network);
                const decide = side.engine.decide;
                side.engine.decide = function(context) {
                    const started = performance.now();
                    const action = decide.call(this, context);
                    times.push(performance.now() - started);
                    encodingTimes.push(this.lastDecisionStats.encodingMs);
                    return action;
                };
            }
            while (!game.finished) {
                const side = game.sides[game.currentSeat];
                const before = game.plies;
                game.step();
                if (before === game.plies) continue;
                assert.equal(side.engine.lastDecisionStats.direct, true);
            }
            const result = game.getResult();
            truncated += Number(result.truncated);
            plies.push(result.plies);
            const policy = game.sides.A.engine.directPolicy;
            assert.ok(policy.cursor > 0);
            policy.reset();
            assert.equal(policy.cursor, 0);
            assert.equal(policy.memory, null);
        }
        times.sort((first, second) => first - second);
        encodingTimes.sort((first, second) => first - second);
        reports.push({ kind, decisions: times.length, plies, truncated,
            fullDecisionMedianMs: times[Math.floor(times.length / 2)], fullDecisionP95Ms: times[Math.floor(times.length * 0.95)],
            encodingMedianMs: encodingTimes[Math.floor(times.length / 2)] });
    }
} finally { Math.random = saved; }
fs.writeFileSync(path.join(root, 'runtime-report.json'), JSON.stringify({ node: process.version, reports,
    scope: '仅验证真实整局合法行动、历史恢复及CPU成本，梯度检查权重不作棋力结论' }, null, 2));
console.log(JSON.stringify(reports));
