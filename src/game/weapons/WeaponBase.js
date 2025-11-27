// src/game/weapons/WeaponBase.js
// 武器抽象基类 - 所有武器必须实现此接口

/**
 * 武器抽象基类
 * 所有武器必须实现此接口
 */
export class WeaponBase {
    /**
     * @param {Object} config - 武器配置
     * @param {string} config.id - 武器标识符：'AP', 'HE', 'SONAR'
     * @param {string} config.label - 显示名称：'主炮', '空袭', '水听'
     * @param {string} config.icon - 图标：'💥', '✈️', '📡'
     */
    constructor({ id, label, icon }) {
        this.id = id;
        this.label = label;
        this.icon = icon;
    }
    
    /**
     * 判断武器是否可用
     * @param {Object} context - 武器执行上下文
     * @returns {boolean}
     */
    canUse(context) {
        throw new Error('子类必须实现 canUse 方法');
    }
    
    /**
     * 判断目标是否有效
     * @param {Object} target - { r, c }
     * @param {Object} context - 武器执行上下文
     * @returns {boolean}
     */
    isValidTarget(target, context) {
        const { r, c } = target;
        const cell = context.defenderGrid[r]?.[c];
        if (!cell) return false;
        
        // 已确认 miss 不能再打
        if (cell.hit && cell.shipId === -1) return false;
        
        return true;
    }
    
    /**
     * 获取预览范围（用于鼠标悬停高亮）
     * @param {Object} target - { r, c }
     * @returns {Object} { cells: [{r, c}] }
     */
    previewArea(target) {
        throw new Error('子类必须实现 previewArea 方法');
    }
    
    /**
     * 执行武器效果
     * @param {Object} target - { r, c }
     * @param {Object} context - 武器执行上下文
     * @returns {Object} { events: Event[], shipsSunk: number[] }
     */
    resolve(target, context) {
        throw new Error('子类必须实现 resolve 方法');
    }
}
