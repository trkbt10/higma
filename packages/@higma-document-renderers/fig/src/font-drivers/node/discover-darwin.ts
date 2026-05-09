/**
 * @file macOS font discovery.
 *
 * On macOS the OS-canonical resolver is CoreText. CoreText reads from
 * the same directories the user can see in Font Book:
 *
 *   /System/Library/Fonts                — Apple-shipped fonts. The
 *                                          `Supplemental/` subdirectory
 *                                          (Arial, Times New Roman,
 *                                          Courier New, ...) is reached
 *                                          by recursive descent.
 *   /Library/Fonts                       — site-wide, third-party
 *                                          installs (e.g. user fonts
 *                                          installed for "All Users").
 *   ~/Library/Fonts                      — per-user installs.
 *
 * CoreText also knows about disabled / network fonts (Font Book lists
 * "Computer", "User", "Disabled"). We don't surface disabled faces —
 * if the user has explicitly disabled a font in Font Book the
 * expectation is that it won't render. Network-mounted directories
 * appear under one of the above when present.
 *
 * The home-dir entry is included only when `homeDir` is set; with a
 * stripped `HOME` (some sandboxed runners) we previously produced the
 * literal string `"undefined/Library/Fonts"`, which `existsSync`
 * would happily report missing — silent loss of every user-installed
 * font.
 */

import * as path from "node:path";
import { scanFontDirectories } from "./discover-dirs";
import type { DiscoveryEnv, DiscoveryResult } from "./discover-types";

/**
 * Enumerate the macOS font catalogue by scanning the directories
 * CoreText reads. Synchronous from the caller's perspective — the
 * underlying directory walk is sync but the result is wrapped in
 * the `DiscoveryResult` shape every platform shares.
 */
export function discoverDarwin(env: DiscoveryEnv): DiscoveryResult {
  const dirs: string[] = ["/System/Library/Fonts", "/Library/Fonts"];
  if (env.homeDir) {
    dirs.push(path.join(env.homeDir, "Library/Fonts"));
  }
  return {
    files: scanFontDirectories(env.fs, dirs),
    source: "darwin-dirs",
  };
}
