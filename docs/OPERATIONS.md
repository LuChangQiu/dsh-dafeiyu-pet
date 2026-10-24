# OPERATIONS — 桌宠部署、备份与回滚（pet 侧）

> 只描述桌宠进程本身（pet-work）；DSH 插件/挂载见 `docs/MOUNT-PROTOCOL.md` / `docs/REVIEW-GATE.md`。
> 部署纪律：**只重启 pet，不重启 DSH**；`start-pet.ps1 -Restart` 会自动先停旧进程再拉起。

## 1. 备份策略（每次部署前必须留一份）

```powershell
$work = 'E:\project\AI提效\tool\pet-integration-src\pet-work'
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'   # 例：20261024-1202
New-Item -ItemType Directory -Force -Path "$work\backup" | Out-Null
Copy-Item "$work\pet\桌宠.py"      "$work\backup\桌宠.py.bak-$stamp"
Copy-Item "$work\pet\whale_skin.py" "$work\backup\whale_skin.py.bak-$stamp"
```

现存基线备份（本轮 2.5D 动画修复，HEAD `680ad0d`，2026-10-24 12:02 部署）：

- `pet-work\backup\桌宠.py.bak-20261024-1202-animfix`
- `pet-work\backup\whale_skin.py.bak-20261024-1202-animfix`

## 2. 部署当前 repo HEAD 到生产（推荐）

```powershell
$repo = 'E:\project\AI提效\tool\dsh-dafeiyu-pet-repo'
$work = 'E:\project\AI提效\tool\pet-integration-src\pet-work'
Copy-Item -Force "$repo\pet\桌宠.py"      "$work\pet\桌宠.py"
Copy-Item -Force "$repo\pet\whale_skin.py" "$work\pet\whale_skin.py"
powershell -File "$work\tools\start-pet.ps1" -Restart
node "$work\tools\pet-cmd.mjs" 'ping'   # 期望 {"ok":true,...,"reply":"pong"}
```

一致性校验（生产文件 == git HEAD blob）：

```powershell
git -C $repo hash-object "$work\pet\桌宠.py"
git -C $repo rev-parse HEAD:pet/桌宠.py       # 两行应一致
```

## 3. 回滚

### 3.1 回滚到本轮基线（680ad0d 之前的动画版本 = `95c95f6`）

```powershell
$repo = 'E:\project\AI提效\tool\dsh-dafeiyu-pet-repo'
$work = 'E:\project\AI提效\tool\pet-integration-src\pet-work'
git -C $repo restore --source 95c95f6 -- pet/桌宠.py pet/whale_skin.py
Copy-Item -Force "$repo\pet\桌宠.py"      "$work\pet\桌宠.py"
Copy-Item -Force "$repo\pet\whale_skin.py" "$work\pet\whale_skin.py"
powershell -File "$work\tools\start-pet.ps1" -Restart
```

> 用 `git restore --source` 不会改动当前分支历史；回滚后如需再前进，`git checkout -- pet/桌宠.py pet/whale_skin.py` 恢复工作区到 HEAD。

### 3.2 用本机备份回滚（不依赖 git）

```powershell
$work = 'E:\project\AI提效\tool\pet-integration-src\pet-work'
Copy-Item -Force "$work\backup\桌宠.py.bak-20261024-1202-animfix"     "$work\pet\桌宠.py"
Copy-Item -Force "$work\backup\whale_skin.py.bak-20261024-1202-animfix" "$work\pet\whale_skin.py"
powershell -File "$work\tools\start-pet.ps1" -Restart
node "$work\tools\pet-cmd.mjs" 'ping'
```

### 3.3 回滚后验证

- `pet-cmd.mjs ping` → `pong`；
- `pet-cmd.mjs 'life:status' --read-reply` → lifecycle 配置生效、`offline:false`；
- `pet-cmd.mjs 'act:wave'` → 帧动作可见（约 1.1s）；`cmd:mode:still` 检查静止不倾斜。
- 日志/证据：`pet-work\evidence\`（隐私扫描由 `preflight-check.ps1` 覆盖）。

## 4. 冻结期规则

- 冻结后不重启 pet、不部署；仅允许只读验证（`pet-cmd ping`/截图）。
- 任何回滚操作先在 `verify/REVIEW-LOG.md` 记录原因与时间。

## 5. 发行包构建检查清单（免 Python zip）

> 背景（2026-10-24 P0）：`pet/桌宠.spec` 的 datas 曾只含 `pet/assets`，漏掉仓库根
> `assets/whale-girl`，发行版静默回退 classic。分支 `feat/release-assets` 已修 spec/build 脚本，
> 合并后每次发版按本清单执行。

```powershell
$repo = 'E:\project\AI提效\tool\dsh-dafeiyu-pet-repo'
$work = 'E:\project\AI提效\tool\pet-integration-src\pet-work'
# 输出在 repo 外（避免脏树）；版本号按发版填写
powershell -File "$repo\scripts\pet-build-release.ps1" `
  -Version 1.1.5-dsh.2-whalegirl `
  -PythonExe "$work\.venv\Scripts\python.exe" `
  -OutDir "$work\release-build"
```

构建脚本内置两道资产门禁（缺失/不完整直接失败）：

1. **目录自检**：`<app>\_internal\assets\whale-girl\manifest.json` 存在，PNG ≥170、文件 ≥178；
2. **zip 自检**：`_internal/assets/whale-girl/*` ≥178 项、manifest 存在，且 **不允许** 出现
   app 根 `assets/whale-girl/*` 重复副本（只打一份，避免 zip 膨胀约 9.5MB）。

发布前人工复核：

- [ ] zip 文件名/版本号与 Release 一致；`.sha256` 同目录生成并核对；
- [ ] zip 大小合理（含鲸鱼娘约 97–99MB；不含时约 77MB → 视为缺资产）；
- [ ] 受控冒烟：停生产 pet → 解压/直接用 dist exe 启动 → 窗口标题「大肥鱼桌宠」、`ping→pong`、
      截图确认**鲸鱼娘（非 classic）**、`act:wave` 帧动画可见 → 停 exe → `start-pet.ps1 -Restart` 恢复生产；
- [ ] 恢复后确认生产 pid/pipe/截图，清理 dist 进程；
- [ ] GitHub Release 上传 zip + `.sha256`；插件自举 `lifecycle.releaseZipUrl` 指向该资产；
- [ ] 记录构建时间/HEAD/sha256 到 `verify/RELEASE-BUILD-SMOKE.md` 或 Release notes。

> 冒烟失败时：立即停止 dist exe、用 `start-pet.ps1 -Restart` 恢复生产，再排查；不得让生产长期停摆。
