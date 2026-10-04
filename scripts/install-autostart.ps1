$ErrorActionPreference='Stop'
$jobhunterRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nodeBinary=(Get-Command node -ErrorAction Stop).Source
$startupDirectory=[Environment]::GetFolderPath('Startup')
$shellObject=New-Object -ComObject WScript.Shell
$shortcut=$shellObject.CreateShortcut((Join-Path $startupDirectory 'JobHunter Supervisor.lnk'))
$shortcut.TargetPath=$nodeBinary
$shortcut.Arguments='--env-file=.env scripts/supervise.mjs'
$shortcut.WorkingDirectory=$jobhunterRoot
$shortcut.WindowStyle=7
$shortcut.Description='Restore JobHunter services and local LM Studio after Windows sign-in'
$shortcut.Save()
Write-Output 'JobHunter supervisor will start after Windows sign-in.'
