#!/usr/bin/env powershell
# test-logon-autostart.ps1 — 登录自启（AtLogOn）测试：临时任务名 + 临时无害动作脚本，不碰真实任务/不拉起生产 pet/不重启。
# 覆盖：注册 AtLogOn(当前用户/LIMITED/延迟30s) → XML 断言 LogonTrigger/Delay → /Run 写 marker + LastTaskResult=0 → 删除；
#       selfcheck 正样本（Logon 任务无 task-trigger-not-logon）/反样本（无触发器→task-trigger-not-logon）/ -Repair 重注册；
#       install.ps1 / selfcheck.ps1 静态断言（含删除前 XML 备份/失败恢复）。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-logon-autostart.ps1 [-PetWorkDir <pet-work>]
#   环境：PET_WORK_DIR 可指定 pet-work；缺省按 脚本父目录的父目录/同级/用户目录 推导，找不到则明确报错。
param(
  [string]$PetWorkDir = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$selfcheck = Join-Path $root 'scripts\selfcheck.ps1'
$tmpTask = 'DafeiyuPetStartTest'
$stamp = [guid]::NewGuid().ToString('N').Substring(0, 8)
$tmpProfile = Join-Path $env:TEMP ('selfcheck-logon-profile-' + $stamp)
$tmpAction = Join-Path $env:TEMP ('pet-logon-test-action-' + $stamp + '.ps1')
$tmpMarker = Join-Path $env:TEMP ('pet-logon-test-marker-' + $stamp + '.txt')
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

function Resolve-PetWork {
  if ($PetWorkDir) { return $PetWorkDir }
  if ($env:PET_WORK_DIR) { return $env:PET_WORK_DIR }
  $candidates = @(
    (Join-Path (Split-Path -Parent $root) 'pet-work'),
    (Join-Path $root 'pet-work'),
    (Join-Path $env:USERPROFILE 'pet-work')
  )
  foreach ($c in $candidates) { if (Test-Path -LiteralPath (Join-Path $c 'tools\start-pet.ps1')) { return $c } }
  throw ("pet-work 未找到：请用 -PetWorkDir 或环境变量 PET_WORK_DIR 指定（候选：" + ($candidates -join '; ') + "）")
}

function Invoke-Selfcheck([string[]]$extraArgs) {
  $pw = Resolve-PetWork
  $base = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $selfcheck,
    '-TaskName', $tmpTask, '-PetWork', $pw, '-ProfileDir', $tmpProfile,
    '-PatchFile', (Join-Path $tmpProfile 'cordis.patch.yml'))
  return (& powershell.exe @($base + $extraArgs) 2>&1 | Out-String)
}

