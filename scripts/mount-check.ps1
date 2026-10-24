param([switch]$DryRun,[string]$TargetCommit='')
$ErrorActionPreference='Stop'; $repo=Split-Path -Parent $PSScriptRoot
function J($o){ $o|ConvertTo-Json -Depth 6 -Compress }
$r=@{ok=$true;checks=@();targetCommit=$TargetCommit;dryRun=$DryRun}
function Ck($n,$ok,$d){ $script:r.checks += @{name=$n;ok=[bool]$ok;detail=$d}; if(-not $ok){$script:r.ok=$false} }
Push-Location $repo
try{
 $st=(git status --porcelain) -join ';'; Ck 'repo_clean' (-not $st) $st
 $tc=if($TargetCommit){$TargetCommit}else{'HEAD'}; $h=(git rev-parse $tc 2>$null); Ck 'target_commit' ([bool]$h) $h
 $vp=(node scripts/validate-profile.mjs --expect unmounted --json 2>&1|Out-String); Ck 'validate_profile' ($LASTEXITCODE -eq 0) ($vp.Trim().Substring(0,[Math]::Min(300,$vp.Trim().Length)))
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\preflight-check.ps1') 2>&1 | Out-Null; Ck 'preflight' ($LASTEXITCODE -eq 0) 'preflight-check.ps1 11/11'
 $dt=Join-Path $env:TEMP 'harness.out'; $de=Join-Path $env:TEMP 'harness.err'; Remove-Item $dt,$de -ErrorAction SilentlyContinue; $hp=Start-Process node -ArgumentList 'scripts/harness/plugin-harness.mjs' -Wait -PassThru -RedirectStandardOutput $dt -RedirectStandardError $de -NoNewWindow; $det=((Get-Content $dt -Raw -ErrorAction SilentlyContinue) + (Get-Content $de -Raw -ErrorAction SilentlyContinue)); Ck 'verify_detached' ($hp.ExitCode -eq 0) ($det.Trim().Substring(0,[Math]::Min(200,$det.Trim().Length)))
 $pr=(node scripts/audit-privacy.mjs --dir 'E:\project\AI提效\tool\pet-integration-src\pet-work' 2>&1|Out-String); Ck 'privacy_audit' ($LASTEXITCODE -eq 0) 'findings=0'
 $patch=Join-Path $env:USERPROFILE '.dsh\profiles\web\cordis.patch.yml'; Ck 'patch_exists' (Test-Path $patch) $patch
 Ck 'patch_backup' (Get-ChildItem (Split-Path $patch) -Filter 'cordis.patch.yml.bak-*' -ErrorAction SilentlyContinue) 'bak'
 $rl='C:\Users\xiqi\.dsh\im\deliverables\pet-integration\verify\REVIEW-LOG.md'; $approved=$false
 if(Test-Path $rl){ $tail=(Get-Content $rl -Tail 200) -join "`n"; $approved = ($tail -match 'APPROVED') -and ($tail -match [regex]::Escape($h)) }
 $ap=Join-Path $repo 'evidence\approval.json'; if(-not $approved -and (Test-Path $ap)){ $j=Get-Content $ap -Raw|ConvertFrom-Json; $approved=($j.commit -eq $h -or $j.approved -eq $true) }
 Ck 'reviewer_approved' $approved 'REVIEW-LOG/approval.json'
}catch{ $r.ok=$false; $r.error=$_.Exception.Message }finally{ Pop-Location }
if($DryRun){ $r.dryRun=$true }
J $r; if($r.ok){exit 0}else{exit 1}
