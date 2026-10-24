# BEHAVIOR-LAYER — P0-2 行为层（反应延迟 / 打断恢复 / 走神）

> 实现：`pet/behavior_layer.py`（纯逻辑，无 Qt 依赖）+ `pet/桌宠.py` 接线（`_bhv_*` / `_bhv_tick`）。
> 单测：`scripts/test-behavior-layer.py`（假时钟，不依赖 Qt/DSH），preflight 已接入 `unit: behavior`。
> 本轮为最小可验收切片（2026-10 分支 `feat/behavior-reaction`）；S0 真机链路留挂载窗口复核。

## 1. 配置（`config.json` -> `behavior`）

```jsonc
{
  "behavior": {
    "reactionDelayMs": 220,        // 普通状态动作目标延迟（150–300ms 内抖动；缺省 220）
    "s0ReactionDelayMs": 115,      // S0 approval/waiting_approval/waiting_input（80–150ms 内抖动）
    "interruptRecoverMs": 200,     // 点击/拖拽/状态切换后回姿势锚点的时限（缺省 200）
    "idleSkit": {
      "enabled": true,             // 走神总开关（false = 完全关闭）
      "idleSec": 60,               // 连续 idle 达到多久才可能走神
      "chance": 0.2,               // 每次评估命中概率
      "cooldownSec": 300,          // 触发后冷却（≥300s）
      "rollWindowSec": 60,         // 评估窗口（防每帧连抽；默认 60s 评估一次）
      "holdMs": 2600               // 走神表演保持时长（think 帧，之后回 idleBase）
    }
  }
}
```

- 缺省/老配置自动补默认（`behavior_layer.DEFAULT_CONFIG`）；非法值会被夹取（如 reactionDelayMs 999 → 300）。
- 生产默认：`reactionDelayMs=220`、`s0ReactionDelayMs=115`、`interruptRecoverMs=200`、`idleSkit{enabled,idleSec=60,chance=0.2,cooldownSec=300}`。
- 深夜/免打扰/全屏/桥侧静音时 state 动作按 CF2 降级为 idleBase，**不排延迟动作**；走神同样不触发。

## 2. 行为语义

1. **反应延迟**：`state:` 命令不再立即改动作，先进入 `ReactionScheduler` 排期；
   tick 内只查时间戳（不 `sleep`、不阻塞主线程），到点再由现有 `_whale_force_play` 应用。
   同一窗口内多次状态触发**多源取 max**（due 不早于前次）；同一状态重复推送不重排；`idle/background` 立即清 force 并重置去重。
2. **打断恢复**：点击 / 拖拽开始 / 状态切换 → `InterruptRecovery.interrupt()` 记录打断时的 force；
   200ms 后回 `idleBase` 姿势锚点并清 pending。若期间已有新动作接管（force 变化），不误清新动作。
3. **走神**：连续 idle ≥ `idleSec`、非 gag（深夜/免打扰/全屏/静音）、非 busy（无 force/physics/拖拽/目标）时，
   每 `rollWindowSec` 评估一次，`chance` 命中则播 `think` 走神 `holdMs` 后回 idle；之后 `cooldownSec` 内不再触发。

## 3. 诊断（默认关闭）

| env | 作用 | 默认 |
|---|---|---|
| `PET_BEHAVIOR_DEBUG` | 为 `1/true` 时把 `[bhv]` 行打印到 stdout | 关 |
| `PET_BEHAVIOR_LOG` | 指定文件路径时把 `[bhv]` 行追加写入该文件（带时间戳，便于取证） | 关 |

日志内容示例：
```
[bhv] interrupt reason=state force=None recover=200ms
[bhv] schedule key=think planDelay=206ms sources=1
[bhv] apply key=think actualDelay=212ms
[bhv] recover -> idleBase
[bhv] idle_skit fire idle=5.0s hold=2.6s
[bhv] idle_skit end
```
> 诊断日志不含用户数据；`PET_BEHAVIOR_LOG` 仅写本机指定路径，不随发行包默认开启。

## 4. 测试 / 门禁

```powershell
# 仓库根（共享 venv）
& pet-work\.venv\Scripts\python.exe scripts\test-behavior-layer.py
# 或 PATH 里的 python
python scripts\test-behavior-layer.py
```
- 覆盖：普通延迟 150–300 / S0 80–150、多源取 max、到点/未到点、200ms 打断（含不误清/可取消）、
  走神 disabled/未 idle/概率/roll window/冷却；
- preflight：`unit: behavior`（<5s；缺 python/venv 时按约定 SKIP，不误报 FAIL）；
- npm 便捷脚本：`npm run test:behavior`（需要 PATH 中的 python；开发机推荐直接用共享 venv）。

## 5. 已知限制 / 后续

- S0 真机链路（approval 80–150ms）目前仅单测覆盖，周一挂载窗口补真实 `state:` 日志与截图；
- 点击打断若立即触发点击反应（pat 等新动作接管），按设计不清理新动作；如需"先回锚再反应"需另立规则；
- 走神目前复用 `think` 帧（停顿+托腮），后续可设计专用 `idle_skit` 序列（转头/慢眨眼细化）；
- 本轮未改 DSH/插件/生产文件；部署由窗口后流程负责。
