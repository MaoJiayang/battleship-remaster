/**
 * 参数网格搜索模块（循环赛模式 - 单线程版）
 * 
 * 用于在后台对 AI 参数 (alpha, riskAwareness) 进行网格搜索，
 * 通过所有参数组合互相对战的循环赛方式找到全局最优参数。
 * 
 * ============================================================================
 * 使用方法
 * ============================================================================
 * 
 * 1. 打开可视化界面：
 *    GridSearch.openUI()  // 在浏览器中打开调参界面
 * 
 * 2. 控制台快捷调用：
 *    GridSearch.runQuickSearch()   // 快速搜索
 *    GridSearch.runFullSearch()    // 完整搜索
 *    GridSearch.compare(configA, configB, games)  // 对比两个配置
 * 
 * ============================================================================
 * 循环赛规则
 * ============================================================================
 * 
 * - 每个参数组合与其他所有组合各进行 N 场对战（先后手各半）
 * - 综合胜率 = 总胜场 / 总场次
 * - 消除先后手优势，得到公平的参数评估
 * - 单线程串行执行，确保 UI 实时更新
 */

import { runSimulatedGameWithProgress, runSimulationBatch } from './SimulationEngine.js';

// ============================================================================
// 默认配置（已移除并发相关配置）
// ============================================================================

/** 默认网格搜索配置 */
const DEFAULT_GRID_CONFIG = {
    // alpha 搜索范围 [min, max, step]
    alphaRange: [0.3, 0.7, 0.1],
    
    // riskAwareness 搜索范围 [min, max, step]
    riskRange: [0.0, 0.4, 0.1],
    
    // 每对配置的对战次数（先后手各半）
    gamesPerPair: 20,
    
    // 测试配置的 randomness（通常设为 0 以测试纯策略）
    testRandomness: 0,
    
    // 是否输出详细进度
    verbose: true
};

/** 快速搜索配置（用于快速测试） */
const QUICK_CONFIG = {
    alphaRange: [0.3, 0.7, 0.2],
    riskRange: [0.0, 0.4, 0.2],
    gamesPerPair: 10,
    verbose: true
};

/** 完整搜索配置（用于精确调优） */
const FULL_CONFIG = {
    alphaRange: [0.1, 0.9, 0.1],
    riskRange: [0.0, 0.6, 0.1],
    gamesPerPair: 30,
    verbose: true
};

// ============================================================================
// 网格搜索控制器（单线程串行模式）
// ============================================================================

/**
 * 网格搜索控制器
 * 
 * 使用循环赛模式，每个参数组合与所有其他组合对战
 * 单线程串行执行，每步都让出主线程确保 UI 更新
 */
export class GridSearchController {
    constructor(config = {}) {
        this.config = { ...DEFAULT_GRID_CONFIG, ...config };
        this.grid = [];           // 参数网格
        this.results = new Map(); // configKey -> { wins, losses, draws, games }
        this.matchResults = [];   // 所有对战结果
        this.isRunning = false;
        this.shouldStop = false;
        this.progress = { 
            current: 0, 
            total: 0, 
            phase: '',
            currentMatch: null,    // 当前对战信息
            currentGame: 0,        // 当前对战中的第几场
            currentTurn: 0,        // 当前模拟中的第几步
            totalGames: 0          // 总场次
        };
        this.onProgress = null;   // 进度回调
        this.onComplete = null;   // 完成回调
    }
    
    /**
     * 生成参数网格
     */
    _generateGrid() {
        const { alphaRange, riskRange, testRandomness } = this.config;
        const [alphaMin, alphaMax, alphaStep] = alphaRange;
        const [riskMin, riskMax, riskStep] = riskRange;
        
        const grid = [];
        
        for (let alpha = alphaMin; alpha <= alphaMax + 1e-9; alpha += alphaStep) {
            for (let risk = riskMin; risk <= riskMax + 1e-9; risk += riskStep) {
                grid.push({
                    alpha: Math.round(alpha * 100) / 100,
                    riskAwareness: Math.round(risk * 100) / 100,
                    randomness: testRandomness
                });
            }
        }
        
        return grid;
    }
    
    /**
     * 生成配置的唯一键
     */
    _configKey(config) {
        return `α${config.alpha.toFixed(2)}_r${config.riskAwareness.toFixed(2)}`;
    }
    
