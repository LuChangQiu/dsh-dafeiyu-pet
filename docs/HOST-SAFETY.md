# 宿主低占用与安全（task-69）

> 目标：桌宠联动插件对 DSH host（Node 进程）的**内存/CPU/IO 增量可忽略**，且异常时不拖垮宿主。
> 结论先行：**插件不是宿主内存增长主因**；宿主内存主要是 DSH 自身会话/Agent 上下文，重启后随使用重新增长。
> 本文数据来自 2026-10-23 实机测量（Windows 11，DSH 0.2.1-rc.2、profile `web`）。

## 1. 测量方法

- 宿主进程 = `127.0.0.1:3080` 监听者：`Get-NetTCPConnection -LocalPort 3080 -State Listen | % OwningProcess`
- 指标：`Get-Process <pid> | Select WorkingSet64, PrivateMemorySize64, CPU`；插件侧 `mem` 日志（每 2 分钟）输出
  `rssMB/heapMB/timers/pipe{ok,fail}/persist{state,companion,events,skipped}`。
- A/B：patch 里给 `pet-bridge-v46` 加 `disabled: true` 触发 HMR reload（不重启 host），各测 90s，随后移除恢复。

## 2. 修复前后（pipe timeout 刷屏）

| 项       | 修复前（v46）                                        | 修复后（v46-hotpipe）                           |
| -------- | ---------------------------------------------------- | ----------------------------------------------- |
| 发送模型 | 每行新开 `net.connect`，并发 + 600ms 超时 + 即时重试 | **单队列串行**、一次一条连接、状态行按 key 合并 |
| 状态推送 | 每次 `setStatus` 都推，密集时并发连接                | **≥5s 一次（低占用 10s）**、只推当前状态汇总    |
| 失败处理 | 每行单次重试；`pipe timeout` 每次一条                | 指数退避 400ms→30s、不逐行重试、告警 30s 限流   |
| EPIPE    | 误判失败                                             | 桌宠读到一行即主动断开 ⇒ **写成功即投递成功**   |
| 实测     | 2 分钟 112 条 `pipe timeout`                         | 重启后 **0 条**；10 分钟 `pipe{ok:17,fail:0}`   |

## 3. 低占用改动（v46-hotpipe / task-69）

| 项                          | 旧             | 新                                                                                         |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `bridge-state-v2.json` 写盘 | 每 5s          | **10s**（低占用 20s）；`skipped` 计数可观测；关键变化（模式切换）强制立即写                |
| `companion.json`            | 每 5s          | **30s**（互动/退出强制 flush）                                                             |
| `events.json`               | 每个事件同步写 | **2s 去抖**（退出 flush）                                                                  |
| `writeState` 内 sessions    | 每次算 4 次    | **1 次**                                                                                   |
| 低占用模式                  | 无             | RSS ≥ `lowMemory.rssMb`（默认 2000）自动降频：state 20s / 状态推送 10s / 停预生成与小剧场  |
| timer 泄漏自检              | 无             | `loaded/disposed` 与 `mem` 日志输出活动 Timeout 数；dispose 停全部 interval + flush 待写盘 |
| 观测                        | 无             | `mem` 日志（默认 2 分钟）`rssMB/heapMB/timers/pipe/persist`                                |

## 4. 实机 A/B（2026-10-23 16:40–16:44，同一 host pid 39972）

| 窗口         | WS 增量          | 速率     | CPU  |
| ------------ | ---------------- | -------- | ---- |
| 插件开启 90s | −37MB（GC 回落） | ≈0       | 106% |
| 插件禁用 90s | +64MB            | 0.71MB/s | 108% |
| 插件恢复 90s | +59MB            | 0.66MB/s | 112% |

→ 三窗口差异在噪声内：**插件开启/关闭对宿主内存增速与 CPU 无可测影响**。

同一时段插件自身 IO 计数（`mem` 日志）：state 20 次 / ~6 分钟（含 skipped 53）、companion 11、events 2、pipe 34 行 —— 即 ~0.06 次写盘/秒、~0.1 行/秒，量级可忽略。

