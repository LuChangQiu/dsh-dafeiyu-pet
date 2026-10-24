# LIFECYCLE-PLAN — 桌宠失联休眠（task-77）

> 目标：DSH 长时间没有消息时，桌宠**自己离线打盹**，不擅自退出；收到命令/用户操作 → 醒来问好。
> 实现：`pet/桌宠.py`（`_life_tick` / `_life_enter_offline` / `_life_wake` + `life:` 管道命令）。只改 pet 侧；插件侧行为（`exitWithDsh` 由用户显式开启时才下发）后续按需接入。

## 1. 配置（`config.json`，缺省自动补齐）

```json
"lifecycle": {
  "offlineAfterMs": 120000,
  "exitWithDsh": false,
  "exitAfterMs": 600000
}
```

| 键 | 默认 | 语义 |
|---|---|---|
| `offlineAfterMs` | `120000`（2 分钟） | 距最近一次**任意管道命令**超过该时长 → 进入离线打盹；钳制 5s–1h |
| `exitWithDsh` | `false` | **默认关闭，不擅自退出**；仅显式开启才允许静默退出 |
| `exitAfterMs` | `600000`（10 分钟） | `exitWithDsh=true` 时，静默满该时长才退出；钳制 1min–24h |

- `config.json` 只作缓存；插件若下发 `cmd:config` 白名单外的键不会覆盖这里（lifecycle 目前由 pet 侧配置/测试命令管理）。
- 老配置没有 `lifecycle` 时按默认值运行，行为 = 2 分钟无命令后打盹、永不退出。

## 2. 状态机

```
在线(idle/walk/演出) --静默 > offlineAfterMs--> 离线打盹(_life_offline=true, target=None, sleep 保持末帧)
离线打盹 --收到任意管道命令 / 点击 / 拖拽--> 在线 + wake 起身 + 问候(120s 冷却)
离线打盹 --exitWithDsh=true 且静默 > exitAfterMs--> 退出进程（默认关闭）
```

- 打盹表现：`_whale_force="sleep"`（`holdLast` 保持躺倒末帧，长睡不循环）；清空散步目标、停物理；`tick` 在打盹期间只重绘不移动。
- 冒泡：进入打盹时，仅当**不是深夜 23:30–08:00、无免打扰、非全屏、桥侧未 mute**（`_whale_gag_ok()`）才冒一个「……？（等你好久了）」；醒来问候同样受该门禁 + 120 秒冷却。
- 收到命令判定：`_bridge_dispatch` 入口统一刷新 `_last_line_at`（含 `ping` / `life:` / 被 mute 的命令）。
- 用户操作：点击打盹中桌宠 → 唤醒（`_whale_click_react` 走 `_life_wake`）；拖拽同样唤醒。

## 3. 测试命令（本机命名管道，UTF-8 一行）

```powershell
node pet-work\tools\pet-cmd.mjs 'life:status' --read-reply
node pet-work\tools\pet-cmd.mjs 'life:offline' --read-reply   # 立刻打盹（把 last_line 拨到阈值外）
node pet-work\tools\pet-cmd.mjs 'life:wake' --read-reply      # 立刻醒来（含 greeting 冷却）
node pet-work\tools\pet-cmd.mjs 'life:after:3000' --read-reply# 临时把阈值改成 3s（仅内存，测试用）
node pet-work\tools\pet-cmd.mjs 'life:after:120000'           # 恢复默认
```

`life:status` 回一行 JSON：

```json
life:{"offline":true,"silentMs":121348,"offlineAfterMs":120000,"exitWithDsh":false,
      "exitAfterMs":600000,"clip":"sleep","force":"sleep"}
```

## 4. 验收记录（2026-10-24，本机）

| 步骤 | 结果 |
|---|---|
| `act:sleep` 后 3.6s 截图 | 保持躺倒末帧（holdLast 生效） |
| `act:wake` 后 1.8s 截图 | 起身回 idleBase |
| `act:eat` 3.0s / 5.0s 截图 | 3s 仍保持满足末帧，5s 回 idle（keep 1.8s） |
| `act:sneak` 2.6s 截图 | 保持偷吃末帧（keep 1.5s） |
| `life:offline` → status | `offline:true, clip:"sleep", force:"sleep"` |
| `life:wake` → status | `offline:false, clip:"idleBase"` |
| `life:after:3000` 静默 4s+ | 进入打盹（截图 `evidence/audit-life-offline.png`） |
| `ping` | `pong`（未受 lifecycle 影响） |

## 5. 待办 / 插件侧约定

- [ ] 插件 `state:` 心跳间隔若 < `offlineAfterMs`，桌宠不会打盹（当前生产联调时有 5s 级状态推送，属"有人在线"语义，符合预期；真失联时插件自身停止推送 → 到点打盹）。
- [ ] 插件 UI 开关（失联休眠/退出策略）后续在设置页暴露；pet 侧只读 `lifecycle` 配置，缺省安全。
- [ ] `exitWithDsh=true` 需要用户明确开启才允许；默认绝不启用，避免 Agent/联调误退。
- [ ] 打包：`pet/NOTICE.md` + `assets/whale-girl/ATTRIBUTION.md` 随发行包分发（见 NOTICE）。
