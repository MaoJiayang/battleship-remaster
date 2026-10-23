// src/game/battle/SonarResolver.js
// 声纳扫描结算器 - 纯数据层

import { createCellUpdateEvent, createLogEvent, isInBounds } from '../weapons/WeaponTypes.js';

/**
 * 声纳扫描结算器
 * 
 * @param {number} centerR - 中心行坐标
 * @param {number} centerC - 中心列坐标
 * @param {Array<Array<Object>>} grid - 网格数据
 * @param {Array<Object>} ships - 舰船数组
 * @param {boolean} isPlayer - 是否为玩家使用
 * @param {number} radius - 扫描半径（1=3×3，2=5×5）
 * @param {string} reveal - 信号显形方式：'center' 中心格 / 'nearest' 最近接触
 * @returns {Object} { events: Event[], hasSignal: boolean, radius: number }
 */
export function resolveSonar(centerR, centerC, grid, ships, isPlayer, radius = 1, reveal = 'center') {
    const events = [];
    
    // 统计扫描区内未暴露的船只格数
    let shipCount = 0;
    const scanCells = [];
    let nearest = null;
    
    for (let i = -radius; i <= radius; i++) {
        for (let j = -radius; j <= radius; j++) {
            const nr = centerR + i;
            const nc = centerC + j;
            
            if (!isInBounds(nr, nc)) continue;
            
            scanCells.push({ r: nr, c: nc, isCenter: i === 0 && j === 0 });
            
            const cell = grid[nr][nc];
            if (cell.shipId !== -1 && !cell.hit) {
                shipCount++;
                const dist2 = i * i + j * j;
                if (!nearest || dist2 < nearest.dist2) {
                    nearest = { r: nr, c: nc, dist2 };
                }
            }
        }
    }
    
    const prefix = isPlayer ? '' : '敌方';
    const size = radius * 2 + 1;
    
    if (shipCount === 0) {
        // 无信号：整片区域标记为 miss
        for (const { r, c } of scanCells) {
            const cell = grid[r][c];
            if (!cell.hit) {
                cell.hit = true;
                events.push(createCellUpdateEvent(r, c, 'MISS'));
            }
        }
        events.push(createLogEvent(
            `${prefix}声纳扫描 (${centerR + 1},${centerC + 1}) ${size}×${size} 区域：无反应。`,
            'c-sys'
        ));
        return { events, hasSignal: false, radius };
    } else {
        // 有信号：标定点显形，区域内其余格标记疑似
        const revealCell = reveal === 'nearest' && nearest
            ? nearest
            : { r: centerR, c: centerC };
        
        // 标定点处理：只确认接触位置，不造成伤害（0 伤，独立 CONTACT 状态）
        const targetCell = grid[revealCell.r][revealCell.c];
        if (!targetCell.hit) {
            targetCell.hit = true;
            if (targetCell.shipId !== -1) {
                events.push(createCellUpdateEvent(revealCell.r, revealCell.c, 'CONTACT'));
            } else {
                events.push(createCellUpdateEvent(revealCell.r, revealCell.c, 'MISS'));
            }
        }
        
        // 区域内其余未暴露格标记疑似
        for (const { r, c } of scanCells) {
            if (r === revealCell.r && c === revealCell.c) continue;
            
            const cell = grid[r][c];
            if (!cell.hit) {
                events.push(createCellUpdateEvent(r, c, 'SUSPECT'));
            }
        }
        
        const contact = reveal === 'nearest' && nearest
            ? `标定最近接触 (${nearest.r + 1},${nearest.c + 1})`
            : '中心格已显形';
        events.push(createLogEvent(
            `${prefix}声纳扫描 (${centerR + 1},${centerC + 1}) ${size}×${size} 区域：发现信号！${contact}，周边标记为疑似。`,
            'c-warn'
        ));
        
        return { events, hasSignal: true, radius, contact: nearest };
    }
}
