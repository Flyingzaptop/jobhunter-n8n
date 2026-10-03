#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
node --env-file=.env scripts/test-stage-5.mjs "$@"
