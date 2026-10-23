# DATA-CONTRACT · 插件数据契约（Phase-1 v35 → v46 口径）

> 面向 plugin-ui（主页/时间线/互动）与 verifier。口径来自 `19-deep-integration-spec.md` §3.3/§4/§6/§8/§9。
> 数据目录 = `<pet-work>`；所有写入原子（tmp+rename），**不含对话原文/路径/命令参数**。
> v39 及更早：见 §6–§8；**v46 三本账/工具分类/计账续种见 §9（当前权威口径）**。

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
{
  "events": [
    {
      "at": "ISO",
      "kind": "turn|approval|error|interaction|cost|long_task",
      "level": "S0|S1|S2|S3",
      "payload": "抽象标签（<80字，不含原文/路径/命令）",
      "said": true,
      "unread": true
    }
  ]
}
```

- 上限 500 条（保留最近 7 天，插件侧裁剪）；面板按 `level` 置顶 S0/S1，未读角标 = `eventsUnread`。
- 清除未读：ui-action `{ "name": "events-ack" }`（插件会把 unread 全部置 false）。
- 面板读取方式：`state.get.files` 增加 `eventsFile` 路径或由 RPC 返回（plugin-ui 侧读取文件/RPC 即可）。

## 4. 互动协议（面板 → 桌宠；统一走 `ui-action.json`，带节流）

| 动作     | ui-action name  | 桌宠表现                        | 节流                                                     |
| -------- | --------------- | ------------------------------- | -------------------------------------------------------- |
| 摸头     | `interact-head` | `cmd:fx:love`（爱心 FX + 害羞） | 5min 冷却                                                |
| 喂食     | `interact-feed` | `act:jump` + `cmd:fx:love`      | 每天 ≤3 次；23:00–08:00 拒绝（返回 failed "深夜不喂食"） |
| 叫她过来 | `interact-come` | `walk:nearby` → `freeze:800`    | 60s 冷却                                                 |

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

## 8. v39 数据底座 / 三态 / 气泡 notBefore（20-p0 笔记口径）

- `today`：`tokens`（用户 token 累计）、`costYuan`（按 `pricing` 估算；**v46 起统一为 `pricing.per1kTokens` 平铺估算并拆成 user/agent 三本账，见 §9**）、`petLlmCostYuan`（桌宠说话 LLM 花费，1 元预算）、`agentCalls`、`riceBowls`（`bowlTokens=100000`）。
- `companion.lastContext={at,toolType,outcome,turns}`（隐私安全：只类型/结果/轮次）。
- `status.stateClass`：`running/waiting/ready/error/idle/disconnected`（派生，300ms 去抖，不改 9 状态枚举）。
- 气泡 `notBefore`：S0（prio100）到点即时；低优先级未到点不阻塞；愣一拍 900~1500ms（预生成×0.6）。
- 开关：`spike/rice/hesitate/stateClass/reunion.enabled`；偷吃参数 `ratio1.8/absFloor3000/window20/minSamples8/cooldown10min/每日2`；重逢 4 档（2–8h/8–24h/1–3d/≥3d+7d bonus），gap 用 `companion.lastSeenAt`（真人交互）。
- `STATE-CHANNEL` 别名修正：`running→thinking`（有 tool 则 tool）；`background` 仅非活跃会话。

## 9. v46 三本账 / 工具分类 / 计账续种（2026-10-23，当前权威口径）

> 实现：`plugin/server/lib/index.js`、`plugin/server/lib/tool-types.js`；单测：`scripts/test-tool-types.mjs`。
> 所有金额均为**估算**（面板标注“估算·含团队”），不是账单；不含对话原文/路径/key。

### 9.1 tokens 归集（全会话、含 cache）

- `today.tokens` = **所有会话**（当前用户会话 + subagent/团队/background）的 `assistant/message.usage` token 之和。
  - 取值：`usage.totalTokens`；缺失时退回 `usage.inputTokens + usage.outputTokens`。
  - **cache 口径：原样计入** —— `totalTokens`/`inputTokens` 已含缓存命中部分，插件不单独扣减、不单独按 cacheRead/cacheWrite 计价（因此费用是保守上界）。
- `tokensUser`：会话 role = user（顶层会话，`header.origin` 为空/user）的 token 和。
- `tokensAgent`：会话 role = agent（`header.origin` ∈ subagent/teammate/team/delegate/background/tool，或 `delegationDepth>0`）的 token 和。
- `roleUnknown`：role 无法判定（无 header / 非空但未知 origin）的 usage **事件数**；这些 token **归入 tokensUser**（规格：role 未知归 user 并计数）。
- 不变式：`tokens ≈ tokensUser + tokensAgent`。v46 上线首日会把 v45 及更早“只有 tokens、无角色拆分”的历史缺口补入 `tokensUser`（日志 `today seed`）；跨天清零后严格成立。
- 采集点：`onEvent` 入口、在 `skipSubagent` / 归因过滤**之前**归集（旧版在过滤之后 ⇒ 团队/子代理 token 全部丢失，且事件在 TDZ 处抛错）。
- 计数范围：所有会话，不受 `onlyCwd` / `attribution.onlyActive` 影响（只影响统计，不触发任何演出）。

### 9.2 三本账成本（估算）

| 字段                  | 公式                                 | 说明                                 |
| --------------------- | ------------------------------------ | ------------------------------------ |
| `pricing.per1kTokens` | 默认 `0.0015` 元/1k tokens           | 插件配置项，可调（patch 可显式覆盖） |
| `costUserYuan`        | `round(tokensUser/1000 × price, 4)`  | 用户会话估算                         |
| `costAgentYuan`       | `round(tokensAgent/1000 × price, 4)` | 团队/子代理估算                      |
| `costYuan`            | `costUserYuan + costAgentYuan`       | **估算·含团队**，面板需标注“估算”    |

- 与 `petLlmCostYuan` 区分：前者是 DSH 模型用量估算；后者是桌宠自身说话（`llm.lines`）的花费（独立 1 元/日预算）。
- 跨天：`today` 全部日统计重置（含 tokens/tokensUser/tokensAgent/roleUnknown/agentCalls/cost*/petLlmCostYuan/calls/riceBowls）。

### 9.3 calls / petLlmCostYuan 续种（reload 不清零）

- `today.calls` = 今日桌宠 LLM 调用次数；`today.petLlmCostYuan` = 今日桌宠 LLM 估算花费（4 位小数）。
- **计账点**：`callLlm` 成功返回处直接累计（不再依赖 say/气泡路径；pregen/重试/排队不会重复计数）；日志 `llm accounted {calls,cost}`（delta）。
- **续种**：插件 reload 时读 `bridge-state-v2.json.today`（同日 `calls`/`petLlmCostYuan`）续种 `llmDay`，`lastLlmCalls/lastLlmCost` 为差分基线（日志 `today seed`）。
- 预算护栏（`llm.maxCallsPerDay` / `llm.budgetPerDayYuan`）同样按续种后的今日累计判断。

### 9.4 toolType 9 类（判定顺序固定）

1. `mcp__` 前缀：白名单 `codegraph|context7|understand*` → `knowledge`；其余 `mcp__*` → `mcp`
2. `plan`：`todo_write|create_goal|get_goal|update_goal|update_plan|plan|taskboard|ask_user_question`（精确名；`update_goal` 为 goal 家族补齐）
3. `knowledge` 前缀：`memory|skill|context|compact|knowledge|remember`
4. `agent` 前缀：`subagent|team|send_message|workflow|ralph|spawn_*`
5. `job_*` → `unknown` + `status.subkind='job'`
6. `search` 前缀：`web_search|web_fetch|search|grep|glob`（非 mcp）
7. `write` 前缀：`write|edit|patch|apply_patch|create_file|rename`
8. `command` 前缀：`bash|pwsh|exec|shell|run|terminal|process`
9. `read` 前缀：`read|list|open|view|cat|get_file|read_file`
10. 其余/空名 → `unknown`

- 输出：`state.status.toolType`（9 类之一）、`state.status.subkind`（job 时 = `job`，否则 null）。
- `ask_user_question` 额外把状态置为 `waiting_input`（`stateClass=waiting`，等用户选），不只普通 tool。
- 动作映射（旧口径延续）：read→peek、write→jump、command→peek+走近、search→peek×2、mcp→peek；plan/knowledge/unknown 不动作。
- 单测：`node scripts/test-tool-types.mjs`（全部示例 + 顺序校验 + 9 类枚举覆盖）。

### 9.5 3 条验收断言（verifier 复测，`bridge-state-v2.json.today`）

price = `pricing.per1kTokens`（0.0015）：

1. `abs(riceBowls × 100000 − tokens) < 5000`（riceBowls 保留 2 位小数）。
2. `abs(costYuan − tokens/1000 × price) < 0.01`（costYuan 为 user/agent 两个 4 位小数分项之和）。
3. `abs(costUserYuan − tokensUser/1000 × price) < 0.01` **且** `costUserYuan ≠ costYuan`（要求 `tokensAgent > 0`，即团队/子代理 token 已计入）。

- 附加：触发一次桌宠 LLM（主会话一轮对话）后，`calls` 与 `petLlmCostYuan` 只增不减，日志出现 `llm accounted`。
- **快照自洽**：`writeState()`（含事件路径触发的写盘）写前重算 `cost*/riceBowls/calls/petLlmCostYuan`，保证文件里 `tokens` 与派生字段同一时刻（避免两次心跳之间读盘出现“token 涨了、cost 没涨”的瞬时不一致）。
