# INSTALL — 大肥鱼桌宠 安装 / 自检 / 回滚（zip 三步版）

> 本文件与 `selfcheck.ps1` 已随发行包提供（位于解压目录根部）；运行 `.\selfcheck.ps1` 会自动识别
> `大肥鱼桌宠.exe` 进入 **packaged 模式**：免 Python、无需仓库/venv，命名管道探测内置（不依赖外部工具）。
> 源码开发安装见文末「开发 / 源码安装」。

## 1. 三步安装（zip 用户）

### 第 1 步：解压
把 `dafeiyu-pet-win64-<version>.zip` 解压到固定目录（解压后不要把 exe 单独拖出来），例如：

```
%USERPROFILE%\pet-work\dafeiyu-pet-win64-<version>\
  ├─ 大肥鱼桌宠.exe        ← 双击即可启动（免 Python）
  ├─ INSTALL.md            ← 本文件
  ├─ selfcheck.ps1         ← 一键自检/修复（packaged 模式）
  └─ _internal\...         ← 运行时与资源（含 _internal\assets\webm_body 50 WebM + body-b 静帧）
```

### 第 2 步：自检（在**解压目录根部**运行）
打开 PowerShell，`cd` 到解压目录（即与 `大肥鱼桌宠.exe`、`selfcheck.ps1` 同级）：

```powershell
cd "$env:USERPROFILE\pet-work\dafeiyu-pet-win64-1.1.5-dsh.2-whalegirl"
powershell -NoProfile -ExecutionPolicy Bypass -File .\selfcheck.ps1 -Human
```

- packaged 模式会自动识别 `大肥鱼桌宠.exe`：**不需要 Python / venv / 仓库**；
- `venv` 项显示 packaged（免 Python），`pipe` 项用内置命名管道探测（无需 `pet-cmd`）；
- 输出 `healthy=true` 即表示桌宠本体可用；DSH 联动相关项（插件 / patch / 自启）缺失只记为 `warn`，不影响独立运行；
- 如未启动桌宠，自检会显示 `pipe-down`（先按第 3 步启动再看，或直接运行 `.\selfcheck.ps1 -Repair -Yes` 让它拉起）。

> **首次运行时桌宠尚未启动，`pipe` 可能显示 down/error，属预期**；做完第 3 步启动桌宠后，再跑一次
> `.\selfcheck.ps1 -Human` 确认 `healthy=true` 即可。

### 第 3 步：启动并验证

**zip 用户（推荐）**

```powershell
# 启动：直接双击“大肥鱼桌宠.exe”，或：
Start-Process .\大肥鱼桌宠.exe

# 验证：重跑自检，pipe 项应为 ok、healthy=true
powershell -NoProfile -ExecutionPolicy Bypass -File .\selfcheck.ps1 -Human
```

**源码 / 开发安装（从仓库运行，见第 5 节）**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File pet-work\tools\start-pet.ps1
node pet-work\tools\pet-cmd.mjs ping    # 期望 {"ok":true,...,"reply":"pong"}
```

验收点（两种模式相同）：
- 窗口标题「大肥鱼桌宠」，形象为 **2D 鲸鱼娘**（非 classic 皮肤）；
- 自检 `pipe` 项 ok（zip 用户）；源码模式 `pet-cmd ping` 返回 `pong`；
- DSH 联动（可选）：重启 `dsh web` 后设置页出现管理面板（需先安装插件；zip 自检只做只读检查，插件安装见发布说明）。

## 1.1 登录后自动启动（Windows 计划任务）

- 安装脚本（源码布局）注册计划任务 `DafeiyuPetStart`：**当前用户登录后延迟 30s 自动拉起桌宠**（LIMITED 权限）；
  packaged 布局由自检修复注册为指向 `大肥鱼桌宠.exe` 的同款 AtLogOn 任务。
- 自检会校验触发器必须为 **Logon**：不符会显示 `task-trigger-not-logon`（重启后不会自启）；
  可用 `.\selfcheck.ps1 -Repair -Yes` 重新注册（AtLogOn / 30s / LIMITED）。
- 不需要自动启动时可自行关闭/删除（不影响桌宠本体与手动启动）：
  ```powershell
  schtasks /Change /TN DafeiyuPetStart /DISABLE   # 临时关闭（登录不再自动启动）
  schtasks /Delete /TN DafeiyuPetStart /F         # 彻底删除
  ```
- 手动兜底：双击 `大肥鱼桌宠.exe`；源码模式 `pet-work\tools\start-pet.ps1`。
  按需启动（不依赖登录）：`schtasks /Run /TN DafeiyuPetStart`。

## 2. 自检脚本用法

| 场景 | 命令 |
|---|---|
| zip 解压（packaged） | `powershell -NoProfile -ExecutionPolicy Bypass -File .\selfcheck.ps1 -Human` |
| 源码仓库 | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\selfcheck.ps1 -Human` |

