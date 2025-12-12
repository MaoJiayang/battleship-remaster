/**
 * 风险评估调试脚本
 * 
 * 详细输出风险评估的执行情况
 */

import { runSimulatedGame } from '../../src/ai/SimulationEngine.js';

console.log('🔍 调试风险评估功能\n');

// 配置 B：高风险感知
const configA = {
    alpha: 0.6,
    randomness: 0,
    riskAwareness: 0
};

const configB = {
    alpha: 0.6,
    randomness: 0,
    riskAwareness: 0.9  // 非常高的风险感知
};

console.log('运行单场对局...\n');

const result = runSimulatedGame(configA, configB, { 
    verbose: false,
    maxTurns: 100 
});

console.log('\n📊 对局结果:');
console.log(`  胜者: ${result.winner}`);
console.log(`  回合数: ${result.stats.turns}`);
console.log(`  A 方命中: ${result.stats.hitsA}, 伤害: ${result.stats.damageA}`);
console.log(`  B 方命中: ${result.stats.hitsB}, 伤害: ${result.stats.damageB}`);
console.log('');

// 再次测试，但让两方配置相同
console.log('对照测试：两方配置相同（riskAwareness=0.9）...\n');

const result2 = runSimulatedGame(
    { ...configB },
    { ...configB },
    { verbose: false, maxTurns: 100 }
);

console.log('\n📊 对照结果:');
console.log(`  胜者: ${result2.winner}`);
console.log(`  回合数: ${result2.stats.turns}`);
console.log('');

if (result.stats.turns >= 100 || result2.stats.turns >= 100) {
    console.log('⚠️  对局达到最大回合数限制，可能是：');
    console.log('   1. AI 过于保守，不愿冒险攻击');
    console.log('   2. 双方实力过于接近');
    console.log('   3. 决策效率问题');
} else {
    console.log('✅ 对局在合理回合数内结束');
}
