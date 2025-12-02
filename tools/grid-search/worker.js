/**
 * Worker 线程代码 - 执行模拟对战任务
 * 
 * 直接复用主项目的 SimulationEngine，不重复代码
 */

import { parentPort, workerData } from 'worker_threads';

const workerId = workerData?.workerId ?? 0;

// 通知主线程开始加载模块
parentPort.postMessage({ type: 'loading', workerId });

// ⭐ 动态导入，这样可以准确测量加载时间
const { SimulationEngine } = await import('../../src/ai/SimulationEngine.js');

// 预热：运行一次模拟确保所有代码路径都已编译
const warmupEngine = new SimulationEngine(
    { alpha: 0.5, randomness: 0, riskAwareness: 0 },
    { alpha: 0.5, randomness: 0, riskAwareness: 0 }
);
warmupEngine.run();

/**
 * 执行一组对战任务
 * 
 * 任务粒度：单个配对的所有对战（先后手各半）
 * 如果 games 较大，可以考虑进一步拆分
 */
function runMatchup(task) {
    const { taskId, configA, configB, games, keyA, keyB } = task;
    
    let winsA = 0, winsB = 0, draws = 0;
    let totalTurns = 0;
    
    // 先后手各半
    const halfGames = Math.floor(games / 2);
    
    // A 先手
    for (let i = 0; i < halfGames; i++) {
        const engine = new SimulationEngine(configA, configB);
        const result = engine.run();
        
        if (result.winner === 'A') winsA++;
        else if (result.winner === 'B') winsB++;
        else draws++;
        totalTurns += result.stats.turns;
    }
    
    // B 先手（交换位置）
    for (let i = 0; i < halfGames; i++) {
        const engine = new SimulationEngine(configB, configA);
        const result = engine.run();
        
        // 结果要反过来：这里 A 赢了意味着原 configB 赢
        if (result.winner === 'A') winsB++;
        else if (result.winner === 'B') winsA++;
        else draws++;
        totalTurns += result.stats.turns;
    }
    
    const totalGames = winsA + winsB + draws;
    
    return {
        taskId,
        keyA,
        keyB,
        winsA,
        winsB,
        draws,
        totalGames,
        avgTurns: totalGames > 0 ? totalTurns / totalGames : 0
    };
}

/**
 * 执行单场对战任务（细粒度）
 */
function runSingleGame(task) {
    const { taskId, configA, configB, keyA, keyB, isFirstHalf } = task;
    
    const engine = new SimulationEngine(configA, configB);
    const result = engine.run();
    
    let winA = 0, winB = 0, draw = 0;
    
    if (result.winner === 'A') {
        // A 赢了
        winA = isFirstHalf ? 1 : 0;  // 如果是前半场，A 是 configA
        winB = isFirstHalf ? 0 : 1;  // 如果是后半场，A 是 configB
    } else if (result.winner === 'B') {
        winA = isFirstHalf ? 0 : 1;
        winB = isFirstHalf ? 1 : 0;
    } else {
        draw = 1;
    }
    
    return {
        taskId,
        keyA,
        keyB,
        winsA: winA,
        winsB: winB,
        draws: draw,
        totalGames: 1,
        avgTurns: result.stats.turns
    };
}

// 监听主线程任务
parentPort.on('message', (task) => {
    try {
        // 根据任务类型选择处理函数
        const result = task.mode === 'single' 
            ? runSingleGame(task)
            : runMatchup(task);
        parentPort.postMessage({ type: 'result', ...result });
    } catch (error) {
        parentPort.postMessage({ 
            type: 'error', 
            taskId: task.taskId,
            error: error.message,
            stack: error.stack
        });
    }
});

// 模块加载完成且预热完成后，通知主线程 Worker 已就绪
parentPort.postMessage({ type: 'ready', workerId });
