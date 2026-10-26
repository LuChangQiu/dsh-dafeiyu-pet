# LLM-SPEECH-QUEUE（pet → plugin 台词请求队列 · 接口契约 v1）

> task-133：用户要求"她说的每一句话都走 LLM 且每次不同"。pet 本地点击/双击/被夸/被摸/偷吃被抓等事件在 pet 进程内，
> 插件收不到；用**文件上行队列**把事件交给插件生成 LLM 台词。pet 侧钩子由 pet-dev 实现，插件侧已实现并测试。
> 分支：`feat/llm-lines`（窗口后合入；需新挂载窗口部署）；插件端默认开启（无文件时安静跳过）。

## 1. 文件与路径

- 路径：`<pet-work>/speech-requests.json`（与 `bridge-state-v2.json` 同目录；插件默认从 `stateFileV2` 的目录推导；可用 `cfg.speechRequests.file` 显式覆盖）。
- 内容：**JSON 数组**，保留最近 ≤50 条（建议 pet 侧写前读旧文件、追加、裁到 50）：
```jsonc
[
  { "id": "pet-1729900000-3f2a", "kind": "click", "context": { "phase": "click", "mood": 2 }, "at": "2026-10-26T10:00:00+08:00" }
]
```
- `id`：pet 侧生成唯一串（时间戳+随机/自增），≤80 字符；重复 id 插件忽略。
- `kind`：枚举（见 §2）。
- `context`：**只允许枚举/数值/布尔**，白名单键：`phase, subkind, toolType, mood, energy, relation, mode, count, hourBucket, night, s0`；值：数字（|v|≤1e6）/布尔/短枚举串（`^[a-z0-9._:-]{1,24}$`）。**禁止用户文本/路径/DSH 原文/参数**；插件会再次清洗，非法值丢弃。
- `at`：ISO 时间（可缺省）。

## 2. kind 枚举 → 插件 LLM kind

| pet kind | 触发 | 插件 LLM kind | 长度要求 |
|---|---|---|---|
| `click` | 单击桌宠 | `clickLine` | 12–24 字 |
| `doubleClick` | 双击（余额面板等） | `doubleClickLine` | 12–24 字 |
| `praise` | 被夸（面板/语音） | `praise` | ≤20 字 |
| `pat` / `head` | 被摸头 | `interactHead` | 12–20 字 |
| `feed` | 喂食 | `interactFeed` | 12–20 字 |
| `come` | 叫她过来 | `interactCome` | 12–24 字 |
| `sneakCaught` / `stealCaught` | 偷吃被抓 | `sneakLine` | ≤24 字 |
| `report` | 报账面板/气泡 | `report` | ≤40 字，数字可保留 |
| `approvalWait` | 等确认（S0） | `approval` | ≤28 字 |
| `waitingInput` | 等选择（S0） | `waitingInput` | ≤28 字 |
| `greet` / `morning` | 早安 | `morning` | ≤40 字 |
| `sleep` | 晚安 | `sleep` | ≤40 字 |
| `inner` | 心声/括号独白 | `inner` | ≤24 字 |
| `selfTalk` | 自言自语 | `selfTalk` | ≤40 字 |
| `celebrate` | 完成庆祝 | `turnEnd` | ≤40 字 |
> 未列出的 kind：插件记 `speech request skipped {reason:'unknown-kind'}`，不回复（pet 超时兜底）。

## 3. 写文件协议（pet 侧，原子写）

1. 事件发生时：读现有 `speech-requests.json`（不存在→`[]`，损坏→`[]`）→ push 新请求 → 裁到最近 50 条。
2. 写 `<file>.tmp-<pid>` → `fsync`（可选）→ `rename` 覆盖目标（Windows 用 `os.replace`）。
3. 短时间内多次点击可合并写入，但**每条事件都要有独立 id**（不得复用/覆盖未处理请求）。
4. 插件只读该文件，不修改；pet 侧不要删除已处理 id（插件自带 200 id 去重；文件裁到 50 即可）。

## 4. 插件处理（已实现）

- 轮询：`setInterval` 250ms（可配 `speechRequests.pollMs`），先 `stat` 比对 size/mtime，未变化不读文件（低占用）。
- 解析 → `selectNewRequests`（按 id 去重，每 tick ≤4 条）→ `kindToLlmKind` → 调 `generate(kind, {tools:0}, {interactive:true, allowNight:true, speechContext:context})`：
  - **LLM-first**；池仅在 LLM 失败/超时/超预算/超 cap/重复（重试后）时兜底，日志 `fallbackReason`；
  - `interactive:true`：用户主动事件不受静音/深夜拦截（S0 同理）；仍受 ¥10/日预算、总 cap、长度/去重约束；
  - 生成成功后 `send('say:<text>')` 推回 pet，并 `rememberLine`（跨请求去重/相似度，保证"每次不同"）。
- 日志（无用户文本）：`speech reply {kind,llmKind,source,fallbackReason,latencyMs,tokens}`；`llm fallback`、`llm stats`（成功率/来源占比/p50/p95/成本）。
- 失败静默：文件缺失/损坏/未知 kind 只记日志，不抛错、不阻塞插件。

## 5. pet 侧接收与本地兜底（pet-dev 实现）

- 收到管道 `say:<text>`：正常显示；若该文本对应某个 pending request（可按最近 pending 或插件不回报 id 则按 FIFO），取消该请求的兜底计时器，避免双气泡。
- **本地兜底只允许故障时**：
  - 写请求后启动计时：**管道健康 → 等待 4–5s**（LLM p95≈1.5s，留余量）；**管道不健康/离线 → 1.5s**；
  - 计时内收到 say → 取消计时；
  - 超时仍无 say → 显示本地池句一次（日志记 `source:'pool-local'`, `fallbackReason:'plugin-timeout'`）；恢复后正常走 LLM。
- 注意：本地兜底句仅作故障占位，**不得**在插件正常时抢答（避免出现固定池观感）。

## 6. 配置与回滚

- 插件 `cfg.speechRequests`：`{enabled:true, file:'', pollMs:250, maxPerTick:4, maxItems:50}`；`file:''` 时从 `stateFileV2` 目录推导。
- LLM：`llm.lines.interactivePerHour:60`（点击类不按 6/h 卡）、`llm.maxCallsPerDay:2000`、`llm.budgetPerDayYuan` 由用户/面板控制（Lead 已调 ¥10）。
- 回滚：`speechRequests.enabled=false` → 插件不轮询、不回复；pet 侧退回本地池（故障模式），或关闭 pet 钩子。
- 隐私：请求/回复不含用户原文、路径、会话 id；日志只 kind/枚举/数字/延迟。

## 7. 验收

- 插件：`speech-requests.test.mjs` 6/6（映射/上下文白名单/解析容错/去重/限流/文本清洗）；`llm-lines-mock.test.mjs` 5/5（成功/回退/点击/被夸/文件队列成功+失败）。
- pet：任一点击/双击/被夸/被摸/喂食/叫她/偷吃被抓 → `speech-requests.json` 出现请求 → ≤4s 内收 `say:`；插件日志 `source:llm`；断电/插件停 → 1.5s 本地兜底；连续 20 次同类请求无完全重复。
- 性能：250ms stat 轮询，CPU 增量 <1%；每请求 LLM 成本 ~¥0.0002–0.0005，¥10/日预算内。
