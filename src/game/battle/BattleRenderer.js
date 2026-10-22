// src/game/battle/BattleRenderer.js
// 战斗渲染器 - 将事件转换为 DOM 操作 + 视觉/听觉反馈

import { EventType } from '../weapons/WeaponTypes.js';
import { sfx } from '../../audio/sfx.js';

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
    
    _gridEl(grid) {
        return grid === 'PLAYER' ? 'player-grid' : 'enemy-grid';
    }
    
    _getCellSize() {
        const cell = document.querySelector('.cell');
        return cell ? cell.getBoundingClientRect().width : 40;
    }
    
    /**
     * 在网格上生成一个特效元素，动画结束后自动移除
     */
    _spawnFx(grid, r, c, className, ttl, text = '') {
        const gridEl = document.getElementById(this._gridEl(grid));
        if (!gridEl) return null;
        
        const cellSize = this._getCellSize();
        const fx = document.createElement('div');
        fx.className = className;
        if (text) fx.innerText = text;
        fx.style.left = (c * cellSize) + 'px';
        fx.style.top = (r * cellSize) + 'px';
        fx.style.width = cellSize + 'px';
        fx.style.height = cellSize + 'px';
        gridEl.appendChild(fx);
        setTimeout(() => fx.remove(), ttl);
        return fx;
    }
    
    _shakeScreen(intensity) {
        const battlefield = document.querySelector('.battlefield');
        if (!battlefield) return;
        const cls = intensity >= 2 ? 'shake-hard' : 'shake-soft';
        battlefield.classList.remove('shake-hard', 'shake-soft');
        void battlefield.offsetWidth;
        battlefield.classList.add(cls);
        setTimeout(() => battlefield.classList.remove(cls), 500);
    }
    
    /**
     * 在指定格子生成一个浮动提示文字（供连击等游戏层反馈使用）
     */
    spawnFloat(grid, r, c, text, className = 'fx-float') {
        return this._spawnFx(grid, r, c, className, 1100, text);
    }
    
    _renderCellUpdate(payload) {
        const { grid, r, c, state, markClass } = payload;
        const cell = document.querySelector(`#${this._gridEl(grid)} .cell[data-r="${r}"][data-c="${c}"]`);
        
        if (!cell) return;
        
        // 清除旧状态（保留 detect/ai-detect 之外的状态）
        cell.classList.remove('hit', 'destroyed', 'miss');
        
        // 应用新状态
        switch (state) {
            case 'HIT':
                cell.classList.remove('detect', 'ai-detect');
                cell.classList.add('hit');
                this._spawnFx(grid, r, c, 'fx-hit', 600);
                sfx.play('hit');
                if (grid === 'PLAYER') this._shakeScreen(1);
                break;
            case 'DESTROYED':
                cell.classList.remove('detect', 'ai-detect');
                cell.classList.add('destroyed');
                this._spawnFx(grid, r, c, 'fx-explosion', 900);
                sfx.play('hit');
                if (grid === 'PLAYER') this._shakeScreen(1);
                break;
            case 'MISS':
                cell.classList.remove('detect', 'ai-detect');
                cell.classList.add('miss');
                this._spawnFx(grid, r, c, 'fx-splash', 700);
                sfx.play('splash');
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
    
    _renderShipUpdate(payload) {
        const { grid, shipId, sunk } = payload;
        
        if (sunk) {
            sfx.play('sunk');
            this._shakeScreen(2);
            this._flashScreen(grid === 'PLAYER' ? 'fx-flash-red' : 'fx-flash-gold');
            this.onShipSunk(shipId, grid);
        }
    }
    
    _flashScreen(cls) {
        const flash = document.createElement('div');
        flash.className = 'fx-screen-flash ' + cls;
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 600);
    }
    
    _renderLog(payload) {
        const { message, className } = payload;
        this.logFn(message, className);
    }
    
    /**
     * 渲染特效事件
     * kind: AIRSTRIKE (空袭机群掠过) | SONAR (声呐扫描圈) | DAMAGE (浮动伤害数字)
     */
    _renderEffect(payload) {
        const { kind, grid } = payload;
        
        if (kind === 'AIRSTRIKE') {
            sfx.play('plane');
            const gridEl = document.getElementById(this._gridEl(grid));
            if (!gridEl) return;
            const cellSize = this._getCellSize();
            const plane = document.createElement('div');
            plane.className = 'fx-plane';
            plane.style.top = (payload.r * cellSize) + 'px';
            gridEl.appendChild(plane);
            setTimeout(() => plane.remove(), 1200);
        } else if (kind === 'SONAR') {
            sfx.play('sonar');
            // 扫描圈覆盖 3x3：从中心格向外扩散
            const cellSize = this._getCellSize();
            const fx = this._spawnFx(grid, payload.r, payload.c, 'fx-ping', 1000);
            if (fx) {
                fx.style.left = ((payload.c - 1) * cellSize) + 'px';
                fx.style.top = ((payload.r - 1) * cellSize) + 'px';
                fx.style.width = (cellSize * 3) + 'px';
                fx.style.height = (cellSize * 3) + 'px';
            }
            if (payload.hasSignal) {
                setTimeout(() => sfx.play('detect'), 500);
            }
        } else if (kind === 'DAMAGE') {
            this._spawnFx(grid, payload.r, payload.c, 'fx-float', 1100, `-${payload.amount}`);
        }
    }
}
