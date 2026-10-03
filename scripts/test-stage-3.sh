#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
node --env-file=.env tests/stage3-unit-report.mjs
exec node --env-file=.env scripts/test-stage-3.mjs "$@"
