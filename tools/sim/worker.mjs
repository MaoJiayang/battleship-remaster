#!/usr/bin/env node
/**
 * 循环赛分片 worker：同一舰队、同一种子，双座位各打一局
 *
 * 由 runner.mjs 启动，不直接面向用户：
 *   node worker.mjs <spec.json> <output-shard.json> <shard> <shardCount>
 */
import fs from 'node:fs';
import os from 'node:os';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { deployShips } from '../../src/ai/aiDeployment.js';
import { SHIP_TYPES } from '../../src/data/ships.js';
import { DIFFICULTY_SETTINGS } from '../../src/data/difficulties.js';
import { DOCTRINES } from '../../src/data/doctrines.js';
import { getAITuning } from '../../src/ai/aiTuning.js';
import { mulberry32, hashSeed, FACTIONS } from './core.mjs';

try { os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* 平台不支持时忽略 */ }

const [, , specPath, outputPath, shardArg = '0', shardCountArg = '1'] = process.argv;
if (!specPath || !outputPath) {
    console.error('用法: node worker.mjs <spec.json> <output-shard.json> <shard> <shardCount>');
    process.exit(2);
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const shard = Number(shardArg);
const shardCount = Number(shardCountArg);
const pairs = spec.pairs ?? 100;
const seedOffset = spec.seedOffset ?? 0;
const maxPlies = spec.maxPlies ?? 320;
const hard = {
    level: 'HARD',
    alpha: spec.alpha ?? DIFFICULTY_SETTINGS.HARD.alpha,
    randomness: spec.randomness ?? DIFFICULTY_SETTINGS.HARD.randomness,
    riskAwareness: spec.riskAwareness ?? DIFFICULTY_SETTINGS.HARD.riskAwareness,
    neutralBias: spec.neutralBias === true,
    tuning: { ...getAITuning('HARD'), ...spec.tuning }
};

function deepMerge(target, patch) {
    for (const [key, value] of Object.entries(patch)) {
        if (value && typeof value === 'object' && !Array.isArray(value)
            && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
            deepMerge(target[key], value);
        } else {
            target[key] = value;
        }
    }
}

for (const [faction, patch] of Object.entries(spec.doctrineOverrides ?? {})) {
    if (!DOCTRINES[faction]) throw new Error(`未知阵营: ${faction}`);
    deepMerge(DOCTRINES[faction], patch);
}

const tasks = [];
for (let i = 0; i < FACTIONS.length; i++) {
    for (let j = i + 1; j < FACTIONS.length; j++) tasks.push([FACTIONS[i], FACTIONS[j]]);
}

const results = [];
for (let t = shard; t < tasks.length; t += shardCount) {
    const [x, y] = tasks[t];
    const rows = [];
    for (let i = 0; i < pairs; i++) {
        const fleetRng = mulberry32(hashSeed(`frr|${x}|${y}|${seedOffset}|${i}`));
        const savedRandom = Math.random;
        Math.random = fleetRng;
        const fleet = deployShips(SHIP_TYPES);
        Math.random = savedRandom;

        for (const [xSeat, bump] of [['A', 0], ['B', 1]]) {
            const gameSeed = hashSeed(`frr|${x}|${y}|${seedOffset}|${i}|${bump}`);
            const saved = Math.random;
            Math.random = mulberry32(gameSeed);
            const configA = { ...hard, faction: xSeat === 'A' ? x : y };
            const configB = { ...hard, faction: xSeat === 'B' ? x : y };
            const engine = new SimulationEngine(configA, configB, {
                fleetA: fleet,
                fleetB: fleet,
                firstSeat: 'A',
                maxPlies
            });
            const res = engine.run();
            Math.random = saved;
            rows.push({
                x,
                y,
                xSeat,
                winner: res.winner,
                plies: res.plies,
                statsA: res.A.stats,
                statsB: res.B.stats
            });
        }
    }
    results.push({ x, y, rows });
}

fs.writeFileSync(outputPath, JSON.stringify({ shard, results }), 'utf8');
