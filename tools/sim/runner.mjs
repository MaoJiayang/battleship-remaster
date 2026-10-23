#!/usr/bin/env node
/**
 * 阵营循环赛编排器
 *
 *   node tools/sim/runner.mjs <spec.json> <out.json>
 *
 * 21 个对阵 × pairs 组 × 双座位；同一种子、同一舰队。
 * 输出 <out>.json（汇总）与 <out>-shardN.json（分片原始行）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FACTIONS, mulberry32 } from './core.mjs';

const [, , specPath, outputPath] = process.argv;
if (!specPath || !outputPath) {
    console.error('用法: node runner.mjs <spec.json> <out.json>');
    process.exit(2);
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const pairCount = (FACTIONS.length * (FACTIONS.length - 1)) / 2;
const workers = Math.max(1, Math.min(spec.jobs ?? 6, pairCount));
const workerScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker.mjs');
const outDir = path.dirname(path.resolve(outputPath));
fs.mkdirSync(outDir, { recursive: true });
const stem = path.basename(outputPath, '.json');
const rng = mulberry32(0xB007);

function spawnWorker(shard) {
    return new Promise((resolve, reject) => {
        const shardOut = path.join(outDir, `${stem}-shard${shard}.json`);
        const child = spawn(process.execPath, [
            workerScript, specPath, shardOut, String(shard), String(workers)
        ], {
            stdio: ['ignore', 'ignore', 'pipe'],
            windowsHide: true
        });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('exit', code => {
            if (code !== 0) return reject(new Error(`分片 ${shard} 退出 ${code}: ${stderr.slice(-800)}`));
            resolve(JSON.parse(fs.readFileSync(shardOut, 'utf8')));
        });
    });
}

const started = Date.now();
const shards = await Promise.all(Array.from({ length: workers }, (_, i) => spawnWorker(i)));
const rows = shards.flatMap(shard => shard.results).flatMap(entry => entry.rows);

const stats = Object.fromEntries(FACTIONS.map(f => [f, {
    games: 0, wins: 0, losses: 0, draws: 0, plies: 0,
    firstGames: 0, firstWins: 0,
    shots: 0, hits: 0, damage: 0, sonar: 0, actions: 0
}]));
const matrix = Object.fromEntries(FACTIONS.map(x => [x, Object.fromEntries(FACTIONS.map(y => [y, { games: 0, wins: 0, draws: 0 }]))]));

for (const row of rows) {
    const aFaction = row.xSeat === 'A' ? row.x : row.y;
    const bFaction = row.xSeat === 'A' ? row.y : row.x;
    for (const [side, faction, st] of [['A', aFaction, row.statsA], ['B', bFaction, row.statsB]]) {
        const s = stats[faction];
        s.games++;
        if (row.winner === side) s.wins++;
        else if (row.winner === 'DRAW') s.draws++;
        else s.losses++;
        s.plies += row.plies;
        if (side === 'A') {
            s.firstGames++;
            if (row.winner === 'A') s.firstWins++;
        }
        s.shots += st.shots;
        s.hits += st.hits;
        s.damage += st.damage;
        s.sonar += st.weapons.SONAR;
        s.actions += st.weapons.AP + st.weapons.HE + st.weapons.SONAR;
    }
    const xWin = row.winner === row.xSeat;
    matrix[row.x][row.y].games++;
    matrix[row.y][row.x].games++;
    if (row.winner === 'DRAW') {
        matrix[row.x][row.y].draws++;
        matrix[row.y][row.x].draws++;
    } else if (xWin) {
        matrix[row.x][row.y].wins++;
    } else {
        matrix[row.y][row.x].wins++;
    }
}

function solveBT(mat) {
    const n = FACTIONS.length;
    const totals = FACTIONS.map((f, i) => FACTIONS.reduce((sum, g, j) => {
        if (i === j) return sum;
        const m = mat[f][g];
        return sum + m.wins + 0.5 * m.draws;
    }, 0));
    let g = FACTIONS.map(() => 1);
    for (let iter = 0; iter < 2000; iter++) {
        const next = FACTIONS.map((f, i) => {
            let denom = 0;
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const m = mat[f][FACTIONS[j]];
                denom += m.games / (g[i] + g[j]);
            }
            return denom > 0 ? (totals[i] + 0.5) / denom : 1;
        });
        const logMean = next.reduce((sum, v) => sum + Math.log(v), 0) / n;
        for (let i = 0; i < n; i++) next[i] /= Math.exp(logMean);
        const diff = next.reduce((sum, v, i) => sum + Math.abs(v - g[i]), 0);
        g = next;
        if (diff < 1e-10) break;
    }
    return g;
}

function pVsField(g, i) {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < g.length; j++) {
        if (i === j) continue;
        sum += g[i] / (g[i] + g[j]);
        count++;
    }
    return count ? sum / count : 0;
}

function binom(n, p, random) {
    if (p <= 0) return 0;
    if (p >= 1) return n;
    let c = 0;
    for (let k = 0; k < n; k++) if (random() < p) c++;
    return c;
}

function quantile(values, q) {
    const a = [...values].sort((x, y) => x - y);
    const pos = (a.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

const ratings = solveBT(matrix);
const bootRatings = FACTIONS.map(() => []);
const bootField = FACTIONS.map(() => []);
const BOOT = 1000;
for (let b = 0; b < BOOT; b++) {
    const m2 = Object.fromEntries(FACTIONS.map(x => [x, Object.fromEntries(FACTIONS.map(y => [y, { games: 0, wins: 0, draws: 0 }]))]));
    for (let i = 0; i < FACTIONS.length; i++) {
        for (let j = i + 1; j < FACTIONS.length; j++) {
            const x = FACTIONS[i];
            const y = FACTIONS[j];
            const m = matrix[x][y];
            const p = m.games > 0 ? (m.wins + 0.5 * m.draws) / m.games : 0.5;
            const w = binom(m.games, p, rng);
            m2[x][y] = { games: m.games, wins: w, draws: 0 };
            m2[y][x] = { games: m.games, wins: m.games - w, draws: 0 };
        }
    }
    const g2 = solveBT(m2);
    FACTIONS.forEach((_, i) => {
        bootRatings[i].push(g2[i]);
        bootField[i].push(pVsField(g2, i));
    });
}

const pct = v => (v * 100).toFixed(1);
const fix = (v, d = 2) => v.toFixed(d);
const totalGames = rows.length;
const firstWins = rows.filter(r => r.winner === 'A').length;
const draws = rows.filter(r => r.winner === 'DRAW').length;

const factionRows = FACTIONS.map((f, i) => {
    const s = stats[f];
    const rate = s.games ? s.wins / s.games : 0;
    const se = s.games ? Math.sqrt(rate * (1 - rate) / s.games) : 0;
    return {
        faction: f,
        games: s.games,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        rate,
        ci95: 1.96 * se,
        firstRate: s.firstGames ? s.firstWins / s.firstGames : 0,
        hitRate: s.shots ? s.hits / s.shots : 0,
        damagePerGame: s.games ? s.damage / s.games : 0,
        sonarShare: s.actions ? s.sonar / s.actions : 0,
        avgPlies: s.games ? s.plies / s.games : 0,
        btRating: ratings[i],
        btCi95: (quantile(bootRatings[i], 0.975) - quantile(bootRatings[i], 0.025)) / 2,
        fieldRate: pVsField(ratings, i),
        fieldRateCi95: (quantile(bootField[i], 0.975) - quantile(bootField[i], 0.025)) / 2
    };
}).sort((a, b) => b.rate - a.rate);

const report = {
    generatedAt: new Date().toISOString(),
    options: {
        pairs: spec.pairs,
        seedOffset: spec.seedOffset,
        maxPlies: spec.maxPlies,
        workers,
        neutralBias: spec.neutralBias === true,
        doctrineOverrides: spec.doctrineOverrides ?? {}
    },
    elapsedSec: (Date.now() - started) / 1000,
    overall: { games: totalGames, firstWins, firstRate: totalGames ? firstWins / totalGames : 0, draws },
    factions: factionRows,
    matrix: Object.fromEntries(FACTIONS.map(x => [x, Object.fromEntries(FACTIONS.map(y => {
        const m = matrix[x][y];
        return [y, { games: m.games, wins: m.wins, rate: m.games ? m.wins / m.games : 0 }];
    }))]))
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

console.log(`elapsed ${report.elapsedSec.toFixed(0)}s   games ${totalGames}   draws ${draws}   first-mover ${pct(report.overall.firstRate)}%`);
console.log('faction  win%   ±95   n     first%  hit%   dmg/g  sonar%  plies   BT γ (95%CI)      vs field');
for (const r of factionRows) {
    console.log(`${r.faction.padEnd(7)} ${pct(r.rate).padStart(5)} ${pct(r.ci95).padStart(5)} ${String(r.games).padStart(5)}  ${pct(r.firstRate).padStart(5)}  ${pct(r.hitRate).padStart(5)}  ${fix(r.damagePerGame, 1).padStart(5)}  ${pct(r.sonarShare).padStart(5)}  ${fix(r.avgPlies, 1).padStart(5)}   ${fix(r.btRating, 3)} ±${fix(r.btCi95, 3)}   ${pct(r.fieldRate)}% ±${pct(r.fieldRateCi95)}`);
}
console.log('\ncolumn = 行阵营对该列的胜率');
console.log('       ' + FACTIONS.map(f => f.padStart(6)).join(''));
for (const x of FACTIONS) {
    const cells = FACTIONS.map(y => {
        if (x === y) return '     -';
        const m = matrix[x][y];
        return (m.games ? (m.wins / m.games) * 100 : 0).toFixed(1).padStart(6);
    });
    console.log(`${x.padEnd(6)} ${cells.join('')}`);
}
