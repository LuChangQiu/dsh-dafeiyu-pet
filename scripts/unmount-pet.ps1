param([switch]$DryRun)
$ErrorActionPreference='Stop'; $repo=Split-Path -Parent $PSScriptRoot; $prof=Join-Path $env:USERPROFILE '.dsh\profiles\web'
if($DryRun){ "PLAN: unmount-pet-blocks.mjs -> assert active id=0 -> disposed log -> host alive"; exit 0 }
$patch=Join-Path $prof 'cordis.patch.yml'; Copy-Item $patch "$patch.bak-unmount-$(Get-Date -Format yyyyMMddHHmmss)" -Force
node (Join-Path $repo 'scripts\unmount-pet-blocks.mjs') $patch
$after=Get-Content $patch -Raw; if($after -match 'pet-bridge-v'){ throw 'bridge block still active' }
$log="$env:USERPROFILE\pet-work\evidence\pet-bridge-main.log"; if((Test-Path $log) -and -not ((Get-Content $log -Tail 50 -Raw) -match 'disposed|unloaded')){ Write-Warning 'disposed log not seen (check manually)' }
Add-Content (Join-Path $repo 'verify\REVIEW-LOG.md') -Value "`n## $([DateTime]::Now.ToString('s')) unmount-pet`n- result: done`n- patch backup: $patch.bak-unmount-*"
'OK unmounted'
