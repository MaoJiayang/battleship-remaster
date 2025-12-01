## 总纲
- 在任何情况下，请使用中文回答与思考问题
- 代码中的文档，注释等请使用中文

## 项目速览
- **类型**：使用 Vite 构建的浏览器端海战棋(+AI)策略游戏，入口 `index.html` + `src/main.js`。
- **运行脚本**：`npm run dev` 启动开发服务器；`npm run build` 生成常规产物；`npm run single` 借助 `vite-plugin-singlefile` 打包单文件离线版。
- **核心依赖**：仅 Vite 及 `vite-plugin-singlefile`，其余逻辑与样式均为原生 JS/CSS。

## 目录结构
```
src/
├── main.js                    # 入口，导入样式与初始化
├── config/constants.js        # 棋盘尺寸、格子大小、交互时间等常量
├── data/
│   ├── ships.js               # SHIP_TYPES 舰船定义
│   └── difficulties.js        # DIFFICULTY_SETTINGS 难度配置
├── ai/
│   └── aiStrategy.js          # AI 决策模块（信息论 + 蒙特卡洛）
├── game/
│   ├── game.js                # 主控制器：部署、回合流程、UI 事件
│   ├── weapons/               # 武器系统（已解耦）
│   │   ├── WeaponBase.js      # 抽象基类：canUse/previewArea/resolve
│   │   ├── WeaponTypes.js     # 类型定义：BattleContext/ShipState/事件工厂
│   │   ├── WeaponRegistry.js  # 武器注册中心
│   │   ├── WeaponService.js   # 武器服务：协调执行与渲染
│   │   ├── APWeapon.js        # 主炮实现
│   │   ├── HEWeapon.js        # 空袭实现
│   │   └── SonarWeapon.js     # 水听实现
│   └── battle/                # 结算与渲染（纯数据层 + 视图层分离）
│       ├── HitResolver.js     # 命中结算器（纯数据，不操作 DOM）
│       ├── SonarResolver.js   # 声纳结算器
│       └── BattleRenderer.js  # 事件渲染器（统一处理 DOM 更新）
└── styles/
    ├── base.css               # 布局、棋盘、UI 控件
    └── ships.css              # 船体细节与动画
docs/
├── 设定.md                    # 游戏机制详细说明
├── DEVELOPMENT_GUIDE.md       # 开发扩展指南
└── 武器系统重构-详细版.md      # 武器系统设计文档
```

## 游戏机制要点
- **部署阶段**：玩家拖拽 `SHIP_TYPES` 定义的 5 艘舰船至 `player-grid`；`autoDeploy` 可随机摆放，`currentDeployMode` 控制水平/垂直，`firstTurn` 可切换先手。
- **战斗阶段**：`AP/HE/SONAR` 三套武器，其中空袭需 `CV` 存活、水听需 `DD` 存活，主炮伤害取决于 BB/SS/CL 的存活情况。
- **敌方 AI**：基于信息论（信息增益最大化）+ 蒙特卡洛采样的决策框架；`alpha` 参数控制探索与伤害的平衡；调试模式可显示概率热力图。
- **胜负与 UI**：`checkWin` 判定全灭后弹出 `game-over-modal`，并通过 `revealEnemyShips` 显示敌舰；`log()` 统一记录战况。

## 武器系统架构（已实现）
武器系统已完成解耦，采用"接口 + 注册中心 + 服务 + 纯数据结算 + 渲染器"分层架构：

### 核心接口 `WeaponBase`
所有武器继承此基类，必须实现：
- `canUse(context)` — 判断武器可用性（基于攻击方船只状态）
- `isValidTarget(target, context)` — 判断目标有效性
- `previewArea(target)` — 返回攻击范围预览
- `resolve(target, context)` — 执行攻击，返回结构化事件数组

### 战斗上下文 `BattleContext`
统一的上下文结构，通过参数传递而非全局变量：
```javascript
{
  attackerShips: ShipState[],    // 攻击方船只快照
  defenderGrid: GridCell[][],    // 防守方网格
  defenderShips: Ship[],         // 防守方船只（会被 resolve 修改）
  isPlayer: boolean              // 是否玩家发起
}
```

### 事件驱动渲染
- 武器 `resolve()` 只返回事件数组，不直接操作 DOM
- `BattleRenderer` 统一解释事件并更新视图
- 事件类型：`CELL_UPDATE` / `SHIP_UPDATE` / `LOG` / `EFFECT`

### 新增武器流程
1. 创建 `XxxWeapon.js` 继承 `WeaponBase`
2. 实现 `canUse` / `previewArea` / `resolve` 方法
3. 在 `game.js` 的 `initWeaponSystem()` 中注册：`weaponRegistry.register(new XxxWeapon())`
4. 如需新结算逻辑，在 `battle/` 下添加对应 Resolver

## AI 策略模块
`src/ai/aiStrategy.js` 采用信息论框架：
- **置信状态**：蒙特卡洛采样生成与观测一致的舰船配置分布
- **统一评估**：`utility = α × 归一化信息增益 + (1-α) × 归一化期望伤害`
- **武器可用性**：`checkAIAbilities()` 在决策层保证只选择可用武器
- **难度控制**：`randomness` 参数引入随机扰动

## 研发注意事项
- 保持所有中文文案、注释与文档风格一致；新增样式需在 `main.js` 或对应模块显式导入。
- 修改 AI 或武器需同步更新 `docs/设定.md` 中的表格与说明，确保文档与实现对齐。
- 武器逻辑修改应保持结算器（Resolver）的纯数据特性，不引入 DOM 操作。

### 游戏拓展性边界
- 本游戏将一直是回合制游戏，不会考虑实时战斗机制。最多增加同步回合功能（同时操作同时结算）
- 最多考虑支持双人对战及其联网对战功能，不会支持更多玩家
- 不会增加资源、经济等其他复杂策略元素
- 不会考虑复杂资源和外部图像需求，始终保持可单文件运行

### 可考虑的解耦方向
任务	说明
抽取纯函数版结算逻辑	从 HitResolver.js 等抽取不依赖 DOM 的计算核心
实现终局判定	纯函数版 checkWin()
武器伤害解耦  将最大伤害和武器可使用类型从ai模块和game模块中解耦
