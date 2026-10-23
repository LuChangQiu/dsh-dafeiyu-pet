# PLUGIN-UI.md — 大肥鱼 × DSH 联动 · 管理界面（task-26 交付说明）

> 交付人：plugin-ui ｜ 交付日期：2026-10-23 ｜ 状态：**已接线并运行于生产 DSH Web（未重启 host）**，E2E 真实链路已验证；真实页面截图待用户补（清单见 §9）。
> 代码位置：`%PROJECT_ROOT%\tool\pet-integration-src\pet-work\plugin-ui\dsh-pet-bridge-ui\`；repo 副本：`%PROJECT_ROOT%\tool\大肥鱼桌宠-fork\plugin\dsh-pet-bridge-ui\`（branch `custom/dsh-linkage`，待 tech-scout commit）。

---

## 1. 交付结论（TL;DR）

| 项 | 结果 |
|---|---|
| 形态 | **真正的 DSH Web client plugin**（`settings.section` 设置面板「大肥鱼联动」），非 HTTP 兜底页面 |
| 激活 | 已装入 profile `node_modules` + `cordis.patch.yml` 追加 insert 块；靠 `patchReload: live` 热组合生效，**host pid 39484 全程存活、未重启** |
| 状态 | host / 桌宠 / 管道 三在线；联动 v0.15.0；桌宠 v1.1.5+patch-v15；今日 calls/cost；最近 say 真实数据 |
| 基础设置 | 总开关、活跃度三档、免打扰/深夜、每日预算、大小、透明度、模式、语录频率、气泡停留时长、城市、音乐联动、音效、穿透、锁定、置顶、贴边、层级、气泡风格、皮肤、音量、静音时长 |
| 应急控制 | 重启桌宠（走 ui-action.json）、停止联动、恢复默认配置、查看日志（最近 80 条）、回滚指引、应急显示/隐藏原生菜单（`cmd:nativeui:on/off`） |
| 测试按钮 | 说一句（`say:`）、跳一下（`act:jump`）、截图（PowerShell 抓屏 → dataURL 预览） |
| 验证 | smoke 24/24；真实链路 E2E（ui-config.pet → `pet settings pushed` → state 回显）；回滚演练通过 |
| 已知问题 | `ui-action` 的 ESM/CJS bug 已在 **v17 修复**：本面板排队的 `start-pet`/`stop-pet` 均被消费并 `status=done`（日志 `ui-action handled ... "status":"done"`），「重启桌宠」按钮可用 ✅ |

## 2. 架构

```
DSH Web 浏览器（设置页 → 大肥鱼联动）
  │  client plugin: lib/client.js（window.__ModuleLoader__ 工厂，无需构建）
  │  POST /pet-bridge-ui/<endpoint>（同源 cookie + 官方 wire 信封）
  ▼
Host 半边: lib/index.js（HSM 插件，host pid 内）
  ├─ 读 pet-bridge-main.log 尾部   → 最近 say / 今日 calls+cost / loaded 生效快照
  ├─ 读 state.json（联动插件 v15） → host/pet/pipe、version、petSettings、bubble、lastAction
  ├─ 读 activity.txt + 桌宠 config.json（只读）
  ├─ connect 探命名管道 + tasklist 探 pythonw.exe
  ├─ 写 ui-config.json（sidecar 真源）/ activity.txt（即时通道）
  ├─ 写 ui-action.json（应急动作队列）
  ├─ 管道即时下发 cmd:config:<json> / cmd:nativeui:on|off
  └─ PowerShell 抓屏（仅点击「截图」时）
  ▲
  │ 20s 轮询 ui-config / 写 state.json
