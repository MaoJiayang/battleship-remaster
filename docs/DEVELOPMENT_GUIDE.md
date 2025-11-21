# 后续开发与拓展指南

> 目标：帮助未来的开发者在不破坏现有结构的前提下，快速规划并接入新的模块或功能。本文只讨论流程与规范，不提供具体实现代码。

## 1. 整体认知
- **入口**：`src/main.js`，负责加载样式、初始化游戏。
- **核心逻辑**：`src/game/game.js` 当前仍为单体文件，内部已拆出 `initGame`、`bindUiEvents`、AI/部署/战斗等区域，可逐步拆分到子目录。
- **配置与数据**：
  - `src/config/constants.js` 存放通用常量。
  - `src/data/*.js` 定义舰船、难度等纯数据。
- **样式**：
  - `src/styles/base.css` 负责布局与通用样式。
  - `src/styles/ships.css` 管船体与美术细节。
- **构建**：Vite，`npm run dev/build/single` 对应开发、常规模式、单文件输出。

## 2. 新模块规划流程
1. **需求落地**：在 `docs/` 内增加新文档描述目标、交互、所需数据结构；明确是否属于 UI、系统逻辑还是 AI。
2. **确定层级**：
   - 纯状态/算法 → 新建 `src/game/core/xxx.js`。
   - UI/交互 → `src/game/ui/xxx.js` 或扩展 `bindUiEvents`。
   - 配置驱动 → 修改 `src/data/` 下对应文件，必要时新增 JSON/JS 配置。
3. **接口设计**：为模块暴露纯函数或类，避免直接操作 DOM 全局对象。推荐通过事件、回调或状态机接口与 `game.js` 交互。
4. **依赖注入**：在 `initGame` 或未来的 `GameApp` 里集中注册新模块，禁止在模块内部做 `document.getElementById` 之外的跨域读取。
5. **样式与资源**：
   - 新组件的样式写入 `src/styles/xxx.css` 并由 `main.js` 导入。
   - 美术资源放入 `public/` 或 `src/assets/`，通过 `import` 引入，以便被 Vite 处理。
6. **测试与文档**：开发完成后更新 `docs/`，描述使用方法、配置项、兼容性。

## 3. 推荐拆分路径
- **UI 层模块化**：将 `bindUiEvents` 中的逻辑拆到 `src/game/ui`，每个面板各自管理 DOM。
- **游戏状态管理**：创建 `src/game/core/state.js` 实现状态机，`game.js` 只负责 orchestrate。
- **AI 系统**：迁移 `calculateProbabilityGrid` 等函数至 `src/game/ai/` 目录，为未来难度扩展留口。
- **武器系统**：建立 `src/data/weapons.json` + `src/game/systems/weapons.js`，把攻击模式写成数据驱动，方便新增武器。

## 4. 引入全新模块的步骤示例
以“雷达模块”为例：
1. 在 `docs/FEATURE_RADAR.md` 写清规则、UI、数据需求。
2. 新建 `src/data/radar.js` 描述档位/冷却等。
3. 新建 `src/game/systems/radar.js`，暴露 `initRadar`, `activateRadar` 等函数。
4. 在 `initGame` 中注册模块，并在 `bindUiEvents` 里绑定按钮或快捷键。
5. 若需要界面元素，在 `index.html` 中增加挂载点（或运行时动态创建），配套样式写入 `src/styles/radar.css`。
6. 补充日志、文档，并在 `README` 或 `docs/CHANGELOG.md` 中说明。

## 5. 版本与构建
- 新模块合并前应在 `npm run dev` 下自测全部核心流程，再跑 `npm run build` 与 `npm run single` 确认输出无误。
- 保持 `package.json` 的脚本语义：
  - `npm run dev`：开发调试。
  - `npm run build`：常规部署版本。
  - `npm run single`：单文件离线版本，适合分发。

## 6. 代码风格与约定
- 所有文案、注释、文档默认使用中文。
- DOM 选择器、类名保持语义化，避免硬编码操作链。
- 新增文件请使用 UTF-8，无 BOM。
- 每个模块都应提供最小对外 API，防止出现新的“巨石”文件。

按照以上流程，未来无论新增玩法、AI、UI 面板还是数据驱动系统，都可以在现有架构上快速、安全地迭代。