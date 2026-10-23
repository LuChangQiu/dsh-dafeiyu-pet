# task-32 映射表：桌宠原生设置项 → 插件/管道接口 → 默认值（给 plugin-ui）

> 版本：v10（桌宠补丁 v7；插件 v10）。原则：**DSH 面板 = 唯一控制台**；桌宠 config.json 仅作缓存；插件启动/UI 变更时通过 `cmd:config:<json>` 批量下发。
> 已通管道：`node pet-work\tools\pet-cmd.mjs "<cmd>"`；批量：`cmd:config:{"size":0.72,...}`。

## A. 可即时下发（cmd:config 白名单，插件启动/UI 变更时应用）

| UI 项 | 原生 config key / setter | cmd | 默认值 | 建议控件 |
|---|---|---|---|---|
| 大小 | `size` / `set_size` | `size`(0.18~1.0 倍率) | 0.72 | 滑块/档位（迷你0.27/特小0.36/小0.54/中0.72/大0.90） |
| 透明度 | `opacity` / `set_opacity` | `opacity`(0.2~1.0) | 1.0 | 滑块 |
| 模式 | `mode` / `set_mode` | `mode`: wander/follow/still | wander | 分段选择 |
| 语录频率 | `line_freq` / `set_line_freq` | `lineFreq`: 安静/正常/话多/话痨 | 正常 | 下拉 |
| 鼠标穿透 | `passthrough` / `set_passthrough` | `passthrough`: bool | false | 开关（**必须保留，否则无法恢复**） |
| 锁定位置 | `locked` / `set_locked` | `locked`: bool | false | 开关（必须保留） |
| 置顶 | `topmost` / `set_topmost` | `topmost`: bool | true | 开关 |
| 贴边吸附 | `snap_on` / `set_snap` | `snap`: bool | true | 开关 |
| 层级 | `layer` / `set_layer` | `layer`: top/bottom/normal | top | 下拉 |
| 气泡风格 | `bubble_style` / `set_bubble_style` | `bubbleStyle`: auto/light/dark | auto | 下拉 |
| 皮肤 | `skin` / `set_skin` | `skin`: 大肥鱼 | 大肥鱼 | 下拉（有皮肤库时） |
| 音效开关 | `sound_on` / `set_sound` | `soundOn`: bool | true | 开关 |
| 音量 | `volume` / `set_volume` | `volume`: 0~1 | 0.9 | 滑块（插件映射，UI 可后加） |
| 音乐联动 | `music_link` / `set_music_link` | `musicLink`: bool | true | 开关 |
| 城市 | `city`（仅存 cfg，天气用到） | `city`: 字符串 | 汕头 | 文本/下拉（需后续 set_city 完整生效，当前存值） |
| 静音时段 | `quiet_minutes` / `start_quiet` | `quiet`: 分钟数 或 off | 30 | 数字 |
| 气泡停留 | 插件侧 `bubble{normalMs…}` | `say3:<秒>\|<style>\|<text>` | 普通5s/内心3s/报账10s/审批8s/深夜6s | 数字输入（由插件控制，桌宠无原生项） |

## B. 只在原生菜单、需要补 UI 的项（不做进面板就暂时只能靠应急原生菜单）

皮肤库/换肤、贴边吸附方向、双击行为（余额/天气/音乐/台词）、进程提醒（per-app 计时）、定时提醒、全局热键、`line_freq` 之外的"语录池"编辑、余额/城市 API key（已迁移到 DSH 侧，桌宠 key 变可选）、调试日志开关、`mode` 三模式以外的"锁定/跟随鼠标偏移"等。
> 处理：v10 已默认隐藏原生 UI；**应急通道** `node pet-work\tools\pet-cmd.mjs "cmd:nativeui:on"` 重新显示托盘+右键菜单（恢复后再 `cmd:nativeui:off`），`cmd:region`/`start-pet.ps1 -Restart`/`pet-rollback.ps1` 始终可用。

## C. ui-config.pet → 下发规则（插件 v10 已实现）

- `ui-config.json` 增 `pet:{size,opacity,mode,lineFreq,bubbleStyle,passthrough,locked,topmost,snap,layer,skin,soundOn,volume,musicLink,city,quietMinutes}`
- 插件 watcher 检测变化 → 构造 `cmd:config:{...}` 下发（白名单映射见 A），并更新 `state.json.petSettings`；日志 `pet settings pushed`。
- 启动时插件读取 `ui-config.pet` 并下发一次（"UI 配置为真源，桌宠 config 当缓存"）。
- 其它 ui-config 字段：`enabled/activity/quietHours/llm.budgetPerDayYuan`（v9 已支持）。

## D. 默认值表（"恢复默认配置"按钮用）

```json
{"size":0.72,"opacity":1.0,"mode":"wander","lineFreq":"正常","passthrough":false,"locked":false,
 "topmost":true,"snap":true,"layer":"top","bubbleStyle":"auto","skin":"大肥鱼","soundOn":true,
 "volume":0.9,"musicLink":true,"city":"汕头","quietMinutes":30,
 "activity":"normal","quietHours":["23:30-08:00"],"budgetPerDayYuan":1.0,
 "bubble":{"normalMs":5000,"innerMs":3000,"reportMs":10000,"approvalMs":8000,"nightMs":6000}}
```

## E. 应急控制（保留）

`start-pet.ps1 -Check|-Restart`、`pet-rollback.ps1 -StartOfficial|-RevertPatch`、`plugin-rollback.ps1`、`cmd:nativeui:on|off`、`cmd:config:*`、DSH 面板按钮（plugin-ui）。