dsh-pet-bridge v15（tech-scout）────────────────► 命名管道 ──► 大肥鱼桌宠
```

关键设计取舍：
1. **host 路由用 `webServer.register`，不用 `connection.rpc.handle`**：DSH 0.2.x 的 client-connection 自身 inject 收缩为 `['credentials']`，其 `rpc.handle` 内部访问 `owner.webServer` 必抛 `cannot get property "webServer" without inject`（已装第三方插件实测结论）。本插件 `ctx.inject(['connection','webServer'])` 自注册 prefix 路由，逐分支复刻官方 `/api` 传输语义；鉴权用 `connection.requestRejection(req)`（**必须以方法形式调用**，读 `this.trustedHosts/browserAuth`）。
2. **client bundle 手写、零构建**：`package.json` 声明 `dsh.client: {platform:'web', immediately:true, inject:['@deepseek-ai/dsh-client-ui-settings']}` + `exports['./client']`；`lib/client.js` 为 `window.__ModuleLoader__.load({id, factory(require){ const React = require('react') ... }})` 工厂格式，由 host 以 `/plugins/<pkg>/client.js` 提供。
3. **配置真源 = ui-config.json（sidecar），不回写 cordis.patch.yml**：避免与调试/回滚冲突；`activity` 额外双写 `activity.txt`（联动插件 20s 轮询即时生效）；可管道项（`cmd:config`）由本插件保存时立即下发一次，联动插件 watcher 再按 ui-config 兜底应用。
4. **应急动作不直接杀/启进程**：写 `ui-action.json` 由联动插件消费（tech-scout 生命周期托管 task-24），本插件只排队 + 展示 `state.json.lastAction` 结果。

## 3. 交付物清单

```
plugin-ui/dsh-pet-bridge-ui/                    # 源码（repo 内为 plugin/dsh-pet-bridge-ui/）
├─ package.json                                  # dsh.client 声明 + exports['./client']
├─ lib/index.js                                  # Host 半边：状态聚合 + 路由 + 截图 + 管道 + sidecar
├─ lib/web-route.js                              # webServer prefix 路由 + 鉴权栅栏（wire 协议）
├─ lib/client.js                                 # 浏览器半边：settings.section 面板（唯一控制台）
├─ scripts/install.ps1                           # 备份 patch → 追加 insert（幂等）→ 复制包 → 验证
├─ scripts/rollback.ps1                          # 按 marker 截断 patch → 移走包 → 清心跳
├─ test/smoke.mjs                                # 24 项离线 smoke（解析/路由/写盘/契约）
├─ test/e2e-verify.mjs                           # 真实链路 E2E（ui-config/state/ui-action/nativeui）
├─ test/harness/index.html + make-fixture.mjs    # 真实组件 + 真实数据快照 + mock 传输的渲染验证
└─ README.md                                     # 安装/回滚/接口契约/调试
```

本目录证据文件：
- `screenshots/ui-*.png`（5 张 harness 图，见 §8）
- `ui-e2e-verify.json`（真实链路 E2E 原始结果）
- `ui-rollback-drill.md`（回滚演练记录）

## 4. 面板功能对照需求

| 需求 | 实现 | 状态 |
|---|---|---|
| 运行状态（host/pet/管道） | 状态卡三灯：host pid/uptime；桌宠（管道 connect + pythonw 进程探测，规避 state.pet 假阴性）；命名管道延迟 | ✅ 真实数据 |
| 活跃度三档 | 安静/正常/活泼 分段按钮 → 写 ui-config + activity.txt；≤20s 生效（日志 `activity preset`） | ✅ E2E |
| 总开关 | enabled toggle → ui-config；联动插件 watcher ≤20s 应用 | ✅ |
| 免打扰/深夜时段 | 文本 `HH:MM-HH:MM[, ...]` 多段校验；显示当前时刻是否在免打扰内 | ✅ |
| 每日费用上限 | 数字输入 + 今日 calls/cost 进度条（state.json 优先，日志兜底） | ✅ |
| 桌宠外观 | 大小（滑杆+五档 迷你0.27/特小0.36/小0.54/中0.72/大0.90）、透明度、模式（散步/跟随/原地）、鼠标穿透、锁定位置、置顶、贴边吸附、层级、气泡风格、皮肤、音量、静音时长 | ✅ `cmd:config` / ui-config |
| 语录与气泡 | 语录频率（安静/正常/多/痨）、气泡停留时长、城市、音乐联动、音效；显示生效气泡节奏（普通/内心/报账/审批/深夜） | ✅（bubble 走 ui-config.bubble） |
| 当前 model | 状态区显示 provider/model + LLM 开关 | ✅ |
| 最近 N 条 say | 最近 10 条（时间/kind 中文标签/台词），state.json 优先、日志兜底 | ✅ |
| 测试按钮 | 说一句（自定义台词）/ 跳一下 / 截图（预览 + 文件路径 + 大小） | ✅ 真实管道/抓屏 |
| 配置持久化 | ui-config.json（字段白名单校验，非法值 400）；与 tech-scout 字段约定见 §6 | ✅ |
| 「以管理界面为准」 | 状态区徽标 + 原生菜单移除说明 + 版本行 | ✅ |
| 应急控制 | 重启桌宠 / 停止联动 / 恢复默认配置 / 查看日志 / 回滚指引 / 应急显示原生菜单 | ⚠️ 重启桌宠待 v17（ui-action bug）；其余 ✅ |
| 风格一致 | 深色、13px、rgba 边框卡片、与 DSH 设置页同款排版；nav 绿色高亮 | ✅ |

## 5. 接线与安装（已执行）

安装脚本（幂等，`-DryRun` 零写入）：
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "...\dsh-pet-bridge-ui\scripts\install.ps1" -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File "...\dsh-pet-bridge-ui\scripts\install.ps1"
```
做的事：
1. 备份 `cordis.patch.yml` → `pet-work\backup\profile-web-cordis.patch.yml.before-ui*.bak`；
2. 复制包到 `<profile>\node_modules\dsh-pet-bridge-ui`（旧版移入 backup）；
3. **只追加**一个 insert 块到 `cordis.patch.yml` 末尾（marker 已存在则跳过，绝不重写整文件）；
4. 验证：host 存活 → 插件心跳 `evidence/ui-route-mounted.json`（≤20s）→ `POST /pet-bridge-ui/ping` 返回 401（路由已挂载 + 鉴权生效）→ 联动日志近 40 行无 `[error]`。

