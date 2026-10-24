import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'naval-data-test-'));
const spec = path.join(directory, 'spec.json');
const output = path.join(directory, 'data');
fs.writeFileSync(spec, JSON.stringify({ games: 4, jobs: 2, seed: 240124, mode: 'warmup', maxPlies: 1 }));
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./generate-data.mjs', import.meta.url)), spec, output],
    { windowsHide: true, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
assert.equal(manifest.records, 4, '达到手数上限后不能重复记录未执行的行动');
const groups = [];
for (const entry of manifest.shards) {
    const shardDirectory = path.join(output, entry.path);
    const shard = JSON.parse(fs.readFileSync(path.join(shardDirectory, 'manifest.json'), 'utf8'));
    groups.push(...shard.groups);
    assert.ok(shard.groups.every(group => group.count === 1 && group.winner === 'DRAW'));
    const targets = fs.readFileSync(path.join(shardDirectory, 'targets.f32'));
    for (let row = 0; row < shard.records; row++) {
        assert.equal(targets.readFloatLE(row * 364 * 4), 0.5);
        for (let action = 1; action < 364; action++) assert.equal(targets.readFloatLE((row * 364 + action) * 4), 0);
    }
    assert.equal(fs.statSync(path.join(shardDirectory, 'features.f32')).size, shard.records * manifest.featureSize * 4);
    assert.equal(fs.statSync(path.join(shardDirectory, 'masks.u8')).size, shard.records * 363);
}
assert.equal(groups.length, 4);
assert.equal(new Set(groups.map(group => group.splitGroup)).size, 2, '交换座位必须共享布阵划分组');
console.log(`DATA SELFTEST OK: ${directory}`);
