/**
 * 并行网格搜索主入口
 * 
 * 使用 Worker Threads 实现真正的多线程并行
 * 直接复用主项目的 SimulationEngine，修改 AI 逻辑会自动生效
 * 
 * ============================================================================
 * 使用方法
 * ============================================================================
 * 
 * cd tools/grid-search
 * 
 * # 快速测试
 * node run.js --test
 * 
 * # 快速搜索（粗粒度）
 * node run.js --preset quick
 * 
 * # 默认搜索
 * node run.js
 * 
 * # 完整搜索（细粒度）
 * node run.js --preset full
 * 
 * # 自定义参数
 * node run.js --alpha-min 0.3 --alpha-max 0.7 --alpha-step 0.1 \
 *              --risk-min 0 --risk-max 0.4 --risk-step 0.1 \
 *              --games 50 --workers 8
 * 
 * ============================================================================
 */

import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// 预设配置
// ============================================================================

const PRESETS = {
    test: {
        alphaRange: [0.4, 0.6, 0.2],
        riskRange: [0.0, 0.2, 0.2],
        gamesPerPair: 10,
        description: '测试模式（2x2 网格，10场/对）'
    },
    quick: {
        alphaRange: [0.3, 0.7, 0.2],
        riskRange: [0.0, 0.4, 0.2],
        gamesPerPair: 20,
        description: '快速搜索（3x3 网格，20场/对）'
    },
    default: {
        alphaRange: [0.3, 0.7, 0.1],
        riskRange: [0.0, 0.4, 0.1],
        gamesPerPair: 30,
        description: '默认搜索（5x5 网格，30场/对）'
    },
    full: {
        alphaRange: [0.5, 0.9, 0.05],
        riskRange: [0.4, 0.5, 0.1],
        gamesPerPair: 30,
        description: '完整搜索'
    }
};

// ============================================================================
// 命令行参数解析
// ============================================================================

function parseArgs() {
    const args = process.argv.slice(2);
    const config = { ...PRESETS.default };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];
        
        switch (arg) {
            case '--test':
                Object.assign(config, PRESETS.test);
                break;
            case '--preset':
                if (PRESETS[next]) {
                    Object.assign(config, PRESETS[next]);
                    i++;
                }
                break;
            case '--alpha-min':
                config.alphaRange[0] = parseFloat(next);
                i++;
                break;
            case '--alpha-max':
                config.alphaRange[1] = parseFloat(next);
                i++;
                break;
            case '--alpha-step':
                config.alphaRange[2] = parseFloat(next);
                i++;
                break;
            case '--risk-min':
                config.riskRange[0] = parseFloat(next);
                i++;
                break;
            case '--risk-max':
                config.riskRange[1] = parseFloat(next);
                i++;
                break;
            case '--risk-step':
                config.riskRange[2] = parseFloat(next);
                i++;
                break;
            case '--games':
                config.gamesPerPair = parseInt(next);
                i++;
                break;
            case '--workers':
                config.workers = parseInt(next);
                i++;
                break;
            case '--output':
            case '-o':
                config.outputFile = next;
                i++;
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
        }
    }
    
    config.workers = config.workers || cpus().length;
    
    return config;
}

function printHelp() {
    console.log(`
海战棋 AI 参数网格搜索工具

使用方法:
  node run.js [选项]

预设:
  --test              测试模式（快速验证）
  --preset <name>     使用预设 (test/quick/default/full)

参数:
  --alpha-min <n>     Alpha 最小值 (默认 0.3)
  --alpha-max <n>     Alpha 最大值 (默认 0.7)
  --alpha-step <n>    Alpha 步长 (默认 0.1)
  --risk-min <n>      Risk 最小值 (默认 0.0)
  --risk-max <n>      Risk 最大值 (默认 0.4)
  --risk-step <n>     Risk 步长 (默认 0.1)
  --games <n>         每对配置对战次数 (默认 30)
  --workers <n>       Worker 线程数 (默认 CPU 核心数)
  -o, --output <file> 输出结果到 JSON 文件

示例:
  node run.js --test                    # 快速测试
  node run.js --preset quick            # 快速搜索
  node run.js --games 100 --workers 4   # 自定义参数
`);
}

// ============================================================================
// 网格搜索控制器
// ============================================================================

