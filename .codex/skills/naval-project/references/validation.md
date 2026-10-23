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

## 接手验证快照

日期：2026-10-24；代码基线：`3b17b80`。

- `SELFTEST OK`、`ROOM SELFTEST OK`。
- 常规及单文件构建通过，输出到系统临时目录，保留仓库原有 `dist/`。
- 实际打开本机开发服务，查看了桌面部署、战斗、390×844 手机画面、双方海域、武器选择及扫描动画；测试期间捕获的警告和错误列表为空。
- 初步画面观察：已有统一的深色舰桥仪表风格和细节舰体；桌面说明字号较小，手机棋盘下方有较大留白。它们是后续体验讨论点，尚未做改版选择。
- 尚未完成完整浏览器对局回归、真机触控、帧率和音频听感测评，也未验证真实网络对战。
- 依赖存在本地漂移：根包声明 Vite `^5.2.0`、锁文件为 `5.4.21`，当时实际 `node_modules` 为 `7.2.4`；本机 Node.js 为 `v22.17.0`。构建通过仅证明该已安装环境，后续核对安装与复现环境时需注意。

以上均为一次验证快照；未来工作读取当前源码并执行与改动相称的验证。
