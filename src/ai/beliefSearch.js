import { BOARD_SIZE } from '../config/constants.js';
import { getHEOffsets } from '../data/doctrines.js';
import { resolveHit } from '../game/battle/HitResolver.js';
import { resolveSonar } from '../game/battle/SonarResolver.js';
import { advancePursuit } from '../game/battle/PursuitResolver.js';
import { BeliefState, CellState, checkAIAbilities, getActionCoverage, evaluateAction } from './aiCore.js';
import { approximatePosterior, activeSensorRegions } from './rolloutBelief.js';
import { PairedEvidence, scenarioRandom } from './pairedEvidence.js';
import { encodeNeuralObservation, neuralActionIndex, NEURAL_ACTIONS } from './neuralObservation.js';

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
const DEADLINE = Symbol('搜索时间预算已到');
const HE_COVERAGE = new Map();
const isOpen = state => state === CellState.UNKNOWN || state === CellState.SUSPECT || state === CellState.HIT;

function createModel(fleet, useKnownHp = false) {
    const grid = Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => ({ hit: false, shipId: -1, segmentIndex: -1 })));
    const ships = fleet.map(({ ship, cells }, index) => {
        const first = cells[0];
        const modelShip = {
            id: index, code: ship.code, name: ship.code, len: ship.len,
            maxHp: ship.maxHp, hp: useKnownHp ? [...ship.hp] : Array(ship.len).fill(ship.maxHp), sunk: useKnownHp && !!ship.sunk,
            r: Math.floor(first / BOARD_SIZE), c: first % BOARD_SIZE,
            vertical: cells.length > 1 && cells[1] - first === BOARD_SIZE, cells
        };
        cells.forEach((cell, segmentIndex) => {
            grid[Math.floor(cell / BOARD_SIZE)][cell % BOARD_SIZE] = { hit: false, shipId: index, segmentIndex };
        });
        return modelShip;
    });
    return { grid, ships, cells: grid.flat(), initialSunk: 0 };
}

function saveModel(model) {
    return { hp: model.ships.map(ship => [...ship.hp]), sunk: model.ships.map(ship => ship.sunk), hits: model.cells.map(cell => cell.hit) };
}

function restoreModel(model, saved) {
    model.ships.forEach((ship, index) => {
        for (let segment = 0; segment < ship.len; segment++) ship.hp[segment] = saved.hp[index][segment];
        ship.sunk = saved.sunk[index];
    });
    for (let cell = 0; cell < CELL_COUNT; cell++) model.cells[cell].hit = saved.hits[cell];
}

function setKnownCells(model, view) {
    for (let cell = 0; cell < CELL_COUNT; cell++) model.cells[cell].hit = !isOpen(view[cell]) || view[cell] === CellState.HIT;
}

export function describeAttack(action, abilities, viewGrid) {
    const state = Array.isArray(viewGrid[action.r]) ? viewGrid[action.r][action.c] : viewGrid[action.r * BOARD_SIZE + action.c];
    return {
        action: { weapon: action.weapon, r: action.r, c: action.c },
        apDamage: state === CellState.SUSPECT ? abilities.apDamageVsSuspect : abilities.apDamage,
        apMaxPenetrations: abilities.apMaxPenetrations,
        heShape: abilities.heShape, heCenterDamage: abilities.heCenterDamage, heOuterDamage: abilities.heOuterDamage,
        heCenterPenetrates: abilities.heProfile?.centerPenetrates,
        sonarRadius: abilities.sonarRadius, sonarReveal: abilities.sonarReveal
    };
}

