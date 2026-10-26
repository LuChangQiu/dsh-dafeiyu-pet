# EXTENDING —— 如何给「大肥鱼 × DSH」加新能力

本仓库 = 桌宠源码（`pet/`）+ DSH host 插件（`plugin/server`）+ 管理面板（`plugin/client`）+ 脚本（`scripts/`、`install/`）。
DSH 会持续加功能（新事件/新工具/新 bundle/新 UI 槽位），本文说明**如何低风险地扩展**，避免改一处崩一片。

## 0. 设计原则（先读）

1. **观察，不操作**：插件只读 DSH 事件/投影，任何"替你点确认/发消息/改文件"的能力都不做。
2. **只推标量**：状态/事件只存类型、计数、枚举、耗时、工具名；**禁读** `user/message.content`、`assistant/message.content`、`tool/call.arguments`、`tool/result.*`、`cwd`/workspace 绝对路径、审批 reason 原文、credentials。
3. **缺失即降级**：DSH 没开某能力（bundle 未装/投影缺失）时输出空字段 + `degraded[]`，不抛错、不阻塞主流程。
4. **低频 + 可配置**：新行为默认低概率/长冷却/可关；写盘 ≤1/min 聚合，事件只入环形缓冲。
5. **配置优先于代码**：阈值、白名单、事件→行为映射尽量外置到配置（`task-66` 起为 `config/mappings.json`），代码只做机制。
6. **未知不崩**：未知事件/未知工具归 `unknown`（计数 + 日志），绝不因一个陌生事件整插件失败。

## 1. 目录速查

| 位置 | 作用 |
|---|---|
| `plugin/server/lib/index.js` | 事件路由、状态/气泡队列、归因、写 `bridge-state-v2.json`/`events.json`、ui-action 消费 |
| `plugin/server/lib/tool-types.js` | 工具名 → toolType 分类规则（9 类） |
| `plugin/server/lib/pricing.js` | token 分项计价（input/output/cacheRead/cacheWrite） |
| `plugin/server/lib/mode.js` | 静一静/专注/下班 状态机 |
| `plugin/server/lib/privacy.js` | 路径/敏感字段脱敏 |
| `plugin/client/lib/home.js` | 大肥鱼主页（卡片/时间线/会话/互动） |
| `plugin/client/lib/client.js` | 设置页「大肥鱼联动」面板 |
| `plugin/client/lib/index.js` | host 路由 `/pet-bridge-ui/*`、`state.get`、鉴权 |
| `pet/桌宠.py` | 桌宠本体 + 管道协议（`say:`/`act:`/`fx:`/`cmd:`/`state:`） |
| `docs/DATA-CONTRACT.md` | 状态文件/事件/字段的权威契约 |
| `docs/STATE-CHANNEL.md` | 状态通道协议与多会话规则 |

## 2. 加一个新工具分类（例如 DSH 新增 `db_query` 工具）

1. 在 `plugin/server/lib/tool-types.js` 加规则（按判定顺序；`mcp__*` 白名单优先）。
2. 若映射到已有类型（read/write/command/search/plan/knowledge/agent/mcp/unknown）就结束；需要新类型时：
   - 更新 `docs/DATA-CONTRACT.md` 的 `toolType` 枚举；
   - 更新 `scripts/test-tool-types.mjs` 断言；
   - 面板/主页图标映射（`plugin/client/lib/*.js`）加对应文案/图标。
3. 跑 `node scripts/test-tool-types.mjs`（应全过）+ `npm run lint`。
4. 触发一次该工具，确认 `bridge-state-v2.json.status.toolType` 正确、日志有 `toolType mapped`。

## 3. 加一个新事件（例如 DSH 新增 `foo/changed`）

1. 在 `plugin/server/lib/index.js` 事件路由里订阅（沿用 `ctx.on('session/event', ...)`），**先过归因过滤**（真人主会话 vs 团队/子代理 background）。
2. 决定表现层级：只更新 status / 写 events（S0–S3）/ 触发气泡（默认低频、可关）。
3. 只取标量字段；不落原文/路径/参数；异常 try/catch，失败降级 `degraded`。
4. 更新 `docs/DATA-CONTRACT.md`（事件 kind/字段/级别）+ `docs/STATE-CHANNEL.md`（若影响状态语义）。
5. 加 fixture 到 `scripts/fixtures/`（`task-66` 起）并在契约测试里断言；手动验证用 `cfg.testHookFile` 注入。
6. 面板时间线/筛选（`plugin/client/lib/home.js`）按需加分类；加 smoke 用例。

## 4. 加一个新桌宠动作 / FX

1. 在 `pet/桌宠.py` 的管道协议分发里新增命令（如 `fx:<name>`），实现绘制/动画（QPainter 叠加层，无需美术素材时用代码绘制）。
2. 在 `docs/DATA-CONTRACT.md` 的协议段登记命令名/参数/默认时长。
3. 插件侧用 `sendBubble`/`sendPetCommand` 调用；动作走现有节流（`guards.maxActionsPerHour`、状态不变不演出）。
4. 多帧截图验证（3–5 帧）并放 `evidence/`；回归 `node scripts/test-*.mjs`。

## 5. 加一个面板卡片 / 设置项

1. 数据：优先从 `state.get`（host 侧 `/pet-bridge-ui`）取；新字段先在 `bridge-state-v2.json` 落盘、`DATA-CONTRACT.md` 登记。
2. UI：`plugin/client/lib/home.js`（主页）或 `client.js`（设置）加组件；数据源标记严格 `v2 / fallback / empty`。
3. 操作：写 `ui-action.json`（`mode-silent` 等）或 `ui-config.json`（配置真源），**不要**让 UI 直接操作桌宠进程。
4. 测试：`plugin/client/test/smoke.mjs` 加用例；真实链路 E2E（改配置→等下发→回显）；截图 `screenshots/ui-*.png`。
5. 权限：仅 `settings.section` / `shell.overlay` / `sidebar.footer.action` 等**加性槽位**；不要用会替换官方 UI 的槽位。

## 6. 加一个配置项（面板可调）

1. `ui-config.json` 加字段（面板写入）→ host 侧白名单校验 → 需要下发给桌宠时补齐 `cmd:config` 映射（以 `pet/config.json` + `ui-config.json` 字段为准）。
2. 默认值写进 `DATA-CONTRACT.md`/面板默认值表；非法值拒绝并回 `failed`。
3. 兼容：旧配置缺字段时用默认，不影响升级。

## 7. 提交前检查清单

```powershell
npm run lint                          # node --check + prettier（pre-commit 钩子同款）
node scripts/test-tool-types.mjs      # 工具分类
node scripts/test-pricing.mjs         # 费用公式（v47+）
node scripts/test-mode.mjs            # 模式状态机（v47+）
node scripts/audit-privacy.mjs        # v2/events/companion/log 路径/原文/key 抽检
# 面板：node plugin/client/test/smoke.mjs
```

然后：`git pull` → 小步 commit（中文说明）→ 部署（profile 新包 + patch id 定向替换）→ 确认 `loaded vX` → 更新 `docs/DATA-CONTRACT.md` 与 `CHANGELOG`（如有）。

## 8. 版本兼容与降级

- 新能力一律**特性探测**（服务 `ctx.get` / 投影 unit / 工具名），缺失→空态+`degraded`，不要假设 DSH 版本。
- 客户端槽位注册用 try/catch，失败静默跳过（不炸页面）。
- 状态文件新旧字段并存一个版本周期，面板优先新字段、回退旧字段，之后再移除旧字段。
- DSH 升级时的检查清单见 `docs/DSH-UPGRADE.md`。


