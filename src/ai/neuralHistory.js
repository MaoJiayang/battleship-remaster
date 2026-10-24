import { BOARD_SIZE } from '../config/constants.js';

export const HISTORY_SCHEMA = 'naval-public-events-v1';
export const HISTORY_FEATURES = 16 + 2 * BOARD_SIZE * BOARD_SIZE;

export function publicDecisionEvent(seat, ply, action, abilities, before, after) {
    return { seat, ply, action: { weapon: action.weapon, r: action.r, c: action.c },
        profile: [abilities.apDamage / 8, abilities.apMaxPenetrations / 4,
            abilities.heCenterDamage / 8, abilities.heOuterDamage / 8, abilities.sonarRadius / BOARD_SIZE,
            ...['x', 'plus', 'single'].map(shape => Number(abilities.heShape === shape)), Number(abilities.sonarReveal === 'nearest')],
        before: before.flat(), after: after.flat() };
}

export function encodePublicEvent(event, observerSeat) {
    return Float32Array.from([event.seat === observerSeat ? 1 : -1, Math.log1p(event.ply) / Math.log(401),
        ...['AP', 'HE', 'SONAR'].map(weapon => Number(event.action.weapon === weapon)),
        event.action.r / (BOARD_SIZE - 1), event.action.c / (BOARD_SIZE - 1), ...event.profile,
        ...event.before.map(value => value / 5), ...event.after.map(value => value / 5)]);
}
