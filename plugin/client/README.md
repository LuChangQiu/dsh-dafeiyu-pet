# dsh-pet-bridge-ui — 大肥鱼 × DSH 联动 · 设置面板

DSH Web 里的「大肥鱼联动」设置面板（client plugin UI）。**只做管理与可视化，不改联动逻辑**：
- 读：运行状态（host / 桌宠 / 管道）、今日调用数与费用、最近 say、当前 model、生效配置；
- 写：总开关 / 活跃度三档 / 免打扰时段 / 每日费用上限 → `ui-config.json`（sidecar）+ `activity.txt`（即时生效）；
- 测试：说一句 / 跳一下 / 截图（on-demand 走命名管道协议 / 本地抓屏）。

> 与 `dsh-pet-bridge-v7/v8`（tech-scout 维护）的分工：
> 它负责订阅 DSH 事件、生成台词、写 `state.json`、watch `ui-config.json` 热应用；
> 本插件负责 `settings.section` 面板 + `/pet-bridge-ui` host 路由（只读聚合 + sidecar 写入 + 管道测试），
> **不改它的任何文件、不重启 DSH host**。

## 目录

```
dsh-pet-bridge-ui/
├─ package.json          # dsh.client = { platform: 'web', immediately: true, inject: [...] }
├─ lib/
│  ├─ index.js           # Host 半边：状态聚合 + /pet-bridge-ui 路由 + 截图 + 管道测试
│  ├─ web-route.js       # webServer prefix 路由挂载（官方 /api wire 协议同构 + 鉴权栅栏）
│  └─ client.js          # 浏览器半边：window.__ModuleLoader__.load 工厂，注册 settings.section
├─ scripts/
│  ├─ install.ps1        # 备份 patch → 追加 insert → 复制包 → 验证（幂等；-DryRun）
│  └─ rollback.ps1       # 按 marker 截断 patch → 移走包 → 清心跳（-DryRun / -RestoreBackup）
├─ test/smoke.mjs        # Node 侧 15 项 smoke（日志解析/免打扰/wire 协议/写盘/client 契约）
└─ README.md
```

## 架构

```
浏览器（DSH Web 设置页）
  └─ client.js  ── POST /pet-bridge-ui/<endpoint>（同源 cookie，wire 信封） ──► Host 半边 lib/index.js
                                                                               ├─ 读 pet-bridge-main.log（say / loaded 行）
                                                                               ├─ 读 state.json（tech-scout 插件快照，优先）
                                                                               ├─ 读 activity.txt（当前三档）
                                                                               ├─ connect 探命名管道 + tasklist 探 pythonw.exe
                                                                               ├─ 写 ui-config.json（侧车配置） / activity.txt
                                                                               └─ 写管道 say:/act:jump；PowerShell 抓屏
DSH 事件 ──► dsh-pet-bridge-v8（tech-scout）──► 命名管道 ──► 大肥鱼桌宠
                    ▲ 20s 轮询 ui-config.json 热应用；每 20s 写 state.json
```

**为什么 host 路由用 `webServer.register` 而不是 `connection.rpc.handle`**：
DSH 0.2.x 的 client-connection 自身 inject 收缩为 `['credentials']`，其 `rpc.handle` 内部访问
`owner.webServer` 必抛 `cannot get property "webServer" without inject`（已装插件实测结论）。
因此本插件自己 `ctx.inject(['connection','webServer'])` 并注册 prefix 路由，逐分支复刻
`dsh-client-connection` 的 `/api` 传输语义；鉴权用 `connection.requestRejection(req)`
（**必须以方法形式调用**，它读 `this.trustedHosts` / `this.browserAuth`）。

## 安装 / 接线

前置：DSH Web 正在运行（本机 `127.0.0.1:3080`），profile 为 `C:\Users\xiqi\.dsh\profiles\web`，
且 profile `package.json` 的 `dsh.profile.patchReload` 为 `live`（热组合，无需重启 host）。

```powershell
# 预览（零写入）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1 -DryRun
# 正式安装
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
```

