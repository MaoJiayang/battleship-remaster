import { BOARD_SIZE, CELL_SIZE } from "../config/constants";
import { SHIP_TYPES } from "../data/ships";
import { DIFFICULTY_SETTINGS, DEFAULT_DIFFICULTY } from "../data/difficulties";

    // === 配置 ===

    // 移除 SVG_SHIPS，改用 DOM 生成
    function getShipDom(code) {
        let html = '';
        // 缩放比例：根据美术资源尺寸(240/170/120/60)与游戏格子(160/120/80/40)的比例计算
        // 大约是 0.66 (2/3)
        
        if (code === 'BB') {
            html = `
                <div class="hull-scale-wrapper" style="transform: scale(0.66)">
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
                <div class="hull-scale-wrapper" style="transform: scale(0.66)">
                    <div class="hull-cv">
                        <div class="cv-arrow"></div>
                        <div class="cv-elevator"></div>
                        <div class="cv-island"></div>
                        <div class="cv-sponson"></div>
                    </div>
                </div>`;
        } else if (code === 'CL') {
            // CL 原长 170，目标 120 (3格)，120/170 ≈ 0.705
            html = `
                <div class="hull-scale-wrapper" style="transform: scale(0.7)">
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
                <div class="hull-scale-wrapper" style="transform: scale(0.66)">
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
                <div class="hull-scale-wrapper" style="transform: scale(0.66)">
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

    export function initGame() {
        initGrids();
        initShips();
        bindUiEvents();
        document.addEventListener('mouseup', onGlobalMouseUp);
        document.addEventListener('mousemove', onGlobalMouseMove);
        initHelpShips();
        setDifficulty(currentDifficulty, { silent: true });
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
        if (helpBtn) helpBtn.addEventListener('click', toggleHelp);

        const helpModal = document.getElementById('help-modal');
        if (helpModal) {
            helpModal.addEventListener('click', (event) => {
                if (event.target === helpModal) toggleHelp();
            });
            const closeBtn = helpModal.querySelector('.close-btn');
            if (closeBtn) closeBtn.addEventListener('click', toggleHelp);
        }

        document.querySelectorAll('[data-weapon]').forEach(btn => {
            btn.addEventListener('click', () => selectWeapon(btn.dataset.weapon));
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
    }

    // === 新增：攻击范围高亮逻辑 ===
    function handleEnemyGridHover(r, c) {
        if (gameState !== 'PLAYING') return;
        if (document.getElementById('enemy-grid').style.pointerEvents === 'none') return;

        clearAttackHighlights();

        let cellsToHighlight = [];

        if (currentWeapon === 'AP') {
            // 主炮：单点
            cellsToHighlight.push({r, c});
        } else if (currentWeapon === 'HE') {
            // 空袭：X型
            const offsets = [[0,0], [-1,-1], [-1,1], [1,-1], [1,1]];
            offsets.forEach(off => {
                cellsToHighlight.push({r: r + off[0], c: c + off[1]});
            });
        } else if (currentWeapon === 'SONAR') {
            // 水听：3x3
            for(let i=-1; i<=1; i++) {
                for(let j=-1; j<=1; j++) {
                    cellsToHighlight.push({r: r + i, c: c + j});
                }
            }
        }

        const eGrid = document.getElementById('enemy-grid');
        cellsToHighlight.forEach(pos => {
            if (pos.r >= 0 && pos.r < BOARD_SIZE && pos.c >= 0 && pos.c < BOARD_SIZE) {
                const cell = eGrid.querySelector(`.cell[data-r="${pos.r}"][data-c="${pos.c}"]`);
                if (cell) cell.classList.add('attack-range-highlight');
            }
        });
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

            dock.appendChild(shipEl);
            myShips.push(shipObj);
        });
    }

    function updateShipVisuals(ship, isDragging = false) {
        const widthPx = (ship.len * CELL_SIZE) + 'px';
        const heightPx = CELL_SIZE + 'px';

        ship.el.style.setProperty('--w', widthPx);
        ship.el.style.setProperty('--h', heightPx);

        const showVertical = ship.vertical && (!ship.inDock || isDragging);

        if(showVertical) {
            ship.el.classList.add('vertical');
            ship.el.style.width = CELL_SIZE + 'px';
            ship.el.style.height = widthPx;
        } else {
            ship.el.classList.remove('vertical');
            ship.el.style.width = widthPx;
            ship.el.style.height = CELL_SIZE + 'px';
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
        const btn = document.getElementById('first-turn-toggle');
        btn.innerText = firstTurn === 'PLAYER' ? "先手：玩家 👤" : "先手：电脑 🤖";
    }

    function toggleAiDebug() {
        showAiDebug = !showAiDebug;
        const btn = document.getElementById('btn-debug');
        btn.innerText = showAiDebug ? "🧠 AI 视角: 开启" : "🧠 AI 视角: 关闭";
        btn.style.background = showAiDebug ? "#ed8936" : ""; // Orange when active
        
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
        const probabilityMap = precomputedMap || calculateProbabilityGrid(viewGrid, targets);

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

    function onGlobalMouseMove(e) {
        if (!dragTarget) return;
        isDragging = true;
        const ship = dragTarget;
        ship.el.style.left = (e.clientX - dragOffset.x) + 'px';
        ship.el.style.top = (e.clientY - dragOffset.y) + 'px';

        clearHighlights();
        const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
        if (!elemBelow) { currentPreview = null; return; }

        const cell = elemBelow.closest('.cell');
        const pGrid = document.getElementById('player-grid');

        if (cell && pGrid.contains(cell)) {
            const gridRect = pGrid.getBoundingClientRect();
            const shipLeft = e.clientX - dragOffset.x;
            const shipTop = e.clientY - dragOffset.y;
            
            const relX = shipLeft - gridRect.left + (CELL_SIZE/2);
            const relY = shipTop - gridRect.top + (CELL_SIZE/2);
            
            const c = Math.floor(relX / CELL_SIZE);
            const r = Math.floor(relY / CELL_SIZE);
            
            previewPlacement(ship, r, c);
        } else {
            currentPreview = null;
        }
    }

    function onGlobalMouseUp(e) {
        if (!dragTarget) return;
        const ship = dragTarget;
        ship.el.classList.remove('dragging');
        const pGrid = document.getElementById('player-grid');
        const gridRect = pGrid.getBoundingClientRect();
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
            const relX = shipLeft - gridRect.left + (CELL_SIZE/2);
            const relY = shipTop - gridRect.top + (CELL_SIZE/2);
            const c = Math.floor(relX / CELL_SIZE);
            const r = Math.floor(relY / CELL_SIZE);
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
        ship.inDock = false;
        ship.r = r; ship.c = c;
        ship.vertical = isVertical;

        ship.el.style.position = 'absolute';
        ship.el.style.margin = '0';
        pGrid.appendChild(ship.el);

        updateShipVisuals(ship);

        ship.el.style.left = (c * CELL_SIZE) + 'px';
        ship.el.style.top = (r * CELL_SIZE) + 'px';
        
        markGrid(ship, 1);
    }

    function returnToDock(ship) {
        const dock = document.getElementById('dock');
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
        if (gameState === 'SETUP') {
            btn.disabled = !allReady;
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
        clearAiTurnTimeout();
        currentWinner = null;
        gameState = 'SETUP';
        document.getElementById('dock').style.display = 'flex';
        document.getElementById('battle-panel').style.display = 'none';
        
        document.getElementById('dock').style.pointerEvents = 'auto';
        document.getElementById('dock').style.opacity = 1;
        document.getElementById('rotate-toggle').disabled = false;
        document.getElementById('first-turn-toggle').disabled = false;
        document.getElementById('btn-debug').disabled = false;
        document.getElementById('btn-reset').disabled = false;
        document.getElementById('btn-random').disabled = false;

        const btn = document.getElementById('start-btn');
        btn.innerText = "🚀 开始战斗";
        btn.className = "btn-orange";
        btn.disabled = true;

        initGrids();
        document.getElementById('enemy-grid').style.pointerEvents = 'none';
        myGridMap = createEmptyGrid();
        resetToDock();
        document.getElementById('log').innerHTML = '<div class="log-line c-sys">游戏已重置。</div>';
    }

    function startGame() {
        clearAiTurnTimeout();
        currentWinner = null;
        gameState = 'PLAYING';
        document.getElementById('dock').style.display = 'none';
        document.getElementById('battle-panel').style.display = 'flex';
        
        document.getElementById('rotate-toggle').disabled = true;
        document.getElementById('first-turn-toggle').disabled = true;
        // document.getElementById('btn-debug').disabled = true; // Debug 按钮战斗中可用
        document.getElementById('btn-reset').disabled = true;
        document.getElementById('btn-random').disabled = true;
        
        myShips.forEach(s => s.el.style.cursor = 'default');
        
        const btn = document.getElementById('start-btn');
        btn.innerText = "🔄 重新开始";
        btn.className = "btn-restart";

        initEnemy();
        updateStatus();
        selectWeapon('AP');
        aiStack = []; 

        if (firstTurn === 'PLAYER') {
            log("战斗开始！玩家先手，点击敌方海域开火。", "c-warn");
            document.getElementById('enemy-grid').style.pointerEvents = 'auto';
        } else {
            log("战斗开始！电脑先手。", "c-warn");
            document.getElementById('enemy-grid').style.pointerEvents = 'none';
            scheduleAiTurn(1000); // AI先手时的初始延迟
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

        if (currentWeapon === 'AP') {
            const cell = enemyGridMap[r][c];
            if (cell.hit && cell.shipId !== -1 && enemyShips[cell.shipId].hp[cell.segmentIndex] <= 0) return;
            if (cell.hit && cell.shipId === -1) return; 

            const dmg = getAPDamage();
            processHit(r, c, dmg);
            log(`使用主炮攻击 (${r+1},${c+1})，伤害: ${dmg}`, "c-p");
            
        } else if (currentWeapon === 'HE') {
            const offsets = [[0,0], [-1,-1], [-1,1], [1,-1], [1,1]];
            let hitCount = 0;
            offsets.forEach(off => {
                let nr = r + off[0], nc = c + off[1];
                if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                    const cell = enemyGridMap[nr][nc];
                    const isDestroyed = cell.hit && cell.shipId !== -1 && enemyShips[cell.shipId].hp[cell.segmentIndex] <= 0;
                    const isMiss = cell.hit && cell.shipId === -1;
                    
                    if (!isMiss && !isDestroyed) {
                        processHit(nr, nc, 1);
                        hitCount++;
                    }
                }
            });
            log(`呼叫空袭覆盖 (${r+1},${c+1}) 周边，打击点数: ${hitCount}`, "c-p");

        } else if (currentWeapon === 'SONAR') {
            let shipCount = 0;
            for(let i=-1; i<=1; i++) {
                for(let j=-1; j<=1; j++) {
                    let nr = r+i, nc = c+j;
                    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                        const cellState = enemyGridMap[nr][nc];
                        if (cellState.shipId !== -1 && !cellState.hit) shipCount++;
                    }
                }
            }
            
            if (shipCount === 0) {
                for(let i=-1; i<=1; i++) {
                    for(let j=-1; j<=1; j++) {
                        let nr = r+i, nc = c+j;
                        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                            const cellState = enemyGridMap[nr][nc];
                            const uiCell = document.querySelector(`#enemy-grid .cell[data-r='${nr}'][data-c='${nc}']`);
                            if (uiCell) uiCell.classList.remove('detect');
                            if (!cellState.hit) {
                                cellState.hit = true;
                                if (uiCell) uiCell.classList.add('miss');
                            }
                        }
                    }
                }
                log(`声纳扫描 (${r+1},${c+1}) 区域：无反应。`, "c-sys");
            } else {
                const cell = enemyGridMap[r][c];
                if (!cell.hit) {
                    processHit(r, c, 0); 
                }
                
                // 标记周围为疑似 (DETECT)
                for(let i=-1; i<=1; i++) {
                    for(let j=-1; j<=1; j++) {
                        let nr = r+i, nc = c+j;
                        if (i===0 && j===0) continue; // 跳过中心点
                        
                        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                            const neighborCell = enemyGridMap[nr][nc];
                            const uiCell = document.querySelector(`#enemy-grid .cell[data-r='${nr}'][data-c='${nc}']`);
                            if (!neighborCell.hit && uiCell) {
                                const uncovered = !uiCell.classList.contains('miss')
                                    && !uiCell.classList.contains('hit')
                                    && !uiCell.classList.contains('destroyed')
                                    && !uiCell.classList.contains('detect');
                                if (uncovered) {
                                    uiCell.classList.add('detect');
                                }
                            }
                        }
                    }
                }
                
                log(`声纳扫描 (${r+1},${c+1}) 区域：发现信号！周边标记为疑似。`, "c-warn");
            }
        }

        updateStatus();
        document.getElementById('enemy-grid').style.pointerEvents = 'none';
        if (gameState === 'PLAYING') {
            scheduleAiTurn(300); // 玩家回合结束后的AI反应延迟 
        }
    }

    function processHit(r, c, dmg) {
        const cell = enemyGridMap[r][c];
        const uiCell = document.querySelector(`#enemy-grid .cell[data-r='${r}'][data-c='${c}']`);
        
        if (cell.hit && cell.shipId === -1) return; 
        
        cell.hit = true;
        uiCell.classList.remove('detect'); // 清除疑似标记
        
        if (cell.shipId !== -1) {
            const ship = enemyShips[cell.shipId];
            if (dmg > 0) {
                ship.hp[cell.segmentIndex] -= dmg;
            }
            
            uiCell.classList.remove('hit', 'destroyed');
            if (ship.hp[cell.segmentIndex] <= 0) {
                uiCell.classList.add('destroyed');
            } else {
                uiCell.classList.add('hit');
            }
            
            if (ship.hp.every(h => h <= 0) && !ship.sunk) {
                ship.sunk = true;
                log(`战报：敌方【${ship.name}】确认沉没！`, "c-warn");
                revealSingleEnemyShip(ship); // 击沉时立即显示
                checkWin("玩家");
            }
        } else {
            uiCell.classList.add('miss');
        }
    }

    // 移除旧的 renderWreck，改用 revealSingleEnemyShip
    // function renderWreck(ship) { ... }

    // === AI 智能系统：概率推断 ===

    let AI_PROB_CONFIG = { ...DIFFICULTY_SETTINGS[DEFAULT_DIFFICULTY] };
    let currentDifficulty = DEFAULT_DIFFICULTY;

    function setDifficulty(level, options = {}) {
        const { silent = false } = options;
        currentDifficulty = level;
        AI_PROB_CONFIG = { ...DIFFICULTY_SETTINGS[level] };
        
        const btns = document.querySelectorAll('.diff-btn');
        btns.forEach(b => b.classList.remove('active'));
        
        if (level === 'EASY') btns[0].classList.add('active');
        else if (level === 'NORMAL') btns[1].classList.add('active');
        else btns[2].classList.add('active');

        if (!silent) {
            log(`AI 难度已调整为: ${level === 'EASY' ? '新兵 (简单)' : (level === 'NORMAL' ? '舰长 (困难)' : '提督 (冷酷)')}`, "c-sys");
        }
    }
    
    const MIN_PLACEMENT_WEIGHT = 0.0001; // 防止极小船型被归零

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
    
    function aiTurn() {
        if (gameState !== 'PLAYING') return;
        // 1. 资源与能力检查
        const aiCV = enemyShips.some(s => s.code === 'CV' && !s.sunk);
        const aiCL = enemyShips.some(s => s.code === 'CL' && !s.sunk);
        const aiBB = enemyShips.some(s => s.code === 'BB' && !s.sunk);
        const aiSS = enemyShips.some(s => s.code === 'SS' && !s.sunk);
        const aiDD = enemyShips.some(s => s.code === 'DD' && !s.sunk);
        
        let aiAPDamage = 1;
        if (aiBB || aiSS) aiAPDamage = 3;
        else if (aiCL) aiAPDamage = 2;

        const canUseAir = aiCV;
        const canUseSonar = aiDD;
        
        // 2. 构建 AI 视野与概率图
        // AI 只能看到：0=未知, 1=Miss, 2=Hit(存活), 3=Destroyed(沉没/毁坏), 4=Suspect, 5=Sunk
        const viewGrid = getAiViewGrid();
        const targets = myShips.filter(s => !s.sunk);
        const probabilityGrid = calculateProbabilityGrid(viewGrid, targets);

        // 3. 决策制定
        let bestAction = { r: -1, c: -1, score: 0, weapon: 'AP' };

        // === 难度控制：随机性干扰 ===
        // 如果触发随机性，则忽略概率图，直接随机选取一个有效点
        if (Math.random() < AI_PROB_CONFIG.randomness) {
            let r, c;
            let attempts = 0;
            // 尝试找一个有效点 (0或4)
            do {
                r = Math.floor(Math.random() * BOARD_SIZE);
                c = Math.floor(Math.random() * BOARD_SIZE);
                attempts++;
            } while ((viewGrid[r][c] === 1 || viewGrid[r][c] === 3 || viewGrid[r][c] === 5) && attempts < 200);
            
            // 随机模式下，偶尔也会用特殊武器 (纯随机)
            if (canUseAir && Math.random() < 0.1) bestAction = { r, c, weapon: 'HE' };
            else if (canUseSonar && Math.random() < 0.1) bestAction = { r, c, weapon: 'SONAR' };
            else bestAction = { r, c, weapon: 'AP' };
            
        } else {
            // === 理性决策流程 ===

            // 3.1 基础：寻找最高分的单点 (用于 AP)
            const bestPoint = findBestPoint(probabilityGrid, viewGrid, aiAPDamage);
            const scoreStats = evaluateScoreStats(probabilityGrid, viewGrid, aiAPDamage);
            bestAction = { ...bestPoint, weapon: 'AP' };

            // 3.2 进阶：如果有空袭，寻找最高分的 X 型区域
            if (canUseAir) {
                const bestArea = findBestArea(probabilityGrid, viewGrid, 1);
                if (bestArea.score > bestPoint.score * AI_PROB_CONFIG.airstrikeAdvantage) {
                    bestAction = { ...bestArea, weapon: 'HE' };
                }
            }

            // 3.3 侦查：概率不足时用声纳扩大情报
            if (canUseSonar) {
                const scanPoint = findBestScanPoint(probabilityGrid, viewGrid);
                const lowContrast = scoreStats.normVariance < AI_PROB_CONFIG.sonarVarianceGate;
                if (scanPoint.r !== -1 && scanPoint.score >= AI_PROB_CONFIG.sonarUnknownRatio && lowContrast) {
                    bestAction = { ...scanPoint, weapon: 'SONAR' };
                }
            }
        }

        // 4. 执行行动
        if (bestAction.r === -1) {
            // Fallback
            let r, c;
            do { r = Math.floor(Math.random()*10); c = Math.floor(Math.random()*10); }
            while (viewGrid[r][c] === 1 || viewGrid[r][c] === 3 || viewGrid[r][c] === 5);
            bestAction = { r, c, weapon: 'AP' };
        }

        const { r, c, weapon } = bestAction;

        if (weapon === 'AP') {
            aiProcessHit(r, c, aiAPDamage);
            log(`敌方使用主炮攻击 (${r+1},${c+1})`, "c-e");
        } else if (weapon === 'HE') {
            const offsets = [[0,0], [-1,-1], [-1,1], [1,-1], [1,1]];
            offsets.forEach(off => {
                let nr = r + off[0], nc = c + off[1];
                if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                    aiProcessHit(nr, nc, 1);
                }
            });
            log(`敌方发动空袭 (${r+1},${c+1})`, "c-e");
        } else if (weapon === 'SONAR') {
            let found = false;
            for(let i=-1; i<=1; i++) {
                for(let j=-1; j<=1; j++) {
                    let nr = r+i, nc = c+j;
                    if (nr>=0 && nr<10 && nc>=0 && nc<10 && myGridMap[nr][nc] === 1) found = true;
                }
            }
            if (found) {
                log(`敌方声纳扫描 (${r+1},${c+1})：发现信号！`, "c-e");
                
                // 1. 中心点显形 (造成 0 伤害的攻击判定，显示真实状态)
                aiProcessHit(r, c, 0);

                // 2. 周围标记疑似
                markAiDetectionArea(r, c);
            } else {
                log(`敌方声纳扫描 (${r+1},${c+1})：无反应。`, "c-sys");
                for(let i=-1; i<=1; i++) {
                    for(let j=-1; j<=1; j++) {
                        let nr = r+i, nc = c+j;
                        if (nr>=0 && nr<10 && nc>=0 && nc<10) {
                            const cell = document.querySelector(`#player-grid .cell[data-r='${nr}'][data-c='${nc}']`);
                            if(!cell.classList.contains('hit') && !cell.classList.contains('destroyed')) {
                                cell.classList.add('miss');
                            }
                        }
                    }
                }
            }
        }

        updateStatus();
        if (showAiDebug) updateAiHeatmapVisuals(); // 实时更新热力图
        const enemyGridEl = document.getElementById('enemy-grid');
        if (gameState === 'PLAYING') {
            enemyGridEl.style.pointerEvents = 'auto';
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

    function calculateProbabilityGrid(viewGrid, targets) {
        const map = Array(BOARD_SIZE).fill(0).map(() => Array(BOARD_SIZE).fill(0));
        let totalWeight = 0;

        targets.forEach(ship => {
            const placements = enumerateShipPlacements(ship, viewGrid);
            placements.forEach(({ cells, weight }) => {
                const viableCells = cells.filter(cell => {
                    const state = viewGrid[cell.r][cell.c];
                    return state === 0 || state === 4;
                });
                if (viableCells.length === 0) return;
                const contribution = weight / viableCells.length;
                viableCells.forEach(cell => {
                    map[cell.r][cell.c] += contribution;
                    totalWeight += contribution;
                });
            });
        });

        if (totalWeight > 0) {
            for (let r=0; r<BOARD_SIZE; r++) {
                for (let c=0; c<BOARD_SIZE; c++) {
                    map[r][c] = map[r][c] / totalWeight;
                }
            }
        }

        for (let r=0; r<BOARD_SIZE; r++) {
            for (let c=0; c<BOARD_SIZE; c++) {
                const state = viewGrid[r][c];
                if (state === 2) map[r][c] = 1;
                if (state === 1 || state === 3 || state === 5) map[r][c] = 0;
            }
        }

        return map;
    }

    function enumerateShipPlacements(ship, viewGrid) {
        const placements = [];
        const len = ship.len;
        const aliveSegments = Math.max(1, ship.hp.filter(h => h > 0).length);
        const scale = aliveSegments / len;

        for (let r=0; r<BOARD_SIZE; r++) {
            for (let c=0; c<=BOARD_SIZE - len; c++) {
                pushPlacement(r, c, false);
            }
        }
        for (let r=0; r<=BOARD_SIZE - len; r++) {
            for (let c=0; c<BOARD_SIZE; c++) {
                pushPlacement(r, c, true);
            }
        }

        return placements;

        function pushPlacement(r, c, vertical) {
            const cells = [];
            let focusScore = 1;

            for (let i=0; i<len; i++) {
                const nr = vertical ? r + i : r;
                const nc = vertical ? c : c + i;
                const state = viewGrid[nr][nc];

                if (state === 1 || state === 5) return;
                cells.push({ r: nr, c: nc });
                if (state === 2 || state === 3) focusScore += AI_PROB_CONFIG.hitFocus;
                else if (state === 4) focusScore += AI_PROB_CONFIG.sonarFocus;
            }

            const weight = Math.max(MIN_PLACEMENT_WEIGHT, focusScore * scale);
            placements.push({ cells, weight });
        }
    }

    function findBestPoint(probMap, viewGrid, damagePerHit = 1) {
        let bestScore = -1;
        const candidates = [];

        for (let r=0; r<BOARD_SIZE; r++) {
            for (let c=0; c<BOARD_SIZE; c++) {
                const state = viewGrid[r][c];
                if (state === 1 || state === 3 || state === 5) continue;
                const baseProb = state === 2 ? 1 : (probMap[r][c] || 0);
                const score = baseProb * damagePerHit;
                if (score > bestScore + 1e-6) {
                    bestScore = score;
                    candidates.length = 0;
                    candidates.push({ r, c });
                } else if (Math.abs(score - bestScore) < 1e-6) {
                    candidates.push({ r, c });
                }
            }
        }

        if (candidates.length === 0) return { r: -1, c: -1, score: 0 };
        const choice = candidates[Math.floor(Math.random() * candidates.length)];
        return { ...choice, score: bestScore };
    }

    function findBestArea(probMap, viewGrid, damagePerCell = 1) {
        const offsets = [[0,0], [-1,-1], [-1,1], [1,-1], [1,1]];
        let bestScore = -1;
        const candidates = [];

        for (let r=0; r<BOARD_SIZE; r++) {
            for (let c=0; c<BOARD_SIZE; c++) {
                let score = 0;
                offsets.forEach(off => {
                    const nr = r + off[0];
                    const nc = c + off[1];
                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) return;
                    const state = viewGrid[nr][nc];
                    if (state === 1 || state === 3 || state === 5) return;
                    const baseProb = state === 2 ? 1 : (probMap[nr][nc] || 0);
                    score += baseProb * damagePerCell;
                });
                if (score > bestScore + 1e-6) {
                    bestScore = score;
                    candidates.length = 0;
                    candidates.push({ r, c });
                } else if (Math.abs(score - bestScore) < 1e-6 && score >= 0) {
                    candidates.push({ r, c });
                }
            }
        }

        if (candidates.length === 0) return { r: -1, c: -1, score: 0 };
        const choice = candidates[Math.floor(Math.random() * candidates.length)];
        return { ...choice, score: bestScore };
    }

    function evaluateScoreStats(probMap, viewGrid, damagePerHit = 1) {
        const scores = [];
        let maxScore = 0;

        for (let r=0; r<BOARD_SIZE; r++) {
            for (let c=0; c<BOARD_SIZE; c++) {
                const state = viewGrid[r][c];
                if (state === 1 || state === 3 || state === 5) continue;
                const baseProb = state === 2 ? 1 : (probMap[r][c] || 0);
                const s = baseProb * damagePerHit;
                scores.push(s);
                if (s > maxScore) maxScore = s;
            }
        }

        if (!scores.length) return { mean: 0, variance: 0, maxScore: 0, normVariance: 0 };

        const mean = scores.reduce((sum, v) => sum + v, 0) / scores.length;
        const variance = scores.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / scores.length;
        let normVariance = 0;
        if (maxScore > 0) {
            const half = maxScore / 2;
            const denom = half > 0 ? half * half : 1;
            normVariance = Math.min(1, variance / denom);
        }
        
        return { mean, variance, maxScore, normVariance };
    }

    function findBestScanPoint(probMap, viewGrid) {
        let best = { r: -1, c: -1, score: 0, density: 0 };

        for (let r=0; r<BOARD_SIZE; r++) {
            for (let c=0; c<BOARD_SIZE; c++) {
                let unknown = 0;
                let mass = 0;
                for (let i=-1; i<=1; i++) {
                    for (let j=-1; j<=1; j++) {
                        const nr = r + i;
                        const nc = c + j;
                        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                        const state = viewGrid[nr][nc];
                        if (state === 0) {
                            unknown++;
                            mass += probMap[nr][nc] || 0;
                        }
                    }
                }
                if (unknown === 0) continue;
                const coverage = unknown / 9;
                const density = mass / unknown;
                if (coverage > best.score + 1e-6 || (Math.abs(coverage - best.score) < 1e-6 && density > best.density)) {
                    best = { r, c, score: coverage, density };
                }
            }
        }

        return best;
    }

    function markAiDetectionArea(centerR, centerC) {
        for (let i=-1; i<=1; i++) {
            for (let j=-1; j<=1; j++) {
                if (i===0 && j===0) continue; // 跳过中心点，中心点已显示真实状态
                const nr = centerR + i;
                const nc = centerC + j;
                if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
                const cell = document.querySelector(`#player-grid .cell[data-r='${nr}'][data-c='${nc}']`);
                if (!cell) continue;
                if (cell.classList.contains('hit') || cell.classList.contains('destroyed')) continue;
                cell.classList.add('ai-detect');
            }
        }
    }

    function aiProcessHit(r, c, dmg) {
        const uiCell = document.querySelector(`#player-grid .cell[data-r='${r}'][data-c='${c}']`);
        uiCell.classList.remove('ai-detect');

        let hitShip = null;
        let hitIndex = -1;
        
        for(let s of myShips) {
            if (s.vertical) {
                if (c === s.c && r >= s.r && r < s.r + s.len) {
                    hitShip = s;
                    hitIndex = r - s.r;
                    break;
                }
            } else {
                if (r === s.r && c >= s.c && c < s.c + s.len) {
                    hitShip = s;
                    hitIndex = c - s.c;
                    break;
                }
            }
        }

        if (hitShip) {
            if (hitShip.hp[hitIndex] <= 0) return; 
            
            hitShip.hp[hitIndex] -= dmg;
            
            uiCell.classList.remove('hit', 'destroyed', 'miss');
            if (hitShip.hp[hitIndex] <= 0) {
                uiCell.classList.add('destroyed');
                // 移除手动添加的 top-hit-marker，改用 CSS ::after
            } else {
                uiCell.classList.add('hit');
                // 移除手动添加的 top-hit-marker，改用 CSS ::after
            }

            if (hitShip.hp.every(h => h <= 0) && !hitShip.sunk) {
                hitShip.sunk = true;
                hitShip.el.classList.add('sunk');
                log(`严重警报：我方【${hitShip.name}】沉没！`, "c-e");
                checkWin("电脑");
            }

        } else {
            if (!uiCell.classList.contains('miss') && !uiCell.classList.contains('hit') && !uiCell.classList.contains('destroyed')) {
                uiCell.classList.add('miss');
            }
        }
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
        // 检查是否已显示，避免重复
        if (eGrid.querySelector(`.revealed-enemy-ship[data-id="${ship.id}"]`)) return;

        const shipEl = document.createElement('div');
        shipEl.className = 'ship revealed-enemy-ship ship-visuals-root'; 
        shipEl.dataset.id = ship.id;
        shipEl.style.position = 'absolute';
        shipEl.style.left = (ship.c * CELL_SIZE) + 'px';
        shipEl.style.top = (ship.r * CELL_SIZE) + 'px';
        shipEl.style.pointerEvents = 'none'; 
        // z-index 已在 CSS 中设为 1
        
        const inner = document.createElement('div');
        inner.className = 'ship-inner';
        inner.innerHTML = getShipDom(ship.code);
        shipEl.appendChild(inner);

        const widthPx = (ship.len * CELL_SIZE) + 'px';
        const heightPx = CELL_SIZE + 'px';
        shipEl.style.setProperty('--w', widthPx);
        shipEl.style.setProperty('--h', heightPx);
        
        if (ship.v) {
            shipEl.classList.add('vertical');
            shipEl.style.width = CELL_SIZE + 'px';
            shipEl.style.height = widthPx;
        } else {
            shipEl.style.width = widthPx;
            shipEl.style.height = CELL_SIZE + 'px';
        }

        if (ship.sunk) {
            shipEl.classList.add('sunk');
        } else {
            shipEl.style.opacity = '0.9';
            shipEl.style.filter = 'drop-shadow(0 0 5px white)';
        }

        eGrid.appendChild(shipEl);
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
        modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
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
