/**
 * AI对战可视化主控制器
 * 
 * 职责：
 * 1. 配置界面交互
 * 2. 调用后端模拟接口
 * 3. 逐步渲染对战过程
 * 4. 显示战况日志和结果
 */

// ============================================================================
// 常量定义
// ============================================================================

// BOARD_SIZE 从后端获取（与游戏常量同步）
let BOARD_SIZE = 11; // 默认值，启动时从服务器获取

const SHIP_TYPES = [
  { code: 'BB', name: '战列舰', length: 5, icon: '🚢' },
  { code: 'CV', name: '航空母舰', length: 4, icon: '✈️' },
  { code: 'CL', name: '巡洋舰', length: 3, icon: '⚓' },
  { code: 'DD', name: '驱逐舰', length: 3, icon: '🛥️' },
  { code: 'SS', name: '潜艇', length: 2, icon: '🌊' }
];

// ============================================================================
// 状态管理
// ============================================================================

let battleState = {
  configA: { alpha: 0.7, riskAwareness: 0.2 },
  configB: { alpha: 0.6, riskAwareness: 0.3 },
  turnDelay: 800,
  events: [],
  currentEventIndex: 0,
  isPaused: false,
  isRunning: false,
  gridA: null,
  gridB: null,
  shipsA: [],
  shipsB: [],
  showProbabilityA: false, // AI-A的概率网格显示状态
  showProbabilityB: false  // AI-B的概率网格显示状态
};

// ============================================================================
// DOM 元素引用
// ============================================================================

const elements = {
  // 配置输入
  alphaA: document.getElementById('alpha-a'),
  riskA: document.getElementById('risk-a'),
  alphaB: document.getElementById('alpha-b'),
  riskB: document.getElementById('risk-b'),
  turnDelay: document.getElementById('turn-delay'),
  
  // 控制按钮
  startBtn: document.getElementById('start-battle-btn'),
  pauseBtn: document.getElementById('pause-battle-btn'),
  resumeBtn: document.getElementById('resume-battle-btn'),
  resetBtn: document.getElementById('reset-battle-btn'),
  
  // 概率网格按钮
  toggleProbA: document.getElementById('toggle-prob-a'),
  toggleProbB: document.getElementById('toggle-prob-b'),
  
  // 战场显示
  gridA: document.getElementById('grid-a'),
  gridB: document.getElementById('grid-b'),
  statusA: document.getElementById('status-a'),
  statusB: document.getElementById('status-b'),
  shipsA: document.getElementById('ships-a'),
  shipsB: document.getElementById('ships-b'),
  
  // 日志
  battleLog: document.getElementById('battle-log'),
  
  // 结果模态框
  resultModal: document.getElementById('result-modal'),
  resultTitle: document.getElementById('result-title'),
  resultStats: document.getElementById('result-stats'),
  closeResultBtn: document.getElementById('close-result-btn')
};

// ============================================================================
// 初始化
// ============================================================================

async function init() {
  // 从服务器获取游戏常量
  try {
    const response = await fetch('/api/constants');
    const constants = await response.json();
    BOARD_SIZE = constants.BOARD_SIZE;
    
    // 更新CSS变量
    document.documentElement.style.setProperty('--board-size', BOARD_SIZE);
    document.documentElement.style.setProperty('--cell-size', constants.CELL_SIZE + 'px');
  } catch (error) {
    console.warn('获取常量失败，使用默认值:', error);
  }
  
  // 绑定事件
  elements.startBtn.addEventListener('click', startBattle);
  elements.pauseBtn.addEventListener('click', pauseBattle);
  elements.resumeBtn.addEventListener('click', resumeBattle);
  elements.resetBtn.addEventListener('click', resetBattle);
  elements.closeResultBtn.addEventListener('click', closeResultModal);
  
  // 绑定概率按钮
  if (elements.toggleProbA) {
    elements.toggleProbA.addEventListener('click', () => toggleProbability('A'));
  }
  if (elements.toggleProbB) {
    elements.toggleProbB.addEventListener('click', () => toggleProbability('B'));
  }
  
  // 初始化网格
  initGrid(elements.gridA, 'A');
  initGrid(elements.gridB, 'B');
  
  log('系统已就绪，配置参数后点击"开始对战"');
}