New-Item -ItemType Directory -Force -Path $tmpProfile | Out-Null
$petWork = Resolve-PetWork
# 临时无害动作：写 marker 后 exit 0（不指向真实 start-pet，/Run 不会拉起生产 pet）
@"
Set-Content -LiteralPath '$tmpMarker' -Value 'called' -Encoding ASCII
exit 0
"@ | Set-Content -LiteralPath $tmpAction -Encoding UTF8
try {
  Remove-TestTask
  Remove-Item -Force $tmpMarker -ErrorAction SilentlyContinue

  # ---------- 1) 注册 AtLogOn 并断言 XML ----------
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $tmpAction + '"')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
  $trigger.Delay = 'PT30S'
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $tmpTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
  $xml = (& schtasks.exe /Query /TN $tmpTask /XML 2>&1) | Out-String
  Assert-True 'XML 含 <LogonTrigger>' ($xml -match '<LogonTrigger>')
  Assert-True 'XML Delay=PT30S' ($xml -match '<Delay>PT30S</Delay>')
  Assert-True 'XML UserId=当前用户' ($xml -match [regex]::Escape($env:USERNAME))
  Assert-True 'Principal RunLevel=Limited' (((Get-ScheduledTask -TaskName $tmpTask).Principal).RunLevel -eq 'Limited')
  Assert-True 'XML 指向临时无害动作脚本' ($xml -match [regex]::Escape((Split-Path -Leaf $tmpAction)))

  # ---------- 2) 手动 /Run：marker 被写 + LastTaskResult=0（不打开生产 pet） ----------
  & schtasks.exe /Run /TN $tmpTask 2>&1 | Out-Null
  $lastResult = $null
  $markerOk = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try { $lastResult = (Get-ScheduledTaskInfo -TaskName $tmpTask -ErrorAction Stop).LastTaskResult } catch { $lastResult = $null }
    $markerOk = Test-Path -LiteralPath $tmpMarker
    if ($markerOk -and $lastResult -eq 0) { break }
  }
  Assert-True '/Run 写入临时 marker（未拉起生产 pet）' $markerOk
  Assert-True '/Run 成功（LastTaskResult=0）' ($lastResult -eq 0) ("last=" + "$lastResult")

  # ---------- 3) selfcheck 正样本：Logon 任务无 task-trigger-not-logon ----------
  $json1 = Invoke-Selfcheck @('-Sandbox')
  Assert-True 'selfcheck 正样本：无 task-trigger-not-logon' (-not ($json1 -match 'task-trigger-not-logon'))
  Assert-True 'selfcheck 正样本：checks.task.trigger=Logon' ($json1 -match '"trigger":\s*"Logon"')

  # ---------- 4) selfcheck 反样本：手动任务无触发器 → 检出 ----------
  Remove-TestTask
  $action2 = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $tmpAction + '"')
  Register-ScheduledTask -TaskName $tmpTask -Action $action2 -Force -ErrorAction Stop | Out-Null
  $json2 = Invoke-Selfcheck @('-Sandbox')
  Assert-True 'selfcheck 反样本：检出 task-trigger-not-logon' ($json2 -match 'task-trigger-not-logon')
  $xmlBad = (& schtasks.exe /Query /TN $tmpTask /XML 2>&1) | Out-String
  Assert-True '反样本 XML 确实无 LogonTrigger' (-not ($xmlBad -match '<LogonTrigger>'))

  # ---------- 5) -Repair 重注册 AtLogOn 并复核（只查询 XML，不 /Run） ----------
  Invoke-Selfcheck @('-Repair', '-Yes') | Out-Null
  $xml3 = (& schtasks.exe /Query /TN $tmpTask /XML 2>&1) | Out-String
  Assert-True 'Repair 后 XML 含 <LogonTrigger>' ($xml3 -match '<LogonTrigger>')
  Assert-True 'Repair 后 Delay=PT30S' ($xml3 -match '<Delay>PT30S</Delay>')
  Assert-True 'Repair 后 Principal RunLevel=Limited' (((Get-ScheduledTask -TaskName $tmpTask).Principal).RunLevel -eq 'Limited')
  $json4 = Invoke-Selfcheck @('-Sandbox')
  Assert-True 'Repair 后 selfcheck 无 task-trigger-not-logon' (-not ($json4 -match 'task-trigger-not-logon'))

  # ---------- 6) 静态断言（含备份/恢复保护） ----------
  $inst = Get-Content (Join-Path $root 'install\install.ps1') -Raw -Encoding UTF8
  Assert-True 'install.ps1 使用 AtLogOn 触发器' ($inst -match 'New-ScheduledTaskTrigger -AtLogOn')
  Assert-True 'install.ps1 延迟 PT30S' ($inst -match 'PT30S')
  Assert-True 'install.ps1 旧任务先删除（幂等）' ($inst -match 'Unregister-ScheduledTask')
  Assert-True 'install.ps1 删除前备份 XML' ($inst -match 'backupXml' -and $inst -match 'schtasks\.exe /Query')
  Assert-True 'install.ps1 注册失败恢复备份' ($inst -match 'Register-ScheduledTask -TaskName \$taskName -Xml')
  $sc = Get-Content $selfcheck -Raw -Encoding UTF8
  Assert-True 'selfcheck 定义 task-trigger-not-logon' ($sc -match 'task-trigger-not-logon')
  Assert-True 'selfcheck 解析 LogonTrigger' ($sc -match 'LogonTrigger')
  Assert-True 'selfcheck Repair 删除前备份 XML' ($sc -match 'repair-backup' -and $sc -match 'schtasks\.exe /Query')
  Assert-True 'selfcheck Repair 注册失败恢复备份' ($sc -match 'Register-ScheduledTask -TaskName \$TaskName -Xml')
} finally {
  Remove-TestTask
  Remove-Item -Force $tmpAction, $tmpMarker -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $tmpProfile -ErrorAction SilentlyContinue
}

Write-Output ("`nRESULT: " + $(if ($fail -eq 0) { 'PASS' } else { 'FAIL' }) + " ($ok passed, $fail failed)")
if ($fail -ne 0) { exit 1 } else { exit 0 }
