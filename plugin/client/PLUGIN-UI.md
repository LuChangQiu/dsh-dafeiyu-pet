# PLUGIN-UI.md — 大肥鱼 × DSH 联动 · 管理界面（task-26 交付说明）

> 交付人：plugin-ui ｜ 交付日期：2026-10-23 ｜ 状态：**已接线并运行于生产 DSH Web（未重启 host）**，E2E 真实链路已验证；真实页面截图待用户补（清单见 §9）。
> 代码位置：`E:\project\AI提效\tool\pet-integration-src\pet-work\plugin-ui\dsh-pet-bridge-ui\`；repo 副本：`E:\project\AI提效\tool\大肥鱼桌宠-fork\plugin\dsh-pet-bridge-ui\`（branch `custom/dsh-linkage`，待 tech-scout commit）。

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
---

# 附录 B — task-43/44：状态通道（面板侧）+ 代码规范（UI 侧）

## B.1 实时状态区（task-44 面板侧，已实现）

面板顶部新增「实时状态」卡片，数据来源为联动插件 `state.json` 中的状态通道快照（tech-scout 实现 `state:<json>`）：

| 展示项 | 来源字段（容错读取） | 说明 |
|---|---|---|
| 状态徽标 | `status.state` → `runtime.status.state` → `runtime.state` | 中文映射：空闲/思考中/调工具/等确认/等输入/后台运行/出错/完成/失联；色调：ok/busy/warn/err/dim |
| 当前工具 | `status.tool` / `toolName` | 状态为 `tool` 时显示「正在调用工具」 |
| 状态耗时 | `status.since` / `startedAt` | 面板计算 `now - since`，格式 3.2s / 1m 05s / 2h 03m |
| Step / Turn | `status.step` / `status.turn` | 缺省显示 `— / —` |
| 最后心跳 | `heartbeatAt` / `lastHeartbeatAt` / `lastEventAt` / `state.json.updatedAt` | 显示「N 秒前」+ 本地时间 |
| 失联判定 | 心跳龄 > **30s**（`runtimeStaleMs`，可由 patch config 覆盖） | 红色「⚠ 失联（>30s 无心跳）」+ 状态强制为 `disconnected` |
| 补充信息 | `status.message` / `detail` | 可选一行说明 |
| 兼容性 | 无 `status` 字段时 `supported=false` | 显示「状态通道未就绪」徽标（当前 v25 尚未落地服务端状态字段），并按 `updatedAt` 兜底判活；服务端一上线自动显示，无需改 UI |

**实时性**：面板沿用 5s 轮询 `state.get`（含 runtime）；断线（30s 无心跳）在下一次轮询即变「失联」。状态枚举/别名归一（approval→waiting_approval、toolcall→tool、running→background、failed→error、completed→done、offline→lost 等）已在 Host 侧统一处理。

**验证**：`node test/smoke.mjs` 新增 6 项状态测试（8 个状态枚举、6 组别名、29s/31s 心跳边界、无 status 兜底、runtime 两种形状、state.get runtime 字段）→ **37/37 通过**；harness 截图：
- `screenshots/ui-08-realtime-status-tool.png`（调工具 + pwsh + 45s + step 4/turn 2 + 心跳 3s）
- `screenshots/ui-09-realtime-status-disconnected.png`（失联 + >30s 无心跳 + 心跳 1 分钟前）

> 注：截图中的状态数据由 `test/make-fixture.mjs` 注入合成 runtime（真实 `status` 字段待 tech-scout v26+ 落地）；面板组件与归一逻辑为真实代码。


### B.1.1 v26 真实状态通道验证（2026-10-23）

tech-scout v26（产品仓 HEAD `7ee465f`）已开始写 `state.json.status`（字段：`state/tool/since/step/turn/heartbeatAt/source/message`，5s 心跳）。面板侧**零改动即生效**（容错设计）：

- 实时读取 `state.json.status`：实测样例 `{"state":"tool","tool":"pwsh","since":"2026-10-23T06:46:10.775Z","heartbeatAt":"2026-10-23T06:46:10.775Z","source":null,"message":""}` → 面板 runtime：`{state:"tool", label:"调工具", tool:"pwsh", elapsedMs≈8.4s, heartbeatAgeMs≈8s, disconnected:false}`；
- 版本行显示：面板 v0.2.0 · 联动 v0.26.0 · 桌宠 v1.1.5+patch-v26；
- `state.pet=false` 时插件写 `disconnected`，恢复写 `idle`；心跳 5s，面板 >30s 判失联；
- 证据：`screenshots/ui-10-realtime-status-real-v26.png`（真实 v26 数据：调工具/pwsh/8.4s/心跳 8 秒前；非注入）；此前 `ui-08/ui-09` 为状态覆盖（tool/disconnected）与注入样例；
- 面板枚举映射与 tech-scout 最终枚举一致（`waiting_approval/background/done/disconnected` 等，别名保留兼容）。
## B.2 代码规范（task-43 UI 侧，进行中）

已做（不改变行为）：
1. **JSDoc**：`lib/index.js` 补齐 handler / apply / sendPipeLine / collectState / applyConfig / normalizeRuntimeStatus / petAction / readPetConfig / readSkinOptions / buildBubbleConfig 等注释（参数、返回、异常语义）；`lib/client.js` 补齐 `call()` 协议调用、`Card/Stat/Dot/Segmented/Toggle` 组件、`makeSection/Panel`、`fmtTime/fmtDuration/fmtAge` 等 JSDoc。
2. **命名/错误处理统一**：peer 字段命名统一 camelCase 输出；错误统一 `{ok:false, error:{code,message}}`（Host）与 `throw new Error(中文)`（client call）；管道命令统一 `sendPipeLine`（无回执）/`sendPipeCommand`（有回执）两条明确语义路径。
3. **注释/文案中文一致**：新增注释与 UI 文案全部中文；协议、端点、状态枚举均有中文说明。
4. **PS 脚本**：`scripts/*.ps1` UTF-8 with BOM + `#Requires -Version 5.1` + 注释式帮助（PS5.1 实测 `-DryRun` exit 0）。

**lint 已完成（repo 配置 `ea922bc`，2026-10-23）**：
- 根配置：`.prettierrc`（120 列/单引号/无分号/LF）、`eslint.config.js`（flat）、`scripts/lint.mjs`、`scripts/lint.ps1`、`docs/CODE-STYLE.md`；
- 执行结果（报告 `ui-lint-report.md`）：
  - `node scripts/lint.mjs` → **node --check 10/10 OK**
  - `prettier --check "plugin/**/*.js" "scripts/**/*.mjs"` → **All matched files use Prettier code style**
  - `npx eslint "plugin/client/**/*.js" "plugin/server/**/*.js"` → **0 error**
  - `scripts/lint.ps1` → **LINT OK**（含 `ruff check pet` → All checks passed）
