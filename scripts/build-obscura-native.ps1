$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$sourceRoot=Join-Path $taskRoot 'data/vendor/obscura-v0.2.4'
if(!(Test-Path -LiteralPath $sourceRoot)){
 git clone --depth 1 --branch v0.2.4 https://github.com/h4ckf0r0day/obscura.git $sourceRoot
 if($LASTEXITCODE -ne 0){throw 'SOURCE_CLONE_FAILED'}
}
$commit=git -C $sourceRoot rev-parse HEAD
if($commit -ne '1fccab2c1ecd0f7eadc16d7a520ba227f9e7f782'){throw 'UPSTREAM_COMMIT_MISMATCH'}
$patch=Join-Path $taskRoot 'patches/obscura-v0.2.4-network-contract.patch'
git -C $sourceRoot apply --reverse --check $patch 2>$null
if($LASTEXITCODE -ne 0){git -C $sourceRoot apply $patch;if($LASTEXITCODE -ne 0){throw 'PATCH_APPLY_FAILED'}}
Push-Location -LiteralPath $sourceRoot
try{cargo build --locked --release -p obscura-cli --bin obscura --features render --jobs 1;if($LASTEXITCODE -ne 0){throw 'NATIVE_BUILD_FAILED'}}finally{Pop-Location}
Set-Location -LiteralPath $taskRoot
1..3|ForEach-Object{node scripts/test-obscura-network-contract.mjs;if($LASTEXITCODE -ne 0){throw 'NETWORK_CONTRACT_FAILED'}}
$destination=Join-Path $taskRoot 'data/tools/obscura-v0.2.4-jobhunter'
New-Item -ItemType Directory -Force -Path $destination|Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'target/release/obscura.exe') -Destination (Join-Path $destination 'obscura.exe') -Force
$manifest=@{source_commit=$commit;sha256=(Get-FileHash -LiteralPath (Join-Path $destination 'obscura.exe')).Hash.ToLowerInvariant();network_contract=(Get-Content -LiteralPath (Join-Path $taskRoot 'data/acceptance/obscura-network-contract.json') -Raw|ConvertFrom-Json);consecutive_passes=3}
[IO.File]::WriteAllText((Join-Path $destination 'build-manifest.json'),($manifest|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
