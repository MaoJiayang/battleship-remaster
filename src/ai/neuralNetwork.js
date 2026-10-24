import { BOARD_SIZE } from '../config/constants.js';
import { NEURAL_SCHEMA, NEURAL_CHANNELS, NEURAL_CELLS, NEURAL_ACTIONS, neuralRulesId } from './neuralObservation.js';

function linear(input, rows, layer, relu = false) {
    const [outputs, inputs] = layer.shape;
    const result = new Float32Array(rows * outputs);
    for (let row = 0; row < rows; row++) {
        for (let output = 0; output < outputs; output++) {
            let value = layer.bias[output];
            for (let column = 0; column < inputs; column++) value += input[row * inputs + column] * layer.weight[output * inputs + column];
            result[row * outputs + output] = relu ? Math.max(0, value) : value;
        }
    }
    return result;
}

function convolution(input, layer) {
    const [outputs, inputs] = layer.shape;
    const result = new Float32Array(outputs * NEURAL_CELLS);
    for (let output = 0; output < outputs; output++) {
        for (let row = 0; row < BOARD_SIZE; row++) {
            for (let col = 0; col < BOARD_SIZE; col++) {
                let value = layer.bias[output];
                for (let channel = 0; channel < inputs; channel++) {
                    for (let kernelRow = 0; kernelRow < 3; kernelRow++) {
                        const sourceRow = row + kernelRow - 1;
                        if (sourceRow < 0 || sourceRow >= BOARD_SIZE) continue;
                        for (let kernelCol = 0; kernelCol < 3; kernelCol++) {
                            const sourceCol = col + kernelCol - 1;
                            if (sourceCol < 0 || sourceCol >= BOARD_SIZE) continue;
                            value += input[channel * NEURAL_CELLS + sourceRow * BOARD_SIZE + sourceCol]
                                * layer.weight[((output * inputs + channel) * 3 + kernelRow) * 3 + kernelCol];
                        }
                    }
                }
                result[output * NEURAL_CELLS + row * BOARD_SIZE + col] = Math.max(0, value);
            }
        }
    }
    return result;
}

function pool(planes) {
    const result = new Float32Array(NEURAL_CHANNELS * 16);
    for (let channel = 0; channel < NEURAL_CHANNELS; channel++) {
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                const firstRow = Math.floor(row * BOARD_SIZE / 4);
                const lastRow = Math.ceil((row + 1) * BOARD_SIZE / 4);
                const firstCol = Math.floor(col * BOARD_SIZE / 4);
                const lastCol = Math.ceil((col + 1) * BOARD_SIZE / 4);
                let total = 0;
                for (let sourceRow = firstRow; sourceRow < lastRow; sourceRow++) {
                    for (let sourceCol = firstCol; sourceCol < lastCol; sourceCol++) total += planes[channel * NEURAL_CELLS + sourceRow * BOARD_SIZE + sourceCol];
                }
                result[channel * 16 + row * 4 + col] = total / ((lastRow - firstRow) * (lastCol - firstCol));
            }
        }
    }
    return result;
}

export class NavalNeuralNetwork {
    constructor(model) {
        if (model.format !== 'naval-network-v1' || model.schema !== NEURAL_SCHEMA || model.rulesId !== neuralRulesId()
            || model.boardSize !== BOARD_SIZE || model.channels !== NEURAL_CHANNELS
            || !['attention', 'mlp'].includes(model.architecture)) throw new Error('模型输入协议或规则版本不兼容');
        this.metadata = model;
        this.layers = {};
        const embedding = model.embedding;
        const shapes = {
            cell: [embedding, (model.architecture === 'attention' ? model.hidden : NEURAL_CHANNELS) + 2],
            policyHidden: [embedding, embedding * 2], policy: [3, embedding],
            valueHidden: [embedding, embedding], value: [1, embedding]
        };
        if (model.architecture === 'attention') Object.assign(shapes, {
            conv1: [model.hidden, NEURAL_CHANNELS, 3, 3], conv2: [model.hidden, model.hidden, 3, 3],
            rules: [embedding, model.globalSize], query: [embedding, embedding], key: [embedding, embedding],
            attentionValue: [embedding, embedding], fusion: [embedding, embedding * 2]
        });
        else Object.assign(shapes, { mlp1: [model.hidden, model.globalSize + NEURAL_CHANNELS * 16], mlp2: [embedding, model.hidden] });
        for (const [name, shape] of Object.entries(shapes)) {
            const source = model.layers[name];
            if (!source || JSON.stringify(source.shape) !== JSON.stringify(shape)
                || source.weight.length !== shape.reduce((product, size) => product * size, 1)
                || source.bias.length !== shape[0] || ![...source.weight, ...source.bias].every(Number.isFinite)) throw new Error(`模型层无效：${name}`);
            this.layers[name] = { shape, weight: Float32Array.from(source.weight), bias: Float32Array.from(source.bias) };
        }
        if (model.architecture === 'attention' && (!Number.isInteger(model.heads) || model.heads < 1 || embedding % model.heads)) throw new Error('注意力头数无效');
    }

