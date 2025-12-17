# AI 系统增强：声呐选点（从硬约束到“收益式”软约束）

> 背景：更改 c6ec1c6 对声呐添加了硬约束——禁止 AI 对同一“中心点”重复使用声呐。
> 目标：把这个“禁止”变成“AI 自己觉得不划算”，即通过评估函数自然降低重复覆盖的价值，但仍允许**有意义的重叠**（用来缩小敌舰位置）。

---

## 1. 现状梳理（代码层面）

### 1.1 声呐的真实结算规则（游戏规则）
见 src/game/battle/SonarResolver.js：

- 扫描中心为 (r,c)，覆盖 3x3。
- 若 3x3 内 **未暴露的舰船格数 shipCount = 0**：
  - 该 3x3 内所有未 hit 的格子都被标记为 `MISS`。
- 若 `shipCount > 0`（有信号）：
  - 中心格被揭示为真实：有船则 `HIT`，无船则 `MISS`（本质是“揭示中心真相”）
  - 周围 8 格若尚未 hit，则被标记为 `SUSPECT`（疑似）

关键点：
- “是否有信号”取决于 **3x3 内是否存在未暴露的船格**，而不是中心格。
- “无信号”非常强：直接把整片区域都变成 `MISS`，信息价值很高。
- “有信号”并不等价于“中心有船”，只是表明“附近某处有船”，并额外揭示中心真相。

### 1.2 AI 当前为什么需要硬约束
在 src/ai/aiStrategy.js 与 src/ai/SimulationEngine.js 中，都存在：

- `sonarHistory` / `sonarHistoryA/B`：记录使用过的声呐中心点
- 枚举行动后 filter：若 weapon 为 `SONAR` 且中心点已出现过，则直接移除（硬禁止）

两段代码都有同样的 TODO：未来应使用“收益式方法”让评估函数自然避免低效声呐。

---

## 2. 问题核心：信息增益近似与“重复覆盖”的价值建模不匹配

### 2.1 当前声呐条件熵计算的一个明显偏差
在 src/ai/aiCore.js 的 `BeliefState._getSonarConditionalEntropy(r,c,probGrid)`：

- 用 `centerProb = probGrid[r][c]` 作为“声呐有船/无船”的分支概率。

但真实机制中，“有信号”是由 3x3 内任一格存在未暴露船格触发。
因此分支概率更接近：

$$
P(\text{signal}) \approx 1 - \prod_{i\in A}(1 - p_i)
$$

其中 $A$ 为 3x3 区域内“仍不确定”的格集合（UNKNOWN/SUSPECT），$p_i$ 为该格存在船体的边缘概率。

影响：
- 当中心概率很低但周围概率很高时，AI 可能**低估声呐**；反之也可能**高估**。
- 更重要的是：当区域已经被大量声呐覆盖（很多格已确定/半确定），当前近似仍可能给出不合理的收益，从而诱发“重复扫”倾向。

### 2.2 为什么不能简单排除 3x3（你的约束 1）
因为“无信号 ⇒ 3x3 全 MISS”具备很强的**排除能力**：

- 两次声呐只要有部分重叠，就可能把“剩余未覆盖的边缘格”变成 MISS，从而显著缩小可行船位。
- 所以我们应当做的是：
  - 允许重叠
  - 但对“已经确定/已多次覆盖”的格子给出**边际收益递减**

---

## 3. 设计目标（可验收的行为）

1) AI 不再需要“禁止同中心点”也能避免无意义重复。

2) 当重叠能带来新的排除（尤其是把未知边缘变 MISS）时，AI 仍会选择重叠声呐。

3) 评估逻辑是“软”的：同一中心点不是不可选，而是通常低价值；只有在极端情况下（例如仅剩很少不确定区域且声呐是最优信息手段）才可能再次选择。

---

## 4. 推荐方案 A：收益式“覆盖折扣” + 修正信号概率（低改动、效果直接）

核心思路：

- 继续用信息论框架（entropy / infoGain）来评估声呐
- 但把“3x3 区域内每格的不确定性贡献”乘上一个**覆盖折扣系数**，让已覆盖区域的边际收益自然下降
- 同时把 `P(signal)` 改为基于 3x3 区域的近似，而不是中心点概率

### 4.1 需要新增的 AI 内部状态：声呐覆盖计数（不是中心点集合）
新增一个与棋盘同尺寸的网格：

