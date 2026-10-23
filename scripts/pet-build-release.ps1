param(
  [string]$Version = '1.1.5-dsh.1',
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$OutDir = '',
  [string]$PythonExe = 'python'
)
# pet-build-release.ps1 — 从本仓 pet/ 源码可重复构建免 Python 的桌宠发行包（PyInstaller onedir）。
# 产物：dist\<Version>\dafeiyu-pet-win64\ + dafeiyu-pet-win64-<Version>.zip + .sha256
# 依赖：本机 Python 3.11+、pip install pyinstaller（脚本会给出提示）。
$ErrorActionPreference = 'Stop'
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot 'dist' }
$petSpec = Join-Path $RepoRoot 'pet\桌宠.spec'
if (-not (Test-Path $petSpec)) { throw "spec not found: $petSpec" }
Write-Output "[build] version=$Version repo=$RepoRoot"

# 1) 检查 pyinstaller
$pyinst = $null
try { $pyinst = (& $PythonExe -m PyInstaller --version 2>$null) } catch {}
if (-not $pyinst) {
  Write-Output '[build] PyInstaller 未安装：请先运行 `python -m pip install pyinstaller`（或 uv pip install pyinstaller）'
  exit 2
}
Write-Output "[build] PyInstaller $pyinst"

# 2) 构建 onedir
$work = Join-Path $OutDir 'build'
$dist = Join-Path $OutDir 'dist'
New-Item -ItemType Directory -Force -Path $work, $dist | Out-Null
Push-Location $RepoRoot
try {
  & $PythonExe -m PyInstaller --noconfirm --clean --distpath $dist --workpath $work $petSpec
  if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed (exit $LASTEXITCODE)" }
} finally { Pop-Location }

$appDir = Get-ChildItem $dist -Directory | Where-Object { $_.Name -match '桌宠|dafeiyu|pet' } | Select-Object -First 1
if (-not $appDir) { throw 'build output dir not found in dist' }
$outName = "dafeiyu-pet-win64-$Version"
$target = Join-Path $OutDir $outName
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
Move-Item $appDir.FullName $target

# 3) 打 zip + sha256
$zip = Join-Path $OutDir ($outName + '.zip')
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $target '*') -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
"$hash  $(Split-Path -Leaf $zip)" | Set-Content ($zip + '.sha256') -Encoding ASCII
Write-Output "[build] zip: $zip"
Write-Output "[build] sha256: $hash"

# 4) 上传说明
Write-Output '[build] 上传：GitHub Release 附上 zip 与 .sha256（可手动拖拽，或用 PAT: gh release upload <tag> <zip> <sha256文件>）'
Write-Output '[build] 注意：发行 zip 不进 git（.gitignore 已排除 dist/）；插件自举用 lifecycle.releaseZipUrl 指向该资产。'



