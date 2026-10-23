import { BOARD_SIZE } from '../config/constants.js';
import { CellState, getStaticPlacements } from './aiCore.js';

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

export function activeSensorRegions(regions, view) {
    const unique = new Map();
    for (const region of regions) {
        if (region.some(cell => view[cell] === CellState.HIT || view[cell] === CellState.DESTROYED || view[cell] === CellState.SUNK)) continue;
        const possible = region.filter(cell => view[cell] === CellState.UNKNOWN || view[cell] === CellState.SUSPECT).sort((left, right) => left - right);
        if (possible.length) unique.set(possible.join(','), possible);
    }
    const candidates = [...unique.values()];
    return candidates.filter(region => !candidates.some(other => other !== region && other.length < region.length && other.every(cell => region.includes(cell))));
}

export function approximatePosterior(ships, view, sensorRegions = []) {
    const regions = activeSensorRegions(sensorRegions, view).map(cells => {
        const mask = new Uint32Array(Math.ceil(CELL_COUNT / 32));
        for (const cell of cells) mask[cell >>> 5] |= 1 << (cell & 31);
        return mask;
    });
    const hits = [];
    const blocked = new Uint32Array(Math.ceil(CELL_COUNT / 32));
    for (let cell = 0; cell < CELL_COUNT; cell++) {
        if (view[cell] === CellState.MISS || view[cell] === CellState.SUNK) blocked[cell >>> 5] |= 1 << (cell & 31);
        if (view[cell] === CellState.HIT || view[cell] === CellState.DESTROYED) hits.push(cell);
    }
    const entries = ships.map(ship => {
        const placements = getStaticPlacements(ship.len);
        const viable = [];
        const prior = new Float64Array(CELL_COUNT);
        const regionPrior = new Float64Array(regions.length);
        for (let placement = 0; placement < placements.count; placement++) {
            let valid = true;
            for (let word = 0; word < blocked.length; word++) {
                if (placements.masks[placement * blocked.length + word] & blocked[word]) { valid = false; break; }
            }
            if (!valid) continue;
            viable.push(placement);
            for (let segment = 0; segment < ship.len; segment++) prior[placements.cells[placement * ship.len + segment]]++;
            for (let region = 0; region < regions.length; region++) {
                if (regions[region].some((word, index) => word & placements.masks[placement * blocked.length + index])) regionPrior[region]++;
            }
        }
        if (viable.length) for (let cell = 0; cell < CELL_COUNT; cell++) prior[cell] /= viable.length;
        if (viable.length) for (let region = 0; region < regions.length; region++) regionPrior[region] /= viable.length;
        return { ship, placements, viable, prior, regionPrior };
    });
    const probabilities = new Float64Array(CELL_COUNT);
    for (let shipIndex = 0; shipIndex < entries.length; shipIndex++) {
        const { ship, placements, viable, prior } = entries[shipIndex];
        const otherHitProbability = hits.map(cell => {
            let empty = 1;
            for (let other = 0; other < entries.length; other++) if (other !== shipIndex) empty *= 1 - entries[other].prior[cell];
            return 1 - empty;
        });
        const otherRegionProbability = regions.map((_, region) => {
            let empty = 1;
            for (let other = 0; other < entries.length; other++) if (other !== shipIndex) empty *= 1 - entries[other].regionPrior[region];
            return 1 - empty;
        });
        const marginal = new Float64Array(CELL_COUNT);
        let total = 0;
        for (const placement of viable) {
            let likelihood = 1;
            for (let hit = 0; hit < hits.length; hit++) {
                const cell = hits[hit];
                if (!(placements.masks[placement * blocked.length + (cell >>> 5)] & (1 << (cell & 31)))) likelihood *= otherHitProbability[hit];
            }
            for (let region = 0; region < regions.length; region++) {
                if (!regions[region].some((word, index) => word & placements.masks[placement * blocked.length + index])) likelihood *= otherRegionProbability[region];
            }
            total += likelihood;
            for (let segment = 0; segment < ship.len; segment++) marginal[placements.cells[placement * ship.len + segment]] += likelihood;
        }
        for (let cell = 0; cell < CELL_COUNT; cell++) probabilities[cell] += total ? marginal[cell] / total : prior[cell];
    }
    for (let cell = 0; cell < CELL_COUNT; cell++) probabilities[cell] = view[cell] === CellState.HIT ? 1
        : view[cell] === CellState.MISS || view[cell] === CellState.DESTROYED || view[cell] === CellState.SUNK ? 0 : Math.min(1, probabilities[cell]);
    return probabilities;
}
