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

// Elo 评分参数
const ELO_SETTINGS = {
    baseRating: 150,
    kFactor: 24,
    drawScore: 0.5          // 平局得分（0.5=传统ELO，0=平局不加分）
};

const DISPLAY_TOP_N = 10;

// 早停机制配置
const EARLY_STOP_CONFIG = {
    enabled: true,                  // 是否启用早停
    minGamesBeforeStop: 30,         // 淘汰前最少对局数
    checkIntervalPercent: 0.1,      // 检查频率（多少进度检查一次）
    
    // 阶段控制
    explorationPhase: 0.3,          // 探索期比例（前多少不淘汰）
    eliminationPhase: 0.9,          // 淘汰截止比例（后多少不再淘汰）
    
    // 淘汰阈值
    eloThreshold: -20,              // ELO 低于基准多少时淘汰
    confidenceLevel: 0.95,          // 置信水平（95%）
    winRateAbsoluteFloor: 0.001,     // 胜率绝对下限（低于此值直接淘汰）
    
    // 安全措施
    minSurvivors: 10,                // 至少保留 N 个配置
    maxEliminatePerCheck: 0.618      // 每次检查最多淘汰 61.8%
};
// Fisher-Yates 洗牌，随机化任务顺序
function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

// 更兼容的清屏（ANSI 序列）
function clearScreen() {
    try {
        process.stdout.write('\x1b[2J\x1b[0f');
    } catch (_) {
        console.clear();
    }
}

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
        alphaRange: [0.75, 0.75, 0.025],
        riskRange: [0.7, 0.9, 0.025],
        gamesPerPair: 6,
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
    constructor(config, options = {}) {
        this.config = config;
        this.silent = options.silent || false;  // 静默模式（Web API 使用）
        this.workers = [];
        this.taskQueue = [];
        this.results = new Map();      // configKey -> stats
        this.matchResults = [];        // 所有对战结果
        this.eloRatings = new Map();    // configKey -> rating
        this.pendingTasks = 0;
        this.completedTasks = 0;
        this.totalTasks = 0;
        this.startTime = null;
        this.readyWorkers = 0;
        this.status = 'idle';          // idle/running/done/error
        
        // 早停机制状态
        this.eliminatedConfigs = new Set();  // 已淘汰的配置
        this.lastCheckProgress = 0;           // 上次检查时的进度
        this.earlyStopStats = {               // 早停统计
            totalEliminated: 0,
            tasksSaved: 0,
            checksPerformed: 0
        };
    }
    
    /**
     * 获取当前进度和榜单（供 Web API 使用）
     */
    getProgress() {
        const progress = this.totalTasks > 0 ? this.completedTasks / this.totalTasks : 0;
        const elapsed = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
        const speed = elapsed > 0 ? this.completedTasks / elapsed : 0;
        const eta = speed > 0 ? (this.totalTasks - this.completedTasks) / speed : 0;
        
        return {
            status: this.status,
            progress,
            completed: this.completedTasks,
            total: this.totalTasks,
            elapsed,
            eta,
            speed,
            winTop: this.completedTasks > 0 ? this.getSortedResults() : [],
            eloTop: this.completedTasks > 0 ? this.getSortedByElo() : []
        };
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
            this.eloRatings.set(key, ELO_SETTINGS.baseRating);
        }
    }
    
    /**
     * 创建 Worker 池
     */
    async createWorkerPool() {
        const workerCount = this.config.workers;
        const workerPath = join(__dirname, 'worker.js');
        
        return new Promise((resolve, reject) => {
            let initErrors = [];
            
            for (let i = 0; i < workerCount; i++) {
                try {
                    const worker = new Worker(workerPath, {
                        workerData: { workerId: i }
                    });
                    
                    worker.on('message', (msg) => this.handleWorkerMessage(worker, msg));
                    worker.on('error', (err) => {
                        console.error(`\n❌ Worker ${i} 错误:`, err.message);
                        initErrors.push(`Worker ${i}: ${err.message}`);
                    });
                    worker.on('exit', (code) => {
                        // terminate() 会导致 code=1，这是正常的
                        if (code !== 0 && code !== 1 && !this.terminatingWorkers) {
                            const msg = `Worker ${i} 异常退出，代码: ${code}`;
                            console.error(`\n❌ ${msg}`);
                            initErrors.push(msg);
                        }
                    });
                    
                    this.workers.push(worker);
                } catch (err) {
                    console.error(`\n❌ 创建 Worker ${i} 失败:`, err.message);
                    initErrors.push(`创建 Worker ${i}: ${err.message}`);
                }
            }
            
            // 等待所有 Worker 就绪
            const checkReady = setInterval(() => {
                if (this.readyWorkers >= workerCount) {
                    clearInterval(checkReady);
                    resolve();
                }
            }, 50);
            
            // 超时（增加到 30 秒，允许更长的模块加载时间）
            setTimeout(() => {
                clearInterval(checkReady);
                if (this.readyWorkers >= workerCount) {
                    resolve();
                } else {
                    const msg = `Worker 初始化超时（${this.readyWorkers}/${workerCount} 就绪）\n` +
                                `可能原因：\n` +
                                `1. Worker 数量过多（当前${workerCount}），尝试减少 --workers 参数\n` +
                                `2. 模块导入失败，检查是否有语法错误或循环依赖`;
                    reject(new Error(msg));
                }
            }, 30000);
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
            // 区分初始化错误和任务执行错误
            if (msg.phase) {
                console.error(`\n❌ Worker ${msg.workerId} 初始化失败 (${msg.phase}):`, msg.error);
                console.error(msg.stack);
            } else {
                console.error(`\n❌ 任务 ${msg.taskId} 执行错误:`, msg.error);
                this.completedTasks++;
                this.pendingTasks--;
                this.tryAssignTask(worker);
            }
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
     * 早停检查：评估并淘汰表现不佳的配置
     */
    checkEarlyStop() {
        if (!EARLY_STOP_CONFIG.enabled) return;
        
        const progress = this.totalTasks > 0 ? this.completedTasks / this.totalTasks : 0;
        
        // 检查是否到达检查点
        if (progress < this.lastCheckProgress + EARLY_STOP_CONFIG.checkIntervalPercent) {
            return;  // 未到检查点
        }
        
        // 探索期或淘汰期结束后不再淘汰
        if (progress < EARLY_STOP_CONFIG.explorationPhase || progress > EARLY_STOP_CONFIG.eliminationPhase) {
            this.lastCheckProgress = progress;
            return;
        }
        
        this.earlyStopStats.checksPerformed++;
        this.lastCheckProgress = progress;
        
        // 收集所有存活配置的统计信息
        const aliveConfigs = [];
        for (const [key, stats] of this.results.entries()) {
            if (this.eliminatedConfigs.has(key)) continue;
            if (stats.games < EARLY_STOP_CONFIG.minGamesBeforeStop) continue;
            
            const elo = this.eloRatings.get(key) ?? ELO_SETTINGS.baseRating;
            const winRate = stats.games > 0 ? stats.wins / stats.games : 0;
            
            aliveConfigs.push({ key, stats, elo, winRate });
        }
        
        if (aliveConfigs.length <= EARLY_STOP_CONFIG.minSurvivors) {
            return;  // 已达最少存活数，不再淘汰
        }
        
        // 计算基准 ELO（中位数）
        const sortedByElo = [...aliveConfigs].sort((a, b) => b.elo - a.elo);
        const medianElo = sortedByElo[Math.floor(sortedByElo.length / 2)]?.elo ?? ELO_SETTINGS.baseRating;
        
        // 识别待淘汰配置
        const candidates = [];
        for (const config of aliveConfigs) {
            let shouldEliminate = false;
            let reason = '';
            
            // 条件1: ELO 远低于中位数
            if (config.elo < medianElo + EARLY_STOP_CONFIG.eloThreshold) {
                shouldEliminate = true;
                reason = `ELO低于基准 (${config.elo.toFixed(1)} < ${medianElo.toFixed(1)})`;
            }
            
            // 条件2: 胜率低于绝对下限
            if (config.winRate < EARLY_STOP_CONFIG.winRateAbsoluteFloor) {
                shouldEliminate = true;
                reason = `胜率过低 (${(config.winRate * 100).toFixed(1)}% < ${(EARLY_STOP_CONFIG.winRateAbsoluteFloor * 100).toFixed(1)}%)`;
            }
            
            // 条件3: 置信区间检验（Wilson Score）
            if (config.stats.games >= 20) {
                const p = config.winRate;
                const n = config.stats.games;
                const z = 1.96;  // 95% 置信度
                const upperBound = (p + z*z/(2*n) + z * Math.sqrt((p*(1-p) + z*z/(4*n))/n)) / (1 + z*z/n);
                const baselineWinRate = 0.5;  // 循环赛中期望胜率
                
                if (upperBound < baselineWinRate - 0.08) {  // 置信上界远低于 50%
                    shouldEliminate = true;
                    reason = `置信上界过低 (${(upperBound * 100).toFixed(1)}%)`;
                }
            }
            
            if (shouldEliminate) {
                candidates.push({ ...config, reason });
            }
        }
        
        // 限制单次淘汰数量
        const maxEliminate = Math.floor(aliveConfigs.length * EARLY_STOP_CONFIG.maxEliminatePerCheck);
        const toEliminate = candidates
            .sort((a, b) => a.elo - b.elo)  // 优先淘汰 ELO 最低的
            .slice(0, maxEliminate)
            .filter(() => aliveConfigs.length - this.eliminatedConfigs.size > EARLY_STOP_CONFIG.minSurvivors);
        
        // 执行淘汰
        for (const config of toEliminate) {
            this.eliminatedConfigs.add(config.key);
            this.earlyStopStats.totalEliminated++;
            
            if (!this.silent) {
                console.log(`\n⛔ 淘汰配置: ${config.key} | ${config.reason}`);
            }
        }
        
        // 统计节省的任务数
        if (toEliminate.length > 0) {
            this.calculateTasksSaved();
        }
    }
    
    /**
     * 计算早停节省的任务数
     */
    calculateTasksSaved() {
        let saved = 0;
        const eliminatedSet = this.eliminatedConfigs;
        
        // 检查任务队列中有多少涉及已淘汰配置的任务
        for (const task of this.taskQueue) {
            if (eliminatedSet.has(task.keyA) || eliminatedSet.has(task.keyB)) {
                saved++;
            }
        }
        
        this.earlyStopStats.tasksSaved = saved;
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

        // 更新 Elo 评分
        this.updateEloRatings({ keyA, keyB, winsA, winsB, draws, totalGames });
        
        // 检查早停条件
        this.checkEarlyStop();
    }

    /**
     * 批量更新 Elo 评分
     */
    updateEloRatings({ keyA, keyB, winsA, winsB, draws, totalGames }) {
        const ratingA = this.eloRatings.get(keyA) ?? ELO_SETTINGS.baseRating;
        const ratingB = this.eloRatings.get(keyB) ?? ELO_SETTINGS.baseRating;

        const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
        // 使用可配置的平局得分（0.5=传统ELO，0=平局不加分）
        const scoreA = winsA + ELO_SETTINGS.drawScore * draws;
        const scoreB = winsB + ELO_SETTINGS.drawScore * draws;
        const k = ELO_SETTINGS.kFactor;

        const newRatingA = ratingA + k * (scoreA - totalGames * expectedA);
        const newRatingB = ratingB + k * (scoreB - totalGames * (1 - expectedA));

        this.eloRatings.set(keyA, newRatingA);
        this.eloRatings.set(keyB, newRatingB);
    }
    
    /**
     * 尝试分配任务给 Worker
     */
    tryAssignTask(worker) {
        // 跳过涉及已淘汰配置的任务
        while (this.taskQueue.length > 0) {
            const task = this.taskQueue[0];
            
            // 检查任务是否涉及已淘汰的配置
            if (this.eliminatedConfigs.has(task.keyA) || this.eliminatedConfigs.has(task.keyB)) {
                this.taskQueue.shift();  // 丢弃该任务
                this.completedTasks++;    // 计入已完成（跳过）
                continue;
            }
            
            // 分配有效任务
            this.taskQueue.shift();
            worker.postMessage(task);
            this.pendingTasks++;
            return;
        }
        
        // 队列为空且无待处理任务时完成
        if (this.pendingTasks === 0 && this.onComplete) {
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
        
        // 构建进度消息，包含早停信息
        let msg = this.completedTasks === 0
            ? `⏳ 进度: 0/${this.totalTasks} (0%) | 已用: ${elapsed.toFixed(1)}s | 任务执行中...`
            : `⏳ 进度: ${this.completedTasks}/${this.totalTasks} (${percent}%) | 已用: ${elapsed.toFixed(1)}s | 预计剩余: ${eta.toFixed(0)}s | 速度: ${speed.toFixed(1)}任务/s`;
        
        if (EARLY_STOP_CONFIG.enabled && this.earlyStopStats.totalEliminated > 0) {
            const totalConfigs = this.results.size;
            const aliveConfigs = totalConfigs - this.eliminatedConfigs.size;
            msg += ` | 🔍 存活: ${aliveConfigs}/${totalConfigs} | 已省: ${this.earlyStopStats.tasksSaved}任务`;
        }

        // 静默模式：只输出简化进度，不清屏不输出榜单
        if (this.silent) {
            process.stdout.clearLine?.(0);
            process.stdout.cursorTo?.(0);
            process.stdout.write(msg);
            return;
        }

        // 清屏刷新，避免堆叠
        clearScreen();

        console.log(msg);

        if (this.completedTasks > 0) {
            const liveTop = Math.min(100, DISPLAY_TOP_N);
            const winTop = this.getSortedResults().slice(0, liveTop);
            const eloTop = this.getSortedByElo().slice(0, liveTop);

            // 胜率榜
            console.log('');
            console.log('🏅 胜率榜');
            console.log('排名 │ Alpha │ Risk │  胜率  │   胜   │   负   │  平  │ 对局 │ Elo');
            console.log('─────┼───────┼──────┼────────┼────────┼────────┼──────┼──────┼──────');
            winTop.forEach((r, i) => {
                const rank = String(i + 1).padStart(3, ' ');
                const alpha = r.config.alpha.toFixed(2);
                const risk = r.config.riskAwareness.toFixed(2);
                const winRate = (r.winRate * 100).toFixed(1).padStart(5, ' ') + '%';
                const wins = String(r.wins).padStart(6, ' ');
                const losses = String(r.losses).padStart(6, ' ');
                const draws = String(r.draws).padStart(4, ' ');
                const games = String(r.games).padStart(4, ' ');
                const elo = (this.eloRatings.get(r.key) ?? ELO_SETTINGS.baseRating).toFixed(1).padStart(6, ' ');
                console.log(`${rank} │ ${alpha}  │ ${risk} │ ${winRate} │ ${wins} │ ${losses} │ ${draws} │ ${games} │ ${elo}`);
            });

            // Elo 榜
            console.log('');
            console.log('📈 Elo 榜');
            console.log('排名 │ Alpha │ Risk │   Elo   │  胜率  │ 对局');
            console.log('─────┼───────┼──────┼─────────┼────────┼──────');
            eloTop.forEach((r, i) => {
                const rank = String(i + 1).padStart(3, ' ');
                const alpha = r.config.alpha.toFixed(2);
                const risk = r.config.riskAwareness.toFixed(2);
                const elo = (this.eloRatings.get(r.key) ?? ELO_SETTINGS.baseRating).toFixed(1).padStart(7, ' ');
                const winRate = (r.winRate * 100).toFixed(1).padStart(5, ' ') + '%';
                const games = String(r.games).padStart(4, ' ');
                console.log(`${rank} │ ${alpha}  │ ${risk} │ ${elo} │ ${winRate} │ ${games}`);
            });
        }
    }
    
    /**
     * 运行网格搜索
     */
    async run() {
        this.status = 'running';
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
        
        if (EARLY_STOP_CONFIG.enabled) {
            console.log(`🔍 早停机制: 已启用`);
            console.log(`   └─ 探索期: ${(EARLY_STOP_CONFIG.explorationPhase * 100).toFixed(0)}% | 淘汰期: ${(EARLY_STOP_CONFIG.explorationPhase * 100).toFixed(0)}-${(EARLY_STOP_CONFIG.eliminationPhase * 100).toFixed(0)}% | 最少对局: ${EARLY_STOP_CONFIG.minGamesBeforeStop}`);
        } else {
            console.log(`🔍 早停机制: 未启用`);
        }
        
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

        // 随机打乱任务顺序，减少批次顺序偏差
        shuffleInPlace(this.taskQueue);
        
        this.totalTasks = this.taskQueue.length;
        
        // 开始执行
        this.startTime = Date.now();
        
        return new Promise((resolve) => {
            this.onComplete = () => {
                // 停止进度刷新
                if (this.progressInterval) {
                    clearInterval(this.progressInterval);
                }
                this.status = 'done';
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
            }, 1000);
            
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
        const results = Array.from(this.results.entries()).map(([key, stats]) => ({
            ...stats,
            key,
            elo: this.eloRatings.get(key) ?? ELO_SETTINGS.baseRating,
            winRate: stats.games > 0 ? stats.wins / stats.games : 0,
            avgTurns: stats.games > 0 ? stats.totalTurns / stats.games : 0
        }));
        
        return results.sort((a, b) => b.winRate - a.winRate);
    }

    /**
     * 按 Elo 排序
     */
    getSortedByElo() {
        const results = Array.from(this.results.entries()).map(([key, stats]) => ({
            ...stats,
            key,
            elo: this.eloRatings.get(key) ?? ELO_SETTINGS.baseRating,
            winRate: stats.games > 0 ? stats.wins / stats.games : 0,
            avgTurns: stats.games > 0 ? stats.totalTurns / stats.games : 0
        }));

        return results.sort((a, b) => b.elo - a.elo);
    }
    
    /**
     * 打印结果
     */
    printResults() {
        const sorted = this.getSortedResults();
        const eloSorted = this.getSortedByElo();
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log(`✅ 搜索完成！总耗时 ${elapsed} 秒`);
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log('');
        
        // 显示早停统计
        if (EARLY_STOP_CONFIG.enabled && this.earlyStopStats.totalEliminated > 0) {
            const totalConfigs = this.results.size;
            const aliveConfigs = totalConfigs - this.eliminatedConfigs.size;
            const savedPercent = (this.earlyStopStats.tasksSaved / this.totalTasks * 100).toFixed(1);
            
            console.log('🔍 早停机制统计');
            console.log('───────────────────────────────────────────────────────────────────');
            console.log(`   总配置数: ${totalConfigs}`);
            console.log(`   淘汰配置: ${this.earlyStopStats.totalEliminated}`);
            console.log(`   存活配置: ${aliveConfigs}`);
            console.log(`   检查次数: ${this.earlyStopStats.checksPerformed}`);
            console.log(`   节省任务: ${this.earlyStopStats.tasksSaved} (${savedPercent}%)`);
            console.log('───────────────────────────────────────────────────────────────────');
            console.log('');
        }
        
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

        console.log('📈 Elo 排名');
        console.log('');
        console.log('排名 │ Alpha │ Risk │   Elo   │  胜率  │  对局');
        console.log('─────┼───────┼──────┼─────────┼────────┼──────');
        const eloTopN = Math.min(20, eloSorted.length);
        for (let i = 0; i < eloTopN; i++) {
            const r = eloSorted[i];
            const rank = String(i + 1).padStart(3, ' ');
            const alpha = r.config.alpha.toFixed(2);
            const risk = r.config.riskAwareness.toFixed(2);
            const elo = r.elo.toFixed(1).padStart(7, ' ');
            const winRate = (r.winRate * 100).toFixed(1).padStart(5, ' ') + '%';
            const games = String(r.games).padStart(4, ' ');
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
            console.log(`${medal}${rank} │ ${alpha}  │ ${risk} │ ${elo} │ ${winRate} │ ${games}`);
        }
        console.log('─────┴───────┴──────┴─────────┴────────┴──────');
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
     * 暂停执行
     */
    pause() {
        if (this.status === 'running') {
            this.status = 'paused';
            if (this.progressInterval) {
                clearInterval(this.progressInterval);
                this.progressInterval = null;
            }
        }
    }
    
    /**
     * 恢复执行
     */
    resume() {
        if (this.status === 'paused') {
            this.status = 'running';
            // 恢复进度刷新
            this.progressInterval = setInterval(() => {
                this.printProgress();
            }, 1000);
        }
    }
    
    /**
     * 完全终止所有 Worker（不可恢复）
     */
    terminate() {
        this.status = 'terminated';
        this.terminatingWorkers = true;  // 标志避免 exit 事件误报错误
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
    }
}

// ============================================================================
// 导出类供 Web 服务使用
// ============================================================================

export { ParallelGridSearch, PRESETS, EARLY_STOP_CONFIG };

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
        search.status = 'error';
        console.error('❌ 搜索失败:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 仅在直接运行时执行 main（通过命令行）
// 当被 import 时不执行
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}

