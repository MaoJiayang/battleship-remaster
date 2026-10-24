# 验证与模拟

## 构建与行为验证

从仓库根目录运行，按改动范围选择：

```powershell
npm run dev
npm run build
npm run single
node tools/agent-arena/cli.mjs selftest
node tools/agent-arena/room-cli.mjs selftest
```

- 常规构建与单文件构建共用 `dist/`，后执行者覆盖前者。只做核查时可输出到临时目录，保留已有发布产物。
- `arena` 自测使用固定名字的临时会话并会清理。隔离运行可设置进程级 `HZQ_ARENA_DIR`；房间自测主要操作内存对象。
- 根包没有标准 `npm test` 或 lint 脚本；不要把调参工具的 `--test` 当成完整单元测试。
- 自测覆盖确定性回复、合法行动、对局结束，以及房间版本、座位与隐藏信息等行为；不代替界面回归。

保留 `dist/` 的构建核查示例：

```powershell
$checkRoot = Join-Path $env:TEMP ('hzq-check-' + [guid]::NewGuid().ToString('N'))
node node_modules/vite/bin/vite.js build --outDir (Join-Path $checkRoot 'normal')
node node_modules/vite/bin/vite.js build --mode single --outDir (Join-Path $checkRoot 'single')
```

## 实际体验与性能

- 视觉体验使用浏览器截图实际检查。至少覆盖本次改动涉及的部署、战斗或结算画面，按需查看桌面和窄屏；手机使用真实的武器选择与海域切换操作。
- 动画检查包含触发后的画面及结束状态；只看静态布局不能判断运动连贯性。帧率、长任务、绘制与内存需要单独测量。
- 拖拽部署检查放置、旋转、越界、重叠及回港；武器检查预览和结算一致、无效目标不消耗回合、能力丢失及阵营特例。
- 重开检查在途 Worker、计时器、旧特效和视野标记；先手及手机自动切视角也会影响流程。
- AI 计算与动画等待要分开计时。`INTERACTION_TIMING`、`clickEnemy()` 的武器特效延迟、`scheduleAiTurn()` 共同决定等待；服务器纯数据模拟不能证明手机绘制性能。
- 音效区分源码触发、音频实际输出和听感评价。缺少录音或试听证据时只报告已核实部分。

## 模拟工具选择

| 目的 | 工具 |
| --- | --- |
| 阵营循环赛、学说参数 A/B | `tools/sim/runner.mjs`、`compare.mjs` |
| alpha、风险权重参数搜索 | `tools/grid-search/run.js` 及其 Worker |
| 浏览器交互式搜索 | `src/ai/GridSearch.js`，入口暴露为 `window.GridSearch` |
| 局面、概率与模拟可视化 | `tools/grid-search/web/` |
| 人工或代理对战、房间协议检查 | `tools/agent-arena/` |

修改模拟规则时核对 `SimulationEngine`、实战武器和共用结算器；复用已有入口与随机数工具。

### 阵营循环赛

```powershell
node tools/sim/runner.mjs tools/sim/spec.example.json tools/sim/runs/base.json
node tools/sim/runner.mjs tools/sim/spec.variant.json tools/sim/runs/variant.json
node tools/sim/compare.mjs tools/sim/runs/base.json tools/sim/runs/variant.json
```

第二条的变体配置需根据本次实验创建，内容可参考 `spec.example.json`。基础配置和变体配置要分别保存。

- 7 阵营共 21 种两两对阵，每对 `pairs` 组、交换座位，合计 `42 × pairs` 局。
- 每组双方使用同一舰队控制布阵差异；固定随机种子，阵营交换先后手。该实验分布与真人自定义布阵有所区别。
- 输出汇总及 `-shardN.json` 分片；包含胜率、先手率、命中率、伤害、声呐比例、手数和 Bradley–Terry 相对强度估计。
- `doctrineOverrides` 在 Worker 内深合并学说，不写回源码；`neutralBias=true` 关闭 AI 人格偏好，保留机制。
- A/B 使用相同 `seedOffset`；比较器允许基线组数更多，截取相同组数。先单变量筛选，再用独立种子验证。
- `pairs=50/100` 是工具文档提供的筛选、验证起点，应结合效果量和区间宽度决定样本；少量冒烟对局只用于运行核查。
- 胜率属于当前 AI、布阵方式、预算与参数共同形成的结果，真人玩法还需实测。
- 新实验保留源码版本或内容哈希、配置、种子及输出。现有汇总 `options` 未完整记录所有 AI 参数与源码版本，仅凭汇总文件不足以复现实验。

