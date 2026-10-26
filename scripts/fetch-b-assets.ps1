param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Source = '',
  [string]$DestPet = '',
  [switch]$Force,
  [switch]$DryRun
)
# fetch-b-assets.ps1 — 把 B 的 50 段 WebM/HTML 注入 pet/assets/webm_body（B 素材不入 git）。
# 用法：
#   powershell -File scripts\fetch-b-assets.ps1                         # 注入到本仓 pet/
#   powershell -File scripts\fetch-b-assets.ps1 -DestPet <pet-work\pet> # 注入到源码安装目录
#   powershell -File scripts\fetch-b-assets.ps1 -DryRun                 # 只检查源/目标，零写入
# 源：-Source、DSH_PET_B_SOURCE、repo/tools、pet-integration-src/pet-work/tools、third-party。
$ErrorActionPreference = 'Stop'
function Info($m) { Write-Output "[b-assets] $m" }
function Fail($m) { throw "[b-assets] $m" }

if (-not $DestPet) { $DestPet = Join-Path $RepoRoot 'pet' }
$dst = Join-Path $DestPet 'assets\webm_body'
$cands = New-Object System.Collections.ArrayList
if ($Source) { [void]$cands.Add($Source) }
if ($env:DSH_PET_B_SOURCE) { [void]$cands.Add($env:DSH_PET_B_SOURCE) }
[void]$cands.Add((Join-Path $RepoRoot 'tools\body-b\webm_pet'))
[void]$cands.Add((Join-Path $RepoRoot '..\pet-integration-src\pet-work\tools\body-b\webm_pet'))
[void]$cands.Add((Join-Path $RepoRoot '..\pet-work\tools\body-b\webm_pet'))
[void]$cands.Add((Join-Path $env:USERPROFILE 'pet-work\tools\body-b\webm_pet'))
[void]$cands.Add((Join-Path $RepoRoot 'third-party\dsh-whale-girl-pet\package'))
$src = $null
foreach ($c in $cands) {
  if (-not $c) { continue }
  try {
    if ((Test-Path (Join-Path $c 'index.html')) -and (Test-Path (Join-Path $c 'assets'))) { $src = $c; break }
  } catch { }
}
if (-not $src) {
  Fail ("找不到 B 素材源。可用 -Source 或 DSH_PET_B_SOURCE 指向 webm_pet 目录。候选：" + ($cands -join '; '))
}
$webm = @(Get-ChildItem (Join-Path $src 'assets') -Filter '*.webm' -File -ErrorAction SilentlyContinue)
Info "source=$src"
Info "dest=$dst"
Info "webm=$($webm.Count)"
if ($webm.Count -ne 50) { Fail "B 素材应为 50 段，实际 $($webm.Count)：$src" }
$hasLic = Test-Path (Join-Path $src 'LICENSE')
$hasNotice = Test-Path (Join-Path $src 'NOTICE.md')
if ($DryRun) {
  Info ('DryRun：不写入。将复制 index.html/clips.js/qwebchannel.js + 50 webm' + $(if ($hasLic) { ' + LICENSE' } else { '' }) + $(if ($hasNotice) { ' + NOTICE' } else { '' }))
  exit 0
}
if ((Test-Path $dst) -and -not $Force) {
  Info '目标已存在；加 -Force 覆盖。当前未写入。'
  exit 0
}
try {
  if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Join-Path $dst 'assets') | Out-Null
  foreach ($f in @('index.html', 'clips.js', 'qwebchannel.js')) {
    $p = Join-Path $src $f
    if (Test-Path $p) { Copy-Item -LiteralPath $p -Destination (Join-Path $dst $f) -Force }
  }
  foreach ($w in $webm) { Copy-Item -LiteralPath $w.FullName -Destination (Join-Path $dst 'assets') -Force }
  if ($hasLic) { Copy-Item -LiteralPath (Join-Path $src 'LICENSE') -Destination (Join-Path $dst 'LICENSE') -Force }
  if ($hasNotice) { Copy-Item -LiteralPath (Join-Path $src 'NOTICE.md') -Destination (Join-Path $dst 'NOTICE.md') -Force }
  # B 静帧：源同级的 placeholder.png，或 repo packaging/third-party-b
  $ph = Join-Path (Split-Path -Parent $src) 'placeholder.png'
  if (-not (Test-Path $ph)) { $ph = Join-Path $RepoRoot 'packaging\third-party-b\placeholder.png' }
  if (Test-Path $ph) {
    $destBody = Join-Path $DestPet 'assets\body-b'
    New-Item -ItemType Directory -Force -Path $destBody | Out-Null
    Copy-Item -LiteralPath $ph -Destination (Join-Path $destBody 'placeholder.png') -Force
  }
} catch {
  Fail ("写入失败：" + $_.Exception.Message)
}
$n = @(Get-ChildItem (Join-Path $dst 'assets') -Filter '*.webm' -File).Count
if ($n -ne 50) { Fail "复制后 webm 数量 $n（应为 50）" }
Info "OK：$n 段 webm 已注入 $dst"
