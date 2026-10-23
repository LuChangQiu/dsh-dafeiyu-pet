# DSH-UPGRADE —— DSH 升级/变更时的检查清单

DSH 会持续加能力、改事件、动 API。本插件依赖 **事件契约 + 投影字段 + client 槽位 + 管道协议** 四类接口，DSH 一升级就可能漂移。
本文是升级后（或收到 DSH 新版本时）的**标准动作**，按顺序做，避免"升级完桌宠失联/面板空白/隐私泄漏"。

## 0. 升级前（先保底）

1. 备份：`cordis.patch.yml`、`ui-config.json`、`bridge-state-v2.json`（脚本见 `scripts/plugin-rollback.ps1` 的备份逻辑）。
2. 记录当前版本：`dsh --version`、`bridge-state-v2.json.version`、`petVersion`、面板版本。
3. 确认回滚路径可用：`scripts/plugin-rollback.ps1 -DryRun`、`scripts/pet-rollback.ps1`。
4. 关闭自动升级/或避开正在进行的任务；不要在长任务/多会话活跃时升级。

## 1. 升级后逐项检查

### 1.1 宿主与插件加载
- [ ] `dsh web` 正常启动，端口/登录 URL 正常；host pid 变化（记录新 pid）。
- [ ] 插件加载：`bridge-state-v2.json.version` 正确、`loaded vX` 日志出现、`pet=true/pipe=true`。
- [ ] `cordis.patch.yml` 里 `pet-bridge-vX` 与 `pet-bridge-ui` 两块都在（升级脚本不应覆盖 UI 块）。
- [ ] `http://127.0.0.1:<port>/pet-bridge-ui/home` 返回 200/401（鉴权正常，不是 404）。

### 1.2 事件契约（最容易漂移）
- [ ] 对照 `docs/17-dsh-integration-matrix.md`（能力矩阵）：`session/event` 事件类型是否新增/改名/改字段。
- [ ] 重点事件：`turn/start`、`turn/end`（`reason.kind`）、`tool/call`、`tool/result`、`approval/asked|decided`、`user-questions/request`、`assistant/message`（`usage` 字段）、`agent/status`、`compaction/*`、`goal/change`、`plan/mode`、`team/task`、`job/*`、`schedule/*`。
- [ ] 跑契约测试（fixtures）：`node scripts/test-fixtures.mjs`（task-66 起；未落地前手工注入样例）。
- [ ] 看 v2 `degraded[]` 与日志 `toolType unknown`/`unknown event` 计数是否异常升高。

### 1.3 投影与 API
- [ ] `ctx.sessionProjections.snapshot()`/`list()` 字段是否变化（团队/目标/计划/标题/usage）。
- [ ] `agentTeam`、`userQuestions`、`goal`、`plan`、`tokenUsage`、`contextPressure` 投影 key 是否存在。
- [ ] `sessionController.list()` 是否仍挂起（本机历史问题）；若官方提供同步 API，更新 `task-57` 读取路径与文档。
- [ ] 降级路径演练：临时缺字段时面板显示 `degraded` 而不是空白/报错。

### 1.4 client 槽位
- [ ] `settings.section`、`shell.overlay`、`sidebar.footer.action` 是否仍可用（注册失败应静默）。
- [ ] 主页路由鉴权方式（请求拒绝 API）是否变化。
- [ ] 真实页面：设置面板出现「大肥鱼联动」、主页能打开、右下角徽标/侧栏入口正常。

### 1.5 桌宠管道
- [ ] `node pet-work\tools\pet-cmd.mjs "ping"` 返回 ok。
- [ ] 协议命令（`say:`/`say3:`/`act:`/`fx:`/`cmd:config`/`state:`/`bal:`）逐个抽查。
- [ ] 单实例互斥正常（不会起两个进程）。

### 1.6 隐私与性能
- [ ] `node scripts/audit-privacy.mjs`：v2/events/companion/log **0 绝对路径、0 对话原文、0 参数、0 key**。
- [ ] 日志无 `E:\`/`C:\`/`\Users\`/`\project` 命中（新日志段）。
- [ ] 事件热路径：无 `JSON.stringify` 大对象、无同步写盘、无逐事件 snapshot；写盘 ≤1/min。
- [ ] 4 小时挂机内存/CPU 正常（对照 `17-assets/` 基线）。

### 1.7 回归验收
- [ ] V6 增量清单跑一遍（F1/F4/M1/M2/V14/V22 等）。
- [ ] 失败项按 `verify/V6-deep-integration.md` 的反向 FAIL 判据修。
- [ ] 更新本文件与 `docs/DATA-CONTRACT.md` 的版本记录。

## 2. 升级出问题怎么办

1. **先回滚，不硬修**：`scripts/plugin-rollback.ps1`（插件+面板+patch 精准移除）→ 再 `scripts/pet-rollback.ps1`（桌宠回官方）。
2. 保留证据：导出 `bridge-state-v2.json`、`events.json`、日志尾部（已脱敏）到 `evidence/incident-<date>/`。
3. 在 `docs/` 记录：DSH 版本、报错、受影响功能、处理方式。
4. 若只是某个投影/事件缺失：先把对应功能标 `degraded`（面板可见），不阻塞其它功能。

## 3. 版本配对记录

每次升级后在本节追加：

| 日期 | DSH 版本 | 插件版本 | 桌宠 patch | 结果 | 备注 |
|---|---|---|---|---|---|
| 2026-10-23 | 0.2.1-rc.2 | 0.46.0 | v46 | PASS | 三本账/工具分类上线 |

> 提示：插件 `package.json.version`、`bridge-state-v2.json.version`、`petVersion` 三处应一致更新（同一个 commit）。
