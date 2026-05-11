#!/bin/sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../../../.." && pwd)"
cd "$ROOT"
bun packages/@higma-tools/web-to-fig/src/cli/extract-bin.ts \
  "https://github.com/anthropics/claude-code" \
  "body" \
  "$HERE/fixture.html" \
  --viewport 1280x800 \
  --wait domcontentloaded \
  --timeout 60000
