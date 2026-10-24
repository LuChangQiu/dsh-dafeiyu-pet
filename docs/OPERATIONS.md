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
