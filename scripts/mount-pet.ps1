param([string]$TargetCommit,[switch]$DryRun,[int]$TimeoutSec=30,[int]$SampleCount=10)
$ErrorActionPreference='Stop'; $repo=Split-Path -Parent $PSScriptRoot; $prof=Join-Path $env:USERPROFILE '.dsh\profiles\web'
if(-not $TargetCommit){ $TargetCommit=(git -C $repo rev-parse HEAD) }
$version=if($env:MOUNT_VERSION){$env:MOUNT_VERSION}else{(Get-Date -Format 'yyyyMMddHHmm')}
$newPkg="dsh-pet-bridge-v$version"
if($DryRun){ "PLAN: commit=$TargetCommit pkg=$newPkg profile=$prof"; "PLAN: validate-profile then safe-patch id switch then wait loaded/version/writerId then verify + sample + rollback-on-fail"; exit 0 }
# preconditions
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'mount-check.ps1') -TargetCommit $TargetCommit; if($LASTEXITCODE -ne 0){ throw 'mount-check failed' }
$stage=Join-Path $repo "build\$newPkg"; if(Test-Path $stage){Remove-Item $stage -Recurse -Force}; New-Item -ItemType Directory -Force -Path $stage|Out-Null
git -C $repo archive $TargetCommit plugin/server | tar -x -C $stage 2>$null; if(-not (Test-Path "$stage\plugin\server")){ Copy-Item "$repo\plugin\server\*" $stage -Recurse -Force }
$dst=Join-Path $prof "node_modules\$newPkg"; if(Test-Path $dst){Remove-Item $dst -Recurse -Force}; Copy-Item $stage $dst -Recurse -Force
$patch=Join-Path $prof 'cordis.patch.yml'; Copy-Item $patch "$patch.bak-mount-$(Get-Date -Format yyyyMMddHHmmss)" -Force
node (Join-Path $repo 'scripts\safe-patch.mjs') --patch $patch --activate $newPkg --json
$deadline=(Get-Date).AddSeconds($TimeoutSec); $ok=$false
while((Get-Date) -lt $deadline){ $log="$env:USERPROFILE\pet-work\evidence\pet-bridge-main.log"; if(Test-Path $log){ if((Get-Content $log -Tail 80 -Raw) -match "loaded v$version"){ $ok=$true; break } }; Start-Sleep 1 }
if(-not $ok){ Copy-Item "$patch.bak-mount-*" $patch -Force; throw 'hot-load timeout; rolled back patch' }
$samples=@(); for($i=0;$i -lt $SampleCount;$i++){ $p=Get-Process node -ErrorAction SilentlyContinue | Select-Object -First 1; $samples += @{at=(Get-Date -Format o);wsMB=if($p){[math]::Round($p.WorkingSet64/1MB,1)}else{$null}}; Start-Sleep -Seconds 30 }
"OK mounted $newPkg samples=$($samples.Count)"; $samples|ConvertTo-Json -Depth 4|Set-Content (Join-Path $repo "evidence\mount-$version.json")