install.ps1 做的事（全部可回滚）：
1. 备份 `cordis.patch.yml` → `<pet-work>\backup\profile-web-cordis.patch.yml.before-ui.bak`
   （名字已存在则自动加时间戳；回滚脚本会挑最新）；
2. 复制本包到 `<profile>\node_modules\dsh-pet-bridge-ui`（旧版移入 backup 目录）；
3. 在 `cordis.patch.yml` **末尾追加**一个 insert 块（marker 已存在则跳过，幂等）；
4. 验证：host 存活 → 等插件心跳 `evidence\ui-route-mounted.json`（≤20s）→ 探测
   `POST /pet-bridge-ui/ping`（401/403 表示已挂载且鉴权生效）→ 检查联动插件日志无 `[error]`。

然后**刷新浏览器页面**：设置（齿轮）→ 左侧出现「大肥鱼联动」。

手动安装等价步骤：复制包 → 在 patch 末尾追加下方块 → 刷新页面。

```yaml
- insert:
    - id: pet-bridge-ui
      name: 'dsh-pet-bridge-ui'
      config:
        channel: '/pet-bridge-ui'
        logFile: 'E:\project\AI提效\tool\pet-integration-src\pet-work\evidence\pet-bridge-main.log'
        activityFile: 'E:\project\AI提效\tool\pet-integration-src\pet-work\activity.txt'
        stateFile: 'E:\project\AI提效\tool\pet-integration-src\pet-work\state.json'
        uiConfigFile: 'E:\project\AI提效\tool\pet-integration-src\pet-work\ui-config.json'
        evidenceDir: 'E:\project\AI提效\tool\pet-integration-src\pet-work\evidence'
        heartbeatFile: 'E:\project\AI提效\tool\pet-integration-src\pet-work\evidence\ui-route-mounted.json'
        defaultBudgetPerDayYuan: 1.0
        defaultModel: 'deepseek-flash'
        defaultProvider: 'deepseek-official'
```

## 回滚

```powershell
# 预览
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rollback.ps1 -DryRun
# 按 marker 截断（只删本插件追加段，不覆盖安装后的其它 patch 修改）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rollback.ps1
# 或整文件恢复安装前备份（会丢弃安装后其它 patch 修改，慎用）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rollback.ps1 -RestoreBackup
```

回滚不重启 host；刷新页面后设置项消失。`ui-config.json` 默认保留（用户配置不丢）。

## Config（patch 里可覆盖的字段）

| 字段 | 默认 | 说明 |
|---|---|---|
| `channel` | `/pet-bridge-ui` | HTTP 路由前缀 |
| `pipe` | `\\.\pipe\dafeiyu-pet-whale-single-instance` | 桌宠命名管道（与 pet-bridge 一致） |
| `logFile` | `...\pet-work\evidence\pet-bridge-main.log` | 联动插件日志（解析 say / loaded） |
| `stateFile` | `...\pet-work\state.json` | 联动插件状态快照（优先数据源） |
| `uiConfigFile` | `...\pet-work\ui-config.json` | 面板写入的侧车配置（联动插件热应用） |
| `activityFile` | `...\pet-work\activity.txt` | 活跃度即时通道（联动插件 20s 轮询） |
| `evidenceDir` | `...\pet-work\evidence` | 截图输出目录 |
| `heartbeatFile` | `...\evidence\ui-route-mounted.json` | 路由挂载心跳（安装/验证脚本用） |
| `defaultBudgetPerDayYuan` | `1.0` | 日志/state 都读不到时兜底 |
| `defaultModel` / `defaultProvider` | `deepseek-flash` / `deepseek-official` | 同上 |

## HTTP 端点（panel 内部使用）

`POST <channel>/<endpoint>`，body `{ rpcId, method, payload? }`，响应 `{ type:'server-response', rpcId, result }`；
`result = { ok:true, data } | { ok:false, error:{code,message} }`。同源 cookie 必需（无 cookie 返回 401）。

