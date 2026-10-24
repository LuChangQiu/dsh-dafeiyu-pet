param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Profile = (Join-Path $env:USERPROFILE '.dsh\profiles\web'),
  [string]$PetWork = (Join-Path $env:USERPROFILE 'pet-work')
)
# install.ps1 — 安装/更新 dsh-pet-bridge（server）+ 管理界面（client）到 DSH profile，
# 并把两个 insert 块幂等写入 profile 的 cordis.patch.yml（模板：install/cordis.patch.template.yml）。
$ErrorActionPreference = 'Stop'
function Write-Info($m) { Write-Output "[install] $m" }
if (-not (Test-Path $RepoRoot)) { throw "repo not found: $RepoRoot" }
if (-not (Test-Path $Profile)) { throw "profile not found: $Profile" }

# 1) copy plugin packages (server + ui if present)
$pkgs = @()
$p1 = Join-Path $RepoRoot 'plugin\dsh-pet-bridge'
if (Test-Path $p1) { $pkgs += @{ src = $p1; name = 'dsh-pet-bridge' } }
$p2 = Join-Path $RepoRoot 'plugin\dsh-pet-bridge-ui'
if (Test-Path $p2) { $pkgs += @{ src = $p2; name = 'dsh-pet-bridge-ui' } }
foreach ($p in $pkgs) {
  $dst = Join-Path $Profile ("node_modules\" + $p.name)
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  Copy-Item $p.src $dst -Recurse -Force
  Write-Info ("installed package: " + $p.name)
}

# 2) cordis.patch.yml: 幂等写入 vX + ui 两个 insert 块（来自模板）
$patch = Join-Path $Profile 'cordis.patch.yml'
$tpl = Join-Path $RepoRoot 'install\cordis.patch.template.yml'
if (-not (Test-Path $patch)) { New-Item -ItemType File -Path $patch -Force | Out-Null }
if (Test-Path $tpl) {
  $cur = Get-Content $patch -Raw
  $block = (Get-Content $tpl -Raw).Replace('{{PET_WORK}}', $PetWork).Replace('{{DSH_HOME}}', (Split-Path -Parent (Split-Path -Parent $Profile)))
  foreach ($id in @('pet-bridge-v', 'pet-bridge-ui')) {
    if ($cur -notmatch [regex]::Escape($id)) {
      $cur = $cur.TrimEnd() + "`r`n" + $block
      Write-Info "appended patch block for $id"
    } else { Write-Info "patch block already present: $id" }
  }
  Set-Content -Path $patch -Value $cur -Encoding UTF8
  $hits = (Select-String -Path $patch -Pattern 'pet-bridge-v').Count
  $uiHits = (Select-String -Path $patch -Pattern 'pet-bridge-ui').Count
  Write-Info "patch self-check: pet-bridge-v hits=$hits, pet-bridge-ui hits=$uiHits"
  if ($hits -lt 1 -or $uiHits -lt 1) { throw 'patch self-check failed (missing insert block)' }
} else { Write-Info 'WARN: install/cordis.patch.template.yml not found, patch not updated' }

# 3) 释放仓库内 pet/ 源码，并交给 bootstrap 自举（venv/启动）
$petRoot = Join-Path $RepoRoot 'pet'
if (Test-Path $petRoot) {
  $dstPet = Join-Path $PetWork 'pet'
  if (-not (Test-Path $dstPet)) { New-Item -ItemType Directory -Force -Path $dstPet | Out-Null }
  Copy-Item (Join-Path $petRoot '*') $dstPet -Recurse -Force
  Write-Info ("pet source released: " + $dstPet)
  $boot = Join-Path $RepoRoot 'scripts\bootstrap-pet.ps1'
  if (Test-Path $boot) {
    try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $boot -PetWork $PetWork -RepoRoot $RepoRoot | Out-Host } catch { Write-Info ("bootstrap warn: " + $_.Exception.Message) }
  }
}
Write-Info 'done. 重启 dsh web 后：设置页出现管理面板，桌宠由插件自动拉起（bootstrap-pet.ps1）。'
Write-Info '回滚：scripts\plugin-rollback.ps1 / scripts\pet-rollback.ps1'


# 4) 注册"登录后自动启动"计划任务（P0：修 ONCE 不自启）
#    - 触发器 AtLogOn（当前用户、LIMITED、延迟 30s）→ 登录后自动拉起桌宠
#    - 旧 ONCE/其它触发器任务先删除再建（幂等）；不重启、不改 DSH
#    - 按需启动仍保留：schtasks /Run /TN DafeiyuPetStart（供面板/手动使用）
$taskName = 'DafeiyuPetStart'
$startScript = Join-Path $PetWork 'tools\start-pet.ps1'
if (-not (Test-Path -LiteralPath $startScript)) { throw "start-pet.ps1 not found: $startScript" }
try {
  # 旧任务先清（ONCE 任务重启后不会自启；残留也会让新触发器不生效）
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
  & schtasks.exe /Delete /TN $taskName /F 2>$null | Out-Null
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScript + '"')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
  $trigger.Delay = 'PT30S'   # 登录后等 30s 再起，避免和开机项抢资源
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
  Write-Info ("scheduled task registered: " + $taskName + " (AtLogOn, delay 30s, LIMITED)")
  Write-Info ("按需启动：schtasks /Run /TN " + $taskName)
} catch {
  Write-Info ("WARN: 计划任务注册失败（登录自启不可用；仍可手动 start-pet.ps1）: " + $_.Exception.Message)
}

# 5) 代码规范 pre-commit 钩子（仓库内 .githooks：node --check + prettier + ruff）
try {
  $top = (& git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
  if ($top) { & git -C $top config core.hooksPath .githooks | Out-Null; Write-Info 'git hooksPath = .githooks' }
} catch { Write-Info ('WARN: git hooks 配置失败: ' + $_.Exception.Message) }
