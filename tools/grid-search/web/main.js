const form = document.getElementById('config-form');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const resumeBtn = document.getElementById('resume-btn');
const stopBtn = document.getElementById('stop-btn');
const downloadBtn = document.getElementById('download-btn');
const progressBar = document.getElementById('progress-inner');
const progressText = document.getElementById('progress-text');
const winTbody = document.getElementById('win-tbody');
const eloTbody = document.getElementById('elo-tbody');
const logArea = document.getElementById('log');
const earlyStopContent = document.getElementById('early-stop-content');

let polling = null;

// 配置缓存键名
const CACHE_KEY = 'grid-search-config';

// 默认配置
const DEFAULT_CONFIG = {
  alphaMin: 0.5,
  alphaMax: 0.9,
  alphaStep: 0.1,
  riskMin: 0.0,
  riskMax: 1.0,
  riskStep: 0.1,
  gamesPerPair: 30,
  workers: 16,
  topN: 10
};

// 从缓存加载配置
function loadConfigFromCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const config = JSON.parse(cached);
      // 合并缓存配置和默认配置（防止缓存中缺少新字段）
      return { ...DEFAULT_CONFIG, ...config };
    }
  } catch (err) {
    console.warn('加载缓存配置失败:', err);
  }
  return DEFAULT_CONFIG;
}

// 保存配置到缓存
function saveConfigToCache(config) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('保存配置到缓存失败:', err);
  }
}

// 应用配置到表单
function applyConfigToForm(config) {
  form.alphaMin.value = config.alphaMin;
  form.alphaMax.value = config.alphaMax;
  form.alphaStep.value = config.alphaStep;
  form.riskMin.value = config.riskMin;
  form.riskMax.value = config.riskMax;
  form.riskStep.value = config.riskStep;
  form.gamesPerPair.value = config.gamesPerPair;
  form.workers.value = config.workers;
  form.topN.value = config.topN;
}

// 从表单读取配置
function getConfigFromForm() {
  return {
    alphaMin: parseFloat(form.alphaMin.value),
    alphaMax: parseFloat(form.alphaMax.value),
    alphaStep: parseFloat(form.alphaStep.value),
    riskMin: parseFloat(form.riskMin.value),
    riskMax: parseFloat(form.riskMax.value),
    riskStep: parseFloat(form.riskStep.value),
    gamesPerPair: parseInt(form.gamesPerPair.value),
    workers: parseInt(form.workers.value),
    topN: parseInt(form.topN.value) || 10
  };
}

