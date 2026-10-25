import { BOARD_SIZE } from '../../config/constants.js';
import { getHEOffsets } from '../../data/doctrines.js';
import { VIEW_STATE } from './ViewState.js';

export const BATTLE_RULES_VERSION = 3;

const coverageOffsets = new Map();

function isOpen(state) {
    return state === VIEW_STATE.UNKNOWN || state === VIEW_STATE.HIT || state === VIEW_STATE.SUSPECT;
}

/**
 * 范围内是否还有未知海域（用于判断水听是否值得再扫）
 */
export function hasUnknownInArea(viewGrid, row, col, radius) {
    for (let targetRow = Math.max(0, row - radius); targetRow <= Math.min(BOARD_SIZE - 1, row + radius); targetRow++) {
        for (let targetCol = Math.max(0, col - radius); targetCol <= Math.min(BOARD_SIZE - 1, col + radius); targetCol++) {
            if (viewGrid[targetRow][targetCol] === VIEW_STATE.UNKNOWN) return true;
        }
    }
    return false;
}

/**
 * 攻击覆盖中是否还有可打击/可侦察的格子
 */
export function coverageHasPotential(viewGrid, weapon, row, col, abilities) {
    if (weapon !== 'HE') return isOpen(viewGrid[row]?.[col]);
    const shape = abilities?.heShape || 'x';
    if (!coverageOffsets.has(shape)) coverageOffsets.set(shape, getHEOffsets(shape));
    for (const [rowOffset, colOffset] of coverageOffsets.get(shape)) {
        if (isOpen(viewGrid[row + rowOffset]?.[col + colOffset])) return true;
    }
    return false;
}

export function recordSonarEvidence(evidence, events) {
    if (!evidence || events.some(event => event.type === 'CELL_UPDATE' && event.payload.state === 'CONTACT')) return;
    const cells = events.filter(event => event.type === 'CELL_UPDATE' && event.payload.state === 'SUSPECT')
        .map(event => event.payload.r * BOARD_SIZE + event.payload.c).sort((left, right) => left - right);
    recordContactEvidence(evidence, cells);
}

export function recordContactEvidence(evidence, cells) {
    if (!evidence || !cells.length || evidence.some(region => region.length === cells.length && region.every((cell, index) => cell === cells[index]))) return;
    evidence.push(cells);
}

export function isValidActionTarget(action, viewGrid, abilities = {}, evidence = []) {
    if (!action || !Number.isInteger(action.r) || !Number.isInteger(action.c)
        || action.r < 0 || action.c < 0 || action.r >= BOARD_SIZE || action.c >= BOARD_SIZE
        || !viewGrid?.[action.r] || viewGrid[action.r][action.c] == null) return false;
    if (action.weapon === 'AP') return isOpen(viewGrid[action.r][action.c]);
    if (action.weapon === 'HE') return !!abilities.canUseAir && coverageHasPotential(viewGrid, 'HE', action.r, action.c, abilities);
    if (action.weapon === 'SONAR') {
        if (!abilities.canUseSonar) return false;
        const radius = abilities.sonarRadius ?? 1;
        if (hasUnknownInArea(viewGrid, action.r, action.c, radius)) return true;
        const suspects = new Set();
        for (let row = Math.max(0, action.r - radius); row <= Math.min(BOARD_SIZE - 1, action.r + radius); row++) {
            for (let col = Math.max(0, action.c - radius); col <= Math.min(BOARD_SIZE - 1, action.c + radius); col++) {
                if (viewGrid[row][col] === VIEW_STATE.SUSPECT) suspects.add(row * BOARD_SIZE + col);
            }
        }
        if (!suspects.size) return false;
        if (viewGrid[action.r][action.c] === VIEW_STATE.SUSPECT || abilities.sonarReveal === 'nearest') return true;
        return !evidence.some(region => region.length && region.every(cell => suspects.has(cell)));
    }
    return false;
}
