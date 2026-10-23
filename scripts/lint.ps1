param([switch]$Format)
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
  Write-Output '== node --check (all plugin/scripts JS) =='
  & node scripts\lint.mjs
  if ($LASTEXITCODE -ne 0) { Write-Output 'FAIL: node syntax'; exit 1 }
  if (Test-Path 'node_modules\.bin\prettier.cmd') {
    Write-Output '== prettier =='
    & node_modules\.bin\prettier.cmd --check "plugin/**/*.js"
    if ($LASTEXITCODE -ne 0) { Write-Output 'FAIL: prettier（运行 npm run format）'; exit 1 }
  } else { Write-Output 'FAIL: prettier 未安装（npm install）'; exit 1 }
  $ruffOk = $false
  if (Get-Command ruff -ErrorAction SilentlyContinue) { $ruffCmd = 'ruff'; $ruffOk = $true }
  else { try { $null = & python -m ruff --version 2>$null; if ($LASTEXITCODE -eq 0) { $ruffCmd = 'python -m ruff'; $ruffOk = $true } } catch {} }
  if (-not $ruffOk) {
    Write-Output 'FAIL: ruff 未安装（pip install ruff / uv pip install ruff），不能跳过'
    exit 1
  }
  Write-Output '== ruff =='
  if ($ruffCmd -eq 'ruff') { & ruff check pet --config ruff.toml } else { & python -m ruff check pet --config ruff.toml }
  if ($LASTEXITCODE -ne 0) { Write-Output 'FAIL: ruff（见上，修复或加精确 noqa 并记录 CODE-STYLE）'; exit 1 }
  Write-Output 'LINT OK'
  exit 0
} finally { Pop-Location }
