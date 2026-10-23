param(
  [switch]$RevertPatch,
  [switch]$StartOfficial,
  [switch]$DryRun
)
# pet-rollback.ps1 — stop patched pet, optionally revert source patch / start official pet.
# Compatible with Windows PowerShell 5.1 and PowerShell 7 (UTF-8 with BOM).
#   -DryRun       -> print the plan only, write nothing
#   -RevertPatch  -> restore 桌宠.py from 桌宠.py.bak-p1 and verify hash
#   -StartOfficial -> launch the official installed pet
$ErrorActionPreference = 'Stop'
$petWork = Split-Path -Parent $PSScriptRoot
$petFile = Join-Path $petWork 'pet\桌宠.py'
$petBackup = Join-Path $petWork 'pet\桌宠.py.bak-p1'
$applyPy = Join-Path (Split-Path -Parent (Split-Path -Parent $petWork)) 'pet-integration-src\tech-scout\plugin-skeleton\pet-patch\apply_p1.py'
$officialExe = Join-Path $env:LOCALAPPDATA 'Programs\大肥鱼桌宠\大肥鱼桌宠.exe'

function Fail([string]$msg) { Write-Output "FAILED: $msg"; exit 1 }

$patched = @(Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
  Where-Object { $_.CommandLine -like '*桌宠.py*' -and $_.CommandLine -like '*pet-work*' })

if ($DryRun) {
  Write-Output '--- DRY RUN (no writes) ---'
  Write-Output ("patched pet processes: " + (($patched | ForEach-Object { $_.ProcessId }) -join ','))
  Write-Output ("would stop: " + $patched.Count + " process(es)")
  if ($RevertPatch) {
    Write-Output ("would revert source: {0} -> from backup {1} (backup exists={2}, apply script exists={3})" -f $petFile, $petBackup, (Test-Path $petBackup), (Test-Path $applyPy))
  }
  if ($StartOfficial) {
    Write-Output ("would start official: {0} (exists={1})" -f $officialExe, (Test-Path $officialExe))
  }
  exit 0
}

# 1) stop patched pet
if ($patched.Count -eq 0) {
  Write-Output 'no patched pet python process found'
} else {
  foreach ($p in $patched) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Output "stopped patched pet pid=$($p.ProcessId)" }
    catch { Fail ("failed to stop pid=$($p.ProcessId): " + $_.Exception.Message) }
  }
  Start-Sleep -Milliseconds 500
  $left = @(Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*桌宠.py*' -and $_.CommandLine -like '*pet-work*' })
  if ($left.Count -gt 0) { Fail ('patched pet still running: ' + (($left | ForEach-Object { $_.ProcessId }) -join ',')) }
}

# 2) revert source patch
if ($RevertPatch) {
  if (-not (Test-Path $petBackup)) { Fail "missing backup: $petBackup" }
  if (-not (Test-Path $applyPy)) { Fail "missing apply script: $applyPy" }
  Copy-Item $petBackup $petFile -Force
  $want = (Get-FileHash $petBackup -Algorithm SHA256).Hash
  $got = (Get-FileHash $petFile -Algorithm SHA256).Hash
  if ($want -ne $got) { Fail "revert hash mismatch: want=$want got=$got" }
  Write-Output "reverted source, sha256 verified: $got"
}

# 3) start official pet
if ($StartOfficial) {
  if (-not (Test-Path $officialExe)) { Fail "official exe not found: $officialExe" }
  Start-Process -FilePath $officialExe -ErrorAction Stop
  Write-Output "started official pet: $officialExe"
}

Write-Output 'pet rollback done.'
exit 0
