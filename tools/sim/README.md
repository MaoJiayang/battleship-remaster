# 阵营模拟 / 调参工具

用真实 `SimulationEngine` 跑 AI 对 AI 的阵营循环赛，支持同种子配对比较和学说参数 A/B。

## 快速开始

```bash
node tools/sim/runner.mjs tools/sim/spec.example.json tools/sim/runs/base.json
node tools/sim/runner.mjs tools/sim/spec.my-variant.json tools/sim/runs/variant.json
node tools/sim/compare.mjs tools/sim/runs/base.json tools/sim/runs/variant.json
```

`runs/` 不入库（见 `.gitignore`）。

## 设计

- 21 个两两对阵 × `pairs` 组 × 双座位 = `21 × pairs × 2` 局。
- 每组使用**同一舰队**（同一 RNG 生成）给双方，控制布阵差异。
- 每个对阵的 X/Y 各先手一次；`seedOffset` 相同即可做逐局配对比较。
- 输出：`<out>.json` 汇总 + `<out>-shardN.json` 原始行。
- 胜负为 0/1，无平局（`maxPlies` 到顶仍无结果则记 DRAW，正常不会出现）。

## spec 字段

```json
{
  "alpha": 0.84,
  "riskAwareness": 0.46,
  "pairs": 100,
  "seedOffset": 8181,
  "maxPlies": 320,
  "jobs": 6,
  "neutralBias": false,
  "doctrineOverrides": {}
}
```

- `alpha` / `randomness` / `riskAwareness`：AI 决策参数，缺省取 HARD 难度。
- `pairs`：每个对阵的配对组数。`50` 用于筛选，`100` 用于验证；至少用两个独立 `seedOffset` 复核。
- `jobs`：并行分片数。建议不超过物理核心数的一半；worker 会设 BelowNormal 优先级。
- `neutralBias`：只用于消融实验。为 `true` 时关闭学说的 AI 人格层（`weaponBias` / `hitAffinity` / `suspectAffinity`），但保留机制推导出的伤害/信息价值。
- `doctrineOverrides`：深合并到 `src/data/doctrines.js` 的 `DOCTRINES`，只在本次运行生效，不写回仓库。

## 学说 A/B 示例

只改 IJN 空袭外围伤害：

```json
{
  "alpha": 0.84,
  "pairs": 50,
  "seedOffset": 8181,
  "jobs": 6,
  "doctrineOverrides": {
    "ijn": { "he": { "outerDamage": 1 } }
  }
}
```

`doctrineOverrides` 支持任意层级的字段，例如 `defense.apReductionMinDamage`、`ap.maxPenetrations`、`ai.weaponBias`。机制和 AI 人格层都能单独做 A/B。

## 输出指标

- 阵营胜率与 95%CI（n = `pairs × 6`）。
- Bradley–Terry γ（固定种子的 bootstrap 95%CI）与对场胜率。
- 命中率、伤害/局、水听占比、平均手数。
- 7×7 胜率矩阵。

## 比较器

`compare.mjs` 需要两次运行的 `seedOffset` 相同；base 的 `pairs` 可以更多，比较器会自动截取前 `variant.options.pairs` 组。输出：

- 每个阵营的配对差（variant − base）与 95%CI；
- 阵营/对位格胜率跨度；
- 显著对位格数量（单格 95%）；
- 变化最大的对位。

## 注意

- 模拟是 AI 对 AI，不能替代玩家实测；它衡量的是当前 AI 元游戏下的学说强度。
- 单格 n 较小时（50 对 → 100 局/格）置信区间很宽；不要根据单格结果直接调数值。
- 调参时优先做**单变量** A/B，再用组合包验证；不要用同一种子反复搜参后直接宣布显著。
