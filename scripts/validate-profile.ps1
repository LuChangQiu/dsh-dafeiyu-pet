# cordis.patch.yml 校验（只读）
# 用法:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-profile.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-profile.ps1 -Patch "C:\Users\xiqi\.dsh\profiles\web\cordis.patch.yml"
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-profile.ps1 -DryRun
# 退出码: 0 通过; 1 校验失败; 2 参数/文件错误
param(
  [string]$Patch = "C:\Users\xiqi\.dsh\profiles\web\cordis.patch.yml",
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host "FAIL node 不可用"; exit 2 }
if (-not (Test-Path $Patch)) { Write-Host ("FAIL patch 不存在: {0}" -f $Patch); exit 2 }
if ($DryRun) {
  Write-Host "[DryRun] node scripts/validate-profile.mjs --patch <patch>"
  Write-Host ("[DryRun] patch={0} exists={1}" -f $Patch, (Test-Path $Patch))
  exit 0
}
& node (Join-Path $root "scripts\validate-profile.mjs") --patch $Patch
exit $LASTEXITCODE