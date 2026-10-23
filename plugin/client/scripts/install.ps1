#Requires -Version 5.1
<#
.SYNOPSIS
  安装 dsh-pet-bridge-ui（大肥鱼联动设置面板）到 DSH web profile。
  追加 patch insert + 复制插件包；不重启 DSH host（依赖 profile 的 patchReload: live 热组合）。

.DESCRIPTION
  安全约定：
    · 只「追加」cordis.patch.yml 的新 insert 块，不改任何现有行；
    · 安装前备份 patch 到 <PetWorkDir>\backup\profile-web-cordis.patch.yml.before-ui.bak；
    · 幂等：marker 已存在时只刷新插件文件，不重复追加；
    · 默认 DryRun 关闭；-DryRun 只打印计划，零写入；
    · 结束后验证：host 存活 + 插件心跳文件 + 路由探测 + 联动插件日志健康。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1 -DryRun
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
#>
param(
  [string]$ProfileDir = 'C:\Users\xiqi\.dsh\profiles\web',
  [string]$PetWorkDir = 'E:\project\AI提效\tool\pet-integration-src\pet-work',
  [int]$HostPid = 39484,
  [switch]$DryRun,
  [switch]$SkipVerify,
  [int]$WaitHeartbeatSec = 20
)

$ErrorActionPreference = 'Stop'
$sourceDir = Split-Path $PSScriptRoot -Parent
$pkgDir = Join-Path $ProfileDir 'node_modules\dsh-pet-bridge-ui'
$patchFile = Join-Path $ProfileDir 'cordis.patch.yml'
$backupDir = Join-Path $PetWorkDir 'backup'
$backupFile = Join-Path $backupDir 'profile-web-cordis.patch.yml.before-ui.bak'
$heartbeatFile = Join-Path $PetWorkDir 'evidence\ui-route-mounted.json'
$bridgeLog = Join-Path $PetWorkDir 'evidence\pet-bridge-main.log'
$marker = '# ── 大肥鱼 × DSH 联动：管理界面（Web 设置面板）'

function Write-Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "  OK  $text" -ForegroundColor Green }
function Write-Warn2([string]$text) { Write-Host "  !!  $text" -ForegroundColor Yellow }
function Write-Fail([string]$text) { Write-Host "  XX  $text" -ForegroundColor Red }

function Test-HostAlive {
  try { $p = Get-Process -Id $HostPid -ErrorAction Stop; return $p } catch { return $null }
}

function Invoke-RouteProbe {
  param([string]$Url)
  $payload = '{"rpcId":"install-probe","method":"ping"}'
  try {
    $resp = Invoke-WebRequest -Uri $Url -Method POST -ContentType 'application/json' -Body $payload -UseBasicParsing -TimeoutSec 5
    return [pscustomobject]@{ Status = [int]$resp.StatusCode; Body = [string]$resp.Content }
  } catch {
    $status = 0
    $body = ''
    if ($_.Exception.Response) {
      try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = -1 }
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        if ($stream) { $reader = New-Object System.IO.StreamReader($stream); $body = $reader.ReadToEnd() }
      } catch { $body = '' }
    }
    return [pscustomobject]@{ Status = $status; Body = $body }
  }
}

# ── 0. 前置检查 ─────────────────────────────────────────────
Write-Step '0. 前置检查'
if (-not (Test-Path (Join-Path $sourceDir 'package.json'))) { Write-Fail "源目录无效：$sourceDir"; exit 1 }
if (-not (Test-Path $patchFile)) { Write-Fail "找不到 patch 文件：$patchFile"; exit 1 }
$pkg = Get-Content (Join-Path $sourceDir 'package.json') -Raw | ConvertFrom-Json
Write-Ok "源包：$($pkg.name)@$($pkg.version)  ($sourceDir)"
$hostProc = Test-HostAlive
if ($hostProc) { Write-Ok "DSH host 存活：pid $HostPid（$($hostProc.ProcessName)）" }
else { Write-Warn2 "未找到 host pid $HostPid（可能已重启/pid 变化）；接线仍可继续，但热组合验证会失败" }

