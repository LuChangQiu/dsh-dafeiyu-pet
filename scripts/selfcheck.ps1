param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$PetWork = '',
  [string]$ProfileDir = '',
  [string]$TaskName = 'DafeiyuPetStart',
  [string]$PatchFile = '',
  [string]$PythonExe = '',
  [switch]$Repair,
  [switch]$Human,
  [switch]$SkipPipeProbe
)
# selfcheck.ps1 — 安装自检 / 幂等修复（对齐 docs/INSTALL-STRATEGY.md）
#
# 检查六项：
#   1) profile 插件完整性（server + ui 包；node_modules 是否被 pnpm 清理/文件缺失）
#   2) pet-work/.venv 与 Python 依赖（PySide6/requests）
#   3) 计划任务 DafeiyuPetStart 注册与动作路径
#   4) pipe 可达（命名管道 + 桌宠进程 + ping=pong）
#   5) patch 状态（未挂载/已挂载；只读，不自动改 patch）
#   6) 版本一致性（repo plugin/server|client vs 已安装包；生产 pet 源码 vs repo pet 源码）
#
# 输出：JSON { healthy, issues[], repairs[], checks, needRestart, generatedAt }
#   healthy = 无 severity=error 的 issue（warn 只提示，不阻塞）
#
# -Repair：幂等修复（重装插件包 / 重建 venv 并装依赖 / 重注册计划任务 / 拉起桌宠）；
#           不覆盖用户 config/memory/logs；patch 只报告不自动改（挂载由挂载协议负责）。
#
# 示例：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\selfcheck.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\selfcheck.ps1 -Repair
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\selfcheck.ps1 -PetWork D:\pet-work -Human
#
# 兼容 Windows PowerShell 5.1 / PowerShell 7；文件需 UTF-8 with BOM。

$ErrorActionPreference = 'Continue'
$script:Issues = @()
$script:Repairs = @()
$script:NeedRestart = $false
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Add-Issue([string]$code, [string]$severity, [string]$detail) {
  $script:Issues += [pscustomobject]@{ code = $code; severity = $severity; detail = $detail }
}

function Add-Repair([string]$action, [string]$result, [string]$detail) {
  $script:Repairs += [pscustomobject]@{ action = $action; result = $result; detail = $detail }
}