    predict(observation) {
        const { metadata, layers } = this;
        if (observation.schema !== metadata.schema || observation.rulesId !== metadata.rulesId
            || observation.globals.length !== metadata.globalSize || observation.planes.length !== NEURAL_CHANNELS * NEURAL_CELLS) throw new Error('局面输入与模型不兼容');
        const embedding = metadata.embedding;
        const spatial = metadata.architecture === 'attention'
            ? convolution(convolution(observation.planes, layers.conv1), layers.conv2) : observation.planes;
        const channels = metadata.architecture === 'attention' ? metadata.hidden : NEURAL_CHANNELS;
        const cellInputs = new Float32Array(NEURAL_CELLS * (channels + 2));
        for (let cell = 0; cell < NEURAL_CELLS; cell++) {
            for (let channel = 0; channel < channels; channel++) cellInputs[cell * (channels + 2) + channel] = spatial[channel * NEURAL_CELLS + cell];
            cellInputs[cell * (channels + 2) + channels] = 2 * Math.floor(cell / BOARD_SIZE) / (BOARD_SIZE - 1) - 1;
            cellInputs[cell * (channels + 2) + channels + 1] = 2 * (cell % BOARD_SIZE) / (BOARD_SIZE - 1) - 1;
        }
        const cells = linear(cellInputs, NEURAL_CELLS, layers.cell, true);
        let summary;
        if (metadata.architecture === 'attention') {
            const rules = linear(observation.globals, 1, layers.rules, true);
            const query = linear(rules, 1, layers.query);
            const keys = linear(cells, NEURAL_CELLS, layers.key);
            const values = linear(cells, NEURAL_CELLS, layers.attentionValue);
            const attended = new Float32Array(embedding);
            const width = embedding / metadata.heads;
            for (let head = 0; head < metadata.heads; head++) {
                const scores = new Float64Array(NEURAL_CELLS);
                let maximum = -Infinity;
                for (let cell = 0; cell < NEURAL_CELLS; cell++) {
                    let score = 0;
                    for (let column = head * width; column < (head + 1) * width; column++) score += query[column] * keys[cell * embedding + column];
                    scores[cell] = score / Math.sqrt(width);
                    maximum = Math.max(maximum, scores[cell]);
                }
                let total = 0;
                for (let cell = 0; cell < NEURAL_CELLS; cell++) total += scores[cell] = Math.exp(scores[cell] - maximum);
                for (let column = head * width; column < (head + 1) * width; column++) {
                    let value = 0;
                    for (let cell = 0; cell < NEURAL_CELLS; cell++) value += scores[cell] / total * values[cell * embedding + column];
                    attended[column] = value;
                }
            }
            summary = linear(Float32Array.from([...rules, ...attended]), 1, layers.fusion, true);
        } else summary = linear(linear(Float32Array.from([...pool(observation.planes), ...observation.globals]), 1, layers.mlp1, true), 1, layers.mlp2, true);
        const policyInputs = new Float32Array(NEURAL_CELLS * embedding * 2);
        for (let cell = 0; cell < NEURAL_CELLS; cell++) {
            policyInputs.set(cells.subarray(cell * embedding, (cell + 1) * embedding), cell * embedding * 2);
            policyInputs.set(summary, cell * embedding * 2 + embedding);
        }
        const rawPolicy = linear(linear(policyInputs, NEURAL_CELLS, layers.policyHidden, true), NEURAL_CELLS, layers.policy);
        const logits = new Float32Array(NEURAL_ACTIONS);
        for (let weapon = 0; weapon < 3; weapon++) {
            for (let cell = 0; cell < NEURAL_CELLS; cell++) logits[weapon * NEURAL_CELLS + cell] = rawPolicy[cell * 3 + weapon];
        }
        const value = linear(linear(summary, 1, layers.valueHidden, true), 1, layers.value)[0];
        return { value: 1 / (1 + Math.exp(-value)), valueLogit: value, logits };
    }
}