# ── 1. 备份 patch ───────────────────────────────────────────
$patchText = [System.IO.File]::ReadAllText($patchFile, [System.Text.Encoding]::UTF8)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

Write-Step '1. 备份 cordis.patch.yml'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupTarget = $backupFile
if (Test-Path $backupFile) { $backupTarget = Join-Path $backupDir "profile-web-cordis.patch.yml.before-ui-$stamp.bak" }
if (-not (Test-Path $backupDir)) { if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $backupDir | Out-Null } }
if ($DryRun) { Write-Ok "[dry-run] 将备份到：$backupTarget" }
else {
  Copy-Item -LiteralPath $patchFile -Destination $backupTarget -Force
  Write-Ok "已备份：$backupTarget"
  if ($backupTarget -ne $backupFile) { Write-Warn2 "（主备份名已存在，本次用时间戳名；回滚脚本会自动选最新 before-ui*.bak）" }
}

# ── 2. 复制插件包 ───────────────────────────────────────────
Write-Step '2. 复制插件包到 profile node_modules'
if ($DryRun) { Write-Ok "[dry-run] 将复制：$sourceDir -> $pkgDir" }
else {
  if (Test-Path $pkgDir) {
    $aside = Join-Path $backupDir "dsh-pet-bridge-ui.old-$stamp"
    Move-Item -LiteralPath $pkgDir -Destination $aside -Force
    Write-Ok "旧版本已移开：$aside"
  }
  New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceDir 'lib') -Destination $pkgDir -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $sourceDir 'package.json') -Destination $pkgDir -Force
  if (Test-Path (Join-Path $sourceDir 'README.md')) {
    Copy-Item -LiteralPath (Join-Path $sourceDir 'README.md') -Destination $pkgDir -Force
  }
  Write-Ok "已复制：$pkgDir（lib + package.json + README）"
}

# ── 3. 追加 patch insert（只追加） ──────────────────────────
Write-Step '3. 追加 patch insert（只追加，不改现有行）'
if ($patchText.Contains($marker)) {
  Write-Ok 'patch 中已存在本插件 marker，跳过追加（幂等）'
} else {
  $block = @"
$marker —— 由独立插件 dsh-pet-bridge-ui 提供（host 路由 /pet-bridge-ui + 设置页入口）
# 只读状态聚合 + sidecar 配置写（ui-config.json）；不改 pet-bridge-v7 逻辑。
# 安装/回滚：dsh-pet-bridge-ui\scripts\{install,rollback}.ps1
- insert:
    - id: pet-bridge-ui
      name: 'dsh-pet-bridge-ui'
      config:
        channel: '/pet-bridge-ui'
        logFile: 'E:\project\AI提效\tool\pet-integration-src\pet-work\evidence\pet-bridge-main.log'
        activityFile: 'E:\project\AI提效\tool\pet-integration-src\pet-work\activity.txt'
        stateFile: 'E:\project\AI提效\tool\pet-integration-src\pet-work\state.json'
        uiConfigFile: 'E:\project\AI提效\tool\pet-integration-src\pet-work\ui-config.json'
        evidenceDir: 'E:\project\AI提效\tool\pet-integration-src\pet-work\evidence'
        heartbeatFile: 'E:\project\AI提效\tool\pet-integration-src\pet-work\evidence\ui-route-mounted.json'
        defaultBudgetPerDayYuan: 1.0
        defaultModel: 'deepseek-flash'
        defaultProvider: 'deepseek-official'
"@
  # CRLF 归一（原文件是 CRLF）
  $block = ($block -replace "`r?`n", "`r`n")
  if (-not $patchText.EndsWith("`r`n")) { $patchText += "`r`n" }
  $newText = $patchText + $block + "`r`n"
  if ($DryRun) {
    Write-Ok "[dry-run] 将追加以下块（共 $((($block -split "`r`n").Count)) 行）："
    Write-Host $block -ForegroundColor DarkGray
  } else {
    # 原子写：临时文件 + Move
    $tmp = "$patchFile.ui-tmp"
    [System.IO.File]::WriteAllText($tmp, $newText, $utf8NoBom)
    Move-Item -LiteralPath $tmp -Destination $patchFile -Force
    Write-Ok "已追加 insert 块（patch 行数 +$((($block -split "`r`n").Count))）"
  }
}