function Read-JsonFile([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try { return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Get-RequiredFilesMap {
  return [ordered]@{
    'plugin-server' = @('package.json', 'lib\index.js', 'lib\tool-types.js', 'lib\pricing.js', 'lib\mode.js', 'lib\privacy.js', 'lib\team-view.js', 'lib\text-fmt.js')
    'plugin-ui'     = @('package.json', 'lib\index.js', 'lib\home.js', 'lib\client.js', 'lib\web-route.js')
  }
}

function Resolve-Defaults {
  $script:RepoRoot = $RepoRoot
  if (-not (Test-Path -LiteralPath $script:RepoRoot)) { throw "RepoRoot not found: $($script:RepoRoot)" }

  if (-not $PetWork) {
    if ($env:DAFEIYU_PET_WORK) { $PetWork = $env:DAFEIYU_PET_WORK }
    elseif (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $script:RepoRoot) 'pet-work')) {
      $PetWork = Join-Path (Split-Path -Parent $script:RepoRoot) 'pet-work'
    } elseif (Test-Path -LiteralPath (Join-Path $script:RepoRoot 'pet-work')) {
      $PetWork = Join-Path $script:RepoRoot 'pet-work'
    }
  }
  $script:PetWork = $PetWork

  if (-not $ProfileDir) {
    $dshHome = $env:DSH_HOME
    if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
    $ProfileDir = Join-Path $dshHome 'profiles\web'
  }
  $script:ProfileDir = $ProfileDir
  if (-not $PatchFile) { $PatchFile = Join-Path $script:ProfileDir 'cordis.patch.yml' }
  $script:PatchFile = $PatchFile

  if (-not $PythonExe) {
    if ($script:PetWork -and (Test-Path -LiteralPath (Join-Path $script:PetWork '.venv\Scripts\python.exe'))) {
      $PythonExe = Join-Path $script:PetWork '.venv\Scripts\python.exe'
    } else { $PythonExe = 'python' }
  }
  $script:PythonExe = $PythonExe
  $script:PipeName = '\\.\pipe\dafeiyu-pet-whale-single-instance'
}

# ---------- 1) 插件完整性 ----------
function Test-Plugin {
  $r = [ordered]@{ ok = $false; profile = $script:ProfileDir; server = $null; ui = $null; warnings = @() }
  $nm = Join-Path $script:ProfileDir 'node_modules'
  if (-not (Test-Path -LiteralPath $nm)) {
    Add-Issue 'plugin-node-modules-missing' 'error' "profile node_modules 不存在：$nm（DSH 未安装或 profile 路径错误）"
    return $r
  }
  $req = Get-RequiredFilesMap

  # server 包：取最新 dsh-pet-bridge-v*（排除 .bak）
  $serverDirs = @(Get-ChildItem -LiteralPath $nm -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^dsh-pet-bridge-v\d' -and $_.Name -notmatch '\.bak' } |
    Sort-Object LastWriteTime -Descending)
  if ($serverDirs.Count -eq 0) {
    Add-Issue 'plugin-server-missing' 'error' "node_modules 下未找到 dsh-pet-bridge-v* 包（可能被 pnpm 清理）"
  } else {
    $pkg = $serverDirs[0]
    $meta = Read-JsonFile (Join-Path $pkg.FullName 'package.json')
    $missing = @()
    foreach ($f in $req['plugin-server']) {
      if (-not (Test-Path -LiteralPath (Join-Path $pkg.FullName $f))) { $missing += $f }
    }
    $r.server = [ordered]@{
      path = $pkg.FullName; name = $(if ($meta) { $meta.name } else { $null }); version = $(if ($meta) { $meta.version } else { $null })
      missing = $missing
    }
    if ($missing.Count -gt 0) {
      Add-Issue 'plugin-server-incomplete' 'error' ("server 包缺文件：" + ($missing -join ', ') + " @ " + $pkg.Name)
    } else { $r.ok = $true }
    # 与 repo 文件集对比：repo 新增文件未装 → warn（不阻塞，提示更新）
    $repoServerLib = Join-Path $script:RepoRoot 'plugin\server\lib'
    if (Test-Path -LiteralPath $repoServerLib) {
      $installedLib = Join-Path $pkg.FullName 'lib'
      $repoFiles = @(Get-ChildItem -LiteralPath $repoServerLib -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
      $miss = @($repoFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $installedLib $_)) })
      if ($miss.Count -gt 0) {
        Add-Issue 'plugin-server-outdated' 'warn' ("已安装 server 包缺 repo 新文件（窗口后需重装）：" + ($miss -join ', '))
        $r.warnings += 'server-outdated'
      }
    }
  }

  # ui 包（存在才校验）
  $uiDir = Join-Path $nm 'dsh-pet-bridge-ui'
  if (Test-Path -LiteralPath $uiDir) {
    $meta = Read-JsonFile (Join-Path $uiDir 'package.json')
    $missing = @()
    foreach ($f in $req['plugin-ui']) {
      if (-not (Test-Path -LiteralPath (Join-Path $uiDir $f))) { $missing += $f }
    }
    $r.ui = [ordered]@{
      path = $uiDir; name = $(if ($meta) { $meta.name } else { $null }); version = $(if ($meta) { $meta.version } else { $null })
      missing = $missing
    }
    if ($missing.Count -gt 0) { Add-Issue 'plugin-ui-incomplete' 'error' ("ui 包缺文件：" + ($missing -join ', ') + " @ dsh-pet-bridge-ui") }
  } else {
    Add-Issue 'plugin-ui-missing' 'warn' '未安装 dsh-pet-bridge-ui（管理界面可选，不影响桌宠联动）'
  }
  return $r
}

