#!/usr/bin/env node
/**
 * 两次循环赛的配对比较（必须使用相同 seedOffset；base 可以更多 pairs）
 *
 *   node tools/sim/compare.mjs <base.json> <variant.json>
 *
 * 输出各阵营胜率、配对差 95%CI、跨度、显著对位格与最大变化。
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , basePath, variantPath] = process.argv;
if (!basePath || !variantPath) {
    console.error('用法: node compare.mjs <base.json> <variant.json>');
    process.exit(2);
}

const F = ['us', 'ijn', 'rn', 'km', 'fn', 'rm', 'sn'];

function loadSummary(file) {
    if (!fs.existsSync(file)) throw new Error(`找不到汇总文件: ${file}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadShards(file) {
    const dir = path.dirname(path.resolve(file));
    const stem = path.basename(file, '.json');
    const map = new Map();
    for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith(`${stem}-shard`) || !name.endsWith('.json')) continue;
        const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        for (const group of data.results) {
            const key = `${group.x}|${group.y}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(...group.rows);
        }
    }
    return map;
}

const baseSummary = loadSummary(basePath);
const variantSummary = loadSummary(variantPath);
const pairs = variantSummary.options?.pairs ?? baseSummary.options?.pairs;
if (!pairs) throw new Error('汇总文件缺少 options.pairs');
if (baseSummary.options?.seedOffset !== variantSummary.options?.seedOffset) {
    throw new Error('两次运行的 seedOffset 不同，无法配对比较');
}

const B = loadShards(basePath);
const V = loadShards(variantPath);

const faction = Object.fromEntries(F.map(f => [f, { n: 0, b: 0, v: 0, bOnly: 0, vOnly: 0 }]));
const cells = {};

for (const [key, allBase] of B) {
    const base = allBase.slice(0, pairs * 2);
    const vr = V.get(key);
    if (!vr || vr.length !== base.length) throw new Error(`行数不匹配 ${key}: ${base.length}/${vr?.length ?? 0}`);
    const [x, y] = key.split('|');
    const c = { x, y, n: 0, bX: 0, vX: 0, bOnlyX: 0, vOnlyX: 0 };
    for (let i = 0; i < base.length; i++) {
        const bx = base[i].winner === base[i].xSeat;
        const vx = vr[i].winner === vr[i].xSeat;
        c.n++;
        if (bx) c.bX++;
        if (vx) c.vX++;
        if (bx && !vx) c.bOnlyX++;
        if (!bx && vx) c.vOnlyX++;
        for (const [f, bw, vw] of [[x, bx, vx], [y, !bx, !vx]]) {
            const s = faction[f];
            s.n++;
            if (bw) s.b++;
            if (vw) s.v++;
            if (bw && !vw) s.bOnly++;
            if (!bw && vw) s.vOnly++;
        }
    }
    cells[key] = c;
}

function rateCi(wins, n) {
    const rate = wins / n;
    const se = Math.sqrt(rate * (1 - rate) / n);
    return { rate, ci95: 1.96 * se, sig: Math.abs(rate - 0.5) > 1.96 * se };
}

function paired(bOnly, vOnly, n) {
    const delta = (vOnly - bOnly) / n;
    const discordant = bOnly + vOnly;
    const se = Math.sqrt(Math.max(0, discordant - (vOnly - bOnly) ** 2 / n)) / n;
    return { delta, ci95: 1.96 * se, discordant };
}

const rows = F.map(f => {
    const s = faction[f];
    const b = rateCi(s.b, s.n);
    const v = rateCi(s.v, s.n);
    const p = paired(s.bOnly, s.vOnly, s.n);
    return { faction: f, n: s.n, baseRate: b.rate, baseCi95: b.ci95, varRate: v.rate, varCi95: v.ci95, delta: p.delta, deltaCi95: p.ci95, discordant: p.discordant };
}).sort((a, b) => b.varRate - a.varRate);

const directed = [];
for (const c of Object.values(cells)) {
    directed.push({ x: c.x, y: c.y, b: rateCi(c.bX, c.n), v: rateCi(c.vX, c.n) });
    directed.push({ x: c.y, y: c.x, b: rateCi(c.n - c.bX, c.n), v: rateCi(c.n - c.vX, c.n) });
}

const pct = v => `${(v * 100).toFixed(1)}%`;
const spread = values => Math.max(...values) - Math.min(...values);
const baseRates = directed.map(d => d.b.rate);
const varRates = directed.map(d => d.v.rate);
const cellRows = directed.map(d => ({ ...d, delta: d.v.rate - d.b.rate }));

console.log(`${path.basename(basePath)} -> ${path.basename(variantPath)}   pairs ${pairs}`);
console.log('faction   base    variant   delta (var-base) 95%CI   discordant');
for (const r of rows) {
    console.log(`${r.faction.padEnd(7)} ${pct(r.baseRate).padStart(7)} ${pct(r.varRate).padStart(8)}   ${(r.delta * 100).toFixed(1).padStart(6)}pp  ±${(r.deltaCi95 * 100).toFixed(1)}pp  ${r.discordant}`);
}
console.log(`faction spread: ${pct(Math.min(...rows.map(r => r.baseRate)))}–${pct(Math.max(...rows.map(r => r.baseRate)))} → ${pct(Math.min(...rows.map(r => r.varRate)))}–${pct(Math.max(...rows.map(r => r.varRate)))}`);
console.log(`cell spread: ${pct(Math.min(...baseRates))}–${pct(Math.max(...baseRates))} → ${pct(Math.min(...varRates))}–${pct(Math.max(...varRates))}; significant ${directed.filter(d => d.b.sig).length}/42 → ${directed.filter(d => d.v.sig).length}/42`);
console.log('biggest shifts:');
for (const d of cellRows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10)) {
    console.log(`${d.x.toUpperCase()} vs ${d.y.toUpperCase()}  ${pct(d.b.rate)} → ${pct(d.v.rate)}  ${(d.delta * 100).toFixed(1)}pp`);
}
