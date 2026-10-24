import { BOARD_SIZE } from '../../src/config/constants.js';
import { SHIP_TYPES } from '../../src/data/ships.js';
import { deployShips } from '../../src/ai/aiDeployment.js';

export function deployFleet(mode = 'spread') {
    if (mode === 'spread') return deployShips(SHIP_TYPES);
    if (mode !== 'uniform') throw new Error('布阵分布必须为 spread 或 uniform');
    for (let attempt = 0; attempt < 10000; attempt++) {
        const occupied = new Set();
        const fleet = [];
        let valid = true;
        for (const type of SHIP_TYPES) {
            const vertical = Math.random() < 0.5;
            const r = Math.floor(Math.random() * (BOARD_SIZE - (vertical ? type.len : 1) + 1));
            const c = Math.floor(Math.random() * (BOARD_SIZE - (vertical ? 1 : type.len) + 1));
            const cells = Array.from({ length: type.len }, (_, index) => (r + (vertical ? index : 0)) * BOARD_SIZE + c + (vertical ? 0 : index));
            if (cells.some(cell => occupied.has(cell))) { valid = false; break; }
            cells.forEach(cell => occupied.add(cell));
            fleet.push({ ...type, r, c, v: vertical });
        }
        if (valid) return fleet;
    }
    throw new Error('联合均匀布阵未能生成合法舰队');
}
