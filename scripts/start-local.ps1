param([switch]$WithTelegram)
$ErrorActionPreference='Stop'
$jobhunterRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $jobhunterRoot
$nodeBinary=(Get-Command node -ErrorAction Stop).Source
if(-not(Test-Path -LiteralPath '.env')){& $nodeBinary scripts/init-local-env.mjs;if($LASTEXITCODE){throw 'Environment creation failed'}}
if(-not(Test-Path -LiteralPath 'config/candidate_profile.yaml')){& $nodeBinary scripts/init-profile.mjs;if($LASTEXITCODE){throw 'Profile seed failed'}}
if(-not(Test-Path -LiteralPath '.tools/n8n/node_modules/n8n/bin/n8n')){throw 'Install native n8n: npm install --prefix .tools/n8n n8n@2.41.6 --no-audit --no-fund'}
$runtimeDir=Join-Path $jobhunterRoot 'data/runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
function Test-JobhunterPort([int]$Port){$probe=[System.Net.Sockets.TcpClient]::new();try{$attempt=$probe.ConnectAsync('127.0.0.1',$Port);return $attempt.Wait(500)-and$probe.Connected}catch{return $false}finally{$probe.Dispose()}}
$launched=@()
function Start-JobhunterService([string]$Name,[int]$Port,[string]$Entry){
 if(Test-JobhunterPort $Port){Write-Output "$Name already listening on localhost:$Port";return}
 $process=Start-Process -FilePath $nodeBinary -ArgumentList @('--env-file=.env',$Entry) -WorkingDirectory $jobhunterRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir "$Name.out.log") -RedirectStandardError (Join-Path $runtimeDir "$Name.error.log")
 $script:launched+=@{name=$Name;pid=$process.Id;entry=$Entry}
 Write-Output "Started $Name (PID $($process.Id))"
}
Start-JobhunterService 'postgres' 55432 'scripts/local-postgres.mjs'
for($attempt=0;$attempt-lt30-and-not(Test-JobhunterPort 55432);$attempt++){Start-Sleep -Seconds 1}
if(-not(Test-JobhunterPort 55432)){throw 'PostgreSQL did not become ready; see data/runtime/postgres.error.log'}
& $nodeBinary --env-file=.env scripts/migrate.mjs
if($LASTEXITCODE){throw 'Migrations failed'}
Start-JobhunterService 'core' 3000 'services/core/server.mjs'
Start-JobhunterService 'browser' 3001 'services/browser-service/server.mjs'
Start-JobhunterService 'n8n' 5678 'scripts/local-n8n.mjs'
foreach($readyPort in @(3000,3001,5678)){for($readyAttempt=0; $readyAttempt -lt 30 -and -not(Test-JobhunterPort $readyPort);$readyAttempt++){Start-Sleep -Seconds 1};if(-not(Test-JobhunterPort $readyPort)){throw "Service port $readyPort did not become ready; see data/runtime logs"}}
if($WithTelegram){$telegramProcess=Start-Process -FilePath $nodeBinary -ArgumentList @('--env-file=.env','scripts/telegram-poll.mjs') -WorkingDirectory $jobhunterRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'telegram.out.log') -RedirectStandardError (Join-Path $runtimeDir 'telegram.error.log');$launched+=@{name='telegram';pid=$telegramProcess.Id;entry='scripts/telegram-poll.mjs'}}
$launched | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'processes.json') -Encoding utf8
Write-Output 'Start local Ollama if needed: ollama serve'
Write-Output 'Workflows stay inactive and real submission disabled. Editor: http://127.0.0.1:5678'
