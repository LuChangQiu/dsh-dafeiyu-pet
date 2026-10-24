# INSTALL — 大肥鱼桌宠安装 / 自检 / 回滚（同事三步版）

> 面向拿到发行包的同事；开发/源码模式见 `README.md`、`docs/INSTALL-STRATEGY.md`。
> 一键自检脚本：`scripts/selfcheck.ps1`（检查六项，支持 `-Repair` 幂等修复）。
> 本文件与脚本在分支 `feat/installer` 交付；窗口后由 Lead 批准合并到 main。

## 1. 三步安装

### 第 1 步：解压（免 Python 发行包）
把 `dafeiyu-pet-win64-<version>.zip` 解压到固定目录，例如：

```
%USERPROFILE%\pet-work\
  └─ dafeiyu-pet-win64-<version>\
       ├─ 大肥鱼桌宠.exe      ← 直接双击即可启动（免 Python）
       └─ _internal\...        ← 运行时/资源（含 _internal\assets\whale-girl）
```

> 只想快速看桌宠：双击 `大肥鱼桌宠.exe` 即可。
> 要与 DSH 联动（插件/管理面板），需要把发行包放到 `pet-work` 布局并安装 DSH 插件（见第 2/3 步与 `README.md`）。

### 第 2 步：自检
在仓库根目录运行（PowerShell 5.1 或 7）：

```powershell
# 正式安装（自动发现 DSH profile 与 pet-work；无 Python 时 pet-work 用发行包布局）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\selfcheck.ps1 -Human

# 如果 pet-work 在自定义路径
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\selfcheck.ps1 `
  -PetWork "$env:USERPROFILE\pet-work" -Human
```

输出 JSON：`{healthy, issues[], repairs[], checks, needRestart}`；`healthy=true` 表示可交付。
无错误但有 `warn`（如“已安装插件缺 repo 新文件”）说明可用、建议更新插件。

### 第 3 步：启动并验证
```powershell
# 启动（幂等；已在跑则直接返回）
powershell -NoProfile -ExecutionPolicy Bypass -File pet-work\tools\start-pet.ps1

