#!/usr/bin/env powershell
# test-logon-autostart.ps1 — 登录自启（AtLogOn）测试：临时任务名，不碰真实任务、不重启。
# 覆盖：注册 AtLogOn(当前用户/LIMITED/延迟30s) → XML 断言 LogonTrigger/Delay → /Run 成功 → 删除；
#       selfcheck 正样本（Logon 任务无 issue）/反样本（无触发器→task-trigger-not-logon）/ -Repair 重注册；
#       install.ps1 / selfcheck.ps1 静态断言。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-logon-autostart.ps1 [-PetWorkDir <pet-work>]
param(
  [string]$PetWorkDir = 'E:\project\AI提效\tool\pet-integration-src\pet-work'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$selfcheck = Join-Path $root 'scripts\selfcheck.ps1'
$tmpTask = 'DafeiyuPetStartTest'
$tmpProfile = Join-Path $env:TEMP ('selfcheck-logon-profile-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$ok = 0
$fail = 0

function Assert-True([string]$name, [bool]$cond, [string]$detail = '') {
  if ($cond) { $script:ok++; Write-Output ("PASS " + $name + $(if ($detail) { " · " + $detail } else { '' })) }
  else { $script:fail++; Write-Output ("FAIL " + $name + $(if ($detail) { " · " + $detail } else { '' })) }
}

function Remove-TestTask {
  try { Unregister-ScheduledTask -TaskName $tmpTask -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch {}
  try { & schtasks.exe /Delete /TN $tmpTask /F 2>$null | Out-Null } catch {}
}

function New-LogonTestTask {
  $startScript = Join-Path $PetWorkDir 'tools\start-pet.ps1'
  if (-not (Test-Path -LiteralPath $startScript)) { throw "start-pet.ps1 not found: $startScript" }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScript + '"')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
  $trigger.Delay = 'PT30S'
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $tmpTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
}

function Invoke-Selfcheck([string[]]$extraArgs) {
  $base = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $selfcheck,
    '-TaskName', $tmpTask, '-PetWork', $PetWorkDir, '-ProfileDir', $tmpProfile,
    '-PatchFile', (Join-Path $tmpProfile 'cordis.patch.yml'))
  $out = & powershell.exe @($base + $extraArgs) 2>&1 | Out-String
  return $out
}

New-Item -ItemType Directory -Force -Path $tmpProfile | Out-Null
try {
  Remove-TestTask

  # ---------- 1) 注册 AtLogOn 并断言 XML ----------
  New-LogonTestTask
  $xml = (& schtasks.exe /Query /TN $tmpTask /XML 2>&1) | Out-String
  Assert-True 'XML 含 <LogonTrigger>' ($xml -match '<LogonTrigger>')
  Assert-True 'XML Delay=PT30S' ($xml -match '<Delay>PT30S</Delay>')
  Assert-True 'XML UserId=当前用户' ($xml -match [regex]::Escape($env:USERNAME))
  Assert-True 'Principal RunLevel=Limited' (((Get-ScheduledTask -TaskName $tmpTask).Principal).RunLevel -eq 'Limited')
  Assert-True 'XML 指向 start-pet.ps1' ($xml -match 'start-pet\.ps1')

  # ---------- 2) 手动 /Run 成功 ----------
  & schtasks.exe /Run /TN $tmpTask 2>&1 | Out-Null
  $lastResult = $null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try { $lastResult = (Get-ScheduledTaskInfo -TaskName $tmpTask -ErrorAction Stop).LastTaskResult } catch { $lastResult = $null }
    if ($null -ne $lastResult -and $lastResult -eq 0) { break }
  }
  Assert-True '/Run 成功（LastTaskResult=0）' ($lastResult -eq 0) ("last=" + "$lastResult")

  # ---------- 3) selfcheck 正样本：Logon 任务无 task-trigger-not-logon ----------
  $json1 = Invoke-Selfcheck @('-Sandbox')
  Assert-True 'selfcheck 正样本：无 task-trigger-not-logon' (-not ($json1 -match 'task-trigger-not-logon'))
  Assert-True 'selfcheck 正样本：checks.task.trigger=Logon' ($json1 -match '"trigger":\s*"Logon"')
  Assert-True 'selfcheck 正样本：task.ok=true' ($json1 -match '"ok":\s*true' )

  # ---------- 4) selfcheck 反样本：无触发器（手动任务）→ 检出 ----------
  Remove-TestTask
  $startScript = Join-Path $PetWorkDir 'tools\start-pet.ps1'
  $action2 = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScript + '"')
  Register-ScheduledTask -TaskName $tmpTask -Action $action2 -Force -ErrorAction Stop | Out-Null
  $json2 = Invoke-Selfcheck @('-Sandbox')
  Assert-True 'selfcheck 反样本：检出 task-trigger-not-logon' ($json2 -match 'task-trigger-not-logon')
  $xmlBad = (& schtasks.exe /Query /TN $tmpTask /XML 2>&1) | Out-String
  Assert-True '反样本 XML 确实无 LogonTrigger' (-not ($xmlBad -match '<LogonTrigger>'))

  # ---------- 5) -Repair 重注册 AtLogOn 并复核 ----------
  $json3 = Invoke-Selfcheck @('-Repair', '-Yes')
  $xml3 = (& schtasks.exe /Query /TN $tmpTask /XML 2>&1) | Out-String
  Assert-True 'Repair 后 XML 含 <LogonTrigger>' ($xml3 -match '<LogonTrigger>')
  Assert-True 'Repair 后 Delay=PT30S' ($xml3 -match '<Delay>PT30S</Delay>')
  Assert-True 'Repair 后 Principal RunLevel=Limited' (((Get-ScheduledTask -TaskName $tmpTask).Principal).RunLevel -eq 'Limited')
  $json4 = Invoke-Selfcheck @('-Sandbox')
  Assert-True 'Repair 后 selfcheck 无 task-trigger-not-logon' (-not ($json4 -match 'task-trigger-not-logon'))

  # ---------- 6) 静态断言 ----------
  $inst = Get-Content (Join-Path $root 'install\install.ps1') -Raw -Encoding UTF8
  Assert-True 'install.ps1 使用 AtLogOn 触发器' ($inst -match 'New-ScheduledTaskTrigger -AtLogOn')
  Assert-True 'install.ps1 延迟 PT30S' ($inst -match 'PT30S')
  Assert-True 'install.ps1 旧任务先删除（幂等）' ($inst -match 'Unregister-ScheduledTask')
  Assert-True 'install.ps1 保留按需 Run 说明' ($inst -match 'schtasks /Run')
  $sc = Get-Content $selfcheck -Raw -Encoding UTF8
  Assert-True 'selfcheck 定义 task-trigger-not-logon' ($sc -match 'task-trigger-not-logon')
  Assert-True 'selfcheck 解析 LogonTrigger' ($sc -match 'LogonTrigger')
} finally {
  Remove-TestTask
  Remove-Item -Recurse -Force $tmpProfile -ErrorAction SilentlyContinue
}

Write-Output ("`nRESULT: " + $(if ($fail -eq 0) { 'PASS' } else { 'FAIL' }) + " ($ok passed, $fail failed)")
if ($fail -ne 0) { exit 1 } else { exit 0 }
