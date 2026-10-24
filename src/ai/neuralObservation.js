import { BOARD_SIZE } from '../config/constants.js';
import { SHIP_TYPES } from '../data/ships.js';
import { DOCTRINES } from '../data/doctrines.js';
import { CellState, checkAIAbilities, enumerateAllActions } from './aiCore.js';
import { activeSensorRegions, approximatePosterior } from './rolloutBelief.js';
import { NEURAL_SCHEMA, neuralRulesId } from './neuralRules.js';

export { NEURAL_SCHEMA, neuralRulesId } from './neuralRules.js';
export const NEURAL_WEAPONS = ['AP', 'HE', 'SONAR'];
export const NEURAL_CHANNELS = 17;
export const NEURAL_CELLS = BOARD_SIZE * BOARD_SIZE;
export const NEURAL_ACTIONS = NEURAL_CELLS * NEURAL_WEAPONS.length;

export function neuralActionIndex(action) {
    return NEURAL_WEAPONS.indexOf(action.weapon) * NEURAL_CELLS + action.r * BOARD_SIZE + action.c;
}

export function neuralAction(index) {
    const cell = index % NEURAL_CELLS;
    return { weapon: NEURAL_WEAPONS[Math.floor(index / NEURAL_CELLS)], r: Math.floor(cell / BOARD_SIZE), c: cell % BOARD_SIZE };
}

export function neuralSensorRegions(context, history = []) {
    const regions = [];
    for (const entry of history) {
        if (entry.action.weapon !== 'SONAR' || !entry.beforeView || !entry.afterView) continue;
        const cells = [];
        const radius = entry.sonarRadius ?? 1;
        for (let row = Math.max(0, entry.action.r - radius); row <= Math.min(BOARD_SIZE - 1, entry.action.r + radius); row++) {
            for (let col = Math.max(0, entry.action.c - radius); col <= Math.min(BOARD_SIZE - 1, entry.action.c + radius); col++) {
                const before = entry.beforeView[row][col];
                if (before === CellState.UNKNOWN || before === CellState.SUSPECT) cells.push(row * BOARD_SIZE + col);
            }
        }
        if (cells.some(cell => [CellState.HIT, CellState.SUSPECT].includes(entry.afterView[Math.floor(cell / BOARD_SIZE)][cell % BOARD_SIZE]))) regions.push(cells);
    }
    if (context.areaContact?.cells) regions.push(context.areaContact.cells.map(cell => cell.r * BOARD_SIZE + cell.c));
    return activeSensorRegions(regions, context.viewGrid.flat());
}

function abilityFeatures(abilities) {
    return [Number(abilities.canUseAir), Number(abilities.canUseSonar), abilities.apDamage / 8,
        abilities.apDamageVsSuspect / 8, abilities.apMaxPenetrations / 4, abilities.heCenterDamage / 8,
        abilities.heOuterDamage / 8, Number(abilities.heProfile.centerPenetrates),
        ...['x', 'plus', 'single'].map(shape => Number(abilities.heShape === shape)),
        abilities.sonarRadius / BOARD_SIZE, Number(abilities.sonarReveal === 'nearest')];
}

export function encodeNeuralObservation(context, options = {}) {
    const view = context.viewGrid.flat();
    const ownShips = context.enemyShips;
    const targets = context.myShips.map(ship => ({ id: ship.id, code: ship.code, len: ship.len, maxHp: ship.maxHp, sunk: ship.sunk }));
    const regions = options.regions ?? neuralSensorRegions(context, options.history);
    const probabilities = approximatePosterior(targets.filter(ship => !ship.sunk), view, regions);
    const planes = new Float32Array(NEURAL_CHANNELS * NEURAL_CELLS);
    const opponentView = context.playerViewGrid?.flat() || new Array(NEURAL_CELLS).fill(0);
    const damage = options.damageGrid?.flat() || new Array(NEURAL_CELLS).fill(0);
    for (let cell = 0; cell < NEURAL_CELLS; cell++) {
        planes[view[cell] * NEURAL_CELLS + cell] = 1;
        planes[6 * NEURAL_CELLS + cell] = probabilities[cell];
        planes[7 * NEURAL_CELLS + cell] = Math.log1p(damage[cell]) / Math.log(28);
        planes[(10 + opponentView[cell]) * NEURAL_CELLS + cell] = 1;
    }
    for (const ship of ownShips) {
        if (ship.sunk) continue;
        for (let segment = 0; segment < ship.len; segment++) {
            const vertical = ship.vertical ?? ship.v;
            const cell = (ship.r + (vertical ? segment : 0)) * BOARD_SIZE + ship.c + (vertical ? 0 : segment);
            planes[8 * NEURAL_CELLS + cell] = ship.hp[segment] / 3;
            planes[9 * NEURAL_CELLS + cell] = 1;
        }
    }
    for (const region of regions) for (const cell of region) planes[16 * NEURAL_CELLS + cell] = 1;
    const abilities = checkAIAbilities(ownShips, context.aiFaction, context.playerFaction, {
        sunkEnemyShips: targets.filter(ship => ship.sunk).length, neutralBias: true
    });
    const opponentAbilities = checkAIAbilities(targets, context.playerFaction, context.aiFaction, {
        sunkEnemyShips: ownShips.filter(ship => ship.sunk).length, neutralBias: true
    });
    const globals = [];
    for (const type of SHIP_TYPES) {
        const own = ownShips.find(ship => ship.code === type.code);
        const target = targets.find(ship => ship.code === type.code);
        globals.push(Number(!!own && !own.sunk), (own?.len ?? type.len) / BOARD_SIZE, (own?.maxHp ?? type.maxHp) / 4,
            own && !own.sunk ? own.hp.reduce((sum, amount) => sum + amount, 0) / (own.len * own.maxHp) : 0,
            Number(!!target && !target.sunk), (target?.len ?? type.len) / BOARD_SIZE, (target?.maxHp ?? type.maxHp) / 4);
    }
    globals.push(...abilityFeatures(abilities), ...abilityFeatures(opponentAbilities));
    for (const faction of [context.aiFaction, context.playerFaction]) {
        const doctrine = DOCTRINES[faction] || DOCTRINES.us;
        globals.push((doctrine.ap?.suspectBonus ?? 0) / 8, (doctrine.ap?.cvBonus ?? 0) / 8,
            (doctrine.ap?.sunkBonus ?? 0) / 8, (doctrine.ap?.sunkBonusCap ?? 0) / 8,
            Number(!!doctrine.ap?.quadTurrets), (doctrine.ap?.fallbackDamage ?? 1) / 8,
            (doctrine.ap?.damagePenalty ?? 0) / 8, (doctrine.defense?.apReduction ?? 0) / 8,
            (doctrine.defense?.apReductionMinDamage ?? 0) / 8, (doctrine.defense?.heVulnerability ?? 0) / 8);
    }
    for (let seat = 0; seat < 2; seat++) {
        const hunter = context.pursuit?.hunters?.[seat];
        globals.push((hunter?.turns ?? 0) / 3, Number(hunter?.first ?? true));
    }
    globals.push(Number(context.pursuit?.enabled !== false));
    const mask = new Uint8Array(NEURAL_ACTIONS);
    for (const action of enumerateAllActions(context.viewGrid, abilities, context.sonarEvidence)) {
        mask[neuralActionIndex(action)] = 1;
    }
    return { schema: NEURAL_SCHEMA, rulesId: neuralRulesId(), planes, globals: Float32Array.from(globals), mask };
}