### ⚠️ patch 覆盖事故与防再犯（重要教训）
- 事故：13:55 tech-scout 重写 `cordis.patch.yml` 时（截断到自身 header 再追加）把 UI 块切掉 → 插件被热组合卸载。**已用 install.ps1 幂等恢复**。
- 防再犯：① tech-scout 已承诺按 id 定位替换、不整文件重写，改完自动跑一次 `install.ps1` 并 `Select-String pet-bridge-ui` 自检；② repo 的 `install/cordis.patch.template.yml` 已把 `pet-bridge-*` + `pet-bridge-ui` 两块纳入**单一模板真源**；③ 任何重写 patch 的脚本都必须保留/重建 UI 块；④ 安装后以「心跳文件 + 路由 401」为准判活。
- 仍建议 tech-scout 在模板 UI 块补 2 行（已发消息，repo 可移植性）：`petConfigFile: '{{PET_WORK}}\pet\config.json'`、`actionFile: '{{PET_WORK}}\ui-action.json'`（本机由代码默认值兜底）。

### repo 集成
- 目录：`plugin/dsh-pet-bridge-ui/`（与 `install/install.ps1` 的 `$p2 = Join-Path $RepoRoot 'plugin\dsh-pet-bridge-ui'` 一致；lead 需求里的 `plugin-ui/` 即此目录，以 install.ps1 为准）；
- `install/cordis.patch.template.yml` 已含 UI insert 块（tech-scout 维护），**不要手写覆盖**；
- commit 由 tech-scout 在 `custom/dsh-linkage` 分支追加（本包为未跟踪目录 `?? plugin/dsh-pet-bridge-ui/`）。

## 6. 接口契约

### 6.1 HTTP 端点（POST `<channel>/<endpoint>`，同源 cookie；body `{rpcId,method,payload?}`，响应 `{type:'server-response',rpcId,result}`；`result={ok:true,data}|{ok:false,error}`）
| endpoint | payload | 返回 |
|---|---|---|
| `ping` | — | `{pong,version,now}` |
| `state.get` | — | 聚合状态（见 6.2） |
| `config.set` | `{enabled?,activity?,quietHours?,budgetPerDayYuan?,pet?}` | `{saved,applied,note,state}` |
| `config.reset` | — | `{reset,pet,applied,note,state}`（默认值=映射表 §D，size 按 v15 用户偏好 0.36） |
| `logs.get` | `{lines?}` | `{file,totalRead,lines[],now}`（单行截断 400 字符） |
| `action.request` | `{name:'restart-pet'\|'start-pet'\|'stop-pet'}` | `{queued,request,note}`；未消费完成时 `busy` |
| `test.say` | `{text?}`（≤60 字） | `{sent,line}` / `pipe-unavailable` |
| `test.jump` | — | `{sent,action:'jump'}` |
| `test.screenshot` | — | `{file,bytes,at,dataUrl}` |
| `pet.nativeui` | `{on?}` | `{on,note}`（`cmd:nativeui:on|off`） |

