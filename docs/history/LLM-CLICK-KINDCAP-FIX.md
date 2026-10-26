# LLM-CLICK-KINDCAP-FIX（v2 修复：点击/交互类取消 kinds 小时上限）

> 日期：2026-10-26 ｜ 分支：`feat/llm-lines`（v2 部署候选的修复提交，见文末 hash）
> 触发：Lead 实拍发现点击 `speech reply` 出现 `source:pool, fallbackReason:kind-cap`；用户硬要求"每句话都走 LLM、每次不同"，不可接受。

## 1. 现象与证据（生产日志）

生产日志 `pet-work/evidence/pet-bridge-main.log`：

**修复前：真实点击已经走过 LLM（证明链路 OK）**
```
05:31:07.903 speech reply {"kind":"click","llmKind":"clickLine","source":"llm","fallbackReason":null,"latencyMs":1211,"tokens":301}
05:31:09.767 ... source:"llm" latencyMs:1547 tokens:302
05:31:10.996 ... source:"llm" latencyMs:937 tokens:305
05:32:05.713 ... source:"llm" latencyMs:787 tokens:304
05:33:38.907 ... source:"llm" latencyMs:1126 tokens:310
```
**随后被 kind-cap 卡住（回退固定池）**
```
05:35:47.118 speech reply {"kind":"click","llmKind":"clickLine","source":"pool","fallbackReason":"kind-cap",...}
05:35:51.938/51.940/51.942 ... kind-cap
05:43:42.807 ... kind-cap
（当前日志累计 kind-cap 184 条）
```
→ 说明 LLM 调用、speech-requests、`say:` 回推都正常；**唯一问题是 kind-cap 兜底**。

## 2. 根因（代码级）

`generate()` 的小时上限选择只看了 `report/spike/perKindPerHour`：
```js
const cap = kind === 'report' ? reportPerHour : kind === 'spike' ? spikePerHour : perKindPerHour || 6
```
此前虽在默认配置里加了 `interactivePerHour:60`，但**从未参与 cap 选择** → `clickLine` 仍按 `perKindPerHour=6/小时` 计，约 6 次点击后即 `fallbackReason:'kind-cap'`。

## 3. 修复

- `clickLine / doubleClickLine / interactHead / interactFeed / interactCome / praise / sneakLine`
  （`INTERACTIVE_KINDS` + click 类）→ **取消 per-kind 小时上限**；
- 配置：`llm.lines.interactivePerHour = 0`（0=不限；>0 时才作为显式上限），仅保留**每日 ¥10 预算** + `maxCallsPerDay` + 真实 LLM 失败/超时/非法/重复兜底；
- 非交互类（report/spike/turnEnd 等）保持原样，避免失控。
- 兜底原因仍完整记录（`budget/empty/invalid/duplicate/timeout/...`）。

## 4. 测试与验证

- 新增 mock 集成：`clickLine kind-cap removed: 10 unique clicks all source:llm`
  - 配置 `perKindPerHour=1, interactivePerHour=0`，连续 10 次 click；
  - 结果：`{"clickLine":{"attempts":10,"llm":10,"pool":0},"fallbackReasons":{}}`，无 kind-cap；
  - 全量：llm-lines 9/9 + speech 6/6 + director 13/13 + mock **9/9**；preflight `unit: llm-lines` PASS。
- **真实点击 source:llm 证据**：见 §1 生产日志 5 条（latency 787–1547ms、tokens 301–310）。
- v2 部署后验收（窗口内）：
  ```powershell
  Select-String pet-bridge-main.log -Pattern 'speech reply .*"kind":"click"' | Select-Object -Last 20
  # 期望全部 source:"llm"；若出现 pool → 检查 fallbackReason 是否为 budget/真实失败（不应为 kind-cap）
  Select-String pet-bridge-main.log -Pattern '"kind":"click".*"fallbackReason":"kind-cap"'   # 期望 0 条（v2 部署后新增日志）
  ```
- 点击延迟：perf immediate 记录 `fileAgeMs/pluginMs`（挂载后实测）；点击台词 LLM 延迟目标 0.7–1.5s，p95 若超 2.5s 持续则观察 provider。

## 5. 风险与边界

- 取消 kinds cap 后，极端连点会提高 LLM 调用量；但仍受 **¥10/日预算**、`maxCallsPerDay=2000`、250ms 轮询/重复去重/温度约束，不会无界。
- 若真实 LLM 失败/超时/预算耗尽 → 仍回退池，并记 `fallbackReason`；这符合"只有故障才池兜底"。
- 该修复只动插件；B 身体/动作导演不受影响。

## 6. 提交

- 分支：`feat/llm-lines`（v2 修复提交 hash 见推送后记录/Lead 通知）
- 部署：与 B 实拍 + perf 执行器同一挂载窗口；未合 main 前不生效。
