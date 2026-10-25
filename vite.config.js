import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { neuralRulesId } from './src/ai/neuralRules.js';
import { BOARD_SIZE } from './src/config/constants.js';
import { UnifiedNeuralNetwork } from './src/ai/unifiedNetwork.js';

// 开发服务器把对局记录逐行追加到项目内 match-logs/hzq-YYYYMMDD.jsonl
function matchLogPlugin() {
  const queues = new Map();

  const appendLine = (file, line) => {
    const prev = queues.get(file) ?? Promise.resolve();
    const next = prev.then(() => fs.promises.appendFile(file, line, 'utf8'));
    queues.set(file, next.catch(() => {}));
    return next;
  };

  const dayStamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  };

  const handlerFor = dir => (req, res) => {
    const reply = (status, payload) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
    };

    if (req.method === 'GET') {
      reply(200, { ok: true, dir: 'match-logs', file: `match-logs/hzq-${dayStamp()}.jsonl` });
      return;
    }
    if (req.method !== 'POST') {
      reply(405, { ok: false });
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on('end', async () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        reply(400, { ok: false, error: 'invalid json' });
        return;
      }
      if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
        reply(400, { ok: false, error: 'missing type' });
        return;
      }

      const day = dayStamp();
      const file = path.join(dir, `hzq-${day}.jsonl`);
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        await appendLine(file, `${JSON.stringify({ ...payload, receivedAt: new Date().toISOString() })}\n`);
        reply(200, { ok: true, file: `match-logs/hzq-${day}.jsonl` });
      } catch (err) {
        console.error('[matchlog] 写入失败', err);
        reply(500, { ok: false, error: 'write failed' });
      }
    });
  };

  return {
    name: 'hzq-matchlog',
    configureServer(server) {
      server.middlewares.use('/__matchlog', handlerFor(path.join(server.config.root, 'match-logs')));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__matchlog', handlerFor(path.join(server.config.root, 'match-logs')));
    }
  };
}

export default defineConfig(({ mode }) => {
  const neuralPreview = mode === 'neural-preview';
  const unifiedPreview = mode === 'unified-preview';
  const preview = neuralPreview || unifiedPreview;
  const root = fileURLToPath(new URL('.', import.meta.url));
  const aliases = { '#naval-game-policy': path.join(root, 'src/ai', preview ? 'previewGamePolicy.js' : 'gamePolicy.js') };
  let policyMetadata;
  let policyLabel;
  if (preview) {
    if (!process.env.NAVAL_PREVIEW_MODEL) throw new Error('体验构建需要通过 NAVAL_PREVIEW_MODEL 指定已导出的模型文件');
    const modelPath = path.resolve(process.env.NAVAL_PREVIEW_MODEL);
    const source = fs.readFileSync(modelPath);
    const model = JSON.parse(source.toString('utf8'));
    const hash = createHash('sha256').update(source).digest('hex');
    if (neuralPreview) {
      if (hash !== 'bc91d7b32a7257b189d64b26d13dc508e643d63778b62fb6123f71dc859dfa9a') throw new Error('体验模型不是已冻结的 GRU/PPO 第 48 轮候选');
      if (model.format !== 'naval-memory-v1' || model.memoryKind !== 'gru') throw new Error('体验模型格式不符');
      if (model.rulesId !== neuralRulesId()) throw new Error('冻结体验模型属于旧规则；保留既有体验包，修复规则后需重新训练并验收权重');
      policyMetadata = { format: model.format, kind: model.memoryKind, iteration: 48, sha256: hash };
      policyLabel = '神经 AI 体验版 · GRU/PPO 48 · 学说平衡未验收';
    } else {
      if (!/^[a-f0-9]{64}$/.test(process.env.NAVAL_PREVIEW_MODEL_SHA256 ?? '')
        || hash !== process.env.NAVAL_PREVIEW_MODEL_SHA256) throw new Error('统一体验模型需要匹配 NAVAL_PREVIEW_MODEL_SHA256');
      if (model.format !== 'naval-unified-v1' || model.policyTrained !== true) throw new Error('统一体验需要已训练的策略模型');
      if (model.rulesId !== neuralRulesId() || !model.validatedRules?.includes(neuralRulesId())) throw new Error('统一体验模型不适用于当前规则');
      if (!model.trainedShapes?.some(shape => shape.length === 2 && shape.every(size => size === BOARD_SIZE))) throw new Error('统一体验模型未覆盖当前棋盘尺寸');
      new UnifiedNeuralNetwork(model);
      const training = model.training;
      const supervised = training?.algorithm === 'supervised actual old-HARD actions plus terminal value';
      const iteration = training?.history?.at(-1)?.iteration;
      if (supervised ? !(training.best_epoch > 0 && training.updates > 0)
        : !(training?.algorithm === 'PPO-clip' && iteration > 0 && training.history.some(entry => entry.updates > 0))) throw new Error('统一体验模型缺少实际训练记录');
      policyMetadata = { format: model.format, kind: model.memoryKind, rulesId: model.rulesId, sha256: hash,
        algorithm: training.algorithm, ...(supervised ? { epoch: training.best_epoch } : { iteration }) };
      policyLabel = `统一模型体验版 · ${model.memoryKind === 'attention' ? '注意力' : 'GRU'}/${supervised ? `监督 ${training.best_epoch}` : `PPO ${iteration}`} · 棋力与平衡未验收`;
    }
    aliases['#naval-preview-model'] = modelPath;
    console.info(`神经 AI 体验模型 SHA256: ${hash}`);
  }
  return {
    resolve: { alias: aliases },
    define: preview ? { __NAVAL_PREVIEW_LABEL__: JSON.stringify(policyLabel), __NAVAL_PREVIEW_METADATA__: JSON.stringify(policyMetadata) } : {},
    plugins: [matchLogPlugin(), ...(['single', 'neural-preview', 'unified-preview'].includes(mode) ? [viteSingleFile()] : [])],
    server: {
      // 落盘文件不参与 HMR，避免每手写入触发页面刷新
      watch: {
        ignored: ['**/match-logs/**']
      }
    },
    build: {
      outDir: unifiedPreview ? 'dist-unified-preview' : neuralPreview ? 'dist-neural-preview' : 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: 'index.html'
      }
    }
  };
});
