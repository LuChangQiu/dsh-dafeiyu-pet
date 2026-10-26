# LLM-ACTION-DIRECTOR（LLM 当导演 · 动作计划契约 v2）

> task-133 最高优先级：用户要"每个操作有动作、协调，不总蹦蹦蹦"。LLM 在给台词的同时给 **2–4 拍动作计划**；
> 词表 = **A（现有 28 acts） ∪ B（MIT 50 段 clip 名）**，统一 `perf:<json>` 协议，pet 按当前身体解析。
> 插件分支：`feat/llm-lines`；pet 侧执行器由 pet-dev 实现。第一版先接 **点击/收尾/idle 演出** 三类，不过度铺开。

## 1. 范围（第一版 3 类）

| 事件 | LLM kind | 触发 |
|---|---|---|
| 点击互动 | `clickLine` / `doubleClickLine` / `praise` / `interactHead` / `interactFeed` / `interactCome` | pet 写 speech-requests（点击/双击/被夸/被摸/喂食/叫她） |
| turnEnd 收尾 | `turnEnd` | DSH turn/end 完成（真实收尾） |
| 空闲演出 | `selfTalk` | idle skit（现有低频小剧场） |

温度/去重/预算沿用 `llm.lines`：temperature 0.9、7 天精确去重 + 相似度 >0.8 拒绝、连续同句禁止、¥10/日预算。

## 2. 词表（A ∪ B）

### 2.1 A：现有 28 acts（真源 `docs/generated/act-fx-whitelist.json`）

`caught, cheer, cry, dance, drag, eat, eatSatisfied, errorSequence, fall, hum, idleBase, idleSettle, idleShift, idleStretch, jump, land, lonelySit, pat, report, sleep, sneak, think, tsundere, turnStop, waitPeek, wake, walk, wave`

> 插件运行时从 `whaleActs` 白名单加载，prompt 动态列出；A 走 `act:<name>`。

### 2.2 B：MIT 50 段 clip（`dsh-whale-girl-pet`，`assets/thumb/<名>.webm`）

完整清单见 **`docs/generated/action-clips.json`**（version 1，count 50）。按用途分组：

| 用途 | clip 名 |
|---|---|
| 点击回应 | `点击回应 - 开心跃动`、`点击回应 - 害羞惊讶`、`点击回应 - 傲娇生气（侧身展示）` |
| 工作开始 | `开始工作`、`工作思考`、`认真工作`、`工作摸鱼` |
| 工作被打扰/等确认 | `工作被打扰` |
| 工作结束 | `工作结束`、`长时间工作看表`、`看表叹气` |
| 被吓一跳/出错 | `被吓一跳（炸毛）`、`摸鱼被抓`、`偷吃零食被抓住`、`偷吃Token` |
| idle 池 | `待机呼吸休闲`、`东张西望`、`悠闲哼歌`、`看天气`、`哈欠连天`、`打喷嚏`、`打瞌睡被惊醒`、`迷糊犯困`、`睡眼惺忪`、`原地小憩沉眠`、`睡觉第一/二/三段`、`翻钱包` |
| 吃/喝 | `吃盒饭`、`吃小鱼干`、`喝奶茶` |
| 玩/互动 | `原地敲击桌面互动`、`原地专心玩魔方`、`原地蹲下玩玩具汽车`、`闲得无聊打游戏`、`玩游戏气急败坏`、`原地跳跃抓碎头顶物品`、`原地重力下蹲压缩`、`原地漂浮踏步`、`螃蟹走路`、`小幅度原地 360 度旋转展示`、`用鲸鱼尾巴拍打地面`、`超大伸懒腰`、`女仆屈膝礼仪`、`女仆扫除` |
| 举牌/特效 | `举牌不是大肥鱼`、`空白举牌`、`鲸鱼吐泡泡特效` |
| 拖拽反馈 | `被鼠标拖拽悬空反馈` |

> 插件把 B 名原样列入 prompt 与校验；pet 侧按 clip 名解析到视频资产。B 走 `clip:<name>` 语义（协议内仍用 `act` 字段承载）。