- 本轮 `prettier --write` 格式化文件：`plugin/client/lib/client.js`、`plugin/client/test/{smoke,e2e-actions,e2e-verify}.mjs`、`plugin/server/lib/index.js`（仅格式，tech-scout 随下次 commit 带上）；
- 回归：格式化后 `node --check` 全绿、smoke **37/37**、哈希 repo=源码=安装版一致（client `C71F443E91AD` / index `ED9A32C74928`）。

## B.3 旧包清理（待授权）

见 §A.4/上轮：profile `dsh-pet-bridge-v6…v19` 共 14 个孤儿目录；已请 tech-scout 确认「清理 OK（保留 vX）」后执行并留证（保留 v20+/UI、不重启 host）。
### B.3.1 task-46 多会话（已实现，v34 真实数据验证）

面板「实时状态」下方新增「运行中的对话」卡片（tech-scout task-46 协议）：

- 读 `state.json` / `bridge-state-v2.json` 的 `sessions[]`（`sessionId/workspace/title/state/tool/step/role/lastUserMessageAt/lastSeenAt`）+ `currentSessionId`、`activeSessionCount`、`userActiveCount`、`backgroundCount`；
- **按工作区分组**（同一工作区多对话并列）；当前会话高亮蓝框 + 「跟随中」徽标；团队/子代理（`role=teammate/subagent` 或 `state=background`）灰标「后台」；
- 顶部计数：**「另有 N 个对话在跑」只算真人会话**（`userActiveCount - 当前会话`），后台单列 **「· 后台 N」**（`backgroundCount`），子代理不计入「对话」；
- 行内展示：标题（`im#短id` / `工作区名 · #短id` 原样展示）、状态、工具、step、**用户消息 x 前（`lastUserMessageAt` 空 → “—”）、最后活动 x 前、sessionId 短版**；
- 兼容：无 `sessions[]` / `userActiveCount` / `backgroundCount` 时从 sessions 推导，仍无则退回单会话模式（`supported=false`，显示「单会话兼容模式」）；
- 排序：当前会话所在组最前，组内当前会话优先，其余按最近活动倒序；
- 证据（真实 v34 数据）：`screenshots/ui-12-sessions-real-v34.png`（当前工作区分组 跟随中 + im 工作区 6 个后台会话，「另有 1 个对话在跑 · 后台 5」）；`screenshots/ui-11-sessions-multi-workspace.png`（合成数据：2 工作区 + 后台徽标 + 用户消息空值“—”）。
- smoke：新增 8 项多会话用例（无 sessions 兜底、多工作区分组、同工作区多对话、角色后台标记、**userActiveCount/backgroundCount 计数、分项缺省推导、lastUserMessageAt 空值、current 字段兼容**）。

### B.4 状态文件 v2（v33/v34，bridge-state-v2.json）

