import { BOARD_SIZE, CELL_SIZE as DEFAULT_CELL_SIZE, INTERACTION_TIMING } from "../config/constants";
import { SHIP_TYPES } from "../data/ships";
import { DIFFICULTY_SETTINGS, DEFAULT_DIFFICULTY } from "../data/difficulties";
import { calculateProbabilityGrid } from '../ai/aiStrategy.js';
import { makeAIDecisionAsync, resetAIState, neuralPreview, policyLabel, policyMetadata, captureDecisionEvent,
    completeDecisionEvent, decisionHistoryContext } from '#naval-game-policy';
import AiDecisionWorker from '../ai/aiWorker.js?worker&inline';
import { deployShips as aiDeployShips } from '../ai/aiDeployment.js';
import { getPlayerModel, recordCompletedMatch } from '../ai/playerModel.js';
import {
    beginMatch,
    abandonMatch,
    recordAction,
    finishMatch,
    damageFromEvents,
    sunkCodesFromIds,
    getMatchCount,
    exportMatchesToFile,
    clearMatches,
    isDiskLoggingEnabled,
    setDiskLoggingEnabled,
    probeDiskLog,
    getDiskLogState,
    onDiskLogStateChange
} from './matchRecorder.js';

// 武器系统导入
import { WeaponRegistry } from './weapons/WeaponRegistry.js';
import { WeaponService } from './weapons/WeaponService.js';
import { BattleRenderer } from './battle/BattleRenderer.js';
import { APWeapon } from './weapons/APWeapon.js';
import { HEWeapon } from './weapons/HEWeapon.js';
import { SonarWeapon } from './weapons/SonarWeapon.js';
import { ShipState, isInBounds, EventType } from './weapons/WeaponTypes.js';
import { sfx } from '../audio/sfx.js';
import { FACTIONS, RANDOM_FACTION, pickRandomEnemyFaction } from '../data/factions.js';
import { getShipSvg, getPlaneSquadronDataUrl } from './shipArt.js';
import {
    DOCTRINES,
    getDoctrine,
    getAPDamage as getFactionAPDamage,
    getAPMaxPenetrations,
    getHEProfile,
    getSonarProfile
} from '../data/doctrines.js';
import { VIEW_STATE } from './battle/ViewState.js';

    // === 动态尺寸获取 ===
    function getCellSize() {
        // offsetWidth 不受视图切换动画的 transform 影响，避免特效/船只错位
        const cell = document.querySelector('.cell');
        let size = cell ? cell.offsetWidth : 0;

        if (!size) {
            const cssSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell-size'));
            size = cssSize || DEFAULT_CELL_SIZE;
        }
        return size;
    }

    // === 辅助：获取当前交互时间配置 ===
    function getTiming() {
        return window.innerWidth <= INTERACTION_TIMING.MOBILE_BREAKPOINT 
            ? INTERACTION_TIMING.MOBILE 
            : INTERACTION_TIMING.DESKTOP;
    }

    // === 配置 ===

    // 舰船 DOM 生成器（内联 SVG 建模，见 shipArt.js）
    function getShipDom(code, factionId = 'us') {
        const w = SHIP_ORIGINAL_WIDTH[code];
        return `<div class="hull-scale-wrapper" data-original-width="${w}">${getShipSvg(code, factionId)}</div>`;
    }

    const SHIP_ORIGINAL_WIDTH = { BB: 240, CV: 240, CL: 170, DD: 120, SS: 60 };

    // 根据表二：船只属性定义表（外部配置）

    // === 状态 ===
    let gameState = 'SETUP';
    let myShips = [];
    let enemyShips = [];
    let myGridMap = createEmptyGrid(); 
    let enemyGridMap = [];
    let currentDeployMode = 'horizontal'; 
    let aiStack = []; 
    let currentWeapon = 'AP'; // AP, HE, SONAR 
    let firstTurn = 'PLAYER';
    let showAiDebug = false;
    let currentWinner = null;
    let aiTurnTimeout = null;
    let aiTurnToken = 0;              // 作废在途 AI 决策（重开/重开局面）
    let aiWorker = null;
    let aiDecisionSeq = 0;
    const pendingAiDecisions = new Map();

    // 战斗统计与连击
    let battleStats = null;
    let playerStreak = 0;
    // 本局玩家的射击格（结算时写入历史画像）
    const playerShotCells = new Set();

    // 追击阶段：一方仅剩最后 1 艘舰艇时，对方在下个己方回合获得接触区，之后每 3 回合刷新
    const ENDGAME_PING_INTERVAL = 3;
    const ENDGAME_FIRST_DELAY = 2;
    const RECON_RADIUS = 1;
    const endgameHunt = {
        player: { turns: 0, first: true },
        ai: { turns: 0, first: true }
    };
    const aiReconCells = new Set();
    // 区域接触观测：把“最后 1 艘舰至少有一格在该区域”作为一次传感器观测交给 AI
    let aiAreaContact = null;

    // 阵营选择（敌方可选“随机”：按集团对立逻辑每局重新抽取）
    let playerFaction = localStorage.getItem('playerFaction') || 'us';
    let enemyFactionRandom = localStorage.getItem('enemyFactionRandom') === '1';
    let enemyFaction = enemyFactionRandom
        ? pickRandomEnemyFaction(playerFaction)
        : (localStorage.getItem('enemyFaction') || 'ijn');

    function resetBattleStats() {
        battleStats = {
            turns: 0,
            maxStreak: 0,
            player: { shots: 0, hits: 0, damage: 0 },
            ai: { shots: 0, hits: 0, damage: 0 }
        };
        playerStreak = 0;
        playerShotCells.clear();
        endgameHunt.player.turns = 0;
        endgameHunt.player.first = true;
        endgameHunt.ai.turns = 0;
        endgameHunt.ai.first = true;
        aiReconCells.clear();
        aiAreaContact = null;
    }

    /**
     * 从武器事件中统计射击数与命中数
     */
    function countShots(events) {
        let shots = 0, hits = 0;
        for (const ev of events || []) {
            if (ev.type === 'CELL_UPDATE') {
                if (ev.payload.secondary) continue;
                const s = ev.payload.state;
                if (s === 'HIT' || s === 'DESTROYED' || s === 'MISS') {
                    shots++;
                    if (s !== 'MISS') hits++;
                }
            }
        }
        return { shots, hits };
    }

    /**
     * 记录战斗统计并处理玩家连击
     */
    function recordStats(events, isPlayer, weapon = 'AP') {
        if (!battleStats) return;
        // 水听只产生侦查标记，不计入射数/命中率
        const { shots, hits } = weapon === 'SONAR' ? { shots: 0, hits: 0 } : countShots(events);
        const side = isPlayer ? 'player' : 'ai';
        battleStats[side].shots += shots;
        battleStats[side].hits += hits;
        for (const ev of events || []) {
            if (ev.type === 'EFFECT' && ev.payload?.kind === 'DAMAGE') {
                battleStats[side].damage += ev.payload.amount || 0;
            }
        }

        if (isPlayer && weapon !== 'SONAR') {
            for (const ev of events || []) {
                if (ev.type !== EventType.CELL_UPDATE || ev.payload?.secondary) continue;
                const s = ev.payload.state;
                if (s === 'HIT' || s === 'DESTROYED' || s === 'MISS') {
                    playerShotCells.add(ev.payload.r * BOARD_SIZE + ev.payload.c);
                }
            }
        }

        if (isPlayer) {
            battleStats.turns++;
            if (weapon === 'SONAR') {
                playerStreak = 0;
            } else if (hits > 0) {
                playerStreak++;
                battleStats.maxStreak = Math.max(battleStats.maxStreak, playerStreak);
                if (playerStreak >= 2) {
                    const hitEv = (events || []).find(
                        e => e.type === 'CELL_UPDATE' && e.payload.state !== 'MISS'
                    );
                    const eGrid = document.getElementById('enemy-grid');
                    if (battleRenderer && hitEv && eGrid) {
                        battleRenderer.spawnFloat(
                            eGrid, hitEv.payload.r, hitEv.payload.c,
                            `连击 x${playerStreak}!`, 'fx-float fx-combo'
                        );
                    }
                }
            } else {
                playerStreak = 0;
            }
        }
    }

    /**
     * 回合指示器：'player' | 'ai' | 'end' | null
     */
    function setTurnIndicator(state) {
        const el = document.getElementById('turn-indicator');
        if (!el) return;
        if (!state) { el.className = 'turn-indicator'; el.textContent = ''; return; }
        el.className = `turn-indicator visible t-${state}`;
        el.textContent = state === 'player' ? '我方回合' : (state === 'ai' ? '敌方回合' : '战斗结束');
        void el.offsetWidth; // 重新触发 pop 动画
        el.classList.add('pop');
    }

    function updateSoundBtn() {
        const btn = document.getElementById('btn-sound');
        if (!btn) return;
        const on = sfx.isEnabled();
        btn.dataset.state = on ? 'on' : 'off';
        btn.setAttribute('aria-pressed', String(on));
        const label = document.getElementById('btn-sound-label');
        if (label) label.textContent = on ? 'SND ON' : 'SND OFF';
    }

    // 武器系统实例（模块级变量）
    let weaponRegistry = null;
    let battleRenderer = null;
    let weaponService = null;

    // 阵营下拉：Electron 的原生 select 弹层偶尔不显示，改由页面内菜单承载
    function setupFactionTrigger(select) {
        const trigger = document.getElementById(`${select.id}-trigger`);
        if (!trigger) return;
        const menuId = `${select.id}-menu`;
        let menu = null;
        let open = false;

        const syncLabel = () => {
            const option = select.selectedOptions[0];
            trigger.textContent = option ? option.textContent : '选择阵营';
        };

        const menuItems = () => menu ? [...menu.querySelectorAll('[role="option"]')] : [];
        const setActive = index => {
            const items = menuItems();
            if (!items.length) return;
            const next = Math.max(0, Math.min(items.length - 1, index));
            items.forEach((item, i) => item.classList.toggle('active', i === next));
            items[next].focus({ preventScroll: true });
            items[next].scrollIntoView({ block: 'nearest' });
        };

        const close = (restoreFocus = false) => {
            if (!open) return;
            open = false;
            trigger.setAttribute('aria-expanded', 'false');
            trigger.removeAttribute('aria-controls');
            if (menu) {
                menu.remove();
                menu = null;
            }
            document.removeEventListener('pointerdown', onOutside, true);
            window.removeEventListener('resize', onViewportChange);
            window.removeEventListener('scroll', onViewportChange, true);
            if (restoreFocus) trigger.focus({ preventScroll: true });
        };

        const choose = index => {
            const option = select.options[index];
            if (!option) return;
            const changed = select.value !== option.value;
            select.value = option.value;
            syncLabel();
            close(true);
            if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
        };

        const positionMenu = () => {
            const rect = trigger.getBoundingClientRect();
            const below = window.innerHeight - rect.bottom - 8;
            const above = rect.top - 8;
            const placeAbove = below < 160 && above > below;
            menu.style.width = `${rect.width}px`;
            menu.style.left = `${rect.left}px`;
            menu.style.maxHeight = `${Math.max(80, Math.min(280, placeAbove ? above : below))}px`;
            menu.style.top = placeAbove
                ? `${Math.max(8, rect.top - menu.offsetHeight - 4)}px`
                : `${rect.bottom + 4}px`;
        };

        const onOutside = event => {
            if (menu && (menu.contains(event.target) || trigger.contains(event.target))) return;
            close();
        };
        const onViewportChange = event => {
            // 菜单自身滚动时保持展开
            if (event && event.target instanceof Node && menu && menu.contains(event.target)) return;
            close();
        };

        const openMenu = () => {
            if (open) return;
            open = true;
            menu = document.createElement('div');
            menu.className = 'faction-menu';
            menu.id = menuId;
            menu.setAttribute('role', 'listbox');
            const labelledBy = trigger.getAttribute('aria-labelledby');
            if (labelledBy) menu.setAttribute('aria-labelledby', labelledBy);
            else menu.setAttribute('aria-label', trigger.textContent);
            [...select.options].forEach((option, index) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'faction-option';
                item.id = `${menuId}-opt-${index}`;
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', String(option.value === select.value));
                item.textContent = option.textContent;
                if (option.value === select.value) item.classList.add('selected');
                item.addEventListener('click', () => choose(index));
                menu.appendChild(item);
            });
            menu.addEventListener('keydown', event => {
                const items = menuItems();
                const current = items.indexOf(document.activeElement);
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActive((current < 0 ? 0 : current) + (event.key === 'ArrowDown' ? 1 : -1));
                } else if (event.key === 'Home' || event.key === 'End') {
                    event.preventDefault();
                    setActive(event.key === 'Home' ? 0 : items.length - 1);
                } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    choose(current >= 0 ? current : select.selectedIndex);
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    close(true);
                } else if (event.key === 'Tab') {
                    // 关闭后从触发按钮继续 Tab，避免焦点落在已被移除的菜单项
                    close(true);
                }
            });
            document.body.appendChild(menu);
            trigger.setAttribute('aria-expanded', 'true');
            trigger.setAttribute('aria-controls', menuId);
            positionMenu();
            document.addEventListener('pointerdown', onOutside, true);
            window.addEventListener('resize', onViewportChange);
            window.addEventListener('scroll', onViewportChange, true);
            setActive(Math.max(0, select.selectedIndex));
        };

        select.addEventListener('change', syncLabel);
        trigger.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (open) close(true);
            else openMenu();
        });
        trigger.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (!open) openMenu();
            } else if (event.key === 'Escape' && open) {
                event.preventDefault();
                close(true);
            }
        });
        syncLabel();
    }

    export function initGame() {
        initGrids();
        
        // 优先初始化视图状态，确保移动端容器可见，以便正确计算尺寸
        switchMobileView('player');

        initShips();
        bindUiEvents();
        
        // 初始化武器系统
        initWeaponSystem();
        
        // Mouse Events
        document.addEventListener('mouseup', onGlobalMouseUp);
        document.addEventListener('mousemove', onGlobalMouseMove);
        
        // Touch Events (Mobile)
        document.addEventListener('touchend', onGlobalTouchEnd, { passive: false });
        document.addEventListener('touchmove', onGlobalTouchMove, { passive: false });

        // 监听窗口大小变化，实时调整棋盘和舰船尺寸
        window.addEventListener('resize', () => {
            updateGridSize();
            myShips.forEach(ship => updateShipVisuals(ship));
            // 同时也需要更新已显示的敌舰
            document.querySelectorAll('.revealed-enemy-ship').forEach(el => {
                const shipId = parseInt(el.dataset.id);
                const ship = enemyShips.find(s => s.id === shipId);
                if (ship) updateRevealedShipVisuals(el, ship);
            });
        });

        initHelpShips();
        initHelpDoctrines();
        updateDoctrineReadout();
        setDifficulty(currentDifficulty, { silent: true });
        if (neuralPreview) {
            document.title += ' · 神经 AI 体验版';
            document.querySelector('.hdr-sub').textContent = policyLabel;
            log(`${policyLabel}。困难模式使用当前冻结模型，简单／中等保留旧 AI。`, 'c-sys');
        }
        
        // 初始化默认视图
        switchMobileView('player');
    }

    /**
     * 初始化武器系统
     */
    function initWeaponSystem() {
        // 创建渲染器
        battleRenderer = new BattleRenderer({
            logFn: log,
            planeImgFn: (grid) => getPlaneSquadronDataUrl(grid === 'PLAYER' ? enemyFaction : playerFaction),
            onShipSunk: (shipId, grid) => {
                if (grid === 'ENEMY') {
                    const ship = enemyShips.find(s => s.id === shipId);
                    if (ship) revealSingleEnemyShip(ship);
                }
                // 玩家船只沉没时，ship.el 上会添加 sunk 类，这部分在 resolve 时处理
            }
        });
        
        // 创建注册中心并注册武器
        weaponRegistry = new WeaponRegistry();
        weaponRegistry.register(new APWeapon());
        weaponRegistry.register(new HEWeapon());
        weaponRegistry.register(new SonarWeapon());
        
        // 创建服务
        weaponService = new WeaponService(weaponRegistry, battleRenderer);
    }

    /**
     * 构建玩家武器上下文
     */
    function buildPlayerWeaponContext() {
        return {
            attackerShips: myShips.map(s => new ShipState(s)),
            defenderGrid: enemyGridMap,
            defenderShips: enemyShips,
            isPlayer: true,
            attackerFaction: playerFaction,
            defenderFaction: enemyFaction,
            attackerViewGrid: getPlayerViewGrid()
        };
    }

    /**
     * 构建 AI 武器上下文
     */
    function buildAIWeaponContext() {
        return {
            attackerShips: enemyShips.map(s => new ShipState(s)),
            defenderGrid: buildPlayerGridForAI(),
            defenderShips: myShips,
            isPlayer: false,
            attackerFaction: enemyFaction,
            defenderFaction: playerFaction,
            attackerViewGrid: getAiViewGrid()
        };
    }

    /**
     * 创建 AI 视角的玩家网格
     * AI 攻击玩家时需要一个与 enemyGridMap 结构相同的网格
     */
    function buildPlayerGridForAI() {
        const grid = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            grid[r] = [];
            for (let c = 0; c < BOARD_SIZE; c++) {
                let shipId = -1;
                let segmentIndex = -1;
                
                // 遍历玩家船只查找位置
                for (const ship of myShips) {
                    const cells = [];
                    for (let i = 0; i < ship.len; i++) {
                        cells.push(ship.vertical 
                            ? { r: ship.r + i, c: ship.c, idx: i }
                            : { r: ship.r, c: ship.c + i, idx: i }
                        );
                    }
                    const match = cells.find(cell => cell.r === r && cell.c === c);
                    if (match) {
                        shipId = ship.id;
                        segmentIndex = match.idx;
                        break;
                    }
                }
                
                // 从 DOM 推断 hit 状态
                const cell = document.querySelector(
                    `#player-grid .cell[data-r="${r}"][data-c="${c}"]`
                );
                const hit = cell && (
                    cell.classList.contains('hit') || 
                    cell.classList.contains('destroyed') || 
                    cell.classList.contains('miss')
                );
                
                grid[r][c] = { hit, shipId, segmentIndex };
            }
        }
        return grid;
    }

    function createEmptyGrid() {
        return Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
    }

    /**
     * 计算并设置动态棋盘尺寸
     * 确保棋盘最大宽度不超过移动端断点，同时格子尺寸均匀
     */
    function updateGridSize() {
        const root = document.documentElement;
        const viewportW = root.clientWidth || window.innerWidth;
        const isMobile = viewportW <= INTERACTION_TIMING.MOBILE_BREAKPOINT;
        const gridBorder = 8; // 4px * 2
        let cellSize = DEFAULT_CELL_SIZE;

        if (isMobile) {
            // 移动端：左侧留给行号，右侧留少量呼吸空间
            const horizPadding = 28;
            const available = viewportW - horizPadding - gridBorder;
            cellSize = Math.max(20, Math.min(DEFAULT_CELL_SIZE, Math.floor(available / BOARD_SIZE)));
        }

        root.style.setProperty('--board-size', BOARD_SIZE);
        root.style.setProperty('--cell-size', `${cellSize}px`);
    }

    function addCoordLabels(gridEl) {
        const xs = Array.from({ length: BOARD_SIZE }, (_, i) => `<span>${i + 1}</span>`).join('');
        const ys = Array.from({ length: BOARD_SIZE }, (_, i) => `<span>${String.fromCharCode(65 + i)}</span>`).join('');
        const xEl = document.createElement('div');
        xEl.className = 'coord coord-x';
        xEl.innerHTML = xs;
        const yEl = document.createElement('div');
        yEl.className = 'coord coord-y';
        yEl.innerHTML = ys;
        gridEl.appendChild(xEl);
        gridEl.appendChild(yEl);
    }

    function initGrids() {
        // 初始化时设置棋盘尺寸
        updateGridSize();
        
        const pGrid = document.getElementById('player-grid');
        const eGrid = document.getElementById('enemy-grid');
        pGrid.innerHTML = ''; eGrid.innerHTML = '';
        
        for(let r=0; r<BOARD_SIZE; r++) {
            for(let c=0; c<BOARD_SIZE; c++) {
                let div = document.createElement('div');
                div.className = 'cell';
                div.dataset.r = r; div.dataset.c = c;
                pGrid.appendChild(div);

                let div2 = document.createElement('div');
                div2.className = 'cell';
                div2.dataset.r = r; div2.dataset.c = c;
                div2.onclick = () => clickEnemy(r, c);
                // 新增：鼠标悬停事件用于显示攻击范围
                div2.onmouseenter = () => handleEnemyGridHover(r, c);
                div2.onmouseleave = () => clearAttackHighlights();
                eGrid.appendChild(div2);
            }
        }

        addCoordLabels(pGrid);
        addCoordLabels(eGrid);
    }

    function updateMatchLogUi() {
        const countEl = document.getElementById('match-log-count');
        const count = getMatchCount();
        if (countEl) countEl.textContent = String(count);
        const exportBtn = document.getElementById('btn-export-matches');
        if (exportBtn) exportBtn.disabled = count === 0;
        const clearBtn = document.getElementById('btn-clear-matches');
        if (clearBtn) clearBtn.disabled = count === 0;

        const diskState = getDiskLogState();
        const diskBtn = document.getElementById('btn-disk-log');
        if (diskBtn) {
            diskBtn.textContent = `自动落盘：${diskState.enabled ? '开' : '关'}`;
            diskBtn.classList.toggle('is-on', diskState.enabled);
        }
        const diskStatus = document.getElementById('match-disk-status');
        if (diskStatus) {
            let text;
            let tone = '';
            if (diskState.enabled) {
                if (diskState.needsPermission) {
                    text = '已开启，需要重新授权：点击上方开关选择项目文件夹。';
                    tone = 'is-error';
                } else {
                    text = `每一手写入 ${diskState.file}（已写 ${diskState.written} 行）`;
                    if (diskState.failed) {
                        text += `，失败 ${diskState.failed}`;
                        tone = 'is-error';
                    } else {
                        tone = 'is-on';
                    }
                }
            } else if (diskState.available === false) {
                text = '当前浏览器没有落盘通道；对局记录仍保存在浏览器内。';
                tone = 'is-error';
            } else {
                text = diskState.transport === 'http'
                    ? '开启后每一手写入项目内 match-logs/。'
                    : '开启后选择游戏所在文件夹（如 海战棋），之后每手自动追加到其中的 match-logs/。';
            }
            diskStatus.textContent = text;
            diskStatus.classList.toggle('is-on', tone === 'is-on');
            diskStatus.classList.toggle('is-error', tone === 'is-error');
        }
    }

    function bindUiEvents() {
        const helpBtn = document.getElementById('help-btn');
        if (helpBtn) {
            // 检查是否点击过帮助，如果没有则添加高亮动画
            if (!localStorage.getItem('hasClickedHelp')) {
                helpBtn.classList.add('pulse-highlight');
            }

            helpBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 点击后移除高亮并记录
                helpBtn.classList.remove('pulse-highlight');
                localStorage.setItem('hasClickedHelp', 'true');
                toggleHelp();
            });
        }

        // 菜单按钮 (Header)
        const menuBtn = document.getElementById('btn-menu-toggle');
        const settingsModal = document.getElementById('settings-modal');
        if (menuBtn && settingsModal) {
            menuBtn.addEventListener('click', () => {
                settingsModal.style.display = 'block';
                updateMatchLogUi();
                probeDiskLog().then(updateMatchLogUi);
            });
        }

        const exportBtn = document.getElementById('btn-export-matches');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                const { payload, filename } = exportMatchesToFile();
                log(`已导出 ${payload.matchCount} 局对局数据：${filename}`, 'c-sys');
            });
        }
        const clearBtn = document.getElementById('btn-clear-matches');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (!getMatchCount()) return;
                if (!window.confirm('清空本地对局记录？建议先导出 JSON。')) return;
                clearMatches();
                updateMatchLogUi();
                log('本地对局记录已清空。', 'c-sys');
            });
        }

        const diskBtn = document.getElementById('btn-disk-log');
        if (diskBtn) {
            diskBtn.addEventListener('click', async () => {
                const state = getDiskLogState();
                if (state.enabled && state.needsPermission) {
                    const ok = await setDiskLoggingEnabled(true);
                    log(ok ? '落盘授权已恢复。' : '未完成授权，自动落盘暂不可用。', ok ? 'c-sys' : 'c-warn');
                } else if (state.enabled) {
                    await setDiskLoggingEnabled(false);
                    log('自动落盘已关闭，对局记录仍保存在浏览器内。', 'c-sys');
                } else {
                    const ok = await setDiskLoggingEnabled(true);
                    if (ok) {
                        log(`自动落盘已开启：每一手写入 ${getDiskLogState().file}。`, 'c-sys');
                    } else {
                        log('未能开启自动落盘（已取消选择或当前浏览器不支持），对局记录仍保存在浏览器内。', 'c-warn');
                    }
                }
                updateMatchLogUi();
            });
        }
        onDiskLogStateChange(updateMatchLogUi);
        updateMatchLogUi();
        probeDiskLog().then((available) => {
            if (!available && isDiskLoggingEnabled()) {
                setDiskLoggingEnabled(false);
                log('未连接落盘服务，自动落盘已关闭；对局记录仍保存在浏览器内。', 'c-warn');
            }
            updateMatchLogUi();
        });

        const helpModal = document.getElementById('help-modal');
        if (helpModal) {
            helpModal.addEventListener('click', (event) => {
                if (event.target === helpModal) {
                    event.stopPropagation();
                    toggleHelp();
                }
            });
            const closeBtn = helpModal.querySelector('.close-btn');
            if (closeBtn) closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleHelp();
            });
        }

        document.querySelectorAll('[data-weapon]').forEach(btn => {
            btn.addEventListener('click', () => {
                selectWeapon(btn.dataset.weapon);
                // 移动端选择武器后自动收起武器栏
                if (window.innerWidth <= 768) {
                    document.getElementById('weapon-bar').classList.remove('show');
                }
            });
        });

        document.querySelectorAll('[data-difficulty]').forEach(btn => {
            btn.addEventListener('click', () => setDifficulty(btn.dataset.difficulty));
        });

        // 阵营选择
        const fpSelect = document.getElementById('faction-player');
        const feSelect = document.getElementById('faction-enemy');
        if (fpSelect && feSelect) {
            const options = Object.entries(FACTIONS)
                .map(([id, f]) => `<option value="${id}">${f.name}</option>`).join('');
            fpSelect.innerHTML = options;
            feSelect.innerHTML = `<option value="${RANDOM_FACTION}">随机</option>` + options;
            fpSelect.value = playerFaction;
            feSelect.value = enemyFactionRandom ? RANDOM_FACTION : enemyFaction;
            setupFactionTrigger(fpSelect);
            setupFactionTrigger(feSelect);

            fpSelect.addEventListener('change', () => {
                playerFaction = fpSelect.value;
                localStorage.setItem('playerFaction', playerFaction);
                sfx.play('click');
                if (enemyFactionRandom) enemyFaction = pickRandomEnemyFaction(playerFaction);
                updateDoctrineReadout();
                initHelpShips();
                updateWeaponStates();
                if (gameState === 'SETUP') {
                    if (autoDeployTimer) {
                        clearTimeout(autoDeployTimer);
                        autoDeployTimer = null;
                    }
                    myGridMap = createEmptyGrid();
                    initShips();
                    checkReady();
                    log(`我方阵营更换为「${FACTIONS[playerFaction].name}」，${getDoctrine(playerFaction).name}，请重新部署。`, "c-sys");
                }
                if (enemyFactionRandom) {
                    log('敌方随机阵营已按新的集团归属重新抽取，开战前不揭晓。', "c-sys");
                }
            });

            feSelect.addEventListener('change', () => {
                sfx.play('click');
                if (feSelect.value === RANDOM_FACTION) {
                    enemyFactionRandom = true;
                    localStorage.setItem('enemyFactionRandom', '1');
                    enemyFaction = pickRandomEnemyFaction(playerFaction);
                    updateDoctrineReadout();
                    log('敌方阵营设为随机：每局开战前从对立集团抽取，开战即揭晓。', "c-sys");
                    return;
                }
                enemyFactionRandom = false;
                localStorage.setItem('enemyFactionRandom', '0');
                enemyFaction = feSelect.value;
                localStorage.setItem('enemyFaction', enemyFaction);
                updateDoctrineReadout();
                log(`敌方阵营更换为「${FACTIONS[enemyFaction].name}」，${getDoctrine(enemyFaction).name}。`, "c-sys");
            });
        }

        const rotateBtn = document.getElementById('rotate-toggle');
        if (rotateBtn) rotateBtn.addEventListener('click', toggleDeployMode);

        const firstTurnBtn = document.getElementById('first-turn-toggle');
        if (firstTurnBtn) firstTurnBtn.addEventListener('click', toggleFirstTurn);

        document.querySelectorAll('[data-panel-toggle]').forEach(btn => {
            btn.addEventListener('click', () => togglePanel(btn.dataset.panelToggle));
        });

        const debugBtn = document.getElementById('btn-debug');
        if (debugBtn) debugBtn.addEventListener('click', toggleAiDebug);

        const resetBtn = document.getElementById('btn-reset');
        if (resetBtn) resetBtn.addEventListener('click', resetToDock);

        const randomBtn = document.getElementById('btn-random');
        if (randomBtn) randomBtn.addEventListener('click', autoDeploy);

        const startBtn = document.getElementById('start-btn');
        if (startBtn) startBtn.addEventListener('click', handleStartOrRestart);

        const viewBattleBtn = document.querySelector('[data-action="view-battlefield"]');
        if (viewBattleBtn) viewBattleBtn.addEventListener('click', closeGameOverModal);

        const restartBtn = document.querySelector('[data-action="restart-game"]');
        if (restartBtn) restartBtn.addEventListener('click', closeGameOverAndReset);

        // Settings Modal (Menu)
        const settingsBtn = document.getElementById('btn-settings');
        if (settingsBtn && settingsModal) {
            settingsBtn.addEventListener('click', () => {
                settingsModal.style.display = 'block';
            });
            
            settingsModal.addEventListener('click', (e) => {
                if (e.target === settingsModal) settingsModal.style.display = 'none';
            });

            const closeSettings = settingsModal.querySelector('.close-btn');
            if (closeSettings) {
                closeSettings.addEventListener('click', () => settingsModal.style.display = 'none');
            }

            // Mobile specific bindings
            const mFirstTurn = document.getElementById('mobile-first-turn');
            if (mFirstTurn) mFirstTurn.addEventListener('click', toggleFirstTurn);

            const mDebug = document.getElementById('mobile-debug');
            if (mDebug) mDebug.addEventListener('click', toggleAiDebug);

            const mReset = document.getElementById('mobile-reset'); // 旧 ID 兼容
            if (mReset) mReset.addEventListener('click', () => {
                resetToDock();
                settingsModal.style.display = 'none';
            });

            // 新菜单按钮绑定
            const mmRestart = document.getElementById('mobile-menu-restart');
            if (mmRestart) mmRestart.addEventListener('click', () => {
                if (gameState === 'PLAYING' || gameState === 'END') {
                    if(confirm("确定要重新开始吗？")) {
                        resetGameFull();
                        settingsModal.style.display = 'none';
                    }
                } else {
                    resetGameFull();
                    settingsModal.style.display = 'none';
                }
            });

            const mmRandom = document.getElementById('mobile-menu-random');
            if (mmRandom) mmRandom.addEventListener('click', () => {
                autoDeploy();
                settingsModal.style.display = 'none';
            });

            const mmReset = document.getElementById('mobile-menu-reset');
            if (mmReset) mmReset.addEventListener('click', () => {
                resetToDock();
                settingsModal.style.display = 'none';
            });

            const mmHelp = document.getElementById('mobile-menu-help');
            if (mmHelp) mmHelp.addEventListener('click', () => {
                settingsModal.style.display = 'none';
                toggleHelp();
            });
        }

        // Mobile View Switch (Old & New)
        const tabPlayer = document.getElementById('tab-view-player');
        const tabEnemy = document.getElementById('tab-view-enemy');
        if (tabPlayer) tabPlayer.addEventListener('click', () => switchMobileView('player'));
        if (tabEnemy) tabEnemy.addEventListener('click', () => switchMobileView('enemy'));

        // New Mobile Bottom Bar Bindings
        const mbTabPlayer = document.getElementById('mb-tab-player');
        const mbTabEnemy = document.getElementById('mb-tab-enemy');
        if (mbTabPlayer) mbTabPlayer.addEventListener('click', () => switchMobileView('player'));
        if (mbTabEnemy) mbTabEnemy.addEventListener('click', () => switchMobileView('enemy'));

        // const mbRotate = document.getElementById('mb-btn-rotate');
        // if (mbRotate) mbRotate.addEventListener('click', toggleDeployMode);

        const mbStart = document.getElementById('mb-btn-start');
        if (mbStart) mbStart.addEventListener('click', handleStartOrRestart);

        const mbWeapon = document.getElementById('mb-btn-weapon');
        if (mbWeapon) mbWeapon.addEventListener('click', () => {
            const bar = document.getElementById('weapon-bar');
            bar.classList.toggle('show');
        });

        // 音效开关
        const soundBtn = document.getElementById('btn-sound');
        if (soundBtn) {
            soundBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                sfx.toggle();
                updateSoundBtn();
            });
            updateSoundBtn();
        }

        // 键盘快捷键：1/2/3 切换武器，R 旋转，H 帮助，M 音效
        document.addEventListener('keydown', (e) => {
            if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
            const k = e.key.toLowerCase();
            if (k === '1') selectWeapon('AP');
            else if (k === '2' && !document.getElementById('btn-he').disabled) selectWeapon('HE');
            else if (k === '3' && !document.getElementById('btn-sonar').disabled) selectWeapon('SONAR');
            else if (k === 'r' && gameState === 'SETUP') toggleDeployMode();
            else if (k === 'h') toggleHelp();
            else if (k === 'm') { sfx.toggle(); updateSoundBtn(); }
        });
    }

    // === 移动端视图切换逻辑 ===
    function switchMobileView(viewName) {
        // 仅在移动端生效 (通过检测按钮是否可见，或者直接操作类名，PC端CSS会忽略这些类名)
        const pBox = document.getElementById('player-board-box');
        const eBox = document.getElementById('enemy-board-box');
        const target = viewName === 'player' ? pBox : eBox;
        const other = viewName === 'player' ? eBox : pBox;

        // 目标视图已激活时直接返回，避免重复触发入场动画造成闪烁
        if (other.classList.contains('active-view')) {
            other.classList.remove('active-view');
        } else if (target.classList.contains('active-view')) {
            return;
        }
        target.classList.add('active-view');
        
        // Old tabs
        const tabP = document.getElementById('tab-view-player');
        const tabE = document.getElementById('tab-view-enemy');
        
        // New tabs
        const mbTabP = document.getElementById('mb-tab-player');
        const mbTabE = document.getElementById('mb-tab-enemy');

        if(tabP) tabP.classList.toggle('active', viewName === 'player');
        if(tabE) tabE.classList.toggle('active', viewName === 'enemy');
        if(mbTabP) mbTabP.classList.toggle('active', viewName === 'player');
        if(mbTabE) mbTabE.classList.toggle('active', viewName === 'enemy');
    }

    // === 攻击范围高亮逻辑 ===
    function handleEnemyGridHover(r, c) {
        if (gameState !== 'PLAYING') return;
        if (document.getElementById('enemy-grid').style.pointerEvents === 'none') return;

        clearAttackHighlights();

        // 使用武器系统获取预览范围（需带阵营上下文，学说会改变形状/半径）
        if (weaponService) {
            weaponService.setCurrentWeapon(currentWeapon);
            const preview = weaponService.getPreviewArea({ r, c }, buildPlayerWeaponContext());
            
            const eGrid = document.getElementById('enemy-grid');
            preview.cells.forEach(pos => {
                if (pos.r >= 0 && pos.r < BOARD_SIZE && pos.c >= 0 && pos.c < BOARD_SIZE) {
                    const cell = eGrid.querySelector(`.cell[data-r="${pos.r}"][data-c="${pos.c}"]`);
                    if (cell) cell.classList.add('attack-range-highlight');
                }
            });
        }
    }

    function clearAttackHighlights() {
        const eGrid = document.getElementById('enemy-grid');
        eGrid.querySelectorAll('.attack-range-highlight').forEach(el => {
            el.classList.remove('attack-range-highlight');
        });
    }

    function initShips() {
        const dock = document.getElementById('dock');
        const pGrid = document.getElementById('player-grid');
        // 切换阵营会重建舰船对象，旧模型挂在棋盘上不随对象一起消失
        pGrid.querySelectorAll(':scope > .ship').forEach(el => el.remove());
        myShips = [];
        dock.innerHTML = '';

        SHIP_TYPES.forEach((type, i) => {
        const shipEl = document.createElement('div');
        shipEl.className = `ship ship-visuals-root f-${playerFaction}`;
            shipEl.title = `${type.name} (长度:${type.len})`;
            shipEl.style.position = 'relative'; 
            
            const inner = document.createElement('div');
            inner.className = 'ship-inner';
            inner.innerHTML = getShipDom(type.code, playerFaction); // 使用新 DOM
            shipEl.appendChild(inner);

            const shipObj = {
                id: i,
                name: type.name,
                len: type.len,
                maxHp: type.maxHp,
                code: type.code,
                hp: Array(type.len).fill(type.maxHp),
                el: shipEl,
                inDock: true,
                vertical: false,
                r: -1, c: -1,
                sunk: false
            };

            updateShipVisuals(shipObj);

            shipEl.onclick = (e) => {
                if (isDragging) return;
                if (gameState === 'SETUP' && !shipObj.inDock) {
                   rotateShipOnBoard(shipObj);
                }
            };

            shipEl.onmousedown = (e) => onShipMouseDown(e, shipObj);
            shipEl.ontouchstart = (e) => onShipTouchStart(e, shipObj);

            dock.appendChild(shipEl);
            myShips.push(shipObj);
        });
    }

    function updateShipScale(shipEl, len, cellSize) {
        const wrapper = shipEl.querySelector('.hull-scale-wrapper');
        if (!wrapper) return;
        
        const originalWidth = parseFloat(wrapper.dataset.originalWidth);
        if (!originalWidth) return;

        const targetWidth = len * cellSize;
        // 稍微缩小一点点 (0.95) 以留出间隙，避免视觉上过于拥挤
        const scale = (targetWidth / originalWidth) * 0.95;
        
        wrapper.style.transform = `scale(${scale})`;
    }

    // 装备区里的舰船不按棋盘格尺寸渲染，而是铺满容器宽度，避免细节缩成一道暗影
    function getDockCellSize() {
        const dock = document.getElementById('dock');
        const inner = dock ? dock.clientWidth - 24 : 0;
        if (!inner) return getCellSize();
        const maxLen = SHIP_TYPES.reduce((m, t) => Math.max(m, t.len), 1);
        const byWidth = (inner * 0.62) / (maxLen * 0.95);
        return Math.max(getCellSize(), Math.min(byWidth, getCellSize() * 2));
    }

    function updateShipVisuals(ship, isDragging = false) {
        const cellSize = (ship.inDock && !isDragging) ? getDockCellSize() : getCellSize();
        const widthPx = (ship.len * cellSize) + 'px';
        const heightPx = cellSize + 'px';

        ship.el.style.setProperty('--w', widthPx);
        ship.el.style.setProperty('--h', heightPx);

        // 动态计算缩放
        updateShipScale(ship.el, ship.len, cellSize);

        const showVertical = ship.vertical && (!ship.inDock || isDragging);

        if(showVertical) {
            ship.el.classList.add('vertical');
            ship.el.style.width = cellSize + 'px';
            ship.el.style.height = widthPx;
        } else {
            ship.el.classList.remove('vertical');
            ship.el.style.width = widthPx;
            ship.el.style.height = cellSize + 'px';
        }
        
        // 如果已经在棋盘上，需要更新位置
        if (!ship.inDock && !isDragging) {
            ship.el.style.left = (ship.c * cellSize) + 'px';
            ship.el.style.top = (ship.r * cellSize) + 'px';
        }
    }

    function toggleDeployMode() {
        currentDeployMode = currentDeployMode === 'horizontal' ? 'vertical' : 'horizontal';
        const btn = document.getElementById('rotate-toggle');
        btn.innerText = currentDeployMode === 'horizontal' ? "部署方向:水平⮕" : "部署方向:垂直⬇";
        
        myShips.forEach(ship => {
            if(ship.inDock) {
                ship.vertical = (currentDeployMode === 'vertical');
            }
        });
    }

    function toggleFirstTurn() {
        firstTurn = firstTurn === 'PLAYER' ? 'AI' : 'PLAYER';
        const text = firstTurn === 'PLAYER' ? "先手：玩家" : "先手：电脑";
        
        const btn = document.getElementById('first-turn-toggle');
        if (btn) btn.innerText = text;
        
        const mBtn = document.getElementById('mobile-first-turn');
        if (mBtn) mBtn.innerText = text;
    }

    function toggleAiDebug() {
        showAiDebug = !showAiDebug;
        const text = showAiDebug ? "AI 视角：开启" : "AI 视角：关闭";

        const btn = document.getElementById('btn-debug');
        if (btn) {
            btn.innerText = text;
            btn.classList.toggle('is-on', showAiDebug);
        }

        const mBtn = document.getElementById('mobile-debug');
        if (mBtn) {
            mBtn.innerText = text;
            mBtn.classList.toggle('is-on', showAiDebug);
        }
        
        if (showAiDebug) {
            updateAiHeatmapVisuals();
        } else {
            clearAiHeatmapVisuals();
        }
    }

    function updateAiHeatmapVisuals(precomputedMap = null) {
        if (!showAiDebug) return;
        // 概率图即使在准备阶段也可查看，便于调试
        const viewGrid = getAiViewGrid();
        const targets = myShips.filter(s => !s.sunk);
        const probabilityMap = precomputedMap || (targets.length > 0 ? calculateProbabilityGrid(viewGrid, targets, AI_PROB_CONFIG, getPlayerModel().placementPrior, getAiAreaContact()) : Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0)));

        const pGrid = document.getElementById('player-grid');
        for(let r=0; r<BOARD_SIZE; r++) {
            for(let c=0; c<BOARD_SIZE; c++) {
                const cell = pGrid.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
                const val = probabilityMap[r][c] || 0;
                cell.classList.remove('debug-heat');
                cell.removeAttribute('data-heat');
                cell.style.removeProperty('--heat-bg');

                const ratio = Math.min(1, Math.max(0, val));
                if (ratio > 0) {
                    cell.setAttribute('data-heat', `${(ratio * 100).toFixed(1)}%`);
                    cell.classList.add('debug-heat');
                    const alpha = 0.1 + (ratio * 0.6);
                    const rVal = Math.floor(255 * ratio);
                    const bVal = Math.floor(255 * (1 - ratio));
                    cell.style.setProperty('--heat-bg', `rgba(${rVal}, 0, ${bVal}, ${alpha})`);
                }
            }
        }
    }

    function clearAiHeatmapVisuals() {
        const pGrid = document.getElementById('player-grid');
        pGrid.querySelectorAll('.debug-heat').forEach(el => {
            el.classList.remove('debug-heat');
            el.removeAttribute('data-heat');
            el.style.removeProperty('--heat-bg');
        });
    }

    // === 拖拽逻辑 ===
    let dragTarget = null;
    let dragOffset = {x:0, y:0};
    let isDragging = false;
    let currentPreview = null;

    // 统一处理坐标提取
    function getEventPos(e) {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }

    function onShipTouchStart(e, ship) {
        if (e.touches.length > 1) return;
        // 阻止默认行为以防止滚动，但要注意这可能会影响页面其他交互
        // 在 ship 上阻止默认行为通常是安全的
        if (e.cancelable) e.preventDefault();
        
        // 复用 MouseDown 逻辑，构造一个伪事件对象
        const pos = getEventPos(e);
        const fakeEvent = {
            button: 0,
            preventDefault: () => {},
            clientX: pos.x,
            clientY: pos.y,
            target: e.target
        };
        onShipMouseDown(fakeEvent, ship);
    }

    function onShipMouseDown(e, ship) {
        if (gameState !== 'SETUP') return;
        if (e.button !== 0) return; 
        e.preventDefault();

        dragTarget = ship;
        isDragging = false; 
        currentPreview = null;

        const rect = ship.el.getBoundingClientRect();
        // 记录相对抓取位置：出坞时船会缩回棋盘尺寸，按比例换算才能贴着指针
        const grabX = (e.clientX - rect.left) / rect.width;
        const grabY = (e.clientY - rect.top) / rect.height;

        ship.el.classList.add('dragging');
        
        const isPortExit = ship.inDock && currentDeployMode === 'vertical';

        if (ship.inDock) ship.vertical = (currentDeployMode === 'vertical');
        updateShipVisuals(ship, true);

        const zoomed = ship.el.getBoundingClientRect();

        if (isPortExit) {
            // 出坞时船体旋转 90°：长度方向的抓取比例映射到纵向
            dragOffset.x = grabY * zoomed.width;
            dragOffset.y = grabX * zoomed.height;
        } else {
            dragOffset.x = grabX * zoomed.width;
            dragOffset.y = grabY * zoomed.height;
        }

        ship.el.style.left = (e.clientX - dragOffset.x) + 'px';
        ship.el.style.top = (e.clientY - dragOffset.y) + 'px';
        
        document.body.appendChild(ship.el);
        if (!ship.inDock) clearGrid(ship);
    }

    function onGlobalTouchMove(e) {
        if (!dragTarget) return;
        if (e.cancelable) e.preventDefault(); // 防止拖拽时滚动页面
        const pos = getEventPos(e);
        const fakeEvent = {
            clientX: pos.x,
            clientY: pos.y
        };
        onGlobalMouseMove(fakeEvent);
    }

    function onGlobalMouseMove(e) {
        if (!dragTarget) return;
        isDragging = true;
        const ship = dragTarget;
        ship.el.style.left = (e.clientX - dragOffset.x) + 'px';
        ship.el.style.top = (e.clientY - dragOffset.y) + 'px';

        clearHighlights();
        
        // 移动端兼容：elementFromPoint
        const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
        if (!elemBelow) { currentPreview = null; return; }

        const cell = elemBelow.closest('.cell');
        const pGrid = document.getElementById('player-grid');
        const cellSize = getCellSize(); // 动态获取

        if (cell && pGrid.contains(cell)) {
            const gridRect = pGrid.getBoundingClientRect();
            const shipLeft = e.clientX - dragOffset.x;
            const shipTop = e.clientY - dragOffset.y;
            
            const relX = shipLeft - gridRect.left + (cellSize/2);
            const relY = shipTop - gridRect.top + (cellSize/2);
            
            const c = Math.floor(relX / cellSize);
            const r = Math.floor(relY / cellSize);
            
            previewPlacement(ship, r, c);
        } else {
            currentPreview = null;
        }
    }

    function onGlobalTouchEnd(e) {
        if (!dragTarget) return;
        const pos = getEventPos(e);
        const fakeEvent = {
            clientX: pos.x,
            clientY: pos.y
        };
        onGlobalMouseUp(fakeEvent);
    }

    function onGlobalMouseUp(e) {
        if (!dragTarget) return;
        const ship = dragTarget;
        ship.el.classList.remove('dragging');
        const pGrid = document.getElementById('player-grid');
        const gridRect = pGrid.getBoundingClientRect();
        const cellSize = getCellSize(); // 动态获取

        const isOverGrid = (
            e.clientX >= gridRect.left && e.clientX <= gridRect.right &&
            e.clientY >= gridRect.top && e.clientY <= gridRect.bottom
        );

        const previewPlacementInfo = (currentPreview && currentPreview.shipId === ship.id) ? currentPreview : null;

        clearHighlights();
        currentPreview = null;

        let placed = false;

        if (previewPlacementInfo && isValidPos(previewPlacementInfo.r, previewPlacementInfo.c, ship.len, previewPlacementInfo.vertical, null)) {
            placeShip(ship, previewPlacementInfo.r, previewPlacementInfo.c, previewPlacementInfo.vertical);
            placed = true;
        } else if (isOverGrid) {
            const shipLeft = e.clientX - dragOffset.x;
            const shipTop = e.clientY - dragOffset.y;
            const relX = shipLeft - gridRect.left + (cellSize/2);
            const relY = shipTop - gridRect.top + (cellSize/2);
            const c = Math.floor(relX / cellSize);
            const r = Math.floor(relY / cellSize);
            if (isValidPos(r, c, ship.len, ship.vertical, null)) {
                placeShip(ship, r, c, ship.vertical);
                placed = true;
            }
        }

        if (!placed) {
            returnToDock(ship);
            if(isOverGrid) log("无效位置：重叠或越界", "c-warn");
        }

        dragTarget = null;
        setTimeout(() => isDragging = false, 50);
        checkReady();
    }

    function previewPlacement(ship, r, c) {
        const len = ship.len;
        const vertical = ship.vertical;
        const isValid = isValidPos(r, c, len, vertical, null);
        const className = isValid ? 'highlight-valid' : 'highlight-invalid';
        let covered = false;
        for(let i=0; i<len; i++) {
            const nr = vertical ? r + i : r;
            const nc = vertical ? c : c + i;
            const cell = document.querySelector(`#player-grid .cell[data-r="${nr}"][data-c="${nc}"]`);
            if(cell) {
                cell.classList.add(className);
                covered = true;
            }
        }

        if (isValid && covered) {
            currentPreview = { shipId: ship.id, r, c, vertical };
        } else {
            currentPreview = null;
        }
    }

    function clearHighlights() {
        document.querySelectorAll('.highlight-valid, .highlight-invalid').forEach(el => {
            el.classList.remove('highlight-valid');
            el.classList.remove('highlight-invalid');
        });
    }

    function placeShip(ship, r, c, isVertical) {
        const pGrid = document.getElementById('player-grid');
        const cellSize = getCellSize(); // 动态获取
        ship.inDock = false;
        ship.r = r; ship.c = c;
        ship.vertical = isVertical;

        // 1. 暂时禁用 transition，防止从 body -> grid 的坐标系变换产生飞入动画
        ship.el.style.transition = 'none';

        ship.el.style.position = 'absolute';
        ship.el.style.margin = '0';
        pGrid.appendChild(ship.el);

        updateShipVisuals(ship);

        ship.el.style.left = (c * cellSize) + 'px';
        ship.el.style.top = (r * cellSize) + 'px';
        
        // 2. 强制浏览器重绘，确保新位置立即生效且无动画
        void ship.el.offsetWidth;

        // 3. 恢复 transition (清除内联样式，回退到 CSS 类定义的 transition)
        ship.el.style.transition = ''; 

        markGrid(ship, 1);
    }

    function returnToDock(ship) {
        const dock = document.getElementById('dock');
        
        // 同样防止回港时的飞入动画
        ship.el.style.transition = 'none';

        ship.inDock = true;
        ship.r = -1; ship.c = -1;
        
        // Fix 1: 重置时强制清除沉没状态
        ship.sunk = false;
        ship.hp = Array(ship.len).fill(ship.maxHp);
        ship.el.classList.remove('sunk');
        
        ship.vertical = (currentDeployMode === 'vertical');
        
        ship.el.style.position = 'relative';
        ship.el.style.left = 'auto';
        ship.el.style.top = 'auto';
        ship.el.style.margin = '0';
        
        updateShipVisuals(ship);
        dock.appendChild(ship.el);

        // 强制重绘并恢复
        void ship.el.offsetWidth;
        ship.el.style.transition = '';
    }

    function rotateShipOnBoard(ship) {
        const newV = !ship.vertical;
        clearGrid(ship);
        if (isValidPos(ship.r, ship.c, ship.len, newV, null)) {
            placeShip(ship, ship.r, ship.c, newV);
        } else {
            markGrid(ship, 1);
            shake(ship.el);
            log("旋转空间不足", "c-warn");
        }
    }

    function shake(el) {
        el.classList.remove('shake');
        void el.offsetWidth;
        el.classList.add('shake');
    }

    function isValidPos(r, c, len, vertical, ignore) {
        if (r < 0 || c < 0) return false;
        if (vertical) {
            if (r + len > BOARD_SIZE || c >= BOARD_SIZE) return false;
        } else {
            if (c + len > BOARD_SIZE || r >= BOARD_SIZE) return false;
        }
        for(let i=0; i<len; i++) {
            let nr = vertical ? r+i : r;
            let nc = vertical ? c : c+i;
            if (myGridMap[nr][nc] === 1) return false;
        }
        return true;
    }

    function markGrid(ship, val) {
        for(let i=0; i<ship.len; i++) {
            let nr = ship.vertical ? ship.r+i : ship.r;
            let nc = ship.vertical ? ship.c : ship.c+i;
            if(nr < BOARD_SIZE && nc < BOARD_SIZE) myGridMap[nr][nc] = val;
        }
    }
    function clearGrid(ship) { markGrid(ship, 0); }

    // === 按钮功能 ===
    function resetToDock() {
        closeGameOverModal();
        myGridMap = createEmptyGrid();
        myShips.forEach(s => returnToDock(s));
        // 清理对象已不存在但 DOM 还留在棋盘上的残留模型
        document.querySelectorAll('#player-grid > .ship').forEach(el => el.remove());
        checkReady();
    }

    let autoDeployTimer = null;

    function autoDeploy() {
        if (autoDeployTimer) clearTimeout(autoDeployTimer);
        resetToDock();
        autoDeployTimer = setTimeout(() => {
            autoDeployTimer = null;
            // 使用 AI 部署模块生成稀疏分布的船只配置
            const placements = aiDeployShips(SHIP_TYPES, BOARD_SIZE);
            
            // 根据生成的配置放置玩家船只
            placements.forEach(placement => {
                // 通过 code 匹配对应的玩家船只对象
                const ship = myShips.find(s => s.code === placement.code);
                if (ship) {
                    placeShip(ship, placement.r, placement.c, placement.v);
                }
            });
            
            checkReady();
        }, 50);
    }

    function checkReady() {
        const allReady = myShips.every(s => !s.inDock);
        const btn = document.getElementById('start-btn');
        const mbBtn = document.getElementById('mb-btn-start');
        
        if (gameState === 'SETUP') {
            btn.disabled = !allReady;
            if(mbBtn) mbBtn.disabled = !allReady;
            
            if(allReady) {
                btn.className = "btn-orange";
            } else {
                btn.disabled = true;
            }
        }
    }

    function handleStartOrRestart() {
        const btn = document.getElementById('start-btn');
        if (gameState === 'PLAYING' || gameState === 'END') {
            if(confirm("确定要结束当前战斗并重新开始吗？")) {
                resetGameFull();
            }
        } else {
            startGame();
        }
    }

    function resetGameFull() {
        closeGameOverModal();
        document.body.classList.remove('game-playing'); // 移除战斗状态类
        clearAiTurnTimeout();
        abandonMatch();
        currentWinner = null;
        gameState = 'SETUP';
        resetBattleStats();
        setTurnIndicator(null);
        document.getElementById('dock').style.display = 'flex';
        document.getElementById('battle-panel').style.display = 'none';
        
        // 切换移动端底部栏
        const mbDeploy = document.getElementById('mb-deploy-group');
        const mbCombat = document.getElementById('mb-combat-group');
        if(mbDeploy) mbDeploy.style.display = 'flex';
        if(mbCombat) mbCombat.style.display = 'none';
        
        document.getElementById('dock').style.pointerEvents = 'auto';
        document.getElementById('dock').style.opacity = 1;
        
        // Enable controls
        const controls = [
            'rotate-toggle', 'first-turn-toggle', 'btn-debug', 'btn-reset', 'btn-random',
            'mobile-first-turn', 'mobile-debug', 'mobile-reset',
            'mobile-menu-random', 'mobile-menu-reset'
        ];
        controls.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.disabled = false;
        });

        const btn = document.getElementById('start-btn');
        btn.innerText = "开始战斗";
        btn.className = "btn-orange";
        btn.disabled = true;        
        const mbBtn = document.getElementById('mb-btn-start');
        if(mbBtn) mbBtn.disabled = true;

        initGrids();
        document.getElementById('enemy-grid').style.pointerEvents = 'none';
        myGridMap = createEmptyGrid();
        resetToDock();
        document.getElementById('log').innerHTML = '<div class="log-line c-sys">游戏已重置。</div>';
        
        // 重置时切回我方视角以便部署
        switchMobileView('player');
    }

    function startGame() {
        document.body.classList.add('game-playing'); // 添加战斗状态类，用于 CSS 控制武器栏显示
        clearAiTurnTimeout();
        currentWinner = null;
        gameState = 'PLAYING';
        document.getElementById('dock').style.display = 'none';
        document.getElementById('battle-panel').style.display = 'flex';
        
        // 切换移动端底部栏
        const mbDeploy = document.getElementById('mb-deploy-group');
        const mbCombat = document.getElementById('mb-combat-group');
        if(mbDeploy) mbDeploy.style.display = 'none';
        if(mbCombat) mbCombat.style.display = 'flex';
        
        // Disable setup controls
        const disableList = [
            'rotate-toggle', 'first-turn-toggle', 'btn-reset', 'btn-random',
            'mobile-first-turn', 'mobile-reset',
            'mobile-menu-random', 'mobile-menu-reset'
        ];
        disableList.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.disabled = true;
        });
        
        // Debug remains active
        
        myShips.forEach(s => s.el.style.cursor = 'default');
        
        const btn = document.getElementById('start-btn');
        btn.innerText = "重新开始";
        btn.className = "btn-restart";

        resetAIState(); // 重置 AI 内部状态（伤害记录等）
        resetAiWorker();
        if (enemyFactionRandom) {
            enemyFaction = pickRandomEnemyFaction(playerFaction);
            updateDoctrineReadout();
        }
        initEnemy();
        resetBattleStats();
        beginMatch({
            playerFaction,
            enemyFaction,
            level: currentDifficulty,
            ...(neuralPreview ? { aiPolicy: policyMetadata } : {}),
            firstTurn: firstTurn === 'PLAYER' ? 'player' : 'ai',
            playerShips: myShips,
            playerHE: getHEProfile(playerFaction, myShips),
            aiHE: getHEProfile(enemyFaction, enemyShips)
        });
        updateStatus();
        selectWeapon('AP');
        aiStack = [];
        sfx.play('click');
        setTurnIndicator(firstTurn === 'PLAYER' ? 'player' : 'ai');
        log(`「${FACTIONS[playerFaction].name}」对阵「${FACTIONS[enemyFaction].name}」！`, 'c-sys');
        log(`我方学说：${getDoctrine(playerFaction).name}；敌方学说：${getDoctrine(enemyFaction).name}`, 'c-sys');

        if (firstTurn === 'PLAYER') {
            log("战斗开始！玩家先手，点击敌方海域开火。", "c-warn");
            document.getElementById('enemy-grid').style.pointerEvents = 'auto';
            switchMobileView('enemy'); // 自动切到敌方视角
        } else {
            log("战斗开始！电脑先手。", "c-warn");
            document.getElementById('enemy-grid').style.pointerEvents = 'none';
            switchMobileView('player'); // 自动切到我方视角
            // AI 先手时的初始延迟，使用 AI_ACTION_DELAY 即可
            scheduleAiTurn(getTiming().AI_ACTION_DELAY); 
        }
    }

    // === 敌方与AI ===
    function initEnemy() {
        // 1. 清理敌方网格 UI (修复重叠问题)
        const eGrid = document.getElementById('enemy-grid');
        eGrid.querySelectorAll('.wreck').forEach(el => el.remove());
        eGrid.querySelectorAll('.revealed-enemy-ship').forEach(el => el.remove()); // 清理显示的敌舰
        eGrid.querySelectorAll('.cell').forEach(cell => {
            cell.className = 'cell';
            // 移除可能存在的内部标记
            while(cell.firstChild) cell.removeChild(cell.firstChild);
        });

        // 2. 使用 AI 部署模块生成船只配置（稀疏分布策略，轻度避开玩家历史搜索热区）
        const placements = aiDeployShips(SHIP_TYPES, BOARD_SIZE, {
            attention: getPlayerModel().shotAttention
        });
        
        // 3. 初始化数据
        enemyShips = [];
        enemyGridMap = createEmptyGrid().map(row => row.map(c => ({hit:false, shipId:-1, segmentIndex: -1})));
        
        placements.forEach((placement, idx) => {
            const { r, c, v, len, name, maxHp, code } = placement;
            
            // 标记网格占用
            for (let i = 0; i < len; i++) {
                const nr = v ? r + i : r;
                const nc = v ? c : c + i;
                enemyGridMap[nr][nc].shipId = idx;
                enemyGridMap[nr][nc].segmentIndex = i;
            }
            
            // 创建船只对象
            enemyShips.push({ 
                id: idx, 
                name, 
                len, 
                maxHp,
                code,
                hp: Array(len).fill(maxHp),
                sunk: false,
                r, c, v,
                vertical: v
            });
        });
    }

    function selectWeapon(type) {
        currentWeapon = type;
        document.querySelectorAll('.weapon-btn').forEach(btn => btn.classList.remove('active'));
        const btnId = type === 'AP' ? 'btn-ap' : (type === 'HE' ? 'btn-he' : 'btn-sonar');
        document.getElementById(btnId).classList.add('active');

        // 更新移动端武器按钮显示
        const mbName = document.getElementById('mb-weapon-name');
        const mbIcon = document.getElementById('mb-weapon-icon');
        if (mbName && mbIcon) {
            if (type === 'AP') { mbName.innerText = '主炮'; mbIcon.innerText = 'AP'; }
            else if (type === 'HE') { mbName.innerText = '空袭'; mbIcon.innerText = 'AIR'; }
            else if (type === 'SONAR') { mbName.innerText = '水听'; mbIcon.innerText = 'SNR'; }
        }
    }

    function updateWeaponStates() {
        const ddAlive = myShips.some(s => s.code === 'DD' && !s.sunk);
        const ssAlive = myShips.some(s => s.code === 'SS' && !s.sunk);
        const heProfile = getHEProfile(playerFaction, myShips);
        const sonarProfile = getSonarProfile(playerFaction);
        
        const enableHE = heProfile.available;
        const enableSonar = ddAlive || ssAlive;
        
        document.getElementById('btn-he').disabled = !enableHE;
        document.getElementById('btn-sonar').disabled = !enableSonar;
        
        if (currentWeapon === 'HE' && !enableHE) selectWeapon('AP');
        if (currentWeapon === 'SONAR' && !enableSonar) selectWeapon('AP');

        // 更新武器栏数值（学说会改变伤害/范围/航母依赖）
        const dmg = getAPDamage();
        const doctrine = getDoctrine(playerFaction);
        const maxPenetrations = getAPMaxPenetrations(playerFaction, myShips);
        const descEl = document.getElementById('ap-desc');
        if (descEl) {
            const notes = [];
            if (doctrine.ap?.suspectBonus) notes.push('疑似 +1');
            if (doctrine.ap?.sunkBonus) notes.push('击沉 +1');
            if (doctrine.ap?.quadTurrets) {
                notes.push(myShips.some(s => s.code === 'BB' && !s.sunk) ? '四联' : '核心损失');
            }
            if (maxPenetrations > 1) notes.push(`连穿 ${maxPenetrations} 舱`);
            if (doctrine.ap?.damagePenalty) notes.push('主炮 -1');
            if (doctrine.ap?.cvBonus) {
                notes.push(myShips.some(s => s.code === 'CV' && !s.sunk)
                    ? `CV +${doctrine.ap.cvBonus}`
                    : '无 CV');
            }
            descEl.innerText = maxPenetrations > 1 ? `${dmg}伤 连穿` : `${dmg}伤 穿甲`;
            const apFull = `单点 ${dmg} 伤，穿甲${notes.length ? `（${notes.join('，')}）` : ''}`;
            descEl.title = apFull;
            const apBtn = document.getElementById('btn-ap');
            if (apBtn) apBtn.title = apFull;
        }
        const heEl = document.getElementById('he-desc');
        if (heEl) {
            heEl.innerText = heProfile.compact;
            heEl.title = heProfile.meta;
            const heBtn = document.getElementById('btn-he');
            if (heBtn) heBtn.title = enableHE ? heProfile.meta : '需要航母存活才能发动空袭';
        }
        const sonarEl = document.getElementById('sonar-desc');
        if (sonarEl) {
            const mode = sonarProfile.reveal === 'nearest' ? '，接触标定' : '';
            sonarEl.innerText = `侦查 ${sonarProfile.label}${mode}`;
            const sonarBtn = document.getElementById('btn-sonar');
            if (sonarBtn) {
                sonarBtn.title = enableSonar
                    ? `水听 ${sonarProfile.label}${mode}`
                    : '需要驱逐舰或潜艇存活才能使用水听';
            }
        }
    }

    function getAPDamage() {
        return getFactionAPDamage(playerFaction, myShips);
    }

    function updateStatus() {
        const list = document.getElementById('ship-status-list');
        list.innerHTML = '';
        myShips.forEach(ship => {
            const row = document.createElement('div');
            row.className = 'ship-status-row';
            
            const name = document.createElement('span');
            name.innerText = ship.name;
            if (ship.sunk) {
                name.style.textDecoration = 'line-through';
                name.style.color = '#fc8181';
            }
            
            const hpContainer = document.createElement('div');
            hpContainer.className = 'hp-blocks';
            
            ship.hp.forEach(hp => {
                const block = document.createElement('div');
                block.className = 'hp-block';
                if (hp <= 0) block.classList.add('lost');
                else if (hp < ship.maxHp) block.classList.add('dmg');
                hpContainer.appendChild(block);
            });
            
            row.appendChild(name);
            row.appendChild(hpContainer);
            list.appendChild(row);
        });
        
        const enemyAlive = enemyShips.filter(s => !s.sunk).length;
        const remainEl = document.getElementById('enemy-remaining');
        if (remainEl) {
            remainEl.innerText = `存活 ${enemyAlive}`;
            remainEl.classList.toggle('last', enemyAlive === 1);
        }
        
        updateWeaponStates();
    }

    function clickEnemy(r, c) {
        if (gameState !== 'PLAYING') return;
        if (document.getElementById('enemy-grid').style.pointerEvents === 'none') return;

        // === 新路径：完全使用武器系统 ===
        if (weaponService) {
            weaponService.setCurrentWeapon(currentWeapon);
            const context = buildPlayerWeaponContext();
            const viewBefore = getPlayerViewGrid();
            const previewEvent = neuralPreview ? captureDecisionEvent('player', { weapon: currentWeapon, r, c },
                viewBefore, myShips, enemyShips, playerFaction, enemyFaction) : null;
            const result = weaponService.executePlayerAction({ r, c }, context);
            
            if (!result.success) {
                // 已处理格（沉船/已确认空海域）不能重复打击：原地抖动 + 说明，不消耗回合
                const cell = document.querySelector(`#enemy-grid .cell[data-r="${r}"][data-c="${c}"]`);
                if (cell) {
                    cell.classList.remove('shake');
                    void cell.offsetWidth;
                    cell.classList.add('shake');
                    setTimeout(() => cell.classList.remove('shake'), 500);
                    if (battleRenderer) {
                        battleRenderer.spawnFloat(
                            'ENEMY', r, c,
                            cell.classList.contains('destroyed') ? '已毁' : '×',
                            'fx-float'
                        );
                    }
                }
                const reason = result.reason === '目标无效'
                    ? (cell && cell.classList.contains('destroyed')
                        ? '该舱室已被摧毁，无法重复打击。'
                        : '该海域已确认无目标，换一格试试。')
                    : result.reason;
                log(reason, 'c-sys');
                return;
            }

            recordStats(result.events, true, currentWeapon);
            if (previewEvent) completeDecisionEvent(previewEvent, getPlayerViewGrid());
            recordAction({
                seat: 'player',
                weapon: currentWeapon,
                r,
                c,
                view: viewBefore,
                damage: damageFromEvents(result.events),
                sunk: sunkCodesFromIds(result.shipsSunk, enemyShips),
                shape: getHEProfile(playerFaction, myShips).shape,
                radius: getSonarProfile(playerFaction).radius
            });

            // 检查胜负（仅对攻击类武器，声纳不会击沉船只）
            if (currentWeapon !== 'SONAR' && result.shipsSunk && result.shipsSunk.length > 0) {
                checkWin("玩家");
            }
        }

        updateStatus();
        tickEndgameHunt('player');
        document.getElementById('enemy-grid').style.pointerEvents = 'none';
        if (gameState === 'PLAYING') {
            setTurnIndicator('ai');
            const timing = getTiming();
            // 玩家回合结束，根据配置延迟切换视角
            if (timing.VIEW_SWITCH_DELAY > 0) {
                setTimeout(() => {
                    if(gameState === 'PLAYING') switchMobileView('player');
                }, timing.VIEW_SWITCH_DELAY);
            }
            // 空袭编队/声呐圈还在播时不要让 AI 抢主线程，否则动画会卡在计算上
            const fxDelay = currentWeapon === 'HE' ? 1450 : (currentWeapon === 'SONAR' ? 1000 : 0);
            scheduleAiTurn(Math.max(timing.AI_ACTION_DELAY, fxDelay));
        }
    }

    // === AI 智能系统：概率推断 ===

    let AI_PROB_CONFIG = { ...DIFFICULTY_SETTINGS[DEFAULT_DIFFICULTY] };
    let currentDifficulty = DEFAULT_DIFFICULTY;

    function setDifficulty(level, options = {}) {
        const { silent = false } = options;
        currentDifficulty = level;
        AI_PROB_CONFIG = { ...DIFFICULTY_SETTINGS[level], level };
        
        // 更新所有难度按钮状态 (包括桌面端和移动端设置菜单)
        document.querySelectorAll('.diff-btn').forEach(btn => {
            if (btn.dataset.difficulty === level) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        if (!silent) {
            const label = level === 'EASY' ? '新兵 (简单)' : (level === 'NORMAL' ? '舰长 (中等)' : '提督 (困难)');
            log(`AI 难度已调整为: ${label}`, "c-sys");
        }
    }

    function clearAiTurnTimeout() {
        aiTurnToken++;
        if (aiTurnTimeout !== null) {
            clearTimeout(aiTurnTimeout);
            aiTurnTimeout = null;
        }
    }

    function getAiWorker() {
        if (aiWorker) return aiWorker;
        try {
            aiWorker = new AiDecisionWorker();
            aiWorker.onmessage = (event) => {
                const { id, decision, elapsedMs } = event.data || {};
                if (import.meta.env?.MODE === 'ai-lab' || neuralPreview) console.debug('AI 实验线程耗时（毫秒）', elapsedMs);
                const resolve = pendingAiDecisions.get(id);
                if (resolve) {
                    pendingAiDecisions.delete(id);
                    resolve(decision);
                }
            };
            aiWorker.onerror = () => {
                aiWorker = null;
                for (const resolve of pendingAiDecisions.values()) resolve(null);
                pendingAiDecisions.clear();
            };
        } catch (err) {
            aiWorker = null;
        }
        return aiWorker;
    }

    function requestAiDecision(context) {
        const worker = getAiWorker();
        if (!worker) return Promise.resolve(null);
        const id = ++aiDecisionSeq;
        return new Promise(resolve => {
            pendingAiDecisions.set(id, resolve);
            worker.postMessage({ type: 'decide', id, context });
        });
    }

    function resetAiWorker() {
        if (aiWorker) aiWorker.postMessage({ type: 'reset' });
    }

    /** AI 的区域接触观测只在玩家仅剩 1 艘舰时有效 */
    function getAiAreaContact() {
        if (!aiAreaContact) return null;
        const alive = myShips.filter(s => !s.sunk);
        if (alive.length !== 1) return null;
        if (aiAreaContact.shipId != null && aiAreaContact.shipId !== alive[0].id) return null;
        return aiAreaContact;
    }

    /** 决策上下文：只含可结构化克隆的公开信息，AI 目标船不携带坐标 */
    function buildAiDecisionContext() {
        const viewGrid = getAiViewGrid();
        const playerViewGrid = getPlayerViewGrid();
        const aiTargets = myShips.map(s => ({
            id: s.id,
            code: s.code,
            len: s.len,
            maxHp: s.maxHp,
            sunk: s.sunk
        }));
        const aiOwnShips = enemyShips.map(s => ({
            id: s.id,
            code: s.code,
            len: s.len,
            maxHp: s.maxHp,
            hp: [...s.hp],
            sunk: s.sunk,
            r: s.r,
            c: s.c,
            vertical: s.v ?? s.vertical ?? false
        }));
        return {
            viewGrid,
            myShips: aiTargets,
            enemyShips: aiOwnShips,
            difficultyConfig: AI_PROB_CONFIG,
            playerViewGrid,
            ...decisionHistoryContext(viewGrid),
            placementPrior: getPlayerModel().placementPrior,
            areaContact: getAiAreaContact(),
            pursuit: { enabled: true, hunters: [{ ...endgameHunt.ai, areaContact: getAiAreaContact() }, { ...endgameHunt.player }] },
            aiFaction: enemyFaction,
            playerFaction
        };
    }

    function scheduleAiTurn(delay) {
        clearAiTurnTimeout();
        const token = ++aiTurnToken;
        const context = buildAiDecisionContext();
        // 立刻在 Worker 里算，等动画时间到了再落子；主线程全程只播特效
        const decisionPromise = requestAiDecision(context);
        aiTurnTimeout = setTimeout(async () => {
            aiTurnTimeout = null;
            let decision = await decisionPromise;
            if (token !== aiTurnToken || gameState !== 'PLAYING') return;
            if (!decision) decision = await makeAIDecisionAsync(context);
            if (token !== aiTurnToken || gameState !== 'PLAYING') return;
            aiTurn(decision);
        }, delay);
    }
    
    function clearLastEnemyAttacks() {
        const pGrid = document.getElementById('player-grid');
        pGrid.querySelectorAll('.last-enemy-attack').forEach(el => {
            el.classList.remove('last-enemy-attack');
        });
    }

    function aiTurn(decision) {
        if (gameState !== 'PLAYING') return;
        
        // 清除上一次的攻击标记
        clearLastEnemyAttacks();

        // 使用武器系统执行攻击
        if (weaponService) {
            const context = buildAIWeaponContext();
            const viewBefore = getAiViewGrid();
            const previewEvent = neuralPreview ? captureDecisionEvent('ai', decision, viewBefore,
                enemyShips, myShips, enemyFaction, playerFaction) : null;
            const result = weaponService.executeAIAction(decision, context);

            recordStats(result.events, false, decision.weapon);
            if (result.success) {
                if (previewEvent) completeDecisionEvent(previewEvent, getAiViewGrid());
                recordAction({
                    seat: 'ai',
                    weapon: decision.weapon,
                    r: decision.r,
                    c: decision.c,
                    view: viewBefore,
                    damage: damageFromEvents(result.events),
                    sunk: sunkCodesFromIds(result.shipsSunk, myShips),
                    shape: getHEProfile(enemyFaction, enemyShips).shape,
                    radius: getSonarProfile(enemyFaction).radius
                });
            }

            // 检查胜负（仅对攻击类武器）
            if (decision.weapon !== 'SONAR' && result.shipsSunk && result.shipsSunk.length > 0) {
                // AI 击沉玩家船只时，需要给对应的船添加 sunk 类
                for (const shipId of result.shipsSunk) {
                    const ship = myShips.find(s => s.id === shipId);
                    if (ship && ship.el) {
                        ship.el.classList.add('sunk');
                    }
                }
                checkWin("电脑");
            }
        }

        updateStatus();
        if (showAiDebug) updateAiHeatmapVisuals(); // 实时更新热力图
        tickEndgameHunt('ai');
        const enemyGridEl = document.getElementById('enemy-grid');
        if (gameState === 'PLAYING') {
            setTurnIndicator('player');
            enemyGridEl.style.pointerEvents = 'auto';
            // AI 回合结束，根据配置切回敌方视角
            const timing = getTiming();
            if (timing.TURN_BACK_DELAY > 0) {
                setTimeout(() => {
                    if(gameState === 'PLAYING') switchMobileView('enemy');
                }, timing.TURN_BACK_DELAY);
            }
        } else {
            enemyGridEl.style.pointerEvents = 'none';
        }
    }

    function getAiViewGrid() {
        // 0: Unknown, 1: Miss, 2: Hit, 3: Destroyed, 4: Suspect, 5: Sunk
        let grid = Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
        document.querySelectorAll('#player-grid .cell').forEach(cell => {
            const r = parseInt(cell.dataset.r);
            const c = parseInt(cell.dataset.c);
            if (cell.classList.contains('destroyed')) grid[r][c] = 3;
            else if (cell.classList.contains('hit')) grid[r][c] = 2;
            else if (cell.classList.contains('miss')) grid[r][c] = 1;
            else if (cell.classList.contains('ai-detect')) grid[r][c] = 4;
        });

        // 追击阶段的侦察接触只进入 AI 认知，不在玩家棋盘上伪装成受损
        for (const key of aiReconCells) {
            const [r, c] = key.split(',').map(Number);
            if (grid[r][c] === 0 || grid[r][c] === 4) grid[r][c] = 4;
        }

        // 标记已沉没船只的位置为 5 (Sunk)，视为不可穿越的障碍
        myShips.forEach(s => {
            if (s.sunk) {
                for(let i=0; i<s.len; i++) {
                    let nr = s.vertical ? s.r+i : s.r;
                    let nc = s.vertical ? s.c : s.c+i;
                    if(nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) grid[nr][nc] = 5;
                }
            }
        });

        return grid;
    }

    /**
     * 获取玩家视角的 AI 棋盘状态
     * （与 getAiViewGrid 对称，用于 AI 对称推演）
     * 
     * @returns {number[][]} BOARD_SIZE x BOARD_SIZE 数组
     *   0=未知, 1=miss, 2=hit, 3=destroyed, 4=suspect, 5=sunk
     */
    function getPlayerViewGrid() {
        const grid = Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
        
        document.querySelectorAll('#enemy-grid .cell').forEach(cell => {
            const r = parseInt(cell.dataset.r);
            const c = parseInt(cell.dataset.c);
            if (cell.classList.contains('destroyed')) grid[r][c] = 3;
            else if (cell.classList.contains('hit')) grid[r][c] = 2;
            else if (cell.classList.contains('miss')) grid[r][c] = 1;
            else if (cell.classList.contains('suspect') || cell.classList.contains('detect')) grid[r][c] = 4;
        });
        
        // 标记已沉没的 AI 船只
        enemyShips.forEach(s => {
            if (s.sunk) {
                for (let i = 0; i < s.len; i++) {
                    const nr = s.vertical ? s.r + i : s.r;
                    const nc = s.vertical ? s.c : s.c + i;
                    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                        grid[nr][nc] = 5;
                    }
                }
            }
        });
        
        return grid;
    }

    /** 该格是否已在猎杀方的认知中（命中/击沉/未命中，无需再标定） */
    function isLastShipCellKnown(hunter, r, c) {
        const gridId = hunter === 'player' ? 'enemy-grid' : 'player-grid';
        const cell = document.querySelector(`#${gridId} .cell[data-r="${r}"][data-c="${c}"]`);
        if (!cell) return true;
        return cell.classList.contains('hit')
            || cell.classList.contains('destroyed')
            || cell.classList.contains('miss');
    }

    function revealLastShipContact(hunter) {
        const fleet = hunter === 'player' ? enemyShips : myShips;
        const alive = fleet.filter(s => !s.sunk);
        if (alive.length !== 1) return;

        const last = alive[0];
        const vertical = last.v ?? last.vertical ?? false;
        const gridId = hunter === 'player' ? 'enemy-grid' : 'player-grid';

        // 只标定最后一个尚未受创的舱室，避免重复覆盖同一片海域
        for (let i = 0; i < last.len; i++) {
            if (last.hp[i] <= 0) continue;
            const r = vertical ? last.r + i : last.r;
            const c = vertical ? last.c : last.c + i;
            if (isLastShipCellKnown(hunter, r, c)) continue;

            const zone = [];
            const areaCells = [];
            for (let dr = -RECON_RADIUS; dr <= RECON_RADIUS; dr++) {
                for (let dc = -RECON_RADIUS; dc <= RECON_RADIUS; dc++) {
                    const nr = r + dr;
                    const nc = c + dc;
                    if (!isInBounds(nr, nc)) continue;
                    areaCells.push({ r: nr, c: nc });
                    const cell = document.querySelector(`#${gridId} .cell[data-r="${nr}"][data-c="${nc}"]`);
                    if (!cell) continue;
                    if (cell.classList.contains('hit')
                        || cell.classList.contains('destroyed')
                        || cell.classList.contains('miss')) continue;
                    if (hunter === 'player') {
                        if (cell.classList.contains('detect')) continue;
                    } else {
                        if (cell.classList.contains('ai-detect')) continue;
                        if (aiReconCells.has(`${nr},${nc}`)) continue;
                        aiReconCells.add(`${nr},${nc}`);
                    }
                    zone.push({ r: nr, c: nc });
                }
            }

            if (hunter === 'ai' && areaCells.length > 0) {
                aiAreaContact = { shipId: last.id, cells: areaCells };
            }

            if (zone.length > 0) {
                if (hunter === 'player') {
                    battleRenderer.render(zone.map(({ r: zr, c: zc }) => ({
                        type: EventType.CELL_UPDATE,
                        payload: { grid: 'ENEMY', r: zr, c: zc, state: 'SUSPECT' }
                    })));
                    sfx.play('detect');
                    log('侦察接触：最后敌舰所在海域已标出疑似接触区。', 'c-warn');
                } else {
                    log('敌方侦察机标出了我方最后舰艇所在的海域。', 'c-warn');
                }
            }
            return;
        }
    }

    function tickEndgameHunt(hunter) {
        if (gameState !== 'PLAYING') return;
        const fleet = hunter === 'player' ? enemyShips : myShips;
        if (fleet.filter(s => !s.sunk).length !== 1) {
            endgameHunt[hunter].turns = 0;
            endgameHunt[hunter].first = true;
            return;
        }
        endgameHunt[hunter].turns++;
        // 最后一艘暴露后的下个回合给出接触区，之后每 3 回合刷新
        const threshold = endgameHunt[hunter].first ? ENDGAME_FIRST_DELAY : ENDGAME_PING_INTERVAL;
        if (endgameHunt[hunter].turns < threshold) return;
        endgameHunt[hunter].turns = 0;
        endgameHunt[hunter].first = false;
        revealLastShipContact(hunter);
    }

    function checkWin(who) {
        if (currentWinner) return;
        const pDead = myShips.every(s => s.sunk);
        const eDead = enemyShips.every(s => s.sunk);
        if (!(pDead || eDead)) return;

        currentWinner = who;
        gameState = 'END';
        clearAiTurnTimeout();
        // 历史画像只在对局结束时学习，AI 对局中不读取隐藏信息
        recordCompletedMatch({
            ships: myShips.map(s => ({ len: s.len, r: s.r, c: s.c, v: s.v ?? s.vertical })),
            shotCells: [...playerShotCells]
        });
        finishMatch({
            result: who === '玩家' ? 'win' : 'loss',
            stats: battleStats,
            playerShips: myShips,
            enemyShips
        });
        updateMatchLogUi();
        const enemyGridEl = document.getElementById('enemy-grid');
        if (enemyGridEl) enemyGridEl.style.pointerEvents = 'none';
        revealEnemyShips(); // 游戏结束时显示敌方舰船
        const modal = document.getElementById('game-over-modal');
        const title = document.getElementById('game-over-title');
        const msg = document.getElementById('game-over-msg');
        
        if (who === '玩家') {
            title.innerText = "VICTORY";
            title.className = "game-over-title win-text";
            msg.innerText = "恭喜指挥官！敌方舰队已被全歼！";
        } else {
            title.innerText = "DEFEAT";
            title.className = "game-over-title lose-text";
            msg.innerText = "很遗憾，我方舰队已全军覆没...";
        }

        setTurnIndicator('end');
        sfx.play(who === '玩家' ? 'win' : 'lose');

        // 结算战报
        const statsEl = document.getElementById('game-over-stats');
        if (statsEl && battleStats) {
            const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) + '%' : '-';
            const sunkByMe = enemyShips.filter(s => s.sunk).length;
            const sunkByAi = myShips.filter(s => s.sunk).length;
            statsEl.innerHTML = `
                <div class="gos-row"><span>我方命中率</span><b>${pct(battleStats.player.hits, battleStats.player.shots)}</b></div>
                <div class="gos-row"><span>敌方命中率</span><b>${pct(battleStats.ai.hits, battleStats.ai.shots)}</b></div>
                <div class="gos-row"><span>我方输出</span><b>${battleStats.player.damage} 伤</b></div>
                <div class="gos-row"><span>敌方输出</span><b>${battleStats.ai.damage} 伤</b></div>
                <div class="gos-row"><span>击沉战果</span><b>${sunkByMe} / ${enemyShips.length}</b></div>
                <div class="gos-row"><span>最大连击</span><b>x${battleStats.maxStreak}</b></div>
                <div class="gos-row"><span>战斗回合</span><b>${battleStats.turns}</b></div>
                <div class="gos-row"><span>对局记录</span><b>已存 ${getMatchCount()} 局</b></div>`;
        }

        setTimeout(() => {
            if (gameState === 'END') modal.style.display = 'block';
        }, 500);
    }

    function revealEnemyShips() {
        enemyShips.forEach(ship => {
            revealSingleEnemyShip(ship);
        });
    }

    function revealSingleEnemyShip(ship) {
        const eGrid = document.getElementById('enemy-grid');
        const cellSize = getCellSize(); // 动态获取
        // 检查是否已显示，避免重复
        if (eGrid.querySelector(`.revealed-enemy-ship[data-id="${ship.id}"]`)) return;

        const shipEl = document.createElement('div');
        shipEl.className = `ship revealed-enemy-ship ship-visuals-root f-${enemyFaction}`;
        shipEl.dataset.id = ship.id;
        shipEl.style.position = 'absolute';
        shipEl.style.left = (ship.c * cellSize) + 'px';
        shipEl.style.top = (ship.r * cellSize) + 'px';
        shipEl.style.pointerEvents = 'none'; 
        // z-index 已在 CSS 中设为 1
        
        const inner = document.createElement('div');
        inner.className = 'ship-inner';
        inner.innerHTML = getShipDom(ship.code, enemyFaction);
        shipEl.appendChild(inner);

        const widthPx = (ship.len * cellSize) + 'px';
        const heightPx = cellSize + 'px';
        shipEl.style.setProperty('--w', widthPx);
        shipEl.style.setProperty('--h', heightPx);
        
        if (ship.v) {
            shipEl.classList.add('vertical');
            shipEl.style.width = cellSize + 'px';
            shipEl.style.height = widthPx;
        } else {
            shipEl.style.width = widthPx;
            shipEl.style.height = cellSize + 'px';
        }

        if (ship.sunk) {
            shipEl.classList.add('sunk');
        } else {
            shipEl.style.opacity = '0.9';
            shipEl.style.filter = 'drop-shadow(0 0 5px white)';
        }

        // 动态缩放
        updateShipScale(shipEl, ship.len, cellSize);

        eGrid.appendChild(shipEl);
    }

    // 新增：更新已显示敌舰的视觉（用于 resize）
    function updateRevealedShipVisuals(shipEl, ship) {
        const cellSize = getCellSize();
        const widthPx = (ship.len * cellSize) + 'px';
        const heightPx = cellSize + 'px';
        
        shipEl.style.left = (ship.c * cellSize) + 'px';
        shipEl.style.top = (ship.r * cellSize) + 'px';
        
        shipEl.style.setProperty('--w', widthPx);
        shipEl.style.setProperty('--h', heightPx);
        
        // 动态缩放
        updateShipScale(shipEl, ship.len, cellSize);
        
        if (ship.v) {
            shipEl.style.width = cellSize + 'px';
            shipEl.style.height = widthPx;
        } else {
            shipEl.style.width = widthPx;
            shipEl.style.height = cellSize + 'px';
        }
    }

    function closeGameOverModal() {
        document.getElementById('game-over-modal').style.display = 'none';
    }

    function closeGameOverAndReset() {
        document.getElementById('game-over-modal').style.display = 'none';
        resetGameFull();
    }

    function log(msg, cls) {
        const logBox = document.getElementById('log');
        const div = document.createElement('div');
        div.className = `log-line ${cls}`;
        div.innerHTML = `[${new Date().toLocaleTimeString().split(' ')[0]}] ${msg}`;
        logBox.prepend(div);
    }

    function toggleHelp() {
        const modal = document.getElementById('help-modal');
        // 使用 requestAnimationFrame 优化渲染，减少闪烁
        requestAnimationFrame(() => {
            modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
        });
    }

    function togglePanel(side) {
        const isLeft = side === 'left';
        const panel = document.querySelector(isLeft ? '.dock-panel' : '.log-panel');
        const btn = document.querySelector(isLeft ? '.toggle-left' : '.toggle-right');
        
        panel.classList.toggle('panel-collapsed');
        
        const isCollapsed = panel.classList.contains('panel-collapsed');
        
        if (isLeft) {
            btn.innerText = isCollapsed ? '▶' : '◀';
        } else {
            btn.innerText = isCollapsed ? '◀' : '▶';
        }
    }

    function initHelpShips() {
        const tbody = document.getElementById('rules-ship-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        SHIP_TYPES.forEach(type => {
            const tr = document.createElement('tr');
            
            // Image
            const tdImg = document.createElement('td');
            const divImg = document.createElement('div');
            divImg.className = 'ship-preview';
            const previewShip = document.createElement('div');
            previewShip.className = `ship ship-visuals-root f-${playerFaction}`;
            const inner = document.createElement('div');
            inner.className = 'ship-inner';
            inner.innerHTML = getShipDom(type.code, playerFaction);
            previewShip.appendChild(inner);

            updateShipVisuals({
                len: type.len,
                el: previewShip,
                vertical: false,
                inDock: false
            });
            
            // 手册预览按统一宽度归一化，避免小舰种缩成一条线、大舰种被裁切
            const wrapper = previewShip.querySelector('.hull-scale-wrapper');
            if (wrapper) {
                wrapper.style.transform = 'none';
                wrapper.style.width = '100%';
                wrapper.style.height = '100%';
                wrapper.style.display = 'flex';
                wrapper.style.alignItems = 'center';
                wrapper.style.justifyContent = 'center';
                const svg = wrapper.querySelector('svg');
                if (svg) {
                    svg.removeAttribute('height');
                    svg.style.width = '100%';
                    svg.style.height = 'auto';
                }
            }
            previewShip.style.width = '100%';
            previewShip.style.height = '100%';

            divImg.appendChild(previewShip);
            tdImg.appendChild(divImg);
            tr.appendChild(tdImg);

            // Code
            const tdCode = document.createElement('td');
            tdCode.innerText = type.code;
            tr.appendChild(tdCode);

            // Name
            const tdName = document.createElement('td');
            tdName.innerText = type.name;
            tr.appendChild(tdName);

            // Len
            const tdLen = document.createElement('td');
            tdLen.innerText = type.len;
            tr.appendChild(tdLen);

            // HP
            const tdHp = document.createElement('td');
            tdHp.innerText = type.maxHp;
            tr.appendChild(tdHp);

            // Ability（手册只列基础规则，学说修正以学说卡为准）
            const tdAbil = document.createElement('td');
            if (type.code === 'CV') {
                tdAbil.innerHTML = '解锁 <b>空袭</b>';
            }
            else if (type.code === 'DD') tdAbil.innerHTML = '解锁 <b>水听</b>';
            else if (type.code === 'BB' || type.code === 'SS' || type.code === 'CL') {
                const maxAp = type.code === 'BB' ? 3 : 2;
                tdAbil.innerHTML = `主炮伤害上限 ${maxAp}`;
                if (type.code === 'SS') tdAbil.innerHTML += '<br>解锁 <b>水听</b>';
            }
            else tdAbil.innerText = '-';
            tr.appendChild(tdAbil);

            tbody.appendChild(tr);
        });
    }

    /**
     * 装备区阵营学说速览（随阵营选择实时刷新）
     */
    function updateDoctrineReadout() {
        const el = document.getElementById('doctrine-readout');
        if (!el) return;
        el.innerHTML = '';

        const makeCard = (side, factionId) => {
            const doc = getDoctrine(factionId);
            const faction = FACTIONS[factionId];
            const hidden = side === 'enemy' && enemyFactionRandom;
            const card = document.createElement('div');
            card.className = `dr-card dr-${side}${hidden ? ' dr-random' : ''}`;

            const head = document.createElement('div');
            head.className = 'dr-head';

            const sideTag = document.createElement('span');
            sideTag.className = 'dr-side';
            sideTag.innerText = side === 'player' ? '我方' : (hidden ? '敌方 随机' : '敌方');
            const name = document.createElement('span');
            name.className = 'dr-name';
            name.innerText = hidden ? '随机阵营' : doc.name;
            const en = document.createElement('span');
            en.className = 'dr-en';
            en.innerText = hidden ? 'RANDOM' : doc.en;
            head.append(sideTag, name, en);

            const brief = document.createElement('div');
            brief.className = 'dr-brief';
            brief.innerText = hidden ? '开战前从对立集团中抽取，学说随之确定。' : doc.brief;

            card.appendChild(head);
            card.appendChild(brief);
            if (faction && !hidden) card.title = `${faction.name}：${doc.desc}`;
            else if (hidden) card.title = '每局开战前随机抽取';
            return card;
        };

        el.appendChild(makeCard('player', playerFaction));
        el.appendChild(makeCard('enemy', enemyFaction));
        highlightDoctrineRows();
    }

    /**
     * 作战手册阵营学说表（静态填充一次，选择时高亮当前双方）
     */
    function initHelpDoctrines() {
        const tbody = document.getElementById('rules-doctrine-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        Object.entries(DOCTRINES).forEach(([id, doc]) => {
            const tr = document.createElement('tr');
            tr.dataset.faction = id;

            const tdFaction = document.createElement('td');
            tdFaction.innerText = FACTIONS[id]?.name || id;
            const tdName = document.createElement('td');
            tdName.innerHTML = `<b>${doc.name}</b><br><span class="doc-en">${doc.en}</span>`;
            const tdBrief = document.createElement('td');
            tdBrief.innerText = doc.brief;
            const tdAI = document.createElement('td');
            tdAI.innerText = doc.aiHint;

            tr.append(tdFaction, tdName, tdBrief, tdAI);
            tbody.appendChild(tr);
        });
        highlightDoctrineRows();
    }

    function highlightDoctrineRows() {
        const tbody = document.getElementById('rules-doctrine-table-body');
        if (!tbody) return;
        tbody.querySelectorAll('tr[data-faction]').forEach(tr => {
            const id = tr.dataset.faction;
            tr.classList.toggle('doc-row-player', id === playerFaction);
            tr.classList.toggle('doc-row-enemy', !enemyFactionRandom && id === enemyFaction);
        });
    }
