# LLM 全事件化 + 动作导演 · 部署检查清单（v1）

> 分支：`feat/llm-lines`（插件端）；合入/部署**同一挂载窗口**，不单独部署插件（避免"插件已发 perf、pet 不认"）。
> 本清单给 Lead/值班：按序打勾；任一 FAIL 先回退，不在窗口内硬修。

## 0. 本次交付物

| 项 | 路径 |
|---|---|
| 插件分支 | `feat/llm-lines`（窗口取 tip；交付时 tip 记录于下方"合并 hash"） |
| 台词队列契约 | `verify/LLM-SPEECH-QUEUE.md` |
| 动作导演契约 | `verify/LLM-ACTION-DIRECTOR.md`（v2.1，B 主/A fallback） |
| B clip 词表映射 | `docs/generated/action-clips.json`（v2，50 条，`files` 含中文名→`assets/thumb/<名>.webm`） |
| 审计/样本 | `verify/LLM-LINES-AUDIT.md` |
| 操作矩阵（ux） | `verify/OP-ACTION-MATRIX.md`（消费方：本插件 prompt/映射） |

**合并 hash**：部署窗口时 `git rev-parse --short origin/feat/llm-lines` 记录到本文件/部署记录；当前交付基线 `31b9140`（后续 B-primary 提交同分支追加）。

## 1. 部署前（窗口前 30 分钟）

- [ ] `feat/llm-lines` tip 已 push、worktree clean；无未提交改动。
- [ ] `node plugin/server/test/llm-lines.test.mjs` → 9/9。
- [ ] `node plugin/server/test/speech-requests.test.mjs` → 6/6。
- [ ] `node plugin/server/test/action-director.test.mjs` → 13/13。
- [ ] `node plugin/server/test/llm-lines-mock.test.mjs` → 8/8（含 V5 5 连同一句回归）。
- [ ] `preflight-check.ps1` 的 `unit: llm-lines` → PASS（其余项若环境性失败需在记录中注明，main venv 复核）。
- [ ] pet 侧 perf 执行器版本/hashes：`feat/smooth-anim`（pet-dev）已含 `perf:` 解析与 A/B 解析；若**未就绪** → 本窗口配置 `ui-config.actionDirector.channel='act'`（A 回退，B 不演，但不丢动作）。
- [ ] pet 资产：B 的 50 段 WebM 已随 B 身体部署（否则 perf 里的 B clip 会回退 A/忽略，需确认 pet 执行器有回退）。
- [ ] ui-config：`llm.budgetPerDayYuan=10` 已生效（插件日志 `ui-config applied budgetPerDayYuan`）。
- [ ] 备份：当前插件包/`cordis.patch.yml`/ui-config/pet 二进制各一份（可回滚）。

## 2. 合并与挂载（同一窗口）

1. 合并 `feat/llm-lines` 到窗口集成分支（保留 hash 记录）；冲突优先保留主线行为 + 本分支 llm/speech/action 文件。
2. 重新打包/拷贝插件到 `C:\Users\xiqi\.dsh\profiles\web\node_modules\dsh-pet-bridge-vNN`；更新 `cordis.patch.yml`（如路径/版本变化）。
3. 同窗口部署 pet（B 身体 + `perf:` 执行器 + `speech-requests` 钩子）。
4. 重启 DSH Web host（仅限获批的挂载窗口；记录 PID/时间）。
5. 启动桌宠；确认管道连通。

## 3. 烟测（窗口内 10 分钟）

### 3.1 队列/台词
- [ ] 插件日志出现 `speech requests queue {"enabled":true,"file":"...speech-requests.json"}`，路径与 pet `speech.queueDir` 日志一致。
- [ ] 点击 1 次：pet 写请求 → 插件 `speech reply {kind:"click",llmKind:"clickLine",source:"llm",fallbackReason:null}` → pet 气泡显示、pending 清除、无本地固定句抢跑。
- [ ] 插件日志 `llm stats`：`sourceShare.llm` 正常、`fallbackReasons` 为空或仅合理项。