/**
 * 创建空网格
 */
function initGrid(container, side) {
  container.innerHTML = '';
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell water';
      cell.dataset.row = row;
      cell.dataset.col = col;
      cell.dataset.side = side;
      container.appendChild(cell);
    }
  }
}

// ============================================================================
// 对战控制
// ============================================================================

/**
 * 开始对战
 */
async function startBattle() {
  // 读取配置
  battleState.configA = {
    alpha: parseFloat(elements.alphaA.value),
    riskAwareness: parseFloat(elements.riskA.value)
  };
  battleState.configB = {
    alpha: parseFloat(elements.alphaB.value),
    riskAwareness: parseFloat(elements.riskB.value)
  };
  battleState.turnDelay = parseInt(elements.turnDelay.value);
  
  // 重置状态
  battleState.events = [];
  battleState.currentEventIndex = 0;
  battleState.isPaused = false;
  battleState.isRunning = true;
  
  // 更新UI
  elements.startBtn.disabled = true;
  elements.pauseBtn.disabled = false;
  elements.resumeBtn.disabled = true;
  elements.resetBtn.disabled = true;
  
  // 清空日志和网格
  elements.battleLog.innerHTML = '';
  initGrid(elements.gridA, 'A');
  initGrid(elements.gridB, 'B');
  
  elements.statusA.textContent = '准备中...';
  elements.statusB.textContent = '准备中...';
  
  log('⚙️ 正在启动模拟引擎...');
  log(`AI-A 配置: Alpha=${battleState.configA.alpha}, Risk=${battleState.configA.riskAwareness}`);
  log(`AI-B 配置: Alpha=${battleState.configB.alpha}, Risk=${battleState.configB.riskAwareness}`);
  
  try {
    // 调用后端API
    const response = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configA: battleState.configA,
        configB: battleState.configB
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    battleState.events = result.events;
    
    log(`✅ 模拟完成，共 ${result.totalTurns} 回合，${battleState.events.length} 个事件`);
    log('▶️ 开始回放...');
    
    // 开始逐步渲染
    await playEvents();
    
  } catch (error) {
    log(`❌ 错误: ${error.message}`, 'error');
    resetBattle();
  }
}

/**
 * 暂停对战
 */
function pauseBattle() {
  battleState.isPaused = true;
  elements.pauseBtn.disabled = true;
  elements.resumeBtn.disabled = false;
  log('⏸️ 已暂停');
}

/**
 * 继续对战
 */
function resumeBattle() {
  battleState.isPaused = false;
  elements.pauseBtn.disabled = false;
  elements.resumeBtn.disabled = true;
  log('▶️ 继续播放');
  playEvents();
}

/**
 * 重置对战
 */
function resetBattle() {
  battleState.isRunning = false;
  battleState.isPaused = false;
  battleState.currentEventIndex = 0;
  
  elements.startBtn.disabled = false;
  elements.pauseBtn.disabled = true;
  elements.resumeBtn.disabled = true;
  elements.resetBtn.disabled = false;
  
  initGrid(elements.gridA, 'A');
  initGrid(elements.gridB, 'B');
  
  elements.statusA.textContent = '等待部署';
  elements.statusB.textContent = '等待部署';
  elements.shipsA.innerHTML = '';
  elements.shipsB.innerHTML = '';
  
  log('🔄 已重置');
}

// ============================================================================
// 事件播放
// ============================================================================

/**
 * 逐步播放事件
 */
async function playEvents() {
  while (battleState.currentEventIndex < battleState.events.length && battleState.isRunning) {
    if (battleState.isPaused) {
      return; // 暂停时退出，等待恢复
    }
    
    const event = battleState.events[battleState.currentEventIndex];
    await processEvent(event);
    
    battleState.currentEventIndex++;
    
    // 根据事件类型决定延迟
    const delay = event.type === 'TURN_START' ? battleState.turnDelay : 100;
    await sleep(delay);
  }
  
  // 播放完成
  if (battleState.currentEventIndex >= battleState.events.length) {
    onBattleComplete();
  }
}

