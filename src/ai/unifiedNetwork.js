import { linear } from './neuralNetwork.js';
import { UNIFIED_SCHEMA, UNIFIED_CHANNELS, UNIFIED_EVENT_CHANNELS } from './unifiedObservation.js';

function mean(rows, width) {
    const result = new Float32Array(width);
    for (const row of rows) for (let column = 0; column < width; column++) result[column] += row[column] / Math.max(1, rows.length);
    return result;
}

function split(values, width) {
    return Array.from({ length: values.length / width }, (_, index) => values.subarray(index * width, (index + 1) * width));
}

function project(input, layer, first, bias = false) {
    const [outputs, inputs] = layer.shape;
    const result = new Float32Array(outputs);
    for (let output = 0; output < outputs; output++) {
        let value = bias ? layer.bias[output] : 0;
        for (let column = 0; column < input.length; column++) value += input[column] * layer.weight[output * inputs + first + column];
        result[output] = value;
    }
    return result;
}

function convolution(input, layer, height, width) {
    const [outputs, inputs] = layer.shape;
    const cells = height * width;
    const result = new Float32Array(outputs * cells);
    for (let output = 0; output < outputs; output++) {
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                let value = layer.bias[output];
                for (let channel = 0; channel < inputs; channel++) {
                    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
                        const sourceRow = row + rowOffset;
                        if (sourceRow < 0 || sourceRow >= height) continue;
                        for (let colOffset = -1; colOffset <= 1; colOffset++) {
                            const sourceCol = col + colOffset;
                            if (sourceCol < 0 || sourceCol >= width) continue;
                            value += input[channel * cells + sourceRow * width + sourceCol]
                                * layer.weight[((output * inputs + channel) * 3 + rowOffset + 1) * 3 + colOffset + 1];
                        }
                    }
                }
                result[output * cells + row * width + col] = Math.max(0, value);
            }
        }
    }
    return result;
}

const sigmoid = value => 1 / (1 + Math.exp(-value));

export class UnifiedNeuralNetwork {
    constructor(model) {
        if (model.format !== 'naval-unified-v1' || model.schema !== UNIFIED_SCHEMA || !['gru', 'attention'].includes(model.memoryKind)
            || !Array.isArray(model.validatedRules) || !model.validatedRules.length) throw new Error('统一模型协议或规则范围无效');
        this.metadata = model;
        this.layers = {};
        const shapes = { conv1: [12, UNIFIED_CHANNELS, 3, 3], conv2: [12, 12, 3, 3], ship: [8, 6], offset: [8, 6],
            variant: [8, 25], weapon: [12, 24], context: [12, 60], event: [8, UNIFIED_EVENT_CHANNELS], fusion: [12, 32],
            coverage: [12, 20], policyHidden: [12, 37], policy: [1, 12], valueHidden: [12, 20], value: [1, 12] };
        Object.assign(shapes, model.memoryKind === 'gru' ? { memoryInput: [24, 8], memoryHidden: [24, 8] }
            : { query: [8, 12], key: [8, 8], memoryValue: [8, 8] });
        for (const [name, shape] of Object.entries(shapes)) {
            const layer = model.layers[name];
            if (!layer || JSON.stringify(layer.shape) !== JSON.stringify(shape)
                || layer.weight.length !== shape.reduce((total, size) => total * size, 1) || layer.bias.length !== shape[0]
                || ![...layer.weight, ...layer.bias].every(Number.isFinite)) throw new Error(`统一模型层无效：${name}`);
            this.layers[name] = { shape, weight: Float32Array.from(layer.weight), bias: Float32Array.from(layer.bias) };
        }
    }

    initialState() {
        return { height: 0, width: 0, count: 0, hidden: new Float32Array(0), keys: [], values: [], valid: [] };
    }

