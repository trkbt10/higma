#!/bin/sh
# Regenerate the fixture from the live URL. Run from the repo root:
#   sh packages/@higma-tools/web-to-fig/spec/cases-fullpage/example-com-fullpage/extract.sh
# The fixture is gitignored (real DOM snapshots are too large + non-deterministic
# day-to-day) — running this script before `bun test` is what activates the
# full-page case for local inspection.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../../../.." && pwd)"
cd "$ROOT"
bun packages/@higma-tools/web-to-fig/src/cli/extract-bin.ts \
  "https://example.com/" \
  "body" \
  "$HERE/fixture.html" \
  --viewport 1280x800 \
  --wait load \
  --timeout 30000