function applyAction(model, descriptor, view, dealt = null) {
    const { weapon, r, c } = descriptor.action;
    const observations = [];
    let signal = null;
    if (weapon === 'SONAR') {
        signal = resolveSonar(r, c, model.grid, model.ships, false, descriptor.sonarRadius, descriptor.sonarReveal, { emitEvents: false });
    } else {
        const offsets = weapon === 'HE' ? getHEOffsets(descriptor.heShape) : [[0, 0]];
        for (const [rowOffset, colOffset] of offsets) {
            const row = r + rowOffset;
            const col = c + colOffset;
            if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) continue;
            const center = rowOffset === 0 && colOffset === 0;
            const amount = weapon === 'AP' ? descriptor.apDamage : center ? descriptor.heCenterDamage : descriptor.heOuterDamage;
            const options = weapon === 'AP'
                ? { penetrate: true, maxPenetrations: descriptor.apMaxPenetrations, emitEvents: false }
                : { penetrate: center && descriptor.heCenterPenetrates, emitEvents: false };
            if (dealt) dealt[row * BOARD_SIZE + col] += amount;
            const result = resolveHit(row, col, amount, model.grid, model.ships, false, options);
            if (result.sunk) observations.push(`S${result.hitShip.code}`);
        }
    }
    if (view) {
        for (let cell = 0; cell < CELL_COUNT; cell++) {
            if (view[cell] === CellState.SUNK) continue;
            const actual = model.cells[cell];
            if (!actual.hit) continue;
            const ship = actual.shipId < 0 ? null : model.ships[actual.shipId];
            view[cell] = !ship ? CellState.MISS : ship.sunk ? CellState.SUNK : ship.hp[actual.segmentIndex] <= 0 ? CellState.DESTROYED : CellState.HIT;
        }
        if (signal?.hasSignal) {
            for (let row = Math.max(0, r - descriptor.sonarRadius); row <= Math.min(BOARD_SIZE - 1, r + descriptor.sonarRadius); row++) {
                for (let col = Math.max(0, c - descriptor.sonarRadius); col <= Math.min(BOARD_SIZE - 1, c + descriptor.sonarRadius); col++) {
                    if (!model.grid[row][col].hit) view[row * BOARD_SIZE + col] = CellState.SUSPECT;
                }
            }
        }
    }
    return observations.join('|');
}

function compileHistory(history, currentView) {
    return history.map(descriptor => {
        const before = descriptor.beforeView ? Uint8Array.from(descriptor.beforeView.flat()) : null;
        const observed = descriptor.afterView ? Uint8Array.from(descriptor.afterView.flat()) : null;
        const scan = descriptor.action.weapon === 'SONAR'
            ? new Set(getActionCoverage('SONAR', descriptor.action.r, descriptor.action.c, { sonarRadius: descriptor.sonarRadius }).map(cell => cell.r * BOARD_SIZE + cell.c)) : null;
        const sunkWitness = !!before && !!scan && [...scan].some(cell => currentView[cell] === CellState.SUNK && (before[cell] === CellState.UNKNOWN || before[cell] === CellState.SUSPECT));
        return { descriptor, before, observed, scan, sunkWitness };
    });
}

function heCoverage(shape) {
    if (!HE_COVERAGE.has(shape)) {
        const offsets = getHEOffsets(shape);
        HE_COVERAGE.set(shape, Array.from({ length: CELL_COUNT }, (_, cell) => Int16Array.from(offsets.map(([rowOffset, colOffset]) => {
            const row = Math.floor(cell / BOARD_SIZE) + rowOffset;
            const col = cell % BOARD_SIZE + colOffset;
            return row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE ? -1 : row * BOARD_SIZE + col;
        }))));
    }
    return HE_COVERAGE.get(shape);
}

function prepareParticle(fleet, currentView, history, deadline = Infinity) {
    const model = createModel(fleet);
    for (const { descriptor, before, observed, scan, sunkWitness } of history) {
        if (deadline !== Infinity && performance.now() >= deadline) return DEADLINE;
        const after = before ? Uint8Array.from(before) : null;
        if (before) setKnownCells(model, before);
        applyAction(model, descriptor, after);
        if (observed && after) {
            for (let cell = 0; cell < CELL_COUNT; cell++) {
                if (currentView[cell] === CellState.SUNK) continue;
                if (observed[cell] === CellState.SUSPECT && (sunkWitness || !scan?.has(cell))) continue;
                if (observed[cell] === CellState.MISS || observed[cell] === CellState.HIT || observed[cell] === CellState.DESTROYED || (observed[cell] === CellState.SUSPECT && before[cell] === CellState.UNKNOWN)) {
                    if (after[cell] !== observed[cell]) return null;
                }
            }
        }
    }
    for (const ship of model.ships) {
        for (let segment = 0; segment < ship.len; segment++) {
            if ((currentView[ship.cells[segment]] === CellState.DESTROYED) !== (ship.hp[segment] <= 0)) return null;
        }
        if (ship.hp.every(hp => hp <= 0)) return null;
        ship.sunk = false;
    }
    setKnownCells(model, currentView);
    model.saved = saveModel(model);
    return model;
}

function abilitiesFor(attacker, defender) {
    return checkAIAbilities(attacker.ships, attacker.faction, defender.faction, {
        sunkEnemyShips: defender.initialSunk + defender.ships.filter(ship => ship.sunk).length, neutralBias: true
    });
}