# ---------- 2) venv / Python 依赖 ----------
function Test-Venv {
  $r = [ordered]@{ ok = $false; petWork = $script:PetWork; venv = $null; python = $null; version = $null; error = $null }
  if (-not $script:PetWork -or -not (Test-Path -LiteralPath $script:PetWork)) {
    Add-Issue 'petwork-missing' 'error' 'pet-work 目录未找到（用 -PetWork 指定，或设置 DAFEIYU_PET_WORK）'
    return $r
  }
  $venv = Join-Path $script:PetWork '.venv'
  $py = Join-Path $venv 'Scripts\python.exe'
  $pyw = Join-Path $venv 'Scripts\pythonw.exe'
  $r.venv = $venv
  if (-not (Test-Path -LiteralPath $py) -or -not (Test-Path -LiteralPath $pyw)) {
    Add-Issue 'venv-missing' 'error' "venv 不完整：缺 $py 或 $pyw"
    return $r
  }
  $r.python = $py
  try {
    $out = (& $py -c "import sys,PySide6,requests; print(sys.version.split()[0] + '|' + PySide6.__version__)" 2>&1) | Out-String
    if ($LASTEXITCODE -ne 0) {
      Add-Issue 'venv-broken' 'error' ("venv Python 导入 PySide6/requests 失败：" + $out.Trim())
      return $r
    }
    $r.version = $out.Trim()
    $r.ok = $true
  } catch {
    Add-Issue 'venv-broken' 'error' ("venv Python 执行失败：" + $_.Exception.Message)
  }
  return $r
}

# ---------- 3) 计划任务 ----------
function Test-ScheduledTask {
  $r = [ordered]@{ ok = $false; name = $TaskName; state = $null; action = $null; script = $null; exists = $false }
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) {
    Add-Issue 'task-missing' 'error' "计划任务未注册：$TaskName"
    return $r
  }
  $r.exists = $true
  $r.state = "$($t.State)"
  $act = @($t.Actions)[0]
  $r.action = ("{0} {1}" -f $act.Execute, $act.Arguments).Trim()
  if ($r.state -match 'Disabled') { Add-Issue 'task-disabled' 'error' "计划任务已禁用：$TaskName" }
  $m = [regex]::Match($r.action, '-File\s+"?([^"]+?\.ps1)"?')
  if ($m.Success) {
    $r.script = $m.Groups[1].Value
    if (-not (Test-Path -LiteralPath $r.script)) {
      Add-Issue 'task-script-stale' 'error' "计划任务指向的脚本不存在：$($r.script)"
    } elseif ($r.state -notmatch 'Disabled') { $r.ok = $true }
  } else {
    Add-Issue 'task-action-invalid' 'error' ("计划任务动作无法解析 start-pet.ps1：" + $r.action)
  }
  return $r
}

# ---------- 4) pipe / 桌宠进程 ----------
function Test-Pipe {
  $r = [ordered]@{ ok = $false; pipe = $script:PipeName; pipeExists = $false; petProcess = @(); ping = $null }
  $r.pipeExists = Test-Path -LiteralPath $script:PipeName
  $r.petProcess = @(Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue | Where-Object {
      $_.CommandLine -and $_.CommandLine -like '*桌宠.py*'
    } | ForEach-Object { $_.ProcessId })
  if (-not $r.pipeExists) {
    Add-Issue 'pipe-down' 'error' "命名管道不可达：$($script:PipeName)（桌宠未启动）"
    return $r
  }
  if ($r.petProcess.Count -eq 0) {
    Add-Issue 'pipe-orphan' 'warn' '管道存在但未找到桌宠进程（可能残留句柄/其他进程占用）'
  }
  if (-not $SkipPipeProbe) {
    $cmd = Join-Path $script:PetWork 'tools\pet-cmd.mjs'
    if (Test-Path -LiteralPath $cmd) {
      try {
        $out = (& node $cmd 'ping' 2>&1) | Out-String
        $r.ping = $out.Trim()
        if ($out -notmatch '"reply"\s*:\s*"pong"') {
          Add-Issue 'pipe-no-pong' 'error' ("pipe ping 未返回 pong：" + $out.Trim())
          return $r
        }
      } catch {
        Add-Issue 'pipe-probe-failed' 'error' ("pipe ping 执行失败：" + $_.Exception.Message)
        return $r
      }
    } else {
      Add-Issue 'pet-cmd-missing' 'warn' "未找到 $cmd（跳过 ping 探测，仅检查管道存在）"
    }
  }
  $r.ok = $true
  return $r
}

