// AI 决策 Worker
// 蒙特卡洛采样与多步推演放到 Worker，避免和爆炸/沉没动画抢主线程
import { makeAIDecisionAsync, resetAIState } from './aiStrategy.js';

self.onmessage = async (event) => {
    const { type, id, context } = event.data || {};
    if (type === 'reset') {
        resetAIState();
        return;
    }
    if (type !== 'decide') return;

    let decision = null;
    let error = null;
    try {
        decision = await makeAIDecisionAsync(context);
    } catch (err) {
        error = err?.message || String(err);
    }
    self.postMessage({ type: 'decision', id, decision, error });
};
