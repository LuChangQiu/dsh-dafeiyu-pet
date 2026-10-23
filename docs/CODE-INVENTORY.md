# 14 · 代码盘点：我们到底改了什么（对照上游 v1.1.5）

> 2026-10-23 ｜ 基线：上游 `RYANFFY/deepseek-dafeiyu-pet` commit `4a5a519`（仅作参考来源，本仓不保留上游 git 历史）
> 当前：产品仓 `dsh-dafeiyu-pet` main（`pet/桌宠.py` 为唯一真源）
> 目的：回答用户"哪些改动真的需要"，并给 keep / simplify / remove 判断。

## 1. 一句话
**桌宠本体只加了一个"管道桥 + 渲染叠加层"（净 +699/−8 行）；其余全是新增的插件/UI/脚本/文档，没有改上游既有玩法、素材、网络与配置读写路径。**

## 2. 改动总览（diff 统计）
| 文件/目录 | 改动 | 说明 |
|---|---|---|
| `桌宠.py`（上游 9108 行基线 → 现 9769 行） | **+699 / −8** | 单实例管道升级为一行 IPC、动作/气泡/FX 叠加、菜单移除、热区/拖拽、内部函数暴露 |
| `patch/apply_p1.py`（830 行） | 新增 | 仅用于从 upstream 生成 release 补丁（**git 是唯一真源**） |
| 插件 server `plugin/dsh-pet-bridge` | 新增（lib/index.js ≈1100 行） | 事件归因/气泡节奏/LLM 台词/动作序列/活跃度/配置真源/生命周期/state |
| 插件 client `plugin/dsh-pet-bridge-ui` | 新增 11 文件 | Web 管理面板（设置页 + `/pet-bridge-ui` 路由） |
| `tools/` 脚本（6 个） | 新增 | 启停/自举/回滚/活跃度/管道客户端 |
| docs/README/NOTICE | 新增 | 使用/映射/仓库/许可 |
| assets、sprites、音效、ui_console.py、requirements | **未改** | 素材与 UI 控制台零改动 |

## 3. `桌宠.py` 逐处改动（对照上游）

| # | 位置/块 | 改了什么 | 为什么 | 调用方 | 必要性 | 风险 |
|---|---|---|---|---|---|---|
| 1 | `main()` 单实例管道块（原 `on_new_connection`） | 升级为 **一行 IPC 分发** `_bridge_dispatch`：say/inner/say2/say3/inner3/act/cmd/move/peek/walk/freeze/bal/mute/ping/fx/region/weather/music/summary/recover | 上游管道只支持"再点一次=show+固定句"，插件无法控她 | DSH 插件（命名管道） | **核心必要** | 与上游冲突点：`main()` 末尾块（rebase 需关注） |
| 2 | `paintEvent` 动作分支 | 新增 `spin`（360°）、`shake`（摇头）动作姿态 | 动画感 A（旋转/摇头） | `act:spin/shake/fx:spin` | 必要 | 与上游动作渲染冲突点小 |
| 3 | `paintEvent` 尾部 | 新增 `_bridge_paint_fx` 叠加层：眨眼、爱心、腮红、汗滴、Zzz、眩晕、PNG 帧序列 | C 微动画（无新美术） | `cmd:fx:*`、拖拽甩出、点击热区 | 必要（C 核心） | Qt 矢量绘制，性能开销极小；无素材时安全跳过 |
| 4 | `_bubble_ink` | 加 `BRIDGE_BUBBLE_TINTS` 情绪色（report 暖金/remind 琥珀/night 深蓝紫/greet 淡蓝/love 粉/inner 灰） | B 气泡情绪样式 | 插件 `say2/say3` | 必要 | 只覆盖颜色，不改绘制流程 |
| 5 | `_on_single_click` | 加 `_bridge_zone_react`：头=爱心害羞、尾=提醒摇头、身=伸懒腰；alpha 过滤/尾巴优先待 C 补 | 点击热区（移除菜单后唯一的本地互动控制） | 真机点击 / `cmd:region` | 必要 | 与原回嘴逻辑兼容（身体走原逻辑） |
| 6 | `contextMenuEvent` | 原方法改名 `_bridge_native_contextMenuEvent`，默认不弹；`cmd:nativeui:on` 应急恢复 | 用户选 C：DSH 面板唯一控制台 | 右键 / nativeui | 必要（按要求） | 应急通道保留，可一键还原 |
| 7 | 初始化 | 托盘 `tray.hide()` + `_bridge_allow_native_ui` 标志 | 同上 | — | 必要 | 托盘"退出"经 DSH 面板/脚本替代 |
| 8 | `_on_double_click` | 优先读 `daily_receipt.txt` 念"今日小票" | 双击小票 | 双击 | 必要 | 无文件时退回原双击行为 |
| 9 | `mouseMoveEvent`/`mouseReleaseEvent` | 记录拖拽横向速度；快速甩出触发 spin+眩晕 | 抽陀螺（C） | 真机拖拽 | 增强项 | 阈值 120px，不影响普通拖拽 |
| 10 | `cmd:config` 批量 setter | size/opacity/mode/lineFreq/bubbleStyle/passthrough/locked/topmost/snap/layer/skin/soundOn/volume/musicLink/city/quietMinutes | 面板统一控制（移除原生菜单后必须） | 插件配置真源 | **核心必要** | 全部走原生 setter，无自造状态 |
| 11 | 内部函数复用 | weather/music/summary/recover/show/hide 命令映射到上游内部函数（`_get_weather`/`check_music_now`/收据/`snap_into_screen`） | 面板按钮调用 | 面板 | 必要（补功能回退） | 无逻辑复制 |
| 12 | 稳定化 | `say3/inner3` 可控停留；`bal:` 推送余额/今日已用 | 气泡节奏/去 key | 插件 | 必要 | 与上游 `say()` 兼容（queue） |