### 3.2 动作导演 / 延迟
- [ ] 点击后 **≤250ms** 出现即时动作：插件日志 `perf immediate {kind:"click",act:"点击回应 - 开心跃动",channel:"perf",latencyMs:0}`；pet 侧有对应 B clip 起播。
- [ ] 0.7–1.5s 内日志 `llm line {kind:"clickLine",...,beats:2-4}` → `perf plan {channel:"perf",beats:N,acts:[...]}` → `perf send`。
- [ ] pet 执行 `perf:`：按 beats 顺序、priority=high/normal/low 生效；拖拽中不打架；结束后回 idle。
- [ ] turnEnd：日志 `perf plan {kind:"turnEnd"}`；动作是 B `工作结束`（A fallback cheer/report 可接受）。
- [ ] idle 演出（若触发）：`perf plan {kind:"selfTalk",priority:"low"}`，不与点击/拖拽抢戏。

### 3.3 V5 复读回归
- [ ] 连续 5 次 done（或连续 5 次同事件）：同一句 `llm line text` **≤1 条**；若出现重复，日志必须有 `fallbackReason:"duplicate"`/`llm duplicate retry`，pet 侧 5 条气泡 **不出现连续同句**。
- [ ] 无 `speech request skipped reason:'unknown-kind'` 激增；`turnEnd-recent` 跳过 celebrate 请求属正常（防双发）。

### 3.4 回退热切
- [ ] ui-config 写 `{"actionDirector":{"channel":"act"}}` → 插件日志 `ui-config applied {"actionDirector":{"channel":"act"}}`；下一次点击 `perf immediate` 的 act 为 A（如 pat），动作不丢。
- [ ] 切回 `{"actionDirector":{"channel":"perf"}}` → `perf send` 恢复；无需 reload。
- [ ] 可选：`{"actionDirector":{"enabled":false}}` → 只有台词无动作（导演关闭）。

### 3.5 预算/隐私
- [ ] `llm stats` 成本 ≤ ¥10/日；`llm budget` 未触发；`maxCallsPerDay` 2000 未打满（打满需调高或降交互）。
- [ ] 日志无用户文本/路径/参数/session id（`llm line text` 为宠物台词，非用户原文；speech reply 只含句末文本）。
- [ ] `speech-requests.json` context 仅枚举/数值（pet 侧 sanitize + 插件二次清洗）。

## 4. 失败回退（任一步 FAIL）

1. **动作异常/打架**：ui-config `actionDirector.channel='act'`（热切）；仍异常 → `actionDirector.enabled=false`（只台词）。
2. **perf 执行器缺 B 资产/解析报错**：pet 执行器回退 A；插件可暂设 channel='act'。
3. **插件异常**：回滚到上一版插件包 + 重启 host；pet 本地兜底（1.5s/4.5s）生效，点击仍有本地池句（故障模式）。
4. **复读/重复未修复**：保留日志（`llm line`/`fallbackReason`）交回 tech-scout；不窗口内改代码。
5. **预算超**：ui-config 调 `llm.budgetPerDayYuan` 或临时 `llm.lines.enabled=false`（回退池）。

## 5. 部署后 24h 观察

- [ ] `llm stats` 成功率 ≥95%（失败多为 timeout/empty，可接受）；`fallbackReasons` 分布正常。
- [ ] `perf plan rejected` 占比低（模型 JSON 遵循率）；持续偏高需收紧 prompt/温度。
- [ ] 同句复读率：`llm line` 24h 内完全同句 ≤1（历史 7 天去重）；V5 类似连续 5 次场景 0 复现。
- [ ] 点击延迟 p95：`perf immediate` 日志时延（0ms 为插件侧；端到端以 pet 起播时间戳为准，pet-dev 提供）。
- [ ] 无新增崩溃/管道失败（`pipe fail`、插件异常日志）。

## 6. 记录

| 项 | 值 |
|---|---|
| 窗口时间 | |
| 插件合并 hash | |
| 插件包版本 | |
| pet 分支/hash | |
| ui-config 快照 | |
| 烟测结果（PASS/FAIL 明细） | |
| 回退记录 | |
