# ATTENTION-BUDGET（主动开口预算 / 抑制门 / 拒绝记忆）

> 分支：`feat/attention-budget`（基于 `bb9d435`）。本轮只交付**纯逻辑模块 + 单测 + 本文档**；
> **不接 `index.js` 事件**、不碰 pet/pipe、不影响任何运行时行为。接线留窗口后单独做。

## 0. 目的与非目标

**目的**：让桌宠"主动开口"有节制、可拒绝、可恢复。

**非目标（写死）**：
- 不卖惨、不报复、不操纵（拒绝后不冷暴力、不暗示"你不理我"、不反复试探）。
- 不做无限主动（有硬上限）；不因被拒绝而降低诚实/安全规则。
- 不读/不存 DSH 消息原文、工具参数、路径、凭据；日志只有计数/枚举。
- 事件反应（approval、error、turn/end 等真实事件触发）**不计入主动预算**。

## 1. 预算（主动开口）

| 规则 | 值 | 说明 |
|---|---|---|
| 默认/天 | **3** | 只统计 `proactive`（主动/惊喜）开口；反应类不计 |
| 硬上限/天 | **4** | 即使配置更大也 clamp 到 4 |
| 切日 | **本地日 00:00** | 以本地日期键 `YYYY-MM-DD` 切日；切日重置 used，不重置拒绝暂停 |
| 频次系数 | 拒绝暂停期 **0.5** | 暂停 24h 内频率 ×0.5；恢复后 1.0 |
| 计数时机 | 真正开口后 | 由接线层在成功发言后调 `recordProactive()`；事件反应调 `recordReaction()`（不计数） |

## 2. 抑制门（预算内也归零）

按顺序判定；任一命中 → `allowed:false`（`suppressed:true`，`reasons[]`）：

1. **深夜**：本地 23:30–08:00（`night`）
2. **免打扰/静音模式**：`mode ∈ {silent, focus, off}`（`mode-quiet`）
3. **系统免打扰/DND**：`dnd:true`（`dnd`）
4. **全屏**：`fullscreen:true`（`fullscreen`）
5. **打字中**：`typing:true`（`typing`）

> 接线层需从 OS/宿主侧提供 `mode/dnd/fullscreen/typing` 输入；本模块只做纯判定。
> **安全例外**：S0（approval/等待输入）与用户直接互动不属于"主动开口"，应由调用方直通，不经过本预算（或在接线层以 `isReaction:true` 放行）。

## 3. 拒绝记忆

| 信号 | 规则 | 状态 |
|---|---|---|
| 用户无视（60s 无回应）N 次 | `ignoredThreshold=2` → 暂停主动 **24h**，`kind='ignored'` | `rejection{lastAt,count,kind,pauseUntilMs,topic}` |
| 用户显式「安静/静一静/下班」 | 立即暂停主动 **24h**，`kind='quiet'` | 同上 |
| 暂停期内 | 不主动；频率 ×0.5；换更安静方式（接线层执行） | `frequencyFactor()` |
| 同 topic | 拒绝后 **7 天**内不碰该 topic | `topicAvoid{topicKey: untilMs}`（topicKey=加盐 hash 前 16 hex） |
| 用户主动互动一次 | **立即清零** streak/pause/topicAvoid | `recordUserInteraction()` |

- 状态文件（接线层建议）：`pet-work/attention-budget.json`（含 `topicSalt` + 计数 + `rejection.topicKey` + `topicAvoid` hash 表）；**原子写**（tmp + rename），仅在状态变化时节流落盘，不在热路径写；文件仅本地（LOCAL ONLY），不上传/不导出。
- 反序列化容错：缺失/非法 JSON → 当天空状态，不崩溃；`proactiveMax` clamp 到 0..4。
- **topic 隐私（P2 修）**：只存 `topicKey = sha256(salt + ':' + topic)` 的**前 16 hex**；`salt` 为安装级随机值，随状态文件本地保存、**不进日志**；不存 topic/用户原文。无 salt 时不写 topic（避免未加盐字典攻击）。`topicAvoid` 只存 hash 列表。

## 4. 模块 API（`plugin/server/lib/attention-budget.js`）

