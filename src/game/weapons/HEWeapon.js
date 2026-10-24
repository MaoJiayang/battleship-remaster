// src/game/weapons/HEWeapon.js
// 空袭/火箭武器实现

import { WeaponBase } from './WeaponBase.js';
import { resolveHit } from '../battle/HitResolver.js';
import { isValidActionTarget } from '../battle/ActionRules.js';
import { createLogEvent, createEffectEvent, isInBounds } from './WeaponTypes.js';
import { getHEProfile, getHEOffsets, applyHEDefense, getHEVulnerability } from '../../data/doctrines.js';

/**
 * 空袭武器
 * - 默认 X 型 5 格攻击（中心 + 四角）
 * - 默认每格伤害 1，需要 CV（航空母舰）存活
 * - 阵营学说可改变形状、中心伤害与航母依赖
 */
export class HEWeapon extends WeaponBase {
    constructor() {
        super({ id: 'HE', label: '空袭', icon: '✈️' });
    }
    
    _profile(context) {
        return getHEProfile(
            context?.attackerFaction || 'us',
            context?.attackerShips || []
        );
    }
    
    /**
     * 默认需要 CV 存活；喀秋莎齐射不依赖航母
     */
    canUse(context) {
        return this._profile(context).available;
    }
    
    /**
     * 预览范围：按学说形状取 5 格
     */
    previewArea(target, context = null) {
        const { r, c } = target;
        const profile = this._profile(context);
        const offsets = getHEOffsets(profile.shape);
        const cells = offsets
            .map(([dr, dc]) => ({ r: r + dr, c: c + dc }))
            .filter(cell => isInBounds(cell.r, cell.c));
        return { cells };
    }
    
    /**
     * 中心点可以在任意位置（包括已摧毁格，用于打击周围）
     */
    isValidTarget(target, context) {
        const profile = this._profile(context);
        return isValidActionTarget({ weapon: 'HE', ...target }, context.attackerViewGrid,
            { canUseAir: profile.available, heShape: profile.shape });
    }
    
    /**
     * 执行空袭/火箭覆盖
     */
    resolve(target, context) {
        const { r, c } = target;
        const profile = this._profile(context);
        const cells = this.previewArea(target, context).cells;
        const isRocket = profile.shape === 'plus' && !profile.requiresCV;
        const defenseFaction = context.defenderFaction || 'us';
        const vulnerability = getHEVulnerability(defenseFaction);
        
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
        
        // 逐格结算（便于为每个命中点生成特效事件）
        const events = [];
        const shipsSunk = [];
        const damagePoints = [];
        let penetrated = 0;
        let vulnerableCenterHit = false;
        let centerHitDamage = 0;
        
        for (const cell of validCells) {
            const isCenter = cell.r === r && cell.c === c;
            const baseDamage = isCenter ? profile.centerDamage : profile.outerDamage;
            // 防空薄弱只放大直接命中的中心弹，不按命中格数叠乘
            const cellDamage = isCenter ? applyHEDefense(defenseFaction, baseDamage) : baseDamage;
            const result = resolveHit(
                cell.r, cell.c, cellDamage,
                context.defenderGrid,
                context.defenderShips,
                context.isPlayer,
                isCenter && profile.centerPenetrates ? { penetrate: true } : undefined
            );
            events.push(...result.events);
            penetrated += result.penetrated || 0;
            if (result.sunk) {
                shipsSunk.push(result.hitShip.id);
            }
            if (result.hitShip && result.dealt > 0) {
                damagePoints.push({ r: cell.r, c: cell.c, amount: result.dealt });
                if (isCenter) {
                    centerHitDamage = result.dealt;
                    if (cellDamage > baseDamage) vulnerableCenterHit = true;
                }
            }
        }
        
        // 添加攻击日志
        const logClass = context.isPlayer ? 'c-p' : 'c-e';
        const prefix = context.isPlayer ? (isRocket ? '发动火箭齐射' : '呼叫空袭') 
                                        : (isRocket ? '敌方发动火箭齐射' : '敌方发动空袭');
        const centerNote = centerHitDamage > 0 ? `，中心命中 ${centerHitDamage} 伤` : '';
        const hitNote = damagePoints.length > 0 ? `（命中 ${damagePoints.length} 格）` : '（未命中）';
        const penetrateNote = penetrated > 0 ? `，传导 ${penetrated} 舱` : '';
        const vulnNote = vulnerability > 0 && vulnerableCenterHit ? '；敌舰防空薄弱，中心至少 2 伤' : '';
        const modeNote = profile.degraded ? '（陆基航空队）' : '';
        events.unshift(createLogEvent(
            `${prefix}覆盖 (${r + 1},${c + 1})，打击点数: ${validCells.length}${hitNote}${centerNote}${penetrateNote}${vulnNote}${modeNote}`,
            logClass
        ));
        
        // 特效：机群掠过/火箭落点 + 每个命中点的伤害数字
        events.splice(1, 0, createEffectEvent('AIRSTRIKE', {
            r, c,
            variant: isRocket ? 'rocket' : 'plane'
        }));
        for (const p of damagePoints) {
            events.push(createEffectEvent('DAMAGE', p));
        }
        
        return { events, shipsSunk };
    }
}
