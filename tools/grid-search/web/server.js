// 网格搜索可视化服务端
// 启动：node server.js [--port 端口号]
// 依赖：npm install express cors

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cors from 'cors';
import { ParallelGridSearch, PRESETS } from '../run.js';
import { cpus } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT, 10) || parseInt(process.argv[2], 10) || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

let currentSearch = null;

// 启动网格搜索
app.post('/api/start', async (req, res) => {
    if (currentSearch && currentSearch.status === 'running') {
        return res.status(400).json({ error: '已有任务在运行' });
    }
    
    const config = req.body;
    
    // 构建完整配置
    const fullConfig = {
        alphaRange: [
            config.alphaMin ?? 0.3,
            config.alphaMax ?? 0.7,
            config.alphaStep ?? 0.1
        ],
        riskRange: [
            config.riskMin ?? 0.0,
            config.riskMax ?? 0.4,
            config.riskStep ?? 0.1
        ],
        gamesPerPair: config.gamesPerPair ?? 30,
        workers: config.workers ?? cpus().length,
        description: '自定义搜索'
    };
    
    currentSearch = new ParallelGridSearch(fullConfig, { silent: true });
    
    // 异步运行，不阻塞响应
    currentSearch.run().catch(err => {
        console.error('搜索执行错误:', err);
        currentSearch.status = 'error';
    });
    
    res.json({ ok: true });
});

// 查询进度（返回结构化数据）
app.get('/api/progress', (req, res) => {
    if (!currentSearch) {
        return res.json({
            status: 'idle',
            progress: 0,
            completed: 0,
            total: 0,
            elapsed: 0,
            eta: 0,
            speed: 0,
            winTop: [],
            eloTop: []
        });
    }
    
    const data = currentSearch.getProgress();
    res.json(data);
});

// 暂停任务
app.post('/api/pause', (req, res) => {
    if (currentSearch && currentSearch.status === 'running') {
        currentSearch.pause();
        res.json({ ok: true });
    } else {
        res.json({ ok: false });
    }
});

// 恢复任务
app.post('/api/resume', (req, res) => {
    if (currentSearch && currentSearch.status === 'paused') {
        currentSearch.resume();
        res.json({ ok: true });
    } else {
        res.json({ ok: false });
    }
});

// 完全停止任务
app.post('/api/stop', (req, res) => {
    if (currentSearch && (currentSearch.status === 'running' || currentSearch.status === 'paused')) {
        currentSearch.terminate();
        res.json({ ok: true });
    } else {
        res.json({ ok: false });
    }
});

// 获取预设配置列表
app.get('/api/presets', (req, res) => {
    res.json(PRESETS);
});

app.listen(PORT, () => {
    console.log(`网格搜索可视化服务已启动：http://localhost:${PORT}/`);
});
