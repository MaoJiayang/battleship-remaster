// src/game/weapons/APWeapon.js
// 主炮武器实现

import { WeaponBase } from './WeaponBase.js';
import { resolveHit } from '../battle/HitResolver.js';
import { createLogEvent } from './WeaponTypes.js';

/**
 * 主炮武器
 * - 单点攻击
 * - 伤害根据攻击方存活船只决定：BB/SS=3, CL=2, 其他=1
 */
export class APWeapon extends WeaponBase {
    constructor() {
        super({ id: 'AP', label: '主炮', icon: '💥' });
    }
    
    /**
     * 主炮始终可用
     */
    canUse(context) {
        return true;
    }
    
    /**
     * 判断目标是否有效
     */
    isValidTarget(target, context) {
        if (!super.isValidTarget(target, context)) return false;
        
        const { r, c } = target;
        const cell = context.defenderGrid[r][c];
        
        // 已摧毁的格子不能再打
        if (cell.hit && cell.shipId !== -1) {
            const ship = context.defenderShips[cell.shipId];
            if (ship.hp[cell.segmentIndex] <= 0) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * 预览范围：单点
     */
    previewArea(target) {
        return { cells: [{ r: target.r, c: target.c }] };
    }
    
    /**
     * 执行主炮攻击
     */
    resolve(target, context) {
        const { r, c } = target;
        const damage = this._calculateDamage(context.attackerShips);
        
        // 调用结算器
        const result = resolveHit(
            r, c, damage,
            context.defenderGrid,
            context.defenderShips,
            context.isPlayer
        );
        
        // 添加攻击日志
        const logClass = context.isPlayer ? 'c-p' : 'c-e';
        const prefix = context.isPlayer ? '使用' : '敌方使用';
        result.events.unshift(createLogEvent(
            `${prefix}主炮攻击 (${r + 1},${c + 1})，伤害: ${damage}`,
            logClass
        ));
        
        // 收集沉没的船只ID
        const shipsSunk = result.sunk ? [result.hitShip.id] : [];
        
        return { events: result.events, shipsSunk };
    }
    
    /**
     * 计算主炮伤害
     * BB 存活: 3 伤害
     * SS/CL 存活: 2 伤害
     * 否则: 1 伤害
     */
    _calculateDamage(attackerShips) {
        const bbAlive = attackerShips.some(s => s.code === 'BB' && !s.sunk);
        const ssAlive = attackerShips.some(s => s.code === 'SS' && !s.sunk);
        const clAlive = attackerShips.some(s => s.code === 'CL' && !s.sunk);
        
        if (bbAlive) return 3;
        if (ssAlive || clAlive) return 2;
        return 1;
    }
}