# ---------- 5) patch 状态（只读） ----------
function Test-Patch {
  $r = [ordered]@{ ok = $false; file = $script:PatchFile; state = 'unknown'; serverBlocks = 0; uiBlocks = 0; commentedServer = 0; commentedUi = 0 }
  if (-not (Test-Path -LiteralPath $script:PatchFile)) {
    Add-Issue 'patch-missing' 'error' "profile patch 不存在：$($script:PatchFile)"
    return $r
  }
  $text = Get-Content -LiteralPath $script:PatchFile -Raw -ErrorAction SilentlyContinue
  $r.serverBlocks = ([regex]::Matches($text, '(?m)^\s*-\s*id:\s*["'']?pet-bridge-v[0-9]')).Count
  $r.uiBlocks = ([regex]::Matches($text, '(?m)^\s*-\s*id:\s*["'']?pet-bridge-ui')).Count
  $r.commentedServer = ([regex]::Matches($text, '(?m)^\s*#\s*-\s*id:\s*["'']?pet-bridge-v[0-9]')).Count
  $r.commentedUi = ([regex]::Matches($text, '(?m)^\s*#\s*-\s*id:\s*["'']?pet-bridge-ui')).Count
  if ($r.serverBlocks -ge 1 -and $r.uiBlocks -ge 1) { $r.state = 'mounted' }
  elseif ($r.commentedServer -ge 1 -and $r.commentedUi -ge 1 -and $r.serverBlocks -eq 0 -and $r.uiBlocks -eq 0) { $r.state = 'unmounted' }
  elseif ($r.serverBlocks + $r.uiBlocks + $r.commentedServer + $r.commentedUi -eq 0) {
    $r.state = 'missing-blocks'
    Add-Issue 'patch-blocks-missing' 'error' 'patch 中找不到 pet-bridge / pet-bridge-ui insert 块（未安装或模板未写入）'
  } else {
    $r.state = 'partial'
    Add-Issue 'patch-partial' 'error' ("patch 只挂载了一半：server 活动=$($r.serverBlocks)/注释=$($r.commentedServer)，ui 活动=$($r.uiBlocks)/注释=$($r.commentedUi)")
  }
  $r.ok = $true
  return $r
}

