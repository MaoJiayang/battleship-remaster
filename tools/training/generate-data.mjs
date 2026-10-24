import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { deployShips } from '../../src/ai/aiDeployment.js';
import { getAITuning } from '../../src/ai/aiTuning.js';
import { SHIP_TYPES } from '../../src/data/ships.js';
import { NavalNeuralNetwork } from '../../src/ai/neuralNetwork.js';
import { encodeNeuralObservation, NEURAL_ACTIONS } from '../../src/ai/neuralObservation.js';
import { FACTIONS, hashSeed, mulberry32 } from '../sim/core.mjs';

const [, , specPath, outputArg, shardArg, workersArg] = process.argv;
if (!specPath || !outputArg) throw new Error('用法：node tools/training/generate-data.mjs <配置.json> <新输出目录>');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const games = spec.games ?? 980;
const seed = spec.seed ?? 20261024;
const mode = spec.mode ?? 'warmup';
if (os.endianness() !== 'LE') throw new Error('当前数据格式需要小端序平台');
if (!Number.isInteger(games) || games < 2 || !['warmup', 'selfplay'].includes(mode)) throw new Error('对局数量或采集模式无效');
const modelPath = spec.model ? path.resolve(path.dirname(specPath), spec.model) : null;
if (mode === 'selfplay' && !modelPath) throw new Error('自对弈搜索需要指定已训练模型');

function sourceHash() {
    const root = fileURLToPath(new URL('../../src/', import.meta.url));
    const digest = crypto.createHash('sha256');
    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(filename);
            else if (entry.name.endsWith('.js')) digest.update(path.relative(root, filename)).update(fs.readFileSync(filename));
        }
    };
    visit(root);
    return digest.digest('hex');
}

function createFleet(fleetSeed) {
    Math.random = mulberry32(fleetSeed);
    return deployShips(SHIP_TYPES);
}

if (shardArg !== undefined) {
    try { os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
    const shard = Number(shardArg);
    const workers = Number(workersArg);
    const output = path.resolve(outputArg);
    fs.mkdirSync(output);
    const files = ['features.f32', 'targets.f32', 'masks.u8'].map(name => fs.openSync(path.join(output, name), 'wx'));
    const model = modelPath ? new NavalNeuralNetwork(JSON.parse(fs.readFileSync(modelPath, 'utf8'))) : null;
    const groups = [];
    let records = 0;
    let layout = null;
    const savedRandom = Math.random;
    try {
        for (let gameIndex = shard; gameIndex < games; gameIndex += workers) {
            const group = Math.floor(gameIndex / 2);
            const layoutSeed = hashSeed(`neural-layout|${seed}|${group}`);
            const fleetA = createFleet(layoutSeed);
            const fleetB = createFleet(layoutSeed ^ 0x9E3779B9);
            const factionA = FACTIONS[group % FACTIONS.length];
            const factionB = FACTIONS[Math.floor(group / FACTIONS.length) % FACTIONS.length];
            const swapped = gameIndex % 2 === 1;
            const tuning = { ...getAITuning('HARD'), ...spec.tuning, search: mode === 'selfplay',
                pairedSearch: false, searchFixedIterations: true, searchIterations: spec.searchIterations ?? 64,
                trainingTemperature: mode === 'selfplay' ? 1 : 0 };
            const game = new SimulationEngine(
                { level: 'HARD', faction: swapped ? factionB : factionA, tuning },
                { level: 'HARD', faction: swapped ? factionA : factionB, tuning },
                { fleetA: swapped ? fleetB : fleetA, fleetB: swapped ? fleetA : fleetB, maxPlies: spec.maxPlies ?? 320 }
            );
            if (model) for (const seat of ['A', 'B']) game.sides[seat].engine.neuralModel = model;
            const snapshots = [];
            while (!game.finished) {
                const seat = game.currentSeat;
                const side = game.sides[seat];
                const context = game._decisionContext(side, game.sides[seat === 'A' ? 'B' : 'A']);
                const previous = side.engine.actionHistory.at(-1);
                if (previous && !previous.afterView) previous.afterView = context.viewGrid.map(row => [...row]);
                const observation = encodeNeuralObservation(context, {
                    damageGrid: side.engine.damageDealtGrid, history: side.engine.actionHistory, sonarHistory: side.engine.sonarHistory
                });
                layout ??= { schema: observation.schema, rulesId: observation.rulesId, boardSize: 11, channels: 17,
                    globalSize: observation.globals.length, featureSize: observation.planes.length + observation.globals.length, actionSize: NEURAL_ACTIONS };
                Math.random = mulberry32(hashSeed(`neural-turn|${layoutSeed}|${gameIndex % 2}|${seat}|${game.plies}`));
                game.step();
                snapshots.push({ seat, observation, policy: mode === 'selfplay' ? side.engine.lastTrainingPolicy : null });
            }
            const start = records;
            for (const snapshot of snapshots) {
                const features = Float32Array.from([...snapshot.observation.planes, ...snapshot.observation.globals]);
                const targets = new Float32Array(1 + NEURAL_ACTIONS);
                targets[0] = game.winner === null ? 0.5 : Number(game.winner === snapshot.seat);
                if (snapshot.policy) targets.set(snapshot.policy, 1);
                fs.writeSync(files[0], Buffer.from(features.buffer));
                fs.writeSync(files[1], Buffer.from(targets.buffer));
                fs.writeSync(files[2], Buffer.from(snapshot.observation.mask));
                records++;
            }
            groups.push({ gameIndex, splitGroup: `${seed}:${group}`, layoutSeed, factionA, factionB, swapped,
                start, count: snapshots.length, winner: game.winner ?? 'DRAW' });
        }
    } finally {
        Math.random = savedRandom;
        for (const descriptor of files) fs.closeSync(descriptor);
    }
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ ...layout, records, groups, mode, seed, sourceHash: sourceHash() }));
} else {
    const output = path.resolve(outputArg);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.mkdirSync(output);
    const jobs = Math.min(games, Math.max(1, spec.jobs ?? 10));
    const children = [];
    const started = Date.now();
    let shards;
    try {
        shards = await Promise.all(Array.from({ length: jobs }, (_, shard) => new Promise((resolve, reject) => {
            const directory = `shard-${shard}`;
            const child = spawn(process.execPath, [fileURLToPath(import.meta.url), path.resolve(specPath), path.join(output, directory), String(shard), String(jobs)],
                { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
            children.push(child);
            let errors = '';
            child.stderr.on('data', chunk => { errors += chunk.toString(); });
            child.on('error', reject);
            child.on('exit', code => {
                if (code !== 0) reject(new Error(`采集分片 ${shard} 失败：${errors.slice(-1500)}`));
                else resolve({ path: directory, ...JSON.parse(fs.readFileSync(path.join(output, directory, 'manifest.json'), 'utf8')) });
            });
        })));
    } catch (error) {
        for (const child of children) if (child.exitCode === null) child.kill();
        throw error;
    }
    const manifest = { ...shards[0], groups: undefined, path: undefined, shards: shards.map(shard => ({ path: shard.path, records: shard.records })),
        records: shards.reduce((total, shard) => total + shard.records, 0), spec, sourceHash: sourceHash(),
        modelHash: modelPath ? crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex') : null,
        elapsedSec: (Date.now() - started) / 1000 };
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ records: manifest.records, games, mode, elapsedSec: manifest.elapsedSec, sourceHash: manifest.sourceHash }));
}
