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

### 新旧算法配对验证

`node tools/sim/strength.mjs <配置.json> <输出.json>` 用同学说、两套独立随机舰队交换算法座位，固定种子比较候选与旧 AI；与上面的阵营循环赛用途不同。

- 7 学说合计 `14 × pairs` 局；配置支持 `pairs`、`jobs`、`seedOffset`、`maxPlies`、`factions`、`sameFleet`、`candidate.tuning` 和 `opponent.tuning`。
- 候选默认显式开启实验搜索，对手显式关闭；游戏默认开关不会改变该实验含义。具体实验必须保存完整配置。
- 候选默认启用快速采样，对手显式 `fastSampling=false`，冻结原慢采样作为历史基准。比较搜索本身时再设 `opponent.tuning.fastSampling=true` 做消融；单纯快速采样改变随机数消耗顺序，不能把点估计上升直接当作搜索增益。
- 默认候选设 `searchFixedIterations=true`，便于固定种子回归；验证实际统一时间预算时显式设为 `false`，计时依赖运行负载，不能保证跨进程数逐局一致。单手时延验证优先单进程，批量吞吐测试可用 10 进程。
- 按“学说 × 对局组 × 座位”分片，默认 8 进程，远端当前可显式设 `jobs=10`；进程优先级低于普通，窗口隐藏。交换座位仍使用同组舰队与固定种子，并行度不改变棋局；小样本的尾段任务分配更均匀。
- 当前协议按座位、回合独立设随机数，避免思考消耗改变对手随机流；同算法交换座位控制组完全对称。汇总含源码及脚本内容哈希、协议标记、双方配置、按完整对局组计算的有界均值区间、成对胜负变化、改招次数、复核样本数、超时、推断回退及初始化耗时；分片保留原始行。计时受并发争用影响，不代表浏览器单手耗时。
- r14 起初始化计时另含 `validationInferenceP95Ms`，逐手第三个阶段计时为冻结候选后的独立后验重建；不要只看初次 `inferenceP95Ms` 就认为覆盖全部推断成本。
- 实验进度及未验收限制见 [AI 实验进度](ai-research.md)。

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