# ---------- 6) 版本一致性 ----------
function Test-Versions {
  $r = [ordered]@{ ok = $true; repoServer = $null; installedServer = $null; repoUi = $null; installedUi = $null; petSource = $null; stateVersion = $null }
  $repoServer = Read-JsonFile (Join-Path $script:RepoRoot 'plugin\server\package.json')
  $repoUi = Read-JsonFile (Join-Path $script:RepoRoot 'plugin\client\package.json')
  if ($repoServer) { $r.repoServer = [ordered]@{ name = $repoServer.name; version = $repoServer.version } }
  if ($repoUi) { $r.repoUi = [ordered]@{ name = $repoUi.name; version = $repoUi.version } }

  $nm = Join-Path $script:ProfileDir 'node_modules'
  if (Test-Path -LiteralPath $nm) {
    $pkg = Get-ChildItem -LiteralPath $nm -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^dsh-pet-bridge-v\d' -and $_.Name -notmatch '\.bak' } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($pkg) {
      $m = Read-JsonFile (Join-Path $pkg.FullName 'package.json')
      if ($m) {
        $r.installedServer = [ordered]@{ name = $m.name; version = $m.version }
        if ($repoServer -and $m.version -ne $repoServer.version) {
          Add-Issue 'version-plugin-mismatch' 'warn' ("已安装 server 版本 $($m.version) ≠ repo $($repoServer.version)（窗口后重装）")
        }
      }
    }
    $uiDir = Join-Path $nm 'dsh-pet-bridge-ui'
    $um = Read-JsonFile (Join-Path $uiDir 'package.json')
    if ($um) {
      $r.installedUi = [ordered]@{ name = $um.name; version = $um.version }
      if ($repoUi -and $um.version -ne $repoUi.version) {
        Add-Issue 'version-ui-mismatch' 'warn' ("已安装 ui 版本 $($um.version) ≠ repo $($repoUi.version)")
      }
    }
  }

  # 生产 pet 源码 vs repo pet 源码（drift 检测；pet-work 不存在则跳过）
  if ($script:PetWork -and (Test-Path -LiteralPath $script:PetWork)) {
    $prodPet = Join-Path $script:PetWork 'pet\桌宠.py'
    $repoPet = Join-Path $script:RepoRoot 'pet\桌宠.py'
    if ((Test-Path -LiteralPath $prodPet) -and (Test-Path -LiteralPath $repoPet)) {
      $h1 = (Get-FileHash -LiteralPath $prodPet -Algorithm SHA256).Hash
      $h2 = (Get-FileHash -LiteralPath $repoPet -Algorithm SHA256).Hash
      $r.petSource = [ordered]@{ production = $h1; repo = $h2; matches = ($h1 -eq $h2) }
      if ($h1 -ne $h2) {
        Add-Issue 'version-pet-drift' 'warn' '生产 pet 源码与 repo 不一致（窗口后重新部署）'
      }
    }
    $st = Read-JsonFile (Join-Path $script:PetWork 'bridge-state-v2.json')
    if ($st) { $r.stateVersion = [ordered]@{ version = $st.version; petVersion = $st.petVersion } }
  }
  return $r
}

