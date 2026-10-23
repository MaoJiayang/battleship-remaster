// src/game/battle/BattleRenderer.js
// 战斗渲染器 - 将事件转换为 DOM 操作 + 视觉/听觉反馈

import { EventType } from '../weapons/WeaponTypes.js';
import { sfx } from '../../audio/sfx.js';
import { BOARD_SIZE } from '../../config/constants.js';

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
        this.planeImgFn = options.planeImgFn || (() => '');
        this._cellSize = 0;
        this._lastHitSfx = 0;
        this._hitBursts = [];
        this._shakeTimer = null;
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', () => { this._cellSize = 0; });
        }
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
        if (this._cellSize) return this._cellSize;
        const cell = document.querySelector('.cell');
        // offsetWidth 不受视图切换动画的 transform 影响
        this._cellSize = cell ? cell.offsetWidth : 40;
        return this._cellSize;
    }
    
    /**
     * 特效层：裁切在棋盘内，避免空袭飞机/声呐圈越界撑出页面横向滚动
     */
    _fxLayer(gridEl) {
        let layer = gridEl.querySelector(':scope > .grid-fx-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.className = 'grid-fx-layer';
            gridEl.appendChild(layer);
        }
        return layer;
    }
    
    /**
     * 在网格上生成一个特效元素，动画结束后自动移除
     */
    _spawnFx(grid, r, c, className, ttl, text = '') {
        const gridEl = document.getElementById(this._gridEl(grid));
        if (!gridEl) return null;
        const layer = this._fxLayer(gridEl);
        
        const cellSize = this._getCellSize();
        const fx = document.createElement('div');
        fx.className = className;
        if (text) fx.innerText = text;
        fx.style.left = (c * cellSize) + 'px';
        fx.style.top = (r * cellSize) + 'px';
        fx.style.width = cellSize + 'px';
        fx.style.height = cellSize + 'px';
        layer.appendChild(fx);
        setTimeout(() => fx.remove(), ttl);
        return fx;
    }
    
    _shakeScreen(intensity) {
        const battlefield = document.querySelector('.battlefield');
        if (!battlefield) return;
        // 同一轮齐射只保留一档震屏，避免反复重启动画与强制重排
        const active = battlefield.classList.contains('shake-hard') ? 2
            : battlefield.classList.contains('shake-soft') ? 1 : 0;
        if (active >= intensity) return;
        const cls = intensity >= 2 ? 'shake-hard' : 'shake-soft';
        battlefield.classList.remove('shake-hard', 'shake-soft');
        battlefield.classList.add(cls);
        clearTimeout(this._shakeTimer);
        this._shakeTimer = setTimeout(() => battlefield.classList.remove(cls), 500);
    }

    _takeHitBurst(now) {
        this._hitBursts = this._hitBursts.filter(t => now - t < 90);
        if (this._hitBursts.length >= 3) return false;
        this._hitBursts.push(now);
        return true;
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
        cell.classList.remove('hit', 'destroyed', 'miss', 'contact');
        
        // 应用新状态
        switch (state) {
            case 'HIT': {
                cell.classList.remove('detect', 'ai-detect');
                cell.classList.add('hit');
                const now = performance.now();
                if (this._takeHitBurst(now)) this._spawnFx(grid, r, c, 'fx-hit', 600);
                if (now - this._lastHitSfx > 90) {
                    sfx.play('hit');
                    this._lastHitSfx = now;
                }
                if (grid === 'PLAYER') this._shakeScreen(1);
                break;
            }
            case 'DESTROYED': {
                cell.classList.remove('detect', 'ai-detect');
                cell.classList.add('destroyed');
                this._spawnFx(grid, r, c, 'fx-explosion', 900);
                const now = performance.now();
                if (now - this._lastHitSfx > 90) {
                    sfx.play('hit');
                    this._lastHitSfx = now;
                }
                if (grid === 'PLAYER') this._shakeScreen(1);
                break;
            }
            case 'CONTACT':
                // 声纳接触：确认有舰但零伤害，不做爆炸/震屏，避免被误读为命中
                cell.classList.remove('detect', 'ai-detect');
                cell.classList.add('hit', 'contact');
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
            const gridEl = document.getElementById(this._gridEl(grid));
            if (!gridEl) return;
            const cellSize = this._getCellSize();

            if (payload.variant === 'rocket') {
                this._renderRocketSalvo(gridEl, payload, cellSize);
                return;
            }

            sfx.play('plane');
            // 三机小编队：单机约为旧机模的四分之一，整队仍保持可读性
            const squadronH = Math.min(cellSize * 1.7, gridEl.clientWidth * 0.36);
            const squadronW = squadronH * (34 / 26);
            const top = Math.max(2, Math.min(
                gridEl.clientHeight - squadronH - 2,
                (payload.r + 0.5) * cellSize - squadronH / 2
            ));
            const squadron = document.createElement('div');
            squadron.className = 'fx-squadron';
            squadron.style.top = top + 'px';
            squadron.style.width = squadronW + 'px';
            squadron.style.height = squadronH + 'px';
            squadron.style.setProperty('--fly-start', `${-squadronW - 16}px`);
            squadron.style.setProperty('--fly-end', `${gridEl.clientWidth + 16}px`);
            const squadronImg = document.createElement('img');
            squadronImg.alt = '';
            squadronImg.draggable = false;
            squadronImg.decoding = 'sync';
            squadronImg.src = this.planeImgFn(grid);
            squadron.appendChild(squadronImg);
            this._fxLayer(gridEl).appendChild(squadron);
            setTimeout(() => squadron.remove(), 1400);
        } else if (kind === 'SONAR') {
            sfx.play('sonar');
            // 扫描圈按学说半径扩散（3×3 / 5×5）
            const radius = payload.radius || 1;
            const cellSize = this._getCellSize();
            const fx = this._spawnFx(grid, payload.r, payload.c, 'fx-ping', 1000);
            if (fx) {
                const size = cellSize * (radius * 2 + 1);
                fx.style.left = ((payload.c - radius) * cellSize) + 'px';
                fx.style.top = ((payload.r - radius) * cellSize) + 'px';
                fx.style.width = size + 'px';
                fx.style.height = size + 'px';
            }
            if (payload.hasSignal) {
                setTimeout(() => sfx.play('detect'), 500);
            }
        } else if (kind === 'DAMAGE') {
            this._spawnFx(grid, payload.r, payload.c, 'fx-float', 1100, `-${payload.amount}`);
        }
    }

    /**
     * 火箭齐射：5 枚火箭分别砸向十字覆盖格，替代舰载机掠过
     */
    _renderRocketSalvo(gridEl, payload, cellSize) {
        sfx.play('fire');
        const layer = this._fxLayer(gridEl);
        const offsets = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
        offsets.forEach(([dr, dc], index) => {
            const tr = payload.r + dr;
            const tc = payload.c + dc;
            if (tr < 0 || tr >= BOARD_SIZE || tc < 0 || tc >= BOARD_SIZE) return;
            const rocket = document.createElement('div');
            rocket.className = 'fx-rocket';
            rocket.style.left = (tc * cellSize + cellSize / 2 - 2) + 'px';
            rocket.style.top = (tr * cellSize - cellSize * 1.6) + 'px';
            rocket.style.setProperty('--fall', `${cellSize * 1.6}px`);
            rocket.style.animationDelay = (index * 45) + 'ms';
            layer.appendChild(rocket);
            setTimeout(() => rocket.remove(), 800 + index * 45);
        });
    }
}
