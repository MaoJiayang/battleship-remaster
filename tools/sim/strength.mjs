import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { deployFleet } from './layouts.mjs';
import { getAITuning } from '../../src/ai/aiTuning.js';
import { DIFFICULTY_SETTINGS } from '../../src/data/difficulties.js';
import { NavalNeuralNetwork } from '../../src/ai/neuralNetwork.js';
import { MemoryNeuralNetwork } from '../../src/ai/memoryNetwork.js';
import { DirectNeuralPolicy } from '../../src/ai/directPolicy.js';
import { FACTIONS, mulberry32, hashSeed, boundedMeanInterval } from './core.mjs';

const [, , specPath, outputPath, shardArg, workersArg] = process.argv;
if (!specPath || !outputPath) {
    console.error('用法: node tools/sim/strength.mjs <配置.json> <输出.json>');
    process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const factions = spec.factions || FACTIONS;
const pairs = spec.pairs ?? 50;
const seedOffset = spec.seedOffset ?? 0;
const candidate = { level: 'HARD', ...DIFFICULTY_SETTINGS.HARD, ...spec.candidate, tuning: { ...getAITuning('HARD'), search: true, fastSampling: true, searchFixedIterations: true, ...spec.candidate?.tuning } };
const opponent = { level: 'HARD', ...DIFFICULTY_SETTINGS.HARD, ...spec.opponent, tuning: { ...getAITuning('HARD'), search: false, fastSampling: false, ...spec.opponent?.tuning } };
const modelSources = Object.fromEntries(['candidate', 'opponent'].map(role => {
    const filename = spec[role]?.model;
    return [role, filename ? fs.readFileSync(path.resolve(path.dirname(specPath), filename), 'utf8') : null];
}));
const models = Object.fromEntries(Object.entries(modelSources).map(([role, source]) => {
    const model = source ? JSON.parse(source) : null;
    if (spec[role]?.direct && !model) throw new Error('直接策略必须指定模型');
    if (model?.format === 'naval-memory-v1' && !spec[role]?.direct) throw new Error('历史模型需要显式 direct=true');
    return [role, model ? (model.format === 'naval-memory-v1' ? new MemoryNeuralNetwork(model) : new NavalNeuralNetwork(model)) : null];
}));

function makeFleet(seed) {
    const saved = Math.random;
    try {
        Math.random = mulberry32(seed);
        return deployFleet(spec.layout || 'spread');
    } finally {
        Math.random = saved;
    }
}

if (shardArg !== undefined) {
    try { os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
    const shard = Number(shardArg);
    const workers = Number(workersArg);
    const rows = [];
    for (let task = shard; task < factions.length * pairs * 2; task += workers) {
        const group = Math.floor(task / 2);
        const faction = factions[Math.floor(group / pairs)];
        const pair = group % pairs;
        const seed = hashSeed(`strength|${faction}|${seedOffset}|${pair}`);
        const fleetA = makeFleet(seed);
        const fleetB = spec.sameFleet ? fleetA : makeFleet(seed ^ 0x9E3779B9);
        const seat = task % 2 === 0 ? 'A' : 'B';
        const saved = Math.random;
        const elapsed = [];
        const phaseTimings = [];
        let inferenceFallbacks = 0;
        let searchCalls = 0;
        let improvedDecisions = 0;
        let validationSamples = 0;
        let timeStops = 0;
        let result;
        try {
            Math.random = mulberry32(hashSeed(`strength|${seed}|${seat}`));
            const engine = new SimulationEngine(
                { ...(seat === 'A' ? candidate : opponent), faction },
                { ...(seat === 'B' ? candidate : opponent), faction },
                { fleetA, fleetB, maxPlies: spec.maxPlies ?? 320, recordPublicHistory: !!spec.candidate?.direct || !!spec.opponent?.direct }
            );
            for (const [role, side] of [['candidate', seat], ['opponent', seat === 'A' ? 'B' : 'A']]) {
                if (spec[role]?.direct) engine.sides[side].engine.directPolicy = new DirectNeuralPolicy(models[role], !!spec[role].stochastic);
                else engine.sides[side].engine.neuralModel = models[role];
            }
            while (!engine.finished) {
                const measure = engine.currentSeat === seat;
                const start = performance.now();
                Math.random = mulberry32(hashSeed(`strength-turn|${seed}|${engine.currentSeat}|${engine.plies}`));
                engine.step();
                if (measure) {
                    elapsed.push(performance.now() - start);
                    const stats = engine.sides[seat].engine.lastDecisionStats;
                    phaseTimings.push([stats?.baselineMs || 0, stats?.inferenceMs || 0, stats?.validationInferenceMs || 0]);
                    if (engine.sides[seat].engine.lastDecisionStats?.inferenceFallback) inferenceFallbacks++;
                    if (engine.sides[seat].engine.lastDecisionStats?.iterations > 0) searchCalls++;
                    if (engine.sides[seat].engine.lastDecisionStats?.improved) improvedDecisions++;
                    validationSamples += engine.sides[seat].engine.lastDecisionStats?.validationSamples || 0;
                    if (engine.sides[seat].engine.lastDecisionStats?.stopReason === 'time') timeStops++;
                }
            }
            result = engine.getResult();
        } finally {
            Math.random = saved;
        }
        rows.push({ faction, pair, seed, seat, winner: result.winner, truncated: result.truncated, plies: result.plies,
            candidateStats: result[seat].stats, opponentStats: result[seat === 'A' ? 'B' : 'A'].stats, decisionMs: elapsed,
            inferenceFallbacks, searchCalls, improvedDecisions, validationSamples, timeStops, phaseTimings });
    }
    fs.writeFileSync(outputPath, JSON.stringify({ rows }), 'utf8');
} else {
    const workers = Math.min(factions.length * pairs * 2, Math.max(1, spec.jobs ?? 8));
    const output = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const started = Date.now();
    const script = fileURLToPath(import.meta.url);
    const shards = await Promise.all(Array.from({ length: workers }, (_, shard) => new Promise((resolve, reject) => {
        const shardPath = output.replace(/\.json$/i, '') + `-shard${shard}.json`;
        const child = spawn(process.execPath, [script, specPath, shardPath, String(shard), String(workers)], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let errors = '';
        child.stderr.on('data', chunk => { errors += chunk.toString(); });
        child.on('error', reject);
        child.on('exit', code => {
            if (code !== 0) reject(new Error(`分片 ${shard} 退出 ${code}: ${errors.slice(-1000)}`));
            else resolve(JSON.parse(fs.readFileSync(shardPath, 'utf8')).rows);
        });
    })));
    const rows = shards.flat();
    const summarize = selected => {
        const wins = selected.filter(row => row.winner === row.seat).length;
        const draws = selected.filter(row => row.winner === 'DRAW' && !row.truncated).length;
        const truncations = selected.filter(row => row.truncated).length;
        const games = selected.length;
        const rate = games ? (wins + draws / 2) / games : 0;
        const groups = new Map();
        for (const row of selected) {
            const key = `${row.faction}-${row.pair}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row.winner === row.seat ? 1 : row.winner === 'DRAW' ? 0.5 : 0);
        }
        const pairRates = [...groups.values()].map(values => values.reduce((sum, value) => sum + value, 0) / values.length);
        const durations = selected.flatMap(row => row.decisionMs).sort((left, right) => left - right);
        const baselineTimes = selected.flatMap(row => row.phaseTimings?.map(timing => timing[0]) || []).sort((left, right) => left - right);
        const inferenceTimes = selected.flatMap(row => row.phaseTimings?.map(timing => timing[1]) || []).sort((left, right) => left - right);
        const validationInferenceTimes = selected.flatMap(row => row.phaseTimings?.map(timing => timing[2] || 0) || []).sort((left, right) => left - right);
        const quantile = fraction => durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))] || 0;
        const winningPlies = selected.filter(row => row.winner === row.seat).map(row => row.plies).sort((left, right) => left - right);
        const decisions = selected.reduce((total, row) => total + Object.values(row.candidateStats.weapons).reduce((sum, amount) => sum + amount, 0), 0);
        return { games, wins, draws, truncations, rate: truncations ? null : rate,
            winningPliesMedian: winningPlies.length ? winningPlies[Math.floor(winningPlies.length / 2)] : null,
            damagePerDecision: decisions ? selected.reduce((total, row) => total + row.candidateStats.damage, 0) / decisions : null,
            scoreBounds: games ? [(wins + draws / 2) / games, (wins + draws / 2 + truncations) / games] : [0, 1],
            ci95: truncations ? [0, 1] : boundedMeanInterval(pairRates), ci95Method: 'paired-bounded-mean-KL',
            pairedWins: pairRates.filter(value => value > 0.5).length, pairedLosses: pairRates.filter(value => value < 0.5).length,
            pairedSplits: pairRates.filter(value => value === 0.5).length, p50Ms: quantile(0.5), p95Ms: quantile(0.95), maxMs: durations.at(-1) || 0,
            baselineP95Ms: baselineTimes[Math.floor(baselineTimes.length * 0.95)] || 0, inferenceP95Ms: inferenceTimes[Math.floor(inferenceTimes.length * 0.95)] || 0,
            validationInferenceP95Ms: validationInferenceTimes[Math.floor(validationInferenceTimes.length * 0.95)] || 0,
            inferenceFallbacks: selected.reduce((sum, row) => sum + row.inferenceFallbacks, 0), searchCalls: selected.reduce((sum, row) => sum + row.searchCalls, 0),
            improvedDecisions: selected.reduce((sum, row) => sum + row.improvedDecisions, 0), validationSamples: selected.reduce((sum, row) => sum + row.validationSamples, 0),
            timeStops: selected.reduce((sum, row) => sum + row.timeStops, 0) };
    };
    const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
    const sourceHash = crypto.createHash('sha256');
    function hashDirectory(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) hashDirectory(full);
            else if (entry.name.endsWith('.js')) {
                sourceHash.update(path.relative(sourceRoot, full).replaceAll('\\', '/'));
                sourceHash.update(fs.readFileSync(full));
            }
        }
    }
    hashDirectory(sourceRoot);
    const report = { generatedAt: new Date().toISOString(), sourceHash: sourceHash.digest('hex'),
        modelHashes: Object.fromEntries(Object.entries(modelSources).map(([role, source]) => [role, source ? crypto.createHash('sha256').update(source).digest('hex') : null])),
        harnessHash: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), randomness: 'per-seat-turn', node: process.version,
        options: { ...spec, pairs, seedOffset, candidate, opponent }, elapsedSec: (Date.now() - started) / 1000,
        overall: summarize(rows), factions: Object.fromEntries(factions.map(faction => [faction, summarize(rows.filter(row => row.faction === faction))])) };
    fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
}
