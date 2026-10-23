// src/game/weapons/SonarWeapon.js
// 水听武器实现

import { WeaponBase } from './WeaponBase.js';
import { resolveSonar } from '../battle/SonarResolver.js';
import { createEffectEvent, isInBounds } from './WeaponTypes.js';
import { getSonarProfile } from '../../data/doctrines.js';

/**
 * 水听武器
 * - 默认 3x3 扫描区域；ASDIC 学说扩大为 5x5
 * - 不造成伤害
 * - 需要 DD（驱逐舰）或 SS（潜艇）存活
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
    
    _profile(context) {
        return getSonarProfile(context?.attackerFaction || 'us');
    }
    
    /**
     * 预览范围：按学说取 (2r+1)²
     */
    previewArea(target, context = null) {
        const { r, c } = target;
        const radius = this._profile(context).radius;
        const cells = [];
        for (let i = -radius; i <= radius; i++) {
            for (let j = -radius; j <= radius; j++) {
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
    isValidTarget(target) {
        return isInBounds(target.r, target.c);
    }
    
    /**
     * 执行声纳扫描
     */
    resolve(target, context) {
        const { r, c } = target;
        const profile = this._profile(context);
        const radius = profile.radius;
        
        // 声纳结算器
        const result = resolveSonar(
            r, c,
            context.defenderGrid,
            context.defenderShips,
            context.isPlayer,
            radius,
            profile.reveal
        );
        
        // 特效：扫描圈扩散
        result.events.push(createEffectEvent('SONAR', {
            r, c,
            hasSignal: result.hasSignal,
            radius
        }));
        
        // 声纳不造成伤害，不会击沉船只
        return { events: result.events, shipsSunk: [] };
    }
}