- 读取顺序：**`bridge-state-v2.json` 优先 → `state.json` 兜底**（旧 state.json 有 v26~v31 泄漏定时器持续覆盖，仅兼容兜底）；
- 路径来自插件 config `stateV2File`（默认 `<pet-work>\bridge-state-v2.json`，可由 profile patch 覆盖，非硬编码）；
- `state.get.files` 增加 `stateV2File` 与 `stateSource`（`v2` / `legacy` / `null`），面板与验证脚本可判定当前真源；
- smoke 新增 2 项：v2 存在（版本/status/sessions 均来自 v2，`stateSource=v2`）与 v2 缺失（回退 legacy，`stateSource=legacy`）→ 合计 **47/47**；
- 真实环境（v34）实测：`files.stateSource=v2`、`versions.bridgePlugin=0.34.0`、`runtime=idle/heartbeat 29ms`、`sessionList={userActiveCount:2, backgroundCount:5, othersCount:1, groups:2, total:7}`。
---

# 附录 C — task-51 大肥鱼主页 M1（19 §8 Phase-1）

## C.1 承载与入口
- **独立 HTML 页**：host 侧 `GET /pet-bridge-ui/home` 返回**自包含 HTML**（`lib/home.js` 生成，内联 CSS/JS、无外部 CDN/构建），同前缀/同源、沿用现有 `requestRejection` 鉴权（无 cookie 401 / 跨站 403），**不新起端口**；数据仍走既有 `POST /pet-bridge-ui/state.get` 等，无新增对外数据面。
- **入口三处（ux v3）**：① 设置页「大肥鱼联动」顶部「打开大肥鱼主页」按钮（新标签）；② `sidebar.footer.action`「🐋 大肥鱼」（加性安全槽，已注册）；③ `shell.overlay` 徽标/红点（M2/M3，task-58）。
- 兜底：旧版 DSH 若无 `sidebar.footer.action` 槽 → 静默降级，设置页入口仍在。

## C.2 Phase-1 卡（真实 v0.44.0 数据）
| 卡 | 内容 | 数据来源 |
|---|---|---|
| 顶栏 | 状态词/跟随会话/「另有 N 个对话在跑 · 后台 N」/今日大肥鱼花费/预算条/安静点/叫她过来 | `runtime/stateClass/sessionList/todayStats` |
| 实时状态 | 状态词 + 工具名 + **工具细分图标**（命令/读文件/搜索/联网/子任务/等确认…）+ 耗时 + step/turn + 心跳 + stateClass 配色 | `state.json/v2 status` |
| 今日数据 | **双账分开**：大肥鱼花销（`petLlmCostYuan`/预算环） vs 你的 token 估算（`costYuan` 标"估算"）；**今天 N 碗白饭**（`riceBowls`）、峰谷（`period`）、token、轮次/工具 | `v2.today` |
| 她今天怎么样 | 仅状态词（心情/精力/好感，**不显示数字**）+ 关系/连续陪伴 | `v2.companion.words`（文件兜底） |
| 最近发生 | 最近 5 条 say（Phase-1 事件来源） | `state.recentSay` |
| 时间线（简版） | 最近 50 条 events + 全部/重要(S0/S1)/互动/错误筛选 + 未读角标 + 「未读确认」 | `events.json` + `v2.eventsUnread`；ack 走 `ui-action: events-ack` |
| 运行中的对话 | workspace 分组、跟随中高亮、后台徽标、用户消息—/最后活动、sessionId | `v2.sessions/currentSessionId/userActiveCount/backgroundCount` |
| 互动 | 摸头/喂一口/叫她过来（`capabilities.interactions` 控制启用，走 `ui-action: interact-*`）+ 今日小票/结束免打扰 | `interaction`/`pet.action` |
| 异常/空态 | 她不在 / 失联>30s / 管道离线 / 联动停用 / 无会话 / 无事件 / 数据失败；不装死 | — |
| 刷新 | 5s 轮询 `state.get`；`document.hidden` 暂停；无弹窗 | — |
| 响应式 | ≥720px 双列，<720px 单列（实测 1280 / 420 宽） | — |

**证据**（真实 state.get + 同一份生产 HTML，本地同源 harness 渲染）：
- `screenshots/ui-13-home-m1-desktop.png`（1280 双列：调工具/pwsh·命令/白饭 80.05 碗/¥0.0011 花销 vs ¥16.01 估算/时间线 S1 未读/分组会话/互动）
- `screenshots/ui-14-home-m1-mobile.png`（420 单列响应式）

## C.3 新增 host 数据面（state.get）
- `todayStats`：`{date,turns,toolCalls,longestTurnMs,calls,costYuan,budgetYuan,tokens,riceBowls,period,petLlmCostYuan,estimateCostYuan,ratio,source}`
- `events`：`{supported,file,total,unread,items[{at,kind,level,payload,said,unread}]}`（只读 `events.json`，最多 50 条）
- `companion`：`{supported,words{mood,energy,affinity},level,streakDays,totals,lastSeenAt,updatedAt}`（v2 优先，文件兜底）
- `capabilities.interactions`：`{head,feed,come}`；`guards`：`{maxActionsPerHour,noActionOnSameState}`；`runtime.toolType/phase/stateClass`
- 新 endpoint：`interaction {name:'head'|'feed'|'come'}` → 排队 `ui-action: interact-*`；`events.ack` → 排队 `ui-action: events-ack`
- `files` 新增 `eventsFile/companionFile`