class ParallelGridSearch {
    constructor(config) {
        this.config = config;
        this.workers = [];
        this.taskQueue = [];
        this.results = new Map();      // configKey -> stats
        this.matchResults = [];        // 所有对战结果
        this.pendingTasks = 0;
        this.completedTasks = 0;
        this.totalTasks = 0;
        this.startTime = null;
        this.readyWorkers = 0;
    }
    
    /**
     * 生成参数网格
     */
    generateGrid() {
        const { alphaRange, riskRange } = this.config;
        const [alphaMin, alphaMax, alphaStep] = alphaRange;
        const [riskMin, riskMax, riskStep] = riskRange;
        
        const grid = [];
        
        for (let alpha = alphaMin; alpha <= alphaMax + 1e-9; alpha += alphaStep) {
            for (let risk = riskMin; risk <= riskMax + 1e-9; risk += riskStep) {
                grid.push({
                    alpha: Math.round(alpha * 100) / 100,
                    riskAwareness: Math.round(risk * 100) / 100,
                    randomness: 0
                });
            }
        }
        
        return grid;
    }
    
    /**
     * 配置键
     */
    configKey(config) {
        return `α${config.alpha.toFixed(2)}_r${config.riskAwareness.toFixed(2)}`;
    }
    
    /**
     * 生成所有对战配对（循环赛）
     */
    generateMatchups(grid) {
        const matchups = [];
        
        for (let i = 0; i < grid.length; i++) {
            for (let j = i + 1; j < grid.length; j++) {
                matchups.push({
                    configA: grid[i],
                    configB: grid[j],
                    keyA: this.configKey(grid[i]),
                    keyB: this.configKey(grid[j])
                });
            }
        }
        
        return matchups;
    }
    
    /**
     * 初始化结果存储
     */
    initResults(grid) {
        for (const config of grid) {
            const key = this.configKey(config);
            this.results.set(key, {
                config,
                wins: 0,
                losses: 0,
                draws: 0,
                games: 0,
                totalTurns: 0
            });
        }
    }
    
    /**
     * 创建 Worker 池
     */
    async createWorkerPool() {
        const workerCount = this.config.workers;
        const workerPath = join(__dirname, 'worker.js');
        
        return new Promise((resolve, reject) => {
            for (let i = 0; i < workerCount; i++) {
                const worker = new Worker(workerPath, {
                    workerData: { workerId: i }
                });
                
                worker.on('message', (msg) => this.handleWorkerMessage(worker, msg));
                worker.on('error', (err) => {
                    console.error(`Worker ${i} 错误:`, err);
                });
                worker.on('exit', (code) => {
                    // terminate() 会导致 code=1，这是正常的
                    if (code !== 0 && code !== 1) {
                        console.error(`Worker ${i} 异常退出，代码: ${code}`);
                    }
                });
                
                this.workers.push(worker);
            }
            
            // 等待所有 Worker 就绪
            const checkReady = setInterval(() => {
                if (this.readyWorkers >= workerCount) {
                    clearInterval(checkReady);
                    resolve();
                }
            }, 50);
            
            // 超时
            setTimeout(() => {
                clearInterval(checkReady);
                if (this.readyWorkers >= workerCount) {
                    resolve();
                } else {
                    reject(new Error('Worker 初始化超时'));
                }
            }, 10000);
        });
    }
    
    /**
     * 处理 Worker 消息
     */
    handleWorkerMessage(worker, msg) {
        if (msg.type === 'loading') {
            // Worker 开始加载模块
            return;
        }
        
        if (msg.type === 'ready') {
            this.readyWorkers++;
            // 显示加载进度
            process.stdout.clearLine?.(0);
            process.stdout.cursorTo?.(0);
            process.stdout.write(`🔄 Worker 加载中: ${this.readyWorkers}/${this.config.workers}`);
            return;
        }
        
        if (msg.type === 'error') {
            console.error(`\n任务 ${msg.taskId} 执行错误:`, msg.error);
            this.completedTasks++;
            this.pendingTasks--;
            this.tryAssignTask(worker);
            return;
        }
        
        if (msg.type === 'result') {
            this.recordResult(msg);
            this.completedTasks++;
            this.pendingTasks--;
            this.tryAssignTask(worker);
        }
    }
    
