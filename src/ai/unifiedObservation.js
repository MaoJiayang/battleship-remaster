export const UNIFIED_SCHEMA = 'naval-grid-v1';
export const UNIFIED_CHANNELS = 22;
export const UNIFIED_GLOBALS = 8;
export const UNIFIED_SHIP_FEATURES = 6;
export const UNIFIED_WEAPON_FEATURES = 7;
export const UNIFIED_OFFSET_FEATURES = 6;
export const UNIFIED_VARIANT_FEATURES = 16;
export const UNIFIED_EVENT_CHANNELS = 18;

function shipFeatures(ship, side, size) {
    const known = side === 1;
    return [side, ship.len / size, ship.maxHp / 8, Number(!ship.sunk), Number(known),
        known && !ship.sunk ? ship.hp.reduce((sum, hp) => sum + hp, 0) / (ship.len * ship.maxHp) : 0];
}

function weaponFeatures(weapon, side) {
    return [side, Number(weapon.kind === 'damage'), Number(weapon.kind === 'information'), Number(weapon.available),
        (weapon.penetrations ?? 0) / 8, Number(weapon.reveal === 'center'), Number(weapon.reveal === 'nearest')];
}

function offsetFeatures(offset) {
    return [(offset.r ?? 0) / 4, (offset.c ?? 0) / 4, (offset.damage ?? 0) / 8,
        (offset.suspectDamage ?? offset.damage ?? 0) / 8, Number(!!offset.penetrates), Number(!!offset.reveals)];
}

function encodeWeapon(weapon, side, size) {
    const variants = (weapon.variants ?? []).map(variant => ({
        features: Float32Array.from([Number(variant.kind === 'absent'), Number(variant.kind === 'alone'),
            (variant.sunkCount ?? 0) / 16,
            ...(variant.ship ? shipFeatures(variant.ship, 0, size) : [0, 0, 0, 0, 0, 0]),
            ...weaponFeatures(variant.profile, side)]),
        offsets: variant.profile.offsets.map(offset => Float32Array.from(offsetFeatures(offset)))
    }));
    return { id: weapon.id, features: Float32Array.from(weaponFeatures(weapon, side)),
        offsets: weapon.offsets.map(offset => Float32Array.from(offsetFeatures(offset))),
        positions: weapon.offsets.map(offset => [offset.r, offset.c]), variants };
}

function checkGrid(grid, height, width) {
    return Array.isArray(grid) && grid.length === height && grid.every(row => Array.isArray(row)
        && row.length === width && row.every(value => Number.isInteger(value) && value >= 0 && value < 6));
}

export function unifiedAction(index, observation) {
    const cells = observation.height * observation.width;
    if (!Number.isInteger(index) || index < 0 || index >= cells * observation.actionWeapons.length) throw new Error('统一行动编号无效');
    const cell = index % cells;
    return { weapon: observation.actionWeapons[Math.floor(index / cells)], r: Math.floor(cell / observation.width), c: cell % observation.width };
}

export function unifiedActionIndex(action, observation) {
    const weapon = observation.actionWeapons.indexOf(action.weapon);
    if (weapon < 0 || !Number.isInteger(action.r) || !Number.isInteger(action.c)
        || action.r < 0 || action.c < 0 || action.r >= observation.height || action.c >= observation.width) throw new Error('统一行动目标无效');
    return weapon * observation.height * observation.width + action.r * observation.width + action.c;
}

