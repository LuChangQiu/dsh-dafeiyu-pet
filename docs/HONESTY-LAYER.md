# HONESTY-LAYER — P0-1 状态诚实化（卡住 / 失败 / 等待）

> 实现：`pet/honesty_layer.py`（纯逻辑，无 Qt）+ `pet/桌宠.py` 接线（`_honesty_*` / `_honesty_tick`）。
> 单测：`scripts/test-honesty-layer.py`（假时钟）；preflight 已接入 `unit: honesty`。
> 本轮只作用于**现有 `state:` 通道的表现层**，不改动作优先级；`index.js`/state-layer 接线留窗口 4.0。

## 1. 配置（`config.json` -> `honesty`）

```jsonc
{
  "honesty": {
    "enabled": true,                 // 总开关（false = 完全恢复原表现，不改变任何既有规则）
    "stuckAfterSec": 25,             // busy/thinking 超过这么久无新 state 事件 → 卡住表现
    "stuckBlinkEverySec": 2.6,       // 卡住期间慢眨眼间隔
    "stuckBlinkSec": 0.26,           // 单次慢眨眼时长
    "secondFailureCryDelaySec": 1.2, // 连续第二次失败后多久委屈
    "errorLines": ["这次没成……", "又没成……"], // 第一次/连续第二次失败短句
    "waitingInputLine": "我在等你～"  // waiting_input 的短句（approval 原句不变）
  }
}
```

- 缺省/老配置自动补默认；非法值夹取（`stuckAfterSec` 5–600s、眨眼 0.8–10s 等）。
- `enabled=false` 时本模块完全不介入：不会重新计时、不会补短句、不会取消/安排 cry。

## 2. 行为语义

1. **卡住**：`state:thinking` / `state:tool` 后，**严格超过** `stuckAfterSec`（默认 25s，恰好 25s 不算）
   没有新的 `state:` 事件 → 停止走路/装忙（`target=None`）、清 force、改播 `think` 发愣帧；
   期间按 `stuckBlinkEverySec` 触发一次 `stuckBlinkSec` 慢眨眼；**不显示"正在努力"类文案**。
   任何新 state 事件立即退出卡住（并清理本模块占用的 think force）。
2. **失败**：`state:error` 不庆祝、不报账。
   - 第一次：短承认（`errorLines[0]`）+ 现有 errorSequence（耷拉）；
   - 连续第二次（中间无其它 state 事件）：`errorLines[1]` + 延迟 `secondFailureCryDelaySec` 后 `cry`（委屈）；
   - **任何非 error 续的新 state 事件（含 done/成功）都会取消 pending cry**，成功状态额外重置 streak（P1 修复）。
3. **等待**：`waiting_approval` / `waiting_input` 保持现有 `waitPeek` + S0 规则；
   `waiting_input` 额外一句「我在等你～」；approval 保留原「我在等你的确认哦」。S0 不会被本模块打断。

## 3. 已知限制（P2：25s 长任务误判）

- **本模块只看 `state:` 事件时间**：如果 DSH/插件在长任务期间**不发送任何状态事件（心跳/步骤/工具结果）**，
  超过 25s 会被判为"卡住"。这是当前通道的已知限制；**根本解法是 DSH 侧提供心跳/步骤/工具结果事件**（窗口 4.0 接 state-layer），
  或把 `honesty.stuckAfterSec` 调大/关闭 `honesty.enabled`。
- 现有 pet→bridge 协议没有独立的 `tool/result` 事件通道；插件侧后续会通过 `state:`（含 tool 名/序号）或 state-layer 补足活动信号；
  本模块对"重复/周期性 state 事件"已做验证：每次事件都会刷新计时，**不会仅因 thinking 持续时间长而误判**（有事件即不卡住）。
- 慢眨眼通过延长 bridge FX blink 时长近似，后续可由专用 blink 通道细化。

## 4. 测试 / 门禁 / 诊断

```powershell
python scripts\test-honesty-layer.py          # 40 项假时钟断言（<1s）
# preflight 自动跑 unit: honesty（缺 python/venv 时 SKIP，不误报 FAIL）
```
- 覆盖：卡住严格 >25s 边界、重复 thinking 事件刷新、新事件重置、disabled；失败首/二次、cry 取消、成功重置；
  等待 S0/短句；配置夹取。
- 诊断 env（默认关）：`PET_HONESTY_DEBUG`（stdout）、`PET_HONESTY_LOG`（文件）；测试/取证可用 pet 目录 `honesty-debug.on` → `honesty-debug.log`（不入库）。

## 5. 窗口 4.0 待办

- `index.js`/state-layer 接线：heartbeat/step/tool-result 事件、TTL 兜底（丢事件时自动退出卡住）；
- oneShot/解析链按 `FIXTURE-CLARIFICATION-v3` 由插件侧产出，pet 只消费；
- S0 真机链路（waiting_approval 等）补真实日志与截图。
