$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$runtimePath = Join-Path $taskRoot 'data/runtime'
[IO.Directory]::CreateDirectory($runtimePath) | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $runtimePath 'hardware-pause.json'), (@{paused=$true;state='STOPPED_BY_USER';at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress), $utf8)
[IO.File]::WriteAllText((Join-Path $runtimePath 'maintenance.json'), (@{services=@('lmstudio','postgres','core','browser','dashboard','n8n','worker','telegram');reason='USER_REQUESTED_FULL_STOP'} | ConvertTo-Json -Compress), $utf8)
@'
import {Repository} from './services/core/repository.mjs';
const r=new Repository(process.env.DATABASE_URL,{max:1});
try{await r.pool.query('UPDATE runtime_control SET paused=true,updated_at=now() WHERE id=true');}
catch{console.log('Database unavailable; persistent stop markers are saved.');}
finally{await r.close();}
'@ | node --env-file=.env --input-type=module
$inventory = @(Get-CimInstance Win32_Process)
$roots = @($inventory | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match '\s--env-file=\.env\s+(?:scripts/(?:continuous-worker|resident-lmstudio|local-n8n|telegram-poll)|services/(?:core|browser-service|dashboard)/server)\.mjs(?:\s|$)'})
$ownedIds = [Collections.Generic.HashSet[int]]::new()
$roots | ForEach-Object {[void]$ownedIds.Add([int]$_.ProcessId)}
do {$added=$false;foreach($proc in $inventory){if($ownedIds.Contains([int]$proc.ParentProcessId) -and $ownedIds.Add([int]$proc.ProcessId)){$added=$true}}} while($added)
$roots | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
$inventory | Where-Object {$ownedIds.Contains([int]$_.ProcessId)} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
$lmsPath = Join-Path $env:USERPROFILE '.lmstudio/bin/lms.exe'
& $lmsPath unload jobhunter-gemma4
& $lmsPath server stop
& (Join-Path $taskRoot 'node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe') stop -D (Join-Path $taskRoot 'data/local-postgres') -m fast -w -t 20
Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match '\s--env-file=\.env\s+scripts/(?:supervise|local-postgres)\.mjs(?:\s|$)'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
Write-Output "Stopped $($ownedIds.Count) JobHunter processes. Automatic restart is blocked."