| API | 作用 |
|---|---|
| `createAttentionBudget({now, dayKeyFn, config, state})` | 创建实例；clock/dayKey 可注入（测试用） |
| `canSpeak({nowMs,isReaction,isS0,topic,mode,dnd,fullscreen,typing})` | 判定是否允许；**S0（isS0:true）安全例外直通**；**显式 quiet/ignored 暂停优先于 isReaction**（反应也不越过）；返回 `{allowed,reason,reasons,suppressed,frequencyFactor,used,max,remaining,...}`；reason：`ok/reaction/night/mode-quiet/dnd/fullscreen/typing/rejection-pause/topic-avoid/budget` |
| `recordProactive({nowMs,...ctx})` | 发言成功后计数；被拦截则不计数；**`isReaction:true` 直接拒绝（reason=`reaction-not-proactive`）** |
| `recordReaction()` | 事件反应（不计数） |
| `recordIgnored({topic,nowMs})` | 无视一次；达到阈值 → 24h 暂停 |
| `recordQuiet({topic,nowMs})` | 显式静音 → 24h 暂停 |
| `recordUserInteraction({nowMs})` | 清零拒绝/话题冷却 |
| `suppression(ctx,nowMs)` / `frequencyFactor(nowMs)` / `topicAvoided(topic,nowMs)` | 单点查询 |
| `view(nowMs)` / `logView(nowMs)` / `getState()` / `rollover(nowMs)` | 面板视图 / 日志计数 / 持久化状态 / 切日 |
| `serializeBudgetState` / `deserializeBudgetState` / `readBudgetState(file)` / `writeBudgetStateAtomic(file,state)` | 持久化工具（非热路径；状态含 `topicSalt`，非法/缺失容错） |
| `hashTopicKey(topic, salt)` | topic → 加盐 sha256 前 16 hex；无 salt 返回 null（不落 topic） |
| `ATTENTION_DEFAULTS` | 默认配置（3/4、23:30–08:00、拒绝 2 次/24h/0.5/7d） |

## 5. 日志与隐私

- 日志只允许：`{dayKey, used, max, hardCap, paused, rejectionCount, rejectionKind, frequencyFactor, topicAvoidCount}`（`logView()`）；**不含 salt/topicKey 原值/topic 原文**。
- 禁止：用户文本、topic 原文、拒绝原因原文、路径、会话 ID、salt、topicKey（日志里只出现计数）。
- 不新增 timer；落盘由接线层在状态变化后节流调用（如 ≥30s 合并）。

## 6. 接线点（窗口后，另开分支）

1. **whaleActs / 主动池**：决定说之前 `canSpeak(...)`；成功后 `recordProactive()`；被无视 60s → `recordIgnored()`；用户说"安静" → `recordQuiet()`；用户任何互动 → `recordUserInteraction()`。
2. **CHAT settings**：面板频率档位只写 `proactivePerDay`（0–4 clamp），不直接写拒绝状态。
3. **OS 输入**：`mode`（现有 mode）、`dnd/fullscreen/typing` 由宿主/OS 视窗状态提供；缺失默认 false。
4. **持久化**：`attention-budget.json` 原子写 + 启动读取；与 `companion.json` 分离，各自 schema。
5. **S0 安全例外**：approval/等待输入直通，不消耗主动预算。

## 7. 回滚

- 接线层开关（建议 `attentionBudget.enabled=false` 默认关）→ 不加载、不落盘、零副作用。
- 删除 `attention-budget.json` 即恢复默认（3/天、无拒绝记忆）。
- 本模块纯函数、无 schema 迁移依赖；合并前分支独立，不碰 main。

## 8. 验收（本轮）

- 单测 **16/16**：默认预算/硬上限 clamp/反应不计/切日重置+拒绝跨日/5 类抑制门/无视 2 次暂停+24h 恢复+频率 0.5/显式静音/用户互动清零/topic 7 天/序列化容错/原子写无 tmp 残留/日志仅计数枚举/本地时间助手/S0 直通/quiet 下反应也不越过/recordProactive 拒绝 reaction/topic 加盐 hash 不落原文。
- `node plugin/server/test/attention-budget.test.mjs` 退出码 0；<1s；不启 DSH、不碰 pipe。


