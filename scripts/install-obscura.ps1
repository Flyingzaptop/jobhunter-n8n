$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$target=Join-Path $taskRoot 'data/tools/obscura-v0.2.4'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$archive=Join-Path $target 'release.zip'
Invoke-WebRequest -Uri 'https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.4/obscura-x86_64-windows.zip' -OutFile $archive
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '8e5428bf8c101f1439c53a9dcb52d7d09bb22599206b49f6420028d93d01189b'){throw 'OBSCURA_RELEASE_DIGEST_MISMATCH'}
Expand-Archive -LiteralPath $archive -DestinationPath $target -Force
$fonts=Join-Path $taskRoot 'data/tools/obscura-fonts'
New-Item -ItemType Directory -Path $fonts -Force | Out-Null
Copy-Item -LiteralPath "$env:WINDIR/Fonts/arial.ttf","$env:WINDIR/Fonts/arialbd.ttf" -Destination $fonts -Force
Write-Output 'Obscura v0.2.4 Windows render build installed; SHA256 verified.'
