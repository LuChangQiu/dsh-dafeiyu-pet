param(
  [switch]$DryRun,
  [string]$Profile = ''
)
# plugin-rollback.ps1 — v2: 不按固定版本号，glob 清理全部 dsh-pet-bridge*（含 UI），
# patch 优先用安装前干净备份，否则精准移除 pet-bridge-v* 与 pet-bridge-ui 两个 insert 块；校验无残留。
#   -DryRun           只读计划
#   -Profile <dir>    指定 profile 目录（默认 %USERPROFILE%\.dsh\profiles\web；隔离测试用）
$ErrorActionPreference = 'Stop'
$petWork = Split-Path -Parent $PSScriptRoot
if (-not $Profile) { $Profile = Join-Path $env:USERPROFILE '.dsh\profiles\web' }
$patch = Join-Path $Profile 'cordis.patch.yml'
$nm = Join-Path $Profile 'node_modules'
$cleanBackup = Join-Path $petWork 'backup\profile-web-cordis.patch.yml.bak'
$backupPkg = Join-Path $petWork 'backup\profile-web-package.json.bak'
function Fail([string]$m) { Write-Output "FAILED: $m"; exit 1 }
function BridgePkgs { @(Get-ChildItem $nm -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'dsh-pet-bridge*' }) }

if (-not (Test-Path $Profile)) { Fail "missing profile: $Profile" }
$pkgs = BridgePkgs
if ($DryRun) {
  Write-Output '--- DRY RUN (no writes) ---'
  Write-Output "profile: $Profile"
  Write-Output ("bridge packages to remove ({0}):" -f $pkgs.Count)
  $pkgs | ForEach-Object { Write-Output ("  - " + $_.Name) }
  if (Test-Path $cleanBackup) { Write-Output ("patch action: restore clean backup -> " + $cleanBackup) }
  else { Write-Output 'patch action: precise-remove pet-bridge-v* / pet-bridge-ui insert blocks' }
  if (Test-Path $patch) { Write-Output ("current patch 'pet-bridge' refs: " + ((Select-String -Path $patch -Pattern 'pet-bridge' -ErrorAction SilentlyContinue | Measure-Object).Count)) }
  exit 0
}

# 1) patch cleanup
if (Test-Path $cleanBackup) {
  $b = Get-Content $cleanBackup -Raw
  if ($b -match 'pet-bridge') { Fail 'clean backup contains pet-bridge; refusing restore' }
  Copy-Item $cleanBackup $patch -Force
  Write-Output 'restored clean patch backup'
} else {
  if (Test-Path $patch) {
    $lines = Get-Content $patch
    $out = New-Object System.Collections.Generic.List[string]
    $skip = $false
    foreach ($ln in $lines) {
      if ($ln -match '^# ── 大肥鱼 × DSH 联动') { $skip = $true; continue }
      if ($skip) {
        if ($ln -match '^\s') { continue }
        $skip = $false
      }
      if ($ln -match 'pet-bridge') { continue }
      $out.Add($ln)
    }
    $tmp = $patch + '.tmp'
    $out | Set-Content $tmp -Encoding UTF8
    Move-Item $tmp $patch -Force
    Write-Output 'precisely removed pet-bridge blocks from patch'
  }
}
$left = 0
if (Test-Path $patch) { $left = (Select-String -Path $patch -Pattern 'pet-bridge' -ErrorAction SilentlyContinue | Measure-Object).Count }
if ($left -gt 0) { Fail ("patch still has {0} pet-bridge refs after cleanup" -f $left) }
Write-Output ("patch cleaned; no pet-bridge refs; sha256=" + (Get-FileHash $patch -Algorithm SHA256).Hash)

# 2) package.json restore if differs
if (Test-Path $backupPkg) {
  $pkg = Join-Path $Profile 'package.json'
  if (Test-Path $pkg) {
    if ((Get-FileHash $pkg -Algorithm SHA256).Hash -ne (Get-FileHash $backupPkg -Algorithm SHA256).Hash) { Copy-Item $backupPkg $pkg -Force; Write-Output 'restored package.json' }
  }
}

# 3) remove packages (glob, includes UI)
$pkgs = BridgePkgs
foreach ($p in $pkgs) { Remove-Item -Recurse -Force $p.FullName; Write-Output ("removed: " + $p.Name) }
$res = BridgePkgs
if ($res.Count -gt 0) { Fail ("residual bridge dirs: " + (($res | ForEach-Object { $_.Name }) -join ',')) }
Write-Output 'plugin rollback done.'
exit 0