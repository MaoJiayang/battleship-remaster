import { BOARD_SIZE } from '../config/constants.js';
import { getHEOffsets } from '../data/doctrines.js';
import { resolveHit } from '../game/battle/HitResolver.js';
import { resolveSonar } from '../game/battle/SonarResolver.js';
import { advancePursuit } from '../game/battle/PursuitResolver.js';
import { CellState, checkAIAbilities, getActionCoverage } from './aiCore.js';
import { approximatePosterior } from './rolloutBelief.js';

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
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
            const result = resolveHit(row, col, amount, model.grid, model.ships, false, options);
            if (result.dealt > 0) {
                observations.push(`${row * BOARD_SIZE + col}:${result.dealt}`);
                if (dealt) dealt[row * BOARD_SIZE + col] += result.dealt;
            }
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

function prepareParticle(fleet, currentView, history) {
    const model = createModel(fleet);
    for (const descriptor of history) {
        const before = descriptor.beforeView ? Uint8Array.from(descriptor.beforeView.flat()) : null;
        const after = before ? Uint8Array.from(before) : null;
        if (before) setKnownCells(model, before);
        applyAction(model, descriptor, after);
        if (descriptor.afterView && after) {
            const observed = descriptor.afterView.flat();
            const scan = descriptor.action.weapon === 'SONAR'
                ? new Set(getActionCoverage('SONAR', descriptor.action.r, descriptor.action.c, { sonarRadius: descriptor.sonarRadius }).map(cell => cell.r * BOARD_SIZE + cell.c)) : null;
            let sunkWitness = false;
            if (descriptor.action.weapon === 'SONAR') {
                const { r, c } = descriptor.action;
                for (const cell of getActionCoverage('SONAR', r, c, { sonarRadius: descriptor.sonarRadius })) {
                    const index = cell.r * BOARD_SIZE + cell.c;
                    if (currentView[index] === CellState.SUNK && (before[index] === CellState.UNKNOWN || before[index] === CellState.SUSPECT)) sunkWitness = true;
                }
            }
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

function makeNode(actions, preferred) {
    const shuffled = [...actions];
    for (let index = shuffled.length - 1; index > 0; index--) {
        const target = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    const preferredIndex = preferred ? shuffled.findIndex(action => action.weapon === preferred.weapon && action.r === preferred.r && action.c === preferred.c) : -1;
    if (preferredIndex > 0) [shuffled[0], shuffled[preferredIndex]] = [shuffled[preferredIndex], shuffled[0]];
    return { visits: 0, actions: shuffled.map(action => ({ action, visits: 0, wins: 0, children: null })) };
}

export class BeliefSearch {
    constructor(context, belief, history, damageGrid, tuning, createPolicyEngine = null) {
        this.context = context;
        this.tuning = tuning;
        this.iterations = 0;
        this.policyCache = new Map();
        this.createPolicyEngine = createPolicyEngine;
        this.sonarHistory = new Set(history.filter(entry => entry.action.weapon === 'SONAR').map(entry => `${entry.action.r},${entry.action.c}`));
        this.pursuit = context.pursuit;
        this.view = Uint8Array.from(context.viewGrid.flat());
        this.opponentView = Uint8Array.from((context.playerViewGrid || Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0))).flat());
        this.damageGrid = Float64Array.from(damageGrid.flat());
        const ownFleet = context.enemyShips.map(ship => ({ ship, cells: Array.from({ length: ship.len }, (_, segment) => (ship.r + ((ship.vertical ?? ship.v) ? segment : 0)) * BOARD_SIZE + ship.c + ((ship.vertical ?? ship.v) ? 0 : segment)) }));
        this.own = createModel(ownFleet, true);
        this.own.faction = context.aiFaction;
        setKnownCells(this.own, this.opponentView);
        this.own.saved = saveModel(this.own);
        this.particles = [];
        const fleets = belief.getSampleFleets(belief._sampleCount);
        for (let index = fleets.length - 1; index > 0; index--) {
            const target = Math.floor(Math.random() * (index + 1));
            [fleets[index], fleets[target]] = [fleets[target], fleets[index]];
        }
        for (const fleet of fleets) {
            const model = prepareParticle(fleet, this.view, history);
            if (!model) continue;
            model.faction = context.playerFaction;
            model.initialSunk = context.myShips.filter(ship => ship.sunk).length;
            this.particles.push(model);
            if (this.particles.length >= (tuning.modelSamples ?? 96)) break;
        }
        if (this.particles.length) {
            const state = { models: [this.own, this.particles[0]], views: [this.view, this.opponentView], dealt: [this.damageGrid, new Float64Array(CELL_COUNT)] };
            this.root = makeNode(legalActions(this.view, abilitiesFor(this.own, this.particles[0])), this.rolloutPolicy(state, 0));
        } else this.root = null;
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
        const key = targets.map(ship => ship.code).join(',') + ':' + view.join('');
        let probabilities = this.policyCache.get(key);
        if (!probabilities) {
            probabilities = approximatePosterior(targets, view);
            if (this.policyCache.size >= (this.tuning.policyCacheLimit ?? 2048)) this.policyCache.clear();
            this.policyCache.set(key, probabilities);
        }
        const maximumHp = Math.max(...targets.map(ship => ship.maxHp), 1);
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
                let score = 0;
                for (const [rowOffset, colOffset] of getHEOffsets(abilities.heShape)) {
                    const row = r + rowOffset;
                    const col = c + colOffset;
                    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) continue;
                    const index = row * BOARD_SIZE + col;
                    const amount = rowOffset === 0 && colOffset === 0 ? abilities.heCenterDamage : abilities.heOuterDamage;
                    score += probabilities[index] * Math.min(amount, Math.max(1, maximumHp - state.dealt[seat][index]));
                }
                if (score > maximum + 1e-12) { maximum = score; selected = { weapon: 'HE', r, c }; ties = 1; }
                else if (Math.abs(score - maximum) <= 1e-12 && Math.random() < 1 / ++ties) selected = { weapon: 'HE', r, c };
            }
        }
        return selected;
    }

    play(state, seat, action) {
        const abilities = abilitiesFor(state.models[seat], state.models[1 - seat]);
        const engine = this.legacyEngine(state, seat);
        if (engine) {
            const view = Array.from({ length: BOARD_SIZE }, (_, row) => Array.from(state.views[seat].subarray(row * BOARD_SIZE, (row + 1) * BOARD_SIZE)));
            engine.recordDamageDealt(action, abilities, view);
            if (action.weapon === 'SONAR') engine.sonarHistory.add(`${action.r},${action.c}`);
        }
        const observation = applyAction(state.models[1 - seat], describeAttack(action, abilities, state.views[seat]), state.views[seat], state.dealt[seat]);
        if (this.pursuit?.enabled !== false && state.models[1 - seat].ships.some(ship => !ship.sunk)) {
            advancePursuit(this.hunters(state)[seat], state.models[1 - seat].ships, state.views[seat]);
        }
        return observation;
    }

    rollout(state, depth = 0) {
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

    simulate(node, state, depth) {
        const active = node.actions.slice(0, Math.min(node.actions.length, Math.ceil(Math.sqrt(node.visits + 1))));
        let selected = active.find(entry => entry.visits === 0);
        if (!selected) {
            let maximum = -Infinity;
            for (const entry of active) {
                const score = entry.wins / entry.visits + Math.sqrt(2 * Math.log(Math.max(1, node.visits)) / entry.visits);
                if (score > maximum) { maximum = score; selected = entry; }
            }
        }
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
                        child = makeNode(legalActions(state.views[0], abilitiesFor(state.models[0], state.models[1])), this.rolloutPolicy(state, 0));
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

    advance(count) {
        if (!this.root) return;
        for (let iteration = 0; iteration < count && this.iterations < (this.tuning.searchIterations ?? 1024); iteration++) {
            const particle = this.particles[Math.floor(Math.random() * this.particles.length)];
            restoreModel(this.own, this.own.saved);
            restoreModel(particle, particle.saved);
            const state = { models: [this.own, particle], views: [Uint8Array.from(this.view), Uint8Array.from(this.opponentView)], dealt: [Float64Array.from(this.damageGrid), new Float64Array(CELL_COUNT)] };
            this.simulate(this.root, state, 0);
            this.iterations++;
        }
    }

    decision() {
        const selected = this.root?.actions.filter(entry => entry.visits > 0).sort((left, right) => right.visits - left.visits || right.wins / right.visits - left.wins / left.visits)[0];
        return selected ? { action: selected.action, visits: selected.visits, winRate: selected.wins / selected.visits, iterations: this.iterations, particles: this.particles.length } : null;
    }
}
