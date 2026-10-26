param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Profile = (Join-Path $env:USERPROFILE '.dsh\profiles\web'),
  [string]$PetWork = (Join-Path $env:USERPROFILE 'pet-work'),
  [string]$BSource = '',
  [switch]$DryRun,
  [switch]$Sandbox
)
# install.ps1 — 安装/更新 dsh-pet-bridge（server）+ 管理界面（client）到 DSH profile，
# 释放 pet/ 源码 + scripts/ 工具链到 pet-work，幂等写两个 patch insert 块。
# 不安装系统服务；安装器只写 profile 与 pet-work（DryRun 零写入）。
$ErrorActionPreference = 'Stop'
function Write-Info($m) { Write-Output "[install] $m" }
function Fail($m) { throw "[install] $m" }

# ── 0. 前置检查（先检查再写，避免半安装）──────────────────────────────────
$required = @(
  @{ path = $RepoRoot; kind = 'repo' },
  @{ path = $Profile; kind = 'profile' },
  @{ path = (Join-Path $RepoRoot 'plugin\server'); kind = 'plugin server' },
  @{ path = (Join-Path $RepoRoot 'plugin\client'); kind = 'plugin client' },
  @{ path = (Join-Path $RepoRoot 'pet\桌宠.py'); kind = 'pet source' },
  @{ path = (Join-Path $RepoRoot 'scripts\start-pet.ps1'); kind = 'start-pet.ps1' },
  @{ path = (Join-Path $RepoRoot 'scripts\bootstrap-pet.ps1'); kind = 'bootstrap-pet.ps1' },
  @{ path = (Join-Path $RepoRoot 'scripts\pet-cmd.mjs'); kind = 'pet-cmd.mjs' },
  @{ path = (Join-Path $RepoRoot 'scripts\selfcheck.ps1'); kind = 'selfcheck.ps1' },
  @{ path = (Join-Path $RepoRoot 'install\cordis.patch.template.yml'); kind = 'patch template' }
)
$missing = @()
foreach ($r in $required) { if (-not (Test-Path -LiteralPath $r.path)) { $missing += ($r.kind + ': ' + $r.path) } }
if ($missing.Count -gt 0) { Fail ("缺少必需文件/目录：`n  " + ($missing -join "`n  ")) }
Write-Info ("repo=" + $RepoRoot)
Write-Info ("profile=" + $Profile)
Write-Info ("pet-work=" + $PetWork)

if ($DryRun) {
  Write-Info '[dry-run] 将复制 plugin/server -> node_modules\dsh-pet-bridge-v49'
  Write-Info '[dry-run] 将复制 plugin/client -> node_modules\dsh-pet-bridge-ui'
  Write-Info '[dry-run] 将追加/更新 cordis.patch.yml 两个 insert 块（pet-bridge-v49 / pet-bridge-ui）'
  Write-Info ("[dry-run] 将释放 pet/ -> " + (Join-Path $PetWork 'pet'))
  Write-Info ("[dry-run] 将释放 scripts/ -> " + (Join-Path $PetWork 'tools'))
  Write-Info ('[dry-run] 将按 B 源注入 webm_body（可选）：' + $(if ($BSource) { $BSource } else { '自动探测' }))
  $fetch = Join-Path $RepoRoot 'scripts\fetch-b-assets.ps1'
  if (Test-Path $fetch) {
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $fetch -RepoRoot $RepoRoot -DestPet (Join-Path $PetWork 'pet') -Source $BSource -DryRun | Out-Host
    } catch { Write-Info ('[dry-run] B 素材 dry-run warn: ' + $_.Exception.Message) }
  }
  Write-Info '[dry-run] 不会写 profile/pet-work/计划任务；结束。'
  exit 0
}

# ── 1. 复制插件包 ─────────────────────────────────────────────────────────
$pkgs = @(
  @{ src = (Join-Path $RepoRoot 'plugin\server'); name = 'dsh-pet-bridge-v49' },
  @{ src = (Join-Path $RepoRoot 'plugin\client'); name = 'dsh-pet-bridge-ui' }
)
# 旧版本插件目录清理（v49 以外的 dsh-pet-bridge-v<digits>；UI 同名覆盖）
$nm = Join-Path $Profile 'node_modules'
if (Test-Path $nm) {
  Get-ChildItem $nm -Directory -Filter 'dsh-pet-bridge-v*' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'dsh-pet-bridge-v49' } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force; Write-Info ("removed legacy package: " + $_.Name) }
}
foreach ($p in $pkgs) {
  try {
    $nm = Join-Path $Profile 'node_modules'
    New-Item -ItemType Directory -Force -Path $nm | Out-Null
    $dst = Join-Path $nm $p.name
    if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
    Copy-Item -LiteralPath $p.src -Destination $dst -Recurse -Force
    Write-Info ("installed package: " + $p.name)
  } catch {
    Fail ("复制插件失败 (" + $p.name + "): " + $_.Exception.Message)
  }
}