## C.4 设置面板同步增强
- 「打开大肥鱼主页」按钮（顶部）；
- 活跃度护栏：每小时动作上限（1~600）+ 状态不变不重复演出（写 `ui-config.guards`，热更新日志 `ui-config applied ... guards`）；
- 实时状态卡新增「她今天怎么样」状态词行；预算卡新增双账/白饭/峰谷/token 文案。

## C.5 验证
- `node test/smoke.mjs` → **55/55**（新增：readEvents 排序/未读/空态、readCompanion v2/文件、guards 校验、state.get Phase-1 字段、interaction 能力门控+排队、events.ack、主页 HTML 自包含断言）；
- repo lint 全绿（`node --check 11/11` + Prettier 全过 + ruff All checks passed）；
- 生产插件：heartbeat `version 0.3.0`、`POST /pet-bridge-ui/ping`=401、`GET /pet-bridge-ui/home`=401（鉴权生效）；host pid 39484 未重启。

## C.6 限制/后续
- 真实 DSH 页面截图需用户浏览器 cookie（harness 图 = 同一 HTML + 真实数据）；
- 团队/目标/计划/子代理/jobs/schedules 卡 = M2（task-58，等 task-57 字段或 host 侧读 `ctx.sessionProjections`）；
- `shell.overlay` 团队徽标 demo = M2/M3；`sidebar.footer.action` 已上线（刷新页面可见）。
---

# 附录 D — task-58 M2：团队 / 目标 / 计划 / 等你选 + 团队徽标

## D.1 数据层（v2 优先 → host 只读 fallback → 三级降级）
- **v2 字段（tech-scout task-57，Phase-1.5）**：`team:{enabled,status,members:{total,active,failed},tasks:{total,pending,in_progress,completed,blocked,progress,ready},updatedAt}`、`goal:{active,operation,status,roundsStarted}`、`plan:{active,pending}`、`userQuestions:{active,sentCount}`、`degraded[]`；**无 subject/description/objective/cwd**。
- **host 只读 fallback**：`createHostBridge()` 经 `ctx.inject(['sessionController','sessionProjections'])` 取服务；`sessionProjections.snapshot(session,['agentTeam','goal','plan','userQuestions'])`；**10s 缓存、只读、不写盘**；超时 3s；失败只降级不抛错。
- **实测结论**：host 侧 `sessionController.list()` 在本宿主态挂起（>3s），`controller.listState` 提供 `projectionsFor/summaryFor` 等方法但同步取快照未成功；因此当前生产 fallback 状态为 `empty/no-session`（面板显示「当前对话暂无团队/任务」，属正确降级）。**等 task-57 v2 字段落地后以 v2 为准**（已向 tech-scout 要接口）。
- 诊断证据（非用户可见）：`evidence/ui-team-preview.json`、`ui-team-debug.json`（只含计数/属性名，无隐私）。
- `state.get` 新增 `teamFeatures`：`{source:'v2'|'host'|null,status:'ok'|'empty'|'degraded'|'unsupported',reason,enabled,team,goal,plan,userQuestions}`。

## D.2 主页卡片（19 §8 / ux v4 计数版）
- **团队卡**：成员总数/在跑/异常 chips；任务进度条（completed/total 百分比）；任务计数（进行中/待办/可开工/阻塞）；全部完成时显示「🎉 任务全部完成」；数据源标记「数据源 v2 / 投影（只读）」。
- **目标·计划·等你选卡**：目标 phase + 轮次；计划模式 + 待选项数；等你选问题数（>0 时琥珀色提醒）。
- **降级空态**：`unsupported` → 「团队能力未启用（DSH 未装载 Agent Teams）」；`degraded` → 「团队数据异常，已降级展示」+最后有效计数；`empty` → 「当前对话暂无团队/任务」；不报错、不弹窗。
- 证据：`screenshots/ui-16-home-m2-team-goal-plan.png`（v2 合成数据：3 人/6 任务 50% 进度/目标 running 第 2 轮/计划待选 3/等你选 1）。

## D.3 `shell.overlay` 团队徽标（加性安全槽）
- client 插件注册 `shell.overlay`（id `pet-bridge-ui-badge`，order 200）：右下角小胶囊「🐋 任务 3/6」或「🐋 团队 3」；`userQuestions.active>0` 时显示红点 + 「等你选 N」；点击打开大肥鱼主页；15s 轮询 `state.get`、`document.hidden` 暂停、`pointerEvents:'auto'`；无团队数据时不渲染（零负担）。
- 降级：旧版 DSH 无该槽 → try/catch 静默；团队 unsupported/degraded → 不显示徽标。

## D.4 验证
- `node test/smoke.mjs` → **59/59**（新增 4 项：v2 优先、host 四级降级、无数据不抛错、state.get 含 teamFeatures）；
- repo lint 全绿（node --check 12/12 + Prettier 全过）；
- 生产热组合：heartbeat 0.3.0、host pid 39484 未重启；`evidence/ui-team-preview.json` 实时反映降级状态。
### D.5 数据源标注修正（verifier V22 反馈，已修）
- 团队卡右上角数据源标记按**真实来源**显示：
  - `tf.source === 'v2'` → 「数据源 v2」（仅当 v2 真有 `team` 字段时）；
  - `tf.source === 'host'` → 「数据源 fallback（只读投影）」；
  - 其余（v2 无字段且 host fallback 为空）→ 「数据源 empty（未接入）」。