# ---------- 修复（-Repair，幂等） ----------
function Invoke-Repairs([hashtable]$checks) {
  $nm = Join-Path $script:ProfileDir 'node_modules'

  # 1) server 包：repo plugin/server → 已安装最新包（无包则提示走 install/install.ps1）
  $req = Get-RequiredFilesMap
  $serverDirs = @()
  if (Test-Path -LiteralPath $nm) {
    $serverDirs = @(Get-ChildItem -LiteralPath $nm -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^dsh-pet-bridge-v\d' -and $_.Name -notmatch '\.bak' } |
      Sort-Object LastWriteTime -Descending)
  }
  $repoServer = Join-Path $script:RepoRoot 'plugin\server'
  if ($serverDirs.Count -eq 0) {
    Add-Repair 'plugin-server' 'failed' '未找到已安装 server 包（无法确定目标包名）；请运行 install/install.ps1 安装'
  } else {
    $pkg = $serverDirs[0]
    $missing = @($req['plugin-server'] | Where-Object { -not (Test-Path -LiteralPath (Join-Path $pkg.FullName $_)) })
    $hasRepoNewer = $false
    if (Test-Path -LiteralPath $repoServer) {
      $repoLib = Join-Path $repoServer 'lib'
      $instLib = Join-Path $pkg.FullName 'lib'
      $hasRepoNewer = @(Get-ChildItem -LiteralPath $repoLib -File -ErrorAction SilentlyContinue |
          Where-Object { -not (Test-Path -LiteralPath (Join-Path $instLib $_.Name)) }).Count -gt 0
    }
    if ($missing.Count -gt 0 -or $hasRepoNewer) {
      try {
        $bak = Join-Path $pkg.FullName ('.selfcheck-backup-' + $stamp)
        New-Item -ItemType Directory -Force -Path $bak | Out-Null
        foreach ($f in @('package.json', 'lib')) {
          $src = Join-Path $pkg.FullName $f
          if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $bak -Recurse -Force -ErrorAction SilentlyContinue }
        }
        if (Test-Path -LiteralPath $repoServer) {
          Copy-Item -Path (Join-Path $repoServer '*') -Destination $pkg.FullName -Recurse -Force
          Add-Repair 'plugin-server-reinstall' 'done' ("已从 repo plugin/server 重装到 " + $pkg.Name + "（备份 " + (Split-Path -Leaf $bak) + "）")
          $script:NeedRestart = $true
        } else {
          Add-Repair 'plugin-server-reinstall' 'failed' 'repo plugin/server 不存在'
        }
      } catch {
        Add-Repair 'plugin-server-reinstall' 'failed' ("重装失败：" + $_.Exception.Message)
      }
    } else {
      Add-Repair 'plugin-server-reinstall' 'skipped' 'server 包完整且无 repo 新文件，无需修复'
    }
  }

  # 2) ui 包
  $repoUi = Join-Path $script:RepoRoot 'plugin\client'
  $uiDir = Join-Path $nm 'dsh-pet-bridge-ui'
  if ((Test-Path -LiteralPath $uiDir) -and (Test-Path -LiteralPath $repoUi)) {
    $missing = @($req['plugin-ui'] | Where-Object { -not (Test-Path -LiteralPath (Join-Path $uiDir $_)) })
    if ($missing.Count -gt 0) {
      try {
        $bak = Join-Path $uiDir ('.selfcheck-backup-' + $stamp)
        New-Item -ItemType Directory -Force -Path $bak | Out-Null
        foreach ($f in @('package.json', 'lib', 'NOTICE', 'README.md')) {
          $src = Join-Path $uiDir $f
          if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $bak -Recurse -Force -ErrorAction SilentlyContinue }
        }
        Copy-Item -Path (Join-Path $repoUi '*') -Destination $uiDir -Recurse -Force
        Add-Repair 'plugin-ui-reinstall' 'done' '已从 repo plugin/client 重装 ui 包（含备份）'
        $script:NeedRestart = $true
      } catch {
        Add-Repair 'plugin-ui-reinstall' 'failed' ("重装失败：" + $_.Exception.Message)
      }
    } else { Add-Repair 'plugin-ui-reinstall' 'skipped' 'ui 包完整，无需修复' }
  }

  # 3) venv
  if (-not $checks.venv.ok) {
    if (-not $script:PetWork -or -not (Test-Path -LiteralPath $script:PetWork)) {
      Add-Repair 'venv-rebuild' 'failed' 'pet-work 不存在，无法创建 venv'
    } else {
      try {
        $venv = Join-Path $script:PetWork '.venv'
        if (-not (Test-Path -LiteralPath $venv)) {
          & $script:PythonExe -m venv $venv 2>&1 | Out-Null
          if ($LASTEXITCODE -ne 0) { throw "python -m venv 失败 (exit $LASTEXITCODE)" }
        }
        $reqTxt = Join-Path $script:RepoRoot 'pet\requirements.txt'
        if (Test-Path -LiteralPath $reqTxt) {
          $venvPy = Join-Path $venv 'Scripts\python.exe'
          & $venvPy -m pip install -r $reqTxt 2>&1 | Out-Null
          if ($LASTEXITCODE -ne 0) { throw "pip install -r requirements.txt 失败 (exit $LASTEXITCODE)" }
        }
        Add-Repair 'venv-rebuild' 'done' '已创建 venv 并安装 pet/requirements.txt'
      } catch {
        Add-Repair 'venv-rebuild' 'failed' ("venv 修复失败：" + $_.Exception.Message)
      }
    }
  } else { Add-Repair 'venv-rebuild' 'skipped' 'venv 正常，无需修复' }

  # 4) 计划任务
  if (-not $checks.task.ok) {
    $startScript = ''
    if ($script:PetWork) { $startScript = Join-Path $script:PetWork 'tools\start-pet.ps1' }
    try {
      if (-not $startScript -or -not (Test-Path -LiteralPath $startScript)) {
        $startScript = Join-Path $script:RepoRoot 'scripts\start-pet.ps1'
      }
      if (-not (Test-Path -LiteralPath $startScript)) { throw "start-pet.ps1 未找到（pet-work/tools 或 repo/scripts）" }
      $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScript + '"')
      Register-ScheduledTask -TaskName $TaskName -Action $action -Force -ErrorAction Stop | Out-Null
      Add-Repair 'schtask-register' 'done' ("已重新注册计划任务 " + $TaskName + " → " + $startScript)
    } catch {
      Add-Repair 'schtask-register' 'failed' ("注册失败：" + $_.Exception.Message)
    }
  } else { Add-Repair 'schtask-register' 'skipped' '计划任务正常，无需修复' }

  # 5) pipe：缺管道时尝试拉起桌宠（不强杀）
  if (-not $checks.pipe.ok) {
    $startScript = ''
    if ($script:PetWork) { $startScript = Join-Path $script:PetWork 'tools\start-pet.ps1' }
    if ($startScript -and (Test-Path -LiteralPath $startScript)) {
      try {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript | Out-Null
        Start-Sleep -Seconds 8
        $ok = Test-Path -LiteralPath $script:PipeName
        Add-Repair 'pet-start' $(if ($ok) { 'done' } else { 'failed' }) $(if ($ok) { '已拉起桌宠且管道可达' } else { '已执行 start-pet，但 8s 内管道仍不可达' })
      } catch {
        Add-Repair 'pet-start' 'failed' ("拉起桌宠失败：" + $_.Exception.Message)
      }
    } else {
      Add-Repair 'pet-start' 'failed' '未找到 start-pet.ps1（需 -PetWork）'
    }
  } else { Add-Repair 'pet-start' 'skipped' '桌宠运行正常，无需修复' }

  # 6) patch：只读，不自动改（挂载/回滚走 mount 协议）
  if ($checks.patch.state -eq 'partial' -or $checks.patch.state -eq 'missing-blocks') {
    Add-Repair 'patch-repair' 'skipped' 'patch 异常需人工/挂载工具处理（selfcheck 不自动改 patch）'
  } else { Add-Repair 'patch-repair' 'skipped' 'patch 状态无需修复' }
}

