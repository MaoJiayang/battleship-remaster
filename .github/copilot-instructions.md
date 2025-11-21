## 总纲
- 在任何情况下，请使用中文回答与思考问题
- 代码中的文档，注释等请使用中文
## 项目速览
- **类型**：使用 Vite 构建的浏览器端海战棋(+AI)策略游戏，入口 `index.html` + `src/main.js`。
- **运行脚本**：`npm run dev` 启动开发服务器；`npm run build` 生成常规产物；`npm run single` 借助 `vite-plugin-singlefile` 打包单文件离线版。
- **核心依赖**：仅 Vite 及 `vite-plugin-singlefile`，其余逻辑与样式均为原生 JS/CSS。
## 目录理解
- `src/game/game.js` 担任“大脑”，包含部署、武器、AI、UI 事件绑定等所有流程，后续可按 `docs/DEVELOPMENT_GUIDE.md` 建议拆分。
- `src/config/constants.js`、`src/data/*.js` 提供棋盘尺寸、舰船、难度等纯配置；如增添武器/船型，应同步维护这些文件。
- `src/styles/base.css` 处理布局、棋盘、UI 控件、状态样式；`src/styles/ships.css` 专注船体细节与动画。
- `docs/设定.md` 记录攻击机制、船只参数、格位状态机及 AI 运算逻辑；`docs/DEVELOPMENT_GUIDE.md` 阐述扩展流程。
## 游戏机制要点
- **部署阶段**：玩家拖拽 `SHIP_TYPES` 定义的 5 艘舰船至 `player-grid`；`autoDeploy` 可随机摆放，`currentDeployMode` 控制水平/垂直，`firstTurn` 可切换先手。
- **战斗阶段**：`AP/HE/SONAR` 三套武器，其中空袭需 `CV` 存活、水听需 `DD` 存活，主炮伤害取决于 BB/SS/CL 的存活情况 (`getAPDamage`)。
- **敌方 AI**：依据 `DIFFICULTY_SETTINGS`（默认 HARD）构建概率热力图、评估武器收益并引入随机扰动；调试模式可显示 AI 热力分布。
- **胜负与 UI**：`checkWin` 判定全灭后弹出 `game-over-modal`，并通过 `revealEnemyShips` 显示敌舰；`log()` 统一记录战况。
## 研发注意事项
- 保持所有中文文案、注释与文档风格一致；新增样式需在 `main.js` 或对应模块显式导入。
- 修改 AI 或武器需同步更新 `docs/设定.md` 中的表格与说明，确保文档与实现对齐。
- 若计划拆分 `game.js`，优先按 UI / 核心逻辑 / AI / 系统工具划分目录，避免出现新的单体文件。