- evidence 截图说明：
  - `ui-16-home-m2-team-goal-plan.png` = **合成 v2 形状数据注入**（harness `HARNESS_TEAM`，用于验渲染/布局；非生产真实 v2）；
  - `ui-17-home-m2-degraded.png` = 降级态真实渲染（无 host bridge 时 unsupported；生产为 host empty/no-session）；
  - 生产真实状态以 `evidence/ui-team-preview.json` 为准（当前 `source=host, status=empty, reason=no-session`，等 task-57 v2 字段）。
- `shell.overlay` 徽标渲染已加 try/catch（失败静默不渲染，DSH 版本差异不炸页面）；真实页面可见性需用户刷新后截图。

### D.6 shell.overlay 徽标 demo（视觉验收）
- 静态 demo：`test/overlay-demo.html`（截图 `screenshots/ui-18-overlay-demo.png`）：右下角两个状态胶囊「🐋 任务 3/6」与「🐋 等你选 1 ●」；侧栏底部「🐋 大肥鱼」入口示意。
- 真实组件：`lib/client.js` → `shell.overlay`（id `pet-bridge-ui-badge`），15s 轮询 state.get、hidden 暂停、`pointerEvents:auto`、无团队/等待数据不渲染、点击打开主页。
---

# 附录 E — task-66/67 设置页：兼容性与能力 + DSH 能力地图（静态版）

## E.1 兼容性与能力卡（设置页，已上线）
- 版本：面板/联动/桌宠；状态通道（已联通/未就绪/失联）；状态文件（v2 真源 / legacy 兜底 + 路径）；多会话（会话数/真人/后台）；事件时间线（条数/未读）；她的心情（状态词）；团队/计划（数据源 + 计数，降级文案）；互动（摸头/喂食/叫她，capabilities 门控）；活跃度护栏（每小时上限 + 同状态不重复）。
- 原则：未知/缺失统一「未启用/未安装」，不谎报连接状态（22 §2.3）。

## E.2 DSH 能力地图（简版，静态矩阵，22 §2.2）
- 顶部「已联动（实时）」：状态通道 / 多会话 / 事件时间线 / 情绪 / 互动 / v2 状态文件 / 主页 / overlay 徽标 / 团队·计划（当 teamFeatures 非 unsupported）。
- 静态分组：
  - ✅ 默认可用（base + web-app）：会话/事件/投影/标题/token/统计/工作区/命令/slots/HTTP 路由；Goals/Plan/Todo/Skills/Subagents/Jobs/Compaction/Session query；Schedule；Workflow（工具+运行视图）；MCP 框架。
  - 🧩 需 profile bundle（本机已启用）：Agent Teams + 任务板、Ralph、Terminal 增强、Session search、Session titles、Git worktree、翻译/auto-review/inspector/plugin market、子代理 CLI。
  - ⚠️ 需 profile bundle（本机未启用）：Voice 输入、Badge skill；同事缺 bundle 时统一空态不报错。
  - 🔌 第三方扩展（本机已装）：MCP 服务器 5 个、memory_manager（仅计数）、IM 渠道。
  - 🚫 不可用/不显示：intel-status（未激活）、Web 内置桌宠（不做）、语音/ASR/TTS、hooks、OTel/analytics。
- 探测规则（22 §2.3）：服务 ctx.get/inject 探测、投影 key 缺失=未装载、工具名探测 MCP/terminal/worktree；等 v2/v46 数据接入后本卡按 v2/fallback/empty 规则变活。
- 证据：`screenshots/ui-19-settings-capability-map.png`（真实 state 快照 + 面板同款渲染）。

## E.3 待接（task-67，等 bridge-dev mode 字段）
- 顶部快捷控制组：静一静 30 分钟 / 专注 2 小时 / 下班到明早 / 恢复（倒计时）；
- 设置页「专注与静默」分组：模式/时长/快捷键/自动恢复；
- 快捷键配置与冲突提示（DSH 快捷键管理；不注册全局快捷键）；
- 需要 bridge-dev 提供：`mode{active,kind:'silent'|'focus'|'off',remainMs,resumeAt}` + 命令（设置/恢复/延长）、`capabilities.mode`。
### E.4 专注与静默（task-67 骨架，已上线）
- 设置页新增「专注与静默」卡（**字段未到前只读/禁用 + 「待服务端」标注**）：静一静 30 分钟 / 专注 2 小时 / 下班到明早 / 恢复；默认时长（30/120/08:00）与自动恢复 Toggle、快捷键输入（冲突校验占位逻辑说明）；标题右侧标「待服务端（task-65 mode 字段）」。
- 主页顶栏新增「静一静 / 专注 / 下班」快捷组（当前禁用 + 说明「待服务端接入」）。
- 接线字段（bridge-dev task-65）：`mode{active,kind:'silent'|'focus'|'off',remainMs,resumeAt}` + `capabilities.mode` + 命令（设置/恢复/延长）；到位后按钮启用、显示倒计时、自动恢复生效。
- 证据：`screenshots/ui-21-settings-focus-silent-skeleton.png`。