# ── 2. cordis.patch.yml：幂等追加两个 insert 块 ──────────────────────────
try {
  $patch = Join-Path $Profile 'cordis.patch.yml'
  if (-not (Test-Path $patch)) { New-Item -ItemType File -Path $patch -Force | Out-Null }
  $tpl = Join-Path $RepoRoot 'install\cordis.patch.template.yml'
  $cur = Get-Content $patch -Raw -Encoding UTF8
  if ($null -eq $cur) { $cur = '' }
  $tplText = Get-Content $tpl -Raw -Encoding UTF8

  # 旧 profile 迁移：移除激活的旧 server insert 块（pet-bridge-v<digits> 且不是 v49），保留其它内容
  $lines = @($cur -split "`r?`n")
  $drop = New-Object System.Collections.Generic.HashSet[int]
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^-\s*insert:\s*$') {
      $j = $i + 1
      while ($j -lt $lines.Count -and $lines[$j].Trim() -eq '') { $j++ }
      $idLine = if ($j -lt $lines.Count) { $lines[$j] } else { '' }
      if ($idLine -match '^\s*-\s*id:\s*(pet-bridge-v\d+)\b') {
        $oldId = $Matches[1]
        if ($oldId -ne 'pet-bridge-v49') {
          $k = $i + 1
          while ($k -lt $lines.Count -and $lines[$k] -notmatch '^-\s*(id|insert):\s*') { $k++ }
          for ($x = $i; $x -lt $k; $x++) { [void]$drop.Add($x) }
          Write-Info ("removed legacy patch insert block: " + $oldId)
        }
      }
    }
  }
  if ($drop.Count -gt 0) {
    $bak = Join-Path $Profile ('cordis.patch.yml.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-pre-v49')
    Copy-Item -LiteralPath $patch -Destination $bak -Force
    Write-Info ("patch backup: " + $bak)
    $kept = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $lines.Count; $i++) { if (-not $drop.Contains($i)) { $kept.Add($lines[$i]) } }
    $cur = ($kept -join "`r`n")
  }
  $tplText = $tplText.Replace('{{PET_WORK}}', $PetWork)
  $tplText = $tplText.Replace('{{DSH_HOME}}', (Split-Path -Parent (Split-Path -Parent $Profile)))
  $firstInsert = $tplText.IndexOf('- insert:')
  $secondInsert = if ($firstInsert -ge 0) { $tplText.IndexOf('- insert:', $firstInsert + 1) } else { -1 }
  if ($firstInsert -lt 0 -or $secondInsert -lt 0) { Fail 'patch template 缺少两个 - insert: 块' }
  $blockFor = @{
    'pet-bridge-v49' = $tplText.Substring($firstInsert, $secondInsert - $firstInsert).TrimEnd() + "`r`n"
    'pet-bridge-ui'  = $tplText.Substring($secondInsert).TrimEnd() + "`r`n"
  }
  # 精确 id：pet-bridge-v49 / pet-bridge-ui（不要用 'pet-bridge-v' 泛匹配，否则旧 profile 会误判“已存在”）
  foreach ($id in @('pet-bridge-v49', 'pet-bridge-ui')) {
    $pat = ('(?m)^\s*-\s*id:\s*' + [regex]::Escape($id) + '\b')
    if ($cur -notmatch $pat) {
      $cur = $cur.TrimEnd() + "`r`n" + $blockFor[$id]
      Write-Info ("appended patch block: " + $id)
    } else {
      Write-Info ("patch block already present: " + $id)
    }
  }
  Set-Content -Path $patch -Value $cur -Encoding UTF8
  $hits = ([regex]::Matches($cur, '(?m)^\s*-\s*id:\s*pet-bridge-v49\b')).Count
  $uiHits = ([regex]::Matches($cur, '(?m)^\s*-\s*id:\s*pet-bridge-ui\b')).Count
  if ($hits -lt 1 -or $uiHits -lt 1) { Fail 'patch self-check failed (missing insert block pet-bridge-v49/pet-bridge-ui)' }
  Write-Info ("patch self-check: exact server hits=$hits, ui hits=$uiHits")
  $legacy = @([regex]::Matches($cur, '(?m)^\s*-\s*id:\s*(pet-bridge-v\d+)\b') | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -ne 'pet-bridge-v49' } | Select-Object -Unique)
  if ($legacy.Count -gt 0) { Write-Info ("WARN: 旧 patch id 仍存在（" + ($legacy -join ', ') + "）；请移除旧块/旧 node_modules，避免重复加载") }
} catch {
  Fail ("写 cordis.patch.yml 失败: " + $_.Exception.Message)
}

