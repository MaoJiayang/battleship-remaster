// src/game/weapons/SonarWeapon.js
// 水听武器实现

import { WeaponBase } from './WeaponBase.js';
import { resolveSonar } from '../battle/SonarResolver.js';
import { isInBounds } from './WeaponTypes.js';

/**
 * 水听武器
 * - 3x3 扫描区域
 * - 不造成伤害
 * - 需要 DD（驱逐舰）存活
 */
export class SonarWeapon extends WeaponBase {
    constructor() {
        super({ id: 'SONAR', label: '水听', icon: '📡' });
    }
    
    /**
     * 需要 DD 或 SS 存活才能使用
     */
    canUse(context) {
        return context.attackerShips.some(s => (s.code === 'DD' || s.code === 'SS') && !s.sunk);
    }
    
    /**
     * 预览范围：3x3 区域
     */
    previewArea(target) {
        const { r, c } = target;
        const cells = [];
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                const nr = r + i;
                const nc = c + j;
                if (isInBounds(nr, nc)) {
                    cells.push({ r: nr, c: nc });
                }
            }
        }
        return { cells };
    }
    
    /**
     * 声纳目标只需要在边界内即可
     */
    isValidTarget(target, context) {
        return isInBounds(target.r, target.c);
    }
    
    /**
     * 执行声纳扫描
     */
    resolve(target, context) {
        const { r, c } = target;
        
        // 调用声纳结算器
        const result = resolveSonar(
            r, c,
            context.defenderGrid,
            context.defenderShips,
            context.isPlayer
        );
        
        // 声纳不造成伤害，不会击沉船只
        return { events: result.events, shipsSunk: [] };
    }
}
