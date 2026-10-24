# DETACHED-TESTING —— 不挂载 DSH 的隔离验证（task-76）

> 前提：DSH 默认不挂载桌宠插件（MOUNT-PROTOCOL）。所有插件逻辑必须先在外部用 mock ctx 验证通过，
> 才有资格进入挂载窗口；不允许"挂上去边试边改"。

## 一键运行

```powershell
node scripts/harness/plugin-harness.mjs    # 或 npm run verify:detached
```

退出码 0=全过；1=有失败；2=环境错误。

## 覆盖（21 项断言）

- 加载/loaded、user/message、turn/start、tool/call、assistant/message(usage)、turn/end
- **长任务计时器 → act()（v49 崩溃路径：modeAllowsAct 漏 import；必须覆盖）**
- mode-request → silent 门控（act 被抑制且不崩）；resume 恢复
- approval/asked+decided、user-questions/request（sentCount）
- team/task 投影 → v2 只读 team/goal/plan/userQuestions；无 subject/description/objective
- TEST HOOK 默认关（生产 patch 无 testHookFile）
- 未知/异常事件不抛；dispose 停止定时器并写 disposed
- 隐私：v2/日志无绝对路径、无 API key 形状

## 实现

- `scripts/harness/mock-ctx.mjs`：mock cordis ctx（on/get/effect/_emit/_dispose）+ 服务（sessionProjections/agentTeams/sessions/llm）
- `scripts/harness/plugin-harness.mjs`：加载真实 `plugin/server/lib/index.js`；把定时器压缩到 ≤50ms 以便快速触发 20s ritual 内的长任务路径；临时目录隔离所有写盘。
- 注意：harness 的 run 会写临时目录（不碰生产 pet-work）。

## 接入

- `npm run verify:detached`
- preflight（scripts/preflight-check.ps1）第 7 步；失败禁止进入挂载窗口。