## SSH 远端环境

用户指定 `desktop-a1e0nc0` 桌面 `naval` 供模拟使用，理由是该机单核性能更好。

2026-10-24 接手时已实连核实：

- 主机可用非交互 SSH 连接；账户桌面路径为 `C:\Users\Administrator\Desktop\naval`。
- CPU 为 AMD Ryzen 5 9600X，6 核 12 线程；Node.js 为 `v24.22.1`。没有进行与本机的受控性能对比。
- `naval/bench` 存有 `src/`、旧模拟脚本、配置及多轮实验输出；不是 Git 检出。
- 其中 `aiCore.js`、`aiStrategy.js`、`SimulationEngine.js`、`doctrines.js` 的内容哈希与本地不同，归一化换行后仍不同；不能直接用旧结果代表当前版本。
- 本次将当前 `src/`、`tools/sim/`、`package.json` 放入独立目录 `naval/context-audit-20261024`，以 3 个进程、`pairs=2`、种子 8181 跑了 84 局，0 平局，汇总耗时约 7 秒。
- 配置和输出分别为该目录的 `smoke-spec.json`、`smoke-out.json` 及分片。它们是运行链路验证，不能据此宣布阵营强弱或算法优化收益。

后续模拟先确认目录、空闲资源和当前源码，再创建独立实验目录，保留原有文件。进程数按任务规模和资源情况决定，避免简单按逻辑处理器数量开满。SSH 调用 PowerShell 时可用 `-EncodedCommand` 传递脚本，减少本机与远端两层转义问题。

### 远端训练环境

用户要求集中在 `C:\Users\Administrator\Desktop\naval\ai-training`，只保留最终采用的一套虚拟环境。解释器放 `python312/`、当前采用原生 ROCm 的 `venv-rocm/`；安装包放 `downloads/`，缓存、日志和检查结果分别放 `pip-cache/`、`logs/`、`results/`。训练脚本与依赖清单复制到该目录根；不要混用历史模拟目录的源码。

