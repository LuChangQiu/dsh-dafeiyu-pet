# MOUNT-PROTOCOL —— 桌宠插件"默认不挂载，验证后才挂载"的发布协议

> 背景：v49 因为一个漏掉的 import（`modeAllowsAct`）在 long-task 计时器里抛 `ReferenceError`，
> DSH host 的 `fatal uncaught exception` 直接退出。**插件在宿主内运行 = 插件的任何未捕获异常都可能杀死整个 DSH。**
> 用户明确要求：**平时 DSH 不挂载桌宠插件；开发、校验、测试都在外部完成；验证没问题、需要看效果时才临时挂载。**
> 本协议是硬约束。任何"先挂上去试试/边改边看"的做法一律禁止。

## 0. 默认状态：UNMOUNTED

- `cordis.patch.yml` 里 `pet-bridge-v*` 与 `pet-bridge-ui` 两个 insert 块**默认被注释掉**。
- DSH 与其它插件正常运行，桌宠插件不加载。
- 桌宠 Python 进程可以独立运行（不依赖 DSH），但没有任何联动。
- 挂载只发生在"挂载窗口"（见 §4），窗口结束**默认重新卸载**，除非该版本被批准长期运行。

## 1. 开发循环（全程不挂载）

1. 只在 **repo（`E:\project\AI提效\tool\dsh-dafeiyu-pet-repo`）** 改代码；**绝不直接改 `profiles\web\node_modules\dsh-pet-bridge*` 里的文件**（那是"运行中代码"，改它等于热改生产）。
2. 本地校验（全部通过才继续）：
   ```powershell
   cd E:\project\AI提效\tool\dsh-dafeiyu-pet-repo
   node scripts/test-plugin-imports.mjs     # 新增：本地模块 import 完备性（防 ReferenceError）
   node --check plugin/server/lib/index.js
   npm run lint
   node scripts/test-mode.mjs; node scripts/test-team-view.mjs; node scripts/test-pricing.mjs
   node scripts/test-text-fmt.mjs; node scripts/test-tool-types.mjs
   node scripts/validate-profile.mjs --patch <staged-patch>   # 若改 patch
   node scripts/audit-privacy.mjs --dir <pet-work>
   ```
3. 独立隔离验证（不挂 DSH）：
   - `scripts/harness/`（如已有）用 mock ctx 喂事件，验证插件逻辑/异常路径；
   - 至少覆盖：`act`/`say`/长任务计时器/团队刷新/模式门控/管道断开/DEAD 事件。
4. 提交：工作区 clean、commit hash 固定；把 diff + 校验输出发 **options-reviewer**，得到 **APPROVED**。
5. 由 commit 构建**新的暂存包**（新目录名，如 `dsh-pet-bridge-v491`）：
   - 复制当前运行包 → 覆盖 `lib/*.js`（来自 repo）→ `package.json` 升版本 → `node --check` + hash 对比；
   - **绝不覆盖正在运行的包目录**。

## 2. 挂载窗口（只有已验证版本可以）

前置条件（缺一不可）：
- [ ] repo 工作区 clean，`TARGET_COMMIT` 已记录；
- [ ] `test-plugin-imports` / lint / 单测 / privacy 全过；
- [ ] options-reviewer 已 APPROVED（审查包含 diff、校验输出、回滚方案）；
- [ ] 已备份 patch 与旧插件包；
- [ ] 用户/Lead 同意进入挂载窗口（默认窗口 ≤ 30 分钟）。

挂载步骤（不允许边改边挂）：
1. `node tools/safe-patch.mjs --id pet-bridge-v49 --replace ...` 或本仓库 `scripts/safe-patch.mjs` 把 id/name 切到新包（**备份 + js-yaml 校验 + 原子写**）；
2. 确认 `validate-profile` 通过、两个插件块各 1 个；
3. 等待 host 热加载（patchReload live），检查：
   - `loaded v新版本` / `version` / `writerId` 一致；
   - `home`/`ping` 路由正常（401）；
   - 桌宠 pipe pong；
   - 日志无 error、无 TEST HOOK；
   - host 存活 ≥ 5 分钟（观察内存/CPU/无 fatal）；
4. **窗口期间不改任何源码/配置**；需要改 → 先卸载。

## 3. 验证后：默认卸载回去

```powershell
node <pet-work>\tools\unmount-pet-blocks.mjs C:\Users\xiqi\.dsh\profiles\web\cordis.patch.yml <backupDir>
```
- 确认 patch 中激活的 `pet-bridge` id = 0；
- 确认日志出现 `disposed`，host 继续运行；
- 记录结果到 `verify/REVIEW-LOG.md`。

> 只有被批准"长期运行"的版本才保持挂载；日常开发期 DSH 保持干净。

## 4. 事故与回滚

- 插件崩溃 host → 不再重启挂载，先复现/修复（隔离环境）；修复后走 §1–§2。
- 回滚：patch 用备份原子恢复；插件包用备份目录（不删除旧包）。
- 桌宠进程与 DSH 解耦：DSH 崩溃时桌宠不消失；后续加"DSH 失联"处理（休眠/可选退出），见 issue 记录。

## 5. 已发生事故复盘（必须记住）

| 日期 | 事故 | 根因 | 已修 |
|---|---|---|---|
| 2026-10-23 | dsh web 无法启动 | patch 中 `requestFile` 重复 key | 校验器 + safe-patch 阻止 |
| 2026-10-24 | dsh web 运行中 fatal 退出（两次） | v49 漏 import `modeAllowsAct`，long-task 计时器触发 ReferenceError | 补 import + `test-plugin-imports` 静态守护；默认不挂载 |

## 6. 桌宠与 DSH 的生命周期

- 桌宠是独立进程：DSH 退出/崩溃不会让它消失（用户已观察）。
- 目标行为：插件卸载/DSH 不在时，桌宠应进入"离线休眠"（显示失联/打盹），检测到 DSH 恢复后自动回来；是否退出进程由配置决定（默认保留，不打扰）。
