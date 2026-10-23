param([switch]$Format)
# lint.ps1 — 代码规范检查（不改行为）：node --check 全部 JS + prettier 检查 + ruff（若安装）
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
    if ($LASTEXITCODE -ne 0) { Write-Output 'WARN: prettier check failed (run npm run format)'; exit 1 }
  } else { Write-Output 'SKIP: prettier 未安装（npm install）' }
  $ruff = Get-Command ruff -ErrorAction SilentlyContinue
  if ($ruff) {
    Write-Output '== ruff =='
    & ruff check pet --config ruff.toml
    if ($LASTEXITCODE -ne 0) { Write-Output 'WARN: ruff 有问题（见上）'; exit 1 }
  } else { Write-Output 'SKIP: ruff 未安装（uv pip install ruff）' }
  Write-Output 'LINT OK'
  exit 0
} finally { Pop-Location }
