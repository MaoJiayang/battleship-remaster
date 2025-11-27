// src/game/weapons/WeaponService.js
// 武器服务 - 协调武器执行、事件注入和渲染

import { EventType } from './WeaponTypes.js';

/**
 * 武器服务
 * 协调武器执行、事件注入和渲染
 */
export class WeaponService {
    /**
     * @param {WeaponRegistry} registry - 武器注册中心
     * @param {BattleRenderer} renderer - 渲染器
     */
    constructor(registry, renderer) {
        this.registry = registry;
        this.renderer = renderer;
        this.currentWeaponId = 'AP';
    }
    
    /**
     * 设置当前武器
     * @param {string} weaponId - 武器ID
     */
    setCurrentWeapon(weaponId) {
        if (this.registry.has(weaponId)) {
            this.currentWeaponId = weaponId;
        }
    }
    
    /**
     * 获取当前武器
     * @returns {WeaponBase}
     */
    getCurrentWeapon() {
        return this.registry.get(this.currentWeaponId);
    }
    
    /**
     * 获取预览范围
     * @param {Object} target - { r, c }
     * @returns {Object} { cells: [{r, c}] }
     */
    getPreviewArea(target) {
        const weapon = this.getCurrentWeapon();
        return weapon ? weapon.previewArea(target) : { cells: [] };
    }
    
    /**
     * 执行玩家攻击
     * @param {Object} target - { r, c }
     * @param {Object} context - 玩家武器上下文
     * @returns {Object} 执行结果 { success, events, shipsSunk, reason }
     */
    executePlayerAction(target, context) {
        const weapon = this.getCurrentWeapon();
        
        if (!weapon) {
            return { success: false, events: [], shipsSunk: [], reason: '武器不存在' };
        }
        
        if (!weapon.canUse(context)) {
            return { success: false, events: [], shipsSunk: [], reason: '武器不可用' };
        }
        
        if (!weapon.isValidTarget(target, context)) {
            return { success: false, events: [], shipsSunk: [], reason: '目标无效' };
        }
        
        const result = weapon.resolve(target, context);
        
        // 注入 grid 标识（玩家攻击敌方网格）
        this._injectGrid(result.events, 'ENEMY');
        
        // 渲染
        this.renderer.render(result.events);
        
        return { success: true, events: result.events, shipsSunk: result.shipsSunk || [] };
    }
    
    /**
     * 执行 AI 攻击
     * @param {Object} decision - { r, c, weapon }
     * @param {Object} context - AI 武器上下文
     * @returns {Object} 执行结果 { success, events, shipsSunk, reason }
     */
    executeAIAction(decision, context) {
        const { r, c, weapon: weaponId } = decision;
        const weapon = this.registry.get(weaponId);
        
        if (!weapon) {
            return { success: false, events: [], shipsSunk: [], reason: '武器不存在' };
        }
        
        const result = weapon.resolve({ r, c }, context);
        
        // 注入 grid 标识和 AI 攻击标记（AI 攻击玩家网格）
        this._injectGrid(result.events, 'PLAYER', 'last-enemy-attack');
        
        // 渲染
        this.renderer.render(result.events);
        
        return { success: true, events: result.events, shipsSunk: result.shipsSunk || [] };
    }
    
    /**
     * 为事件注入 grid 标识
     * @param {Array} events - 事件数组
     * @param {string} grid - 网格标识 'PLAYER' | 'ENEMY'
     * @param {string|null} markClass - 额外的 CSS 类
     */
    _injectGrid(events, grid, markClass = null) {
        for (const event of events) {
            if (event.payload) {
                event.payload.grid = grid;
                if (markClass && event.type === EventType.CELL_UPDATE) {
                    event.payload.markClass = markClass;
                }
            }
        }
    }
}
