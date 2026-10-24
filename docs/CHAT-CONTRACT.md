# CHAT-CONTRACT（task-90，v1.1 定稿）

> DSH 桌宠聊天后端契约。默认 **关闭**（`chat.enabled=false`）；关闭时端点 403 `CHAT_DISABLED`。
> 传输：**RPC 信封** `POST /pet-bridge-ui/chat/rpc`（同源 cookie 鉴权；401/403 同现有面板）。请求 `{rpcId, method, payload}`，响应 `{rpcId, ok, result?, error?}`；`error={code,message,retryable}`。
> 人设：`30-companion-persona-spec.md §4.2`（鲸鱼娘朋友、≤40 字/≤2 句、先接情绪、关系阶段/情绪/最近≤5 记忆；不装真人、不 PUA/恋爱、不窥探、不读 DSH 原文）。
> 存储：`pet-work/memory.json`、`chat-settings.json`、`chat-history.json`（服务端内部，原子写；不对 UI 暴露文件格式）。

## 方法
| method | payload | result |
|---|---|---|
| `chat.state.get` | `{}` | `{enabled,quietMode,frequencyPerDay,memoryEnabled,stage,stageLabel,memoryCount,todayChats,busy,lastAt}`（`stage` R0–R3 仅 decode 为 `stageLabel`，不返回 affinity 数值） |
| `chat.send` | `{text≤500, clientMsgId?}` | `{id,reply:{text≤80,parts≤2},act?,fx?,moodWord,latencyMs,firstSentence,fallback?}`；**act/fx 服务端白名单**（仅已实现动作名，LLM 不得任意指定）；text/parts 长度校验，越界 400 |；失败 `{ok:false,error:{code},reply:<21字池短句>,fallback:true}` |
| `chat.history.get` | `{limit≤100,before?}` | `[{id,at,role:'user'|'her',text,kind}]`（仅聊天内容，无 DSH 原文/路径） |
| `chat.history.clear` | `{confirm:true}` | `{ok,cleared:n}` |
| `memory.list` | `{limit≤50,offset?}` | `[{id,at,kind,text≤80摘要,importance,source}]`（`sensitivity=high` 不返回） |
| `memory.delete` | `{id}` | `{ok}`（软删） |
| `memory.forget` | `{query}` | `{ok,deleted:n}`（模糊删） |
| `memory.clear` | `{confirm:true}` | `{ok,cleared:n}`（硬清空；关系回 R1 不惩罚） |
| `memory.export` | `{dir?}` | `{ok,exported:true,basename?}`（P2；仅本地；**不返回绝对 path**，排除 high/路径/DSH 内容） |
| `chat.settings.get` | `{}` | `{enabled,consent,quietMode,frequencyPerDay,memoryEnabled,historyRetentionDays,updatedAt}` |
| `chat.settings.set` | 白名单 `{enabled?,quietMode?,frequencyPerDay?,memoryEnabled?}` | `{ok,settings}`；首次 `enabled=true` 须带 `consent:{version:'v1',at:ISO}` |

## 错误码
`400 INVALID_INPUT`、`403 CHAT_DISABLED`、`413 TEXT_TOO_LONG`、`429 BUDGET_EXCEEDED`（「今天聊太多啦，明天再聊」）、`502 LLM_FAILED`（fallback 文案）、`500 MEMORY_IO`。

## sensitivity=high（隐私红线）
- 分类：**服务端规则优先**（凭据 key/路径/他人隐私/DSH 原文特征 → 直接 high）；LLM 仅辅助打标，不作唯一依据。
- 处理：high **不落 history、不落 memory 原文、不返回 UI、不可查/导出**；仅内存最小摘要用于当次回复，回复后丢弃；日志只记 `{len,hasHigh:true}`，禁原文。
- `memory.text` 服务端脱敏 + 限长 ≤80 字摘要，禁路径/key/DSH 原文/他人隐私；用户不可见 high 摘要。

## TTL / 清理
- 聊天历史默认保留 **90 天**（`historyRetentionDays` 可配，最小 7）；到期滚动删除，仅本地。
- memory ≤200 环形；90 天未引用降权（排序衰减不删除）；`memory.clear{confirm:true}` 硬清空。
- `clearHistory` 与 `clearMemory` 分开、均需 confirm；清空后关系回 **R1**（不惩罚、不重置 enable）；不重启 host。
- 关系阶段 R0 陌生/R1 熟悉/R2 亲近/R3 依赖，由聊天互动累计驱动；不显示数值压力。