- `sonarCoverCount[r][c]`：该格被声呐 3x3 覆盖过的次数（或一个衰减权重）

更新规则：每次执行声呐时，对 3x3 内每格 `sonarCoverCount++`。

这样就能表达：
- 同一中心点重复使用 ⇒ 其 3x3 区域计数变高 ⇒ 评估时收益自然降低
- 两次声呐部分重叠 ⇒ 未重叠的新格计数低 ⇒ 仍然有信息收益

### 4.2 覆盖折扣函数（允许重叠但递减）
对每个格子定义折扣：

$$
w(k) = \frac{1}{1 + \lambda k}\quad (\lambda > 0)
$$

或指数折扣：

$$
w(k) = e^{-\lambda k}
$$

解释：
- $k$ 是该格被覆盖次数
- 首次覆盖 $k=0$，权重为 1
- 之后逐渐下降，但永不变成 0（满足“不完全排除”）

### 4.3 修正声呐“有信号”的概率近似
用 3x3 的任一格存在船体来近似：

$$
P(\text{signal}) \approx 1 - \prod_{i\in A}(1 - p_i)
$$

实现时注意：
- 只把 UNKNOWN / SUSPECT 的格纳入 $A$（已 MISS/HIT/DESTROYED/SUNK 的格不贡献不确定性）
- 为了数值稳定，可对 $p_i$ 进行 clamp：$p_i = \min(1-\epsilon, \max(\epsilon, p_i))$

### 4.4 用“折扣后的区域熵”替代原本 areaEntropy
原本 `_getSonarConditionalEntropy` 里会累计 `areaEntropy`（3x3 的熵）。
改为累计：

$$
H_A^{eff} = \sum_{i\in A} w(k_i)\,H(p_i)
$$

其中 $H(p_i)$ 是单格二元熵，$k_i = sonarCoverCount[i]$。

直觉：
- 已多次覆盖的格子，即使“理论上还没确定”，也很可能已经被声呐疑似/边缘信息影响过，继续扫收益下降
- 但如果该格仍 UNKNOWN，说明此前重叠可能并没有把它确定为 MISS，此时仍保留一定收益（通过 $w(k)$ 不归零体现）

### 4.5 如何近似“signal 分支”与 “no-signal 分支”的信息收益
这里我们需要承认：声呐的两个分支对信息的影响差异很大。

- **no-signal**：3x3 全 MISS（强信息）
  - 近似信息收益：$\Delta H_{no} \approx H_A^{eff}$

- **signal**：中心揭示真相 + 周围标 SUSPECT（弱信息 + 相关性信息）
  - 中心揭示：$\Delta H_{center} \approx w(k_{center})\,H(p_{center})$
  - 周围 SUSPECT：不是“消除熵”，更像是“把 UNKNOWN 变成 SUSPECT 的软约束”。
	 - 建议用一个经验系数 $\rho \in [0,1]$ 表示 SUSPECT 带来的等效熵削减比例：

$$
\Delta H_{suspect} \approx \rho\sum_{i\in A\setminus center} w(k_i)\,H(p_i)
$$

解释：
- $\rho=0$：认为 SUSPECT 不提供额外信息（只算中心揭示）
- $\rho>0$：认为 SUSPECT 带来一定信息（更符合实际：它会把采样权重推向这些格）

最终：

$$
\mathbb{E}[\Delta H] \approx (1-P(signal))\,\Delta H_{no} + P(signal)\,(\Delta H_{center}+\Delta H_{suspect})
$$

然后把该期望信息增益进入现有 `evaluateAction` 的 `infoGain` 分支即可。

### 4.6 这套方案如何满足你的两个约束
1) 不会把 3x3 写死排除：
	- 权重 $w(k)$ 只会递减，不会归零；所以“重复/重叠”永远只是更不划算，而不是不可用。
2) 允许“有意义的重叠”来缩小位置：
	- 若两次声呐只部分重叠，那么第二次的“新覆盖格”仍 $k$ 小、权重大，no-signal 分支的 $\Delta H_{no}$ 仍可观。
	- 评估会自动倾向于把声呐覆盖推向“尚未覆盖或覆盖很少”的边缘，而不是完全回避重叠。

---

## 5. 备选方案 B：基于采样的“真实后验”期望（更准，但更贵）

如果希望把声呐的相关性（“附近有船”的信息）建模得更真实，可以用 BeliefState 的蒙特卡洛样本做近似：

对每个声呐候选点：

