// src/game/battle/BattleRenderer.js
// 战斗渲染器 - 将事件转换为 DOM 操作

import { EventType } from '../weapons/WeaponTypes.js';

/**
 * 战斗渲染器 - 将事件转换为 DOM 操作
 */
export class BattleRenderer {
    /**
     * @param {Object} options
     * @param {Function} options.logFn - 日志输出函数 (msg, className) => void
     * @param {Function} options.onShipSunk - 船只沉没回调 (shipId, grid) => void
     */
    constructor(options = {}) {
        this.logFn = options.logFn || ((msg, cls) => console.log(`[${cls}] ${msg}`));
        this.onShipSunk = options.onShipSunk || (() => {});
    }
    
    /**
     * 渲染一组事件
     * @param {Array<Event>} events - 事件数组
     */
    render(events) {
        if (!events || !Array.isArray(events)) return;
        
        for (const event of events) {
            this._renderOne(event);
        }
    }
    
    /**
     * 渲染单个事件
     * @param {Object} event - 事件对象
     */
    _renderOne(event) {
        switch (event.type) {
            case EventType.CELL_UPDATE:
                this._renderCellUpdate(event.payload);
                break;
            case EventType.SHIP_UPDATE:
                this._renderShipUpdate(event.payload);
                break;
            case EventType.LOG:
                this._renderLog(event.payload);
                break;
            case EventType.EFFECT:
                this._renderEffect(event.payload);
                break;
        }
    }
    
    /**
     * 渲染格子状态更新
     * @param {Object} payload - 事件载荷
     */
    _renderCellUpdate(payload) {
        const { grid, r, c, state, markClass } = payload;
        const gridId = grid === 'PLAYER' ? 'player-grid' : 'enemy-grid';
        const cell = document.querySelector(`#${gridId} .cell[data-r="${r}"][data-c="${c}"]`);
        
        if (!cell) return;
        
        // 清除旧状态（保留 detect/ai-detect 之外的状态）
        cell.classList.remove('hit', 'destroyed', 'miss');
        
        // 应用新状态
        switch (state) {
            case 'HIT':
                cell.classList.remove('detect', 'ai-detect');
                cell.classList.add('hit');
                break;
            case 'DESTROYED':
                cell.classList.remove('detect', 'ai-detect');
                cell.classList.add('destroyed');
                break;
            case 'MISS':
                cell.classList.remove('detect', 'ai-detect');
                cell.classList.add('miss');
                break;
            case 'SUSPECT':
                // 玩家侧用 detect，AI 侧用 ai-detect
                // 如果格子已经有 hit/destroyed/miss 状态则不覆盖
                if (!cell.classList.contains('hit') && 
                    !cell.classList.contains('destroyed') && 
                    !cell.classList.contains('miss')) {
                    cell.classList.add(grid === 'PLAYER' ? 'ai-detect' : 'detect');
                }
                break;
        }
        
        // 附加额外样式（如 'last-enemy-attack'）
        if (markClass) {
            cell.classList.add(markClass);
        }
    }
    
    /**
     * 渲染船只状态更新
     * @param {Object} payload - 事件载荷
     */
    _renderShipUpdate(payload) {
        const { grid, shipId, sunk } = payload;
        
        if (sunk) {
            // 触发沉船回调
            this.onShipSunk(shipId, grid);
        }
    }
    
    /**
     * 渲染日志输出
     * @param {Object} payload - 事件载荷
     */
    _renderLog(payload) {
        const { message, className } = payload;
        this.logFn(message, className);
    }
    
    /**
     * 渲染特效（预留）
     * @param {Object} payload - 事件载荷
     */
    _renderEffect(payload) {
        // 预留：用于播放爆炸、扫描等动画效果
        // 当前版本暂不实现
    }
}
