import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import configuration from '../../vite.config.js';

const filenames = process.argv.slice(2);
assert.ok(filenames.length, '请指定实际训练导出的统一模型文件');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'naval-preview-'));
const previous = { model: process.env.NAVAL_PREVIEW_MODEL, hash: process.env.NAVAL_PREVIEW_MODEL_SHA256 };
const prepare = model => {
    const source = JSON.stringify(model);
    const filename = path.join(temporary, 'model.json');
    fs.writeFileSync(filename, source);
    process.env.NAVAL_PREVIEW_MODEL = filename;
    process.env.NAVAL_PREVIEW_MODEL_SHA256 = createHash('sha256').update(source).digest('hex');
};
try {
    for (const filename of filenames) {
        const model = JSON.parse(fs.readFileSync(filename, 'utf8'));
        prepare(model);
        const valid = configuration({ mode: 'unified-preview' });
        assert.equal(valid.build.outDir, 'dist-unified-preview');
        const metadata = JSON.parse(valid.define.__NAVAL_PREVIEW_METADATA__);
        assert.equal(metadata.sha256, process.env.NAVAL_PREVIEW_MODEL_SHA256);
        assert.equal(metadata.kind, model.memoryKind);
        assert.equal(metadata.rulesId, model.rulesId);
        assert.equal(metadata.algorithm, model.training.algorithm);
        assert.equal(JSON.parse(valid.define.__NAVAL_PREVIEW_LABEL__), '');
        const reject = (change, pattern) => {
            const invalid = structuredClone(model);
            change(invalid);
            prepare(invalid);
            assert.throws(() => configuration({ mode: 'unified-preview' }), pattern);
        };
        reject(candidate => { candidate.rulesId = 'old-rules'; }, /当前规则/);
        reject(candidate => { candidate.validatedRules = []; }, /当前规则/);
        reject(candidate => { candidate.trainedShapes = [[5, 7]]; }, /棋盘尺寸/);
        reject(candidate => { candidate.policyTrained = false; }, /已训练/);
        reject(candidate => { delete candidate.training; }, /实际训练记录/);
        reject(candidate => { candidate.training = { algorithm: 'PPO-clip', history: [{ iteration: 1, updates: 0 }] }; }, /实际训练记录/);
        reject(candidate => { candidate.training = { algorithm: 'supervised actual old-HARD actions plus terminal value', best_epoch: 0, updates: 0 }; }, /实际训练记录/);
        reject(candidate => { candidate.layers.policy.weight.pop(); }, /模型层无效/);
        reject(candidate => { candidate.layers.policy.weight[0] = null; }, /模型层无效/);
        prepare(model);
        process.env.NAVAL_PREVIEW_MODEL_SHA256 = '0'.repeat(64);
        assert.throws(() => configuration({ mode: 'unified-preview' }), /SHA256/);
        delete process.env.NAVAL_PREVIEW_MODEL_SHA256;
        assert.throws(() => configuration({ mode: 'unified-preview' }), /SHA256/);
        assert.throws(() => configuration({ mode: 'neural-preview' }), /已冻结/);
    }
    delete process.env.NAVAL_PREVIEW_MODEL;
    assert.throws(() => configuration({ mode: 'unified-preview' }), /指定已导出/);
    for (const mode of ['production', 'single']) {
        const ordinary = configuration({ mode });
        assert.match(ordinary.resolve.alias['#naval-game-policy'], /[\\/]gamePolicy\.js$/);
        assert.equal(Object.hasOwn(ordinary.resolve.alias, '#naval-preview-model'), false);
        assert.equal(ordinary.build.outDir, 'dist');
        assert.deepEqual(ordinary.define, {});
    }
} finally {
    for (const [name, value] of [['NAVAL_PREVIEW_MODEL', previous.model], ['NAVAL_PREVIEW_MODEL_SHA256', previous.hash]]) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    fs.rmSync(path.join(temporary, 'model.json'), { force: true });
    fs.rmdirSync(temporary);
}
console.log('PREVIEW BUILD SELFTEST OK：规则、尺寸、训练记录、权重与哈希拒绝，以及正式构建隔离');
