param([ValidateSet('quiet','normal','lively')][string]$Level)
# set-activity.ps1 — switch the dafeiyu bridge activity level without touching DSH config (live, no reload).
$petWork = Split-Path -Parent $PSScriptRoot
$file = Join-Path $petWork 'activity.txt'
$Level | Set-Content -Path $file -Encoding ASCII
Write-Output "activity -> $Level (written: $file)"