### E.5 数据源降级映射修正（verifier V22 复测）
- 两分法：**探测到宿主服务但无数据 → `数据源 fallback（只读投影）` + 「当前对话暂无团队/任务」**；**探不到服务 → `数据源 未接入（服务缺失）` + 「团队能力未启用（DSH 未装载 Agent Teams）」**；v2 有字段才标 `数据源 v2`。
- harness 新增 `HARNESS_HOST_STATUS=empty|ok|degraded|unsupported` 模拟生产 host fallback，复现/截图：`screenshots/ui-20-home-modebar-fallback.png`（显示 fallback + 暂无团队/任务，符合期望）。
- M3 同步项：时间线新增「等你选」筛选；overlay 红点叠加 `events.s0Unread`；侧栏 `sidebar.footer.action` 增加状态点（20s 轮询、hidden 暂停、失败静默）+「等你选」角标。
### E.6 费用显示折中（lead 决策，已实现）
- 主页「今日数据」卡**默认突出白饭 / token / 峰谷 / 轮次·工具**；费用行默认折叠为一行「费用估算 · 你的 ¥x + 团队 ¥y + 她 ¥z」+ 展开箭头。
- 展开后显示**三本账**（v46 字段）：`costUserYuan`（你的 token 估算）/ `costAgentYuan`（团队的 token 估算）/ `petLlmCostYuan`（她说话，预算环 ¥1/天）+ 说明「估算偏高：cache 未单独计价（按 input 价计）；等 cache 分价上线后数字会下降」。
- 展开状态跨 5s 轮询保持（`feeOpenState`）；设置页「每日费用上限」卡新增 **「主页默认显示费用估算」开关**（默认关闭，存本机 localStorage `pet-bridge-ui.showCost`，主页立即生效）。
- 预算环口径修正：`todayStats.ratio` 改为 `petLlmCostYuan / budgetYuan`（只算她说话），不再用总 token 估算除以预算（此前会显示 100% 误报）。
- 证据：`screenshots/ui-22-home-cost-collapsed.png`（默认折叠，白饭 754 碗突出）、`ui-23-home-cost-expanded.png`（三本账 + 偏高说明 + 跨轮询保持展开）。
### E.7 工作区隐私字段（lead 隐私修正，已兼容 v47+/v48）
- `sessions[]` 分组字段兼容：优先 `workspaceName`（basename）+ `workspaceHash`；旧 `workspace`/`cwd`/`workdir` **只取 basename 兜底**；`normalizeSessions` 输出**绝不包含绝对路径**（`group.workspace` 仅为显示名，另带 `workspaceName/workspaceHash`）。
- 同名不同工作区：分组键 = `workspaceName + hash`，显示为 `name·#hash前4位`（v48 起 hash 由 bridge 提供；旧字段无 hash 时按名分组）。
- 当前真实 v46 数据：分组 `im（5）`、`XQWL-000185-北京数智模型（1）`，无路径泄漏。
- smoke 新增 2 项：同名不同工作区 `·#hash` 后缀 + 旧绝对路径→basename；合计 **61/61**。
### E.8 task-67 控制模式接线（v47 契约，已完成）
- **数据**：`state.get` 新增 `mode{available,active,kind,label,remainMs,resumeAt,since,capabilities{silent,focus,off,resume}}` + `modeSettings{silentMinutes,focusMinutes,offUntil,autoResume,hotkey}`（ui-config.mode，默认 30/50/null/true/''）；`capabilities.mode` 门控。
- **面板「专注与静默」**：当前模式 + 倒计时（读 v2 mode.remainMs/resumeAt）；四按钮按能力启用：静一静 `mode-silent{minutes}` / 专注 `mode-focus{minutes}` / 下班 `mode-off{until?}` / 恢复 `mode-resume`（disabled 时标注原因）；默认时长/自动恢复 Toggle 可编辑并随「保存设置」写 ui-config.mode；快捷键输入做格式+冲突校验（占位，不绑定）；语义说明（silent 除 S0 全静默、focus 减动作+仅 S0/审批、off 停联动、优先级 mode>quiet>activity、到期 autoResume）。
- **主页顶栏快捷组**：`静一静/专注/下班到明早/恢复` 按能力启用，点击排队 ui-action；`modeHint` 显示「当前：静一静 · 剩余 25m · 至 HH:MM」；mode 字段缺失时整体降级禁用（显示「待服务端接入」）。
- **后端**：`mode.request{name:'silent'|'focus'|'off'|'resume', minutes?, until?}` → 校验 capabilities.mode → 排队 ui-action（mode-*，带 minutes/until）；config.set 支持 mode 白名单校验（silent 1~240/focus 1~480/offUntil ISO/null/autoResume boolean/hotkey ≤40）。
- 证据：`screenshots/ui-24-home-mode-active.png`（主页快捷组启用 + 当前静一静剩余 25m）、`ui-25-settings-mode-active.png`（面板当前静一静 + 倒计时 + 四按钮启用 + 时长/自动恢复/快捷键）。
- smoke：新增 3 项（mode 归一/默认值、mode.request 门控+排队、config.set mode 校验）→ **65/65**。
- 待 bridge v47 落 `bridge-state-v2.json.mode` + `capabilities.mode` 后生产即时生效（当前 v46 mode=null → 面板显示禁用骨架）。
### E.9 v48 数据层真值 + DROP 项落地（2026-10-24）
- **团队/目标/计划真实数据**：v2 `team/goal/plan/userQuestions/teamUpdatedAt/degraded` 已接；真实 v48 渲染：团队卡「数据源 v2 · 成员 7 人 · 在跑 7 · 任务 38/69 完成（55%）· 进行中 4 · 待办 27 · 阻塞 1 · 可开工 26」、目标「active · 第 0 轮」（截图 `ui-26-home-team-real-v48.png` / 面板 `ui-27-settings-compat-v48.png`）。
- **v2 null + degraded 语义**：`team=null + degraded:['session:none']` → `source=v2,status=empty,reason=session:none`（显示「当前对话暂无团队/任务」，**不显示 0 任务/0%**）；`team:unsupported/not-registered` → unsupported（未启用）；`team:invalid/degraded` → degraded（异常降级）。
- **v47/v48 费用**：`today.costYuan` 已含 cache 分价；主页费用说明改为「已含 cache 分价（cache 读 xk · cache 费用 ¥y · 较旧算法节省 ¥z）」；面板三本账下方提示同步（真实数据节省 ¥482.94）；`costYuanFlat` 保留作旧公式对照。
- **宿主内存卡**：兼容性卡新增「宿主内存 rssMB/heapMB/timers + 低占用中（阈值）」+ 「下班降载 / 恢复联动」一键入口（走 mode-off/mode-resume）。
- **用户 DROP 项**：全局快捷键（UI 输入/校验移除，ui-config.mode 仅 silentMinutes/focusMinutes/autoResume；`hotkey` 字段保留兼容但不发送）、音效/音量（开关移除；保存显式写 `pet.soundOn=false`；面板显示「音效已移除（用户决定）」）；能力地图「不可用/不显示」补註「全局快捷键、音效/音量（用户决定，已移除）」。
- **工作区隐私**：面板不再展示任何绝对路径（状态文件只显示 basename；底部 log/ui-config 只显示文件名）；sessions 分组只用 workspaceName(+hash)；真实 DOM 检查 `pathsInPanel=[]`。
- **petSettings.mode='still'**：v47 起不再作状态真源 → 面板移除「原地」选项（只保留 散步/跟随），避免再写入。
- smoke **65/65**、repo lint 全绿（node --check 28/28 + Prettier）、心跳 0.3.0（host pid 43048）。