## 生成边界
- 存本地；生成时仅发送「用户输入 + 必要记忆摘要」给当前 LLM；**不发 DSH 原文/工具参数/文件/路径/key**；不用于训练/其他用途。
- LLM：宿主 `ctx.llm`，3s 超时；失败/超预算 → 短句池（`fallback:true`）；复用 ¥1/天预算，计入 `petLlmCostYuan`。

## mock harness
`node scripts/chat-harness.mjs --mock [--port 3099]`：
- 默认 `enabled=false` → 所有方法返回 `403 CHAT_DISABLED/pending`；
- mock LLM 固定回复 + 可注入 `LLM_FAILED`/`BUDGET_EXCEEDED`；**不写盘、不调真 LLM、不造持久历史/记忆**（临时内存，退出即清）；
- 仅 dev 用，不进用户文档；不碰真实 pet-work。


## 契约测试（P1 条件，`scripts/test-chat-backend.mjs` 覆盖）
1. `high` 内容：不落 history/memory、不返回 UI、不可导出；日志无原文。
2. `enabled=true` 首次必须带 `consent{version,at}`，缺失 400。
3. TTL 清理（>historyRetentionDays）、`clearHistory`/`clearMemory` 分离且需 confirm、清空后关系 R1。
4. `chat.enabled=false` → 所有方法 403 `CHAT_DISABLED`。
5. mock harness 不写盘：运行后无新增/修改 `memory.json`/`chat-history.json`/`chat-settings.json`，退出即清。
6. `memory.export` 响应不含绝对路径。
7. `chat.send` 的 act/fx 仅白名单；非白名单→剔除或 400（按实现），text/parts 越界→400。


## act/fx/expression 词表（vocabulary 唯一真源）

> **唯一真源：`deliverables/pet-integration/docs/vocabulary.draft.json`**（ACT/FX/EXPRESSION/BUBBLE 分开声明）。
> 本契约不再内联清单；生成物 `docs/generated/act-fx-whitelist.json` 仅作兼容视图：
> `acts` = vocabulary.ACT_WHITELIST（28）；`fx`（兼容字段名 v1）= vocabulary.EXPRESSION_WHITELIST（14）。
> 代码新逻辑一律读 vocabulary：ACT=28、FX=7、EXPRESSION=14、BUBBLE=独立白名单；校验 key 必须 ∈ 对应集合。
> **一致性比较口径（v1.2）**：vocabulary v1.2 起提供平铺字段 `ACT_ALL`(28)/`EXPRESSION_ALL`(14)/`FX_ALL`(7)/`BUBBLE_ALL`；校验器以 `*_ALL` 为比较口径（嵌套仅供展示）。兼容视图 `whitelist.acts = ACT_ALL(28)`、`whitelist.fx = EXPRESSION_ALL(14)`；`--check` 按此对比。

> 由 `scripts/gen-act-fx-whitelist.mjs` 从 manifest 17 clips + 11 composites + 29 §7 的 14 表情生成；`--check` 防漂移。以下为生成器说明，实际清单以 JSON 为准。
- `FX`/`EXPRESSION`：**以 vocabulary 唯一真源为口径**（`FX_ALL`=7 个基础 FX、`EXPRESSION_ALL`=14 个表情）；本契约不再内联名单，代码不使用 `whitelist.fx` 兼容视图。
- `ACT_ALL`=28（manifest actions 17+composites 11）、`EXPRESSION_ALL`=14、`FX_ALL`=7；校验一律按 `*_ALL` 平铺字段，兼容视图仅展示。
- `chat.send.reply.act/fx` 仅接受上述集合；非法值丢弃并记 `chat act/fx rejected`，不报错。
- `moodWord` 仅 `开心|平静|有点低落`（由 companion.words.mood 派生）。

## v1.1 测试补充
- RPC 路径 `/pet-bridge-ui/chat/rpc` 与页面 `/pet-bridge-ui/chat` 不冲突（GET/POST 分离可验证）。
- act/fx 非白名单值丢弃（响应不含非法名）。
- `consent` 形状为 `{version:'v1',at:ISO}` 或 null（不是布尔）。

- 契约测试保留：`node scripts/gen-act-fx-whitelist.mjs --check`（whitelist 与 manifest 漂移即失败）。
