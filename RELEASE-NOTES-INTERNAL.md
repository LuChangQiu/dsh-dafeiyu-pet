# RELEASE-NOTES-INTERNAL — 内部发行说明（大肥鱼桌宠）

> 内部/朋友分发用；不含 secret/绝对路径配置。正式外发前按 `INSTALL.md` 三步安装。

## 2026-10 批次（窗口后合并）

### 登录后自动启动（修复：ONCE 任务重启后不自启）
- `install/install.ps1` 改为注册 **AtLogOn** 计划任务 `DafeiyuPetStart`：
  - 当前用户（Interactive）、**LIMITED** 权限、登录后 **延迟 30s** 拉起；
  - 动作指向 `pet-work\tools\start-pet.ps1`（源码布局）；packaged 布局由自检修复注册指向 exe；
  - 旧 ONCE/其它触发器任务会先删除再建（幂等，不重启系统）；
  - **按需启动仍可用**：`schtasks /Run /TN DafeiyuPetStart`（面板/快捷方式）。
- `scripts/selfcheck.ps1`：
  - 任务检查新增**触发器类型校验**：解析 `schtasks /Query /XML` 的 `<LogonTrigger>` 与 `<Delay>`；
    非 Logon → issue `task-trigger-not-logon`；延迟非 30s → warn `task-trigger-delay`；
  - `-Repair` 会重新注册 AtLogOn（当前用户/LIMITED/30s）。
- 关闭/删除自动启动（用户可自行操作，不改桌宠本体）：
  ```powershell
  schtasks /Change /TN DafeiyuPetStart /DISABLE   # 临时关闭
  schtasks /Delete /TN DafeiyuPetStart /F         # 彻底删除
  ```
- 兜底：自动启动失效时仍可手动 `pet-work\tools\start-pet.ps1`（或双击发行包 exe）。

### 其他（本批次）
- 发行 zip 内置 `INSTALL.md` + `selfcheck.ps1`（解压→自检→启动）；
- 鲸鱼娘资产随包、构建自检；行为层（反应延迟/打断恢复/走神）与状态诚实化（卡住/失败/等待）分支待窗口后合并；
- 窗口后合并顺序见 `verify/MONDAY-MERGE-PLAN.md`（以 Lead 最终版为准）。

### 自测：登录自启（无需真实 pet-work；不碰真实任务/不重启/不拉起任何桌宠进程）
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-logon-autostart.ps1
```
- 测试使用临时任务 `DafeiyuPetStartTest` + 临时**无害动作脚本**（只写 marker 后 exit 0）+ 临时 **PetWorkDir**（`tools\start-pet.ps1` stub 只写 marker，绝不启动桌宠）；
  断言 LogonTrigger/PT30S/LIMITED、`/Run` marker+LastTaskResult=0、selfcheck 正/反样本、`-Repair` 重注册，并断言 **无新增 pet 进程**；
  结束后删除临时任务/动作脚本/marker/临时 PetWorkDir。
- 注册/修复前会导出旧任务 XML 到 `%TEMP%\DafeiyuPetStart-*-backup-*.xml`；注册失败自动从备份恢复并记录日志。
  备份 XML 默认保留在 `%TEMP%` 便于审计，可手动清理（P3）。

### 已知限制
- 计划任务为**当前用户**登录触发；换用户登录/远程桌面会话不会重复拉起（单实例管道保证只有一个桌宠）。
- 若策略禁止创建计划任务：自检会报 `task-missing`/`task-trigger-not-logon`，可手动启动或由管理员预置任务。
- Monday 窗口仍按"手动 `start-pet.ps1`"兜底，不依赖自启。