| 参数 | 默认 | 说明 |
|---|---|---|
| `-RepoRoot` | 脚本父目录 | 源码模式仓库根；packaged 模式自动退回解压目录（一般不用传） |
| `-PetWork` | packaged：解压目录；源码：`$env:DAFEIYU_PET_WORK` → 仓库同级/仓库内 `pet-work` | 运行时目录 |
| `-ProfileDir` | `$env:DSH_HOME` 或 `%USERPROFILE%\.dsh` + `profiles\web` | DSH profile（插件 / patch 位置） |
| `-TaskName` | `DafeiyuPetStart` | 开机启动计划任务名（zip 模式指向 exe，源码模式指向 start-pet.ps1） |
| `-PatchFile` | `<ProfileDir>\cordis.patch.yml` | DSH patch 文件 |
| `-Repair` | 关 | 幂等修复：zip 模式可注册 exe 自启/拉起桌宠/更新插件；源码模式重装插件/重建 venv/重注册任务/拉起桌宠（**默认需加 `-Yes` 确认**） |
| `-DryRun` | 关 | 配合 `-Repair`：只打印/记录将执行的动作，**零写入** |
| `-Sandbox` | 关 | 配合 `-Repair`：强制沙盒（不复制插件、不建/改 venv、不注册任务、不拉起 pet），仅校验 |
| `-Yes` | 关 | 明确确认真实修复（会写 profile / venv / 计划任务，可能拉起桌宠） |
| `-Human` | 关 | 先打印人类可读摘要，再输出 JSON |
| `-SkipPipeProbe` | 关 | 只检查管道存在，不执行 ping 探测 |

**检查六项**：
1. `plugin`：profile `node_modules` 下 server（`dsh-pet-bridge-v*`）与 ui 包完整性（防 `pnpm install` 清理）；
2. `venv`：源码模式检查 `pet-work/.venv` + `PySide6/requests`；**packaged 模式自动跳过（免 Python）**；
3. `task`：计划任务 `DafeiyuPetStart` 已注册/未禁用/目标存在（兼容 exe 与 start-pet.ps1）；
4. `pipe`：命名管道可达、桌宠进程存在、ping=pong（packaged 用 .NET 管道探测，源码用 `pet-cmd`）；
5. `patch`：`cordis.patch.yml` 内 pet-bridge / pet-bridge-ui 块状态（mounted/unmounted/partial/missing-blocks）；**只读，不自动改**；
6. `versions`：源码模式比较 repo 插件/生产 pet 源码版本；packaged 模式降级为信息项。

**退出码**：`0` = healthy；`1` = 有 error。输出 JSON 含 `healthy / issues / repairs / checks / mode / packaged`。

### 修复安全闸门（重要）
- **默认必须显式 `-Yes`**：`selfcheck.ps1 -Repair` 直接运行会退出码 2 并提示 `repair-needs-confirm`；
- **先演练**：`-Repair -DryRun`（只计划）或 `-Repair -Sandbox`（强制沙盒，零写入/零进程）；
- 幂等：重复 `-Repair -Yes` 不会重复破坏；插件重装前备份到包内 `.selfcheck-backup-<ts>`；
- 不触碰 `config.json` / `ui-config.json` / `memory` / `logs` / 用户对话数据；patch 仅提示、不自动改。

## 3. 常见问题（FAQ）

| 现象 | 原因 | 处理 |
|---|---|---|
| Windows 提示「已保护你的电脑」/SmartScreen | 未签名内部发行包 | 「更多信息 → 仍要运行」；正式外发前可考虑代码签名 |
| 杀软报毒/拦截 exe | PyInstaller 引导器误报 | 加信任/白名单；源码模式可 `python pet\桌宠.py` |
| 双击 exe 没反应/一闪而过 | 缺少 VC 运行库或被拦截 | 在解压目录运行 `.\selfcheck.ps1` 看 `pipe-down`；命令行启动 exe 看报错；安装 VC++ Redistributable |
| `selfcheck` 报 `pipe-down` | 桌宠未启动 / 单实例管道被占 | 先启动 `大肥鱼桌宠.exe`；或 `.\selfcheck.ps1 -Repair -Yes` 拉起；结束残留 exe 后重试 |
| 看不到 B 角色 | B 素材缺失（历史 P0，已修复） | 用 B-only zip（`_internal/assets/webm_body/assets` 应有 50 个 webm） |
| 管理面板 404 | DSH 未重启/插件未安装 | 重启 `dsh web`；检查 profile node_modules 与 patch 块；`.\selfcheck.ps1 -Repair -Yes` 可更新插件（zip 模式若包内无插件源码则需重装发行包） |
| 计划任务不存在/禁用 | 安装脚本被策略拦截/手动删了 | `.\selfcheck.ps1 -Repair -Yes` 重注册（packaged 指向 exe；源码指向 start-pet.ps1） |
| `node_modules` 被 `pnpm install` 清理 | DSH 升级/重装依赖 | 源码模式：`scripts\selfcheck.ps1 -Repair -Yes` 或 `install/install.ps1` |
| 没有 Python | 免安装 zip 已带运行时 | zip 用户无需 Python；`.\selfcheck.ps1` 自动 packaged 模式 |
| 插件版本与 repo 不一致（warn） | 已安装包落后于仓库 | 源码模式重装插件；zip 模式用新发行包/安装说明更新 |

