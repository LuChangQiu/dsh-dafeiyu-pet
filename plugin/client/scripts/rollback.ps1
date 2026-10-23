#Requires -Version 5.1
<#
.SYNOPSIS
  回滚 dsh-pet-bridge-ui：从 cordis.patch.yml 移除本插件追加块 + 删除 node_modules 包。

.DESCRIPTION
  默认方式（推荐）：按 marker 截断 —— 只删除本插件追加的那段（追加总在文件末尾），
  不会覆盖安装之后别人对 patch 的其它修改。
  -RestoreBackup：改为整文件恢复安装前备份（会丢弃安装后的其它 patch 修改，慎用）。
  不重启 host；patchReload: live 会热卸载路由。页面刷新后设置项消失。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rollback.ps1 -DryRun
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rollback.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rollback.ps1 -RestoreBackup
#>
param(
  [string]$ProfileDir = '%USERPROFILE%\.dsh\profiles\web',
  [string]$PetWorkDir = '%PET_WORK%',
  [int]$HostPid = 39484,
  [switch]$RestoreBackup,
  [switch]$KeepUiConfig,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$pkgDir = Join-Path $ProfileDir 'node_modules\dsh-pet-bridge-ui'
$patchFile = Join-Path $ProfileDir 'cordis.patch.yml'
$backupDir = Join-Path $PetWorkDir 'backup'
$heartbeatFile = Join-Path $PetWorkDir 'evidence\ui-route-mounted.json'
$uiConfigFile = Join-Path $PetWorkDir 'ui-config.json'
$marker = '# ── 大肥鱼 × DSH 联动：管理界面（Web 设置面板）'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "  OK  $text" -ForegroundColor Green }
function Write-Warn2([string]$text) { Write-Host "  !!  $text" -ForegroundColor Yellow }
function Write-Fail([string]$text) { Write-Host "  XX  $text" -ForegroundColor Red }

Write-Step '0. 前置检查'
if (-not (Test-Path $patchFile)) { Write-Fail "找不到 patch 文件：$patchFile"; exit 1 }
try { Get-Process -Id $HostPid -ErrorAction Stop | Out-Null; Write-Ok "DSH host 存活：pid $HostPid" }
catch { Write-Warn2 "未找到 host pid $HostPid（继续回滚文件，不影响）" }

Write-Step '1. 处理 cordis.patch.yml'
$text = [System.IO.File]::ReadAllText($patchFile, [System.Text.Encoding]::UTF8)

if ($RestoreBackup) {
  $candidates = @()
  $main = Join-Path $backupDir 'profile-web-cordis.patch.yml.before-ui.bak'
  if (Test-Path $main) { $candidates += Get-Item $main }
  $candidates += @(Get-ChildItem -Path $backupDir -Filter 'profile-web-cordis.patch.yml.before-ui-*.bak' -ErrorAction SilentlyContinue)
  if ($candidates.Count -eq 0) { Write-Fail "没有找到 before-ui*.bak 备份，无法 -RestoreBackup"; exit 1 }
  $src = $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $srcText = [System.IO.File]::ReadAllText($src.FullName, [System.Text.Encoding]::UTF8)
  if ($DryRun) { Write-Ok "[dry-run] 将用备份覆盖 patch：$($src.FullName)（$($srcText.Length) bytes）" }
  else {
    $tmp = "$patchFile.rollback-tmp"
    [System.IO.File]::WriteAllText($tmp, $srcText, $utf8NoBom)
    Move-Item -LiteralPath $tmp -Destination $patchFile -Force
    Write-Ok "已用备份恢复：$($src.FullName)"
  }
} elseif ($text.Contains($marker)) {
  # 从 marker 所在行（含）到文件末尾截断；同时吃掉 marker 前的空行
  $idx = $text.IndexOf($marker)
  # marker 前若是空行（\r\n\r\n 或 \n\n），把分隔空行一起删
  $prefix = $text.Substring(0, $idx)
  if ($prefix.EndsWith("`r`n`r`n")) { $prefix = $prefix.Substring(0, $prefix.Length - 2) }
  elseif ($prefix.EndsWith("`n`n")) { $prefix = $prefix.Substring(0, $prefix.Length - 1) }
  $removed = $text.Length - $prefix.Length
  if ($DryRun) {
    Write-Ok "[dry-run] 将从 marker 处截断，移除 $removed 字符；保留剩余 $($prefix.Length) 字符"
    Write-Host ($prefix.Substring([Math]::Max(0, $prefix.Length - 300))) -ForegroundColor DarkGray
  } else {
    $tmp = "$patchFile.rollback-tmp"
    [System.IO.File]::WriteAllText($tmp, $prefix, $utf8NoBom)
    Move-Item -LiteralPath $tmp -Destination $patchFile -Force
    Write-Ok "已移除追加块（$removed 字符）。patch 现有 $((($prefix -split "`n").Count)) 行"
  }
} else {
  Write-Warn2 'patch 中未找到本插件 marker（可能已回滚过）'
}

Write-Step '2. 删除插件包'
if (Test-Path $pkgDir) {
  if ($DryRun) { Write-Ok "[dry-run] 将删除：$pkgDir" }
  else {
    $aside = Join-Path $backupDir ("dsh-pet-bridge-ui.removed-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Force -Path $backupDir | Out-Null }
    Move-Item -LiteralPath $pkgDir -Destination $aside -Force
    Write-Ok "已移走插件包：$aside（确认无误后可手删）"
  }
} else { Write-Ok '插件包已不存在' }

Write-Step '3. 清理运行时痕迹'
foreach ($f in @($heartbeatFile)) {
  if (Test-Path $f) {
    if ($DryRun) { Write-Ok "[dry-run] 将删除：$f" }
    else { Remove-Item -LiteralPath $f -Force; Write-Ok "已删除：$f" }
  }
}
if (-not $KeepUiConfig -and (Test-Path $uiConfigFile)) {
  if ($DryRun) { Write-Ok "[dry-run] 将保留 ui-config.json（默认保留用户配置；-KeepUiConfig 显式保留）" }
  else { Write-Warn2 "保留用户配置：$uiConfigFile（如需清空请手删；不 -KeepUiConfig 时也不主动删，避免丢用户设置）" }
}

Write-Step '4. 验证'
try {
  Get-Process -Id $HostPid -ErrorAction Stop | Out-Null
  Write-Ok "host 仍存活（pid $HostPid）"
} catch { Write-Warn2 "host pid $HostPid 不在（可能本来已重启）" }

if (-not $DryRun) {
  # 路由卸载后：请求应落到静态/鉴权层，不再是我们 handler。心跳文件已删即视为卸载完成。
  Write-Ok '回滚完成；浏览器刷新后设置页不再出现「大肥鱼联动」'
  Write-Host '  如需整文件恢复：-RestoreBackup；如需重新安装：scripts\install.ps1' -ForegroundColor Gray
}