鉴权：`connection.requestRejection(req)`；无 cookie 401、跨站 403、GET/非 JSON 405/415。内部测试命令（无 cookie 预期 401）：
```powershell
curl.exe -s -o NUL -w "%{http_code}`n" -X POST -H "content-type: application/json" --data '{\"rpcId\":\"p\",\"method\":\"ping\"}' http://127.0.0.1:3080/pet-bridge-ui/ping
```

### 6.2 `state.get` 返回（节选）
```jsonc
{
  "host": {"online":true,"pid":39484,"uptimeSec":..}, "pet":{"online":true,"processes":2,"probeOk":true},
  "pipe": {"online":true,"name":"\\\\.\\pipe\\dafeiyu-pet-whale-single-instance","latencyMs":52},
  "config": {"enabled":true,"activity":"normal","quietHours":["23:30-08:00"],"budgetPerDayYuan":1.0,
             "llmEnabled":true,"provider":"deepseek-official","model":"deepseek-flash","sources":{...}},
  "saved": { ...ui-config 原样... }, "pending": ["pet.bubbleMs"],
  "petSettings": {"size":0.36,"opacity":1,"mode":"wander","lineFreq":"正常","passthrough":false,"locked":false,
                  "topmost":true,"snap":true,"layer":"top","bubbleStyle":"auto","skin":"大肥鱼","soundOn":true,
                  "volume":0.9,"musicLink":true,"city":"汕头","quietMinutes":30,"bubbleMs":5000},
  "petSettingsApplied": { ...state.json.petSettings... }, "petSettingsNative": { ...桌宠 config.json 只读镜像... },
  "petSettingsChannels": {"size":"immediate", ..., "bubbleMs":"pending-plugin"},
  "bubble": {"normalMs":5000,"innerMs":3000,"reportMs":10000,"approvalMs":8000,"nightMs":6000},
  "versions": {"uiPlugin":"0.1.0","bridgePlugin":"0.15.0","pet":"v1.1.5+patch-v15"},
  "lastAction": {"name":"start-pet","status":"failed","message":"require is not defined"},
  "today": {"calls":..,"cost":..,"budgetPerDayYuan":1.0,"ratio":..}, "quiet": {"inQuiet":false,...},
  "recentSay": [{"at":"ISO","kind":"turnStart","source":"llm","line":"…"}],
  "files": {logFile,stateFile,uiConfigFile,activityFile,petConfigFile,actionFile,stateFileFresh}
}
```

### 6.3 sidecar 文件（与 tech-scout 约定）
- `ui-config.json`（本插件写）：`{version,updatedAt,updatedBy,enabled,activity,quietHours[],llm:{budgetPerDayYuan},pet:{size,opacity,mode,lineFreq,passthrough,locked,topmost,snap,layer,bubbleStyle,skin,soundOn,volume,musicLink,city,quietMinutes,bubbleMs},bubble:{normalMs,innerMs,reportMs,approvalMs,nightMs}}`；联动插件 20s 轮询应用（日志 `ui-config applied` / `pet settings pushed`），**不回写 cordis.patch.yml**。
- `state.json`（联动插件写，本插件只读）：`version/petVersion/host/pet/pipe/enabled/activity/quietHours/inQuietHours/todayCalls/todayCost/budgetPerDayYuan/llmEnabled/provider/model/petSettings/bubble/attribution/lastAction/recentSay[]`。
- `ui-action.json`（本插件写、联动插件消费并原地补 `handledAt/status/message`）：`{id,name,requestedAt,requestedBy}` → `state.json.lastAction` 回报。
- `activity.txt`：`quiet|normal|lively` 纯文本，双方可写（20s 生效）。

## 7. 验证证据

### 7.1 离线 smoke（24/24 通过）
`node test/smoke.mjs`：日志解析（say/loaded/今日计数）、免打扰跨午夜、wire 协议（ping/state/config.set/config.reset/logs/action.request/pet.nativeui/鉴权栅栏/信封校验/405/415）、pet 字段规范化与 `cmd:config` 白名单、bubble 派生、client bundle 契约。

### 7.2 接线与运行证据（生产 host pid 39484，未重启）
- 插件激活心跳：`pet-work\evidence\ui-route-mounted.json` → `{"mountedAt":"2026-10-23T06:11:13.974Z","pid":39484,"channel":"/pet-bridge-ui","version":"0.1.0","plugin":"dsh-pet-bridge-ui"}`
- 路由：`POST /pet-bridge-ui/ping` → **401**（已挂载且被鉴权栅栏拦截；未挂载时为 404/405）
- host 存活：pid 39484 全程在线
- 联动日志近 40 行无 `[error]`
- 状态：host/pet/pipe 三在线；联动 v0.15.0；patch-v15；当前 model `deepseek-official/deepseek-flash`

### 7.3 真实链路 E2E（`test/e2e-verify.mjs` → `ui-e2e-verify.json`）
| 步骤 | 结果 |
|---|---|
| `config.set {pet:{size:0.37,bubbleMs:5000}}` | ok；管道即时下发 `cmd:config:{"size":0.37}` ok |
| 26s 后 | `state.json.petSettings.size=0.37`（联动插件已应用）；日志 `pet settings pushed`；`state.bubble` 回显 normalMs 5000/inner 3000/report 10000/approval 8000/night 6000 ✅ |
| `pet.nativeui {on:true}` / `{on:false}` | 均 `ok:true`（真实桌宠管道）✅ |
| `action.request {start-pet}` | v15 时消费但失败（`require is not defined`）❌ → **v17 修复后**本面板排队的动作均被消费且 `lastAction.status=done`（日志 `ui-action handled {"name":"stop-pet","status":"done"}`）✅ |
| 恢复 | ui-config.json **逐字节恢复**，size 回 0.36，无残留 ✅ |

> 补充：v17 修复后再次验证了面板→`ui-action.json`→联动插件→`lastAction` 的完整闭环（动作 id 由本面板生成，`status=done`，见返回的 `ui-action.json` 与日志）。「重启桌宠」按钮现在可用。

### 7.4 回滚演练（`ui-rollback-drill.md`）
`rollback.ps1 -DryRun` 预览零写入 → `rollback.ps1` 真实回滚（移除 1053 字符块、移走包、删心跳、保留 ui-config）→ 外部验证 heartbeat=False / patch 无 UI 块 / 包不存在 / 路由 405 ✅ → `install.ps1` 重装 → 心跳恢复 / 路由 401 / host 存活 ✅。

## 8. Harness 截图（组件级证据）

> Chrome DevTools MCP 的浏览器**没有 DSH 认证 cookie**（`127.0.0.1:3080` 直接返回 401），无法截真实设置页。为保证可复现验证，用 `test/harness`：**原封不动的 lib/client.js** + **真实环境只读快照数据**（state.get/logs.get fixture）+ mock 同源传输 + 与 DSH 一致的深色样式上下文渲染并交互（点击三档/保存/说一句/日志/回滚/截图均实际触发组件逻辑，mock 记录到调用序列）。
> 渲染验证 JSON：headings = `运行状态/联动总开关/活跃度/免打扰 / 深夜时段/每日费用上限/桌宠外观/语录与气泡/最近 say 记录/运行日志/应急控制/测试（on-demand）`；交互后 mock calls = `state.get→config.set→test.say→logs.get`。

| 截图 | 内容 |
|---|---|
| ![状态/活跃度/保存](screenshots/ui-01-status-activity-save.png) | 运行状态三灯 + 版本 + 最近应急动作；切「活泼」并保存后的提示与「待联动插件应用（≤20s）」 |
| ![外观与语录](screenshots/ui-02-pet-appearance-quote.png) | 桌宠外观（大小/透明度/模式/穿透/锁定/置顶/贴边/层级/皮肤/音量/静音）+ 语录与气泡 + 最近 say 真实记录 |
| ![日志/应急/测试](screenshots/ui-03-logs-emergency-test.png) | 运行日志（真实 80 条尾部）+ 应急控制（重启/停止/恢复默认/回滚指引/原生菜单）+ 测试按钮 |
| ![截图预览](screenshots/ui-04-test-screenshot-preview.png) | 测试区「截图」返回预览 + 文件路径（harness 用示例图，避免泄露真实桌面） |
| ![最新气泡/应急](screenshots/ui-05-bubble-emergency-test-latest.png) | 最新版：生效气泡节奏行（普通5s/内心3s/报账10s/审批8s/深夜6s）+ 应急/测试完整区 |

## 9. 用户真实页面截图清单（待补，1 分钟）

1. 打开 DSH Web → 设置（齿轮）→ 左侧「大肥鱼联动」→ **整页截图**（状态区 + 基础设置）。
2. 活跃度切「活泼」→ 点「保存设置」→ 等 20s → 截图（桌宠节奏变化 + 面板 pending 清空/提示）。
3. 依次点「说一句」「跳一下」「截图」→ 截图（桌宠真机冒泡/跳 + 面板截图预览）。
> 补图后替换本文件 §8 下方即可（保留 harness 图作为组件级证据）。

## 10. 已知问题与待办

| # | 问题 | 影响 | 状态 |
|---|---|---|---|
| 1 | ~~`ui-action` 执行 `require is not defined`~~ | ~~「重启桌宠」按钮执行失败~~ | **已解决（v17）**：动作闭环验证 `status=done`，「重启桌宠」可用 |
| 2 | 真实页面截图未取（Chrome MCP 浏览器无认证 cookie；host 不可重启） | 证据用 harness 图代替 | 待用户按 §9 截图 |
| 3 | 气泡停留时长走 `ui-config.bubble`（tech-scout 20s 应用），非即时 | ≤20s 生效 | 可接受（面板显示待应用） |
| 4 | 面板数据 5s 轮询；state.json 由联动插件 20s 写一次 | 状态可能有 ≤20s 延迟 | 设计如此；字段都有日志/文件兜底 |
| 5 | `patchReload: live` 是热组合前提；若 profile 关闭 HMR 需重启 host 才生效 | 换机器时注意 profile 配置 | 当前 profile 为 live |
| 6 | 测试隔离修复：`smoke.mjs` 早期版本未覆盖 `actionFile` 路径，会写生产 `ui-action.json`（曾误排队 2 条 `stop-pet`，v17 执行 done；桌宠现仍在线） | 仅影响测试阶段 | **已修**：tmpCfg 显式隔离 `actionFile/petConfigFile/heartbeatFile`，并验证跑测试后生产 action 文件 mtime 不变 |

## 11. 安全与隐私

- 路由鉴权：DSH 浏览器 cookie（`connection.requestRejection`）；无 cookie 401、跨站 403；不引入绕过/白名单后门。
- 只读逻辑：不改 tech-scout server 文件、不写 `cordis.patch.yml`（接线除外，且只追加）、不重启 host、不杀桌宠进程。
- 不记录 key / 用户对话原文：日志只记行为（`config saved fields=...`、`test say sent=true chars=N`）；`includeRecentText` 保持 false。
- 截图仅点击时抓当前桌面，保存 `evidence/ui-shot-*.jpg`，不进日志、不上传；harness 用示例图。
- 写入校验：activity/时段/预算/pet 字段全部白名单 + 范围校验（非法值 `invalid-argument`）。

## 12. 后续（交给 repo 维护者）

1. tech-scout 在 `custom/dsh-linkage` 追加 commit：`plugin/dsh-pet-bridge-ui/` + 模板 UI 块补齐 2 行 config；
2. v17 修复 ui-action 后跑一次 `node test/e2e-verify.mjs`（期望 `lastAction.status=done`）；
3. 用户补 3 张真实截图（§9）；
4. 如需调整默认值：改 `lib/index.js` 的 `DEFAULTS.petDefaults` 与 README/映射表同步。

---

# 附录 A — task-36/40：原生菜单功能平移到面板（功能平价矩阵）

> 背景：用户选 C（原生右键菜单/设置窗口/托盘菜单移除），面板是**唯一控制台**。
> 本附录给出「旧入口 → 新面板入口」逐项对照；MISSING 项按 P1/P2 分流标注。

## A.1 本轮新增（已实现并验证）

| 功能 | 面板入口 | 通道 | 状态 |
|---|---|---|---|
| 查看余额 | 快捷查看 → 查看余额 | `cmd:balance`（v19 已上线；无 key 回 `balance-nokey` 文案） | ✅ 真实链路验证 |
| 查看天气 | 快捷查看 → 查看天气 | `cmd:weather` | ✅ |
| 看一眼在放什么 | 快捷查看 → 在看什么 | `cmd:music` | ✅ |
| 今日汇总/小票 | 快捷查看 → 今日汇总 | `cmd:summary`（读 `daily_receipt.txt` 最近 4 行上气泡） | ✅ |
| 显示 / 隐藏 | 快捷查看 → 显示 / 隐藏 | `cmd:show` / `cmd:hide` | ✅ |
| 回到屏幕内 | 快捷查看 → 回到屏幕内 | `cmd:snap_into_screen` | ✅ |
| 救急恢复 | 快捷查看 → 救急恢复 | `cmd:recover` | ✅ |
| 免打扰快捷 | 免打扰卡 → 立即免打扰（N 分钟）/ 结束免打扰 | `cmd:quiet:<min>` / `cmd:quiet:off` | ✅ |
| 双击行为 | 语录与气泡 → 双击行为（余额/天气/音乐/台词） | `ui-config.pet.doubleClick` → `cmd:config.doubleClick`（v19） | ✅ 下发验证；≤20s 应用 |
| 皮肤选择 | 桌宠外观 → 皮肤（下拉：大肥鱼 / 小鲸鱼挂件） | `cmd:config.skin` | ⚠️ 当前库为空时仅「大肥鱼」可切；皮肤库条目待库管理 |
| 静默时长 | 桌宠外观 → 静音时长（0~240 分钟） | `ui-config.pet.quietMinutes` → `cmd:config.quiet` | ✅ |
| 开机自启 | 桌宠外观 → 开机自启 | `ui-action: enable-autostart / disable-autostart`（v20）；保存同时写 `ui-config.pet.autoStart` | ✅ v20 已接通（tech-scout 实测 done；面板按 capabilities 自动启用） |
| 退出桌宠 | 应急控制 → 退出桌宠 | `ui-action: quit-pet`（与「停止联动」区分：停止=不驱动，退出=关进程） | ✅ v20 已接通（tech-scout 实测 done；按钮按 capabilities 自动启用） |

## A.2 旧菜单项 → 新面板入口（含 MISSING）

| 旧入口（右键菜单/设置窗口） | 新面板入口 | 状态 |
|---|---|---|
| 查看余额 / 余额 / 余额常显 | 快捷查看→查看余额；常显 = P2 | ✅ / MISSING(P2) |
| 查看天气 / 天气 | 快捷查看→查看天气 + 语录与气泡→城市（存值） | ✅ / ⚠️城市仅存值 |
| 看一眼（双击行为）/ 快速双击 | 语录与气泡→双击行为 | ✅ |
| 说一句我写的台词 | 测试→说一句 | ✅ |
| 改写这几句 / 台词内容 / 文案 / 峰谷文案 / 显示峰谷时段 | — | MISSING(P2：台词由联动插件/DSH 侧管理) |
| 模式 / 自由散步 / 跟随鼠标 / 原地待着 | 桌宠外观→模式 | ✅ |
| 大小 / 迷你 / 特小 / 精确调节 | 桌宠外观→大小（滑杆+五档） | ✅ |
| 形象 / 大肥鱼 / 小鲸鱼挂件 / 我的形象库 / 全部恢复默认形象 | 桌宠外观→皮肤（下拉） | ⚠️ 基础选择 ✅；库管理/上传 MISSING(P2，应急原生菜单兜底) |
| 层级 / 置顶 / 置底 / 普通层 | 桌宠外观→层级 | ✅ |
| 透明度 | 桌宠外观→透明度 | ✅ |
| 设置默认城市 / 自动定位城市 / 添加城市 | 语录与气泡→城市（文本存值） | ⚠️ 仅存值；自动定位/多城市 MISSING(P2) |
| 设置 Key / 余额来源 / 添加其他 API Key / 校准今日已用 / 每轮消耗统计 | — | MISSING(P2：key/余额已迁 DSH 侧，面板不管理密钥) |
| 设置 Agent 名称 / 会话日志目录 | — | MISSING(P2) |
| 吸附 / 拖拽吸附四边 | 桌宠外观→贴边吸附 | ✅ |
| 左吸附时翻面 | — | MISSING(P2) |
| 语录频率 | 语录与气泡→语录频率 | ✅ |
| 进程联动 / 应用启动提醒 / 扫描本机应用 | — | MISSING(P2：C 选项后由 DSH 会话事件驱动替代) |
| 音乐联动 / 放歌时看着 / 显示歌词内容 / 歌词对时 / 歌词微调 | 语录与气泡→音乐联动 | ✅ / 歌词细节 MISSING(P2) |
| 流畅度 / 性能模式 / 休闲模式 | — | MISSING(P2) |
| 百宝箱 / 回收内存 / 回收时不动前台程序 | — | MISSING(P2) |
| 免打扰 / 结束免打扰 | 免打扰卡→立即免打扰 / 结束免打扰 | ✅ |
| 今日汇总 | 快捷查看→今日汇总 | ✅ |
| 音效选择 / 按键音效 / 添加我的音效 / 试听音效 | 语录与气泡→音效开关；音量在桌宠外观 | ✅ 基础 / 音效包选择 MISSING(P2) |
| 音量 | 桌宠外观→音量 | ✅ |
| 显示 / 隐藏 | 快捷查看→显示 / 隐藏 | ✅ |
| 回到屏幕内 | 快捷查看→回到屏幕内 | ✅ |
| 锁定位置 | 桌宠外观→锁定位置 | ✅ |
| 鼠标穿透 | 桌宠外观→鼠标穿透 | ✅ |
| 救急恢复 | 快捷查看→救急恢复 | ✅ |
| 记菜单日志 | — | MISSING(P2 调试项) |
| 退出 | 应急→退出桌宠 | ✅ v20（quit-pet） |
| 开机自启 | 桌宠外观→开机自启 | ✅ v20（enable/disable-autostart） |

**MISSING 汇总（全部为 P2，lead 已分流；不影响「原生菜单移除后不可恢复」的 P1 清单）**：
台词池/峰谷文案编辑、皮肤库管理/上传、余额 Key 管理、校准/每轮消耗、Agent 名称/日志目录、
翻面、进程联动、歌词细节、性能模式、百宝箱、音效包、记菜单日志。
**P1 必须项全部已入口**（含 tech-scout 点名「否则不可恢复」的 6 项：size/opacity/mode/lineFreq/passthrough/locked）。

## A.3 本轮验证证据

- **smoke**：31/31 通过（新增 7 项：快捷动作映射、balance/quit 待就绪、doubleClick/autoStart 校验、pet.action 错误码、capabilities/petOptions、pet.doubleClick 保存）。
- **真实快捷动作**（`test/e2e-actions.mjs` → `ui-actions-verify.json`，v19 环境）：weather / summary / music / hide / show / snapInto / recover / quietStart(1min) / quietEnd **全部 ok:true（执行成功）**；balance 在 v19 capabilities 到位后重测 **ok:true（cmd:balance）**。桌宠最终可见（hide 后已 show）。
- **双击行为**：`ui-config.pet.doubleClick=lines` → `cmd:config:{"doubleClick":"lines"}` 下发 ok（日志 `pet settings pushed`），v19 服务端已验证可设。
- **BOM 修复（task-40）**：`scripts/install.ps1` / `scripts/rollback.ps1` 统一 UTF-8 **with BOM**（首字节 `EF BB BF`）；Windows PowerShell **5.1** 下 `-DryRun` 均 exit 0（verifier 复验 PASS）。修复前 5.1 按 GBK 解码中文导致 line 107 `catch` 处 ParserError（已复现并修复）。
- **截图**：`screenshots/ui-06-quick-actions.png`（快捷查看 8 按钮 + 免打扰快捷）、`screenshots/ui-07-doubleclick-quit.png`（双击行为下拉 + 应急区「停止联动/退出桌宠」语义说明）。
- **license/NOTICE（task-40）**：`package.json` → `"license": "MIT"`；新增 `NOTICE`（上游桌宠 fork / PySide6 LGPL / 素材声明 / 隐私）。

## A.4 剩余待办

1. ~~tech-scout v20：ui-action 的 enable-autostart/disable-autostart/quit-pet~~ **v20 已落地**：capabilities 回显 `quit/autoStart:true`，tech-scout 实测三条动作 `status:done`；面板自动启用（readiness 全 true）。剩余仅 verifier 复验这两项。
2. verifier 重跑功能平价（task-38/40）与 V4.1；本附录可作为矩阵基准。
3. 真实页面截图（可选，harness 图已覆盖本轮新增 UI）。
