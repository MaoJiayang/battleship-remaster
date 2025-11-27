// src/game/weapons/WeaponRegistry.js
// 武器注册中心 - 集中管理所有武器实例

/**
 * 武器注册中心
 * 集中管理所有武器实例
 */
export class WeaponRegistry {
    constructor() {
        this._weapons = new Map();
    }
    
    /**
     * 注册武器
     * @param {WeaponBase} weapon 
     */
    register(weapon) {
        this._weapons.set(weapon.id, weapon);
    }
    
    /**
     * 获取武器
     * @param {string} id 
     * @returns {WeaponBase}
     */
    get(id) {
        return this._weapons.get(id);
    }
    
    /**
     * 获取所有武器
     * @returns {Array<WeaponBase>}
     */
    getAll() {
        return Array.from(this._weapons.values());
    }
    
    /**
     * 检查武器是否存在
     * @param {string} id 
     * @returns {boolean}
     */
    has(id) {
        return this._weapons.has(id);
    }
}