function collectParticles(belief, view, history, context, tuning, deadline) {
    const particles = [];
    const fleets = belief.iterateSampleFleets ? belief.iterateSampleFleets(belief._sampleCount, true) : belief.getSampleFleets(belief._sampleCount);
    for (const fleet of fleets) {
        if (performance.now() >= deadline) break;
        const model = prepareParticle(fleet, view, history, deadline);
        if (model === DEADLINE) break;
        if (!model) continue;
        model.faction = context.playerFaction;
        model.initialSunk = context.myShips.filter(ship => ship.sunk).length;
        particles.push(model);
        if (particles.length >= (tuning.modelSamples ?? 48)) break;
    }
    return particles;
}

function legalActions(view, abilities, includeSonar = true) {
    const actions = [];
    for (let cell = 0; cell < CELL_COUNT; cell++) {
        const r = Math.floor(cell / BOARD_SIZE);
        const c = cell % BOARD_SIZE;
        if (isOpen(view[cell])) actions.push({ weapon: 'AP', r, c });
        if (abilities.canUseAir && getActionCoverage('HE', r, c, abilities).some(point => isOpen(view[point.r * BOARD_SIZE + point.c]))) actions.push({ weapon: 'HE', r, c });
        if (includeSonar && abilities.canUseSonar && getActionCoverage('SONAR', r, c, abilities).some(point => view[point.r * BOARD_SIZE + point.c] === CellState.UNKNOWN || view[point.r * BOARD_SIZE + point.c] === CellState.SUSPECT)) actions.push({ weapon: 'SONAR', r, c });
    }
    return actions;
}

function victory(state) {
    if (state.models[1].ships.every(ship => ship.sunk)) return 1;
    if (state.models[0].ships.every(ship => ship.sunk)) return 0;
    return null;
}