/**
 * 处理单个事件
 */
async function processEvent(event) {
  switch (event.type) {
    case 'INIT':
      handleInitEvent(event);
      break;
    case 'TURN_START':
      handleTurnStartEvent(event);
      break;
    case 'ATTACK':
      handleAttackEvent(event);
      break;
    case 'SHIP_SUNK':
      handleShipSunkEvent(event);
      break;
    case 'GAME_END':
      handleGameEndEvent(event);
      break;
    default:
      console.warn('未知事件类型:', event.type);
  }
}

/**
 * 初始化事件 - 显示舰船部署
 */
function handleInitEvent(event) {
  const { shipsA, shipsB, gridA, gridB } = event.data;
  
  battleState.shipsA = shipsA;
  battleState.shipsB = shipsB;
  battleState.gridA = gridA;
  battleState.gridB = gridB;
  
  // 渲染舰船列表
  renderShipList(elements.shipsA, shipsA);
  renderShipList(elements.shipsB, shipsB);
  
  // 渲染初始网格（显示船只位置）
  renderGridWithShips('A', gridA, shipsA);
  renderGridWithShips('B', gridB, shipsB);
  
  elements.statusA.textContent = '已部署';
  elements.statusB.textContent = '已部署';
  
  log('🚢 双方舰队已部署完成');
}

/**
 * 回合开始事件
 */
function handleTurnStartEvent(event) {
  const { turn, attacker } = event.data;
  const attackerName = attacker === 'A' ? 'AI-A' : 'AI-B';
  const color = attacker === 'A' ? 'log-ai-a' : 'log-ai-b';
  
  log(`<span class="log-turn">═══ 第 ${turn} 回合 ═══</span>`);
  log(`<span class="${color}">▸ ${attackerName} 的回合</span>`);
  
  // 更新状态显示
  if (attacker === 'A') {
    elements.statusA.textContent = '攻击中...';
    elements.statusB.textContent = '防御中';
  } else {
    elements.statusA.textContent = '防御中';
    elements.statusB.textContent = '攻击中...';
  }
}

/**
 * 攻击事件
 */
function handleAttackEvent(event) {
  const { attacker, weapon, target, result, affectedCells } = event.data;
  const attackerName = attacker === 'A' ? 'AI-A' : 'AI-B';
  const defender = attacker === 'A' ? 'B' : 'A';
  const color = attacker === 'A' ? 'log-ai-a' : 'log-ai-b';
  
  const weaponNames = { AP: '主炮', HE: '空袭', SONAR: '水听' };
  const weaponName = weaponNames[weapon] || weapon;
  
  log(`<span class="${color}">${attackerName}</span> 使用 ${weaponName} 攻击 (${target.row}, ${target.col})`);
  
  // 先清除之前的高亮
  clearHighlight(defender);
  
  // 更新被攻击方的网格并高亮
  if (affectedCells && affectedCells.length > 0) {
    affectedCells.forEach(cellUpdate => {
      updateCell(defender, cellUpdate.row, cellUpdate.col, cellUpdate.state);
      highlightCell(defender, cellUpdate.row, cellUpdate.col);
    });
  }
  
  // 记录结果
  if (result.hits > 0) {
    log(`  <span class="log-hit">💥 命中 ${result.hits} 格</span>`);
    if (result.damage > 0) {
      log(`  造成 ${result.damage} 点伤害`);
    }
  } else if (weapon === 'SONAR') {
    log(`  ${result.detected ? '✅ 探测到目标' : '⚪ 未发现目标'}`);
  } else {
    log(`  <span class="log-miss">⚪ 未命中</span>`);
  }
}

/**
 * 舰船沉没事件
 */
function handleShipSunkEvent(event) {
  const { side, ship } = event.data;
  const sideName = side === 'A' ? 'AI-A' : 'AI-B';
  
  log(`<span class="log-sink">💀 ${sideName} 的 ${ship.name} 被击沉！</span>`);
  
  // 更新舰船列表
  const shipList = side === 'A' ? battleState.shipsA : battleState.shipsB;
  const shipData = shipList.find(s => s.code === ship.code);
  if (shipData) {
    shipData.sunk = true;
  }
  
  renderShipList(side === 'A' ? elements.shipsA : elements.shipsB, shipList);
}