- 2026-10-24 实查为 Windows 11，独立显卡 RX 9060 XT，驱动版本 `32.0.32015.7029`；另有核显和虚拟显示设备，验证脚本按名称明确选择独显。最初 `python/python3` 仅有微软商店别名，无可用 Python 或 `py`。
- `downloads/python-3.12.10-amd64.exe` 来自华为镜像，Authenticode 签名有效，签名方为 Python Software Foundation；SHA256 为 `67B5635E80EA51072B87941312D00EC8927C4DB9BA18938F7AD2D27B328B95FB`。自动安装命令被工具策略拦截后由用户手动安装，随后实查 Python 3.12.10、64 位、解释器和虚拟环境路径正确，`include-system-site-packages=false`。无需重启，未改系统 PATH、系统脚本执行策略或显卡驱动。
- 最终环境为 `torch==2.14.0+rocm10.1.0`，ROCm SDK 10.1.0，报告的 HIP 版本为 `7.16.26385`。AMD 的旧 Radeon 7.2.1 页面有 Windows 训练限制，后续依据[新版统一安装文档](https://rocm.docs.amd.com/projects/ai-ecosystem/en/latest/frameworks/pytorch/install.html)选择架构 `gfx1200`，并实际检查前向、反向和更新；不能仅凭显卡出现在支持表中判断训练可用。
- 普通依赖固定在 `tools/training/requirements-common.txt`，使用阿里 HTTPS 源；清华源在远端返回 403，阿里与华为镜像可访问。用户已允许 AMD 专用包使用官方源，`requirements-rocm.txt` 固定 8 个官方安装包 URL 与 SHA256，其余依赖先从国内源安装；专用包安装使用 `--no-deps --no-build-isolation`。虚拟环境内保存 `pip.ini`，不修改全局 pip 配置。
- 在远端 PowerShell 执行 `& 'C:\Users\Administrator\Desktop\naval\ai-training\python312\python.exe' 'C:\Users\Administrator\Desktop\naval\ai-training\prepare-environment.py' --root 'C:\Users\Administrator\Desktop\naval\ai-training'`。维护脚本创建或复用唯一的 ROCm 虚拟环境，分来源装依赖、运行 `pip check`、保存 `requirements-installed.txt`，再运行合成训练及注意力检查。采用 Python 入口，适配该机禁止直接运行 PowerShell 脚本的设置。
- `check-environment.py --backend rocm --attention-smoke` 验证 64→64→32→1 网络的 CPU/显卡前向一致性、反向传播、参数更新及损失下降；另检查 32 维、2 头、16 个输入位置的注意力前向和有限梯度。显式按名称选择 RX 9060 XT，记录警告及含同步的训练吞吐；`--backend cpu` 可独立复查。它不训练游戏模型，也不是棋力、JavaScript 推理或手机性能验收。
- 原生 ROCm 已通过上述检查，`results/rocm-check.json` 的 1024 批量、60 次更新约为显卡 55.3 毫秒、同版本单线程 CPU 145.2 毫秒；`rocm-large-attention-check.json` 的 16384 批量为显卡 213.3 毫秒、CPU 1066.4 毫秒，注意力前向最大差约 `1.34e-7`，两项均无捕获警告。它们是合成训练快照，不代表真实游戏网络或推理速度；最终维护入口另将最新验证存为 `environment-check.json`。
- 早先 DirectML 0.2.5.dev240914＋PyTorch 2.4.1 也能完成小网络训练，但 `log_sigmoid_forward` 会回退 CPU；1024 批量的 60 次更新约 274.6 毫秒，同版本单线程 CPU 33.4 毫秒。与原生 ROCm 的 PyTorch 版本不同，不作为严格同版本后端对照。DirectML 需要在首次 CPU 反向传播前导入并初始化，否则本次实测触发自动求导设备队列断言；已在检查器中修正。按用户要求最终移除备用 DirectML 虚拟环境，仅保留结果及日志。
- 原生 GRU 曾因 HIPRTC 缺少 `type_traits` 失败，CPU 检查及卷积／注意力通过不能覆盖这一融合内核。用户允许补齐依赖，并授权以后优先从本机同步必要环境，避免长期停留在有性能损失的替代路径。本机已有 VS Build Tools 2022 的 MSVC `14.44.35207` 与 Windows SDK `10.0.26100.0`；仅归档 VC `include` 与 SDK `ucrt/shared`，约 4.38MB，SHA256 `aa07e3d1a1c166d00aa44927619e7e2e6254f48e6b9a094bed22ee2016324c85`，远端放入 `toolchain-headers/msvc-14.44.35207-sdk-10.0.26100.0`。未安装 VS、未改驱动或系统 PATH。
- `install-standard-headers.py --root <ai-training> --archive <目录内归档.tgz> --sha256 <校验值> --msvc 14.44.35207 --sdk 10.0.26100.0` 校验并准备头文件，先执行原生 GRU 验证，再写 `rocm-headers.json`。`rocm_runtime.py` 按虚拟环境位置读取配置，只为当前训练进程设置 `HIPRTC_COMPILE_OPTIONS_APPEND`；目录必须在集中根内且无空格。`check-gru-backend.py --output <新报告.json>` 复核自动配置，也可显式 `--includes` 诊断。
- 首次显式路径验证 `results/gru-native-headers-first.json` 已通过批量 1／长度 1 和批量 32／长度 40 的前向、反向及 20 次更新，前向最大差约 `1.86e-7`、梯度差约 `7.45e-9`。首次编译约 15／5 秒，属于离线训练内核冷启动，不是玩家端推理时延。普通 ROCm 运行包外另检查了约 246MB 的 AMD 开发包，未安装；其内的 HIP/CUDA 标准库变体不能直接当作此处的 MSVC 标准头文件。
- `results/gru-native-configured.json` 已在不传 `--includes` 的新进程中复测通过，确认自动配置有效；批量 32／长度 40 的 20 次更新约 0.128 秒，该微基准不能替代完整 PPO 吞吐对照。后续遇到类似缺失可按用户授权主动同步本机必要内容；需要下载时微软官方源也已允许，必要时可安装 VS，本机 7890 代理端口已确认可达。本次实际没有安装 VS。

### 新旧算法配对验证

`node tools/sim/strength.mjs <配置.json> <输出.json>` 用同学说、两套独立随机舰队交换算法座位，固定种子比较候选与旧 AI；与上面的阵营循环赛用途不同。

- 7 学说合计 `14 × pairs` 局；配置支持 `pairs`、`jobs`、`seedOffset`、`maxPlies`、`factions`、`sameFleet`、`candidate.tuning` 和 `opponent.tuning`。
- 可显式设置 `matchups: [["us", "ijn"], ["ijn", "us"]]`，每组分别指定候选及对手的学说，并交换算法座位；省略时保持原同学说对照及种子。输出 `matchups` 为逐对阵统计，`factions` 按候选学说聚合，不能将该聚合直接视为双方阵营的公平循环赛排名。新旧算法完整交叉对照可提供 49 个有序组合；同一模型的阵营平衡检查可提供 21 个不同学说组合，分别查看成对胜率和区间。
- 候选默认显式开启实验搜索，对手显式关闭；游戏默认开关不会改变该实验含义。具体实验必须保存完整配置。
- 候选默认启用快速采样，对手显式 `fastSampling=false`，冻结原慢采样作为历史基准。比较搜索本身时再设 `opponent.tuning.fastSampling=true` 做消融；单纯快速采样改变随机数消耗顺序，不能把点估计上升直接当作搜索增益。
- 默认候选设 `searchFixedIterations=true`，便于固定种子回归；验证实际统一时间预算时显式设为 `false`，计时依赖运行负载，不能保证跨进程数逐局一致。单手时延验证优先单进程，批量吞吐测试可用 10 进程。
- 按“学说 × 对局组 × 座位”分片，默认 8 进程，远端当前可显式设 `jobs=10`；进程优先级低于普通，窗口隐藏。交换座位仍使用同组舰队与固定种子，并行度不改变棋局；小样本的尾段任务分配更均匀。
- 当前协议按座位、回合独立设随机数，避免思考消耗改变对手随机流；同算法交换座位控制组完全对称。汇总含源码及脚本内容哈希、协议标记、双方配置、按完整对局组计算的有界均值区间、成对胜负变化、改招次数、复核样本数、超时、推断回退及初始化耗时；分片保留原始行。计时受并发争用影响，不代表浏览器单手耗时。
- 当前报告另含 `layoutHash`，覆盖实际布阵采样模块；`strength-selftest.mjs` 同时验证默认对照与跨学说对照在不同并行度下保留完整对局并产生相同结局。
- r14 起初始化计时另含 `validationInferenceP95Ms`，逐手第三个阶段计时为冻结候选后的独立后验重建；不要只看初次 `inferenceP95Ms` 就认为覆盖全部推断成本。
- 实验进度及未验收限制见 [AI 实验进度](ai-research.md)。

### 游戏网络采集、训练与导出

- `node tools/training/generate-data.mjs <配置.json> <全新数据目录>`。`mode=warmup` 使用无搜索旧困难 AI，仅记录终局价值；`mode=selfplay` 必须指定相对配置文件的 `model`，固定 `searchIterations`（默认 64）、按根访问概率探索。训练无 16 毫秒逐手约束，可显式增加搜索量；`games/jobs/seed/tuning` 全部存入清单。
- 数据包含 `features.f32`、`targets.f32`、`masks.u8` 和分片清单；完整清单记录模型及源码哈希。布局交换组 `splitGroup` 跨分片保持一致，按该组哈希分出验证集，避免镜像布局泄漏；物理规则指纹不同的数据不能混合。
- 使用唯一 ROCm 环境执行 `train.py <数据目录...> --output <全新模型目录> --architecture attention --epochs 12`；全连接基线用 `--architecture mlp`，自对弈可用 `--resume <旧模型.json>`。输出模型、训练指标、权重和 16 个真实验证局面数值对照；普通游戏无需 Python。
- `node tools/training/validate-model.mjs <模型.json> <parity.json>` 检查前向误差，再预热并记录 300 次 JavaScript 推理中位与尾延迟；该计时不含观测构建、后验采样及整手搜索，不能称作整手或手机时延。
- `strength.mjs` 支持 `candidate.model`、`opponent.model`（相对配置文件），汇总保存权重 SHA256。离线高搜索量棋力与单进程低工作量／限时性能分别验证，不能用并发批量的逐手计时代表实战。
- 新模块行为验证为 `node tools/training/selftest.mjs`，并回归原搜索、配对、并行度、校准及多人房间自测。仍保留默认原 AI，不因训练损失下降自动启用模型。
- 本轮独立源码与产物集中在远端 `ai-training/runs/neural-20261024-r1` 至 `r4`；每版独立归档，不覆盖前版。实际 CNN 训练可完成前后向，但 MIOpen 报告 `gfx120020.HIP.fdb.txt` 性能库不可读警告；这不同于先前无警告的合成环境检查，尚未据此改驱动或系统设置。
- 欠拟合及标签诊断用 `audit-data.py <自对弈数据目录> --models <模型.json...> --output <新报告.json> --fit-records 64 --fit-steps 2048`，在唯一 ROCm 环境执行。分别查看训练／验证价值误差、策略交叉熵减标签熵后的散度和小样本拟合曲线；小样本拟合成功不是完整泛化证明。`r5`、`r6` 保存原 16 轮与延长训练的对照。
- `candidate.tuning.neuralPolicy=false` 在保留同一模型价值输出的同时关闭策略选招与排序，用于隔离对照；不改模型的 `policyTrained` 元数据。该元数据仅说明策略头参与过训练，不能替代棋力或收敛验收。
- `train.py` 同时保存逐轮训练／验证指标及实际更新数，策略损失只按有标签样本汇总；`training-selftest.py` 验证汇总与双头训练梯度。`node tools/training/data-selftest.mjs` 验证采集器在手数截止时不添加未执行动作，平局价值为 0.5，镜像布阵组跨分片共享。两项均保留临时证据，不修改正式对局数据。

### 公开历史、直接策略与 PPO

- `expert_data.py --output <新数据目录> --batches 20 --games 98 --seed 240126` 在同一 ROCm 虚拟环境采集无搜索、快速采样旧 HARD 对局；`paired=false` 避免教师双方固定策略造成完全重复的配对局，每批 98 局两次覆盖 49 个有序学说组合，布阵分布仍按种子抽取。环境返回实际行动、行动座位及非私有配置，采集器只在核对实际出招后写标签。
- 监督数据 `naval-expert-v1` 以压缩 NumPy 分片保存当前公平特征、合法行动、真实标签和共享公开事件；每条局面保存历史前缀长度，双方及同局所有时刻共用整局哈希分割，约五分之一为验证。清单保留源码、每片校验、布阵族、学说、种子及真实终局／截断。截断价值标签禁用，不填平局；数据只加载本项目可信文件。
- `expert_train.py <监督数据目录> --initial <起步 JSON> --kind gru --output <新目录> --epochs 32 --minibatch 128` 训练原结构，`attention` 为另一对照。合法行动交叉熵与正常终局价值交叉熵相加，AdamW、学习率默认 0.0003、梯度裁剪 0.5；按验证总损失保留 `model.json`，同时保存每轮权重及双集合策略／价值误差、行动一致率、Brier 误差和实际更新数。监督预热不改变部署参数量，后续仍用 PPO 和独立棋力验收，不能把模仿准确率当胜率。
- `expert-selftest.py` 覆盖真实行动可复现、独立布局、整局分割、历史截止、真实胜负价值、截断价值排除、两结构有限更新、批量无关评估、非法标签拒绝及数值对照导出。2026-10-24 远端 r22 自测与 PPO／训练自测均通过；14 局冒烟采集 606 个实际决策、0 截断，两结构各一轮显卡更新后 JavaScript 最大误差约 `2.62e-6/2.38e-6`。该冒烟没有棋力结论；真实训练继续有已知 MIOpen 性能库警告。
- `node tools/training/policy-selftest.mjs` 检查公开历史不可被后续行动改写、双方相对身份、手数截断与真实终局分开、批量 JSON 环境的末端公平观测，以及联合均匀布阵合法性。`ppo-selftest.py` 在现有虚拟环境执行，检查实际采样与训练对数概率一致、截断使用末端价值而非固定平局，以及 PPO 能更新有限参数。
- `ppo.py --initial <起步模型.json> --kind gru --output <全新目录> --games 98 --iterations 16 --epochs 4 --minibatch 64` 使用原生 ROCm；`--kind attention` 是相同空间模型的历史注意力对照。每批重新采集实际出招轨迹，两种布阵分布按种子及对局组抽取，避免与固定学说组合绑定；98 局覆盖有序学说组合，训练不受玩家实战 16 毫秒目标限制。r10 原试验按组奇偶交替布阵，学说与分布仍有绑定，该历史局限需保留。
- 起步可用旧空间模型，也可用同种历史结构的已训练 JSON 权重。每轮保存 `iteration-NNN.json`、指标与逐局结果；最新实现另保存优化器、历史对手和随机数状态的 `checkpoint-NNN.pt`。`--resume <检查点.pt>` 在新输出目录继续，种子、结构与规则需要匹配。r11 已用强制一手截断完成保存／恢复／下一轮更新和导出验证；检查点只加载本项目自行生成的可信文件。
- PPO 轮次指标按 `old-HARD/current/history` 分列对局数、胜负得分和截断，避免混合总胜率掩盖对固定基准退化；训练行为为合法概率分布采样，默认配对评估为贪心，两者需要在冻结权重的配对条件下分别验收。模型自对弈胜率接近一半不能替代基准棋力。
- `ppo_audit.py --model <历史模型.json> --output <新报告.json> --games 98 --batches 8 --minibatch 64` 冻结参数，采集旧 HARD／当前模型两类对手，按整批轨迹标准化优势，再分别记录概率重算误差、熵、最大动作概率、各损失梯度范数／夹角及总梯度裁剪尺度。诊断保留原参数与模式；原生 MIOpen GRU 反向需要训练模式，诊断器临时切换后恢复，网络当前没有随机失活或批量归一化层。
- 这些梯度仅诊断固定模型、固定新采样轨迹的局部更新，不证明训练因果或完整收敛。r15 的首次 GPU 诊断因在评估模式下反向失败，r16／r17 修正后已通过两结构的真实 GPU 检查及无更新自测。
- `node tools/training/validate-memory.mjs <模型.json> <parity.json>` 检查 PyTorch／JavaScript 误差、完整历史与分段增量缓存一致，以及单次追加事件的预热耗时；它不包含当前棋盘观测编码。历史注意力为当前局面查询过去事件、双头、顺序位置编码，不能称作完整自回归 Transformer。
- 配对配置 `candidate: { model: "相对配置文件的模型.json", direct: true, tuning: { search: false } }` 启用直接策略；默认贪心决策，训练按合法分布采样。可选 `stochastic=true` 评估训练行为分布，`layout=uniform` 使用联合均匀布阵对照，默认仍为原分散布阵。历史模型必须显式 `direct=true`，避免静默以空历史参加搜索。
- 报告新增 `truncations/scoreBounds`，存在未解决的截断时 `rate=null`、区间不作有效胜率证据；保留原 `winner='DRAW'` 仅作旧字段兼容。另报告获胜对局的总手数中位及每次行动实际伤害，作为效率辅助指标；胜局样本变化会影响这些条件统计，不能直接当作普遍因果收益。
- 用户已批准对齐训练截止到下一次学习方决策；PPO 重置传 `learnerSeats`，环境最多延长一手对手行动，末端返回并核对 `currentSeat/learnerSeat`。未传学习座位时保持原手数上限。`policy-selftest.mjs` 覆盖 1–4 手、双方座位、实际行动数及正常制胜优先；`ppo-selftest.py` 复演对手补走后再比较末端价值。2026-10-24 本机 Node 与远端 r19 的 Node／CPU PyTorch 行为验证均通过；本机 Python 没有 PyTorch，未在本机执行该 Python 自测。所有已用于棋力分析的正式规模 PPO 批次均为 0 截断。
- 这些路径当前仅用于模拟实验，浏览器及多人桩没有自动装载新权重；节点计时包含候选决策与该手实际模拟结算，真机、浏览器动画及模型单文件打包仍需在候选通过棋力筛选后验证。

`node tools/sim/calibration.mjs <配置.json> <输出.json>` 捕获模型通过复核的行动，在相同的真实布局快照上分别强制执行候选与基准，再用旧困难 AI 继续双方对局；继续策略的随机条件配对。配置支持 `games`、`limit`、`continuations`、`modelContinuations`（默认 128）、`seedOffset` 和 `tuning`。完整布局仅供外部评估器执行物理环境，决策输入仍由模拟引擎过滤。

- 该工具诊断模拟收益与真实布局/旧 AI 继续策略参照的差异；完整棋力仍看新旧算法配对赛。
- 另从公开上下文重新生成模型池，冻结已选行动后重估模拟收益；输出分别记录录取差、新模型复核差与真实布局参照差。录取差有候选选择与提前停止偏差，不可直接作为无偏预测计算校准误差。
- `node tools/sim/calibration.mjs --selftest` 验证强制制胜/失误、快照隔离和可重复性。
- 默认模式保持旧 AI；`npm run ai:lab` 显式在 5175 开启实验困难 AI。Vite 可能只监听 IPv6 的 localhost，按启动输出使用 `http://localhost:5175/`；普通模式及单文件构建不受影响。

### 代理通过多人桩实际游玩

```powershell
$env:HZQ_ROOM_DIR = Join-Path $env:TEMP 'hzq-playtest-独立任务标识'
node tools/agent-arena/room-cli.mjs new play1 us us --controllers=human,ai --level=HARD --seed=240125 --ai=search
node tools/agent-arena/room-cli.mjs status play1 --seat=A
node tools/agent-arena/room-cli.mjs fire play1 SONAR 6 6 --seat=A
node tools/agent-arena/room-cli.mjs log play1 --seat=A
```

- `--ai=search` 显式使用与浏览器实验模式相同的 HARD 搜索配置；省略则使用默认评分策略。房间及分座位视图记录模式，状态文本展示模式，重载后继续生效。
- 用户允许必要时委派小参数模型亲自操作。参赛代理只看自己座位的 `status/log`，逐手选择，不读取房间文件或对方私有视图；房间 JSON 内有隐藏布阵。已看过某局赛后阵型时改用新种子。
- 保留房间 ID、种子、目录、具体手数与当时可见依据。区分已有命中后追击、目标已沉后的重新探索；不把猜中、单局输赢或 CLI 棋盘当作总体棋力及视觉证据。

## 接手验证快照

日期：2026-10-24；代码基线：`3b17b80`。

- `SELFTEST OK`、`ROOM SELFTEST OK`。
- 常规及单文件构建通过，输出到系统临时目录，保留仓库原有 `dist/`。
- 实际打开本机开发服务，查看了桌面部署、战斗、390×844 手机画面、双方海域、武器选择及扫描动画；测试期间捕获的警告和错误列表为空。
- 初步画面观察：已有统一的深色舰桥仪表风格和细节舰体；桌面说明字号较小，手机棋盘下方有较大留白。它们是后续体验讨论点，尚未做改版选择。
- 尚未完成完整浏览器对局回归、真机触控、帧率和音频听感测评，也未验证真实网络对战。
- 依赖存在本地漂移：根包声明 Vite `^5.2.0`、锁文件为 `5.4.21`，当时实际 `node_modules` 为 `7.2.4`；本机 Node.js 为 `v22.17.0`。构建通过仅证明该已安装环境，后续核对安装与复现环境时需注意。

以上均为一次验证快照；未来工作读取当前源码并执行与改动相称的验证。
