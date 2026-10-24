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
# 2.5) 发行资产自检（P0）：鲸鱼娘资产必须随包，否则会静默回退 classic。
# 说明：PyInstaller onedir 的 datas 落点统一在 _internal/，故校验
# _internal/assets/whale-girl（manifest + 174 PNG + 说明文件 ≈ 178 项）。
$wgDir = Join-Path $target '_internal\assets\whale-girl'
$wgManifest = Join-Path $wgDir 'manifest.json'
if (-not (Test-Path $wgManifest)) {
  throw "发行包缺少鲸鱼娘资产：$wgManifest 不存在（检查 pet\桌宠.spec 的 datas 是否含仓库根 assets/whale-girl）"
}
$wgFiles = @(Get-ChildItem $wgDir -Recurse -File)
$wgPng = @($wgFiles | Where-Object { $_.Extension -eq '.png' })
if ($wgPng.Count -lt 170) { throw "鲸鱼娘帧不完整：PNG=$($wgPng.Count)（期望 ≥170）" }
if ($wgFiles.Count -lt 178) { throw "鲸鱼娘资产不完整：files=$($wgFiles.Count)（期望 ≥178）" }
Write-Output "[build] assets ok: whale-girl $($wgFiles.Count) files ($($wgPng.Count) png)"

# 3) 打 zip + sha256
$zip = Join-Path $OutDir ($outName + '.zip')
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $target '*') -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
"$hash  $(Split-Path -Leaf $zip)" | Set-Content ($zip + '.sha256') -Encoding ASCII
Write-Output "[build] zip: $zip"
Write-Output "[build] sha256: $hash"
# 3.5) zip 级资产校验（发布前最后一道）：确认 zip 内确实带鲸鱼娘资产，且只带一份
# （_internal/assets/whale-girl；app 根 assets/whale-girl 属重复副本，出现即失败）。
# 注意：Compress-Archive 写出的 entry 用反斜杠分隔，这里统一归一化成正斜杠再比对。
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipObj = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
  $names = @($zipObj.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
  $wgZip = @($names | Where-Object { $_ -like '_internal/assets/whale-girl/*' })
  if ($wgZip.Count -lt 178) { throw "zip 内鲸鱼娘资产不完整：$($wgZip.Count) entries（期望 ≥178）" }
  if (-not ($wgZip -contains '_internal/assets/whale-girl/manifest.json')) {
    throw 'zip 内缺少 _internal/assets/whale-girl/manifest.json'
  }
  $rootDup = @($names | Where-Object { $_ -like 'assets/whale-girl/*' })
  if ($rootDup.Count -gt 0) { throw "zip 存在重复鲸鱼娘资产（app 根 assets/whale-girl $($rootDup.Count) 项），请只保留 _internal 一份" }
  Write-Output "[build] zip assets ok: _internal/assets/whale-girl $($wgZip.Count) entries (single copy)"
} finally { $zipObj.Dispose() }
# 4) 上传说明
Write-Output '[build] 上传：GitHub Release 附上 zip 与 .sha256（可手动拖拽，或用 PAT: gh release upload <tag> <zip> <sha256文件>）'
Write-Output '[build] 注意：发行 zip 不进 git（.gitignore 已排除 dist/）；插件自举用 lifecycle.releaseZipUrl 指向该资产。'



