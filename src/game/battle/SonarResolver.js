// src/game/battle/SonarResolver.js
// 声纳扫描结算器 - 纯数据层

import { createCellUpdateEvent, createLogEvent, isInBounds } from '../weapons/WeaponTypes.js';
import { BOARD_SIZE } from '../../config/constants.js';

/**
 * 声纳扫描结算器
 * 
 * @param {number} centerR - 中心行坐标
 * @param {number} centerC - 中心列坐标
 * @param {Array<Array<Object>>} grid - 网格数据
 * @param {Array<Object>} ships - 舰船数组
 * @param {boolean} isPlayer - 是否为玩家使用
 * @returns {Object} { events: Event[], hasSignal: boolean }
 */
export function resolveSonar(centerR, centerC, grid, ships, isPlayer) {
    const events = [];
    
    // 统计 3x3 区域内未暴露的船只格数
    let shipCount = 0;
    const scanCells = [];
    
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const nr = centerR + i;
            const nc = centerC + j;
            
            if (!isInBounds(nr, nc)) continue;
            
            scanCells.push({ r: nr, c: nc, isCenter: i === 0 && j === 0 });
            
            const cell = grid[nr][nc];
            if (cell.shipId !== -1 && !cell.hit) {
                shipCount++;
            }
        }
    }
    
    const prefix = isPlayer ? '' : '敌方';
    
    if (shipCount === 0) {
        // 无信号：全部标记为 miss
        for (const { r, c } of scanCells) {
            const cell = grid[r][c];
            if (!cell.hit) {
                cell.hit = true;
                events.push(createCellUpdateEvent(r, c, 'MISS'));
            }
        }
        events.push(createLogEvent(
            `${prefix}声纳扫描 (${centerR + 1},${centerC + 1}) 区域：无反应。`,
            'c-sys'
        ));
        return { events, hasSignal: false };
    } else {
        // 有信号：中心点显形，周围标记疑似
        
        // 中心点处理：造成 0 伤害的"命中"判定，揭示真实状态
        const centerCell = grid[centerR][centerC];
        if (!centerCell.hit) {
            centerCell.hit = true;
            if (centerCell.shipId !== -1) {
                events.push(createCellUpdateEvent(centerR, centerC, 'HIT'));
            } else {
                events.push(createCellUpdateEvent(centerR, centerC, 'MISS'));
            }
        }
        
        // 周围 8 格标记疑似
        for (const { r, c, isCenter } of scanCells) {
            if (isCenter) continue;
            
            const cell = grid[r][c];
            // 只标记未暴露的格子
            if (!cell.hit) {
                events.push(createCellUpdateEvent(r, c, 'SUSPECT'));
            }
        }
        
        events.push(createLogEvent(
            `${prefix}声纳扫描 (${centerR + 1},${centerC + 1}) 区域：发现信号！周边标记为疑似。`,
            'c-warn'
        ));
        
        return { events, hasSignal: true };
    }
}
