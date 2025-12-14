// 网格搜索可视化服务端
// 启动：node server.js [--port 端口号]
// 依赖：npm install express cors

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cors from 'cors';
import { ParallelGridSearch, PRESETS, EARLY_STOP_CONFIG } from '../run.js';
import { cpus } from 'os';
import { SimulationEngine } from '../../../src/ai/SimulationEngine.js';
import { BOARD_SIZE, CELL_SIZE, GAME_TITLE, GAME_VERSION } from '../../../src/config/constants.js';

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

// 获取早停配置
app.get('/api/early-stop-config', (req, res) => {
    res.json(EARLY_STOP_CONFIG);
});

// 获取游戏常量
app.get('/api/constants', (req, res) => {
    res.json({
        BOARD_SIZE,
        CELL_SIZE,
        GAME_TITLE,
        GAME_VERSION
    });
});

// 计算概率网格
app.post('/api/probability', async (req, res) => {
    try {
        const { viewGrid, ships, config } = req.body;
        
        // 动态导入 calculateProbabilityGrid
        const { calculateProbabilityGrid } = await import('../../../src/ai/aiStrategy.js');
        
        // 过滤未沉没的船只
        const aliveShips = ships.filter(s => !s.sunk);
        
        // 配置参数
        const probConfig = {
            sampleCount: 700,
            alpha: config.alpha || 0.7
        };
        
        // 计算概率网格
        const probabilityGrid = aliveShips.length > 0 
            ? calculateProbabilityGrid(viewGrid, aliveShips, probConfig)
            : Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
        
        res.json({ probabilityGrid });
        
    } catch (error) {
        console.error('[概率计算] 错误:', error);
        res.status(500).json({ 
            error: '概率计算失败', 
            message: error.message 
        });
    }
});

// ============================================================================
// AI对战可视化路由
// ============================================================================

// 可视化页面
app.get('/visualizer', (req, res) => {
    res.sendFile(path.join(__dirname, 'visualizer.html'));
});

// 运行单次模拟对战
app.post('/api/simulate', async (req, res) => {
    try {
        const { configA, configB } = req.body;
        
        // 验证配置
        if (!configA || !configB) {
            return res.status(400).json({ error: '缺少AI配置' });
        }
        
        console.log(`[模拟对战] AI-A: α=${configA.alpha}, Risk=${configA.riskAwareness}`);
        console.log(`[模拟对战] AI-B: α=${configB.alpha}, Risk=${configB.riskAwareness}`);
        
        // 创建模拟引擎
        const engine = new SimulationEngine(configA, configB, { verbose: false });
        
        // 收集事件
        const events = [];
        
        // 初始化事件
        events.push({
            type: 'INIT',
            data: {
                shipsA: serializeShips(engine.shipsA),
                shipsB: serializeShips(engine.shipsB),
                gridA: serializeGrid(engine.gridA),
                gridB: serializeGrid(engine.gridB)
            }
        });
        
        // 运行对战并收集事件
        const result = engine.runGame();
        
        // 解析历史记录生成事件流
        if (engine.history && engine.history.length > 0) {
            let turnNumber = 1;
            
            for (const turn of engine.history) {
                // 回合开始事件
                events.push({
                    type: 'TURN_START',
                    data: {
                        turn: turnNumber,
                        attacker: turn.attacker
                    }
                });
                
                // 攻击事件
                events.push({
                    type: 'ATTACK',
                    data: {
                        attacker: turn.attacker,
                        weapon: turn.weapon,
                        target: turn.target,
                        result: turn.result,
                        affectedCells: turn.affectedCells || []
                    }
                });
                
                // 舰船沉没事件
                if (turn.sunkShips && turn.sunkShips.length > 0) {
                    for (const ship of turn.sunkShips) {
                        events.push({
                            type: 'SHIP_SUNK',
                            data: {
                                side: turn.attacker === 'A' ? 'B' : 'A',
                                ship: ship
                            }
                        });
                    }
                }
                
                turnNumber++;
            }
        }
        
        // 对战结束事件
        events.push({
            type: 'GAME_END',
            data: {
                winner: result.winner,
                reason: result.reason || '所有舰船被击沉',
                totalTurns: result.turns
            }
        });
        
        console.log(`[模拟对战] 完成 - 胜者: ${result.winner}, 回合数: ${result.turns}`);
        
        res.json({
            events: events,
            totalTurns: result.turns,
            winner: result.winner
        });
        
    } catch (error) {
        console.error('[模拟对战] 错误:', error);
        res.status(500).json({ 
            error: '模拟执行失败', 
            message: error.message,
            stack: error.stack
        });
    }
});

/**
 * 序列化船只数据（移除循环引用）
 */
function serializeShips(ships) {
    return ships.map(ship => {
        // 计算船只位置
        const positions = [];
        for (let i = 0; i < ship.len; i++) {
            const r = ship.v ? ship.r + i : ship.r;
            const c = ship.v ? ship.c : ship.c + i;
            positions.push({ r, c });
        }
        
        return {
            code: ship.code,
            name: ship.name,
            length: ship.len,
            health: ship.hp ? ship.hp.reduce((a, b) => a + b, 0) : ship.maxHp,
            maxHealth: ship.maxHp,
            sunk: ship.sunk || false,
            positions: positions
        };
    });
}

/**
 * 序列化网格数据
 */
function serializeGrid(grid) {
    return grid.map(row => row.map(cell => ({
        row: cell.row,
        col: cell.col,
        state: cell.state,
        hasShip: cell.ship !== null
    })));
}

app.listen(PORT, () => {
    console.log(`网格搜索可视化服务已启动：http://localhost:${PORT}/`);
    console.log(`早停机制: ${EARLY_STOP_CONFIG.enabled ? '✅ 已启用' : '❌ 未启用'}`);
    if (EARLY_STOP_CONFIG.enabled) {
        console.log(`  探索期: ${(EARLY_STOP_CONFIG.explorationPhase * 100).toFixed(0)}% | 淘汰期: ${(EARLY_STOP_CONFIG.explorationPhase * 100).toFixed(0)}-${(EARLY_STOP_CONFIG.eliminationPhase * 100).toFixed(0)}%`);
        console.log(`  最少对局: ${EARLY_STOP_CONFIG.minGamesBeforeStop} | ELO阈值: ${EARLY_STOP_CONFIG.eloThreshold}`);
    }
});
