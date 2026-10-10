$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$existing = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '\s--env-file=\.env\s+scripts/supervise\.mjs(?:\s|$)' })
if ($existing.Count) { Write-Output "Supervisor already running: $($existing.ProcessId -join ', ')"; exit 0 }
$stopMarker = Join-Path $taskRoot 'data/runtime/maintenance.json'
if (Test-Path -LiteralPath $stopMarker) {
  $maintenance = Get-Content -LiteralPath $stopMarker -Raw | ConvertFrom-Json
  if ($maintenance.reason -eq 'USER_REQUESTED_FULL_STOP') { throw 'JobHunter is fully stopped by the user. Clear the full-stop maintenance state only during an explicitly requested resume.' }
}
$nodePath = (Get-Command node.exe).Source
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "`"$nodePath`" --env-file=.env scripts/supervise.mjs"; CurrentDirectory = $taskRoot; ProcessStartupInformation = $startup }
if ($result.ReturnValue -ne 0) { throw "Independent launch failed: $($result.ReturnValue)" }
Write-Output "Independent supervisor PID: $($result.ProcessId)"
