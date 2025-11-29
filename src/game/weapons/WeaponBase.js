// src/game/weapons/WeaponBase.js
// 武器抽象基类 - 所有武器必须实现此接口

/**
 * 武器抽象基类
 * 所有武器必须实现此接口
 * 
 * ## 上下文约定（BattleContext）
 * 所有方法接收的 context 参数应包含以下字段：
 * - attackerShips: ShipState[] - 攻击方船只状态快照
 * - defenderGrid: GridCell[][] - 防守方网格（{ hit, shipId, segmentIndex }）
 * - defenderShips: Ship[] - 防守方船只数组（原始对象，resolve 会修改）
 * - isPlayer: boolean - 是否为玩家发起的攻击
 * 
 * ## 实现注意事项
 * 1. resolve() 会原地修改 defenderGrid 和 defenderShips
 * 2. 返回的 events 数组由 BattleRenderer 统一渲染
 * 3. 新增武器只需继承此类并实现 canUse/previewArea/resolve
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
     * 通常基于 attackerShips 中特定船只的存活状态判断
     * 
     * @param {BattleContext} context - 战斗上下文
     * @returns {boolean} 武器是否可用
     * 
     * @example
     * // 检查航母是否存活以启用空袭
     * canUse(context) {
     *     return context.attackerShips.some(s => s.code === 'CV' && !s.sunk);
     * }
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
     * 此方法会原地修改 context.defenderGrid 和 context.defenderShips
     * 
     * @param {Object} target - 目标坐标 { r, c }
     * @param {BattleContext} context - 战斗上下文
     * @returns {Object} 结算结果
     * @returns {Array<Event>} returns.events - 事件数组，由 BattleRenderer 渲染
     *   - EventType.CELL_UPDATE: 格子状态变更
     *   - EventType.SHIP_UPDATE: 船只状态变更
     *   - EventType.LOG: 日志输出
     *   - EventType.EFFECT: 特效播放（预留）
     * @returns {Array<number>} returns.shipsSunk - 本次攻击沉没的船只 ID 数组
     */
    resolve(target, context) {
        throw new Error('子类必须实现 resolve 方法');
    }
}
