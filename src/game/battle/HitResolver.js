// src/game/battle/HitResolver.js
// 命中结算器 - 纯数据层，不操作 DOM

import { createCellUpdateEvent, createShipUpdateEvent, createLogEvent, isInBounds } from '../weapons/WeaponTypes.js';

/**
 * 命中结算器 - 纯数据层
 * 
 * @param {number} r - 行坐标
 * @param {number} c - 列坐标
 * @param {number} damage - 伤害值
 * @param {Array<Array<Object>>} grid - 网格数据 (enemyGridMap 格式)
 * @param {Array<Object>} ships - 舰船数组
 * @param {boolean} isPlayer - 是否为玩家攻击
 * @param {Object} [options]
 * @param {boolean} [options.penetrate] - 穿甲：溢出伤害沿同一舰体的相邻舱室传导
 * @param {number} [options.maxPenetrations=1] - 最多额外传导的舱室数；大于 1 时沿舰体连续传导
 * @returns {Object} { events: Event[], hitShip: Ship|null, sunk: boolean, dealt: number, penetrated: number }
 */
export function resolveHit(r, c, damage, grid, ships, isPlayer, options = {}) {
    const events = [];
    
    // 边界检查
    if (!isInBounds(r, c)) {
        return { events: [], hitShip: null, sunk: false, dealt: 0, penetrated: 0 };
    }
    
    const cell = grid[r][c];
    
    // 已确认 miss 的格子不再处理
    if (cell.hit && cell.shipId === -1) {
        return { events: [], hitShip: null, sunk: false, dealt: 0, penetrated: 0 };
    }
    
    // 标记格子为已攻击
    cell.hit = true;
    
    if (cell.shipId !== -1) {
        // 命中船只
        const ship = ships[cell.shipId];
        const segIdx = cell.segmentIndex;
        
        // 已摧毁的格子不再扣血
        if (ship.hp[segIdx] <= 0) {
            return { events: [], hitShip: ship, sunk: false, dealt: 0, penetrated: 0 };
        }
        
        let remaining = Math.max(0, damage);
        let dealt = 0;
        let penetrated = 0;
        const maxPenetrations = Math.max(1, options.maxPenetrations ?? 1);
        
        // 默认只向两侧相邻舱室各传 1 舱；连续穿甲沿同一舰体向两端依次延伸
        const order = [segIdx];
        if (options.penetrate) {
            if (maxPenetrations > 1) {
                for (let d = 1; d < ship.len; d++) {
                    if (segIdx + d < ship.len) order.push(segIdx + d);
                    if (segIdx - d >= 0) order.push(segIdx - d);
                }
            } else {
                if (segIdx + 1 < ship.len) order.push(segIdx + 1);
                if (segIdx - 1 >= 0) order.push(segIdx - 1);
            }
        }
        
        for (let k = 0; k < order.length && remaining > 0; k++) {
            if (k > 0 && penetrated >= maxPenetrations) break;
            const idx = order[k];
            const hpBefore = ship.hp[idx];
            if (hpBefore <= 0) continue;
            
            const applied = Math.min(hpBefore, remaining);
            ship.hp[idx] -= applied;
            remaining -= applied;
            dealt += applied;
            
            const target = k === 0 ? { r, c } : _segmentCell(ship, idx);
            if (k > 0) {
                penetrated++;
                grid[target.r][target.c].hit = true;
            }
            
            const cellState = ship.hp[idx] <= 0 ? 'DESTROYED' : 'HIT';
            const evt = createCellUpdateEvent(target.r, target.c, cellState);
            if (k > 0) evt.payload.secondary = true;
            events.push(evt);
            events.push(createShipUpdateEvent(ship.id, idx, ship.hp[idx], false));
        }
        
        // 判断沉船
        const isSunk = ship.hp.every(h => h <= 0) && !ship.sunk;
        if (isSunk) {
            ship.sunk = true;
            events.push(createShipUpdateEvent(ship.id, -1, 0, true));
            
            const logClass = isPlayer ? 'c-warn' : 'c-e';
            const logMsg = isPlayer 
                ? `战报：敌方【${ship.name}】确认沉没！`
                : `严重警报：我方【${ship.name}】沉没！`;
            events.push(createLogEvent(logMsg, logClass));
        }
        
        return { events, hitShip: ship, sunk: isSunk, dealt, penetrated };
    } else {
        // 未命中
        events.push(createCellUpdateEvent(r, c, 'MISS'));
        return { events, hitShip: null, sunk: false, dealt: 0, penetrated: 0 };
    }
}

/** 舰体段索引 → 网格坐标 */
function _segmentCell(ship, idx) {
    const isVertical = ship.vertical ?? ship.v ?? false;
    return {
        r: isVertical ? ship.r + idx : ship.r,
        c: isVertical ? ship.c : ship.c + idx
    };
}

/**
 * 批量命中结算（用于空袭等多点攻击）
 * 
 * @param {Array<{r: number, c: number}>} cells - 目标格子数组
 * @param {number} damage - 每格伤害值
 * @param {Array<Array<Object>>} grid - 网格数据
 * @param {Array<Object>} ships - 舰船数组
 * @param {boolean} isPlayer - 是否为玩家攻击
 * @returns {Object} { events: Event[], shipsSunk: number[] }
 */
export function resolveMultiHit(cells, damage, grid, ships, isPlayer) {
    const allEvents = [];
    const totalSunk = [];
    
    for (const { r, c } of cells) {
        const result = resolveHit(r, c, damage, grid, ships, isPlayer);
        allEvents.push(...result.events);
        if (result.sunk) {
            totalSunk.push(result.hitShip.id);
        }
    }
    
    return { events: allEvents, shipsSunk: totalSunk };
}
