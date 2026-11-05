# Local-only PostgreSQL17 campaign CAS race, two independent Docker psql sessions.
# Run after fetching PR50. Synthetic rows committed briefly; cleanup always attempted.
$ErrorActionPreference='Stop'
$container='raxi-pg17-campaign-qa'
$db='raxi_campaign_qa'
$revision=(& git rev-parse FETCH_HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $revision -notmatch '^[0-9a-f]{40}$'){throw 'Fetch PR50 branch first'}
$network=(& docker inspect $container --format '{{.HostConfig.NetworkMode}}').Trim()
if($LASTEXITCODE -ne 0 -or $network -ne 'none'){throw 'LAB isolation failed'}
$ports=& docker port $container
if($LASTEXITCODE -ne 0 -or $ports){throw 'LAB has published ports'}
function Read-Lab([string]$sql) {
 $result=& docker exec $container psql -X -v ON_ERROR_STOP=1 -At -U postgres -d $db -c $sql
 if($LASTEXITCODE -ne 0){throw 'LAB query failed'}
 return ($result -join ',').Trim()
}
function Run-Lab([string]$path) {
 $ErrorActionPreference='Continue'
 $output=& git show "$($revision):$path" | & docker exec -i $container psql -X -v ON_ERROR_STOP=1 -U postgres -d $db -f - 2>&1
 $code=$LASTEXITCODE
 foreach($line in $output){Write-Host $line}
 if($code -ne 0){throw "LAB SQL failed: $path"}
}
$counts=Read-Lab "SELECT (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.raxi_workspaces), (SELECT count(*) FROM public.raxi_ideas), (SELECT count(*) FROM public.raxi_audit_events)"
if($counts -ne '0|0|0|0'){throw "LAB not empty: $counts"}
$jobA=$null;$jobB=$null;$seeded=$false;$complete=$false
$worker={
 param($revision,$path,$container,$db)
 $ErrorActionPreference='Continue'
 $out=& git show "$($revision):$path" | & docker exec -i $container psql -X -v ON_ERROR_STOP=1 -U postgres -d $db -f - 2>&1
 [pscustomobject]@{Code=$LASTEXITCODE;Log=($out -join [Environment]::NewLine)}
}
try {
 Run-Lab 'supabase/tests/issue49_pg17_race_seed.sql'
 $seeded=$true
 $jobA=Start-Job -ScriptBlock $worker -ArgumentList $revision,'supabase/tests/issue49_pg17_race_winner.sql',$container,$db
 $seen=$false
 for($i=0;$i -lt 50;$i++){
   if((Read-Lab "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=773451 AND granted") -eq '1'){$seen=$true;break}
   Start-Sleep -Milliseconds 100
 }
 if(-not $seen){throw 'A never acquired advisory lock: NOT_VERIFIED'}
 $jobB=Start-Job -ScriptBlock $worker -ArgumentList $revision,'supabase/tests/issue49_pg17_race_loser.sql',$container,$db
 if(-not (Wait-Job $jobA -Timeout 35)){throw 'A timed out'}
 if(-not (Wait-Job $jobB -Timeout 35)){throw 'B timed out'}
 $a=Receive-Job $jobA;$b=Receive-Job $jobB
 Write-Host 'SESSION A:';Write-Host $a.Log
 Write-Host 'SESSION B:';Write-Host $b.Log
 if($a.Code -ne 0 -or $b.Code -ne 0 -or $a.Log -notmatch 'PASS RACE WINNER' -or $b.Log -notmatch 'PASS RACE LOSER'){
    throw 'Concurrency test failed: NOT_VERIFIED'
 }
 Run-Lab 'supabase/tests/issue49_pg17_race_verify_cleanup.sql'
 $complete=$true
 Write-Host 'PASS CONCURRENCY: independent sessions, one confirmed, one stale, one receipt.' -ForegroundColor Green
} finally {
 foreach($j in @($jobA,$jobB)){
   if($null -ne $j){
     if($j.State -eq 'Running'){Stop-Job $j}
     Remove-Job $j -Force -ErrorAction SilentlyContinue
   }
 }
 if($seeded -and -not $complete){Run-Lab 'supabase/tests/issue49_pg17_race_cleanup_only.sql'}
 $counts=Read-Lab "SELECT (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.raxi_workspaces), (SELECT count(*) FROM public.raxi_ideas), (SELECT count(*) FROM public.raxi_audit_events)"
 if($counts -ne '0|0|0|0'){throw "CLEANUP NOT VERIFIED: $counts"}
 Write-Host 'CLEANUP PASS: 0 synthetic rows remaining.' -ForegroundColor Green
}
