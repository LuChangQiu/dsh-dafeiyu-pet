# LLM-LINES-AUDIT（task-133 对话全 LLM 化 · 审计 + 样本 + 改动计划）

> 分支：`feat/llm-lines`（基于 `main@bb9d435`）。本文件先给审计与样本（用户可见），实现完成后追加"改动"章节。
> 数据来源：生产日志 `pet-work/evidence/pet-bridge-main.log`（2026-10-26 10:56 读取，共 959 行，覆盖 10-24 ~ 10-26）。
> 审计对象：`plugin/server/lib/index.js`（v49.x 现网）。

## 1. 结论（一句话）

**主事件（开工/收工/报账/偷吃/重逢/等输入/等确认/自言自语）已经走 LLM-first**；
"还有一半固定"的观感来自 **4 个未接 LLM 的用户可见路径**：
① **心声 `inner`（括号内独白）永远是固定池**（最近 200 行里仅有的 2 条 pool 就是它）；
② **早安/晚安的仪式气泡**仍是 `pick('kaigong')`/`pick('shenye')`；
③ **点击/双击/被夸/偷吃后的短句在 pet 侧本地固定池**（不在插件内，插件只发 FX/动作）；
④ **`approvalUseLlm:false` 是死配置**（代码从未读取）：等确认实际已走 LLM，但配置给人"固定"的误导；另有 1 条 10-24 旧日志 approval 走了 pool。

## 2. 现网事件 → 话术来源表（`index.js` 代码级）

| 事件/路径 | 生成方式 | 代码位置（v49 现网） | 现网来源 |
|---|---|---|---|
| turn/start 开工 | `generate('turnStart')` + 预生成缓存 | `onEvent` turn/start → 2844；`pregen` 机制 | **LLM**（失败/预算/cap 回退池 `kaigong`） |
| turn/end 收工（成功） | `generate('turnEnd')` | turn/end 2930 附近 | **LLM**（回退 `shougong`） |
| turn/end 失败（bad） | `generate('turnEndBad')` | 同上；spike 复用 | **LLM**（回退 `anwei`） |
| 报账 report（每 5 轮/5min） | `generate('report',{numbers})` | turn/end 内 report 分支 ~2930 | **LLM**（回退 `shougong`；`reportPerHour` 3） |
| 偷吃/用量突增 spike | `generate('spike')` | `checkUsageSpike()` ~1455 | **LLM**（回退 `anwei`；`spikePerHour` 2） |
| 久别重逢 reunion | `generate('reunion')` | `checkReunion()` ~1490 | **LLM**（catch 回退文案 + `kaigong`） |
| 等输入 waiting_input | `generate('waitingInput')` | user-questions/request ~2971 | **LLM**（回退 `dengdai`） |
| 等确认 approval | `generate('approval')` | approval/asked ~3011 | **LLM**（回退 `dengdai`）；`approvalUseLlm` 未被读取 |
| 自言自语 selfTalk | `generate('selfTalk')` | idle skit ~3134 | **LLM**（回退 `ganhuo`） |
| **心声 inner**（括号独白） | `innerFor(kind)` 本地固定数组 | 2411 附近 enqueue | **固定池（永远）** |
| **早安 morning 仪式** | `speak('morning', pick('kaigong'))` | 仪式定时器 ~3046 | **固定池** |
| **晚安 sleep 仪式** | `speak('sleep', pick('shenye'))` | 仪式定时器 ~3062 | **固定池** |
| **点击/摸头/喂食/叫她** | 仅 `interact()` 发 FX/动作，无气泡 | `interact()` ~1400；ui-action 1087-1094 | **固定（无 LLM；pet 侧点击另有本地固定台词）** |
| **被夸** | 未实现独立事件（仅 prompt 里提"夸奖"反转） | — | **不存在** |
| **sneak（偷吃动作）** | 仅 `whaleAct('sneak')` 动作，无台词 | idle tick ~3153 | **无台词** |

> 日志里 pool 只出现在：`inner`（2 条）、旧版 approval 1 条、test-hook 1 条；主事件均 `source:llm`。

## 3. 最近日志 source 占比（实测）

| 窗口 | `source:llm` | `source:pool` | LLM 成功 | 回退 | 说明 |
|---|---|---|---|---|---|
| 最近 200 行 | **9（82%）** | 2（18%） | 9 | 0 | 2 条 pool 均为 `inner` 心声 |
| 最近 500 行 | **19（86%）** | 3（14%） | 20 | 1 | 1 次回退（reunion） |
| 全文件 959 行 | 25 | 5 | 24 | 1 | pool：inner×2、旧 approval×1、test-hook×1、其它 |