# 验证：管道 ping 应返回 {"ok":true,...,"reply":"pong"}
node pet-work\tools\pet-cmd.mjs ping
```
- 桌宠窗口标题应为「大肥鱼桌宠」，形象为 **2D 鲸鱼娘**（非 classic 皮肤）。
- DSH 联动：重启 `dsh web` 后，设置页出现管理面板（插件由 DSH 加载）；桌宠由插件/计划任务拉起。

## 2. 自检脚本用法（scripts/selfcheck.ps1）

| 参数 | 默认 | 说明 |
|---|---|---|
| `-RepoRoot` | 脚本父目录 | 仓库根（一般不用传） |
| `-PetWork` | `$env:DAFEIYU_PET_WORK` → 仓库同级 `pet-work` → 仓库内 `pet-work` | 运行时目录（含 `.venv` / `pet/` / `tools/`） |
| `-ProfileDir` | `$env:DSH_HOME` 或 `%USERPROFILE%\.dsh` + `profiles\web` | DSH profile（插件 node_modules 与 cordis.patch.yml 所在） |
| `-TaskName` | `DafeiyuPetStart` | 开机启动计划任务名 |
| `-PatchFile` | `<ProfileDir>\cordis.patch.yml` | DSH patch 文件 |
| `-Repair` | 关 | 执行幂等修复：重装插件包 / 重建 venv / 重注册计划任务 / 拉起桌宠（**默认需加 `-Yes` 确认**） |
| `-DryRun` | 关 | 配合 `-Repair`：只打印/记录将执行的动作，**零写入** |
| `-Sandbox` | 关 | 配合 `-Repair`：强制沙盒（不复制插件、不建/改 venv、不注册任务、不拉起 pet），仅校验；可安全用于真实路径演练 |
| `-Yes` | 关 | 明确确认真实修复（会写 profile/venv/计划任务，可能拉起桌宠） |
| `-Human` | 关 | 先打印人类可读摘要，再输出 JSON |
| `-SkipPipeProbe` | 关 | 只检查管道存在，不执行 pet-cmd ping |

**检查六项**（对齐 `docs/INSTALL-STRATEGY.md`）：
1. `plugin`：profile `node_modules` 下 server（`dsh-pet-bridge-v*`）与 ui 包是否完整（防 `pnpm install` 清理）；额外文件缺失记 warn（需重装新版）；
2. `venv`：`pet-work/.venv/Scripts/python(w).exe` 存在且能 `import PySide6, requests`；
3. `task`：计划任务 `DafeiyuPetStart` 已注册、未禁用、指向存在的 `start-pet.ps1`；
4. `pipe`：命名管道 `\\.\pipe\dafeiyu-pet-whale-single-instance` 可达、桌宠进程存在、`ping=pong`；
5. `patch`：`cordis.patch.yml` 中 pet-bridge / pet-bridge-ui 块状态（`mounted` / `unmounted` / `partial` / `missing-blocks`）；**只读，不自动改 patch**；
6. `versions`：repo `plugin/server|client` 版本 vs 已安装包；生产 `pet/桌宠.py` vs repo 源码 SHA256（drift 检测）；读取 `bridge-state-v2.json` 的 version/petVersion 供参考。

**退出码**：`0` = healthy；`1` = 有 error。可直接用于安装脚本/CI。

### 修复安全闸门（重要）

- **默认必须显式 `-Yes`**：`selfcheck.ps1 -Repair` 直接运行会以退出码 2 拒绝，并给出 `repair-needs-confirm` 说明（会写 profile/venv/计划任务、可能拉起 pet）；
- **先演练**：`-Repair -DryRun`（只计划，零写入）或 `-Repair -Sandbox`（强制沙盒，零写入/零进程，可对真实路径做 scope 校验）；
- 幂等：重复 `-Repair -Yes` 不会重复破坏；插件重装前会备份到包内 `.selfcheck-backup-<ts>`；
- 不触碰 `config.json` / `ui-config.json` / `memory` / `logs` / 用户对话数据；patch 仅提示、不自动改。

### -Repair 行为（幂等，不覆盖用户数据）
- 插件包不完整/落后 → 从 `repo/plugin/server|client` 重装，先备份旧文件到包内 `.selfcheck-backup-<时间戳>`；
- venv 缺失/损坏 → `python -m venv` + `pip install -r pet/requirements.txt`；
- 计划任务缺失/指向失效 → 重新注册指向 `start-pet.ps1`；
- 管道不可达 → 执行 `start-pet.ps1` 拉起桌宠（不强杀已在跑的进程）；
- patch 异常 → 仅提示，不自动改（挂载/回滚走 `docs/MOUNT-PROTOCOL.md` 与 `scripts/mount-check.ps1`）；
- 不触碰 `config.json` / `ui-config.json` / `memory` / `logs` / 用户对话数据。

## 3. 常见问题（FAQ）

| 现象 | 原因 | 处理 |
|---|---|---|
| Windows 提示「已保护你的电脑」/SmartScreen | 未签名的内部发行包 | 点「更多信息 → 仍要运行」；内部分发可接受；正式外发前考虑代码签名 |
| 杀软报毒/拦截 exe | PyInstaller 引导器误报 | 加信任/白名单，或用源码模式（`python pet\桌宠.py`）；上报误报 |
| 双击 exe 没反应/一闪而过 | 缺少 VC 运行库或被拦截 | 先运行 `selfcheck.ps1` 看 `pipe-down`；用命令行启动 exe 查看报错；安装 VC++ Redistributable |
| `ping` 报 ENOENT / 管道不可达 | 桌宠未启动 / 单实例管道被占 | `start-pet.ps1 -Restart`；结束残留 `大肥鱼桌宠.exe` 后重试 |
| 窗口是 classic 皮肤不是鲸鱼娘 | 发行包漏 `assets/whale-girl`（历史 P0，已在分支修复） | 用带鲸鱼娘的 zip（`_internal/assets/whale-girl` 应存在）；`selfcheck` 无法检测皮肤，需肉眼确认 |
| 管理面板 404 | DSH 未重启/插件未安装 | 重启 `dsh web`；检查 profile node_modules 与 patch 块；运行 `selfcheck.ps1 -Repair` |
| 计划任务不存在/禁用 | 安装脚本被策略拦截/手动删了 | `selfcheck.ps1 -Repair` 重注册；或 `schtasks /Create ... start-pet.ps1` |
| `node_modules` 被 `pnpm install` 清理 | DSH 升级/重装依赖 | 重装插件包：`selfcheck.ps1 -Repair` 或 `install/install.ps1` |
| 没有 Python | 免安装 zip 已带运行时，无需 Python | 直接用 zip 内 `大肥鱼桌宠.exe`；插件自动化仍可用 |
| 插件版本与 repo 不一致（warn） | 已安装包落后于仓库 | 窗口后重装插件（需重新挂载窗口）；`-Repair` 可先复制新文件，但仍需 DSH reload 生效 |

## 4. 失败回滚

1. **停桌宠**：
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
     Where-Object { $_.CommandLine -like '*桌宠.py*' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F }
   Get-Process -Name '大肥鱼桌宠' -ErrorAction SilentlyContinue | Stop-Process -Force
   ```
2. **停止联动/卸载插件**：DSH profile 的 `node_modules` 删除 `dsh-pet-bridge-*`，并按 `docs/MOUNT-PROTOCOL.md` 用 `scripts/unmount-pet-blocks.mjs` 恢复 patch 备份（不要手改 patch）。
3. **恢复旧版本**：
   - 源码/pet：`scripts/pet-rollback.ps1` 或用 `pet-work/backup/` 备份覆盖 `pet/桌宠.py`、`pet/whale_skin.py`；
   - 插件：`scripts/plugin-rollback.ps1`（保留旧包与旧 patch 备份）；
   - 删除 `.selfcheck-backup-*` 外的临时目录，确认 `selfcheck.ps1` 回到 error=0。
4. **验证回滚**：`selfcheck.ps1 -Human` 无 error；`pet-cmd ping` = pong；DSH 正常启动（host 存活）；无残留 `pet-bridge` 进程。

## 5. 验收清单（交付前）

- [ ] zip 解压后 `大肥鱼桌宠.exe` 可启动，窗口标题「大肥鱼桌宠」，形象为鲸鱼娘（非 classic）；
- [ ] `pet-cmd ping` → `pong`；`selfcheck.ps1` → `healthy=true`（或仅 warn）；
- [ ] DSH 重启后管理面板可从设置页打开（插件安装成功，`/pet-bridge-ui/home` 未挂载时 404 / 挂载后需登录）；
- [ ] 计划任务 `DafeiyuPetStart` 已注册，重启机器后桌宠自动出现；
- [ ] 卸载/回滚步骤演练过，host 不死、无残留 bridge 块；
- [ ] 不包含：state/ui-config/memory/logs、LOCAL ONLY 素材、个人绝对路径配置。