    /**
     * 生成所有对战配对（循环赛）
     */
    _generateMatchups() {
        const matchups = [];
        
        for (let i = 0; i < this.grid.length; i++) {
            for (let j = i + 1; j < this.grid.length; j++) {
                matchups.push({
                    configA: this.grid[i],
                    configB: this.grid[j],
                    keyA: this._configKey(this.grid[i]),
                    keyB: this._configKey(this.grid[j])
                });
            }
        }
        
        return matchups;
    }
    
    /**
     * 初始化结果存储
     */
    _initResults() {
        this.results.clear();
        
        for (const config of this.grid) {
            const key = this._configKey(config);
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
     * 开始网格搜索（单线程串行）
     */
    async start() {
        if (this.isRunning) {
            console.warn('⚠️ 网格搜索已在运行中');
            return;
        }
        
        this.isRunning = true;
        this.shouldStop = false;
        this.matchResults = [];
        
        // 生成网格和配对
        this.grid = this._generateGrid();
        const matchups = this._generateMatchups();
        this._initResults();
        
        const totalMatches = matchups.length;
        const gamesPerMatch = this.config.gamesPerPair;
        const totalGames = totalMatches * gamesPerMatch;
        
        this.progress = { 
            current: 0, 
            total: totalMatches, 
            phase: '准备中',
            currentMatch: null,
            currentGame: 0,
            currentTurn: 0,
            totalGames
        };
        
        console.log('');
        console.log('🔍 ═══════════════════════════════════════════════════════════════');
        console.log('   参数网格搜索 - 循环赛模式（单线程）');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log(`📊 参数组合数: ${this.grid.length}`);
        console.log(`⚔️  对战配对数: ${totalMatches}`);
        console.log(`🎮 每对对战场次: ${gamesPerMatch}`);
        console.log(`📈 总对战场次: ${totalGames}`);
        console.log('───────────────────────────────────────────────────────────────────');
        console.log('');
        
        const startTime = Date.now();
        this.progress.phase = '对战中';
        
        // 逐个串行执行每个配对
        for (let matchIndex = 0; matchIndex < matchups.length; matchIndex++) {
            if (this.shouldStop) {
                console.log('⏹️ 搜索已中止');
                break;
            }
            
            const matchup = matchups[matchIndex];
            this.progress.currentMatch = {
                configA: `α=${matchup.configA.alpha}, r=${matchup.configA.riskAwareness}`,
                configB: `α=${matchup.configB.alpha}, r=${matchup.configB.riskAwareness}`
            };
            
            // 执行这一对配置的所有对战
            const result = await this._runMatchupWithProgress(matchup);
            this._recordMatchResult(result);
            
            this.progress.current = matchIndex + 1;
            
            // 更新进度
            if (this.onProgress) {
                this.onProgress(this.getProgressInfo());
            }
            
            // 让出主线程
            await this._yieldToUI();
            
            // 控制台进度
            if (this.config.verbose && this.progress.current % Math.max(1, Math.floor(totalMatches / 20)) === 0) {
                const percent = Math.round(this.progress.current / this.progress.total * 100);
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                const eta = this.progress.current > 0 
                    ? ((Date.now() - startTime) / this.progress.current * (totalMatches - this.progress.current) / 1000).toFixed(0)
                    : '?';
                console.log(`📈 进度: ${this.progress.current}/${totalMatches} (${percent}%) | 已用 ${elapsed}s | 预计剩余 ${eta}s`);
            }
        }
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this.progress.phase = '完成';
        
        console.log('');
        console.log(`✅ 搜索完成！总耗时 ${elapsed} 秒`);
        
        // 输出结果
        const sortedResults = this._getSortedResults();
        this._printResults(sortedResults);
        
        // 完成回调
        if (this.onComplete) {
            this.onComplete(sortedResults);
        }
        
        this.isRunning = false;
        return sortedResults;
    }
    
    /**
     * 让出主线程给 UI 更新
     */
    async _yieldToUI() {
        return new Promise(resolve => {
            if (typeof requestAnimationFrame !== 'undefined') {
                requestAnimationFrame(() => setTimeout(resolve, 0));
            } else {
                setTimeout(resolve, 0);
            }
        });
    }
    
    /**
     * 停止搜索
     */
    stop() {
        this.shouldStop = true;
        console.log('🛑 正在停止搜索...');
    }
    
    /**
     * 运行单个配对的所有对战（带进度更新）
     */
    async _runMatchupWithProgress(matchup) {
        const { configA, configB, keyA, keyB } = matchup;
        const halfGames = Math.floor(this.config.gamesPerPair / 2);
        
        let winsA = 0, winsB = 0, draws = 0;
        let totalTurns = 0;
        
        // A 先手的对战
        for (let g = 0; g < halfGames; g++) {
            if (this.shouldStop) break;
            
            this.progress.currentGame = g + 1;
            this.progress.currentTurn = 0;
            
            const result = await this._runSingleGameWithProgress(configA, configB);
            
            if (result.winner === 'A') winsA++;
            else if (result.winner === 'B') winsB++;
            else draws++;
            totalTurns += result.stats.turns;
            
            // 每场对战后让出主线程并更新进度
            if (this.onProgress) {
                this.onProgress(this.getProgressInfo());
            }
            await this._yieldToUI();
        }
        
        // B 先手的对战（交换位置）
        for (let g = 0; g < halfGames; g++) {
            if (this.shouldStop) break;
            
            this.progress.currentGame = halfGames + g + 1;
            this.progress.currentTurn = 0;
            
            const result = await this._runSingleGameWithProgress(configB, configA);
            
            // 注意：这里 B 是先手，所以结果要反过来
            if (result.winner === 'A') winsB++;  // A 赢了但 A 是后手（原配置B）
            else if (result.winner === 'B') winsA++;  // B 赢了但 B 是后手（原配置A）
            else draws++;
            totalTurns += result.stats.turns;
            
            // 每场对战后让出主线程并更新进度
            if (this.onProgress) {
                this.onProgress(this.getProgressInfo());
            }
            await this._yieldToUI();
        }
        
        return {
            keyA, keyB,
            winsA, winsB, draws,
            totalGames: winsA + winsB + draws,
            totalTurns
        };
    }
    
    /**
     * 运行单场对战（带步数进度回调）
     */
    async _runSingleGameWithProgress(configA, configB) {
        // 使用带进度回调的模拟函数
        const self = this;
        return await runSimulatedGameWithProgress(configA, configB, {
            onTurn: (turn) => {
                self.progress.currentTurn = turn;
            },
            yieldInterval: 10  // 每10步让出一次主线程
        });
    }
    
    /**
     * 记录对战结果
     */
    _recordMatchResult(result) {
        const { keyA, keyB, winsA, winsB, draws, totalGames, totalTurns } = result;
        
        // 更新 A 的统计
        const statsA = this.results.get(keyA);
        statsA.wins += winsA;
        statsA.losses += winsB;
        statsA.draws += draws;
        statsA.games += totalGames;
        statsA.totalTurns += totalTurns;
        
        // 更新 B 的统计
        const statsB = this.results.get(keyB);
        statsB.wins += winsB;
        statsB.losses += winsA;
        statsB.draws += draws;
        statsB.games += totalGames;
        statsB.totalTurns += totalTurns;
        
        this.matchResults.push(result);
    }
    
    /**
     * 获取排序后的结果
     */
    _getSortedResults() {
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
    _printResults(sortedResults) {
        if (sortedResults.length === 0) {
            console.log('⚠️ 没有结果');
            return;
        }
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log('📊 循环赛结果排名（按综合胜率）');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log('');
        console.log('排名 │ Alpha │ Risk │  胜率  │   胜   │   负   │  平  │ 平均回合');
        console.log('─────┼───────┼──────┼────────┼────────┼────────┼──────┼──────────');
        
        const topN = Math.min(20, sortedResults.length);
        for (let i = 0; i < topN; i++) {
            const r = sortedResults[i];
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
        const best = sortedResults[0];
        console.log('🏆 最优参数组合:');
        console.log(`   alpha: ${best.config.alpha}`);
        console.log(`   riskAwareness: ${best.config.riskAwareness}`);
        console.log(`   综合胜率: ${(best.winRate * 100).toFixed(2)}%`);
        console.log(`   总对局: ${best.games} 场`);
        console.log('');
        
        // 保存到全局
        window.gridSearchResults = {
            sorted: sortedResults,
            heatmap: this._generateHeatmapData(sortedResults),
            matchResults: this.matchResults
        };
        console.log('📈 完整数据已保存到 window.gridSearchResults');
    }
    
    /**
     * 生成热力图数据
     */
    _generateHeatmapData(sortedResults) {
        const heatmap = {};
        
        for (const r of sortedResults) {
            const key = `${r.config.alpha},${r.config.riskAwareness}`;
            heatmap[key] = r.winRate;
        }
        
        return heatmap;
    }
    
    /**
     * 获取当前进度信息
     */
    getProgressInfo() {
        const sortedResults = this._getSortedResults();
        return {
            ...this.progress,
            percent: this.progress.total > 0 ? this.progress.current / this.progress.total : 0,
            results: sortedResults.slice(0, 10), // 前10名
            isRunning: this.isRunning,
            gamesPerPair: this.config.gamesPerPair
        };
    }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 运行快速网格搜索
 */
export async function runQuickGridSearch() {
    const controller = new GridSearchController(QUICK_CONFIG);
    return await controller.start();
}

/**
 * 运行完整网格搜索
 */
export async function runFullGridSearch() {
    const controller = new GridSearchController(FULL_CONFIG);
    return await controller.start();
}

/**
 * 运行自定义网格搜索
 */
export async function runCustomGridSearch(config) {
    const controller = new GridSearchController(config);
    return await controller.start();
}

/**
 * 比较两个特定配置
 */
export function compareConfigs(configA, configB, games = 100) {
    console.log('⚔️ 配置对比测试...');
    console.log(`   配置 A: alpha=${configA.alpha}, risk=${configA.riskAwareness || 0}`);
    console.log(`   配置 B: alpha=${configB.alpha}, risk=${configB.riskAwareness || 0}`);
    console.log(`   对战次数: ${games}`);
    console.log('');
    
    const fullConfigA = { alpha: 0.5, randomness: 0, riskAwareness: 0, ...configA };
    const fullConfigB = { alpha: 0.5, randomness: 0, riskAwareness: 0, ...configB };
    
    // A 先手
    const resultA = runSimulationBatch(fullConfigA, fullConfigB, Math.floor(games / 2));
    // B 先手
    const resultB = runSimulationBatch(fullConfigB, fullConfigA, Math.floor(games / 2));
    
    const totalWinsA = resultA.winsA + resultB.winsB;
    const totalWinsB = resultA.winsB + resultB.winsA;
    const totalDraws = resultA.draws + resultB.draws;
    const totalGames = totalWinsA + totalWinsB + totalDraws;
    
    console.log('📊 结果:');
    console.log(`   配置 A 胜: ${totalWinsA} (${(totalWinsA/totalGames*100).toFixed(1)}%)`);
    console.log(`   配置 B 胜: ${totalWinsB} (${(totalWinsB/totalGames*100).toFixed(1)}%)`);
    console.log(`   平局: ${totalDraws}`);
    console.log(`   平均回合: ${((resultA.avgTurns + resultB.avgTurns) / 2).toFixed(1)}`);
    
    return {
        winsA: totalWinsA,
        winsB: totalWinsB,
        draws: totalDraws,
        winRateA: totalWinsA / totalGames,
        winRateB: totalWinsB / totalGames
    };
}

// ============================================================================
// 可视化 UI 界面
// ============================================================================

/**
 * 打开网格搜索 UI 界面
 */
export function openGridSearchUI() {
    // 检查是否已存在界面
    if (document.getElementById('grid-search-modal')) {
        document.getElementById('grid-search-modal').style.display = 'flex';
        return;
    }
    
    // 创建模态框
    const modal = document.createElement('div');
    modal.id = 'grid-search-modal';
    modal.innerHTML = createUIHTML();
    document.body.appendChild(modal);
    
    // 添加样式
    if (!document.getElementById('grid-search-styles')) {
        const style = document.createElement('style');
        style.id = 'grid-search-styles';
        style.textContent = createUIStyles();
        document.head.appendChild(style);
    }
    
    // 绑定事件
    bindUIEvents();
}

/**
 * 创建 UI HTML
 */
function createUIHTML() {
    return `
        <div class="gs-overlay" onclick="GridSearch.closeUI()"></div>
        <div class="gs-container">
            <div class="gs-header">
                <h2>🔍 AI 参数网格搜索</h2>
                <button class="gs-close" onclick="GridSearch.closeUI()">×</button>
            </div>
            
            <div class="gs-body">
                <!-- 参数配置区 -->
                <div class="gs-section">
                    <h3>📊 搜索参数配置</h3>
                    <div class="gs-config-grid">
                        <div class="gs-config-group">
                            <label>Alpha 范围</label>
                            <div class="gs-range-inputs">
                                <input type="number" id="gs-alpha-min" value="0.3" min="0" max="1" step="0.1">
                                <span>~</span>
                                <input type="number" id="gs-alpha-max" value="0.7" min="0" max="1" step="0.1">
                                <span>步长</span>
                                <input type="number" id="gs-alpha-step" value="0.1" min="0.05" max="0.5" step="0.05">
                            </div>
                        </div>
                        <div class="gs-config-group">
                            <label>Risk 范围</label>
                            <div class="gs-range-inputs">
                                <input type="number" id="gs-risk-min" value="0.0" min="0" max="1" step="0.1">
                                <span>~</span>
                                <input type="number" id="gs-risk-max" value="0.4" min="0" max="1" step="0.1">
                                <span>步长</span>
                                <input type="number" id="gs-risk-step" value="0.1" min="0.05" max="0.5" step="0.05">
                            </div>
                        </div>
                        <div class="gs-config-group">
                            <label>每对战场次</label>
                            <input type="number" id="gs-games" value="20" min="4" max="200" step="2">
                        </div>
                    </div>
                    
                    <div class="gs-preset-buttons">
                        <button onclick="GridSearch.applyPreset('quick')">⚡ 快速搜索</button>
                        <button onclick="GridSearch.applyPreset('default')">🎯 默认配置</button>
                        <button onclick="GridSearch.applyPreset('full')">🔬 完整搜索</button>
                    </div>
                </div>
                
                <!-- 预估信息 -->
                <div class="gs-section gs-estimate">
                    <div class="gs-estimate-item">
                        <span class="gs-estimate-label">参数组合</span>
                        <span class="gs-estimate-value" id="gs-est-configs">-</span>
                    </div>
                    <div class="gs-estimate-item">
                        <span class="gs-estimate-label">对战配对</span>
                        <span class="gs-estimate-value" id="gs-est-matches">-</span>
                    </div>
                    <div class="gs-estimate-item">
                        <span class="gs-estimate-label">总场次</span>
                        <span class="gs-estimate-value" id="gs-est-games">-</span>
                    </div>
                </div>
                
                <!-- 控制按钮 -->
                <div class="gs-section gs-controls">
                    <button id="gs-start-btn" class="gs-btn-primary" onclick="GridSearch.startSearch()">
                        🚀 开始搜索
                    </button>
                    <button id="gs-stop-btn" class="gs-btn-danger" onclick="GridSearch.stopSearch()" disabled>
                        ⏹️ 停止
                    </button>
                </div>
                
                <!-- 进度区 -->
                <div class="gs-section gs-progress-section" id="gs-progress-section" style="display:none">
                    <h3>⏳ 搜索进度</h3>
                    <div class="gs-progress-bar">
                        <div class="gs-progress-fill" id="gs-progress-fill"></div>
                    </div>
                    <div class="gs-progress-text" id="gs-progress-text">准备中...</div>
                    <div class="gs-progress-detail" id="gs-progress-detail"></div>
                </div>
                
                <!-- 实时结果 -->
                <div class="gs-section gs-results-section" id="gs-results-section" style="display:none">
                    <h3>📈 实时排名 (前10)</h3>
                    <div class="gs-results-table-wrapper">
                        <table class="gs-results-table" id="gs-results-table">
                            <thead>
                                <tr>
                                    <th>排名</th>
                                    <th>Alpha</th>
                                    <th>Risk</th>
                                    <th>胜率</th>
                                    <th>胜/负/平</th>
                                </tr>
                            </thead>
                            <tbody id="gs-results-tbody">
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <!-- 热力图 -->
                <div class="gs-section gs-heatmap-section" id="gs-heatmap-section" style="display:none">
                    <h3>🌡️ 胜率热力图</h3>
                    <div class="gs-heatmap" id="gs-heatmap"></div>
                </div>
            </div>
        </div>
    `;
}

/**
 * 创建 UI 样式
 */
function createUIStyles() {
    return `
        #grid-search-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        }
        
        .gs-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
        }
        
        .gs-container {
            position: relative;
            background: #1a1a2e;
            border-radius: 12px;
            width: 90%;
            max-width: 800px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            border: 1px solid #333;
        }
        
        .gs-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 24px;
            border-bottom: 1px solid #333;
            background: #16213e;
            border-radius: 12px 12px 0 0;
        }
        
        .gs-header h2 {
            margin: 0;
            color: #fff;
            font-size: 20px;
        }
        
        .gs-close {
            background: none;
            border: none;
            color: #888;
            font-size: 28px;
            cursor: pointer;
            padding: 0;
            line-height: 1;
        }
        
        .gs-close:hover { color: #fff; }
        
        .gs-body { padding: 20px 24px; }
        
        .gs-section { margin-bottom: 20px; }
        
        .gs-section h3 {
            color: #4cc9f0;
            font-size: 14px;
            margin: 0 0 12px 0;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .gs-config-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
        }
        
        .gs-config-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        
        .gs-config-group label {
            color: #aaa;
            font-size: 12px;
        }
        
        .gs-range-inputs {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .gs-range-inputs span { color: #666; }
        
        .gs-config-group input {
            background: #0f0f1a;
            border: 1px solid #333;
            border-radius: 6px;
            padding: 8px 12px;
            color: #fff;
            font-size: 14px;
            width: 60px;
        }
        
        .gs-config-group input:focus {
            outline: none;
            border-color: #4cc9f0;
        }
        
        .gs-preset-buttons {
            display: flex;
            gap: 10px;
            margin-top: 16px;
        }
        
        .gs-preset-buttons button {
            flex: 1;
            padding: 10px;
            background: #252540;
            border: 1px solid #333;
            border-radius: 6px;
            color: #fff;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s;
        }
        
        .gs-preset-buttons button:hover {
            background: #333355;
            border-color: #4cc9f0;
        }
        
        .gs-estimate {
            display: flex;
            justify-content: space-around;
            background: #0f0f1a;
            border-radius: 8px;
            padding: 16px;
        }
        
        .gs-estimate-item { text-align: center; }
        
        .gs-estimate-label {
            display: block;
            color: #666;
            font-size: 12px;
            margin-bottom: 4px;
        }
        
        .gs-estimate-value {
            color: #4cc9f0;
            font-size: 20px;
            font-weight: bold;
        }
        
        .gs-controls {
            display: flex;
            gap: 12px;
        }
        
        .gs-btn-primary {
            flex: 2;
            padding: 14px 24px;
            background: linear-gradient(135deg, #4cc9f0, #7209b7);
            border: none;
            border-radius: 8px;
            color: #fff;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .gs-btn-primary:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(76, 201, 240, 0.4);
        }
        
        .gs-btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .gs-btn-danger {
            flex: 1;
            padding: 14px 24px;
            background: #dc3545;
            border: none;
            border-radius: 8px;
            color: #fff;
            font-size: 16px;
            cursor: pointer;
        }
        
        .gs-btn-danger:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .gs-progress-bar {
            height: 20px;
            background: #0f0f1a;
            border-radius: 10px;
            overflow: hidden;
            margin-bottom: 8px;
        }
        
        .gs-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #4cc9f0, #7209b7);
            width: 0%;
            transition: width 0.3s;
        }
        
        .gs-progress-text {
            color: #fff;
            font-size: 14px;
            text-align: center;
            margin-bottom: 4px;
        }
        
        .gs-progress-detail {
            color: #888;
            font-size: 12px;
            text-align: center;
            font-family: monospace;
        }
        
        .gs-results-table-wrapper {
            max-height: 300px;
            overflow-y: auto;
        }
        
        .gs-results-table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .gs-results-table th,
        .gs-results-table td {
            padding: 10px 12px;
            text-align: center;
            border-bottom: 1px solid #333;
        }
        
        .gs-results-table th {
            background: #16213e;
            color: #4cc9f0;
            font-size: 12px;
            text-transform: uppercase;
            position: sticky;
            top: 0;
        }
        
        .gs-results-table td {
            color: #fff;
            font-size: 14px;
        }
        
        .gs-results-table tr:hover td { background: #252540; }
        
        .gs-rank-1 { color: #ffd700 !important; font-weight: bold; }
        .gs-rank-2 { color: #c0c0c0 !important; }
        .gs-rank-3 { color: #cd7f32 !important; }
        
        .gs-heatmap {
            display: grid;
            gap: 2px;
            padding: 10px;
            background: #0f0f1a;
            border-radius: 8px;
        }
        
        .gs-heatmap-cell {
            width: 100%;
            aspect-ratio: 1;
            border-radius: 4px;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 10px;
            color: #fff;
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .gs-heatmap-cell:hover {
            transform: scale(1.1);
            z-index: 1;
        }
        
        .gs-heatmap-label {
            color: #666;
            font-size: 11px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
    `;
}

/**
 * 绑定 UI 事件
 */
function bindUIEvents() {
    const inputs = ['gs-alpha-min', 'gs-alpha-max', 'gs-alpha-step', 
                   'gs-risk-min', 'gs-risk-max', 'gs-risk-step', 'gs-games'];
    inputs.forEach(id => {
        document.getElementById(id).addEventListener('input', updateEstimate);
    });
    updateEstimate();
}

/**
 * 更新预估数据
 */
function updateEstimate() {
    const alphaMin = parseFloat(document.getElementById('gs-alpha-min').value) || 0;
    const alphaMax = parseFloat(document.getElementById('gs-alpha-max').value) || 1;
    const alphaStep = parseFloat(document.getElementById('gs-alpha-step').value) || 0.1;
    const riskMin = parseFloat(document.getElementById('gs-risk-min').value) || 0;
    const riskMax = parseFloat(document.getElementById('gs-risk-max').value) || 1;
    const riskStep = parseFloat(document.getElementById('gs-risk-step').value) || 0.1;
    const games = parseInt(document.getElementById('gs-games').value) || 20;
    
    const alphaCount = Math.floor((alphaMax - alphaMin) / alphaStep) + 1;
    const riskCount = Math.floor((riskMax - riskMin) / riskStep) + 1;
    const configs = alphaCount * riskCount;
    const matches = configs * (configs - 1) / 2;
    const totalGames = matches * games;
    
    document.getElementById('gs-est-configs').textContent = configs;
    document.getElementById('gs-est-matches').textContent = matches;
    document.getElementById('gs-est-games').textContent = totalGames.toLocaleString();
}

/**
 * 应用预设配置
 */
function applyPreset(preset) {
    let config;
    switch (preset) {
        case 'quick': config = QUICK_CONFIG; break;
        case 'full': config = FULL_CONFIG; break;
        default: config = DEFAULT_GRID_CONFIG;
    }
    
    document.getElementById('gs-alpha-min').value = config.alphaRange[0];
    document.getElementById('gs-alpha-max').value = config.alphaRange[1];
    document.getElementById('gs-alpha-step').value = config.alphaRange[2];
    document.getElementById('gs-risk-min').value = config.riskRange[0];
    document.getElementById('gs-risk-max').value = config.riskRange[1];
    document.getElementById('gs-risk-step').value = config.riskRange[2];
    document.getElementById('gs-games').value = config.gamesPerPair;
    
    updateEstimate();
}

// 当前控制器实例
let currentController = null;

/**
 * 开始搜索
 */
async function startSearch() {
    const config = {
        alphaRange: [
            parseFloat(document.getElementById('gs-alpha-min').value),
            parseFloat(document.getElementById('gs-alpha-max').value),
            parseFloat(document.getElementById('gs-alpha-step').value)
        ],
        riskRange: [
            parseFloat(document.getElementById('gs-risk-min').value),
            parseFloat(document.getElementById('gs-risk-max').value),
            parseFloat(document.getElementById('gs-risk-step').value)
        ],
        gamesPerPair: parseInt(document.getElementById('gs-games').value),
        verbose: false
    };
    
    // 更新 UI 状态
    document.getElementById('gs-start-btn').disabled = true;
    document.getElementById('gs-stop-btn').disabled = false;
    document.getElementById('gs-progress-section').style.display = 'block';
    document.getElementById('gs-results-section').style.display = 'block';
    document.getElementById('gs-progress-fill').style.width = '0%';
    document.getElementById('gs-progress-text').textContent = '准备中...';
    document.getElementById('gs-progress-detail').textContent = '';
    document.getElementById('gs-results-tbody').innerHTML = '';
    
    // 创建控制器
    currentController = new GridSearchController(config);
    
    // 设置进度回调
    currentController.onProgress = (info) => {
        updateProgressUI(info);
    };
    
    // 设置完成回调
    currentController.onComplete = (results) => {
        onSearchComplete(results);
    };
    
    // 等待 UI 更新后再开始搜索
    await new Promise(r => setTimeout(r, 50));
    
    // 开始搜索
    await currentController.start();
}

/**
 * 停止搜索
 */
function stopSearch() {
    if (currentController) {
        currentController.stop();
    }
    document.getElementById('gs-start-btn').disabled = false;
    document.getElementById('gs-stop-btn').disabled = true;
}

/**
 * 更新进度 UI
 */
function updateProgressUI(info) {
    const percent = Math.round(info.percent * 100);
    document.getElementById('gs-progress-fill').style.width = `${percent}%`;
    document.getElementById('gs-progress-text').textContent = 
        `${info.phase} - 配对 ${info.current}/${info.total} (${percent}%)`;
    
    // 显示详细进度信息
    let detail = '';
    if (info.currentMatch) {
        detail = `当前: ${info.currentMatch.configA} vs ${info.currentMatch.configB}`;
        detail += ` | 第 ${info.currentGame}/${info.gamesPerPair || '?'} 场`;
        detail += ` | 回合 ${info.currentTurn}`;
    }
    document.getElementById('gs-progress-detail').textContent = detail;
    
    // 更新实时排名
    const tbody = document.getElementById('gs-results-tbody');
    tbody.innerHTML = '';
    
    if (info.results && info.results.length > 0) {
        info.results.forEach((r, i) => {
            const tr = document.createElement('tr');
            const rankClass = i < 3 ? `gs-rank-${i + 1}` : '';
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            
            tr.innerHTML = `
                <td class="${rankClass}">${medal}</td>
                <td>${r.config.alpha.toFixed(2)}</td>
                <td>${r.config.riskAwareness.toFixed(2)}</td>
                <td class="${rankClass}">${(r.winRate * 100).toFixed(1)}%</td>
                <td>${r.wins}/${r.losses}/${r.draws}</td>
            `;
            tbody.appendChild(tr);
        });
    }
}

/**
 * 搜索完成处理
 */
function onSearchComplete(results) {
    document.getElementById('gs-start-btn').disabled = false;
    document.getElementById('gs-stop-btn').disabled = true;
    document.getElementById('gs-progress-text').textContent = '✅ 搜索完成！';
    document.getElementById('gs-progress-detail').textContent = '';
    
    renderHeatmap(results);
}

/**
 * 渲染热力图
 */
function renderHeatmap(results) {
    const section = document.getElementById('gs-heatmap-section');
    const container = document.getElementById('gs-heatmap');
    section.style.display = 'block';
    
    const alphas = [...new Set(results.map(r => r.config.alpha))].sort((a, b) => a - b);
    const risks = [...new Set(results.map(r => r.config.riskAwareness))].sort((a, b) => a - b);
    
    const resultMap = new Map();
    results.forEach(r => {
        resultMap.set(`${r.config.alpha},${r.config.riskAwareness}`, r);
    });
    
    const winRates = results.map(r => r.winRate);
    const minWinRate = Math.min(...winRates);
    const maxWinRate = Math.max(...winRates);
    
    container.innerHTML = '';
    container.style.gridTemplateColumns = `40px repeat(${alphas.length}, 1fr)`;
    
    container.innerHTML += `<div class="gs-heatmap-label"></div>`;
    alphas.forEach(a => {
        container.innerHTML += `<div class="gs-heatmap-label">α${a}</div>`;
    });
    
    risks.forEach(risk => {
        container.innerHTML += `<div class="gs-heatmap-label">r${risk}</div>`;
        
        alphas.forEach(alpha => {
            const key = `${alpha},${risk}`;
            const r = resultMap.get(key);
            
            if (r) {
                const normalized = (r.winRate - minWinRate) / (maxWinRate - minWinRate || 1);
                const hue = normalized * 120;
                const color = `hsl(${hue}, 70%, 45%)`;
                
                container.innerHTML += `
                    <div class="gs-heatmap-cell" 
                         style="background: ${color}"
                         title="α=${alpha}, r=${risk}\n胜率: ${(r.winRate * 100).toFixed(1)}%">
                        ${(r.winRate * 100).toFixed(0)}
                    </div>
                `;
            } else {
                container.innerHTML += `<div class="gs-heatmap-cell" style="background: #333">-</div>`;
            }
        });
    });
}

/**
 * 关闭 UI
 */
function closeUI() {
    const modal = document.getElementById('grid-search-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// ============================================================================
// 暴露到全局
// ============================================================================

if (typeof window !== 'undefined') {
    window.GridSearch = {
        GridSearchController,
        runQuickSearch: runQuickGridSearch,
        runFullSearch: runFullGridSearch,
        runCustomSearch: runCustomGridSearch,
        compare: compareConfigs,
        openUI: openGridSearchUI,
        closeUI,
        applyPreset,
        startSearch,
        stopSearch
    };
    
    console.log('');
    console.log('🔧 ═══════════════════════════════════════════════════════════════');
    console.log('   AI 参数调优工具已加载（单线程版）');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('');
    console.log('📌 打开可视化界面:  GridSearch.openUI()');
    console.log('⚡ 快速搜索:        GridSearch.runQuickSearch()');
    console.log('🔬 完整搜索:        GridSearch.runFullSearch()');
    console.log('⚔️  配置对比:        GridSearch.compare({alpha: 0.5}, {alpha: 0.7})');
    console.log('');
}