    predict(observation, events = [], previous = this.initialState()) {
        const { height, width } = observation;
        const cells = height * width;
        if (observation.schema !== UNIFIED_SCHEMA || !this.metadata.validatedRules.includes(observation.rulesId)
            || !Number.isInteger(height) || !Number.isInteger(width) || height < 1 || width < 1
            || observation.planes.length !== UNIFIED_CHANNELS * cells || observation.globals.length !== 8) throw new Error('统一观测与模型不兼容');
        if (previous.count && (previous.height !== height || previous.width !== width)) throw new Error('统一历史记忆尺寸改变，需要重开');
        const state = { height, width, count: previous.count, hidden: previous.hidden.length ? Float32Array.from(previous.hidden) : new Float32Array(cells * 8),
            keys: [...previous.keys], values: [...previous.values], valid: [...previous.valid] };
        const { layers } = this;
        const spatialPlanes = convolution(convolution(observation.planes, layers.conv1, height, width), layers.conv2, height, width);
        const spatial = Array.from({ length: cells }, (_, cell) => Float32Array.from({ length: 12 }, (_, channel) => spatialPlanes[channel * cells + cell]));
        const ships = observation.ships.map(ship => linear(ship, 1, layers.ship, true));
        const offsetEmbeddings = [];
        const weapons = observation.weapons.map(weapon => {
            const offsets = weapon.offsets.map(offset => linear(offset, 1, layers.offset, true));
            offsetEmbeddings.push(offsets);
            const variants = weapon.variants.map(variant => {
                const embedded = variant.offsets.map(offset => linear(offset, 1, layers.offset, true));
                return linear([...variant.features, ...mean(embedded, 8), embedded.length / 32], 1, layers.variant, true);
            });
            return linear([...weapon.features, ...mean(offsets, 8), ...mean(variants, 8), offsets.length / 32], 1, layers.weapon, true);
        });
        const shipMean = mean(ships, 8);
        const weaponMean = mean(weapons, 12);
        const context = linear([...observation.globals, ...shipMean, ...shipMean.map(value => value * ships.length / 16),
            ...weaponMean, ...weaponMean.map(value => value * weapons.length / 16), ...mean(spatial, 12)], 1, layers.context, true);
        for (const event of events) {
            if (event.length !== UNIFIED_EVENT_CHANNELS * cells || !event.every(Number.isFinite)) throw new Error('统一历史事件无效');
            const rows = new Float32Array(cells * UNIFIED_EVENT_CHANNELS);
            const valid = new Uint8Array(cells);
            for (let cell = 0; cell < cells; cell++) {
                valid[cell] = Number(event[2 * cells + cell] > 0);
                for (let channel = 0; channel < UNIFIED_EVENT_CHANNELS; channel++) rows[cell * UNIFIED_EVENT_CHANNELS + channel] = event[channel * cells + cell];
            }
            const embedded = linear(rows, cells, layers.event, true);
            if (this.metadata.memoryKind === 'gru') {
                const input = linear(embedded, cells, layers.memoryInput);
                const hidden = linear(state.hidden, cells, layers.memoryHidden);
                for (let cell = 0; cell < cells; cell++) {
                    if (!valid[cell]) continue;
                    for (let column = 0; column < 8; column++) {
                        const base = cell * 24 + column;
                        const reset = sigmoid(input[base] + hidden[base]);
                        const update = sigmoid(input[base + 8] + hidden[base + 8]);
                        const candidate = Math.tanh(input[base + 16] + reset * hidden[base + 16]);
                        state.hidden[cell * 8 + column] = (1 - update) * candidate + update * state.hidden[cell * 8 + column];
                    }
                }
            } else {
                for (let cell = 0; cell < cells; cell++) {
                    for (let column = 0; column < 4; column++) {
                        const angle = state.count * Math.exp(column * (-Math.log(10000) / 4));
                        embedded[cell * 8 + column * 2] += Math.sin(angle);
                        embedded[cell * 8 + column * 2 + 1] += Math.cos(angle);
                    }
                }
                state.keys.push(linear(embedded, cells, layers.key));
                state.values.push(linear(embedded, cells, layers.memoryValue));
                state.valid.push(valid);
            }
            state.count++;
        }
        let memory = state.hidden;
        if (this.metadata.memoryKind === 'attention') {
            memory = new Float32Array(cells * 8);
            const queries = linear(Float32Array.from(spatial.flatMap(row => [...row])), cells, layers.query);
            for (let cell = 0; cell < cells; cell++) {
                const scores = [];
                let maximum = -Infinity;
                for (let step = 0; step < state.count; step++) {
                    let score = -Infinity;
                    if (state.valid[step][cell]) {
                        score = 0;
                        for (let column = 0; column < 8; column++) score += queries[cell * 8 + column] * state.keys[step][cell * 8 + column];
                        score /= Math.sqrt(8);
                    }
                    scores.push(score);
                    maximum = Math.max(maximum, score);
                }
                if (maximum === -Infinity) continue;
                const weights = scores.map(score => Math.exp(score - maximum));
                const total = weights.reduce((sum, value) => sum + value, 0);
                for (let column = 0; column < 8; column++) {
                    for (let step = 0; step < state.count; step++) memory[cell * 8 + column] += weights[step] / total * state.values[step][cell * 8 + column];
                }
            }
        }
        const fused = spatial.map((row, cell) => linear([...row, ...memory.subarray(cell * 8, (cell + 1) * 8), ...context], 1, layers.fusion, true));
        const coverageBase = fused.map(row => project(row, layers.coverage, 0, true));
        const policyBase = fused.map(row => project(row, layers.policyHidden, 0, true));
        const logits = new Float32Array(observation.actionWeapons.length * cells);
        for (let weapon = 0; weapon < observation.actionWeapons.length; weapon++) {
            const profile = observation.weapons[weapon];
            const offsetParts = offsetEmbeddings[weapon].map(offset => project(offset, layers.coverage, 12));
            const weaponPart = project(weapons[weapon], layers.policyHidden, 12);
            for (let cell = 0; cell < cells; cell++) {
                const coverage = new Float32Array(12);
                let covered = 0;
                for (let offset = 0; offset < profile.positions.length; offset++) {
                    const [rowOffset, colOffset] = profile.positions[offset];
                    const row = Math.floor(cell / width) + rowOffset;
                    const col = cell % width + colOffset;
                    if (row < 0 || col < 0 || row >= height || col >= width) continue;
                    const base = coverageBase[row * width + col];
                    for (let column = 0; column < 12; column++) coverage[column] += Math.max(0, base[column] + offsetParts[offset][column]);
                    covered++;
                }
                for (let column = 0; column < 12; column++) coverage[column] /= Math.max(1, covered);
                const coveragePart = project(coverage, layers.policyHidden, 24);
                const hidden = new Float32Array(12);
                const ratio = covered / Math.max(1, profile.positions.length);
                for (let column = 0; column < 12; column++) hidden[column] = Math.max(0, policyBase[cell][column] + weaponPart[column]
                    + coveragePart[column] + ratio * layers.policyHidden.weight[column * 37 + 36]);
                logits[weapon * cells + cell] = linear(hidden, 1, layers.policy)[0];
            }
        }
        const valueLogit = linear(linear([...context, ...mean(split(memory, 8), 8)], 1, layers.valueHidden, true), 1, layers.value)[0];
        return { logits, valueLogit, value: sigmoid(valueLogit), state };
    }
}