## 3. LLM 输出 schema

```json
{
  "text": "台词（≤40字，≤2句，无 emoji/数字）",
  "beats": [
    { "act": "点击回应 - 开心跃动", "ms": 500, "intensity": 1.1, "transitionMs": 120 },
    { "act": "wave", "ms": 600 }
  ],
  "intensity": 1.0,
  "interrupt": false
}
```

- `text`：可选字段（协议）；插件本版要求有台词，缺失则走单动作兜底 + 池台词。
- `beats`：**2–4 拍**；`act` ∈ A ∪ B；非法丢弃，剩余 <2 拍整条降级；`ms` 200–3000、`intensity` 0.5–1.5、`transitionMs` 0–800（越界 clamp）。
- `interrupt`：bool，默认 false；true 表示可打断当前低优先级动作。
- 输出必须纯 JSON（允许围栏/前后解释，插件剥取第一个 `{` 到最后一个 `}`）。

## 4. DSH 操作 → 动作矩阵（与 ux 对齐；LLM prompt 中作为语义提示）

| DSH 操作 | 首选 A | 首选 B clip | 备注 |
|---|---|---|---|
| turnStart 开工 | walk / wave / land | 开始工作 | 不 jump |
| tool 工具 | think / hum | 认真工作 / 工作思考 / 工作摸鱼 | 按工具类型细分（命令/读/写/搜索） |
| approval 审批 | waitPeek / turnStop | 工作被打扰 | 不催第二次 |
| done 收尾 | cheer / jump / land | 工作结束 | 短任务仅短反应，庆祝冷却 120s |
| error 报错 | caught / errorSequence | 被吓一跳（炸毛） | 不长篇卖惨 |
| 长任务 | think / hum | 长时间工作看表 / 看表叹气 | 低频 |
| plan / team | think / waitPeek | 工作思考 / 东张西望 | 轻量 |
| cost / 费用 | peek | 翻钱包 | 不评价贵省 |
| reminder / 提醒 | waitPeek / wave | 看表叹气 | 轻 |
| 多会话 / 切换 | turnStop / walk | 东张西望 | 不抢戏 |
| idle 空闲 | idleBase / idleShift / idleSettle / idleStretch / hum | 待机呼吸休闲 / 东张西望 / 悠闲哼歌 / 看天气 / 哈欠连天 | 随机 idle 池，同类不连续 |
| 被夸/被摸/喂食/叫她 | pat / tsundere / eat / waitPeek | 点击回应 - 害羞惊讶 / 开心跃动 / 傲娇生气；女仆屈膝礼仪 | 即时反应 <250ms |

> 矩阵是"允许集合+优先级"，LLM 只在集合内选择/组合；不做一次铺全，先 3 类事件启用。

## 5. 延迟策略（点击 <250ms）

LLM 生成 0.7–1.5s，**不能让点击干等**：

1. **立即规则动作**（插件收到 speech-request 后第一件事，不等 LLM）：
   - `click→pat`、`doubleClick→waitPeek`、`praise→tsundere`、`pat→pat`、`feed→eat`、`come→waitPeek`、`sneakCaught→caught`、`celebrate→cheer`；
   - 通过 `perf:` 单拍（`priority:'high'`, `interrupt:true`, `ms:600`, `transitionMs:120`）或 `act:` 立即发出；日志 `perf immediate {kind,act,latencyMs:0}`。
2. **LLM 异步补**：台词 + 后续 2–4 拍计划在 0.7–1.5s 后到达，`priority:'normal'`；pet 执行器若正忙高优先级动作则排队/合并，不打断即时反应（或按 §6 规则）。
3. **启动预生成缓存（可选，未强制）**：pet 启动时插件可预生成每类 5–10 条"台词+动作"缓存轮换；本版先用"立即规则动作"保证延迟，缓存作为后续优化（避免首版复杂）。
4. 点击后气泡/动作等待感：立即动作即视觉反馈；LLM 台词到达再补气泡。

## 6. `perf:<json>` 协议（pet 侧执行）

