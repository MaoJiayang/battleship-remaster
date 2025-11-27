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
 * @returns {Object} { events: Event[], hitShip: Ship|null, sunk: boolean }
 */
export function resolveHit(r, c, damage, grid, ships, isPlayer) {
    const events = [];
    
    // 边界检查
    if (!isInBounds(r, c)) {
        return { events: [], hitShip: null, sunk: false };
    }
    
    const cell = grid[r][c];
    
    // 已确认 miss 的格子不再处理
    if (cell.hit && cell.shipId === -1) {
        return { events: [], hitShip: null, sunk: false };
    }
    
    // 标记格子为已攻击
    cell.hit = true;
    
    if (cell.shipId !== -1) {
        // 命中船只
        const ship = ships[cell.shipId];
        const segIdx = cell.segmentIndex;
        
        // 已摧毁的格子不再扣血
        if (ship.hp[segIdx] <= 0) {
            return { events: [], hitShip: ship, sunk: false };
        }
        
        // 扣血
        if (damage > 0) {
            ship.hp[segIdx] -= damage;
        }
        
        // 判断格子状态
        const cellState = ship.hp[segIdx] <= 0 ? 'DESTROYED' : 'HIT';
        events.push(createCellUpdateEvent(r, c, cellState));
        events.push(createShipUpdateEvent(ship.id, segIdx, ship.hp[segIdx], false));
        
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
        
        return { events, hitShip: ship, sunk: isSunk };
    } else {
        // 未命中
        events.push(createCellUpdateEvent(r, c, 'MISS'));
        return { events, hitShip: null, sunk: false };
    }
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
