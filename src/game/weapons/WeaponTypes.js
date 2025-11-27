// src/game/weapons/WeaponTypes.js
// 武器系统核心数据类型定义

import { BOARD_SIZE } from '../../config/constants.js';

/**
 * 格子状态枚举
 */
export const CellState = {
    UNKNOWN: 'UNKNOWN',
    MISS: 'MISS',
    HIT: 'HIT',
    DESTROYED: 'DESTROYED',
    SUSPECT: 'SUSPECT',
    SUNK: 'SUNK'
};

/**
 * 事件类型枚举
 */
export const EventType = {
    CELL_UPDATE: 'CELL_UPDATE',
    SHIP_UPDATE: 'SHIP_UPDATE',
    LOG: 'LOG',
    EFFECT: 'EFFECT'
};

/**
 * 船只状态快照（用于传递给武器，避免直接修改原对象）
 */
export class ShipState {
    constructor(ship) {
        this.id = ship.id;
        this.code = ship.code;
        this.name = ship.name;
        this.len = ship.len;
        this.maxHp = ship.maxHp;
        this.hp = [...ship.hp];     // 深拷贝
        this.sunk = ship.sunk;
        this.r = ship.r ?? -1;
        this.c = ship.c ?? -1;
        this.vertical = ship.vertical ?? false;
    }
}

/**
 * 创建格子更新事件的工厂函数
 * @param {number} r - 行坐标
 * @param {number} c - 列坐标
 * @param {string} state - 格子状态
 * @param {string|null} markClass - 可选的额外 CSS 类
 * @returns {Object} 格子更新事件
 */
export function createCellUpdateEvent(r, c, state, markClass = null) {
    return {
        type: EventType.CELL_UPDATE,
        payload: { r, c, state, markClass }
        // 注意：grid 字段由 WeaponService 统一注入
    };
}

/**
 * 创建船只更新事件的工厂函数
 * @param {number} shipId - 船只 ID
 * @param {number} segmentIndex - 受损的船体段索引
 * @param {number} newHp - 该段新的 HP 值
 * @param {boolean} sunk - 是否沉没
 * @returns {Object} 船只更新事件
 */
export function createShipUpdateEvent(shipId, segmentIndex, newHp, sunk) {
    return {
        type: EventType.SHIP_UPDATE,
        payload: { shipId, segmentIndex, newHp, sunk }
    };
}

/**
 * 创建日志事件的工厂函数
 * @param {string} message - 日志内容
 * @param {string} className - 样式类 ('c-p' | 'c-e' | 'c-sys' | 'c-warn')
 * @returns {Object} 日志事件
 */
export function createLogEvent(message, className) {
    return {
        type: EventType.LOG,
        payload: { message, className }
    };
}

/**
 * 边界检查工具
 * @param {number} r - 行坐标
 * @param {number} c - 列坐标
 * @returns {boolean} 是否在边界内
 */
export function isInBounds(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}