### E.10 审查包（门禁 v1）
- 变更文件（client 仅此 6 个）：`plugin/client/lib/{index,client,home}.js`、`test/{smoke,serve-home-harness}.mjs`、`PLUGIN-UI.md`。
- 检查：`node --check` 全过、`npm run lint` 全绿、smoke 65/65、client prettier 全过。
- 隐私：面板/主页 DOM 0 绝对路径；团队/目标只渲染计数与状态（无 subject/description/objective）；费用只渲染数字。
- 回滚：UI-only 变更，`git revert <client commit>` 即恢复旧面板；patch 仅追加 `# ui-sync <ts>` 注释，语义不变（备份见 `evidence/cordis.patch.backup-<ts>.yml`）。
---

# 附录 F — task-62 静态骨架：占位契约 / 待服务端字段 / 标记规则 / 挂载窗口回归

> 状态：静态骨架已部署（commit `24c4381`，安装版 blob = HEAD blob；DSH 未挂载）。本附录为契约与回归清单，随文档批提交。

## F.1 外观与渲染：2D / 3D 占位契约（`render.mode`）
- **字段归属**：`render.mode` 由 **bridge-dev** 落 v2（插件字段 + ui-config）；3d-dev 只负责 spike 与「3D 可用性/性能结论」，不直接写面板字段。
- **期望形状（待定稿）**：`bridge-state-v2.json.render = {mode:'2d'|'3d', available:boolean, reason:string|null, updatedAt}`。
- **当前行为（未接入）**：设置页「外观与渲染」中 `[2D（默认）] [3D（实验）]` 均为 **disabled**，标题右「待服务端（render.mode）」；说明文案「3D 原型验证中…切换失败自动回 2D…当前固定 2D」。
- **变活规则**：`render.mode` 可用时启用切换；切换到 3D 失败/不可用 → 自动回 2D 并显示 `reason`（不抛错、不白屏）；2D 始终可用。
- **失败降级**：字段缺失 → `placeholder/pending`（禁用占位）；`available=false` → 3D 不可选并显示原因；`mode='3d'` 但渲染失败 → 面板回 2D + 提示「3D 已回退」。
- **隐私**：仅枚举 mode/available/reason，无模型/纹理/路径数据。

