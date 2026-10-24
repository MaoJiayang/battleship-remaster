import { encodeNeuralObservation, neuralAction } from './neuralObservation.js';
import { encodePublicEvent } from './neuralHistory.js';
import { checkAIAbilities } from './aiCore.js';

export class DirectNeuralPolicy {
    constructor(network, stochastic = false) {
        this.network = network;
        this.stochastic = stochastic;
        this.reset();
    }

    reset() {
        this.cursor = 0;
        this.memory = null;
    }

    decide(context, engine) {
        const started = performance.now();
        const previous = engine.actionHistory.at(-1);
        if (previous && !previous.afterView) previous.afterView = context.viewGrid.map(row => [...row]);
        const observation = encodeNeuralObservation(context, {
            history: engine.actionHistory, damageGrid: engine.damageDealtGrid, sonarHistory: engine.sonarHistory
        });
        const encodedAt = performance.now();
        let prediction;
        if (this.network.metadata.format === 'naval-memory-v1') {
            if (!context.publicEvents || !context.decisionSeat || context.publicEvents.length < this.cursor) throw new Error('记忆策略缺少公开历史或历史已重置');
            const events = context.publicEvents.slice(this.cursor).map(event => encodePublicEvent(event, context.decisionSeat));
            prediction = this.network.predict(observation, events, this.memory ?? this.network.initialState());
            this.memory = prediction.state;
            this.cursor = context.publicEvents.length;
        } else prediction = this.network.predict(observation);
        let selected = -1;
        let maximum = -Infinity;
        for (let index = 0; index < observation.mask.length; index++) {
            if (observation.mask[index] && prediction.logits[index] > maximum) { maximum = prediction.logits[index]; selected = index; }
        }
        if (selected < 0) throw new Error('策略没有合法行动');
        if (this.stochastic) {
            const weights = prediction.logits.map((value, index) => observation.mask[index] ? Math.exp(value - maximum) : 0);
            let threshold = Math.random() * weights.reduce((sum, value) => sum + value, 0);
            for (let index = 0; index < weights.length; index++) {
                if (!weights[index]) continue;
                threshold -= weights[index];
                if (threshold <= 0) { selected = index; break; }
            }
        }
        engine.lastDecisionStats = { direct: true, encodingMs: encodedAt - started, networkMs: performance.now() - encodedAt };
        const abilities = checkAIAbilities(context.enemyShips, context.aiFaction, context.playerFaction, { sunkEnemyShips: context.myShips.filter(ship => ship.sunk).length });
        return engine.recordDecision(neuralAction(selected), abilities, context.viewGrid);
    }
}