| endpoint | payload | 返回 data |
|---|---|---|
| `ping` | — | `{ pong, version, now }` |
| `state.get` | — | 见下方「状态聚合」 |
| `config.set` | `{ enabled?, activity?, quietHours?, budgetPerDayYuan?, pet? }` | `{ saved, applied, note, state }` |
| `config.reset` | — | `{ reset, pet, applied, note, state }`（默认值=映射表 §D；size 按 v15 用户偏好 0.36） |
| `logs.get` | `{ lines? }`（默认 80，上限 400） | `{ file, totalRead, lines[], now }` |
| `action.request` | `{ name: 'restart-pet' \| 'start-pet' \| 'stop-pet' }` | `{ queued, request, note }`；上一条未消费完 → `busy` |
| `test.say` | `{ text? }`（≤60 字） | `{ sent, line }`（管道不可写 → `ok:false, code:pipe-unavailable`） |
| `test.jump` | — | `{ sent, action:'jump' }` |
| `test.screenshot` | — | `{ ok, file, bytes, at, dataUrl }`（JPEG dataURL，仅本次点击，不写日志） |
| `pet.nativeui` | `{ on? }` | `{ on, note }`（应急 `cmd:nativeui:on\|off`，临时显示/隐藏桌宠原生菜单） |

### state.get 返回形状

```jsonc
{
  "host": { "online": true, "pid": 39484, "uptimeSec": 42, "platform": "win32" },
  "pet":  { "online": true, "processes": 2, "probeOk": true },
  "pipe": { "online": true, "name": "\\\\.\\pipe\\dafeiyu-pet-whale-single-instance", "latencyMs": 3, "error": null },
  "config": {
    "enabled": true, "activity": "normal", "quietHours": ["23:30-08:00"],
    "budgetPerDayYuan": 1.0, "llmEnabled": true,
    "provider": "deepseek-official", "model": "deepseek-flash",
    "sources": { "stateFile": true, "logLoaded": true, "activityFile": true }
  },
  "saved": { "enabled": true, "activity": "lively", "quietHours": [...], "budgetPerDayYuan": 1.5, "updatedAt": "..." } ,
  "pending": ["activity"],                       // saved 与 effective 不一致的字段（待 watcher 应用）
  "today": { "calls": 16, "cost": 0.0092, "budgetPerDayYuan": 1.0, "ratio": 0.0092 },
  "quiet": { "inQuiet": false, "ranges": ["23:30-08:00"], "now": "14:05" },
  "recentSay": [{ "at": "ISO", "kind": "turnStart", "source": "llm", "line": "…" }],
  "lastSayAt": "ISO", "lastLogAt": "ISO",
  "files": { "logFile": "...", "stateFile": "...", "uiConfigFile": "...", "activityFile": "...", "stateFileFresh": true }
}
```

数据优先级：`state.json`（tech-scout 插件，≤60s 视为新鲜）→ 日志 `loaded v8` 行 → 默认值；
活跃度额外优先 `activity.txt`（即时通道）；今日 calls/cost 优先 state.json，否则解析当天日志 `say` 行。

## 与联动插件的 sidecar 契约

- `ui-config.json`（本插件写，联动插件 20s 轮询热应用）：
  ```json
  { "version": 1, "updatedAt": "ISO", "updatedBy": "dsh-pet-bridge-ui",
    "enabled": true, "activity": "normal",
    "quietHours": ["23:30-08:00"], "llm": { "budgetPerDayYuan": 1.0 } }
  ```
  白名单：`enabled` / `activity` / `quietHours[]` / `llm.budgetPerDayYuan`；**不回写 cordis.patch.yml**。
- `state.json`（联动插件写，本插件只读）：见 tech-scout 约定字段
  （`updatedAt/host/pet/pipe/enabled/activity/quietHours/inQuietHours/todayCalls/todayCost/budgetPerDayYuan/llmEnabled/provider/model/recentSay[]`）。
  注：`state.pet` 有偶发假阴性（v8 已知 bug），本面板以「管道 connect + pythonw 进程探测」为准。
- `activity.txt`：纯文本 `quiet|normal|lively`，本插件与联动插件都会写/读（20s 生效）。

## 安全与隐私