## F.2 Phase-2 能力「待服务端」字段清单与来源矩阵
| 能力 | 期望 v2 字段（bridge-dev） | 面板当前显示 | 变活规则 |
|---|---|---|---|
| 模型 / 渠道 | （现有）`provider`、`model`、`llmEnabled` | 面板配置值 + detail「面板配置（非会话实时；会话模型待 v2）」 | 若 v2 提供会话实时 model/selection → 改标 live 并显示来源 |
| 技能 | `skills:{total,recent:[{name,count}]}`（不含描述） | 待服务端 | total=0 → 「暂无技能」；>0 → 计数 + 最近使用名称 |
| MCP 服务器 | `mcp:{servers:[name],inferred:true,updatedAt}` | 待服务端（**推断 inferred**） | 显示 servers 列表并标 inferred；连接状态未知绝不谎报 |
| Jobs / 定时 | `jobs:{registered,settled,running}`、`schedules:{total,nextAt,lastDeliveredAt}` | 待服务端 | 标量计数；无数据 → 暂无 |
| 上下文压力 | `context:{pressure,breakdown:{system,tools,messages}}` | 待服务端 | 0–1/占比条；低频读、无内容 |
| 编排 | `orchestration:{workflow:{active,phase,members},ralph:{active,round,lastStatus},subagents:{active,total,failed}}` | 待服务端 | 只显示阶段/轮次/计数；不读 log/任务描述 |
| 3D 渲染 | `render:{mode,available,reason}` | 待服务端（见 F.1） | 见 F.1 |

> 所有字段「有字段但为空」→「暂无…」且**不显示 0/0%**；异常 → 「已降级」；缺失 → 「待服务端」。仅计数/枚举/状态，无 subject/description/objective/schedule prompt/job label/内容/路径/原文。

## F.3 能力地图标记规则（全局）
| 标记 | 含义 | 例子 |
|---|---|---|
| `live` | v2 实时字段有真实数据 | 状态通道、多会话、事件、情绪、团队/计划、控制模式、宿主内存、费用 cache 分项 |
| `fallback` | host 只读投影（v2 缺字段时兜底） | 团队/计划（host 投影），数据源标注「fallback（只读投影）」 |
| `inferred` | 工具名/事件推断，非官方状态 API | MCP 服务器（`mcp__<server>__*`） |
| `placeholder` | 预留占位，字段未到 | Phase-2 能力六项、3D 形象 |
| `待服务端` | pending，禁用/灰色，不显示假数据 | 同上 + 外观与渲染 |

## F.4 主页 3D 形象占位说明
- 位置：主页「她今天怎么样」卡下，一行 `3D 形象：关闭（实验计划中，等 render.mode）`。
- 变活：`render.mode` 接入后显示「3D 模式：关闭 / 实验」；启用/回退以 bridge 字段为准，失败展示原因并保持 2D。
- 约束：占位不画 3D 资源、不引入额外请求；随 5s `state.get` 刷新。

## F.5 挂载窗口 live 回归清单（下次挂载时按此快速过一遍）
1. **安装版 hash** = HEAD blob（client/home）；`node --check`。
2. **home DOM 0 路径**：页面文本正则 `[A-Za-z]:\\` 无命中。
3. **3D 占位**：`renderStatus` = 「3D 形象：关闭（实验计划中，等 render.mode）」（字段未到）/ 正确显示状态（字段已到）。
4. **Phase-2 骨架**：六项显示「待服务端」；模型行 detail = 面板配置（未谎报 live）；MCP 标 inferred。
5. **外观与渲染**：2D/3D 禁用 + 待服务端说明（字段未到）；字段到则按 F.1 验切换/回退。
6. **team 真实数**：主页团队卡与 v2 `team.*` 一致（members/tasks/progress/blocked/ready）。
7. **version + writerId**：v2 `version`/`writerId` 与面板显示一致。
8. **privacy**：`audit-privacy --dir pet-work` findings=0；DOM 0 路径；无 subject/description/objective。
9. **无 TEST HOOK**：patch `testHookFile`=0；v2 无 test/usage 字段；DOM 无 TEST HOOK 文案。
10. **未挂载状态**：若窗口未开，`/pet-bridge-ui/home`=404、无 heartbeat（记录状态不变即可）。
11. 截图归档：home（团队/3D 占位/能力地图）、settings（外观与渲染/Phase-2/兼容性）。
12. 回滚：恢复 `evidence/ui-installed-backup-<ts>/` 或 `git revert <ui-commit>`；记录 REVIEW-LOG。

## F.6 本节验收（文档批）
- 文档仅新增本附录与独立清单文件，无代码/无 patch/无 pet 改动；repo 提交后 preflight 仍 11/11。
- 与 22 §2.2、19 v4 §8 IA 一致；所有「待服务端」项在字段到位前不启用、不造数。