    /**
     * 记录对战结果
     */
    recordResult(result) {
        const { keyA, keyB, winsA, winsB, draws, totalGames, avgTurns } = result;
        
        // 更新 A 的统计
        const statsA = this.results.get(keyA);
        if (statsA) {
            statsA.wins += winsA;
            statsA.losses += winsB;
            statsA.draws += draws;
            statsA.games += totalGames;
            statsA.totalTurns += avgTurns * totalGames;
        }
        
        // 更新 B 的统计
        const statsB = this.results.get(keyB);
        if (statsB) {
            statsB.wins += winsB;
            statsB.losses += winsA;
            statsB.draws += draws;
            statsB.games += totalGames;
            statsB.totalTurns += avgTurns * totalGames;
        }
        
        this.matchResults.push(result);
    }
    
    /**
     * 尝试分配任务给 Worker
     */
    tryAssignTask(worker) {
        if (this.taskQueue.length > 0) {
            const task = this.taskQueue.shift();
            worker.postMessage(task);
            this.pendingTasks++;
        } else if (this.pendingTasks === 0 && this.onComplete) {
            this.onComplete();
        }
    }
    
    /**
     * 打印进度
     */
    printProgress() {
        const percent = Math.round(this.completedTasks / this.totalTasks * 100);
        const elapsed = (Date.now() - this.startTime) / 1000;
        const speed = elapsed > 0 ? this.completedTasks / elapsed : 0;
        const eta = speed > 0 ? (this.totalTasks - this.completedTasks) / speed : 0;
        
        // 清除当前行并打印进度
        process.stdout.clearLine?.(0);
        process.stdout.cursorTo?.(0);
        
        if (this.completedTasks === 0) {
            // 还没有完成的任务，显示等待状态
            process.stdout.write(
                `⏳ 进度: 0/${this.totalTasks} (0%) | 已用: ${elapsed.toFixed(1)}s | 任务执行中...`
            );
        } else {
            process.stdout.write(
                `⏳ 进度: ${this.completedTasks}/${this.totalTasks} (${percent}%) ` +
                `| 已用: ${elapsed.toFixed(1)}s | 预计剩余: ${eta.toFixed(0)}s | 速度: ${speed.toFixed(1)}任务/s`
            );
        }
    }
    
    /**
     * 运行网格搜索
     */
    async run() {
        console.log('');
        console.log('🔍 ═══════════════════════════════════════════════════════════════');
        console.log('   海战棋 AI 参数网格搜索（并行模式）');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log('');
        
        // 生成网格和配对
        const grid = this.generateGrid();
        const matchups = this.generateMatchups(grid);
        this.initResults(grid);
        
        const totalPairs = matchups.length;
        const totalGames = totalPairs * this.config.gamesPerPair;
        
        console.log(`📊 Alpha 范围: [${this.config.alphaRange.join(', ')}]`);
        console.log(`📊 Risk 范围:  [${this.config.riskRange.join(', ')}]`);
        console.log(`📊 参数组合数: ${grid.length}`);
        console.log(`⚔️  对战配对数: ${totalPairs}`);
        console.log(`🎮 每对战场次: ${this.config.gamesPerPair}`);
        console.log(`📈 总对战场次: ${totalGames}（每场为一个并行任务）`);
        console.log(`🖥️  Worker 数量: ${this.config.workers}`);
        console.log('');
        console.log('───────────────────────────────────────────────────────────────────');
        
        // 创建 Worker 池
        const loadStartTime = Date.now();
        console.log('🚀 正在初始化 Worker 并加载模块...');
        await this.createWorkerPool();
        const loadTime = ((Date.now() - loadStartTime) / 1000).toFixed(1);
        console.log(`\n✅ ${this.workers.length} 个 Worker 已就绪（加载耗时 ${loadTime}s）`);
        console.log('');
        
        // 准备任务队列 - 拆分为单场对战任务，提高并行效率
        let taskId = 0;
        const halfGames = Math.floor(this.config.gamesPerPair / 2);
        
        for (const matchup of matchups) {
            // A 先手的对战
            for (let g = 0; g < halfGames; g++) {
                this.taskQueue.push({
                    taskId: taskId++,
                    mode: 'single',
                    configA: matchup.configA,
                    configB: matchup.configB,
                    keyA: matchup.keyA,
                    keyB: matchup.keyB,
                    isFirstHalf: true
                });
            }
            // B 先手的对战（交换位置）
            for (let g = 0; g < halfGames; g++) {
                this.taskQueue.push({
                    taskId: taskId++,
                    mode: 'single',
                    configA: matchup.configB,  // 交换
                    configB: matchup.configA,
                    keyA: matchup.keyA,
                    keyB: matchup.keyB,
                    isFirstHalf: false
                });
            }
        }
        
        this.totalTasks = this.taskQueue.length;
        
        // 开始执行
        this.startTime = Date.now();
        
        return new Promise((resolve) => {
            this.onComplete = () => {
                // 停止进度刷新
                if (this.progressInterval) {
                    clearInterval(this.progressInterval);
                }
                console.log('\n');
                this.printResults();
                this.terminate();
                resolve(this.getSortedResults());
            };
            
            // 立即显示初始进度
            console.log('⏳ 开始执行任务...');
            
            // 定时刷新进度（每200ms），确保用户能看到更新
            this.progressInterval = setInterval(() => {
                this.printProgress();
            }, 200);
            
            // 初始分配任务
            for (const worker of this.workers) {
                this.tryAssignTask(worker);
            }
        });
    }
    
