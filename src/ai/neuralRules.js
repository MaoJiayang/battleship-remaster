import { BOARD_SIZE } from '../config/constants.js';
import { SHIP_TYPES } from '../data/ships.js';
import { DOCTRINES, DOCTRINE_VARIANT_FORMAT, DOCTRINE_PARAMETER_RANGES } from '../data/doctrines.js';
import { BATTLE_RULES_VERSION } from '../game/battle/ActionRules.js';

export const NEURAL_SCHEMA = 'naval-belief-v1';

export function neuralRulesId({ doctrineVariants = false } = {}) {
    const mechanics = Object.fromEntries(Object.entries(DOCTRINES).map(([faction, doctrine]) => [faction,
        Object.fromEntries(Object.entries(doctrine).filter(([key]) => ['ap', 'he', 'sonar', 'defense'].includes(key)))]));
    const scope = [NEURAL_SCHEMA, BATTLE_RULES_VERSION, BOARD_SIZE, SHIP_TYPES, mechanics];
    if (doctrineVariants) scope.push(DOCTRINE_VARIANT_FORMAT, DOCTRINE_PARAMETER_RANGES);
    const source = JSON.stringify(scope);
    let hash = 2166136261;
    for (const character of source) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    return hash.toString(16).padStart(8, '0');
}
