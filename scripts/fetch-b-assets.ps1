param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Source = '',
  [switch]$Force
)
# fetch-b-assets.ps1 — 把 B 的 50 段 WebM/HTML 注入 pet/assets/webm_body（不入 git）
$ErrorActionPreference = 'Stop'
function Info($m) { Write-Output "[b-assets] $m" }
$dst = Join-Path $RepoRoot 'pet\assets\webm_body'
$cands = @()
if ($Source) { $cands += $Source }
if ($env:DSH_PET_B_SOURCE) { $cands += $env:DSH_PET_B_SOURCE }
$cands += @(
  (Join-Path $RepoRoot 'tools\body-b\webm_pet'),
  (Join-Path $RepoRoot '..\pet-work\tools\body-b\webm_pet'),
  (Join-Path $env:USERPROFILE 'pet-work\tools\body-b\webm_pet'),
  (Join-Path $RepoRoot 'third-party\dsh-whale-girl-pet\package'),
  (Join-Path $RepoRoot 'packaging\third-party-b')
)
$src = $cands | Where-Object { $_ -and (Test-Path (Join-Path $_ 'assets')) -and (Test-Path (Join-Path $_ 'index.html')) } | Select-Object -First 1
if (-not $src) { throw "找不到 B 素材源。设置 DSH_PET_B_SOURCE 或 -Source 指向 webm_pet/package 目录。" }
Info "source=$src"
Info "dest=$dst"
if (Test-Path $dst) { if (-not $Force) { Info 'dest exists, use -Force to overwrite' } else { Remove-Item $dst -Recurse -Force } }
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'assets') | Out-Null
foreach ($f in @('index.html','clips.js','qwebchannel.js')) {
  $p = Join-Path $src $f
  if (Test-Path $p) { Copy-Item $p (Join-Path $dst $f) -Force }
}
$webm = @(Get-ChildItem (Join-Path $src 'assets') -Filter '*.webm' -File -ErrorAction SilentlyContinue)
if (-not $webm) { throw "素材源没有 assets/*.webm: $src" }
$webm | Copy-Item -Destination (Join-Path $dst 'assets') -Force
$n = @(Get-ChildItem (Join-Path $dst 'assets') -Filter '*.webm' -File).Count
Info "webm=$n"
if ($n -ne 50) { throw "B 素材应为 50 段，实际 $n" }
$lic = Join-Path $src 'LICENSE'; if (Test-Path $lic) { Copy-Item $lic (Join-Path $dst 'LICENSE') -Force }
$not = Join-Path $src 'NOTICE.md'; if (Test-Path $not) { Copy-Item $not (Join-Path $dst 'NOTICE.md') -Force }
Info 'OK. 启动桌宠前确保 pet/assets/webm_body/index.html 与 assets/50 webm 存在。'
