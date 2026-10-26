# B-only 桌宠发行打包（PyInstaller onedir）
# 默认 dry-run；-Build 才真正打包（等 B PASS 后由 Lead 批准）。
param(
  [switch]$Build,
  [string]$Version = '1.1.5-dsh.2-whalegirl',
  [string]$PythonExe = 'python',
  [string]$BWeb = ''
)
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$OutRoot = Join-Path $RepoRoot 'dist-b'
$Stage = Join-Path $OutRoot 'stage'
$PetStage = Join-Path $Stage 'pet'
Write-Output "[b-only] repo=$RepoRoot version=$Version build=$Build"

# 0) 源检查（B 素材不入 git：优先显式 -BWeb/env，其次 repo tools，再 pet-work/tools）
if (-not $BWeb) { $BWeb = $env:DSH_PET_B_WEB }
if (-not $BWeb) {
  $cands = @(
    (Join-Path $RepoRoot 'tools\body-b\webm_pet'),
    (Join-Path (Split-Path -Parent (Split-Path -Parent $RepoRoot)) 'tools\body-b\webm_pet')
  )
  foreach ($c in $cands) { if (Test-Path (Join-Path $c 'index.html')) { $BWeb = $c; break } }
}
if (-not $BWeb) { throw 'B 素材目录未指定：用 -BWeb 或 DSH_PET_B_WEB 指向 webm_pet' }
$BWebm = Join-Path $BWeb 'assets'
$Placeholder = Join-Path (Split-Path -Parent $BWeb) 'placeholder.png'
if (-not (Test-Path $Placeholder)) { $Placeholder = Join-Path $RepoRoot 'pet\assets\body-b\placeholder.png' }
$SpecSrc = Join-Path $PSScriptRoot '桌宠-b-only.spec'
if (-not (Test-Path (Join-Path $BWeb 'index.html'))) { throw "B 预览素材缺失: $BWeb" }
if (-not (Test-Path $SpecSrc)) { throw "spec 缺失: $SpecSrc" }
$webmCount = @(Get-ChildItem $BWebm -Filter '*.webm' -File).Count
if ($webmCount -lt 50) { throw "B WebM 数量不足: $webmCount < 50" }

# 1) 清 stage
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path (Join-Path $PetStage 'assets\icons'), `
  (Join-Path $PetStage 'assets\webm_body\assets'), (Join-Path $PetStage 'assets\body-b') | Out-Null

# 2) pet 代码（不含 A assets/sprites/custom_skins）
Copy-Item (Join-Path $RepoRoot 'pet\*.py') $PetStage -Force
Copy-Item (Join-Path $RepoRoot 'pet\icon.ico') $PetStage -Force
if (Test-Path (Join-Path $RepoRoot 'pet\requirements.txt')) {
  Copy-Item (Join-Path $RepoRoot 'pet\requirements.txt') $PetStage -Force
}
Copy-Item (Join-Path $RepoRoot 'pet\assets\icons\*') (Join-Path $PetStage 'assets\icons') -Recurse -Force

# 3) B 包注入（代码/HTML + 50 段 WebM；不入 git）
Copy-Item (Join-Path $BWeb 'index.html'), (Join-Path $BWeb 'clips.js'), `
  (Join-Path $BWeb 'qwebchannel.js') (Join-Path $PetStage 'assets\webm_body') -Force
Copy-Item (Join-Path $BWebm '*.webm') (Join-Path $PetStage 'assets\webm_body\assets') -Force
Copy-Item $Placeholder (Join-Path $PetStage 'assets\body-b\placeholder.png') -Force

# 4) 许可 / NOTICE / PROVENANCE
Copy-Item (Join-Path $BWeb 'LICENSE') (Join-Path $PetStage 'LICENSE-B.txt') -Force
Copy-Item (Join-Path $BWeb 'NOTICE.md') (Join-Path $PetStage 'NOTICE-B.md') -Force
Copy-Item (Join-Path $PSScriptRoot 'PROVENANCE-B.md') (Join-Path $PetStage 'PROVENANCE-B.md') -Force
Copy-Item $SpecSrc (Join-Path $PetStage '桌宠-b-only.spec') -Force

# 5) 体积估算
$petMB = [math]::Round((Get-ChildItem $PetStage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
$bMB = [math]::Round((Get-ChildItem (Join-Path $PetStage 'assets\webm_body\assets') -Filter '*.webm' | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Output "[b-only] stage=$PetStage pet+assets=${petMB}MB (含 B WebM ${bMB}MB, ${webmCount} clip)"
Write-Output '[b-only] 预估 onedir 300-380MB / zip 120-190MB（PySide6+QtWebEngine，实际以构建为准）'
Write-Output '[b-only] 排除：assets/whale-girl、pet/sprites、custom_skins、skin_library'

if (-not $Build) {
  Write-Output '[b-only] dry-run 完成；未打包。确认 B PASS 后加 -Build 执行。'
  exit 0
}

# 6) PyInstaller 构建（B-only spec）
$dist = Join-Path $OutRoot 'dist'
$work = Join-Path $OutRoot 'build'
New-Item -ItemType Directory -Force -Path $dist, $work | Out-Null
Push-Location $PetStage
try {
  & $PythonExe -m PyInstaller --noconfirm --clean --distpath $dist --workpath $work '桌宠-b-only.spec'
  if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed ($LASTEXITCODE)" }
} finally { Pop-Location }

$appDir = Get-ChildItem $dist -Directory | Where-Object { $_.Name -match '桌宠' } | Select-Object -First 1
if (-not $appDir) { throw '未找到构建输出目录' }
$target = Join-Path (Join-Path $OutRoot $Version) ("dafeiyu-pet-win64-$Version")
New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
Move-Item $appDir.FullName $target
$zip = Join-Path $OutRoot ("dafeiyu-pet-win64-$Version.zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $target '*') -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
"$hash  $(Split-Path -Leaf $zip)" | Set-Content ($zip + '.sha256') -Encoding ASCII
Write-Output "[b-only] zip=$zip"
Write-Output "[b-only] sha256=$hash"
