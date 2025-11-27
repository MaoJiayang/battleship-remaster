// src/game/weapons/HEWeapon.js
// 空袭武器实现

import { WeaponBase } from './WeaponBase.js';
import { resolveMultiHit } from '../battle/HitResolver.js';
import { createLogEvent, isInBounds } from './WeaponTypes.js';

/**
 * 空袭武器
 * - X 型 5 格攻击（中心 + 四角）
 * - 每格伤害 1
 * - 需要 CV（航空母舰）存活
 */
export class HEWeapon extends WeaponBase {
    constructor() {
        super({ id: 'HE', label: '空袭', icon: '✈️' });
    }
    
    /**
     * 需要 CV 存活才能使用
     */
    canUse(context) {
        return context.attackerShips.some(s => s.code === 'CV' && !s.sunk);
    }
    
    /**
     * 预览范围：X 型 5 格
     */
    previewArea(target) {
        const { r, c } = target;
        const offsets = [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
        const cells = offsets
            .map(([dr, dc]) => ({ r: r + dr, c: c + dc }))
            .filter(cell => isInBounds(cell.r, cell.c));
        return { cells };
    }
    
    /**
     * 空袭允许中心点是已摧毁的（用于打击周围）
     */
    isValidTarget(target, context) {
        return isInBounds(target.r, target.c);
    }
    
    /**
     * 执行空袭攻击
     */
    resolve(target, context) {
        const { r, c } = target;
        const cells = this.previewArea(target).cells;
        
        // 过滤掉已确认 miss 和已摧毁的格子
        const validCells = cells.filter(cell => {
            const gridCell = context.defenderGrid[cell.r][cell.c];
            // 已 miss 跳过
            if (gridCell.hit && gridCell.shipId === -1) return false;
            // 已摧毁跳过
            if (gridCell.hit && gridCell.shipId !== -1) {
                const ship = context.defenderShips[gridCell.shipId];
                if (ship.hp[gridCell.segmentIndex] <= 0) return false;
            }
            return true;
        });
        
        // 批量结算
        const result = resolveMultiHit(
            validCells,
            1,  // 空袭每格伤害 1
            context.defenderGrid,
            context.defenderShips,
            context.isPlayer
        );
        
        // 添加攻击日志
        const logClass = context.isPlayer ? 'c-p' : 'c-e';
        const prefix = context.isPlayer ? '呼叫' : '敌方发动';
        result.events.unshift(createLogEvent(
            `${prefix}空袭覆盖 (${r + 1},${c + 1}) 周边，打击点数: ${validCells.length}`,
            logClass
        ));
        
        return { events: result.events, shipsSunk: result.shipsSunk };
    }
}
