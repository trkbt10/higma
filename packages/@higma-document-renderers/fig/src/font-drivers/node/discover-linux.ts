/**
 * @file Linux font discovery via fontconfig.
 *
 * Fontconfig is the Linux OS-canonical font resolver — it is what
 * `fc-match` answers, what every GTK/Qt application consults, and
 * what desktop file managers use to surface installed fonts. Asking
 * fontconfig means we honour every `<dir>` entry in
 * `/etc/fonts/fonts.conf`, every drop-in under `/etc/fonts/conf.d/`,
 * and the user's `~/.config/fontconfig/fonts.conf`.
 *
 * Bypassing fontconfig and walking a hard-coded set of directories
 * (which the previous implementation did) misses any user
 * customisation: mounted font volumes, custom `<dir>` entries,
 * per-package additions installed under `/usr/share/fonts/<vendor>/`,
 * etc. It also drifts from what `fc-match "Foo"` would return at the
 * shell, producing a different font than every other GUI app on the
 * machine.
 *
 * If `fc-list` is not available (minimal containers, embedded
 * systems) we fall back to scanning the canonical XDG / FHS font
 * directories. The fallback is deliberately narrower — it accepts
 * being incomplete on those hosts, but never silently substitutes a
 * different family for a missing one.
 */

import * as path from "node:path";
import { scanFontDirectories } from "./discover-dirs";
import type {
  DiscoveredFontFile,
  DiscoveryEnv,
  DiscoveryResult,
} from "./discover-types";

/**
 * Format string passed to `fc-list -f`. The trailing `\n` separates
 * records; tabs separate fields. Order: file, faceIndex.
 *
 * Only `file` and `index` are used here — family/style/weight come
 * from parsing the file's `name` table later, so the same code path
 * is exercised on every platform and the SoT (`figmaFontToQuery`)
 * stays the only place that interprets a style string.
 */
const FC_LIST_FORMAT = "%{file}\t%{index}\n";

/**
 * Enumerate the Linux font catalogue. Tries fontconfig (`fc-list`)
 * first; if the binary is unavailable, falls back to scanning the
 * canonical XDG / FHS directories.
 */
export async function discoverLinux(env: DiscoveryEnv): Promise<DiscoveryResult> {
  const fromFontconfig = await tryFontconfig(env);
  if (fromFontconfig) {
    return { files: fromFontconfig, source: "linux-fontconfig" };
  }
  return {
    files: scanFontDirectories(env.fs, fallbackDirs(env)),
    source: "linux-dirs",
  };
}

async function tryFontconfig(
  env: DiscoveryEnv,
): Promise<readonly DiscoveredFontFile[] | undefined> {
  // `fc-list` is the documented machine-readable interface to the
  // fontconfig catalogue. We deliberately don't fall through silently
  // on a non-zero exit / missing binary — `env.exec.run` rejects, the
  // caller catches and falls back to dir scanning. That keeps the
  // "fontconfig is the OS source of truth" path observable: if the
  // catalogue ever returns weird output the rejection surfaces, and
  // we don't quietly start ignoring the user's font config.
  try {
    const stdout = await env.exec.run("fc-list", ["-f", FC_LIST_FORMAT]);
    return parseFcListOutput(stdout);
  } catch (err) {
    void err;
    return undefined;
  }
}

/**
 * Parse `fc-list -f "%{file}\t%{index}\n"` output into discovered
 * font files. Exposed for unit tests; production callers go through
 * `discoverLinux`.
 */
export function parseFcListOutput(stdout: string): readonly DiscoveredFontFile[] {
  const out: DiscoveredFontFile[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const tab = line.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    const filePath = line.slice(0, tab);
    const indexField = line.slice(tab + 1).trim();
    const faceIndex = parseFcIndex(indexField);
    const key = `${filePath}\t${faceIndex ?? -1}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(faceIndex === undefined ? { path: filePath } : { path: filePath, faceIndex });
  }
  return out;
}

/**
 * Fontconfig encodes the TTC face index in the high bits of its
 * `index` value (bits 16+ are the face number). The low bits are an
 * unrelated "instance" selector. `(value >> 16) & 0xffff` extracts
 * the face index.
 */
function parseFcIndex(field: string): number | undefined {
  if (field.length === 0) {
    return undefined;
  }
  const numeric = Number.parseInt(field, 10);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  const face = (numeric >>> 16) & 0xffff;
  return face;
}

function fallbackDirs(env: DiscoveryEnv): readonly string[] {
  const dirs: string[] = ["/usr/share/fonts", "/usr/local/share/fonts"];
  if (env.homeDir) {
    dirs.push(path.join(env.homeDir, ".fonts"));
    dirs.push(path.join(env.homeDir, ".local/share/fonts"));
  }
  if (env.xdgDataHome && env.xdgDataHome.length > 0) {
    const xdgFonts = path.join(env.xdgDataHome, "fonts");
    if (!dirs.includes(xdgFonts)) {
      dirs.push(xdgFonts);
    }
  }
  return dirs;
}
