/**
 * 风险评估测试脚本
 * 
 * 验证 SimulationEngine 是否正确使用 riskAwareness 参数
 */

import { runSimulatedGame } from '../../src/ai/SimulationEngine.js';

console.log('🧪 测试风险评估功能\n');

// 配置 A：无风险感知
const configA = {
    alpha: 0.6,
    randomness: 0,
    riskAwareness: 0
};

// 配置 B：高风险感知
const configB = {
    alpha: 0.6,
    randomness: 0,
    riskAwareness: 0.8
};

console.log('配置 A（无风险感知）:');
console.log(`  alpha: ${configA.alpha}`);
console.log(`  riskAwareness: ${configA.riskAwareness}`);
console.log('');

console.log('配置 B（高风险感知）:');
console.log(`  alpha: ${configB.alpha}`);
console.log(`  riskAwareness: ${configB.riskAwareness}`);
console.log('');

console.log('运行测试对局...\n');

// 运行多场测试
let winsA = 0;
let winsB = 0;
let draws = 0;
const testGames = 20;

for (let i = 0; i < testGames; i++) {
    const result = runSimulatedGame(configA, configB, { verbose: false });
    
    if (result.winner === 'A') winsA++;
    else if (result.winner === 'B') winsB++;
    else draws++;
    
    process.stdout.write(`\r⏳ 进度: ${i + 1}/${testGames}`);
}

console.log('\n');
console.log('📊 测试结果:');
console.log(`  A（无风险）胜: ${winsA}`);
console.log(`  B（高风险）胜: ${winsB}`);
console.log(`  平局: ${draws}`);
console.log(`  B 胜率: ${(winsB / testGames * 100).toFixed(1)}%`);
console.log('');

if (winsB > winsA) {
    console.log('✅ 风险感知参数生效！高风险感知配置表现更好。');
} else if (winsB === winsA) {
    console.log('⚠️  双方表现相当，可能需要更多对局来验证。');
} else {
    console.log('❓ 无风险感知配置表现更好，这可能表示：');
    console.log('   1. 风险评估的计算开销影响了决策速度');
    console.log('   2. 当前参数下风险评估的收益不明显');
    console.log('   3. 需要更多对局来确定统计显著性');
}