1) 遍历样本配置 config：
	- 判断该 config 下声呐是否 signal（3x3 内是否有船格），以及中心是否有船
2) 统计 outcome 分布：
	- signal & centerHit
	- signal & centerMiss
	- no-signal
3) 对每个 outcome：
	- 生成一个“更新后的 viewGrid'”（按规则设置 MISS/HIT/SUSPECT）
	- 用同一批样本做 reweight（只保留与新观测一致的样本），并从 reweight 后的边缘概率估计熵

优点：
- 会自然反映“signal ⇒ 3x3 至少一格有船”的相关性，不需要手工设置 $\rho$

缺点：
- 计算量更大（候选声呐点较多时会变慢）

建议：先落地方案 A，若仍觉得声呐行为不够聪明，再考虑方案 B。

---

## 6. 落地改动建议（对应到文件/模块）

### 6.1 先移除硬约束（或降级为极弱惩罚）
- src/ai/aiStrategy.js：删除/注释“过滤已使用声呐中心点”的 filter
- src/ai/SimulationEngine.js：同样删除/注释

说明：如果方案 A 做好，重复中心点会自然低收益；不需要“禁止”。

### 6.2 新增状态：sonarCoverCount
在 AI 状态里新增：
- 实战：aiStrategy.js 的模块级状态（与 damageDealtGrid 类似）
- 模拟：SimulationEngine 实例字段（与 damageGridA/B 类似）

每次实际执行 SONAR 后，对 3x3 覆盖格执行 `sonarCoverCount++`。

### 6.3 在 aiCore.js 中让 BeliefState 能读到覆盖折扣
有两种做法：

- 做法 1（侵入小）：`getConditionalEntropy(action, extra)` 允许传入 `sonarCoverCount`；仅 SONAR 分支使用
- 做法 2（更干净）：把“覆盖折扣”放到 `evaluateAction` 的声呐信息增益计算里（不改 BeliefState 类签名），直接重写 SONAR 的 infoGain 计算

建议做法 2：保持 BeliefState 更纯粹，只负责概率与基础熵；声呐的“策略层折扣”放在 evaluateAction（或其上层）更符合“策略偏好”定位。

### 6.4 参数建议（可调）
- $\lambda$（覆盖折扣速度）：0.4 ~ 1.0
- $\rho$（SUSPECT 等效信息比例）：0.15 ~ 0.35

直观调参原则：
- 若 AI 仍喜欢重复扫同一片：增大 $\lambda$
- 若 AI 过于偏好 no-signal 扫空：减小 $\rho$ 或提高 alpha 的伤害权重（取决于设计目标）

---

## 7. 简化伪代码（用于实现时对齐）

### 7.1 计算声呐候选点的“折扣信息增益”

1) 列出 3x3 cells
2) 对每个 cell：
	- 若 state 为 UNKNOWN/SUSPECT：
	  - p = probGrid[cell]
	  - h = H(p)
	  - w = w(sonarCoverCount[cell])
	  - 累加到 areaEffEntropy
3) Psignal = 1 - Π(1 - p)
4) ΔH_no = areaEffEntropy
5) ΔH_signal = w_center*H(p_center) + ρ*(areaEffEntropy - w_center*H(p_center))
6) expectedInfoGain = (1-Psignal)*ΔH_no + Psignal*ΔH_signal
7) normInfoGain = expectedInfoGain / currentEntropy
8) sonarUtility = alpha * normInfoGain

---

## 8. 验证方式（不靠主观感觉）

1) 用 tools/grid-search 的模拟批量对战：对比“硬约束 vs 软折扣”在不同 alpha 下的胜率与平均回合数。
2) 统计声呐行为：
	- 同中心点重复率（应显著下降但非 0）
	- 声呐覆盖的平均新格数量（应提高）
3) 人工对局观察：
	- 发现 signal 后，声呐是否会在附近做“有意义重叠”来压缩空间
	- 盘面后期不确定格很少时，是否会出现合理的“重复确认”

---

## 9. 结论

硬约束的问题不在于“禁止重复”本身，而在于它把策略表达死了。
通过“覆盖折扣 + 修正 P(signal)”把重复覆盖的价值自然压低，AI 会更像在做理性取舍：

- 重叠不是错，但应该付出机会成本
- 只有在重叠确实能带来新的排除/缩小搜索空间时，它才值得

这正好契合声呐的机制特性，也符合你提出的两个限制条件。