function makeNode(actions, preferred, scores = null) {
    const shuffled = [...actions];
    for (let index = shuffled.length - 1; index > 0; index--) {
        const target = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    if (scores) shuffled.sort((left, right) => scores.get(right) - scores.get(left));
    const preferredIndex = preferred ? shuffled.findIndex(action => action.weapon === preferred.weapon && action.r === preferred.r && action.c === preferred.c) : -1;
    if (preferredIndex > 0) [shuffled[0], shuffled[preferredIndex]] = [shuffled[preferredIndex], shuffled[0]];
    return { visits: 0, actions: shuffled.map(action => ({ action, visits: 0, wins: 0, difference: 0, children: null })) };
}

export class BeliefSearch {
    constructor(context, belief, history, damageGrid, tuning, createPolicyEngine = null, preferredBaseline = null, deadline = Infinity, validationBeliefFactory = null, neuralModel = null) {
        this.context = context;
        this.neuralModel = neuralModel;
        this.tuning = tuning;
        this.iterations = 0;
        this.planningIterations = 0;
        this.phase = 'planning';
        this.stopReason = null;
        this.deadline = deadline;
        this.particles = [];
        this.validationBeliefFactory = validationBeliefFactory;
        if (preferredBaseline && performance.now() >= deadline) {
            this.root = makeNode([preferredBaseline], preferredBaseline);
            this.baseline = this.root.actions[0];
            this.stop('time');
            return;
        }
        this.scenarios = [];
        this.policyCache = new Map();
        this.createPolicyEngine = createPolicyEngine;
        this.sonarHistory = new Set(history.filter(entry => entry.action.weapon === 'SONAR').map(entry => `${entry.action.r},${entry.action.c}`));
        this.pursuit = context.pursuit;
        this.view = Uint8Array.from(context.viewGrid.flat());
        this.opponentView = Uint8Array.from((context.playerViewGrid || Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0))).flat());
        this.damageGrid = Float64Array.from(damageGrid.flat());
        const compiledHistory = compileHistory(history, this.view);
        this.compiledHistory = compiledHistory;
        this.sensorRegions = [[], []];
        for (const entry of compiledHistory) {
            if (!entry.scan || !entry.before || !entry.observed) continue;
            const cells = [...entry.scan].filter(cell => entry.before[cell] === CellState.UNKNOWN || entry.before[cell] === CellState.SUSPECT);
            if (cells.some(cell => entry.observed[cell] === CellState.HIT || entry.observed[cell] === CellState.SUSPECT)) this.sensorRegions[0].push(cells);
        }
        for (const seat of [0, 1]) {
            const area = this.pursuit?.hunters?.[seat]?.areaContact || (seat === 0 ? context.areaContact : null);
            const targets = seat === 0 ? context.myShips : context.enemyShips;
            if (area && targets.filter(ship => !ship.sunk).length === 1) {
                const cells = area.cells.map(cell => cell.r * BOARD_SIZE + cell.c);
                if (cells.length) this.sensorRegions[seat].push(cells);
            }
        }
        const ownFleet = context.enemyShips.map(ship => ({ ship, cells: Array.from({ length: ship.len }, (_, segment) => (ship.r + ((ship.vertical ?? ship.v) ? segment : 0)) * BOARD_SIZE + ship.c + ((ship.vertical ?? ship.v) ? 0 : segment)) }));
        this.own = createModel(ownFleet, true);
        this.own.faction = context.aiFaction;
        setKnownCells(this.own, this.opponentView);
        this.own.saved = saveModel(this.own);
        this.particles = collectParticles(belief, this.view, compiledHistory, context, tuning, deadline);
        if (preferredBaseline && performance.now() >= deadline) {
            this.root = makeNode([preferredBaseline], preferredBaseline);
            this.baseline = this.root.actions[0];
            this.stop('time');
            return;
        }
        if (this.particles.length) {
            const state = { models: [this.own, this.particles[0]], views: [this.view, this.opponentView], dealt: [this.damageGrid, new Float64Array(CELL_COUNT)] };
            let preferred;
            if (preferredBaseline) preferred = preferredBaseline;
            else if (tuning.pairedSearch && createPolicyEngine) {
                const engine = createPolicyEngine();
                engine.damageDealtGrid = damageGrid.map(row => [...row]);
                engine.sonarHistory = new Set(this.sonarHistory);
                preferred = engine.decide({ ...context, difficultyConfig: { ...context.difficultyConfig, tuning: { ...tuning, search: false } } });
            } else preferred = this.computeRolloutPolicy(state, 0);
            const actions = this.nodeActions(state);
            let scores = null;
            if (tuning.actionOrder === 'posterior') {
                const abilities = checkAIAbilities(context.enemyShips, context.aiFaction, context.playerFaction, {
                    sunkEnemyShips: context.myShips.filter(ship => ship.sunk).length
                });
                const maximumHp = Math.max(...context.myShips.filter(ship => !ship.sunk).map(ship => ship.maxHp));
                const probabilities = new Float64Array(CELL_COUNT);
                for (const particle of this.particles) {
                    for (const ship of particle.ships) {
                        for (const cell of ship.cells) if (isOpen(this.view[cell])) probabilities[cell] += 1 / this.particles.length;
                    }
                }
                const probabilityGrid = Array.from({ length: BOARD_SIZE }, (_, row) => Array.from(probabilities.subarray(row * BOARD_SIZE, (row + 1) * BOARD_SIZE)));
                const posterior = BeliefState.fromMarginals(context.myShips.filter(ship => !ship.sunk), context.viewGrid, probabilityGrid);
                scores = new Map(actions.map(action => [action, evaluateAction(posterior, action, abilities, context.difficultyConfig.alpha, damageGrid, maximumHp)]));
            }
            if (this.neuralPolicyEnabled) scores = this.neuralScores(state, actions);
            this.root = makeNode(actions, preferred, scores);
            this.baseline = this.root.actions[0];
        } else if (tuning.pairedSearch && preferredBaseline) {
            this.root = makeNode([preferredBaseline], preferredBaseline);
            this.baseline = this.root.actions[0];
            this.inferenceFallback = true;
            this.stop('inference');
        } else this.root = null;
    }

    get neuralPolicyEnabled() {
        return !!this.neuralModel?.metadata.policyTrained && this.tuning.neuralPolicy !== false;
    }

    neuralPrediction(state, seat) {
        if (!state.neuralPredictions) state.neuralPredictions = [];
        if (state.neuralPredictions[seat]) return state.neuralPredictions[seat];
        const own = state.models[seat];
        const target = state.models[1 - seat];
        const initialSunk = this.context.myShips.filter(ship => ship.sunk);
        const matrix = values => Array.from({ length: BOARD_SIZE }, (_, row) => Array.from(values.subarray(row * BOARD_SIZE, (row + 1) * BOARD_SIZE)));
        const context = {
            viewGrid: matrix(state.views[seat]), playerViewGrid: matrix(state.views[1 - seat]),
            enemyShips: [...own.ships, ...(seat === 1 ? initialSunk : [])],
            myShips: [...target.ships, ...(seat === 0 ? initialSunk : [])],
            aiFaction: own.faction, playerFaction: target.faction,
            areaContact: this.hunters(state)[seat].areaContact,
            pursuit: { enabled: this.pursuit?.enabled !== false, hunters: [this.hunters(state)[seat], this.hunters(state)[1 - seat]] }
        };
        const observation = encodeNeuralObservation(context, {
            damageGrid: matrix(state.dealt[seat]), regions: (state.regions || this.sensorRegions)[seat],
            sonarHistory: state.sonarUsed?.[seat] ?? (seat === 0 ? this.sonarHistory : new Set())
        });
        return state.neuralPredictions[seat] = { observation, prediction: this.neuralModel.predict(observation) };
    }

    nodeActions(state) {
        const actions = legalActions(state.views[0], abilitiesFor(state.models[0], state.models[1]));
        if (!this.neuralModel) return actions;
        const { observation } = this.neuralPrediction(state, 0);
        return actions.filter(action => observation.mask[neuralActionIndex(action)]);
    }

    neuralScores(state, actions) {
        const { prediction } = this.neuralPrediction(state, 0);
        return new Map(actions.map(action => [action, prediction.logits[neuralActionIndex(action)]]));
    }

    legacyEngine(state, seat) {
        if (!this.createPolicyEngine || (this.tuning.rolloutPolicy !== 'legacy' && (seat !== 1 || this.tuning.rolloutOpponent !== 'legacy'))) return null;
        if (!state.legacyEngines) state.legacyEngines = [];
        if (!state.legacyEngines[seat]) {
            const engine = this.createPolicyEngine();
            if (seat === 0) {
                engine.damageDealtGrid = Array.from({ length: BOARD_SIZE }, (_, row) => Array.from(this.damageGrid.subarray(row * BOARD_SIZE, (row + 1) * BOARD_SIZE)));
                engine.sonarHistory = new Set(this.sonarHistory);
            }
            state.legacyEngines[seat] = engine;
        }
        return state.legacyEngines[seat];
    }

    hunters(state) {
        if (!state.hunters) {
            state.hunters = [0, 1].map(seat => {
                const saved = this.pursuit?.hunters?.[seat];
                const area = saved?.areaContact || (seat === 0 ? this.context.areaContact : null);
                return { turns: saved?.turns ?? 0, first: saved?.first ?? true,
                    areaContact: area && state.models[1 - seat].ships.filter(ship => !ship.sunk).length === 1
                        ? { ...area, shipId: state.models[1 - seat].ships.find(ship => !ship.sunk).id } : null };
            });
        }
        return state.hunters;
    }

    rolloutPolicy(state, seat) {
        this.checkDeadline();
        if (state.randomSeed === undefined) return this.computeRolloutPolicy(state, seat);
        const saved = Math.random;
        const turn = state.policyTurns?.[seat] ?? 0;
        Math.random = scenarioRandom(state.randomSeed ^ Math.imul(turn + 1, seat === 0 ? 0x9E3779B9 : 0x85EBCA6B));
        try { return this.computeRolloutPolicy(state, seat); }
        finally { Math.random = saved; }
    }

    computeRolloutPolicy(state, seat) {
        if (this.neuralPolicyEnabled) {
            const { observation, prediction } = this.neuralPrediction(state, seat);
            let best = null;
            let maximum = -Infinity;
            for (const action of legalActions(state.views[seat], abilitiesFor(state.models[seat], state.models[1 - seat]))) {
                const index = neuralActionIndex(action);
                if (observation.mask[index] && prediction.logits[index] > maximum) { maximum = prediction.logits[index]; best = action; }
            }
            return best;
        }
        const own = state.models[seat];
        const target = state.models[1 - seat];
        const view = state.views[seat];
        const abilities = abilitiesFor(own, target);
        const targets = target.ships.filter(ship => !ship.sunk).map(ship => ({ id: ship.id, code: ship.code, len: ship.len, maxHp: ship.maxHp, sunk: false }));
        const engine = this.legacyEngine(state, seat);
        if (engine) {
            const damage = engine.damageDealtGrid.map(row => [...row]);
            const sonarHistory = new Set(engine.sonarHistory);
            const historyLength = engine.actionHistory.length;
            const action = engine.decide({
                viewGrid: Array.from({ length: BOARD_SIZE }, (_, row) => Array.from(view.subarray(row * BOARD_SIZE, (row + 1) * BOARD_SIZE))),
                playerViewGrid: Array.from({ length: BOARD_SIZE }, (_, row) => Array.from(state.views[1 - seat].subarray(row * BOARD_SIZE, (row + 1) * BOARD_SIZE))),
                myShips: [...target.ships.map(ship => ({ id: ship.id, code: ship.code, len: ship.len, maxHp: ship.maxHp, sunk: ship.sunk })),
                    ...(seat === 0 ? this.context.myShips.filter(ship => ship.sunk).map(ship => ({ id: ship.id, code: ship.code, len: ship.len, maxHp: ship.maxHp, sunk: true })) : [])],
                enemyShips: own.ships,
                aiFaction: own.faction,
                playerFaction: target.faction,
                areaContact: this.hunters(state)[seat].areaContact,
                difficultyConfig: { ...this.context.difficultyConfig, tuning: { ...this.tuning, search: false } }
            });
            engine.damageDealtGrid = damage;
            engine.sonarHistory = sonarHistory;
            engine.actionHistory.length = historyLength;
            return action;
        }
        const regions = activeSensorRegions((state.regions || this.sensorRegions)[seat], view);
        const key = targets.map(ship => ship.code).join(',') + ':' + view.join('') + ':' + regions.map(region => region.join(',')).join('|');
        let probabilities = this.policyCache.get(key);
        if (!probabilities) {
            probabilities = approximatePosterior(targets, view, regions);
            if (this.policyCache.size >= (this.tuning.policyCacheLimit ?? 2048)) this.policyCache.clear();
            this.policyCache.set(key, probabilities);
        }
        const maximumHp = Math.max(...targets.map(ship => ship.maxHp), 1);
        const centerValues = abilities.canUseAir ? new Float64Array(CELL_COUNT) : null;
        const outerValues = abilities.canUseAir ? new Float64Array(CELL_COUNT) : null;
        const coverage = abilities.canUseAir ? heCoverage(abilities.heShape) : null;
        if (abilities.canUseAir) {
            for (let cell = 0; cell < CELL_COUNT; cell++) {
                const remaining = Math.max(1, maximumHp - state.dealt[seat][cell]);
                centerValues[cell] = probabilities[cell] * Math.min(abilities.heCenterDamage, remaining);
                outerValues[cell] = probabilities[cell] * Math.min(abilities.heOuterDamage, remaining);
            }
        }
        let maximum = -Infinity;
        let selected = null;
        let ties = 0;
        for (let cell = 0; cell < CELL_COUNT; cell++) {
            const r = Math.floor(cell / BOARD_SIZE);
            const c = cell % BOARD_SIZE;
            if (isOpen(view[cell])) {
                const amount = view[cell] === CellState.SUSPECT ? abilities.apDamageVsSuspect : abilities.apDamage;
                const score = probabilities[cell] * Math.min(amount, Math.max(1, maximumHp - state.dealt[seat][cell]));
                if (score > maximum + 1e-12) { maximum = score; selected = { weapon: 'AP', r, c }; ties = 1; }
                else if (Math.abs(score - maximum) <= 1e-12 && Math.random() < 1 / ++ties) selected = { weapon: 'AP', r, c };
            }
            if (abilities.canUseAir) {
                let score = centerValues[cell];
                const cells = coverage[cell];
                for (let offset = 1; offset < cells.length; offset++) {
                    if (cells[offset] >= 0) score += outerValues[cells[offset]];
                }
                if (score > maximum + 1e-12) { maximum = score; selected = { weapon: 'HE', r, c }; ties = 1; }
                else if (Math.abs(score - maximum) <= 1e-12 && Math.random() < 1 / ++ties) selected = { weapon: 'HE', r, c };
            }
        }
        return selected;
    }

    play(state, seat, action) {
        this.checkDeadline();
        const abilities = abilitiesFor(state.models[seat], state.models[1 - seat]);
        if (!state.regions) state.regions = this.sensorRegions.map(regions => [...regions]);
        const scan = action.weapon === 'SONAR' ? getActionCoverage('SONAR', action.r, action.c, abilities)
            .map(cell => cell.r * BOARD_SIZE + cell.c).filter(cell => state.views[seat][cell] === CellState.UNKNOWN || state.views[seat][cell] === CellState.SUSPECT) : null;
        const engine = this.legacyEngine(state, seat);
        if (engine) {
            const view = Array.from({ length: BOARD_SIZE }, (_, row) => Array.from(state.views[seat].subarray(row * BOARD_SIZE, (row + 1) * BOARD_SIZE)));
            engine.recordDamageDealt(action, abilities, view);
            if (action.weapon === 'SONAR') engine.sonarHistory.add(`${action.r},${action.c}`);
        }
        const observation = applyAction(state.models[1 - seat], describeAttack(action, abilities, state.views[seat]), state.views[seat], state.dealt[seat]);
        if (scan?.some(cell => state.views[seat][cell] === CellState.HIT || state.views[seat][cell] === CellState.SUSPECT)) state.regions[seat].push(scan);
        if (this.pursuit?.enabled !== false && state.models[1 - seat].ships.some(ship => !ship.sunk)) {
            const contact = advancePursuit(this.hunters(state)[seat], state.models[1 - seat].ships, state.views[seat]);
            if (contact) state.regions[seat].push(contact.cells.map(cell => cell.r * BOARD_SIZE + cell.c).filter(cell => state.views[seat][cell] === CellState.SUSPECT));
        }
        if (state.policyTurns) state.policyTurns[seat]++;
        if (state.sonarUsed && action.weapon === 'SONAR') state.sonarUsed[seat].add(`${action.r},${action.c}`);
        state.neuralPredictions = null;
        return observation;
    }

    rollout(state, depth = 0) {
        if (this.neuralModel) {
            let terminal = victory(state);
            if (terminal !== null) return terminal;
            if (depth % 2 === 1) {
                const reply = this.rolloutPolicy(state, 1);
                if (!reply) return 0.5;
                this.play(state, 1, reply);
                terminal = victory(state);
                if (terminal !== null) return terminal;
            }
            return this.neuralPrediction(state, 0).prediction.value;
        }
        for (let step = depth; step < (this.tuning.rolloutLimit ?? 160); step++) {
            let result = victory(state);
            if (result !== null) return result;
            const seat = step % 2;
            const action = this.rolloutPolicy(state, seat);
            if (!action) return 0.5;
            this.play(state, seat, action);
            result = victory(state);
            if (result !== null) return result;
        }
        return 0.5;
    }

    selectEntry(node) {
        const active = node.actions.slice(0, Math.min(node.actions.length, Math.ceil(Math.sqrt(node.visits + 1))));
        let selected = active.find(entry => entry.visits === 0);
        if (!selected) {
            let maximum = -Infinity;
            for (const entry of active) {
                const paired = this.tuning.pairedSearch && node === this.root;
                const value = (paired ? entry.difference : entry.wins) / entry.visits;
                const score = value + (paired ? 2 : 1) * Math.sqrt(2 * Math.log(Math.max(1, node.visits)) / entry.visits);
                if (score > maximum) { maximum = score; selected = entry; }
            }
        }
        return selected;
    }

    simulate(node, state, depth, selected = this.selectEntry(node)) {
        this.checkDeadline();
        if (!selected) return 0.5;
        const observation = this.play(state, 0, selected.action);
        let result = victory(state);
        if (result === null) {
            const reply = this.rolloutPolicy(state, 1);
            if (!reply) result = 0.5;
            else {
                this.play(state, 1, reply);
                result = victory(state);
                if (result === null) {
                    const key = observation + ':' + state.views[0].join('') + ':' + reply.weapon + reply.r + ',' + reply.c + ':' + state.views[1].join('') + ':' + state.models[0].ships.map(ship => ship.hp.join(',')).join(';');
                    if (!selected.children) selected.children = new Map();
                    let child = selected.children.get(key);
                    if (!child) {
                        const actions = this.nodeActions(state);
                        child = makeNode(actions, this.rolloutPolicy(state, 0), this.neuralPolicyEnabled ? this.neuralScores(state, actions) : null);
                        selected.children.set(key, child);
                        result = this.rollout(state, depth + 2);
                    } else if (depth + 2 >= (this.tuning.searchDepth ?? 12)) result = this.rollout(state, depth + 2);
                    else result = this.simulate(child, state, depth + 2);
                }
            }
        }
        node.visits++;
        selected.visits++;
        selected.wins += result;
        return result;
    }

    get finished() { return !this.root || this.phase === 'complete'; }

    setDeadline(deadline) { this.deadline = deadline; }

    checkDeadline() {
        if (performance.now() >= this.deadline) throw DEADLINE;
    }

    stop(reason) {
        this.phase = 'complete';
        this.stopReason = reason;
    }

    makeScenario(validation = false) {
        const particles = validation && this.validationParticles ? this.validationParticles : this.particles;
        return { particle: particles[Math.floor(Math.random() * particles.length)], seed: Math.floor(Math.random() * 4294967296) };
    }

    scenarioState(scenario) {
        restoreModel(this.own, this.own.saved);
        restoreModel(scenario.particle, scenario.particle.saved);
        return { models: [this.own, scenario.particle], views: [Uint8Array.from(this.view), Uint8Array.from(this.opponentView)],
            dealt: [Float64Array.from(this.damageGrid), new Float64Array(CELL_COUNT)], randomSeed: scenario.seed, policyTurns: [0, 0],
            sonarUsed: [new Set(this.sonarHistory), new Set()] };
    }

    evaluateScenario(action, scenario) {
        const state = this.scenarioState(scenario);
        this.play(state, 0, action);
        return this.rollout(state, 1);
    }

    freezeCandidate() {
        if (!this.tuning.pairedSearch) { this.stop('iterations'); return; }
        this.candidate = this.root.actions.filter(entry => entry.visits > 0)
            .sort((left, right) => right.difference / right.visits - left.difference / left.visits || right.visits - left.visits)[0];
        if (!this.candidate || this.candidate === this.baseline || this.candidate.difference <= 0) { this.stop('baseline'); return; }
        if (this.validationBeliefFactory) {
            const started = performance.now();
            const belief = this.validationBeliefFactory(this.deadline);
            this.validationParticles = collectParticles(belief, this.view, this.compiledHistory, this.context, this.tuning, this.deadline);
            this.validationInferenceMs = performance.now() - started;
            if (performance.now() >= this.deadline) { this.stop('time'); return; }
            if (!this.validationParticles.length) { this.inferenceFallback = true; this.stop('inference'); return; }
        }
        this.evidence = new PairedEvidence(this.tuning.searchRisk ?? 0.05);
        this.phase = 'validation';
    }

    advance(count) {
        for (let iteration = 0; iteration < count && !this.finished; iteration++) {
            try {
                this.checkDeadline();
                if (this.phase === 'planning') {
                    const selected = this.selectEntry(this.root);
                    const paired = this.tuning.pairedSearch;
                    const scenarioIndex = selected.visits;
                    const scenario = paired ? (this.scenarios[scenarioIndex] ??= this.makeScenario()) : this.makeScenario();
                    if (paired && scenario.baselineReward === undefined) scenario.baselineReward = this.evaluateScenario(this.baseline.action, scenario);
                    const result = this.simulate(this.root, this.scenarioState(scenario), 0, selected);
                    if (paired) selected.difference += result - scenario.baselineReward;
                    this.planningIterations++;
                    if (this.planningIterations >= (this.tuning.searchIterations ?? 64)) this.freezeCandidate();
                } else {
                    const scenario = this.makeScenario(true);
                    const baseline = this.evaluateScenario(this.baseline.action, scenario);
                    const candidate = this.evaluateScenario(this.candidate.action, scenario);
                    this.evidence.observe(candidate, baseline);
                    if (this.evidence.accepted) this.stop('accepted');
                    else if (this.evidence.rejected) this.stop('rejected');
                    else if (this.evidence.samples >= (this.tuning.validationIterations ?? 64)) this.stop('inconclusive');
                }
                this.iterations++;
            } catch (error) {
                if (error !== DEADLINE) throw error;
                this.stop('time');
            }
        }
    }

    trainingPolicy() {
        if (!this.neuralModel || !this.root || this.inferenceFallback) return null;
        const visited = this.root.actions.filter(entry => entry.visits > 0);
        if (visited.length < 2) return null;
        const total = visited.reduce((sum, entry) => sum + entry.visits, 0);
        const probabilities = new Float32Array(NEURAL_ACTIONS);
        for (const entry of visited) probabilities[neuralActionIndex(entry.action)] = entry.visits / total;
        return probabilities;
    }

    decision() {
        let selected = this.tuning.pairedSearch ? (this.evidence?.accepted ? this.candidate : this.baseline)
            : this.root?.actions.filter(entry => entry.visits > 0).sort((left, right) => right.visits - left.visits || right.wins / right.visits - left.wins / left.visits)[0] || this.root?.actions[0];
        if (this.neuralModel && !this.tuning.pairedSearch && this.tuning.trainingTemperature > 0) {
            const visited = this.root?.actions.filter(entry => entry.visits > 0) || [];
            const weights = visited.map(entry => entry.visits ** (1 / this.tuning.trainingTemperature));
            let threshold = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
            for (let index = 0; index < visited.length; index++) {
                threshold -= weights[index];
                if (threshold <= 0) { selected = visited[index]; break; }
            }
        }
        return selected ? { action: selected.action, visits: selected.visits, winRate: selected.visits ? selected.wins / selected.visits : null,
            iterations: this.iterations, particles: this.particles.length, planningIterations: this.planningIterations,
            validationSamples: this.evidence?.samples ?? 0, logEvidence: this.evidence?.logEvidence ?? 0,
            pairedDifference: this.evidence?.mean ?? 0, pairedVariance: this.evidence?.variance ?? 0,
            improved: !!this.evidence?.accepted, stopReason: this.stopReason,
            baselineMs: this.baselineMs ?? 0, inferenceMs: this.inferenceMs ?? 0,
            validationInferenceMs: this.validationInferenceMs ?? 0, validationModels: this.validationParticles?.length ?? 0,
            inferenceFallback: !!this.inferenceFallback } : null;
    }
}
