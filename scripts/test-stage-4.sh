#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
exec node --env-file=.env scripts/test-stage-4.mjs "$@"