// 加载早停配置
async function loadEarlyStopConfig() {
  try {
    const res = await fetch('/api/early-stop-config');
    const config = await res.json();
    
    if (!config.enabled) {
      earlyStopContent.innerHTML = '❗ <strong>未启用</strong> - 将执行完整网格搜索';
      return;
    }
    
    earlyStopContent.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 0.9em;">
        <div>✅ <strong>已启用</strong></div>
        <div>最少对局: <strong>${config.minGamesBeforeStop}</strong></div>
        <div>探索期: <strong>${(config.explorationPhase * 100).toFixed(0)}%</strong></div>
        <div>淘汰截止: <strong>${(config.eliminationPhase * 100).toFixed(0)}%</strong></div>
        <div>ELO阈值: <strong>${config.eloThreshold}</strong></div>
        <div>胜率下限: <strong>${(config.winRateAbsoluteFloor * 100).toFixed(0)}%</strong></div>
        <div>最少存活: <strong>${config.minSurvivors}</strong> 个</div>
        <div>单次淘汰限制: <strong>${(config.maxEliminatePerCheck * 100).toFixed(0)}%</strong></div>
      </div>
    `;
  } catch (err) {
    earlyStopContent.innerHTML = '加载失败: ' + err.message;
  }
}

// 页面加载时读取配置
loadEarlyStopConfig();

// 页面加载时恢复缓存的配置
const cachedConfig = loadConfigFromCache();
applyConfigToForm(cachedConfig);

// 监听表单输入变化，自动保存到缓存
form.addEventListener('input', () => {
  const config = getConfigFromForm();
  saveConfigToCache(config);
});

form.onsubmit = async (e) => {
  e.preventDefault();
  if (polling) clearInterval(polling);
  winTbody.innerHTML = '<tr><td colspan="9" class="no-data">启动中...</td></tr>';
  eloTbody.innerHTML = '<tr><td colspan="6" class="no-data">启动中...</td></tr>';
  logArea.textContent = '';
  progressBar.style.width = '0%';
  progressText.textContent = '任务启动中...';

  // 从表单读取配置并保存
  const config = getConfigFromForm();
  saveConfigToCache(config);
  
  fetch('/api/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  polling = setInterval(updateProgress, 1000);
};

pauseBtn.onclick = async () => {
  await fetch('/api/pause', { method: 'POST' });
  pauseBtn.disabled = true;
  resumeBtn.disabled = false;
};

resumeBtn.onclick = async () => {
  await fetch('/api/resume', { method: 'POST' });
  pauseBtn.disabled = false;
  resumeBtn.disabled = true;
};

stopBtn.onclick = async () => {
  if (polling) {
    clearInterval(polling);
    polling = null;
  }
  await fetch('/api/stop', { method: 'POST' });
  progressText.textContent = '已完全停止';
  pauseBtn.disabled = true;
  resumeBtn.disabled = true;
};

downloadBtn.onclick = async () => {
  window.open('/api/result');
};

const updateProgress = async () => {
  const topN = parseInt(form.topN.value) || 10;
  const res = await fetch('/api/progress');
  const data = await res.json();
  
  // 更新进度条
  const progressPercent = ((data.progress || 0) * 100).toFixed(1);
  progressBar.style.width = progressPercent + '%';
  
  // 更新进度文字和按钮状态
  if (data.status === 'done') {
    progressText.textContent = `✅ 已完成 - 总耗时: ${data.elapsed.toFixed(1)}s`;
    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
  } else if (data.status === 'paused') {
    progressText.textContent = `⏸️ 已暂停 - 进度: ${Math.round(data.progress * 100)}% (${data.completed}/${data.total})`;
    pauseBtn.disabled = true;
    resumeBtn.disabled = false;
  } else if (data.status === 'terminated') {
    progressText.textContent = '⏹️ 已完全停止';
    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
  } else if (data.status === 'error') {
    progressText.textContent = '❌ 执行错误';
    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
  } else if (data.status === 'running') {
    progressText.textContent = `⏳ 进度: ${Math.round(data.progress * 100)}% (${data.completed}/${data.total}) | 已用: ${data.elapsed.toFixed(1)}s | 预计剩余: ${data.eta.toFixed(0)}s | 速度: ${data.speed.toFixed(1)}任务/s`;
    pauseBtn.disabled = false;
    resumeBtn.disabled = true;
  } else {
    progressText.textContent = '等待开始...';
    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
  }
  
  // 渲染胜率榜
  const winTopData = data.winTop.slice(0, topN);
  if (winTopData.length > 0) {
    winTbody.innerHTML = winTopData.map((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
      return `<tr>
        <td><span class="rank-medal">${medal}</span>${i + 1}</td>
        <td>${r.config.alpha.toFixed(2)}</td>
        <td>${r.config.riskAwareness.toFixed(2)}</td>
        <td><strong>${(r.winRate * 100).toFixed(1)}%</strong></td>
        <td>${r.wins}</td>
        <td>${r.losses}</td>
        <td>${r.draws}</td>
        <td>${r.games}</td>
        <td>${r.elo.toFixed(1)}</td>
      </tr>`;
    }).join('');
  } else {
    winTbody.innerHTML = '<tr><td colspan="9" class="no-data">暂无数据...</td></tr>';
  }
  
  // 渲染 Elo 榜
  const eloTopData = data.eloTop.slice(0, topN);
  if (eloTopData.length > 0) {
    eloTbody.innerHTML = eloTopData.map((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
      return `<tr>
        <td><span class="rank-medal">${medal}</span>${i + 1}</td>
        <td>${r.config.alpha.toFixed(2)}</td>
        <td>${r.config.riskAwareness.toFixed(2)}</td>
        <td><strong>${r.elo.toFixed(1)}</strong></td>
        <td>${(r.winRate * 100).toFixed(1)}%</td>
        <td>${r.games}</td>
      </tr>`;
    }).join('');
  } else {
    eloTbody.innerHTML = '<tr><td colspan="6" class="no-data">暂无数据...</td></tr>';
  }
  
  // 移除日志区域（不再需要）
  logArea.textContent = data.status === 'idle' ? '等待任务启动...' : 
    `状态: ${data.status} | 任务进度: ${data.completed}/${data.total}`;
  
  // 任务完成/终止时停止轮询（暂停时继续轮询以便恢复）
  if ((data.status === 'done' || data.status === 'terminated' || data.status === 'error') && polling) {
    clearInterval(polling);
  }
};

updateProgress();
