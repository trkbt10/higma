#!/usr/bin/env bash
# Launch the higma-vsc-plugin in an isolated VS Code profile.
#
# By default this also keeps `bun run watch:extension` and
# `bun run watch:webview` running in the background so any file save
# rebuilds `dist/`. Inside the launched VS Code:
#   - webview-only changes  → ⌘⇧P → "Developer: Reload Webviews"
#                              (or close + reopen the .fig tab)
#   - extension changes      → ⌘R or "Developer: Reload Window"
# Neither requires re-running this script.
#
# `--no-watch` skips watchers and exits when VS Code does (single-shot
# launch). Useful for the install/vsix flow or for piping logs.
#
# Mirrors `web-pptx/scripts/run-office-viewer-dev.sh`: a clean
# `--user-data-dir` + `--extensions-dir` under /tmp, plus a pre-pinned
# `workbench.editorAssociations` that routes every `.fig` straight to
# our custom editor (no "Reopen Editor With…" needed). Welcome /
# sign-in prompts are pre-disabled so the fresh profile boots straight
# into the editor.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_DATA_DIR="/tmp/higma-vsc-plugin-user"
EXTENSIONS_DIR="/tmp/higma-vsc-plugin-exts"
DEFAULT_FIXTURE="$ROOT_DIR/spec/e2e/fixtures/sample.fig"

WATCH_MODE=true
TARGET_FILE=""
for arg in "$@"; do
  case "$arg" in
    --no-watch) WATCH_MODE=false ;;
    --help|-h)
      echo "Usage: bun run dev [--no-watch] [path/to/file.fig]"
      exit 0
      ;;
    *) TARGET_FILE="$arg" ;;
  esac
done
TARGET_FILE="${TARGET_FILE:-$DEFAULT_FIXTURE}"

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun is required." >&2
  exit 1
fi

if ! command -v code >/dev/null 2>&1; then
  echo "Error: VS Code CLI 'code' is required (Cmd+Shift+P → Shell Command: Install 'code' command in PATH)." >&2
  exit 1
fi

if [[ ! -f "$TARGET_FILE" ]]; then
  echo "Error: target file not found: $TARGET_FILE" >&2
  exit 1
fi

echo "[1/3] Building higma-vsc-plugin..."
# Only the unminified (`build`) variant is supported. The previous
# minified path was removed because bun's minifier rewrites a
# bundle-internal binding into an undefined reference
# (`ReferenceError: Im is not defined`) on this graph. The unminified
# bundle is ~6.8 MB which the webview loads instantly from disk.
bun run --cwd "$ROOT_DIR" build

echo "[2/3] Resetting isolated VS Code profile (${USER_DATA_DIR}, ${EXTENSIONS_DIR})..."
rm -rf "$USER_DATA_DIR" "$EXTENSIONS_DIR"
mkdir -p "$USER_DATA_DIR/User"
cat > "$USER_DATA_DIR/User/settings.json" <<'JSON'
{
  "workbench.editorAssociations": {
    "*.fig": "higma.figViewer"
  },
  "workbench.startupEditor": "none",
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false,
  "extensions.ignoreRecommendations": true,
  "settingsSync.ignoredExtensions": [],
  "window.title": "Higma Fig Viewer (dev) — ${activeEditorShort}"
}
JSON

WATCH_PIDS=()
cleanup() {
  if [[ ${#WATCH_PIDS[@]} -gt 0 ]]; then
    echo
    echo "[cleanup] stopping watchers (${WATCH_PIDS[*]})"
    kill "${WATCH_PIDS[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if $WATCH_MODE; then
  echo "[3/3] Starting watchers (extension + webview) and launching VS Code..."
  echo "      Edit a file → it rebuilds in place."
  echo "      In VS Code:  ⌘⇧P → 'Developer: Reload Webviews'   (webview changes)"
  echo "                   ⌘R                                    (extension changes)"
  bun run --cwd "$ROOT_DIR" watch:extension >/tmp/higma-watch-extension.log 2>&1 &
  WATCH_PIDS+=("$!")
  bun run --cwd "$ROOT_DIR" watch:webview >/tmp/higma-watch-webview.log 2>&1 &
  WATCH_PIDS+=("$!")
  code \
    --user-data-dir "$USER_DATA_DIR" \
    --extensions-dir "$EXTENSIONS_DIR" \
    --extensionDevelopmentPath="$ROOT_DIR" \
    "$ROOT_DIR" \
    "$TARGET_FILE" \
    --wait
else
  echo "[3/3] Launching VS Code (no watchers)..."
  exec code \
    --user-data-dir "$USER_DATA_DIR" \
    --extensions-dir "$EXTENSIONS_DIR" \
    --extensionDevelopmentPath="$ROOT_DIR" \
    "$ROOT_DIR" \
    "$TARGET_FILE"
fi