/**
 * 对战结束事件
 */
function handleGameEndEvent(event) {
  const { winner, reason, totalTurns } = event.data;
  const winnerName = winner === 'A' ? 'AI-A' : 'AI-B';
  
  log(`\n🏆 对战结束！`);
  log(`胜者: ${winnerName}`);
  log(`原因: ${reason}`);
  log(`总回合数: ${totalTurns}`);
  
  elements.statusA.textContent = winner === 'A' ? '🏆 胜利' : '💀 失败';
  elements.statusB.textContent = winner === 'B' ? '🏆 胜利' : '💀 失败';
}

/**
 * 对战完成回调
 */
function onBattleComplete() {
  battleState.isRunning = false;
  
  elements.pauseBtn.disabled = true;
  elements.resumeBtn.disabled = true;
  elements.resetBtn.disabled = false;
  elements.startBtn.disabled = false;
  
  // 显示结果模态框
  const lastEvent = battleState.events[battleState.events.length - 1];
  if (lastEvent && lastEvent.type === 'GAME_END') {
    showResultModal(lastEvent.data);
  }
}

// ============================================================================
// 渲染函数
// ============================================================================

/**
 * 渲染舰船列表
 */
function renderShipList(container, ships) {
  container.innerHTML = ships.map(ship => {
    const sunkClass = ship.sunk ? 'sunk' : '';
    const icon = SHIP_TYPES.find(t => t.code === ship.code)?.icon || '🚢';
    return `<div class="ship-icon ${sunkClass}">${icon} ${ship.code}</div>`;
  }).join('');
}

/**
 * 渲染网格（带船只位置）
 */
function renderGridWithShips(side, grid, ships) {
  const container = side === 'A' ? elements.gridA : elements.gridB;
  
  // 先清空所有格子
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = container.querySelector(`[data-row="${row}"][data-col="${col}"]`);
      if (cell) {
        cell.className = 'cell water';
      }
    }
  }
  
  // 标记船只位置
  ships.forEach(ship => {
    if (ship.positions && ship.positions.length > 0) {
      ship.positions.forEach(pos => {
        const cell = container.querySelector(`[data-row="${pos.r}"][data-col="${pos.c}"]`);
        if (cell) {
          cell.classList.add('ship-position');
        }
      });
    }
  });
}

/**
 * 渲染网格
 */
function renderGrid(side, grid, showShips = false) {
  const container = side === 'A' ? elements.gridA : elements.gridB;
  
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cellData = grid[row][col];
      updateCell(side, row, col, cellData.state, cellData.hasShip && showShips);
    }
  }
}

/**
 * 高亮格子（红框）
 */
function highlightCell(side, row, col) {
  const container = side === 'A' ? elements.gridA : elements.gridB;
  const cell = container.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  if (cell) {
    cell.classList.add('highlight');
  }
}

/**
 * 清除所有高亮
 */
function clearHighlight(side) {
  const container = side === 'A' ? elements.gridA : elements.gridB;
  container.querySelectorAll('.highlight').forEach(cell => {
    cell.classList.remove('highlight');
  });
}

/**
 * 更新单个格子
 */
function updateCell(side, row, col, state, showShip = false) {
  const container = side === 'A' ? elements.gridA : elements.gridB;
  const cell = container.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  
  if (!cell) return;
  
  // 移除所有状态类
  cell.className = 'cell';
  
  // 根据状态添加类（使用CellState枚举）
  // CellState: 0=UNKNOWN, 1=MISS, 2=HIT, 3=DESTROYED, 4=SUSPECT, 5=SUNK
  if (state === 'HIT' || state === 2) {
    cell.classList.add('hit');
  } else if (state === 'DESTROYED' || state === 3) {
    cell.classList.add('destroyed');
  } else if (state === 'MISS' || state === 1) {
    cell.classList.add('miss');
  } else if (state === 'SUSPECTED' || state === 'SUSPECT' || state === 4) {
    cell.classList.add('detect');
  } else if (state === 'SUNK' || state === 5) {
    cell.classList.add('destroyed'); // 沉没船只显示为摧毁
  } else if (showShip) {
    cell.classList.add('ship-position');
  } else {
    cell.classList.add('water');
  }
}

