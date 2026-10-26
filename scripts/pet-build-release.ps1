param(
  [string]$Version = '1.1.5-dsh.2-whalegirl',
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$OutDir = '',
  [string]$PythonExe = 'python',
  [string]$BWeb = ''
)
# pet-build-release.ps1 — B-only 桌宠发行包入口（兼容保留）。
# 真正实现统一在 packaging/build-b-only.ps1：B 素材注入、根级 INSTALL/selfcheck/许可、UTF-8 zip。
$ErrorActionPreference = 'Stop'
$impl = Join-Path $RepoRoot 'packaging\build-b-only.ps1'
if (-not (Test-Path $impl)) { throw "B-only build script missing: $impl" }
$args = @('-Build', '-Version', $Version, '-PythonExe', $PythonExe)
if ($OutDir) { $args += @('-OutDir', $OutDir) }
if ($BWeb) { $args += @('-BWeb', $BWeb) }
& powershell -NoProfile -ExecutionPolicy Bypass -File $impl @args
if ($LASTEXITCODE -ne 0) { throw "B-only build failed ($LASTEXITCODE)" }