# ── 4. 验证 ─────────────────────────────────────────────────
if ($SkipVerify) { Write-Step '4. 跳过验证（-SkipVerify）'; exit 0 }
Write-Step '4. 接线验证（不重启 host）'

if ($DryRun) {
  Write-Warn2 '[dry-run] 跳过运行时验证（未写入）'
  exit 0
}

Write-Host '  等待插件热组合 + 心跳文件 …'
$deadline = (Get-Date).AddSeconds($WaitHeartbeatSec)
$beat = $null
while ((Get-Date) -lt $deadline) {
  if (Test-Path $heartbeatFile) {
    try {
      $raw = Get-Content $heartbeatFile -Raw
      $beat = $raw | ConvertFrom-Json
      if ($beat.pid) { break }
    } catch { }
  }
  Start-Sleep -Milliseconds 500
}

$hostAfter = Test-HostAlive
if ($hostAfter) { Write-Ok "host 存活（pid $HostPid）" } else { Write-Fail "host pid $HostPid 已不在！请立即检查" }

if ($beat) {
  Write-Ok "插件已激活：channel=$($beat.channel) pid=$($beat.pid) version=$($beat.version) mountedAt=$($beat.mountedAt)"
} else {
  Write-Fail "未在 $WaitHeartbeatSec 秒内看到心跳文件：$heartbeatFile"
  Write-Warn2 '可能原因：HMR 未启用/未生效、插件加载失败（看 host 输出）、或需要重启 host（本任务禁止）。'
  Write-Warn2 '回滚：scripts\rollback.ps1'
}

$probe = Invoke-RouteProbe -Url 'http://127.0.0.1:3080/pet-bridge-ui/ping'
if ($probe.Status -eq 401 -or $probe.Status -eq 403) {
  Write-Ok "路由已挂载（$($probe.Status) 来自鉴权栅栏；浏览器带 cookie 访问才返回数据）"
} elseif ($probe.Status -eq 200) {
  Write-Ok "路由可直连：$($probe.Body)"
} else {
  Write-Warn2 "路由探测返回 $($probe.Status)（预期 401/403 表示已挂载并鉴权；404/200-HTML 表示未挂载）"
}

if (Test-Path $bridgeLog) {
  $tail = Get-Content $bridgeLog -Tail 40 -ErrorAction SilentlyContinue
  $errs = @($tail | Where-Object { $_ -match '\[error\]' })
  $reloads = @($tail | Where-Object { $_ -match 'loaded v7' })
  if ($errs.Count -gt 0) { Write-Warn2 "联动插件日志近 40 行有 $($errs.Count) 条 [error]，请人工确认" }
  else { Write-Ok '联动插件日志近 40 行无 [error]' }
  if ($reloads.Count -gt 0) { Write-Warn2 "检测到 pet-bridge-v7 重新加载（热组合副作用，通常无害）：$($reloads[-1])" }
}

Write-Step '安装完成'
Write-Host @"
下一步：
  1) 浏览器刷新 http://127.0.0.1:3080 → 设置（齿轮）→ 左侧「大肥鱼联动」
  2) 回滚：scripts\rollback.ps1（加 -DryRun 可预览）
  3) 状态/配置契约见 README.md
"@ -ForegroundColor Gray
