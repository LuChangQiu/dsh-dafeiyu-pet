# task-138：B PASS 后删除 A（鲸尾女仆）外观/素材/回退展示
# 默认 dry-run 只列路径/大小；-Execute 才删除（先备份到 backups/task-138-<ts>/）。
param([switch]$Execute)
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PetWork = Split-Path -Parent (Split-Path -Parent $RepoRoot)
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $PetWork "backups\task-138-$ts"
$targets = @(
  @{path = Join-Path $RepoRoot 'assets\whale-girl'; note = 'A 外观素材（16.7MB）'},
  @{path = Join-Path $RepoRoot 'pet\sprites'; note = 'A 精灵/眼嘴部件（约 1MB）'},
  @{path = Join-Path $RepoRoot 'pet\whale_skin.py'; note = 'A 皮肤/帧播放代码'},
  @{path = (Join-Path $env:APPDATA '大肥鱼桌宠\custom_skins'); note = '用户自定义皮肤（A 相关）'},
  @{path = (Join-Path $env:APPDATA '大肥鱼桌宠\skin_library'); note = '皮肤库（A 相关）'}
)
$rows = @()
foreach ($t in $targets) {
  if (Test-Path $t.path) {
    $item = Get-Item $t.path
    if ($item.PSIsContainer) {
      $mb = [math]::Round((Get-ChildItem $t.path -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 2)
      $files = @(Get-ChildItem $t.path -Recurse -File).Count
    } else {
      $mb = [math]::Round($item.Length / 1MB, 2); $files = 1
    }
    $rows += [pscustomobject]@{path = $t.path; note = $t.note; mb = $mb; files = $files; exists = $true}
  } else {
    $rows += [pscustomobject]@{path = $t.path; note = $t.note; mb = 0; files = 0; exists = $false}
  }
}
$rows | Format-Table -AutoSize
$total = [math]::Round(($rows | Measure-Object mb -Sum).Sum, 2)
Write-Output ("[task-138] total={0}MB (dry-run={1})" -f $total, (-not $Execute))
if (-not $Execute) {
  Write-Output '[task-138] 未删除。B 最终 PASS 后由 Lead 批准，再执行 -Execute（会先备份到 backups/task-138-<ts>/）。'
  exit 0
}
New-Item -ItemType Directory -Force -Path $backup | Out-Null
foreach ($r in $rows) {
  if (-not $r.exists) { continue }
  $name = Split-Path -Leaf $r.path
  Copy-Item -Recurse -Force $r.path (Join-Path $backup $name)
  Remove-Item -Recurse -Force $r.path
  Write-Output ("[task-138] removed {0} ({1}MB) -> backup {2}" -f $r.path, $r.mb, $backup)
}
Write-Output "[task-138] done; backup=$backup"
