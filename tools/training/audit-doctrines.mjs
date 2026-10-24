import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DOCTRINES, getAPDamage, getAPMaxPenetrations, getHEProfile, applyAPDefense, applyHEDefense } from '../../src/data/doctrines.js';
import { SHIP_TYPES } from '../../src/data/ships.js';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { encodeNeuralObservation } from '../../src/ai/neuralObservation.js';
import { FACTIONS } from '../sim/core.mjs';

const [runs, output] = process.argv.slice(2);
if (!runs || !output) throw new Error('用法：node tools/training/audit-doctrines.mjs <r22目录> <结果.json>');
const profiles = {};
for (const faction of FACTIONS) {
    let count = 0;
    let centerAtLeastAP = 0;
    let unavailable = 0;
    let lowerCenter = 0;
    let fewerPenetrations = 0;
    for (let aliveMask = 1; aliveMask < 2 ** SHIP_TYPES.length; aliveMask++) {
        const ships = SHIP_TYPES.map((ship, index) => ({ ...ship, sunk: !(aliveMask & (1 << index)) }));
        for (const defender of FACTIONS) {
            for (let sunkEnemyShips = 0; sunkEnemyShips < SHIP_TYPES.length; sunkEnemyShips++) {
                for (const targetSuspect of [false, true]) {
                    const ap = applyAPDefense(defender, getAPDamage(faction, ships, { sunkEnemyShips, targetSuspect }));
                    const he = getHEProfile(faction, ships);
                    const center = applyHEDefense(defender, he.centerDamage);
                    const penetrations = he.centerPenetrates ? 1 : 0;
                    count++;
                    if (!he.available) unavailable++;
                    if (center < ap) lowerCenter++;
                    if (penetrations < getAPMaxPenetrations(faction, ships)) fewerPenetrations++;
                    if (he.available && center >= ap && penetrations >= getAPMaxPenetrations(faction, ships)) centerAtLeastAP++;
                }
            }
        }
    }
    profiles[faction] = { count, centerAtLeastAP, unavailable, lowerCenter, fewerPenetrations };
}
assert.equal(profiles.sn.count, profiles.sn.centerAtLeastAP, '赤潮中心能力覆盖主炮的假设与实际规则不符');

const environment = new SimulationEngine({ faction: 'us' }, { faction: 'ijn' });
const context = environment._decisionContext(environment.sides.A, environment.sides.B);
const savedHE = DOCTRINES.us.he;
let dependencyEncoding;
try {
    DOCTRINES.us.he = { requiresCV: true };
    const dependent = encodeNeuralObservation(context);
    DOCTRINES.us.he = { requiresCV: false };
    const independent = encodeNeuralObservation(context);
    dependencyEncoding = { currentFeaturesIdentical: ['planes', 'globals', 'mask'].every(key =>
        JSON.stringify(Array.from(dependent[key])) === JSON.stringify(Array.from(independent[key]))),
    rulesIdChanges: dependent.rulesId !== independent.rulesId };
    assert.equal(dependencyEncoding.currentFeaturesIdentical, true);
    assert.equal(dependencyEncoding.rulesIdChanges, true);
} finally {
    if (savedHE === undefined) delete DOCTRINES.us.he;
    else DOCTRINES.us.he = savedHE;
}

let pool = [];
const exposure = [];
const versions = {};
for (let iteration = 1; iteration <= 80; iteration++) {
    const folder = iteration <= 16 ? 'gru-policy-ppo' : 'gru-policy-continued-v2';
    const outcomes = JSON.parse(fs.readFileSync(path.join(runs, folder, `outcomes-${String(iteration).padStart(3, '0')}.json`), 'utf8'));
    assert.equal(outcomes.length, 98);
    assert.equal(new Set(outcomes.map(result => result.index)).size, 98);
    for (const result of outcomes) {
        const group = Math.floor(result.index / 2);
        const factionA = FACTIONS[group % 7];
        const factionB = FACTIONS[Math.floor(group / 7) % 7];
        const learner = result.learnerSeat === 'A' ? factionA : factionB;
        const opponent = result.learnerSeat === 'A' ? factionB : factionA;
        const version = result.opponent === 0 ? 'legacy' : result.opponent === 1 ? iteration - 1 : pool[result.opponent - 2];
        assert.notEqual(version, undefined);
        versions[version] = (versions[version] || 0) + 1;
        exposure.push({ iteration, learner, opponent, version, kind: result.opponent < 2 ? result.opponent : 2,
            won: result.winner === result.learnerSeat, truncated: result.truncated });
    }
    if (iteration % 2 === 0) pool = [...pool, iteration].slice(-4);
}
function summarize(rows) {
    const matchups = {};
    const kinds = { legacy: 0, current: 0, history: 0 };
    const snOpponents = {};
    for (const row of rows) {
        const matchup = `${row.learner}-${row.opponent}`;
        matchups[matchup] = (matchups[matchup] || 0) + 1;
        kinds[['legacy', 'current', 'history'][row.kind]]++;
        if (row.opponent === 'sn' && row.learner !== 'sn') {
            const item = snOpponents[row.version] ??= { games: 0, wins: 0 };
            item.games++;
            item.wins += Number(row.won);
        }
    }
    return { games: rows.length, kinds, orderedMatchups: Object.keys(matchups).length,
        gamesPerMatchup: [...new Set(Object.values(matchups))], snOpponents };
}
const report = { profiles, dependencyEncoding, candidate48: summarize(exposure.filter(row => row.iteration <= 48)),
    through80: summarize(exposure), phases: [16, 32, 48, 64, 80].map(last => ({ first: last - 15, last,
        ...summarize(exposure.filter(row => row.iteration > last - 16 && row.iteration <= last)) })), versions,
    caution: '对手版本按当前滚动池源码与连续恢复重建；实际样本计数不等于独立强度验收。武器中心能力覆盖不等于跨学说获胜策略的支配证明。' };
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ profiles, dependencyEncoding, candidate48: report.candidate48.kinds,
    through80: report.through80.kinds, vsVersion48: report.through80.snOpponents[48] }));
