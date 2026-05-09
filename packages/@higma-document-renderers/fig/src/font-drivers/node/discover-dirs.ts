/**
 * @file Recursive on-disk font directory walker.
 *
 * Used directly by the macOS discovery strategy and as a fallback for
 * the Linux strategy when fontconfig isn't installed and for the
 * Windows strategy when the registry walk fails. The walker only
 * categorises files by extension; parsing happens in the driver's
 * indexer.
 */

import * as path from "node:path";
import type { DiscoveredFontFile, DiscoveryFs } from "./discover-types";

/**
 * Cap directory recursion at this many levels. Real font dirs nest at
 * most two or three deep (e.g. `/usr/share/fonts/truetype/dejavu/`).
 * The cap exists only to keep an accidental symlink loop from spinning.
 */
const MAX_RECURSION_DEPTH = 8;

/**
 * Classification of a font file's extension. `parseable` files are
 * indexed; `woff2` is recognised but unsupported (no brotli decoder
 * wired in); `unknown` is silently skipped.
 */
export type FontFileKind = "parseable" | "woff2" | "unknown";

/**
 * Classify a file path's extension for the purposes of indexing.
 *
 * `ttf` / `otf` / `woff` / `ttc` are parseable by opentype.js (the
 * loader decomposes `.ttc` into single-face buffers first).
 *
 * `.woff2` is recognised but flagged unsupported — opentype.js needs
 * an external brotli decompressor to read WOFF2, and none is wired in
 * here. Discovery skips `.woff2` entries silently because callers may
 * have parallel `.woff` / `.ttf` siblings on disk; if not, the
 * subsequent `loadFont` call returns `undefined` and surfaces the
 * failure at the call site.
 *
 * Anything else (`.afm`, `.pfb`, `.dfont`, ...) is "unknown" and
 * skipped without comment.
 */
export function classifyFontFile(filename: string): FontFileKind {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".ttf" || ext === ".otf" || ext === ".ttc" || ext === ".woff") {
    return "parseable";
  }
  if (ext === ".woff2") {
    return "woff2";
  }
  return "unknown";
}

/**
 * Walk every directory in `roots` and return parseable font file paths.
 *
 * Symlinks are skipped — a symlink loop (`a -> b`, `b/c -> a`) would
 * otherwise spin until the recursion cap kicks in. The OS-installed
 * font catalogue is reachable directly without crossing symlinks.
 */
/**
 * Walk every directory in `roots` recursively and return parseable
 * font file paths. Used by every platform's discovery strategy —
 * directly on macOS, and as a fallback path on Linux / Windows when
 * the OS resolver tool is missing.
 */
export function scanFontDirectories(
  fs: DiscoveryFs,
  roots: readonly string[],
): readonly DiscoveredFontFile[] {
  const out: DiscoveredFontFile[] = [];
  const visited = new Set<string>();
  for (const root of roots) {
    walk(fs, root, 0, visited, out);
  }
  return out;
}

function walk(
  fs: DiscoveryFs,
  dir: string,
  depth: number,
  visited: Set<string>,
  out: DiscoveredFontFile[],
): void {
  if (depth > MAX_RECURSION_DEPTH) {
    return;
  }
  if (visited.has(dir)) {
    return;
  }
  visited.add(dir);
  if (!fs.existsSync(dir)) {
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(fs, fullPath, depth + 1, visited, out);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (classifyFontFile(entry.name) === "parseable") {
      out.push({ path: fullPath });
    }
  }
}