## 5. 宿主内存主因（证据）

- 用户重启后新 host 启动 ≈346MB；在团队多 Agent 活跃 + 面板插件恢复的情况下 7 分钟内涨到 ≈2.7GB。
- A/B 证明插件不是增量来源；同期宿主 `heapMB` 从 1226→1773MB，与对话/Agent 上下文增长一致。
- 会话仓 `C:\Users\xiqi\.dsh\sessions`：**1650 个文件、约 1.08GB（压缩）**，最大单会话 39MB（压缩）。
  DSH 启动/恢复会回放这些会话→内存随活跃会话数/上下文线性上升。
- 团队模式同时保活多个 Agent 会话，每个都持有上下文 ⇒ 内存显著高于单会话。

**建议（宿主侧，非插件）**：定期归档/删除不再需要的历史会话；避免同时保活大量团队 Agent；长时间挂机后重启一次 host。
插件侧已做到：低占用自动降频、写盘/推送节流、pipe 串行合并且失败退避、timer 自检。

## 6. 4 小时开/关对比测试（给 verifier/lead）

脚本化步骤（不重启 host）：

```powershell
$log = 'E:\project\AI提效\tool\pet-integration-src\pet-work\evidence\pet-bridge-main.log'
$patch = 'C:\Users\xiqi\.dsh\profiles\web\cordis.patch.yml'
function Sample { $p = Get-Process -Id (Get-NetTCPConnection -LocalPort 3080 -State Listen).OwningProcess
  '{0} WS={1}MB Priv={2}MB CPU={3}s' -f (Get-Date -Format HH:mm:ss), [math]::Round($p.WorkingSet64/1MB), [math]::Round($p.PrivateMemorySize64/1MB), [math]::Round($p.CPU,1) }
# A：插件开启 4h —— 每 5 分钟 Sample 一次，记录到 CSV；结束时 grep 'mem' 日志
# B：给 pet-bridge-v46 加 disabled:true → 等 HMR（~10s）→ 同样 4h 采样 → 移除 disabled 恢复
# 对比：WS 斜率(MB/min)、CPU 均值、插件 mem 日志的 pipe/persist 计数
```

判据：B 窗口的 WS 斜率与 CPU 均值若与 A 接近（±15%），则宿主占用与插件无关；若 A 明显更高，用 `mem` 日志定位（timers/pipe/persist）。
注意：需在**用户不操作**且团队 Agent 空闲的时段测，否则 LLM/工具活动会污染结果。

## 7. 面板侧建议（plugin-ui）

- 面板显示 `hostMemory{rssMB, lowFootprint}`（v2 字段，见 DATA-CONTRACT §10.5）。
- 提供一键入口：`mode-off`（停止联动，= 低打扰/暂停联动）与 `mode-resume`；低占用自动降频时面板展示"低占用中"。
- 高内存阈值建议沿用 `lowMemory.rssMb` 配置，不写死。

## 8. 补充（2026-10-23，verifier 观测后）

- **团队 Agent 并发是宿主内存最大的增长源**：本次实测 host RSS 2.9GB 时 heap 约 1.6GB，与"7~8 个 Agent 会话同时保活 + 每个都有长上下文"一致；
  同等情况下插件 mem 日志显示自身写盘/pipe/timer 计数均很低（state ~7 次/分钟、pipe ~0.1 行/秒、timers 15–19）。
- 建议（宿主使用侧）：**idle 时只保留 1 个活跃 Agent**（其余队友结束/不常驻）；定期归档旧会话（sessions 仓已 1.08GB/1650 文件）；
  长挂机（数小时）后重启一次 host。插件侧已在此场景自动进入 lowFootprint（state 20s/statusPush 10s/停预生成与小剧场）。
- 基线指标（用于 4h 对比）：pipeTimeout/pipeBackoff（应为 0）、 imers（本次 15–19，reload 后不应增长）、mem.persist.state/companion/events（约 6/3/1 次每分钟）。