export function encodeUnifiedObservation(input) {
    const { height, width } = input;
    if (!Number.isInteger(height) || !Number.isInteger(width) || height < 1 || width < 1
        || !checkGrid(input.viewGrid, height, width) || !checkGrid(input.ownViewGrid, height, width)) throw new Error('统一棋盘输入无效');
    const cells = height * width;
    const size = Math.max(height, width);
    if (input.posterior.length !== cells || !Array.from(input.posterior).every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('统一概率输入无效');
    const planes = new Float32Array(UNIFIED_CHANNELS * cells);
    const ownShips = input.ownShips;
    const targets = input.targetShips.map(ship => ({ len: ship.len, maxHp: ship.maxHp, sunk: ship.sunk }));
    const ships = [...ownShips.map(ship => Float32Array.from(shipFeatures(ship, 1, size))),
        ...targets.map(ship => Float32Array.from(shipFeatures(ship, -1, size)))];
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const cell = row * width + col;
            planes[input.viewGrid[row][col] * cells + cell] = 1;
            planes[(6 + input.ownViewGrid[row][col]) * cells + cell] = 1;
            planes[15 * cells + cell] = Math.log1p(input.damageGrid?.[row]?.[col] ?? 0) / Math.log(65);
            planes[16 * cells + cell] = input.posterior[cell];
            let logPrior = 0;
            let confidence = 0;
            let count = 0;
            for (const target of targets) {
                if (target.sunk) continue;
                const prior = input.placementPrior?.byLen?.[target.len];
                if (prior) {
                    if (prior.cells.length !== cells || !(prior.cells[cell] > 0) || !Number.isFinite(prior.cells[cell])
                        || !Number.isFinite(prior.strength) || prior.strength < 0 || prior.strength > 1) throw new Error('统一布阵先验无效');
                    logPrior += Math.log(prior.cells[cell]) / Math.log(4);
                    confidence += prior.strength;
                }
                count++;
            }
            planes[18 * cells + cell] = logPrior / Math.max(1, count);
            planes[19 * cells + cell] = confidence / Math.max(1, count);
            planes[20 * cells + cell] = height === 1 ? 0 : 2 * row / (height - 1) - 1;
            planes[21 * cells + cell] = width === 1 ? 0 : 2 * col / (width - 1) - 1;
        }
    }
    for (const ship of ownShips) {
        if (ship.sunk) continue;
        if (!Array.isArray(ship.hp) || ship.hp.length !== ship.len || ship.hp.some(hp => !Number.isFinite(hp) || hp < 0 || hp > ship.maxHp)) throw new Error('统一己方舰船血量无效');
        for (let segment = 0; segment < ship.len; segment++) {
            const row = ship.r + (ship.vertical ? segment : 0);
            const col = ship.c + (ship.vertical ? 0 : segment);
            if (row < 0 || col < 0 || row >= height || col >= width) throw new Error('统一己方舰船越界');
            const cell = row * width + col;
            planes[12 * cells + cell] = ship.hp[segment] / 8;
            planes[13 * cells + cell] = ship.maxHp / 8;
            planes[14 * cells + cell] = 1;
        }
    }
    for (const region of input.sensorRegions ?? []) {
        for (const cell of region) {
            if (!Number.isInteger(cell) || cell < 0 || cell >= cells) throw new Error('统一区域观测越界');
            planes[17 * cells + cell] = 1;
        }
    }
    const ownWeapons = input.ownWeapons;
    const actionWeapons = ownWeapons.map(weapon => weapon.id);
    if (!ownWeapons.length || new Set(actionWeapons).size !== actionWeapons.length) throw new Error('统一武器标识无效');
    const observation = { schema: UNIFIED_SCHEMA, rulesId: input.rulesId, height, width, planes, ships,
        weapons: [...ownWeapons.map(weapon => encodeWeapon(weapon, 1, size)),
            ...input.opponentWeapons.map(weapon => encodeWeapon(weapon, -1, size))], actionWeapons,
        globals: Float32Array.from([height / 32, width / 32, 0, 0, 0, 0, 0,
            Math.log1p(input.ply ?? 0) / Math.log(401)]), mask: new Uint8Array(ownWeapons.length * cells) };
    for (const action of input.legalActions) observation.mask[unifiedActionIndex(action, observation)] = 1;
    if (!observation.mask.some(Boolean)) throw new Error('统一观测没有合法行动');
    return observation;
}

export function encodeUnifiedEvent(event, observerSeat, height, width) {
    const cells = height * width;
    if (event.before.length !== cells || event.after.length !== cells) throw new Error('统一历史棋盘尺寸不符');
    const encoded = new Float32Array(cells * UNIFIED_EVENT_CHANNELS);
    const affected = new Map();
    for (const point of event.coverage) {
        if (point.r >= 0 && point.c >= 0 && point.r < height && point.c < width) affected.set(point.r * width + point.c, point);
    }
    for (let cell = 0; cell < cells; cell++) {
        if (event.before[cell] !== event.after[cell] && !affected.has(cell)) affected.set(cell, {});
    }
    for (const [cell, point] of affected) {
        encoded[cell] = event.seat === observerSeat ? 1 : -1;
        encoded[cells + cell] = Number(cell === event.action.r * width + event.action.c);
        encoded[2 * cells + cell] = 1;
        encoded[3 * cells + cell] = (point.damage ?? 0) / 8;
        encoded[4 * cells + cell] = Number(event.kind === 'information');
        encoded[5 * cells + cell] = Number(event.reveal === 'nearest');
        encoded[(6 + event.before[cell]) * cells + cell] = 1;
        encoded[(12 + event.after[cell]) * cells + cell] = 1;
    }
    return encoded;
}
