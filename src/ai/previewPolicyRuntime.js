import { AIDecisionEngine } from './aiStrategy.js';
import { checkAIAbilities } from './aiCore.js';
import { DirectNeuralPolicy } from './directPolicy.js';
import { MemoryNeuralNetwork } from './memoryNetwork.js';
import { UnifiedNeuralNetwork } from './unifiedNetwork.js';
import { publicDecisionEvent } from './neuralHistory.js';

export class PreviewDecisionHistory {
    constructor() {
        this.reset();
    }

    reset() {
        this.events = [];
        this.ownDecisions = [];
    }

    capture(seat, action, before, ships, targets, faction, opponentFaction) {
        return { seat, action: { ...action }, before: before.map(row => [...row]),
            abilities: checkAIAbilities(ships, faction, opponentFaction, {
                sunkEnemyShips: targets.filter(ship => ship.sunk).length, neutralBias: true
            }) };
    }

    complete(snapshot, after) {
        const { seat, action, abilities, before } = snapshot;
        this.events.push(publicDecisionEvent(seat, this.events.length + 1, action, abilities, before, after));
        if (seat === 'ai') this.ownDecisions.push({ action, abilities, before, after: after.map(row => [...row]) });
    }

    context(viewGrid) {
        const previous = this.ownDecisions.at(-1);
        if (previous && viewGrid) previous.after = viewGrid.map(row => [...row]);
        return { publicEvents: this.events, decisionSeat: 'ai', ownDecisions: this.ownDecisions };
    }
}

export class PreviewPolicyRuntime {
    constructor(model) {
        this.engine = new AIDecisionEngine();
        const Network = model.format === 'naval-unified-v1' ? UnifiedNeuralNetwork : MemoryNeuralNetwork;
        this.policy = new DirectNeuralPolicy(new Network(model));
        this.reset();
    }

    reset() {
        this.engine.directPolicy = this.policy;
        this.engine.reset();
    }

    async decide(context) {
        if (!Array.isArray(context.ownDecisions)) throw new Error('体验版缺少已执行的己方行动');
        if (this.engine.actionHistory.length !== context.ownDecisions.length) {
            this.reset();
            for (const record of context.ownDecisions) {
                this.engine.recordDecision(record.action, record.abilities, record.before);
                this.engine.actionHistory.at(-1).afterView = record.after.map(row => [...row]);
            }
        }
        this.engine.directPolicy = context.difficultyConfig?.level === 'HARD' ? this.policy : null;
        try {
            return await this.engine.decideAsync(context);
        } finally {
            this.engine.directPolicy = this.policy;
        }
    }
}
