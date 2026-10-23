param(
  [string]$PetWork = (Join-Path $env:USERPROFILE 'pet-work'),
  [string]$RepoRoot = '',
  [string]$ReleaseUrl = '',
  [switch]$Force
)
# bootstrap-pet.ps1（产品仓版）— 幂等自举：保证桌宠在跑。
# 顺序：①已在跑（pipe 存在）→ 直接返回；②仓库 pet/ 源码 + venv 就绪 → 启动；
#       ③源码在但缺 venv → 找本机 Python 3.11+ 建 venv 装依赖 → 启动；
#       ④无 Python/无源码 → 下载 Release zip（可选，免 Python）解压启动。
# 状态写入 $PetWork\bootstrap-status.json，插件读取后上报 state.json.bootstrap。
$ErrorActionPreference = 'Continue'
$pipeName = '\\.\pipe\dafeiyu-pet-whale-single-instance'
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$statusFile = Join-Path $PetWork 'bootstrap-status.json'
$logDir = Join-Path $PetWork 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$repoPet = Join-Path $RepoRoot 'pet'
$petSrc = Join-Path $PetWork 'pet\桌宠.py'
$pythonw = Join-Path $PetWork '.venv\Scripts\pythonw.exe'

function Status($state, $step, $msg) {
  $obj = [pscustomobject]@{ status = $state; step = $step; message = $msg; at = (Get-Date -Format o) }
  try { $obj | ConvertTo-Json -Compress | Set-Content $statusFile -Encoding UTF8 } catch {}
  Write-Output ("[bootstrap] {0} / {1}: {2}" -f $state, $step, $msg)
}
function FindPython {
  foreach ($cand in @('py -3.12', 'py -3.11', 'py -3', 'python')) {
    try {
      if ($cand.StartsWith('py ')) {
        $ver = $cand.Split(' ')[1]
        $out = & py $ver -c "import sys;print(sys.executable)" 2>$null
      } else {
        $out = & python -c "import sys;print(sys.executable);raise SystemExit(0 if sys.version_info>=(3,11) else 1)" 2>$null
      }
      if ($LASTEXITCODE -eq 0 -and $out) { return (($out | Select-Object -First 1).Trim()) }
    } catch {}
  }
  return $null
}

if (-not $Force -and (Test-Path $pipeName)) { Status 'ready' 'already-running' 'pipe present'; exit 0 }

# 释放仓库内 pet/ 源码（缺失才复制，不覆盖用户 config/小票）
if (-not (Test-Path $petSrc) -and (Test-Path (Join-Path $repoPet '桌宠.py'))) {
  New-Item -ItemType Directory -Force -Path (Join-Path $PetWork 'pet') | Out-Null
  Copy-Item (Join-Path $repoPet '*') (Join-Path $PetWork 'pet') -Recurse -Force
  Status 'installing' 'source-release' 'copied repo pet/ source'
}

# ③ 建 venv（缺才建）并安装依赖
if ((Test-Path $petSrc) -and -not (Test-Path $pythonw)) {
  $py = FindPython
  if ($py) {
    Status 'installing' 'venv' ("creating venv with " + $py)
    & $py -m venv (Join-Path $PetWork '.venv') *> (Join-Path $logDir 'bootstrap-venv.log')
    if (Test-Path $pythonw) {
      $pip = Join-Path $PetWork '.venv\Scripts\python.exe'
      $req = Join-Path $repoPet 'requirements.txt'
      if (-not (Test-Path $req)) { $req = Join-Path $PetWork 'pet\requirements.txt' }
      if (Test-Path $req) { & $pip -m pip install -r $req *>> (Join-Path $logDir 'bootstrap-venv.log') }
      else { & $pip -m pip install PySide6 *>> (Join-Path $logDir 'bootstrap-venv.log') }
    }
  } else {
    Status 'fallback' 'venv' 'no python 3.11+ found, will try release zip'
  }
}

# ② 启动源码版
if ((Test-Path $petSrc) -and (Test-Path $pythonw)) {
  Status 'starting' 'source-venv' 'starting pet from source'
  Start-Process -FilePath $pythonw -ArgumentList @("$PetWork\pet\桌宠.py") -WorkingDirectory (Join-Path $PetWork 'pet') -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 4
  if (Test-Path $pipeName) { Status 'ready' 'source-venv' 'started'; exit 0 }
  Status 'failed' 'source-venv' 'started but pipe missing'; exit 1
}

# ④ Release 兜底（可选）
if ($ReleaseUrl) {
  $dist = Join-Path $PetWork 'dist'
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  $zip = Join-Path $dist 'dafeiyu-pet-win64.zip'
  Status 'downloading' 'release-zip' $ReleaseUrl
  try {
    Invoke-WebRequest -Uri $ReleaseUrl -OutFile $zip -UseBasicParsing -TimeoutSec 600
    Expand-Archive -Path $zip -DestinationPath $dist -Force
    $exe = Get-ChildItem $dist -Recurse -Filter '*.exe' | Where-Object { $_.Name -match '肥鱼|dafeiyu|pet' } | Select-Object -First 1
    if ($exe) {
      Start-Process -FilePath $exe.FullName -WorkingDirectory $exe.DirectoryName | Out-Null
      Start-Sleep -Seconds 4
      if (Test-Path $pipeName) { Status 'ready' 'release-zip' ('started ' + $exe.Name); exit 0 }
    }
    Status 'failed' 'release-zip' 'downloaded but pet did not start'
    exit 1
  } catch {
    Status 'failed' 'release-zip' ('download failed: ' + $_.Exception.Message)
    exit 1
  }
}

Status 'failed' 'no-runtime' 'no in-repo pet source/venv and no ReleaseUrl configured'
exit 1