    /**
     * 获取排序结果
     */
    getSortedResults() {
        const results = Array.from(this.results.values()).map(stats => ({
            ...stats,
            winRate: stats.games > 0 ? stats.wins / stats.games : 0,
            avgTurns: stats.games > 0 ? stats.totalTurns / stats.games : 0
        }));
        
        return results.sort((a, b) => b.winRate - a.winRate);
    }
    
    /**
     * 打印结果
     */
    printResults() {
        const sorted = this.getSortedResults();
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log(`✅ 搜索完成！总耗时 ${elapsed} 秒`);
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log('');
        console.log('📊 循环赛结果排名（按综合胜率）');
        console.log('');
        console.log('排名 │ Alpha │ Risk │  胜率  │   胜   │   负   │  平  │ 平均回合');
        console.log('─────┼───────┼──────┼────────┼────────┼────────┼──────┼──────────');
        
        const topN = Math.min(20, sorted.length);
        for (let i = 0; i < topN; i++) {
            const r = sorted[i];
            const rank = String(i + 1).padStart(3, ' ');
            const alpha = r.config.alpha.toFixed(2);
            const risk = r.config.riskAwareness.toFixed(2);
            const winRate = (r.winRate * 100).toFixed(1).padStart(5, ' ') + '%';
            const wins = String(r.wins).padStart(6, ' ');
            const losses = String(r.losses).padStart(6, ' ');
            const draws = String(r.draws).padStart(4, ' ');
            const turns = r.avgTurns.toFixed(1).padStart(8, ' ');
            
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
            console.log(`${medal}${rank} │ ${alpha}  │ ${risk} │ ${winRate} │ ${wins} │ ${losses} │ ${draws} │ ${turns}`);
        }
        
        console.log('─────┴───────┴──────┴────────┴────────┴────────┴──────┴──────────');
        console.log('');
        
        // 最优参数
        const best = sorted[0];
        console.log('🏆 最优参数组合:');
        console.log(`   alpha: ${best.config.alpha}`);
        console.log(`   riskAwareness: ${best.config.riskAwareness}`);
        console.log(`   综合胜率: ${(best.winRate * 100).toFixed(2)}%`);
        console.log('');
        
        // 保存到文件
        if (this.config.outputFile) {
            const output = {
                config: this.config,
                results: sorted,
                timestamp: new Date().toISOString()
            };
            writeFileSync(this.config.outputFile, JSON.stringify(output, null, 2));
            console.log(`📁 结果已保存到: ${this.config.outputFile}`);
        }
    }
    
    /**
     * 终止所有 Worker
     */
    terminate() {
        for (const worker of this.workers) {
            worker.terminate();
        }
    }
}

// ============================================================================
// 主入口
// ============================================================================

async function main() {
    const config = parseArgs();
    
    console.log('');
    console.log('🎯 配置:', config.description || '自定义');
    
    const search = new ParallelGridSearch(config);
    
    try {
        await search.run();
    } catch (error) {
        console.error('❌ 搜索失败:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
