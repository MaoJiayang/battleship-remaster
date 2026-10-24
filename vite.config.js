import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

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
  const root = fileURLToPath(new URL('.', import.meta.url));
  const aliases = { '#naval-game-policy': path.join(root, 'src/ai', neuralPreview ? 'previewGamePolicy.js' : 'gamePolicy.js') };
  if (neuralPreview) {
    if (!process.env.NAVAL_PREVIEW_MODEL) throw new Error('体验构建需要通过 NAVAL_PREVIEW_MODEL 指定已导出的模型文件');
    const modelPath = path.resolve(process.env.NAVAL_PREVIEW_MODEL);
    const source = fs.readFileSync(modelPath);
    const model = JSON.parse(source.toString('utf8'));
    const hash = createHash('sha256').update(source).digest('hex');
    if (hash !== 'bc91d7b32a7257b189d64b26d13dc508e643d63778b62fb6123f71dc859dfa9a') throw new Error('体验模型不是已冻结的 GRU/PPO 第 48 轮候选');
    if (model.format !== 'naval-memory-v1' || model.memoryKind !== 'gru') throw new Error('体验模型格式不符');
    aliases['#naval-preview-model'] = modelPath;
    console.info(`神经 AI 体验模型 SHA256: ${hash}`);
  }
  return {
    resolve: { alias: aliases },
    plugins: [matchLogPlugin(), ...(['single', 'neural-preview'].includes(mode) ? [viteSingleFile()] : [])],
    server: {
      // 落盘文件不参与 HMR，避免每手写入触发页面刷新
      watch: {
        ignored: ['**/match-logs/**']
      }
    },
    build: {
      outDir: neuralPreview ? 'dist-neural-preview' : 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: 'index.html'
      }
    }
  };
});
