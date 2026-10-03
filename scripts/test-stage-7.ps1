param([switch]$SkipBootstrap)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $workspace
try {
    if ($SkipBootstrap) { node --env-file=.env scripts/test-stage-7.mjs --skip-bootstrap }
    else { node --env-file=.env scripts/test-stage-7.mjs }
    exit $LASTEXITCODE
} finally { Pop-Location }
