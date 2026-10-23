# 功能范围与取舍（task-41 · PLUGIN-UI-SCOPE）

> 依据 Lead 的平价矩阵产品分流：P1 补、P2 只记录、明确砍掉。任何新功能先对照本表。

## P1（必须补，移除原生 UI 后不能回退）
| 功能 | 服务端/桌宠 | UI 状态 |
|---|---|---|
| 查看余额 `cmd:balance` | v19：无 key → `balance-nokey` + "余额已迁到 DSH 面板查看"；有 key 走原生刷新 | 面板按钮接 v19 |
| 天气 `cmd:weather` | ✅ v18 | ✅ 可接 |
| 在放什么音乐 `cmd:music` | ✅ v18 | ✅ 可接 |
| 今日汇总 `cmd:summary` | ✅ v18（读 `daily_receipt.txt` 最近 4 行，10s 气泡） | ✅ 可接 |
| 显示/隐藏 `cmd:show` / `cmd:hide` | ✅ 原有 | ✅ |
| 回到屏幕内 `cmd:recover` | ✅ v18（snap_into_screen + show + raise） | ✅ |
| 救急恢复 `cmd:nativeui:on/off` | ✅ v10 | ✅ 应急按钮 |
| 双击行为 `doubleClick`（balance/weather/music/lines） | ✅ v19：`cmd:config.doubleClick` → `set_double_click` | 面板下拉 |
| 皮肤 `skin` | ✅ `cmd:config.skin`（字符串名；当前库仅"大肥鱼"） | 面板下拉（待皮肤库） |
| 静默时长 `quietMinutes`（0~240） | ✅ `cmd:config.quiet`（0=off） | 面板数字 |
| 免打扰快捷按钮 | ✅ quietHours（v9） | 面板快捷开关 |
| 开机自启开关 | 插件生命周期 `ui-action` 语义待 v20：`enable-autostart` / `disable-autostart`（改 Startup 注册） | 面板开关（先展示状态） |
| 停止联动/退出语义 | 停止联动=`enabled=false`（只停主动说话/动作，保留手动互动）；退出=关闭 DSH 或停止 pet 进程 | 面板按钮 + 文案 |

## P2（文档记录，不实现）
- 形象库/自定义皮肤上传
- 左吸附翻面
- 峰谷文案
- 热键自定义
- 自定义台词编辑

## 明确砍掉（用户已确认不做）
- 进程联动/提醒
- 定时提醒
- Agent/日志目录
- 歌词对时
- 内存回收
- 自定义音效
- 经典菜单
- 流畅度
- 菜单日志
- 余额 key/来源/校准（key 已迁移 DSH 侧，桌宠 config 的 `ds_api_key` 字段已删除）
