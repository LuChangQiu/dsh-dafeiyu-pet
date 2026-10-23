# STATE-CHANNEL · 桌宠状态通道协议（task-44）

> 版本：插件 v26 / 桌宠补丁 v26 起 | 方向：DSH 插件 → 桌宠（管道一行 `state:<json>`）| 同时写 `state.json.status`（面板读）

## 1. 协议
桌宠命名管道新增一行命令：
```
state:{"state":"thinking","tool":null,"since":"ISO","step":2,"turn":5,"heartbeatAt":"ISO"}
```
桌宠侧行为：
- 记录 `_bridge_state`；
- `state=approval|waiting_approval` → 走到中央/气泡「我在等你的确认哦」（8s）；
- `state=error` → 汗滴 FX + 摇头；
- 其它状态只记录（不冒泡），心跳每 5s 一次（同结构）。

## 2. 状态枚举（最终版）
| state | 含义 | 触发事件 |
|---|---|---|
| `thinking` | 思考中 | turn/start、用户消息送达 |
| `tool` | 正在用工具（`tool` 字段=工具名） | tool/call |
| `waiting_approval` | 等用户确认 | approval/asked |
| `waiting_input` | 等用户输入 | 预留（会话需要输入时） |
| `background` | 子代理/团队/后台在跑（只展示，不冒泡） | 非活跃会话事件 |
| `error` | 出错 | */error、/failed 事件 |
| `done` | 本轮完成（3s 后回 idle） | turn/end |
| `idle` | 空闲 | done 3s 后 / 心跳回退 |
| `disconnected` | 失联（插件判 `petOnline=false`） | 心跳检测 |

## 3. `state.json.status`（面板读，字段稳定）
```json
"status": {
  "state": "idle",
  "tool": "pwsh",              // 可 null
  "since": "2026-10-23T06:45:00.000Z",  // 当前状态开始
  "step": 4, "turn": 2,        // 可选，可 null
  "heartbeatAt": "2026-10-23T06:45:05.000Z",  // 每 5s 更新；>30s 面板判失联
  "source": "session-54d95e70",// 可 null
  "message": ""                // 可选补充（error 时=事件类型）
}
```
兼容：状态值等价别名（面板可映射）：`approval→waiting_approval`、`toolcall→tool`、`running→background`、`failed→error`、`completed→done`、`offline→disconnected`。

## 4. 可靠性
- 心跳：插件每 5s 刷新 `heartbeatAt`、推 `state:`，并**同步写 `state.json`**（5s 落盘）；面板判失联阈值 30s（>6 个心跳周期）。
- 断线：`petOnline=false` → `disconnected`；恢复后回 `idle`。
- 重启恢复：插件重新加载时从 `attribution.json` 恢复活跃会话，状态初始 `idle`，随下一事件更新；桌宠重启后自动重新建立 pipe 并继续收 `state:`（`bootstrap/start-pet` 由 DSH 启动或自举脚本负责）。

## 5. 面板映射（plugin-ui 已实现）
面板按 `state.json.status` 显示实时状态、工具名、耗时（`now - since`）、心跳/失联；无该字段时显示「状态通道未就绪」并按 `updatedAt` 兜底。


## 6. 多工作区 / 多对话（task-46，v30）
- 会话注册表：每个 session 记录 `{sessionId, workspace(cwd), title(工作区名#短id), role(user|teammate|subagent), lastUserMessageAt, state, tool, step, lastSeenAt}`。
- **当前跟随**：最近一条**真人消息**的会话；只有用户在新会话发消息才切换（≥2.5s 防抖）；后台事件不切换；**切换静默**（不冒泡）。
- `state.json` 新增：`currentSessionId`、`activeSessionCount`（其它在跑会话数）、`sessions[]`（最近 20 个，按最近活动排序，`current` 标记）。
- 桌宠只跟当前会话冒泡/动作；其它会话（含同工作区并行）标 `background` 安静；团队/子代理始终 background。
- TTL 30min 无真人消息移出列表；面板按 `workspace` 分组、当前标「跟随中」、顶部显示「另有 N 个对话在跑」。

## 7. 权威状态文件切换（v33，C' 方案，不重启 host）
- **原因**：v26~v31 的状态心跳 interval 未纳入 dispose，reload 会遗留旧 5s 写者继续覆盖 `state.json`（v32 已修 dispose，但旧写者只能靠 host 重启清除）。
- **v33 起**：权威状态写 **`bridge-state-v2.json`**（`config.stateFileV2`），**停止写 `state.json`**；旧写者继续写旧文件但被忽略。
- 读取方：面板/verifier **优先读 `bridge-state-v2.json`**，`state.json` 仅兜底；字段与旧版兼容（version/pet/status/sessions/...）。
- **host 下次自然重启后**（旧写者消失）：把 `stateFileV2` 指回 `state.json` 或把 v2 内容合并回 state.json，并删除/归档 `bridge-state-v2.json`；本文件（STATE-CHANNEL）保留迁移步骤。
