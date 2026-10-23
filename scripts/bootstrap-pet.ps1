param(
  [string]$PetWork = (Join-Path $env:USERPROFILE 'pet-work'),
  [string]$ReleaseUrl = '',
  [switch]$Force
)
# bootstrap-pet.ps1 — 幂等自举：保证补丁版桌宠在跑。
# 顺序：①已在跑（pipe 存在）→ 直接返回；②源码+venv 就绪 → start-pet.ps1；
#       ③源码在但缺 venv → 找本机 Python3.11+ 建 venv 装依赖 → start-pet；
#       ④源码缺失/无 Python → 下载 Release zip（免 Python）解压并启动 exe。
# 状态写入 $PetWork\bootstrap-status.json，插件读取后上报 state.json.bootstrap。
$ErrorActionPreference = 'Continue'
$pipeName = '\\.\pipe\dafeiyu-pet-whale-single-instance'
$statusFile = Join-Path $PetWork 'bootstrap-status.json'
$logDir = Join-Path $PetWork 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Status($state, $step, $msg) {
  $obj = [pscustomobject]@{ status = $state; step = $step; message = $msg; at = (Get-Date -Format o) }
  try { $obj | ConvertTo-Json -Compress | Set-Content $statusFile -Encoding UTF8 } catch {}
  Write-Output ("[bootstrap] {0} / {1}: {2}" -f $state, $step, $msg)
}
function PetRunning { [bool](Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*桌宠.py*' -and $_.CommandLine -like '*pet-work*' }) }
function FindPython {
  $cands = @()
  try { $py = (py -3.11 -c "import sys;print(sys.executable)" 2>$null); if ($LASTEXITCODE -eq 0 -and $py) { $cands += $py.Trim() } } catch {}
  try { $py2 = (py -3.12 -c "import sys;print(sys.executable)" 2>$null); if ($LASTEXITCODE -eq 0 -and $py2) { $cands += $py2.Trim() } } catch {}
  if (Get-Command python -ErrorAction SilentlyContinue) {
    $ver = (python -c "import sys;print(sys.version_info[:2])" 2>$null)
    if ($ver -match '3, (1[1-9]|[2-9][0-9])') { $cands += (Get-Command python).Source }
  }
  return ($cands | Select-Object -First 1)
}

if (-not $Force -and (Test-Path $pipeName)) { Status 'ready' 'already-running' 'pipe present'; exit 0 }

$petSrc = Join-Path $PetWork 'pet\桌宠.py'
$pythonw = Join-Path $PetWork '.venv\Scripts\pythonw.exe'
$startScript = Join-Path $PetWork 'tools\start-pet.ps1'
$reqFile = Join-Path $PetWork 'pet\requirements.txt'

# ② 源码+venv 就绪
if ((Test-Path $petSrc) -and (Test-Path $pythonw)) {
  Status 'starting' 'source-venv' 'source + venv ready'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript *> (Join-Path $logDir 'bootstrap-start.log')
  if (Test-Path $pipeName) { Status 'ready' 'source-venv' 'started'; exit 0 }
  Status 'failed' 'source-venv' 'start-pet failed (see logs\start-pet.log)'; exit 1
}

# ③ 源码在但缺 venv：找 python 建 venv
if ((Test-Path $petSrc) -and -not (Test-Path $pythonw)) {
  $py = FindPython
  if ($py) {
    Status 'installing' 'venv' ("creating venv with " + $py)
    & $py -m venv (Join-Path $PetWork '.venv') *> (Join-Path $logDir 'bootstrap-venv.log')
    if (Test-Path $pythonw) {
      $pip = Join-Path $PetWork '.venv\Scripts\python.exe'
      if (Test-Path $reqFile) { & $pip -m pip install -r $reqFile *>> (Join-Path $logDir 'bootstrap-venv.log') }
      else { & $pip -m pip install PySide6 *>> (Join-Path $logDir 'bootstrap-venv.log') }
      Status 'starting' 'venv' 'venv ready, starting'
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript *> (Join-Path $logDir 'bootstrap-start.log')
      if (Test-Path $pipeName) { Status 'ready' 'venv' 'started'; exit 0 }
      Status 'failed' 'venv' 'start failed after install'
      exit 1
    }
  } else {
    Status 'fallback' 'venv' 'no python 3.11+ found, will try release zip'
  }
}

# ④ 下载 Release zip（免 Python）
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

Status 'failed' 'no-runtime' 'no source/venv and no ReleaseUrl configured'
exit 1