## 4. 失败回滚

- **zip 用户**：结束桌宠进程后，**直接删除解压目录即可**（不含 DSH 配置；如另装了 DSH 插件，按下方源码方式卸载插件）。
- **源码安装**：
  1. 停桌宠：
     ```powershell
     Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
       Where-Object { $_.CommandLine -like '*桌宠.py*' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F }
     Get-Process -Name '大肥鱼桌宠' -ErrorAction SilentlyContinue | Stop-Process -Force
     ```
  2. 停止联动/卸载插件：DSH profile `node_modules` 删除 `dsh-pet-bridge-*`，按 `docs/MOUNT-PROTOCOL.md` 用 `scripts/unmount-pet-blocks.mjs` 恢复 patch 备份（不要手改 patch）；
  3. 恢复旧版本：`scripts/pet-rollback.ps1` / `pet-work/backup/` 备份 / `scripts/plugin-rollback.ps1`；
  4. 验证：`scripts\selfcheck.ps1 -Human` 无 error；`pet-cmd ping` = pong；DSH 正常启动。

## 5. 开发 / 源码安装（从仓库）

```powershell
# 仓库根；先 dry-run 验证（零写入）
powershell -NoProfile -ExecutionPolicy Bypass -File install\install.ps1 -DryRun
# 正式安装：释放 plugin server/client、pet/、scripts/→pet-work\tools，尝试注入 B 50 WebM
powershell -NoProfile -ExecutionPolicy Bypass -File install\install.ps1 -BSource "D:\path\to\webm_pet"
# 若安装时未注入 B：手动补（DestPet 指向 pet-work\pet）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-b-assets.ps1 -DestPet "$env:USERPROFILE\pet-work\pet" -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-b-assets.ps1 -DestPet "$env:USERPROFILE\pet-work\pet"
# 启动/自检
powershell -NoProfile -ExecutionPolicy Bypass -File pet-work\tools\start-pet.ps1
node pet-work\tools\pet-cmd.mjs ping
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\selfcheck.ps1 -Human
```
- 源码模式需要 `pet-work\.venv`（PySide6/requests）与 `pet-work\pet` 源码；B 50 WebM 不入 git，必须 `fetch-b-assets.ps1` 注入（无 B 源时 B 静帧回退）。
- 构建发行包：`packaging\build-b-only.ps1 -Build`（repo 内完成根级 LICENSE/NOTICE/README/INSTALL/selfcheck + UTF-8 zip；不再依赖仓外后处理）。
- 本文件在仓库与发行包中保持一致（构建时复制到 app 根）。

## 6. 验收清单（zip 用户）

- [ ] 解压后 `大肥鱼桌宠.exe` 可启动，窗口标题「大肥鱼桌宠」，形象为鲸鱼娘（非 classic）；
- [ ] 首次流程：**先启动桌宠 → 再运行 `.\selfcheck.ps1 -Human` → `healthy=true`**（未启动时 `pipe-down` 属预期）；
- [ ] 解压目录运行 `.\selfcheck.ps1 -Human` → `healthy=true`、`pipe` ok（或仅 DSH 联动项 warn）；
- [ ] 可选：`.\selfcheck.ps1 -Repair -Yes` 注册开机自启（packaged 模式下任务指向 exe）；
- [ ] 登录自启：`DafeiyuPetStart` 触发器为 AtLogOn（延迟 30s、LIMITED）；不需要时可关闭/删除（命令见 §1.1）；
- [ ] DSH 联动（可选）：重启 `dsh web` 后设置页出现管理面板；
- [ ] 回滚：停进程后删除解压目录即可；已装插件按源码方式卸载；
- [ ] 不包含：state/ui-config/memory/logs、LOCAL ONLY 素材、个人绝对路径配置。

> 源码模式：若缺 B 素材，先执行 powershell -File scripts\\fetch-b-assets.ps1（从 npm/Release/本地 pet-work 注入 50 段 WebM）。

