param([switch]$WithTelegram)
$ErrorActionPreference='Stop'
$jobhunterRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $jobhunterRoot
$nodeBinary=(Get-Command node -ErrorAction Stop).Source
if(-not(Test-Path -LiteralPath '.env')){& $nodeBinary scripts/init-local-env.mjs;if($LASTEXITCODE){throw 'Environment creation failed'}}
if(-not(Test-Path -LiteralPath 'config/candidate_profile.yaml')){& $nodeBinary scripts/init-profile.mjs;if($LASTEXITCODE){throw 'Profile seed failed'}}
if(-not(Test-Path -LiteralPath '.tools/n8n/node_modules/n8n/bin/n8n')){throw 'Install native n8n: npm install --prefix .tools/n8n n8n@2.41.6 --no-audit --no-fund'}
# Start long-running services through the independent WMI supervisor.
& (Join-Path $PSScriptRoot 'start-independent.ps1')
Write-Output 'JobHunter runs hidden. Dashboard: http://127.0.0.1:3020'
