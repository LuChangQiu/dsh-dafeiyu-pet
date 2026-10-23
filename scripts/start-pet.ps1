param(
  [switch]$Restart,
  [switch]$WatchDog,
  [switch]$Check,
  [int]$IntervalSeconds = 30
)
# start-pet.ps1 — idempotent launcher / watchdog for the patched dafeiyu pet.
# Compatible with Windows PowerShell 5.1 and PowerShell 7 (UTF-8 with BOM).
#   -Check      -> read-only status probe, exit 0 if running+pipe else 1
#   -Restart    -> kill patched pet then start
#   -WatchDog   -> foreground loop: every N sec, restart if pipe gone
$ErrorActionPreference = 'Stop'
$petWork = Split-Path -Parent $PSScriptRoot
$petDir = Join-Path $petWork 'pet'
$pyw = Join-Path $petWork '.venv\Scripts\pythonw.exe'
$logDir = Join-Path $petWork 'logs'
$pipeName = '\\.\pipe\dafeiyu-pet-whale-single-instance'
$launcherLog = Join-Path $logDir 'start-pet.log'

function Write-Log([string]$msg) {
  Write-Output $msg
  try {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $line = "[{0}] {1}" -f (Get-Date -Format o), $msg
    Add-Content -Path $launcherLog -Value $line -Encoding UTF8
  } catch {}
}

function Get-PatchedPet {
  Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*桌宠.py*' -and $_.CommandLine -like '*pet-work*' }
}

function Test-Pet {
  $proc = @(Get-PatchedPet)
  $pipe = Test-Path $pipeName
  return [pscustomobject]@{ Running = ($proc.Count -gt 0); Pids = ($proc | ForEach-Object { $_.ProcessId }); Pipe = $pipe }
}

function Ensure-Pet {
  $st = Test-Pet
  if ($st.Running -and -not $Restart) {
    Write-Log ("patched pet already running: pid=" + ($st.Pids -join ',') + " pipe=" + $st.Pipe)
    if ($st.Pipe) { return $true }
    Write-Log 'process exists but pipe missing; will not auto-kill (use -Restart)'
    return $false
  }
  if ($st.Running) {
    foreach ($pid in $st.Pids) { & taskkill /PID $pid /T /F 2>&1 | Out-Null }
    Start-Sleep -Seconds 1
  }
  # official-dafeiyu-guard: 单实例管道只能有一个主人；官方版在跑就先清场
  Get-Process -Name '大肥鱼桌宠' -ErrorAction SilentlyContinue | ForEach-Object { & taskkill /PID $_.Id /T /F 2>&1 | Out-Null }
  if (-not (Test-Path $pyw)) { Write-Log "FAILED: missing pythonw: $pyw"; return $false }
  if (-not (Test-Path $petDir)) { Write-Log "FAILED: missing pet dir: $petDir"; return $false }
  try {
    Start-Process -FilePath $pyw -ArgumentList '"桌宠.py"' -WorkingDirectory $petDir -ErrorAction Stop | Out-Null
  } catch {
    Write-Log ("FAILED: Start-Process: " + $_.Exception.Message)
    return $false
  }
  $deadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 500
    $st = Test-Pet
  } while ((-not $st.Pipe -or -not $st.Running) -and (Get-Date) -lt $deadline)
  if ($st.Pipe -and $st.Running) {
    Write-Log ("patched pet started: pid=" + ($st.Pids -join ',') + ' pipe=ok')
    return $true
  }
  Write-Log ("FAILED: patched pet did not start (running=" + $st.Running + " pipe=" + $st.Pipe + ")")
  return $false
}

if ($Check) {
  $st = Test-Pet
  Write-Output ("status: running={0} pids={1} pipe={2}" -f $st.Running, ($st.Pids -join ','), $st.Pipe)
  if ($st.Running -and $st.Pipe) { exit 0 } else { exit 1 }
}

if ($WatchDog) {
  Write-Log "watchdog started (interval ${IntervalSeconds}s); Ctrl+C to stop"
  while ($true) {
    if (-not (Test-Path $pipeName)) {
      Write-Log 'pet pipe missing -> restarting'
      Ensure-Pet | Out-Null
    }
    Start-Sleep -Seconds ([Math]::Max(10, $IntervalSeconds))
  }
}

if (Ensure-Pet) { exit 0 } else { exit 1 }
