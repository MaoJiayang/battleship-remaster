// src/game/weapons/APWeapon.js
// 主炮武器实现

import { WeaponBase } from './WeaponBase.js';
import { resolveHit } from '../battle/HitResolver.js';
import { createLogEvent, createEffectEvent } from './WeaponTypes.js';
import { VIEW_STATE } from '../battle/ViewState.js';
import { sfx } from '../../audio/sfx.js';
import { getAPDamage, getAPMaxPenetrations, applyAPDefense, getDoctrine } from '../../data/doctrines.js';

/**
 * 主炮武器
 * - 单点攻击，穿甲：溢出伤害沿同一舰体的相邻舱室传导，默认最多再穿 1 舱
 * - 法国四联装：战列舰存活时可连续穿甲至多 2 舱
 * - 基础伤害由攻击方存活舰船决定（BB=3，SS/CL=2，其他=1）
 * - 阵营学说可修正伤害（雷达锁定 / 狼群战果 / 四联装 / 高速规避）
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
        const faction = context.attackerFaction || 'us';
        const doctrine = getDoctrine(faction);
        const sunkEnemyShips = (context.defenderShips || []).filter(s => s.sunk).length;
        const targetSuspect = context.attackerViewGrid?.[r]?.[c] === VIEW_STATE.SUSPECT;
        const maxPenetrations = getAPMaxPenetrations(faction, context.attackerShips);
        
        let damage = getAPDamage(faction, context.attackerShips, {
            targetSuspect,
            sunkEnemyShips
        });
        const rawDamage = damage;
        damage = applyAPDefense(context.defenderFaction, damage);
        
        const notes = [];
        const apDoctrine = doctrine.ap || {};
        const bbAlive = (context.attackerShips || []).some(s => s.code === 'BB' && !s.sunk);
        const cvAlive = (context.attackerShips || []).some(s => s.code === 'CV' && !s.sunk);
        if (apDoctrine.cvBonus) {
            notes.push(cvAlive ? `航空校射 +${apDoctrine.cvBonus}` : '无航空校射');
        }
        if (apDoctrine.suspectBonus && targetSuspect) notes.push('雷达锁定');
        if (apDoctrine.sunkBonus && sunkEnemyShips > 0) {
            const bonus = Math.min(
                apDoctrine.sunkBonusCap ?? Infinity,
                sunkEnemyShips * apDoctrine.sunkBonus
            );
            if (bonus > 0) notes.push(`狼群 +${bonus}`);
        }
        if (apDoctrine.quadTurrets && !bbAlive) notes.push('火力核心损失');
        if (apDoctrine.damagePenalty) notes.push('火箭舰炮');
        if (damage < rawDamage) notes.push('敌舰规避');
        
        sfx.play('fire');
        
        // 调用结算器
        const result = resolveHit(
            r, c, damage,
            context.defenderGrid,
            context.defenderShips,
            context.isPlayer,
            { penetrate: true, maxPenetrations }
        );
        
        // 添加攻击日志（未命中时不再展示理论伤害）
        const logClass = context.isPlayer ? 'c-p' : 'c-e';
        const prefix = context.isPlayer ? '使用' : '敌方使用';
        const resultText = result.hitShip ? `命中 ${result.dealt} 伤` : '未命中';
        const noteText = result.hitShip && notes.length ? `（${notes.join(' / ')}）` : '';
        const penetrationText = result.penetrated > 0
            ? `，穿甲 ${result.penetrated} 舱`
            : '';
        result.events.unshift(createLogEvent(
            `${prefix}主炮攻击 (${r + 1},${c + 1})，${resultText}${noteText}${penetrationText}`,
            logClass
        ));
        
        // 命中时显示浮动伤害数字
        if (result.hitShip && result.dealt > 0) {
            result.events.push(createEffectEvent('DAMAGE', { r, c, amount: result.dealt }));
        }
        
        // 收集沉没的船只ID
        const shipsSunk = result.sunk ? [result.hitShip.id] : [];
        
        return { events: result.events, shipsSunk };
    }
}
