param([string]$TargetCommit,[switch]$DryRun,[int]$TimeoutSec=30,[int]$SampleCount=10)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$prof=Join-Path $env:USERPROFILE '.dsh\profiles\web'
$log='E:\project\AI提效\tool\pet-integration-src\pet-work\evidence\pet-bridge-main.log'
if(-not $TargetCommit){ $TargetCommit=(git -C $repo rev-parse HEAD) }
$version=if($env:MOUNT_VERSION){$env:MOUNT_VERSION}else{(Get-Date -Format 'yyyyMMddHHmm')}
$newPkg="dsh-pet-bridge-v$version"
if($DryRun){
  "PLAN: commit=$TargetCommit pkg=$newPkg profile=$prof"
  "PLAN: mount-check -> git archive(zip) -> profile node_modules -> safe-patch activate -> wait new 'loaded v' line -> verify home/pipe -> sample -> rollback-on-fail"
  exit 0
}

# 1) 前置门禁（含 reviewer APPROVED 校验）——用 Start-Process 隔离 stdout/stderr，避免写成 PowerShell 错误流
$mcOut=Join-Path $env:TEMP 'mount-check.out'
$mcErr=Join-Path $env:TEMP 'mount-check.err'
Remove-Item $mcOut,$mcErr -ErrorAction SilentlyContinue
$mc=Start-Process powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'mount-check.ps1'),'-TargetCommit',$TargetCommit) -Wait -PassThru -NoNewWindow -RedirectStandardOutput $mcOut -RedirectStandardError $mcErr
if($mc.ExitCode -ne 0){
  $detail=((Get-Content $mcOut -Raw -ErrorAction SilentlyContinue) + (Get-Content $mcErr -Raw -ErrorAction SilentlyContinue))
  throw ('mount-check failed: ' + $detail.Trim())
}

# 2) 从 commit 构建暂存包（zip，避免二进制管道损坏）
$stage=Join-Path $repo "build\$newPkg"
if(Test-Path $stage){ Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$zip=Join-Path $env:TEMP "$newPkg.zip"
if(Test-Path $zip){ Remove-Item $zip -Force }
git -C $repo archive --format=zip -o $zip $TargetCommit plugin/server
if($LASTEXITCODE -ne 0){ throw 'git archive failed' }
Expand-Archive -Path $zip -DestinationPath $stage -Force
$pkgStage=Join-Path $stage 'plugin\server'
if(-not (Test-Path (Join-Path $pkgStage 'package.json'))){ throw "build 目录缺少 plugin/server/package.json: $stage" }
$pj=Get-Content (Join-Path $pkgStage 'package.json') -Raw | ConvertFrom-Json
$pluginVersion=$pj.version
if(-not $pluginVersion){ throw 'plugin/server package.json version missing' }

# 3) 复制到 profile 新包目录（旧包保留）
$dst=Join-Path $prof "node_modules\$newPkg"
if(Test-Path $dst){ Remove-Item $dst -Recurse -Force }
Copy-Item $pkgStage $dst -Recurse -Force

# 4) 记录日志基线行数，再 safe-patch 激活（备份/校验/原子）
$baseline=0
if(Test-Path $log){ $baseline=(Get-Content $log | Measure-Object -Line).Lines }
$patch=Join-Path $prof 'cordis.patch.yml'
$bak="$patch.bak-mount-$(Get-Date -Format yyyyMMddHHmmss)"
Copy-Item $patch $bak -Force
node (Join-Path $repo 'scripts\safe-patch.mjs') --patch $patch --activate --id "pet-bridge-v$version" --name $newPkg --json
if($LASTEXITCODE -ne 0){ throw 'safe-patch activate failed' }

# 5) 等待出现新的 loaded 行（插件代码里是硬编码 'loaded v49'，不能按 package version 匹配）
$deadline=(Get-Date).AddSeconds($TimeoutSec)
$ok=$false
while((Get-Date) -lt $deadline){
  if(Test-Path $log){
    $cur=(Get-Content $log | Measure-Object -Line).Lines
    if($cur -gt $baseline){
      $tail=Get-Content $log -Tail ($cur - $baseline + 5)
      if($tail -match 'loaded v\d+'){ $ok=$true; break }
    }
  }
  Start-Sleep -Seconds 1
}
if(-not $ok){
  Copy-Item $bak $patch -Force
  throw ("hot-load timeout (no new 'loaded v' line in ${TimeoutSec}s); rolled back patch from " + $bak)
}

# 6) 运行态验证：home 401 / pipe / 无 TEST HOOK / v2 version
Start-Sleep -Seconds 3
$homeOk=$false
try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:3080/pet-bridge-ui/home' -Method Head -TimeoutSec 5 -ErrorAction Stop; $homeOk=($r.StatusCode -eq 401) } catch { $homeOk=("$($_.Exception.Message)" -match '401') }
$statePath='E:\project\AI提效\tool\pet-integration-src\pet-work\bridge-state-v2.json'
$v2=if(Test-Path $statePath){ Get-Content $statePath -Raw | ConvertFrom-Json } else { $null }
$pipeOk=[bool]($v2 -and $v2.pet -and $v2.pipe)
$testHook=[bool]($v2 -and $v2.testHook)
"verify: home401=$homeOk pipe=$pipeOk testHook=$testHook v2version=$($v2.version) writerId=$($v2.writerId)"
if(-not $homeOk -or -not $pipeOk -or $testHook){
  Copy-Item $bak $patch -Force
  throw "post-mount verify failed (home401=$homeOk pipe=$pipeOk testHook=$testHook); rolled back patch"
}

# 7) 稳定性采样（30s x N），记录到 pet-work/evidence（不入 repo）
$samples=@()
for($i=0;$i -lt $SampleCount;$i++){
  $conn=Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  $hp=if($conn){ Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue } else { $null }
  $samples += [ordered]@{
    at=(Get-Date -Format o)
    hostPid=if($conn){ $conn.OwningProcess } else { $null }
    wsMB=if($hp){ [math]::Round($hp.WorkingSet64/1MB,1) } else { $null }
  }
  Start-Sleep -Seconds 30
}
$evDir='E:\project\AI提效\tool\pet-integration-src\pet-work\evidence'
New-Item -ItemType Directory -Force -Path $evDir | Out-Null
$out=Join-Path $evDir "mount-$version.json"
$samples | ConvertTo-Json -Depth 4 | Set-Content $out -Encoding UTF8
"OK mounted $newPkg (plugin v$pluginVersion) samples=$($samples.Count) evidence=$out"
"backup=$bak"
