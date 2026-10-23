# AGENTS.md — 给 DSH / AI Agent 的安装与操作说明

> 本仓库是「大肥鱼桌宠 × DSH 联动」单仓产品：桌宠源码（`pet/`）+ DSH host 插件（`plugin/server`）+ 管理面板（`plugin/client`）+ 安装脚本（`install/`、`scripts/`）。
> 用户克隆本仓库后，**你（Agent）应当按本文件步骤完成安装、验证与排障**。面向人的说明见 `README.md`。

## 1. 目标状态（装完应满足）

1. DSH profile 的 `cordis.patch.yml` 里有 `pet-bridge-v*` 与 `pet-bridge-ui` 两个 insert 块；
2. `node_modules` 里有对应的 server 包与 `dsh-pet-bridge-ui` 包；
3. `%USERPROFILE%\pet-work\pet` 存在本仓 `pet/` 的源码副本，且桌宠进程在运行（命名管道 `\\.\pipe\dafeiyu-pet-whale-single-instance` 可连）；
4. 重启 `dsh web` 后：设置页出现「大肥鱼联动」面板，`http://127.0.0.1:<host-port>/pet-bridge-ui/home` 可打开（需要 DSH 登录态）；
5. 本机有 Python 3.11+ 时优先用源码 + venv 启动；没有 Python 时回退 GitHub Release 的免安装 zip。

## 2. 安装步骤（Windows / PowerShell）

```powershell
# 0) 前置：DSH 已安装并可运行（`dsh web`），Node 22+
cd <仓库根目录>

# 1) 执行一键安装：复制插件包、写 patch（server+UI 两块）、释放 pet/ 到 %USERPROFILE%\pet-work\pet
powershell -NoProfile -ExecutionPolicy Bypass -File install\install.ps1

# 2) 重启 DSH web（安装新插件必须重启一次；完成后不要再频繁重启）
#    先停掉正在运行的 dsh web，然后重新执行 dsh web
dsh web
```

> 注意：`install.ps1` 会做 patch 写入与占位符替换；如果失败，先看脚本输出的 `FAILED:` 行，再按第 6 节排障。

## 3. 安装后验证（逐项打勾）

```powershell
# 3.1 patch 两个块都在（应有 2 处 insert id）
Select-String -Path "$env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml" -Pattern 'pet-bridge'

# 3.2 插件包已复制
Get-ChildItem "$env:USERPROFILE\.dsh\profiles\web\node_modules" -Directory | Where-Object Name -like 'dsh-pet-bridge*'

# 3.3 桌宠进程与管道
Get-Process pythonw -ErrorAction SilentlyContinue | Where-Object MainWindowTitle -match '大肥鱼'
node scripts\pet-cmd.mjs "ping"        # 期望返回 {"ok":true,...}

# 3.4 状态文件（插件运行时每 5s 落盘）
Get-Content "$env:USERPROFILE\pet-work\bridge-state-v2.json" -TotalCount 5
```

全部通过后，到 DSH Web → 设置 → 「大肥鱼联动」查看实时状态与配置。

## 4. 常用操作

| 操作 | 命令 / 位置 |
|---|---|
| 启动/重启桌宠 | 面板「重启桌宠」；或 `powershell -File scripts\start-pet.ps1 -Restart` |
| 停止联动 | 面板「停止联动」；或 `scripts\plugin-rollback.ps1`（彻底卸载） |
| 看状态 | `%USERPROFILE%\pet-work\bridge-state-v2.json`；面板「实时状态」 |
| 看日志 | `%USERPROFILE%\pet-work\evidence\pet-bridge-main.log`；面板「查看日志」 |
| 桌面端主页 | DSH 设置页「打开大肥鱼主页」→ `/pet-bridge-ui/home` |

## 5. 卸载

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\plugin-rollback.ps1
# 若需要连桌宠目录一起清理，再删 %USERPROFILE%\pet-work（先确认不是别的东西）
```

卸载脚本会用 glob 清理所有 `dsh-pet-bridge*` 包、精准移除 patch 的两个块，并校验无 `pet-bridge` 残留。

## 6. 排障顺序（先证据后动作）

1. **面板不出现**：确认 patch 两块都在、`node_modules` 里两个包都在、`dsh web` 已重启；看 host 日志有无插件加载错误。
2. **桌宠不启动**：`scripts\start-pet.ps1 -Check` 看原因；检查 `%USERPROFILE%\pet-work\pet` 是否存在、Python 3.11+ 是否可用、venv 是否创建成功。
3. **能启动但没联动**：`node scripts\pet-cmd.mjs "ping"` 测管道；看 `bridge-state-v2.json` 的 `host/pet/pipe` 与 `status`；确认插件版本一致。
4. **报账/文案异常**：看日志里 `llm lines ok` / `llm lines fallback`；预算/上限在 `ui-config.json`。
5. **需要回滚**：`scripts\plugin-rollback.ps1`；桌面端另有 `scripts\pet-rollback.ps1`。

## 7. 纪律（Agent 必读）

- 不要修改 DSH 自身的源码/配置；只通过 `install.ps1` 写本插件相关的 patch 块。
- 不要提交/复制任何含 API key、绝对路径、对话原文的文件；本仓 `.gitignore` 已排除运行时文件。
- 不要在未验证的情况下重启 DSH host；插件改动优先用 patch reload（安装/升级插件才需要重启一次）。
- 任何"替用户点确认/发消息/改文件"的能力都没有也不要做；本插件只观察与表演。