---

## 9. 接线实现（`feat/attention-wiring`，窗口后灰度）

> 分支基于 `feat/attention-budget@d319202`；**默认关**；索引不接事件循环以外的新 timer。

### 9.1 配置（`cfg.attentionBudget`）
```jsonc
{
  "enabled": false,          // 默认关：disabled = 零调用/零读盘/零写盘，行为同现状
  "stateFile": "",           // 建议 pet-work/attention-budget.json；空 = 仅内存
  "proactivePerDay": 3,      // 0–4（硬上限 4）
  "ignoreAfterSec": 60,      // 主动发出后 N 秒无用户交互 → 记一次 ignored（近似口径）
  "persistMs": 30000,        // 状态变化后落盘节流
  "topic": "",               // 内部枚举/ID（会加盐 hash）；空 = 不记录
  "suppress": { "dnd": false, "fullscreen": false, "typing": false }
}
```

### 9.2 index.js 接线点
1. **创建**：仅 `cfg.attentionBudget.enabled === true` 时 `createAttentionWiring(...)`；否则 `null`（不读状态文件、不建实例、无日志）。
2. **主动开口路径**（`whaleAct`，report/wave/sneak）：
   - 决策通过后、`act()` 发送前：`attentionWiring.gate({kind, isS0:false, isReaction:false, nowMs})`
   - 被抑制：`log debug 'whale act suppressed' {reason:'attention:<reason>'}`, **不记账**、不发动作；
   - `act()` 成功后才 `recordProactive({kind, nowMs})`（被 guard 拒绝不耗预算）。
3. **用户交互**：`user/message` 事件、`ui-action`（点击/摸头/喂食/叫她/ack 等）→ `noteInteraction()` 清零拒绝/暂停/pending。
4. **无视近似**：现有 bridge **没有**"用户未响应注意力气泡"信号，口径写死为：
   **主动发出后 `ignoreAfterSec`（默认 60s）内无任何用户交互 → 记一次 ignored**；
   每次主动只判一次，用户任何交互清除 pending；两次 ignored → 24h 暂停（预算模块规则）。
5. **S0 直通**：approval/waiting_input 不经过 `whaleAct`；如需显式判定用 `gate({isS0:true})` → allowed，不占预算。
6. **tick/落盘**：复用现有 status 心跳（5s）调 `attentionWiring.tick()`（无视判定 + 节流落盘），**不新增 interval**。
7. **dispose**：强制 flush 状态文件后停止（disabled 无操作）。

### 9.3 持久化与隐私
- `attention-budget.json`：原子写（tmp+rename），默认 30s 节流；含 `topicSalt`、计数、`rejection.topicKey`（hash）、`topicAvoid`（hash 列表）。
- 不存用户原文/路径/会话 ID；日志只含 `enabled/used/max/paused/count` 等计数（`logView`）。
- 状态文件 LOCAL ONLY；删除即恢复默认（3/天、无拒绝记忆）。

### 9.4 回滚
- `attentionBudget.enabled=false`（默认）→ 完全恢复原行为，零副作用。
- 不存在 schema 迁移；文件可删除；不影响 CF1/whaleActs 既有门禁（预算只是在 `act()` 前多一层允许判定）。

### 9.5 验收（本轮）
- `plugin/server/test/attention-wiring.test.mjs` **9/9**：disabled 零副作用（不读/不写/无状态文件）、budget 3/4 拦截、S0 直通、quiet+互动清零、ignore 60s 近似（一次/两次暂停）、节流落盘+dispose flush、topic 隐私、真实 `shouldFire`+预算组合。
- `plugin/server/test/attention-wiring-contract.test.mjs` **7/7**：index 接线点静态断言（默认关、仅 enabled 创建、gate/recordProactive/noteInteraction×2/tick/dispose、S0 不路由 whaleAct）。
- `plugin/server/test/attention-index.test.mjs` **2/2**：真实 index.js + mock ctx——disabled 不创建状态文件/无 wiring 日志；enabled 创建并记 `attention budget wiring`（启动不写盘，仅主动后写）。
- 回归：attention-budget **16/16**；preflight `unit: attention`（<5s）。