# ── 3. 释放 pet/ 源码 + scripts/ 工具链到 pet-work ────────────────────────
try {
  $dstPet = Join-Path $PetWork 'pet'
  New-Item -ItemType Directory -Force -Path $dstPet | Out-Null
  Copy-Item -Path (Join-Path $RepoRoot 'pet\*') -Destination $dstPet -Recurse -Force
  Write-Info ("pet source released: " + $dstPet)

  $dstTools = Join-Path $PetWork 'tools'
  New-Item -ItemType Directory -Force -Path $dstTools | Out-Null
  Copy-Item -Path (Join-Path $RepoRoot 'scripts\*') -Destination $dstTools -Recurse -Force
  Write-Info ("runtime tools released: " + $dstTools)
} catch {
  Fail ("释放 pet/tools 失败: " + $_.Exception.Message)
}

# ── 3b. B 素材注入（可选；无源则 B 静帧回退）───────────────────────────
$fetch = Join-Path $RepoRoot 'scripts\fetch-b-assets.ps1'
if (Test-Path $fetch) {
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $fetch -RepoRoot $RepoRoot -DestPet (Join-Path $PetWork 'pet') -Source $BSource -Force | Out-Host
    Write-Info 'B assets injected (50 webm)'
  } catch {
    Write-Info ('WARN: B 素材注入失败（B 将回退静帧）：' + $_.Exception.Message)
  }
}

# ── 3c. Sandbox：只写传入的 Profile/PetWork（供干净 clone 静态验证），不 bootstrap/计划任务
if ($Sandbox) {
  Write-Info '[sandbox] 已完成 plugin/patch/pet/tools/B 复制；跳过 bootstrap/计划任务/git hooks。'
  exit 0
}

# ── 3d. bootstrap（建 venv/启动）──────────────────────────────────────────
$boot = Join-Path $RepoRoot 'scripts\bootstrap-pet.ps1'
if (Test-Path $boot) {
  try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $boot -PetWork $PetWork -RepoRoot $RepoRoot | Out-Host }
  catch { Write-Info ('WARN: bootstrap: ' + $_.Exception.Message) }
}
Write-Info 'done. 重启 dsh web 后：设置页出现管理面板，桌宠由插件自动拉起（bootstrap-pet.ps1）。'
Write-Info '回滚：scripts\plugin-rollback.ps1 / scripts\pet-rollback.ps1'

# ── 4. 注册登录自启计划任务 ──────────────────────────────────────────────
$taskName = 'DafeiyuPetStart'
$startScript = Join-Path $PetWork 'tools\start-pet.ps1'
if (-not (Test-Path -LiteralPath $startScript)) { Fail ("start-pet.ps1 not found: " + $startScript) }
$backupXml = Join-Path $env:TEMP ('DafeiyuPetStart-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.xml')
$hasOldTask = $false
try {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    & schtasks.exe /Query /TN $taskName /XML 2>$null | Set-Content -LiteralPath $backupXml -Encoding UTF8
    $hasOldTask = (Test-Path -LiteralPath $backupXml) -and ((Get-Content -LiteralPath $backupXml -Raw -ErrorAction SilentlyContinue) -match '<Task ')
  }
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
  & schtasks.exe /Delete /TN $taskName /F 2>$null | Out-Null
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScript + '"')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
  $trigger.Delay = 'PT30S'
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
  Write-Info ("scheduled task registered: " + $taskName + " (AtLogOn, delay 30s, LIMITED)")
} catch {
  $regErr = $_.Exception.Message
  if ($hasOldTask) {
    try {
      Register-ScheduledTask -TaskName $taskName -Xml (Get-Content -LiteralPath $backupXml -Raw) -Force -ErrorAction Stop | Out-Null
      Write-Info ('WARN: 计划任务注册失败，已从备份恢复: ' + $backupXml + '（' + $regErr + '）')
    } catch {
      Write-Info ('WARN: 计划任务注册失败且恢复失败：' + $_.Exception.Message + '；原错误：' + $regErr + '；仍可手动 start-pet.ps1')
    }
  } else {
    Write-Info ('WARN: 计划任务注册失败（仍可手动 start-pet.ps1）：' + $regErr)
  }
}

# ── 5. git hooks ─────────────────────────────────────────────────────────
try {
  $top = (& git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
  if ($top) { & git -C $top config core.hooksPath .githooks | Out-Null; Write-Info 'git hooksPath = .githooks' }
} catch { Write-Info ('WARN: git hooks 配置失败: ' + $_.Exception.Message) }
