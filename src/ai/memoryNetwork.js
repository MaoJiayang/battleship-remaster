import { NavalNeuralNetwork, linear } from './neuralNetwork.js';
import { HISTORY_SCHEMA, HISTORY_FEATURES } from './neuralHistory.js';

const sigmoid = value => 1 / (1 + Math.exp(-value));

export class MemoryNeuralNetwork {
    constructor(model) {
        if (model.format !== 'naval-memory-v1' || model.historySchema !== HISTORY_SCHEMA
            || model.historyFeatures !== HISTORY_FEATURES || !['gru', 'attention'].includes(model.memoryKind)) throw new Error('历史模型协议不兼容');
        this.metadata = model;
        this.base = new NavalNeuralNetwork(model.base);
        if (model.rulesId !== this.base.metadata.rulesId) throw new Error('历史模型规则不一致');
        const shapes = { event: [16, HISTORY_FEATURES], fusion: [16, 32] };
        Object.assign(shapes, model.memoryKind === 'gru' ? { memoryInput: [48, 16], memoryHidden: [48, 16] }
            : { query: [16, 16], key: [16, 16], memoryValue: [16, 16] });
        this.layers = {};
        for (const [name, shape] of Object.entries(shapes)) {
            const layer = model.layers[name];
            if (!layer || JSON.stringify(layer.shape) !== JSON.stringify(shape) || layer.weight.length !== shape[0] * shape[1]
                || layer.bias.length !== shape[0] || ![...layer.weight, ...layer.bias].every(Number.isFinite)) throw new Error(`历史模型层无效：${name}`);
            this.layers[name] = { shape, weight: Float32Array.from(layer.weight), bias: Float32Array.from(layer.bias) };
        }
    }

    initialState() {
        return { count: 0, hidden: new Float32Array(16), keys: [], values: [] };
    }

    predict(observation, events = [], previous = this.initialState()) {
        const { layers } = this;
        const state = { count: previous.count, hidden: Float32Array.from(previous.hidden), keys: [...previous.keys], values: [...previous.values] };
        for (const event of events) {
            if (event.length !== HISTORY_FEATURES || !event.every(Number.isFinite)) throw new Error('历史事件输入无效');
            const embedded = linear(event, 1, layers.event, true);
            if (this.metadata.memoryKind === 'gru') {
                const input = linear(embedded, 1, layers.memoryInput);
                const hidden = linear(state.hidden, 1, layers.memoryHidden);
                for (let index = 0; index < 16; index++) {
                    const reset = sigmoid(input[index] + hidden[index]);
                    const update = sigmoid(input[16 + index] + hidden[16 + index]);
                    const candidate = Math.tanh(input[32 + index] + reset * hidden[32 + index]);
                    state.hidden[index] = (1 - update) * candidate + update * state.hidden[index];
                }
            } else {
                for (let index = 0; index < 8; index++) {
                    const angle = state.count * Math.exp(index * (-Math.log(10000) / 8));
                    embedded[2 * index] += Math.sin(angle);
                    embedded[2 * index + 1] += Math.cos(angle);
                }
                state.keys.push(linear(embedded, 1, layers.key));
                state.values.push(linear(embedded, 1, layers.memoryValue));
            }
            state.count++;
        }
        const encoded = this.base.encode(observation);
        let memory = state.hidden;
        if (this.metadata.memoryKind === 'attention') {
            memory = new Float32Array(16);
            const query = linear(encoded.summary, 1, layers.query);
            for (let head = 0; head < 2 && state.count; head++) {
                const scores = state.keys.map(key => {
                    let score = 0;
                    for (let index = head * 8; index < (head + 1) * 8; index++) score += query[index] * key[index];
                    return score / Math.sqrt(8);
                });
                const maximum = Math.max(...scores);
                const weights = scores.map(score => Math.exp(score - maximum));
                const total = weights.reduce((sum, weight) => sum + weight, 0);
                for (let index = head * 8; index < (head + 1) * 8; index++) {
                    for (let event = 0; event < state.count; event++) memory[index] += weights[event] / total * state.values[event][index];
                }
            }
        }
        const summary = linear(Float32Array.from([...encoded.summary, ...memory]), 1, layers.fusion, true);
        return { ...this.base.decode({ ...encoded, summary }), state };
    }
}
