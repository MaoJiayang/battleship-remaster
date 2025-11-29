import { BOARD_SIZE, CELL_SIZE as DEFAULT_CELL_SIZE, INTERACTION_TIMING } from "../config/constants";
import { SHIP_TYPES } from "../data/ships";
import { DIFFICULTY_SETTINGS, DEFAULT_DIFFICULTY } from "../data/difficulties";
import { makeAIDecision, calculateProbabilityGrid, resetAIState } from '../ai/aiStrategy.js';

// 武器系统导入
import { WeaponRegistry } from './weapons/WeaponRegistry.js';
import { WeaponService } from './weapons/WeaponService.js';
import { BattleRenderer } from './battle/BattleRenderer.js';
import { APWeapon } from './weapons/APWeapon.js';
import { HEWeapon } from './weapons/HEWeapon.js';
import { SonarWeapon } from './weapons/SonarWeapon.js';
import { ShipState, isInBounds } from './weapons/WeaponTypes.js';

    // === 动态尺寸获取 ===
    function getCellSize() {
        const cell = document.querySelector('.cell');
        let size = cell ? cell.getBoundingClientRect().width : 0;
        
        // 如果获取失败 (例如元素隐藏)，尝试根据 CSS 逻辑估算
        if (!size || size === 0) {
            if (window.innerWidth <= 768) {
                // 对应 CSS: clamp(26px, 8.5vw, 34px)
                const vw = window.innerWidth * 0.085;
                size = Math.max(26, Math.min(vw, 34));
            } else {
                size = DEFAULT_CELL_SIZE;
            }
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

    // 移除 SVG_SHIPS，改用 DOM 生成
    function getShipDom(code) {
        let html = '';
        // 原始美术资源宽度定义 (px)
        // BB: 240, CV: 240, CL: 170, DD: 120, SS: 60
        
        if (code === 'BB') {
            html = `
                <div class="hull-scale-wrapper" data-original-width="240">
                    <div class="hull-bb">
                        <div class="turret-base facing-left" style="left: 25px;"><div class="turret-bb"></div></div>
                        <div class="turret-base facing-left" style="left: 52px; z-index: 11;"><div class="turret-bb"></div></div>
                        <div class="bb-bridge-complex">
                            <div class="bb-tower"></div>
                            <div class="bb-funnel"></div>
                        </div>
                        <div class="turret-base facing-right" style="right: 60px; z-index: 11;"><div class="turret-bb"></div></div>
                        <div class="bb-stern-equipment">
                            <div class="bb-catapult-rail"></div>
                            <div class="bb-floatplane"></div>
                            <div class="bb-crane"></div>
                        </div>
                    </div>
                </div>`;
        } else if (code === 'CV') {
            html = `
                <div class="hull-scale-wrapper" data-original-width="240">
                    <div class="hull-cv">
                        <div class="cv-arrow"></div>
                        <div class="cv-elevator"></div>
                        <div class="cv-island"></div>
                        <div class="cv-sponson"></div>
                    </div>
                </div>`;
        } else if (code === 'CL') {
            html = `
                <div class="hull-scale-wrapper" data-original-width="170">
                    <div class="hull-cl">
                        <div class="turret-base facing-left" style="left: 15px;"><div class="turret-cl"></div></div>
                        <div class="turret-base facing-left" style="left: 35px; z-index:11"><div class="turret-cl"></div></div>
                        <div class="cl-bridge-area">
                            <div class="cl-block"></div>
                            <div class="cl-funnel" style="left: 25px;"></div>
                            <div class="cl-funnel" style="left: 45px;"></div>
                        </div>
                        <div class="turret-base facing-right" style="right: 35px; z-index:11"><div class="turret-cl"></div></div>
                        <div class="turret-base facing-right" style="right: 15px;"><div class="turret-cl"></div></div>
                    </div>
                </div>`;
        } else if (code === 'DD') {
            html = `
                <div class="hull-scale-wrapper" data-original-width="120">
                    <div class="hull-dd">
                        <div class="turret-base facing-left" style="left: 10px;"><div class="turret-dd"></div></div>
                        <div class="turret-base facing-left" style="left: 24px; z-index:11"><div class="turret-dd"></div></div>
                        <div class="dd-mid">
                            <div class="dd-structure" style="left: 0px;"></div>
                            <div class="dd-torpedo" style="left: 12px;"></div>
                            <div class="dd-structure" style="left: 28px;"></div>
                            <div class="dd-torpedo" style="left: 40px;"></div>
                        </div>
                        <div class="turret-base facing-right" style="right: 10px;"><div class="turret-dd"></div></div>
                    </div>
                </div>`;
        } else if (code === 'SS') {
            html = `
                <div class="hull-scale-wrapper" data-original-width="60">
                    <div class="hull-ss">
                        <div class="ss-tower">
                            <div class="ss-periscope"></div>
                        </div>
                    </div>
                </div>`;
        }
        return html;
    }

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

    // 武器系统实例（模块级变量）
    let weaponRegistry = null;
    let battleRenderer = null;
    let weaponService = null;

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

        // 监听窗口大小变化，实时调整舰船尺寸
        window.addEventListener('resize', () => {
            myShips.forEach(ship => updateShipVisuals(ship));
            // 同时也需要更新已显示的敌舰
            document.querySelectorAll('.revealed-enemy-ship').forEach(el => {
                const shipId = parseInt(el.dataset.id);
                const ship = enemyShips.find(s => s.id === shipId);
                if (ship) updateRevealedShipVisuals(el, ship);
            });
        });

        initHelpShips();
        setDifficulty(currentDifficulty, { silent: true });
        
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
            isPlayer: true
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
            isPlayer: false
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

    function initGrids() {
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
            });
        }

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
    }

    // === 移动端视图切换逻辑 ===
    function switchMobileView(viewName) {
        // 仅在移动端生效 (通过检测按钮是否可见，或者直接操作类名，PC端CSS会忽略这些类名)
        const pBox = document.getElementById('player-board-box');
        const eBox = document.getElementById('enemy-board-box');
        
        // Old tabs
        const tabP = document.getElementById('tab-view-player');
        const tabE = document.getElementById('tab-view-enemy');
        
        // New tabs
        const mbTabP = document.getElementById('mb-tab-player');
        const mbTabE = document.getElementById('mb-tab-enemy');

        // 移除所有激活状态
        pBox.classList.remove('active-view');
        eBox.classList.remove('active-view');
        if(tabP) tabP.classList.remove('active');
        if(tabE) tabE.classList.remove('active');
        if(mbTabP) mbTabP.classList.remove('active');
        if(mbTabE) mbTabE.classList.remove('active');

        if (viewName === 'player') {
            pBox.classList.add('active-view');
            if(tabP) tabP.classList.add('active');
            if(mbTabP) mbTabP.classList.add('active');
        } else {
            eBox.classList.add('active-view');
            if(tabE) tabE.classList.add('active');
            if(mbTabE) mbTabE.classList.add('active');
        }
    }

    // === 攻击范围高亮逻辑 ===
    function handleEnemyGridHover(r, c) {
        if (gameState !== 'PLAYING') return;
        if (document.getElementById('enemy-grid').style.pointerEvents === 'none') return;

        clearAttackHighlights();

        // 使用武器系统获取预览范围
        if (weaponService) {
            weaponService.setCurrentWeapon(currentWeapon);
            const preview = weaponService.getPreviewArea({ r, c });
            
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
        myShips = [];
        dock.innerHTML = '';

        SHIP_TYPES.forEach((type, i) => {
            const shipEl = document.createElement('div');
            shipEl.className = 'ship ship-visuals-root'; // 添加 visuals root 类
            shipEl.title = `${type.name} (长度:${type.len})`;
            shipEl.style.position = 'relative'; 
            
            const inner = document.createElement('div');
            inner.className = 'ship-inner';
            inner.innerHTML = getShipDom(type.code); // 使用新 DOM
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

    function updateShipVisuals(ship, isDragging = false) {
        const cellSize = getCellSize();
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
        const text = firstTurn === 'PLAYER' ? "先手：玩家 👤" : "先手：电脑 🤖";
        
        const btn = document.getElementById('first-turn-toggle');
        if (btn) btn.innerText = text;
        
        const mBtn = document.getElementById('mobile-first-turn');
        if (mBtn) mBtn.innerText = text;
    }

    function toggleAiDebug() {
        showAiDebug = !showAiDebug;
        const text = showAiDebug ? "🧠 AI 视角: 开启" : "🧠 AI 视角: 关闭";
        const bg = showAiDebug ? "#ed8936" : "";

        const btn = document.getElementById('btn-debug');
        if (btn) {
            btn.innerText = text;
            btn.style.background = bg;
        }

        const mBtn = document.getElementById('mobile-debug');
        if (mBtn) {
            mBtn.innerText = text;
            mBtn.style.background = bg;
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
        const probabilityMap = precomputedMap || (targets.length > 0 ? calculateProbabilityGrid(viewGrid, targets, AI_PROB_CONFIG) : Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0)));

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
        let clickOffsetX = e.clientX - rect.left;
        let clickOffsetY = e.clientY - rect.top;

        ship.el.classList.add('dragging');
        
        const isPortExit = ship.inDock && currentDeployMode === 'vertical';

        if (ship.inDock) ship.vertical = (currentDeployMode === 'vertical');
        updateShipVisuals(ship, true);

        if (isPortExit) {
            dragOffset.x = clickOffsetY;
            dragOffset.y = clickOffsetX;
        } else {
            dragOffset.x = clickOffsetX;
            dragOffset.y = clickOffsetY;
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
        myGridMap = createEmptyGrid();
        myShips.forEach(s => returnToDock(s));
        checkReady();
    }

    function autoDeploy() {
        resetToDock();
        setTimeout(() => {
            myShips.forEach(ship => {
                let placed = false;
                let attempts = 0;
                while (!placed && attempts < 200) {
                    let r = Math.floor(Math.random() * BOARD_SIZE);
                    let c = Math.floor(Math.random() * BOARD_SIZE);
                    let v = Math.random() > 0.5;
                    if (isValidPos(r, c, ship.len, v, null)) {
                        placeShip(ship, r, c, v);
                        placed = true;
                    }
                    attempts++;
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
        document.body.classList.remove('game-playing'); // 移除战斗状态类
        clearAiTurnTimeout();
        currentWinner = null;
        gameState = 'SETUP';
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
        btn.innerText = "🚀 开始战斗";
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
        btn.innerText = "🔄 重新开始";
        btn.className = "btn-restart";

        resetAIState(); // 重置 AI 内部状态（伤害记录等）
        initEnemy();
        updateStatus();
        selectWeapon('AP');
        aiStack = []; 

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

        // 2. 初始化数据
        enemyShips = [];
        enemyGridMap = createEmptyGrid().map(row => row.map(c => ({hit:false, shipId:-1, segmentIndex: -1})));
        let tempGrid = createEmptyGrid();
        
        SHIP_TYPES.forEach((type, idx) => {
            let placed = false;
            let attempts = 0;
            while (!placed && attempts < 1000) {
                attempts++;
                let r = Math.floor(Math.random() * BOARD_SIZE);
                let c = Math.floor(Math.random() * BOARD_SIZE);
                let v = Math.random() > 0.5;
                let valid = true;
                
                if (v) { if (r + type.len > BOARD_SIZE) valid = false; }
                else { if (c + type.len > BOARD_SIZE) valid = false; }
                
                if (valid) {
                    for(let i=0; i<type.len; i++) {
                        let nr = v ? r+i : r; let nc = v ? c : c+i;
                        if (tempGrid[nr][nc] === 1) valid = false;
                    }
                }
                
                if (valid) {
                    for(let i=0; i<type.len; i++) {
                        let nr = v ? r+i : r; let nc = v ? c : c+i;
                        tempGrid[nr][nc] = 1;
                        enemyGridMap[nr][nc].shipId = idx;
                        enemyGridMap[nr][nc].segmentIndex = i;
                    }
                    enemyShips.push({ 
                        id: idx, 
                        name: type.name, 
                        len: type.len, 
                        maxHp: type.maxHp,
                        code: type.code,
                        hp: Array(type.len).fill(type.maxHp),
                        sunk:false, 
                        r, c, v 
                    });
                    placed = true;
                }
            }
            if (!placed) console.error("Failed to place ship:", type.name);
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
            if (type === 'AP') { mbName.innerText = '主炮'; mbIcon.innerText = '💥'; }
            else if (type === 'HE') { mbName.innerText = '空袭'; mbIcon.innerText = '✈️'; }
            else if (type === 'SONAR') { mbName.innerText = '水听'; mbIcon.innerText = '📡'; }
        }
    }

    function updateWeaponStates() {
        const cvAlive = myShips.some(s => s.code === 'CV' && !s.sunk);
        const clAlive = myShips.some(s => s.code === 'CL' && !s.sunk);
        const ddAlive = myShips.some(s => s.code === 'DD' && !s.sunk);
        
        const enableHE = cvAlive; // 仅航母可用空袭
        const enableSonar = ddAlive;
        
        document.getElementById('btn-he').disabled = !enableHE;
        document.getElementById('btn-sonar').disabled = !enableSonar;
        
        if (currentWeapon === 'HE' && !enableHE) selectWeapon('AP');
        if (currentWeapon === 'SONAR' && !enableSonar) selectWeapon('AP');

        // 更新主炮伤害显示
        const dmg = getAPDamage();
        const descEl = document.getElementById('ap-desc');
        if (descEl) descEl.innerText = `单点 ${dmg}伤`;
    }

    function getAPDamage() {
        const bbAlive = myShips.some(s => s.code === 'BB' && !s.sunk);
        const ssAlive = myShips.some(s => s.code === 'SS' && !s.sunk);
        const clAlive = myShips.some(s => s.code === 'CL' && !s.sunk);
        
        if (bbAlive || ssAlive) return 3;
        if (clAlive) return 2; // 轻巡保底
        return 1;
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
        
        updateWeaponStates();
    }

    function clickEnemy(r, c) {
        if (gameState !== 'PLAYING') return;
        if (document.getElementById('enemy-grid').style.pointerEvents === 'none') return;

        // === 新路径：完全使用武器系统 ===
        if (weaponService) {
            weaponService.setCurrentWeapon(currentWeapon);
            const context = buildPlayerWeaponContext();
            const result = weaponService.executePlayerAction({ r, c }, context);
            
            if (!result.success) return;
            
            // 检查胜负（仅对攻击类武器，声纳不会击沉船只）
            if (currentWeapon !== 'SONAR' && result.shipsSunk && result.shipsSunk.length > 0) {
                checkWin("玩家");
            }
        }

        updateStatus();
        document.getElementById('enemy-grid').style.pointerEvents = 'none';
        if (gameState === 'PLAYING') {
            const timing = getTiming();
            // 玩家回合结束，根据配置延迟切换视角
            if (timing.VIEW_SWITCH_DELAY > 0) {
                setTimeout(() => {
                    if(gameState === 'PLAYING') switchMobileView('player');
                }, timing.VIEW_SWITCH_DELAY);
            }
            scheduleAiTurn(timing.AI_ACTION_DELAY); 
        }
    }

    // === AI 智能系统：概率推断 ===

    let AI_PROB_CONFIG = { ...DIFFICULTY_SETTINGS[DEFAULT_DIFFICULTY] };
    let currentDifficulty = DEFAULT_DIFFICULTY;

    function setDifficulty(level, options = {}) {
        const { silent = false } = options;
        currentDifficulty = level;
        AI_PROB_CONFIG = { ...DIFFICULTY_SETTINGS[level] };
        
        // 更新所有难度按钮状态 (包括桌面端和移动端设置菜单)
        document.querySelectorAll('.diff-btn').forEach(btn => {
            if (btn.dataset.difficulty === level) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        if (!silent) {
            log(`AI 难度已调整为: ${level === 'EASY' ? '新兵 (简单)' : (level === 'NORMAL' ? '舰长 (困难)' : '提督 (冷酷)')}`, "c-sys");
        }
    }

    function clearAiTurnTimeout() {
        if (aiTurnTimeout !== null) {
            clearTimeout(aiTurnTimeout);
            aiTurnTimeout = null;
        }
    }

    function scheduleAiTurn(delay) {
        clearAiTurnTimeout();
        aiTurnTimeout = setTimeout(() => {
            aiTurnTimeout = null;
            aiTurn();
        }, delay);
    }
    
    function clearLastEnemyAttacks() {
        const pGrid = document.getElementById('player-grid');
        pGrid.querySelectorAll('.last-enemy-attack').forEach(el => {
            el.classList.remove('last-enemy-attack');
        });
    }

    function aiTurn() {
        if (gameState !== 'PLAYING') return;
        
        // 清除上一次的攻击标记
        clearLastEnemyAttacks();

        // 1. 准备决策上下文
        const viewGrid = getAiViewGrid();
        const aiDecisionContext = {
            viewGrid,
            myShips,
            enemyShips,
            difficultyConfig: AI_PROB_CONFIG
        };

        // 2. 调用 AI 策略模块进行决策
        const decision = makeAIDecision(aiDecisionContext);

        // 3. 使用武器系统执行攻击
        if (weaponService) {
            const context = buildAIWeaponContext();
            const result = weaponService.executeAIAction(decision, context);
            
            // 4. 检查胜负（仅对攻击类武器）
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
        const enemyGridEl = document.getElementById('enemy-grid');
        if (gameState === 'PLAYING') {
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
        let grid = Array(10).fill(0).map(() => Array(10).fill(0));
        document.querySelectorAll('#player-grid .cell').forEach(cell => {
            const r = parseInt(cell.dataset.r);
            const c = parseInt(cell.dataset.c);
            if (cell.classList.contains('destroyed')) grid[r][c] = 3;
            else if (cell.classList.contains('hit')) grid[r][c] = 2;
            else if (cell.classList.contains('miss')) grid[r][c] = 1;
            else if (cell.classList.contains('ai-detect')) grid[r][c] = 4;
        });

        // 标记已沉没船只的位置为 5 (Sunk)，视为不可穿越的障碍
        myShips.forEach(s => {
            if (s.sunk) {
                for(let i=0; i<s.len; i++) {
                    let nr = s.vertical ? s.r+i : s.r;
                    let nc = s.vertical ? s.c : s.c+i;
                    if(nr >= 0 && nr < 10 && nc >= 0 && nc < 10) grid[nr][nc] = 5;
                }
            }
        });

        return grid;
    }

    function checkWin(who) {
        if (currentWinner) return;
        const pDead = myShips.every(s => s.sunk);
        const eDead = enemyShips.every(s => s.sunk);
        if (!(pDead || eDead)) return;

        currentWinner = who;
        gameState = 'END';
        clearAiTurnTimeout();
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
        
        setTimeout(() => {
            modal.style.display = 'block';
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
        shipEl.className = 'ship revealed-enemy-ship ship-visuals-root'; 
        shipEl.dataset.id = ship.id;
        shipEl.style.position = 'absolute';
        shipEl.style.left = (ship.c * cellSize) + 'px';
        shipEl.style.top = (ship.r * cellSize) + 'px';
        shipEl.style.pointerEvents = 'none'; 
        // z-index 已在 CSS 中设为 1
        
        const inner = document.createElement('div');
        inner.className = 'ship-inner';
        inner.innerHTML = getShipDom(ship.code);
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
            previewShip.className = 'ship ship-visuals-root';
            const inner = document.createElement('div');
            inner.className = 'ship-inner';
            inner.innerHTML = getShipDom(type.code);
            previewShip.appendChild(inner);

            updateShipVisuals({
                len: type.len,
                el: previewShip,
                vertical: false,
                inDock: false
            });
            
            // 帮助面板里的预览需要特殊处理，因为它的父容器大小是固定的，不是基于 cellSize
            // 我们可以强制给它一个较小的 scale，或者让它基于 30px 的格子计算
            // 这里简单处理：手动覆盖 scale
            const wrapper = previewShip.querySelector('.hull-scale-wrapper');
            if (wrapper) wrapper.style.transform = 'scale(0.4)';

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

            // Ability
            const tdAbil = document.createElement('td');
            if (type.code === 'CV') tdAbil.innerHTML = '解锁 <b>空袭</b>';
            else if (type.code === 'DD') tdAbil.innerHTML = '解锁 <b>水听</b>';
            else if (type.code === 'BB') tdAbil.innerHTML = '主炮伤害 3';
            else if (type.code === 'SS') tdAbil.innerHTML = '主炮伤害 3';
            else if (type.code === 'CL') tdAbil.innerHTML = '主炮伤害 2 (若BB/SS沉没)';
            else tdAbil.innerText = '-';
            tr.appendChild(tdAbil);

            tbody.appendChild(tr);
        });
    }