# ---------- 主流程 ----------
Resolve-Defaults
$checks = [ordered]@{}
$checks.plugin = Test-Plugin
$checks.venv = Test-Venv
$checks.task = Test-ScheduledTask
$checks.pipe = Test-Pipe
$checks.patch = Test-Patch
$checks.versions = Test-Versions

if ($Repair) {
  $preRepairIssues = @($script:Issues)
  Invoke-Repairs $checks
  $script:Issues = @()
  $checks = [ordered]@{}
  $checks.plugin = Test-Plugin
  $checks.venv = Test-Venv
  $checks.task = Test-ScheduledTask
  $checks.pipe = Test-Pipe
  $checks.patch = Test-Patch
  $checks.versions = Test-Versions
}

$errors = @($script:Issues | Where-Object { $_.severity -eq 'error' })
$warns = @($script:Issues | Where-Object { $_.severity -eq 'warn' })
$result = [ordered]@{
  healthy     = ($errors.Count -eq 0)
  issues      = @($script:Issues)
  repairs     = @($script:Repairs)
  checks      = $checks
  needRestart = $script:NeedRestart
  generatedAt = (Get-Date).ToString('o')
  repoRoot    = $script:RepoRoot
  petWork     = $script:PetWork
  profileDir  = $script:ProfileDir
}
if ($Repair) { $result['issuesBeforeRepair'] = @($preRepairIssues) }

if ($Human) {
  Write-Output ('selfcheck: ' + $(if ($result.healthy) { 'HEALTHY' } else { 'UNHEALTHY' }) + "  (errors=$($errors.Count), warnings=$($warns.Count), repairs=$(@($script:Repairs).Count))")
  foreach ($c in $checks.Keys) {
    $v = $checks[$c]
    $state = if ($v.Contains('ok') -and $v.ok) { 'ok' } else { 'check' }
    Write-Output ("  [{0}] {1}" -f $state, $c)
  }
  foreach ($i in $script:Issues) { Write-Output ("  ISSUE [{0}] {1}: {2}" -f $i.severity, $i.code, $i.detail) }
  foreach ($r in $script:Repairs) { Write-Output ("  REPAIR [{0}] {1}: {2}" -f $r.result, $r.action, $r.detail) }
}
Write-Output ($result | ConvertTo-Json -Depth 12)
exit $(if ($result.healthy) { 0 } else { 1 })
