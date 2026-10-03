param([switch]$SkipBootstrap)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $workspace
try {
    node --env-file=.env tests/stage3-unit-report.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($SkipBootstrap) { node --env-file=.env scripts/test-stage-3.mjs --skip-bootstrap }
    else { node --env-file=.env scripts/test-stage-3.mjs }
    exit $LASTEXITCODE
} finally { Pop-Location }
