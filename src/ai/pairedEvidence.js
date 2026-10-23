export function scenarioRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), state | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

function logMeanExp(values) {
    const maximum = Math.max(...values);
    return maximum + Math.log(values.reduce((sum, value) => sum + Math.exp(value - maximum), 0) / values.length);
}

export class PairedEvidence {
    constructor(risk = 0.05) {
        if (!(risk > 0 && risk < 1)) throw new RangeError('检验风险必须介于 0 和 1 之间');
        this.threshold = -Math.log(risk);
        this.positive = new Float64Array(32);
        this.negative = new Float64Array(32);
        this.samples = 0;
        this.sum = 0;
        this.squareSum = 0;
    }

    observe(candidate, baseline) {
        if (!(candidate >= 0 && candidate <= 1 && baseline >= 0 && baseline <= 1)) throw new RangeError('终局回报必须介于 0 和 1 之间');
        const difference = candidate - baseline;
        for (let index = 0; index < this.positive.length; index++) {
            const fraction = (index + 0.5) / this.positive.length;
            this.positive[index] += Math.log1p(fraction * difference);
            this.negative[index] += Math.log1p(-fraction * difference);
        }
        this.samples++;
        this.sum += difference;
        this.squareSum += difference * difference;
    }

    get accepted() { return logMeanExp(this.positive) >= this.threshold; }
    get rejected() { return logMeanExp(this.negative) >= this.threshold; }
    get logEvidence() { return logMeanExp(this.positive); }
    get mean() { return this.samples ? this.sum / this.samples : 0; }
    get variance() { return this.samples ? Math.max(0, this.squareSum / this.samples - this.mean ** 2) : 0; }
}