- 路由鉴权：`connection.requestRejection(req)`（DSH 浏览器 cookie；无 cookie 401；跨站 403）；
- 不读 `testHookFile`、不碰 `cordis.patch.yml`、不改 pet-bridge 任何文件、不重启 host；
- 不写 key / 用户对话原文；日志只记行为（`config saved fields=...`、`test say sent=true chars=N`）；
- 截图仅点击时抓当前桌面，保存在 `evidence/ui-shot-*.jpg`，不进日志、不自动上传；
- `ui-config.json` 校验白名单字段，非法值直接 400（`invalid-argument`）。

## 调试

```powershell
# 路由是否挂载（无 cookie 预期 401；未挂载则落到静态/404）
curl.exe -s -o NUL -w "%{http_code}`n" -X POST -H "content-type: application/json" `
  --data '{\"rpcId\":\"p\",\"method\":\"ping\"}' http://127.0.0.1:3080/pet-bridge-ui/ping

# 激活心跳（安装脚本用它判定插件加载成功）
Get-Content 'E:\project\AI提效\tool\pet-integration-src\pet-work\evidence\ui-route-mounted.json'

# 联动插件日志（会显示 ui-config applied / activity preset）
Get-Content 'E:\project\AI提效\tool\pet-integration-src\pet-work\evidence\pet-bridge-main.log' -Tail 20
```

## 已知限制

- 需要刷新一次浏览器页面后设置项才出现（client module graph 在页面启动时加载；HMR 也会推，但刷新最稳）；
- `enabled/quietHours/budget` 是「已保存 → 联动插件 ≤20s 应用」两态（面板显示「待应用」）；`activity` 双写 `activity.txt` 更即时；
- 截图是当前桌面整屏（含桌宠），不是桌宠窗口单独截取；
- 若 profile 关闭 HMR，接线需重启 host 才生效（本任务禁止重启；当前 profile 为 `patchReload: live`）。

## 验收清单

- [ ] 设置页出现「大肥鱼联动」，三状态灯与真实进程/管道一致
- [ ] 三档切换 → 20s 内桌宠节奏变化（联动插件日志 `activity preset`）
- [ ] 总开关/免打扰/预算保存 → 面板显示「待应用」→ ≤20s 后 pending 清空
- [ ] 最近 say 列表与日志最后 N 条一致
- [ ] 说一句/跳一下：桌宠真机冒泡/跳；截图：返回预览图
- [ ] 回滚脚本执行后设置项消失、host 存活

## 桌宠设置字段（ui-config.pet，与 tech-scout v15 约定）

| 字段 | 类型/范围 | 默认 | 通道 |
|---|---|---|---|
| `size` | 0.18~1.0 倍率（迷你0.27/特小0.36/小0.54/中0.72/大0.90） | 0.36（v15 用户偏好） | `cmd:config` 即时 + watcher |
| `opacity` | 0.2~1.0 | 1.0 | 同上 |
| `mode` | `wander`/`follow`/`still`（散步/跟随/原地） | wander | 同上 |
| `lineFreq` | 安静/正常/话多/话痨 | 正常 | 同上 |
| `passthrough` / `locked` | bool（**必须保留入口，否则无法恢复**） | false | 同上 |
| `topmost` / `snap` | bool | true | 同上 |
| `layer` | top/normal/bottom | top | 同上 |
| `bubbleStyle` | auto/light/dark | auto | 同上 |
| `skin` | 字符串 ≤32 | 大肥鱼 | 同上 |
| `soundOn` / `musicLink` | bool | true | 同上 |
| `volume` | 0~1 | 0.9 | 同上 |
| `city` | 字符串 ≤20 | 汕头 | 同上（存 cfg） |
| `quietMinutes` | 0~240 | 30 | 同上 |
| `bubbleMs` | 1000~30000ms | 5000 | 写 `ui-config.bubble`，联动插件 ≤20s 应用（非即时） |

保存时本插件会**立即**通过管道发一条 `cmd:config:{...}`（白名单字段），联动插件 watcher 再按 ui-config 兜底应用一次（幂等）。

## v15 真实链路验证（2026-10-23）

- `node test/smoke.mjs` → **24/24 通过**（日志解析/免打扰/wire 协议/写盘/字段校验/client 契约）。
- `node test/e2e-verify.mjs` → 真实链路：
  - `config.set {pet:{size:0.37,bubbleMs:5000}}` → 26s 后 `state.json.petSettings.size=0.37` + 联动日志 `pet settings pushed`；`state.bubble` 回显 `normalMs=5000/innerMs=3000/reportMs=10000/approvalMs=8000/nightMs=6000` ✅
  - `pet.nativeui {on:true/to:false}` 均 ok（真实桌宠管道）✅
  - `action.request {start-pet}` → 联动插件消费但 `lastAction=failed, message="require is not defined"` ❌（tech-scout v15 ESM/CJS bug，已报，待 v17；「重启桌宠」按钮因此暂不可用）
  - 结束时 ui-config.json 逐字节恢复原样 ✅
- 安装/回滚演练：`rollback.ps1` → 心跳消失 / 路由 405 / 包不存在；`install.ps1` → 心跳恢复 / 路由 401 / host 存活 ✅（详见 `deliverables/PLUGIN-UI.md`）

## 仓库位置（交付仓库 `大肥鱼桌宠-fork`，分支 `custom/dsh-linkage`）

本包在 repo 中的路径：**`plugin/dsh-pet-bridge-ui/`**（与 `install/install.ps1` 的 `$p2` 一致）。
`install/cordis.patch.template.yml` 由 tech-scout 维护、已含本插件 insert 块；**不要手写覆盖 patch**。
`scripts/install.ps1` / `rollback.ps1` 仅用于已安装环境的幂等追加/移除与验证，安装用 repo 的 `install/install.ps1`。

## 调试与验证命令

```powershell
node test/smoke.mjs                 # 离线 24 项
node test/e2e-verify.mjs            # 真实链路（会短暂改 ui-config 并恢复，约 110s）
node test/make-fixture.mjs <out>    # 生成 harness 数据快照
# harness：复制 test/harness/index.html + lib/client.js + react UMD + fixture.js 到同一目录，浏览器打开
```

## 更新（v17，2026-10-23）

- **`ui-action` 已修复**：本面板排队的 `start-pet`/`stop-pet` 均被联动插件消费并 `status=done`（日志 `ui-action handled {... "status":"done"}`，`state.lastAction` 回显），**「重启桌宠」按钮可用**。
- 联动 v0.17.0 / 桌宠 patch-v17；`ui-config.pet`、`ui-config.bubble`、`state.json`（version/petVersion/petSettings/bubble/attribution/lastAction）全部正常。
- 测试隔离修复：`test/smoke.mjs` 的临时配置显式覆盖 `actionFile/petConfigFile/heartbeatFile`，跑测试不再触碰生产 sidecar。
## task-36/40 补全（2026-10-23）

面板现为原生菜单移除后的**唯一控制台**，新增：
- **快捷查看**：查看余额（v19 `cmd:balance`）/ 查看天气 / 在看什么 / 今日汇总 / 显示 / 隐藏 / 回到屏幕内 / 救急恢复；
- **免打扰快捷**：立即免打扰（N 分钟）/ 结束免打扰（`cmd:quiet`）；
- **双击行为**：余额 / 天气 / 音乐 / 台词（`ui-config.pet.doubleClick` → v19 `cmd:config.doubleClick`）；
- **皮肤选择**（下拉）、**静默时长**、**开机自启**（待 v20 `ui-action`）、**退出桌宠**（待 v20 `quit-pet`，与「停止联动」语义区分）；
- Endpoint 新增：`pet.action`（`{name: balance|weather|music|summary|show|hide|snapInto|recover|quietStart|quietEnd|quit}`，`quietStart` 带 `minutes`）；
- `state.get` 新增：`capabilities{petActions,petActionReadiness,doubleClick,autoStart,quit}`、`petOptions{skins,doubleClick,doubleClickOptions,autoStart}`；
- 打包：`license: MIT` + `NOTICE`；`scripts/*.ps1` 全部 UTF-8 **with BOM**（PS5.1 可解析，`-DryRun` 自检通过）。
- 验证：`node test/smoke.mjs`（31/31）、`node test/e2e-actions.mjs`（真实桌宠 9 动作 ok）。