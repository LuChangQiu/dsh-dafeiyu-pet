param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Profile = (Join-Path $env:USERPROFILE '.dsh\profiles\web'),
  [string]$PetWork = (Join-Path $env:USERPROFILE 'pet-work')
)
# install.ps1 — 安装/更新 dsh-pet-bridge（server）+ 管理界面（client）到 DSH profile，
# 并把两个 insert 块幂等写入 profile 的 cordis.patch.yml（模板：install/cordis.patch.template.yml）。
$ErrorActionPreference = 'Stop'
function Write-Info($m) { Write-Output "[install] $m" }
if (-not (Test-Path $RepoRoot)) { throw "repo not found: $RepoRoot" }
if (-not (Test-Path $Profile)) { throw "profile not found: $Profile" }

# 1) copy plugin packages (server + ui if present)
$pkgs = @()
$p1 = Join-Path $RepoRoot 'plugin\dsh-pet-bridge'
if (Test-Path $p1) { $pkgs += @{ src = $p1; name = 'dsh-pet-bridge' } }
$p2 = Join-Path $RepoRoot 'plugin\dsh-pet-bridge-ui'
if (Test-Path $p2) { $pkgs += @{ src = $p2; name = 'dsh-pet-bridge-ui' } }
foreach ($p in $pkgs) {
  $dst = Join-Path $Profile ("node_modules\" + $p.name)
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  Copy-Item $p.src $dst -Recurse -Force
  Write-Info ("installed package: " + $p.name)
}

# 2) cordis.patch.yml: 幂等写入 vX + ui 两个 insert 块（来自模板）
$patch = Join-Path $Profile 'cordis.patch.yml'
$tpl = Join-Path $RepoRoot 'install\cordis.patch.template.yml'
if (-not (Test-Path $patch)) { New-Item -ItemType File -Path $patch -Force | Out-Null }
if (Test-Path $tpl) {
  $cur = Get-Content $patch -Raw
  $block = (Get-Content $tpl -Raw).Replace('{{PET_WORK}}', $PetWork).Replace('{{DSH_HOME}}', (Split-Path -Parent (Split-Path -Parent $Profile)))
  foreach ($id in @('pet-bridge-v', 'pet-bridge-ui')) {
    if ($cur -notmatch [regex]::Escape($id)) {
      $cur = $cur.TrimEnd() + "`r`n" + $block
      Write-Info "appended patch block for $id"
    } else { Write-Info "patch block already present: $id" }
  }
  Set-Content -Path $patch -Value $cur -Encoding UTF8
  $hits = (Select-String -Path $patch -Pattern 'pet-bridge-v').Count
  $uiHits = (Select-String -Path $patch -Pattern 'pet-bridge-ui').Count
  Write-Info "patch self-check: pet-bridge-v hits=$hits, pet-bridge-ui hits=$uiHits"
  if ($hits -lt 1 -or $uiHits -lt 1) { throw 'patch self-check failed (missing insert block)' }
} else { Write-Info 'WARN: install/cordis.patch.template.yml not found, patch not updated' }

# 3) pet runtime: venv + 源码补丁（若本机有 python）
$petRoot = Join-Path $RepoRoot 'pet'
if (Test-Path $petRoot) {
  $venv = Join-Path $PetWork '.venv'
  if (-not (Test-Path $venv)) {
    Write-Info 'creating venv (python 3.11+) ...'
    & python -m venv $venv
    & (Join-Path $venv 'Scripts\python.exe') -m pip install -r (Join-Path $RepoRoot 'requirements.txt')
  }
  $dstPet = Join-Path $PetWork 'pet'
  if (-not (Test-Path $dstPet)) { New-Item -ItemType Directory -Force -Path $dstPet | Out-Null }
  Copy-Item (Join-Path $petRoot '*') $dstPet -Recurse -Force
}
Write-Info 'done. 重启 dsh web 后：设置页出现管理面板，桌宠由插件自动拉起（start-pet.ps1）。'
Write-Info '回滚：tools\plugin-rollback.ps1 / tools\pet-rollback.ps1'

