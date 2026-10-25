import { BOARD_SIZE } from '../config/constants.js';
import { getHEOffsets } from '../data/doctrines.js';
import { checkAIAbilities, enumerateAllActions } from './aiCore.js';
import { neuralRulesId } from './neuralRules.js';
import { neuralSensorRegions } from './neuralObservation.js';
import { approximatePosterior, activeSensorRegions } from './rolloutBelief.js';
import { encodeUnifiedObservation, encodeUnifiedEvent } from './unifiedObservation.js';

function profiles(abilities) {
    const sonarOffsets = [];
    for (let row = -abilities.sonarRadius; row <= abilities.sonarRadius; row++) {
        for (let col = -abilities.sonarRadius; col <= abilities.sonarRadius; col++) sonarOffsets.push({ r: row, c: col,
            reveals: row === 0 && col === 0 && abilities.sonarReveal !== 'nearest' });
    }
    return [
        { id: 'AP', kind: 'damage', available: true, penetrations: abilities.apMaxPenetrations,
            offsets: [{ r: 0, c: 0, damage: abilities.apDamage, suspectDamage: abilities.apDamageVsSuspect, penetrates: true }] },
        { id: 'HE', kind: 'damage', available: abilities.canUseAir, penetrations: 1,
            offsets: getHEOffsets(abilities.heShape).map(([rowOffset, colOffset]) => ({ r: rowOffset, c: colOffset,
                damage: rowOffset === 0 && colOffset === 0 ? abilities.heCenterDamage : abilities.heOuterDamage,
                penetrates: rowOffset === 0 && colOffset === 0 && abilities.heProfile.centerPenetrates })) },
        { id: 'SONAR', kind: 'information', available: abilities.canUseSonar, reveal: abilities.sonarReveal, offsets: sonarOffsets }
    ];
}

function describeWeapons(ships, faction, defenderFaction, sunkCount, targetCount) {
    ships = ships.map(ship => ({ id: ship.id, code: ship.code, len: ship.len, maxHp: ship.maxHp, sunk: ship.sunk }));
    const evaluate = (fleet, count = sunkCount) => profiles(checkAIAbilities(fleet, faction, defenderFaction,
        { sunkEnemyShips: count, neutralBias: true }));
    const current = evaluate(ships);
    for (const weapon of current) weapon.variants = [];
    for (let shipIndex = 0; shipIndex < ships.length; shipIndex++) {
        if (ships[shipIndex].sunk) continue;
        for (const kind of ['absent', 'alone']) {
            const fleet = ships.map((ship, index) => ({ ...ship, sunk: ship.sunk || (kind === 'absent' ? index === shipIndex : index !== shipIndex) }));
            const variants = evaluate(fleet);
            for (let weapon = 0; weapon < current.length; weapon++) current[weapon].variants.push({ kind, ship: ships[shipIndex], profile: variants[weapon] });
        }
    }
    for (const count of new Set([Math.min(targetCount, sunkCount + 1), targetCount])) {
        if (count <= sunkCount) continue;
        const variants = evaluate(ships, count);
        for (let weapon = 0; weapon < current.length; weapon++) current[weapon].variants.push({ kind: 'sunkCount', sunkCount: count, profile: variants[weapon] });
    }
    return current;
}

export function encodeGameUnifiedObservation(context, options = {}) {
    const targets = context.myShips.map(ship => ({ id: ship.id, code: ship.code, len: ship.len, maxHp: ship.maxHp, sunk: ship.sunk }));
    const own = context.enemyShips.map(ship => ({ id: ship.id, code: ship.code, len: ship.len, maxHp: ship.maxHp,
        sunk: ship.sunk, r: ship.r, c: ship.c, vertical: ship.vertical ?? ship.v, hp: ship.hp }));
    const regions = activeSensorRegions([...neuralSensorRegions(context, options.history), ...(context.sonarEvidence ?? [])], context.viewGrid.flat());
    const abilities = checkAIAbilities(own, context.aiFaction, context.playerFaction, { sunkEnemyShips: targets.filter(ship => ship.sunk).length, neutralBias: true });
    const rulesId = neuralRulesId();
    const cache = options.mechanismCache ?? {};
    const key = JSON.stringify([rulesId, context.aiFaction, context.playerFaction,
        ...[own, targets].map(ships => ships.map(ship => [ship.id, ship.code, ship.len, ship.maxHp, ship.sunk]))]);
    if (cache.key !== key) {
        cache.ownWeapons = describeWeapons(own, context.aiFaction, context.playerFaction, targets.filter(ship => ship.sunk).length, targets.length);
        cache.opponentWeapons = describeWeapons(targets, context.playerFaction, context.aiFaction, own.filter(ship => ship.sunk).length, own.length);
        cache.key = key;
    }
    return encodeUnifiedObservation({ height: BOARD_SIZE, width: BOARD_SIZE, rulesId, viewGrid: context.viewGrid,
        ownViewGrid: context.playerViewGrid ?? Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0)),
        ownShips: own, targetShips: targets, damageGrid: options.damageGrid,
        posterior: approximatePosterior(targets.filter(ship => !ship.sunk), context.viewGrid.flat(), regions), sensorRegions: regions,
        placementPrior: context.placementPrior, ply: context.publicEvents?.length ?? 0,
        ownWeapons: cache.ownWeapons, opponentWeapons: cache.opponentWeapons,
        legalActions: enumerateAllActions(context.viewGrid, abilities, context.sonarEvidence) });
}

export function encodeGameUnifiedEvent(event, observerSeat) {
    const [apDamage, , heCenter, heOuter, radiusRatio, isX, isPlus, , nearest] = event.profile;
    const { r: row, c: col, weapon } = event.action;
    let coverage;
    if (weapon === 'AP') coverage = [{ r: row, c: col, damage: 8 * apDamage }];
    else if (weapon === 'HE') coverage = getHEOffsets(isPlus ? 'plus' : isX ? 'x' : 'single')
        .map(([rowOffset, colOffset]) => ({ r: row + rowOffset, c: col + colOffset,
            damage: 8 * (rowOffset === 0 && colOffset === 0 ? heCenter : heOuter) }));
    else if (weapon === 'SONAR') {
        const radius = Math.round(radiusRatio * BOARD_SIZE);
        coverage = [];
        for (let rowOffset = -radius; rowOffset <= radius; rowOffset++) {
            for (let colOffset = -radius; colOffset <= radius; colOffset++) coverage.push({ r: row + rowOffset, c: col + colOffset });
        }
    } else throw new Error('当前游戏适配器不支持此历史武器');
    return encodeUnifiedEvent({ ...event, coverage, kind: weapon === 'SONAR' ? 'information' : 'damage', reveal: nearest ? 'nearest' : 'center' },
        observerSeat, BOARD_SIZE, BOARD_SIZE);
}