- 最近 200 行 kinds：turnEnd 4、turnStart 3、report 1、spike 1。
- 延迟：752–1451ms（平均 1035ms）；tokens 359–421（平均 371）；成本约 ¥0.0131/20 次调用（¥1/日预算内）。
- 回退率：最近窗口 0%（历史 1/25≈4%）；回退日志目前**没有统一 `fallbackReason` 字段**（只有 debug reason）。

## 4. 真实 10 条样本（生产 LLM 输出，原文）

1. `turnEnd`「这轮跑得挺久，我尾巴都趴平了，你手也松松吧。」
2. `turnEnd`「这轮顺顺当当收工了，我趴着不动，你也松松手吧。」
3. `turnStart`「上午第七轮，我趴边上不动，你干你的——我尾巴本来也没多大力气。」
4. `turnStart`「（尾巴轻轻摆着）上午第七轮，我趴着就行，不碍你事。」
5. `report`「这轮干完，白饭11616577粒，我趴边上——就看着，不碰碗。」
6. `spike`「（缩了缩尾巴）这轮白饭吃得多，不怪我，是活儿太香了。」
7. `turnEnd`「上午第三轮收工，我尾巴歇着，你手也歇会儿。」
8. `selfTalk`「（吐了个泡）上午第二轮，自己跟自己摆摆尾巴。」
9. `selfTalk`「（趴着看水面）上午的光挺好，我晒我的，你忙你的。」
10. `selfTalk`「（尾巴摆两下）没人叫，就自己晒晒上午的光。」
> 样本已体现人设/IP 词（白饭、尾巴、趴）、反转、≤40 字（日志 text 均 ≤40 汉字）。

## 5. 未接 LLM 的缺口与目标（task-133 范围）

| 缺口 | 目标（全部默认 LLM-first） | 回退 |
|---|---|---|
| inner 心声 | `generate('inner')`（保留短、心声体；同一事件 kind 对应） | 固定 `EMBEDDED.inner` 池 |
| morning 早安 | `generate('morning')`（当前已有 prompt kind，未接） | `pick('kaigong')` |
| sleep 晚安 | `generate('sleep')`（当前 prompt kind 已有，未接） | `pick('shenye')` |
| 点击互动（摸头/喂食/叫她） | 新增 kinds `interactHead/Feed/Come`，`interact()` 内 LLM-first，气泡+已有 FX | 新小池（每 kind 2–3 句） |
| 被夸 | 新增事件/面板动作 `praise`（安全词），kind `praise` LLM-first | 池 2 句 |
| 偷吃 sneak 台词 | `whaleAct('sneak')` 成功后可选 inner/气泡 LLM（低频，≤2/日） | 池 2 句 |
| 等确认 approval（已有 LLM） | 保持 LLM-first；`approvalUseLlm` 删除/改注释为兼容；日志加 source/fallbackReason | `dengdai` |
| 报账 report | 已 LLM；补 `fallbackReason`/来源占比日志 | `shougong` |
| pet 侧点击固定台词 | 本轮不直接改 pet（避免 pet/插件交叉）；建议 pet 侧未来订阅 `llm` 下发或由插件在 interact 时统一发声（先做插件侧；pet 本地双击余额面板属功能面板，文案后续窗口） | — |

## 6. 实现计划（本分支）

1. **统一 LLM-first 生成入口**：扩展 `generate` kinds（inner/morning/sleep/interactHead/interactFeed/interactCome/praise/sneakLine），全部走 `llm.lines`（persona+上下文+反转+IP 词）；池仅失败/超预算/cap/深夜（不生成）兜底。
2. **回退原因标准化**：所有 fallback 记录 `fallbackReason`（`mode|budget|disabled|kind-cap|timeout|empty|invalid|duplicate|llm-unavailable|night`）+ `source`；日志新增 `llm stats`（成功率/来源占比/延迟 p50/p95/成本）。
3. **接线**：inner/morning/sleep/click 互动/被夸/sneak 台词；`approvalUseLlm` 删除（或标 deprecated）。
4. **mock 测试**：fake ctx.llm（成功/超时/空/非法/超预算/深夜/回退 reason）；真实 10 条样本取自生产日志（本文件 §4），不改日志。
5. **验收**：mock 测试绿；日志统计字段齐全；默认 `llm.lines.enabled=true`、预算 ¥1/日、≤40 字、去重/相似度保留。

## 7. 版本/分支

- 分支：`feat/llm-lines`（窗口后合入；需新挂载窗口部署）
- 状态：审计完成 → 实现中（本文件随实现更新来源占比与改动）
