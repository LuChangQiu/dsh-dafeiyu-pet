# 变更门禁与独立审查（task-70）

> 2026-10-24 起**所有改动**（代码 / 配置 / profile patch / 部署）必须走本流程。
> 目标：任何一次部署都可复现、可回滚、经独立审查；禁止"改完直接 reload"。

## 1. 唯一流程

1. **小步 commit**：改动先在 repo 内完成并 commit（中文 message，说明改了什么/为什么/证据）。
2. **本地 preflight**（只读，不部署）：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\preflight-check.ps1
   ```
   必须输出 `RESULT: PASS`；任何 FAIL 先修。
3. **组审查包**发给 `options-reviewer`（独立审查者）：
   - `git show --stat <commit>` + 关键 `git diff`
   - preflight 完整输出（含 validate-profile / lint / prettier / ruff / privacy / 单测）
   - `node scripts/validate-profile.mjs --patch <profile patch>` 输出
   - `node scripts/audit-privacy.mjs --dir <pet-work>` 输出（0 命中）
   - **部署计划**：目标包目录、patch 变更点（id 定向）、reload 触发方式、**回滚路径**（patch 备份文件 / 旧包目录保留）
   - 若涉及 profile patch：patch 备份路径 + 变更前后 `pet-bridge-vNN=1 / pet-bridge-ui=1 / YAML OK`
4. **审查通过（回复 OK）后才能部署/reload**；未审不得部署。
5. **部署后验证**并回报（loaded 行、v2 关键字段、privacy audit、pipe/timer 指标），再更新任务板。

## 2. patch 文件安全规则（事故后强制）

- **禁止手写/整文件覆盖** `cordis.patch.yml`。唯一入口：`scripts/safe-patch.mjs`：
  - `node scripts/safe-patch.mjs --id pet-bridge-vNN --replace "<old>" "<new>"`
  - `node scripts/safe-patch.mjs --id pet-bridge-vNN --set-key <key> "<yamlValue>"`
  - 流程内置：备份 → id 区间定向替换（命中次数必须 1）→ js-yaml 解析（重复 key 会失败）→ 插件块命中检查（vNN=1、ui=1）→ 失败不写/原子写失败回滚。
- **生产 patch 不得启用 `testHookFile`**（validate-profile 会 FAIL）；TEST HOOK 只能通过 `ui-config.testHook.file` 动态开启。
- 任何 patch 变更后必须 `node scripts/validate-profile.mjs --patch <path>` = exit 0。
- patch 备份命名：`cordis.patch.yml.bak-<yyyyMMdd-HHmmss>-<reason>`；回滚 = 拷回备份 + 触发 reload。

## 3. preflight 检查项（scripts/preflight-check.ps1）

| 检查             | 说明                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| validate-profile | YAML 解析（重复 key/缩进）、顶层数组、id 不重复、pet-bridge-vNN=1、pet-bridge-ui=1、name 匹配、**生产禁 testHookFile** |
| node --check     | repo 全部 JS 语法（scripts/lint.mjs）                                                                                  |
| prettier --check | plugin/**/\*.js + scripts/**/*.mjs 格式                                                                                |
| ruff（可选）     | pet/ Python 规范；未安装则 SKIP                                                                                        |
| privacy audit    | v2/events/companion/attribution/mode/state + 最新日志 0 路径/0 key                                                     |
| 单测             | tool-types / pricing / mode / privacy / team-view / text-fmt                                                           |
| git status       | 信息项：未提交改动必须在审查包中说明                                                                                   |

## 4. 事故复盘：cordis.patch.yml 重复键导致 dsh web 无法启动（2026-10-23）

- **现象**：用户连续三次启动 dsh web 失败；`dsh: failed to parse overlay`，错误定位 `cordis.patch.yml:263 duplicated mapping key (requestFile)`。
- **根因**：部署 v49 时用 PowerShell 字符串替换给 `mode` 配置块追加 `requestFile`，**未检查该 key 是否已存在**（前一次 sed 式修改已写入），产生重复 mapping key；且写文件前**没有 js-yaml 校验、没有备份、没有原子写、未走 preflight**——YAML 语法错误直接落盘，host 启动即挂。
- **修复**：Lead 手工安全恢复（取消注释两块、移除测试 hook 行、清理垃圾行、备份原 patch），`validate-profile` 校验通过；host 恢复运行。
- **预防（本门禁）**：
  1. patch 只能通过 `safe-patch.mjs` 定向改（命中次数校验 + 解析校验 + 原子写 + 失败回滚）；
  2. 每次部署前 `preflight-check.ps1` 全绿；
  3. 部署前审查包必须包含 validate-profile 输出与 patch 备份路径；
  4. 生产 patch 禁止 testHookFile（防止验收配置误入生产）；
  5. 小步 commit + 独立审查，未经 OK 不 reload。

## 5. 角色与记录

- **Lead**：批准部署、协调用户；**options-reviewer**：独立审查（verify/REVIEW-LOG.md 记录）；**bridge-dev**：实现 + preflight + 审查包 + 部署 + 验证。
- 每次审查结论记录在 `deliverables/pet-integration/verify/REVIEW-LOG.md`（reviewer 维护）。
