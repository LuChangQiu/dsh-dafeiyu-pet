# B-only 发行包冒烟自检（打包后运行；会短暂停/起桌宠，需 -Force）
# 检查：启动即 B、单窗 168x198、50 clip 加载、kill-switch B 静帧、点击回应+台词基础链路。
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [switch]$Force,
  [int]$WaitSeconds = 12
)
$ErrorActionPreference = 'Stop'
if (-not $Force) { throw '该脚本会停掉当前桌宠并短暂显示测试进程；确认后加 -Force（B PASS 后由 Lead 执行）' }
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PetCmd = Join-Path $RepoRoot 'tools\pet-cmd.mjs'
$Py = Join-Path $RepoRoot '.venv\Scripts\python.exe'
$Out = Join-Path $RepoRoot 'evidence\whale-b\packaging-smoke'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$SmokeLog = Join-Path $Out 'anim-log-smoke.txt'
if (Test-Path $SmokeLog) { Remove-Item $SmokeLog -Force }
$checks = New-Object System.Collections.ArrayList
function Add-Check([string]$name, [bool]$ok, [string]$detail = '') {
  [void]$checks.Add([pscustomobject]@{name = $name; ok = $ok; detail = $detail})
  Write-Output ("[{0}] {1} {2}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $name, $detail)
}
function Get-PetPids() {
  @(Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='QtWebEngineProcess.exe'" |
    Where-Object { $_.CommandLine -like '*桌宠*' -or $_.Name -eq 'QtWebEngineProcess.exe' })
}
function Get-VisibleWindows([int]$procId) {
  $code = @'
import ctypes, ctypes.wintypes as wt, json, sys
pid = int(sys.argv[1])
u = ctypes.windll.user32
rows = []
@ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
def cb(h, l):
    if not u.IsWindowVisible(h):
        return True
    p = wt.DWORD(0)
    u.GetWindowThreadProcessId(h, ctypes.byref(p))
    if p.value != pid:
        return True
    n = u.GetWindowTextLengthW(h)
    if n <= 0:
        return True
    b = ctypes.create_unicode_buffer(n + 1)
    u.GetWindowTextW(h, b, n + 1)
    r = wt.RECT()
    u.GetWindowRect(h, ctypes.byref(r))
    rows.append({"title": b.value, "x": r.left, "y": r.top, "w": r.right-r.left, "h": r.bottom-r.top})
    return True
u.EnumWindows(cb, 0)
print(json.dumps(rows, ensure_ascii=False))
'@
  $json = & $Py -c $code $procId 2>$null
  try { return @($json | ConvertFrom-Json) } catch { return @() }
}

# 1) 停生产（仅 -Force）
$old = @(Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" | Where-Object { $_.CommandLine -like '*pet_app.py*' })
foreach ($p in $old) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output "[smoke] stopped old pet pid=$($p.ProcessId)" }
Start-Sleep -Seconds 2

# 2) 备份 APPDATA 配置（打包版读取 %APPDATA%\大肥鱼桌宠\config.json）
$appCfgDir = Join-Path $env:APPDATA '大肥鱼桌宠'
$bak = Join-Path $Out 'config-appdata-backup.json'
if (Test-Path (Join-Path $appCfgDir 'config.json')) {
  Copy-Item (Join-Path $appCfgDir 'config.json') $bak -Force
}

# 3) 启动候选 exe（B-only）
$proc = Start-Process -FilePath $Exe -PassThru -WorkingDirectory (Split-Path -Parent $Exe) -WindowStyle Normal
Start-Sleep -Seconds $WaitSeconds
$pet = @(Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" | Where-Object { $_.CommandLine -like '*桌宠*' -or $_.ExecutablePath -eq $Exe } | Select-Object -First 1)
$mainPid = if ($pet) { $pet.ProcessId } else { $proc.Id }
$wins = @(Get-VisibleWindows $mainPid)
$bWins = @($wins | Where-Object { $_.title -like 'whale-girl*' })
Add-Check '启动后存在 B 窗口' ($bWins.Count -eq 1) ("count=" + $bWins.Count)
if ($bWins.Count -eq 1) {
  Add-Check 'B 窗口 168x198' ($bWins[0].w -eq 168 -and $bWins[0].h -eq 198) ("{0}x{1}" -f $bWins[0].w, $bWins[0].h)
  Add-Check '单窗（无旧 A 窗）' ($wins.Count -eq 1) ("visible=" + $wins.Count)
}
$qwe = @(Get-CimInstance Win32_Process -Filter "Name='QtWebEngineProcess.exe'")
Add-Check 'QtWebEngineProcess 子进程存在' ($qwe.Count -ge 1) ("count=" + $qwe.Count)

# 4) 加载日志（PET_ANIM_LOG 由启动环境写入；打包版沿用源码日志路径）
$logCandidates = @($SmokeLog, (Join-Path $env:APPDATA '大肥鱼桌宠\anim-log.txt'),
  (Join-Path (Split-Path -Parent $Exe) 'anim-log.txt'))
$logText = ''
foreach ($p in $logCandidates) {
  if (Test-Path $p) { $logText += (Get-Content $p -Raw -Encoding UTF8); break }
}
Add-Check 'B 初始化日志存在' ($logText -match 'webm init')
Add-Check '50 clip 加载' ($logText -match 'clips=50') (($logText -split "`n" | Where-Object { $_ -match 'clips=' } | Select-Object -Last 1))

# 5) kill-switch（B 静帧）
& node $PetCmd 'cmd:body:png' | Out-Null
Start-Sleep -Seconds 2
$wins2 = @(Get-VisibleWindows $mainPid)
$staticWins = @($wins2 | Where-Object { $_.title -like 'whale-girl static*' })
Add-Check 'kill-switch -> B 静帧窗口' ($staticWins.Count -eq 1) ("count=" + $staticWins.Count)
& node $PetCmd 'cmd:body:webm' | Out-Null
Start-Sleep -Seconds 4
$wins3 = @(Get-VisibleWindows $mainPid)
Add-Check 'cmd:body:webm 恢复 B' (@($wins3 | Where-Object { $_.title -like 'whale-girl webm*' }).Count -eq 1)

# 6) 点击回应 + 台词基础链路
$before = 0
if (Test-Path $SmokeLog) { $before = (Get-Content $SmokeLog).Count }
& node $PetCmd 'dev:click' | Out-Null
Start-Sleep -Seconds 2
$after = if (Test-Path $SmokeLog) { Get-Content $SmokeLog } else { @() }
$new = if ($after.Count -gt $before) { $after[$before..($after.Count - 1)] } else { @() }
Add-Check '点击事件进日志' (@($new | Where-Object { $_ -match 'clicked' }).Count -ge 1)
Add-Check '点击回应 clip 播放' (@($new | Where-Object { $_ -match '点击回应' }).Count -ge 1)
Add-Check '台词链路（speech say/请求）' (@($new | Where-Object { $_ -match 'speech' }).Count -ge 1)

# 7) 清理
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" | Where-Object { $_.ExecutablePath -eq $Exe -or $_.CommandLine -like '*桌宠*' })) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
if (Test-Path $bak) { Copy-Item $bak (Join-Path $appCfgDir 'config.json') -Force; Write-Output '[smoke] APPDATA config restored' }
$result = [pscustomobject]@{ exe = $Exe; checks = $checks; pass = (@($checks | Where-Object { -not $_.ok }).Count -eq 0); when = (Get-Date).ToString('o') }
$result | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Out 'smoke-result.json') -Encoding UTF8
Copy-Item $SmokeLog (Join-Path $Out 'anim-log-smoke-final.txt') -ErrorAction SilentlyContinue
if (-not $result.pass) { Write-Output '[smoke] FAIL'; exit 1 }
Write-Output '[smoke] PASS'
