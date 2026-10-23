import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'naval-strength-test-'));
const script = fileURLToPath(new URL('./strength.mjs', import.meta.url));
const runs = [];
for (const jobs of [1, 10]) {
    const specPath = path.join(directory, `spec-${jobs}.json`);
    const outputPath = path.join(directory, `out-${jobs}.json`);
    const tuning = { search: false, sampleCount: 64, opponentSampleCount: 8, lookaheadSteps: 1 };
    fs.writeFileSync(specPath, JSON.stringify({ pairs: 2, jobs, seedOffset: 20261024, candidate: { tuning }, opponent: { tuning } }));
    const result = spawnSync(process.execPath, [script, specPath, outputPath], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const rows = Array.from({ length: jobs }, (_, shard) => JSON.parse(fs.readFileSync(outputPath.replace('.json', `-shard${shard}.json`), 'utf8')).rows)
        .flat().map(({ decisionMs, ...row }) => row).sort((left, right) => `${left.faction}-${left.pair}-${left.seat}`.localeCompare(`${right.faction}-${right.pair}-${right.seat}`));
    assert.equal(rows.length, 28);
    assert.equal(new Set(rows.map(row => `${row.faction}-${row.pair}-${row.seat}`)).size, 28);
    runs.push(rows);
}
assert.deepEqual(runs[0], runs[1], '提高并行度须保留全部对局，且不改变固定种子下的行为和结局');
console.log(`STRENGTH SELFTEST OK: ${directory}`);
