import { BOARD_SIZE } from '../../config/constants.js';
import { VIEW_STATE } from './ViewState.js';

export function advancePursuit(hunt, ships, view) {
    const alive = ships.filter(ship => !ship.sunk);
    if (alive.length !== 1) {
        hunt.turns = 0;
        hunt.first = true;
        hunt.areaContact = null;
        return null;
    }
    hunt.turns++;
    if (hunt.turns < (hunt.first ? 2 : 3)) return null;
    hunt.turns = 0;
    hunt.first = false;
    const last = alive[0];
    const vertical = last.vertical ?? last.v ?? false;
    for (let segment = 0; segment < last.len; segment++) {
        if (last.hp[segment] <= 0) continue;
        const r = last.r + (vertical ? segment : 0);
        const c = last.c + (vertical ? 0 : segment);
        const known = view[r * BOARD_SIZE + c];
        if (known === VIEW_STATE.MISS || known === VIEW_STATE.HIT || known === VIEW_STATE.DESTROYED) continue;
        const cells = [];
        for (let row = Math.max(0, r - 1); row <= Math.min(BOARD_SIZE - 1, r + 1); row++) {
            for (let col = Math.max(0, c - 1); col <= Math.min(BOARD_SIZE - 1, c + 1); col++) {
                cells.push({ r: row, c: col });
                if (view[row * BOARD_SIZE + col] === VIEW_STATE.UNKNOWN) view[row * BOARD_SIZE + col] = VIEW_STATE.SUSPECT;
            }
        }
        hunt.areaContact = { shipId: last.id, cells };
        return hunt.areaContact;
    }
    return null;
}