**未改**：图片/音效素材、`ui_console.py`、天气/音乐/余额网络逻辑、配置迁移/读取路径、打包 spec。

## 4. 插件 server（新增，≈1100 行）
区块：session/event 订阅 → **归因**（只跟当前活跃会话，团队/子代理 skip，bootstrap 前缀容错）→ **气泡队列**（串行/合并/时长可配/优先级）→ **LLM 台词**（人格卡+反转+IP 词表+禁忌，≤40 字，去重 7 天/300，预生成，费用护栏 300/天、1 元/天，失败回池）→ **动作序列**（turnStart 小跳/旋转、turnEnd 伸懒腰、报错摇头+定格+汗滴、tool 转头小跑、长任务走两步≤3、approval 走中央站定+提醒）→ **活跃度三档**（quiet/normal/lively + activity.txt 热切）→ **空闲小剧场**（≥5min 无事件，每 6~9min 内心独白）→ **配置真源**（启动/UI 变更下发 `cmd:config`，桌宠 config 仅缓存）→ **生命周期**（自举/自动拉起/ui-action restart/start/stop）→ **state.json**（状态/费用/最近 say/petSettings/bootstrap/capabilities）→ **日志脱敏/轮转**。

## 5. 管理面板 client（11 文件）
host 路由 `/pet-bridge-ui` + 设置页入口；状态卡（host/pet/pipe/版本/今日 calls/cost）、总开关/活跃度/免打扰/预算、外观（大小/透明度/模式/穿透/锁定）、语录与气泡（频率/气泡时长/城市/音乐/音效）、最近 say、日志、应急（重启/停止/恢复默认/回滚指引）、测试按钮；读写 `state.json`/`ui-config.json`/`ui-action.json`。

## 6. 判断与建议

**Keep（必要，保留）**：#1 协议桥、#3 微动画叠加、#6/#7 菜单移除+应急、#8 小票、#10 配置批量、#11 手袋按钮、插件全部核心（归因/气泡队列/LLM/护栏/配置/生命周期/state）、回滚与自举脚本、面板。

**Simplify（可简化，不影响体验）**
1. `apply_p1.py`（830 行）与 git 双源：**git 为唯一真源**，脚本仅用于从 upstream 生成 release 补丁（README 已写明）；日常改动不要再跑 patch 覆盖。
2. 生产 `node_modules` 只保留最新 `dsh-pet-bridge-v18`（+ UI）；v1~v17 包目录可清理（保留回滚快照 zip/备份即可）。
3. `testHookFile` 仅测试用，生产保持空串（已如此）；建议后续从发布的 UI 文档隐藏。
4. 归因 bootstrap 目前用日志前缀容错；DSH 若有会话列表 API，可替换为直接取"最近真人会话"（更稳）。
5. `pet-build-release.ps1` 的分支/参数已就绪，`dist` 不入库。

**Remove（可删，用户明确不做或已迁移）**
- 进程联动/提醒、定时提醒、Agent/日志目录、歌词对时、内存回收、自定义音效、经典菜单、流畅度菜单、菜单日志、余额 key/来源/校准（key 已迁 DSH 侧）——已在 task-41 文档标记"砍掉/不做"。
- 临时脚本 `_v*_patch.py` / `_v*_deploy.py`（构建/部署辅助，非产品代码，已不入 git）。
- `dist/` 构建产物、`secret-scan-report.txt`、`evidence/`、`backup/`、`logs/` 不入 git（已配 .gitignore）。

## 7. 对用户的话
"你原有的桌宠玩法、素材、设置数据一点没动；我们只给她加了一条能跟 DSH 对话的管道、几个动作/表情渲染叠加，外加一个跑在 DSH 里的插件和网页控制面板。桌宠本体净增约 700 行，全在这 12 处里；不需要的 10 类原生功能我们已经列成'明确砍掉'清单，避免误以为丢了功能。"

