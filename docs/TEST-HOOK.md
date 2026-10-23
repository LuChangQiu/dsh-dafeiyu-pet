# TEST HOOK 样例（v49，默认关，仅验收用）

启用（任选其一）：

1. patch：`testHookFile: '<此目录>\active.json'`（改完触发 reload）；
2. ui-config.json 动态开关：`"testHook": {"file": "<此目录>\\active.json"}`（1.5s 内生效，无需 reload）。

触发：把任一 sample 内容覆盖写入 `active.json`（内容变化才触发一次；每类动作间隔 1.5s 轮询）：

- usage：合成一次 user 角色 usage（默认 42000 tokens → 触发偷吃/白饭/费用统计）
- state：按 states 序列 setStatus（间隔 stepMs）
- report：强制走报账生成路径（LLM 成功用 LLM，失败池兜底）
- approval：触发一次审批演出（兼容旧类型）

清理：`active.json` 删除或 ui-config 改 `"testHook": {"file": ""}`；生产环境请保持关闭。
隐私：hook 只注入计数/状态枚举，不含对话原文/路径/key。