/**
 * 显示结果模态框
 */
function showResultModal(data) {
  const winnerName = data.winner === 'A' ? 'AI-A (红方)' : 'AI-B (蓝方)';
  
  elements.resultTitle.textContent = `🏆 ${winnerName} 获胜！`;
  elements.resultStats.innerHTML = `
    <div>总回合数: <strong>${data.totalTurns}</strong></div>
    <div>胜利原因: ${data.reason}</div>
    <div style="margin-top: 15px; font-size: 0.9rem; color: #a0aec0;">
      AI-A 配置: α=${battleState.configA.alpha}, Risk=${battleState.configA.riskAwareness}<br>
      AI-B 配置: α=${battleState.configB.alpha}, Risk=${battleState.configB.riskAwareness}
    </div>
  `;
  
  elements.resultModal.classList.add('show');
}

/**
 * 关闭结果模态框
 */
function closeResultModal() {
  elements.resultModal.classList.remove('show');
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 日志输出
 */
function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.innerHTML = message;
  elements.battleLog.appendChild(entry);
  elements.battleLog.scrollTop = elements.battleLog.scrollHeight;
}

/**
 * 延迟函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 切换概率网格显示
 */
function toggleProbability(side) {
  if (side === 'A') {
    battleState.showProbabilityA = !battleState.showProbabilityA;
    if (elements.toggleProbA) {
      elements.toggleProbA.textContent = battleState.showProbabilityA ? '🎯 概率: 开启' : '🎯 概率: 关闭';
      elements.toggleProbA.style.background = battleState.showProbabilityA ? '#ed8936' : '';
    }
    updateProbabilityOverlay('A');
  } else {
    battleState.showProbabilityB = !battleState.showProbabilityB;
    if (elements.toggleProbB) {
      elements.toggleProbB.textContent = battleState.showProbabilityB ? '🎯 概率: 开启' : '🎯 概率: 关闭';
      elements.toggleProbB.style.background = battleState.showProbabilityB ? '#ed8936' : '';
    }
    updateProbabilityOverlay('B');
  }
}

/**
 * 更新概率覆盖层
 */
async function updateProbabilityOverlay(side) {
  const show = side === 'A' ? battleState.showProbabilityA : battleState.showProbabilityB;
  const container = side === 'A' ? elements.gridA : elements.gridB;
  
  if (!show) {
    // 清除概率显示
    container.querySelectorAll('.cell').forEach(cell => {
      const overlay = cell.querySelector('.prob-overlay');
      if (overlay) overlay.remove();
    });
    return;
  }
  
  // 获取对手的视角网格和船只
  const viewGrid = side === 'A' ? battleState.gridB : battleState.gridA;
  const enemyShips = side === 'A' ? battleState.shipsB : battleState.shipsA;
  
  if (!viewGrid || !enemyShips) {
    log('概率网格数据未就绪');
    return;
  }
  
  try {
    // 调用后端API计算概率
    const config = side === 'A' ? battleState.configA : battleState.configB;
    const response = await fetch('/api/probability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        viewGrid,
        ships: enemyShips,
        config
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const probGrid = data.probabilityGrid;
    
    // 渲染概率
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = container.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        if (!cell) continue;
        
        // 移除旧的覆盖层
        const oldOverlay = cell.querySelector('.prob-overlay');
        if (oldOverlay) oldOverlay.remove();
        
        const prob = probGrid[row][col] || 0;
        if (prob > 0.001) {
          const overlay = document.createElement('div');
          overlay.className = 'prob-overlay';
          overlay.textContent = Math.round(prob * 100);
          overlay.style.opacity = Math.min(0.9, prob * 2); // 概率越高越不透明
          cell.appendChild(overlay);
        }
      }
    }
  } catch (error) {
    log(`概率计算失败: ${error.message}`, 'error');
  }
}

// ============================================================================
// 启动
// ============================================================================

init();