插件发送单行：`perf:<json>`（无换行；不含用户文本）。

```json
{
  "v": 1,
  "kind": "clickLine",
  "source": "action-director",
  "priority": "high",
  "text": "（贴过去蹭一下）",
  "intensity": 1.1,
  "interrupt": false,
  "beats": [
    { "act": "点击回应 - 开心跃动", "ms": 500, "transitionMs": 120 },
    { "act": "wave", "ms": 600 }
  ],
  "onEnd": "idle"
}
```

- `priority`：`high`（点击/交互即时反应）> `normal`（turnEnd/LLM 计划）> `low`（idle 演出）；同优先级覆盖、低优先级丢弃/排队。
- `interrupt`：true 允许打断当前低优先级动作；拖拽/物理/S0/用户输入始终最高优先级，可打断 director。
- `beats[].act`：A act 或 B clip 名；pet 按当前身体解析（A 走 act 动画，B 走 clip 视频）。
- `onEnd:'idle'` → 回 idle 基线；`transitionMs` 控制切换淡入（默认 180ms crossfade）。
- 校验：`v==1`、beats 1–4、act 已知、ms 200–3000；非法 → 忽略并回退单动作/不动。
- 执行器记录 `perf recv/start/beat/end/interrupt`（act/ms/priority，无文本）。

## 7. 插件行为（已实现）

1. 导演类 kind：原 prompt + `[导演任务]` JSON schema（A+B 白名单 + 操作矩阵 + 限制）。
2. `parseDirectorPlan()` 校验；成功先 `speak(text)`，再按 `channel` 执行：
   - **`channel:'perf'`（默认）**：`send('perf:'+payload)`，日志 `perf send`；
   - `channel:'act'`（兼容旧 pet）：按 ms 顺序 `act:`，最后 `act:idleBase`。
   - 限流：`minGapMs 1200`、`maxPerMinute 10`；`priorityByKind` 可配。
3. LLM 超时/空/非法 JSON/白名单不足：
   - 文本本身可用 → 保留 LLM 台词 + 单动作兜底 `{act:'think',ms:800}`；
   - 否则池台词 + 单动作；日志 `perf plan rejected`、`fallbackReason:'invalid-plan'`。
4. 去重：7 天精确 + 相似度 >0.8 + **连续同句禁止**（全局 `lastSpokenText`）；LLM 重复→重试一次→池兜底 `fallbackReason:'duplicate'`。
5. 配置：`cfg.actionDirector = {enabled:true, channel:'perf', minGapMs:1200, maxPerMinute:10, maxBeats:4, priorityByKind?}`；`enabled:false` 退回纯台词 LLM。

## 8. 测试与验收

- 单测 `action-director.test.mjs`（A+B 词表/50 clip/DSH 映射/schema/围栏/拍数/白名单/clamp/兜底/payload/静态接线）。
- mock 集成 `llm-lines-mock.test.mjs`：点击 → `perf immediate` + LLM `perf plan` + `perf send`；非法 JSON → rejected + 单拍 fallback；**连续 5 次同句** → 去重/重试/兜底，不出现连续同句。
- 部署后真实验收：
  1. 点击后 ≤250ms 看到即时动作；0.7–1.5s 后台词+后续拍；
  2. `perf:` 含 priority；拖拽中不打架（pet 验收）；
  3. done 连续 5 次不重复同句（llmStats: `duplicate` 计数/成功率）；
  4. 非法/超时 → 单动作 + 池台词，不卡死。

## 9. 隐私与性能

- 只传 act/clip/ms/intensity/priority/kind 与最终台词；不传用户文本、路径、参数、会话 id。
- 每条计划 ≤4 个 setTimeout / 一个 perf 消息；限流 10/分钟；动作不改变物理位置。
- 预算：动作与台词共用一次 LLM 调用；¥10/日闸门不变。

## 10. 回滚

- `actionDirector.enabled=false`：退回纯台词 LLM。
- `actionDirector.channel='act'`：兼容旧 pet（无 perf 执行器时用）。
- pet 侧关闭 perf：插件保持 act 通道即可。
