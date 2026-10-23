import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { AIDecisionEngine } from '../../src/ai/aiStrategy.js';
import { checkAIAbilities } from '../../src/ai/aiCore.js';
import { getAITuning } from '../../src/ai/aiTuning.js';
import { deployShips } from '../../src/ai/aiDeployment.js';
import { SHIP_TYPES } from '../../src/data/ships.js';
import { serializeEngine, reviveEngine } from '../agent-arena/arena.mjs';
import { FACTIONS, mulberry32, hashSeed } from './core.mjs';

const [, , specPath, outputPath] = process.argv;
const selfTest = specPath === '--selftest';
if (!specPath || (!outputPath && !selfTest)) {
    console.error('用法: node tools/sim/calibration.mjs <配置.json> <输出.json>');
    process.exit(2);
}
try { os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
const spec = selfTest ? {} : JSON.parse(fs.readFileSync(specPath, 'utf8'));
const tuning = { ...getAITuning('HARD'), search: true, searchFixedIterations: true, ...spec.tuning };
const rows = [];

class AuditedEngine extends AIDecisionEngine {
    decide(context) {
        this.audit = null;
        return super.decide(context);
    }
    finishSearch(context, search) {
        this.audit = { result: search.decision(), baseline: search.baseline?.action };
        return super.finishSearch(context, search);
    }
}

function fleet(seed) {
    const saved = Math.random;
    try { Math.random = mulberry32(seed); return deployShips(SHIP_TYPES); }
    finally { Math.random = saved; }
}

function frozenOutcome(snapshot, action, candidateSeat, seed) {
    const savedRandom = Math.random;
    try {
        const game = reviveEngine(structuredClone(snapshot));
        for (const side of Object.values(game.sides)) side.config = { ...side.config, tuning: { ...side.config.tuning, search: false } };
        const engine = game.sides[candidateSeat].engine;
        const original = engine.decide;
        engine.decide = context => engine.recordDecision(action, checkAIAbilities(context.enemyShips, context.aiFaction, context.playerFaction, {
            sunkEnemyShips: context.myShips.filter(ship => ship.sunk).length
        }), context.viewGrid);
        try { game.step(); } finally { engine.decide = original; }
        while (!game.finished) {
            Math.random = mulberry32(hashSeed(`calibration-finish|${seed}|${game.currentSeat}|${game.plies}`));
            game.step();
        }
        return game.winner === candidateSeat ? 1 : game.winner ? 0 : 0.5;
    } finally { Math.random = savedRandom; }
}

function recheckModel(snapshot, baseline, candidate, seed) {
    const savedRandom = Math.random;
    try {
        Math.random = mulberry32(seed);
        const game = reviveEngine(structuredClone(snapshot));
        const attacker = game.sides[game.currentSeat];
        const defender = game.sides[game.currentSeat === 'A' ? 'B' : 'A'];
        const context = game._decisionContext(attacker, defender);
        const search = attacker.engine.createSearch(context, tuning);
        if (!search.particles.length) return [];
        const outcomes = [];
        for (let sample = 0; sample < (spec.modelContinuations ?? 128); sample++) {
            const scenario = search.makeScenario();
            outcomes.push({ baseline: search.evaluateScenario(baseline, scenario), candidate: search.evaluateScenario(candidate, scenario) });
        }
        return outcomes;
    } finally { Math.random = savedRandom; }
}

if (selfTest) {
    const config = { faction: 'us', level: 'HARD', tuning: { ...getAITuning('HARD'), search: false } };
    const ship = { name: '潜艇', code: 'SS', len: 1, maxHp: 2, v: false };
    const game = new SimulationEngine(config, config, { fleetA: [{ ...ship, r: 0, c: 0 }], fleetB: [{ ...ship, r: 5, c: 5 }] });
    game.sides.A.ships[0].hp[0] = 1;
    game.sides.A.view.forEach(row => row.fill(1));
    game.sides.B.view.forEach(row => row.fill(1));
    game.sides.A.view[5][5] = 2;
    game.sides.A.view[8][8] = 0;
    game.sides.B.view[0][0] = 2;
    game.sides.A.grid[0][0].hit = true;
    game.sides.B.grid[5][5].hit = true;
    const snapshot = serializeEngine(game);
    assert.equal(frozenOutcome(snapshot, { weapon: 'AP', r: 5, c: 5 }, 'A', 11), 1);
    assert.equal(frozenOutcome(snapshot, { weapon: 'AP', r: 8, c: 8 }, 'A', 11), 0);
    assert.equal(frozenOutcome(snapshot, { weapon: 'AP', r: 5, c: 5 }, 'A', 11), 1);
    assert.equal(game.sides.A.ships[0].hp[0], 1);
    assert.equal(game.sides.B.ships[0].hp[0], 2);
    assert.ok(recheckModel(snapshot, { weapon: 'AP', r: 8, c: 8 }, { weapon: 'AP', r: 5, c: 5 }, 11)
        .every(outcome => outcome.candidate === 1 && outcome.baseline === 0));
    console.log('CALIBRATION SELFTEST OK');
    process.exit(0);
}

const started = performance.now();
for (let gameIndex = 0; gameIndex < (spec.games ?? 70) && rows.length < (spec.limit ?? 12); gameIndex++) {
    const group = Math.floor(gameIndex / 2);
    const faction = FACTIONS[group % FACTIONS.length];
    const pair = Math.floor(group / FACTIONS.length);
    const candidateSeat = gameIndex % 2 === 0 ? 'A' : 'B';
    const seed = hashSeed(`strength|${faction}|${spec.seedOffset ?? 271828}|${pair}`);
    const candidate = { faction, level: 'HARD', tuning };
    const opponent = { faction, level: 'HARD', tuning: { ...tuning, search: false } };
    const game = new SimulationEngine(candidateSeat === 'A' ? candidate : opponent, candidateSeat === 'B' ? candidate : opponent,
        { fleetA: fleet(seed), fleetB: fleet(seed ^ 0x9E3779B9), maxPlies: spec.maxPlies ?? 320 });
    game.sides[candidateSeat].engine = new AuditedEngine();
    while (!game.finished && rows.length < (spec.limit ?? 12)) {
        const snapshot = game.currentSeat === candidateSeat ? structuredClone(serializeEngine(game)) : null;
        Math.random = mulberry32(hashSeed(`strength-turn|${seed}|${game.currentSeat}|${game.plies}`));
        game.step();
        if (!snapshot) continue;
        const audit = game.sides[candidateSeat].engine.audit;
        if (!audit?.result?.improved) continue;
        const modelOutcomes = recheckModel(snapshot, audit.baseline, audit.result.action, hashSeed(`recheck|${seed}|${snapshot.plies}`));
        const outcomes = [];
        for (let sample = 0; sample < (spec.continuations ?? 16); sample++) {
            const continuationSeed = hashSeed(`calibration|${seed}|${snapshot.plies}|${sample}`);
            outcomes.push({ baseline: frozenOutcome(snapshot, audit.baseline, candidateSeat, continuationSeed),
                candidate: frozenOutcome(snapshot, audit.result.action, candidateSeat, continuationSeed) });
        }
        rows.push({ faction, pair, candidateSeat, seed, ply: snapshot.plies + 1, action: audit.result.action, baselineAction: audit.baseline,
            acceptanceDifference: audit.result.pairedDifference, logEvidence: audit.result.logEvidence,
            recheckedModelDifference: modelOutcomes.length ? modelOutcomes.reduce((sum, outcome) => sum + outcome.candidate - outcome.baseline, 0) / modelOutcomes.length : null,
            modelOutcomes,
            actualDifference: outcomes.reduce((sum, outcome) => sum + outcome.candidate - outcome.baseline, 0) / outcomes.length, outcomes });
    }
}
const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
const hash = crypto.createHash('sha256');
function hashDirectory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) hashDirectory(full);
        else if (entry.name.endsWith('.js')) { hash.update(path.relative(sourceRoot, full).replaceAll('\\', '/')); hash.update(fs.readFileSync(full)); }
    }
}
hashDirectory(sourceRoot);
const recheckedRows = rows.filter(row => row.recheckedModelDifference !== null);
const report = { generatedAt: new Date().toISOString(), sourceHash: hash.digest('hex'),
    harnessHash: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), node: process.version, options: { ...spec, tuning },
    elapsedSec: (performance.now() - started) / 1000, selectedDecisions: rows.length,
    meanAcceptanceDifference: rows.length ? rows.reduce((sum, row) => sum + row.acceptanceDifference, 0) / rows.length : 0,
    modelRecheckedDecisions: recheckedRows.length,
    meanRecheckedModelDifference: recheckedRows.length ? recheckedRows.reduce((sum, row) => sum + row.recheckedModelDifference, 0) / recheckedRows.length : null,
    meanActualDifference: rows.length ? rows.reduce((sum, row) => sum + row.actualDifference, 0) / rows.length : 0, rows };
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
