# DATA-CONTRACT · 插件数据契约（Phase-1，v35）

> 面向 plugin-ui（主页/时间线/互动）与 verifier。口径来自 `19-deep-integration-spec.md` §3.3/§4/§6/§8/§9。
> 数据目录 = `<pet-work>`；所有写入原子（tmp+rename），**不含对话原文/路径/命令参数**。

## 1. `bridge-state-v2.json`（权威状态，v33+；`state.json` 仅兜底）
新增字段（v35）：
```jsonc
"today": {                     // 今日统计（跨天自动重置）
  "date": "2026-10-23", "turns": 14, "toolCalls": 37,
  "longestTurnMs": 372000, "costYuan": 0.42, "budgetYuan": 1.0, "calls": 14
},
"companion": {                 // 情绪模型（对外只给 words，不显示数字）
  "mood": 10, "energy": 70, "affinity": 5, "level": "熟悉",
  "streakDays": 0, "firstSeenAt": "ISO", "lastSeenAt": "ISO",
  "totals": { "turns": 0, "tools": 0, "interactions": 0 }, "updatedAt": "ISO",
  "words": { "mood": "平静", "energy": "有点累", "affinity": "陌生" }
},
"eventsUnread": 0,
"status": { "state": "...", "tool": "pwsh", "toolType": "command", "phase": null, "since": "ISO", "step": 3, "turn": 2, "heartbeatAt": "ISO", "source": "session-..." },
"sessions": [ ... ], "currentSessionId": "...", "userActiveCount": 2, "backgroundCount": 6
```

## 2. `companion.json`（情绪持久化，原子写，定时 30s + 变化即写）
字段同 `state.companion`（mood/energy/affinity/level/streakDays/firstSeenAt/lastSeenAt/totals/updatedAt）。
Phase-1 写入规则：完成一轮 mood+2/energy−1；错误 mood−6；互动（摸头+3/+0.5、喂食+2 energy+3/+0.5、叫她+1）；好感日上限 +1；面板只读 `words`。

## 3. `events.json`（事件环形缓冲）
```jsonc
{ "events": [ { "at": "ISO", "kind": "turn|approval|error|interaction|cost|long_task",
  "level": "S0|S1|S2|S3", "payload": "抽象标签（<80字，不含原文/路径/命令）",
  "said": true, "unread": true } ] }
```
- 上限 500 条（保留最近 7 天，插件侧裁剪）；面板按 `level` 置顶 S0/S1，未读角标 = `eventsUnread`。
- 清除未读：ui-action `{ "name": "events-ack" }`（插件会把 unread 全部置 false）。
- 面板读取方式：`state.get.files` 增加 `eventsFile` 路径或由 RPC 返回（plugin-ui 侧读取文件/RPC 即可）。

## 4. 互动协议（面板 → 桌宠；统一走 `ui-action.json`，带节流）
| 动作 | ui-action name | 桌宠表现 | 节流 |
|---|---|---|---|
| 摸头 | `interact-head` | `cmd:fx:love`（爱心 FX + 害羞） | 5min 冷却 |
| 喂食 | `interact-feed` | `act:jump` + `cmd:fx:love` | 每天 ≤3 次；23:00–08:00 拒绝（返回 failed "深夜不喂食"） |
| 叫她过来 | `interact-come` | `walk:nearby` → `freeze:800` | 60s 冷却 |
- `capabilities.interactions = {head:true, feed:true, come:true}`；面板按钮据此启用。
- 互动收益写 `companion.json`，事件写 `events.json`（kind=interaction, level=S3）。
- 防刷：同动作连续收益递减（Phase-2 细化）；深夜互动可用但**不主动冒泡**。

## 5. 通知分级与后续（F3/F4 实现时填充）
- S0：approval / 严重错误 / 预算 100%；S1：完成（节流）、长任务>10min、预算 80%；S2：预算 50%/里程碑；S3：工具细节/background。
- 待补（v36+）：`kind=cost`（payload=`budget-50/80/100`）、`kind=long_task`（payload=`>10min`）事件；面板时间线直接消费 `events.json`。

## 6. v37 新增（Phase-1 P0：白饭报账 / 三态护栏 / 愣一拍）
- `bridge-state-v2.json.today` 增 `riceBowls`（费用换算白饭碗数，默认 ¥0.5/碗）与 `period`（高峰/低谷，00:00–08:00 低谷简化口径）。
- 报告（report 台词）numbers 上下文增 `rice=…碗 period=…`，LLM/池化报账显示白饭口径；小票 receipt 同源数据。
- **三态护栏（可配置）**：`ui-config.guards={maxActionsPerHour,noActionOnSameState}`；插件侧动作计数与"状态不变不演出"，默认 60 次/小时、开启；`ui-config.guards` 热更新（`ui-config applied` 日志）。
- **愣一拍**：turnStart 先空拍 `guards.startleDelayMinMs~MaxMs`（默认 900~1500ms）再冒泡；不改变状态时序。

## 7. v38 新增（P0：偷吃被抓包 / 久别重逢 v2）
### 偷吃判定（`usage spike`）
- **基准**：最近 **5 轮** turn 的 token 均值（不足 3 轮不判）；`spikeRatio=1.8`、绝对门槛 `minTokens=2000`（避免小样本误报）。
- **触发**：本轮 token > 基准×1.8 且 ≥2000 → 汗滴 FX + 专属文案（池），`events` 记 `kind=usage, level=S2, payload=用量突增`（不存原文/内容）。
- **冷却/上限**：同一次 ≥10 分钟冷却、每天 ≤3 次（`costGuard` 可配）。
### 久别重逢 v2
- 数据：`companion.lastUserSeenAt`、`companion.lastActivityLabel`（抽象标签如 read/command）、`lastGreetDate`。
- 触发：gap ≥2 天（普通）/≥7 天（长别）；**每天最多一次**；到附近 + 文案（含"上次在…"抽象标签）；affinity+2/mood+3；events `kind=reunion, level=S1`。
