/**
 * @file Physical font family aliases — per-environment loader-level
 * same-file SoT.
 *
 * Font resolution is environment-specific: the same `FontQuery`
 * resolves through different name-table realities on macOS, Linux,
 * Windows. A flat alias map collapses that distinction and leaves
 * latent silent-substitution risk on platforms whose name tables
 * happen to share spellings. This module therefore keys aliases by
 * `FontPlatform`; every consumer (browser loader, Node loader,
 * SVG/WebGL rendering) MUST hand in the environment it is running
 * against.
 *
 * Distinct from `COMMON_FONT_MAPPINGS` (CSS emission chain — fine to
 * include CSS keywords like `-apple-system`, generic stacks ending
 * in `sans-serif`): this module records ONLY family names a
 * `FontLoader` can take. The entries here represent the *same
 * physical font file* exposed to design tools and OS catalogues
 * under different family spellings — not a fallback to a different
 * font.
 *
 * Evidence-strength tags used per entry:
 *   [V] = directly verified on disk / in upstream source code,
 *   [R] = corroborated by in-repo SoT or existing convention,
 *   [C] = consensus / Apple-documented historical behaviour, not
 *         directly verified at code-author time.
 *
 * # darwin — verified entries
 *
 * ## "SF Pro" ↔ "System Font"
 *
 *   [V] `/System/Library/Fonts/SFNS.ttf` carries
 *       `name.fontFamily.en = "System Font"`.
 *       Confirmed via `system_profiler SPFontsDataType -json` on
 *       macOS Sequoia 2026-05-13 (369 named instances, every one
 *       under family "System Font"; no SF Pro on the system).
 *   [V] `darwin-name-table-reality.spec.ts` parses the file at test
 *       time and asserts the same name. Self-skips on non-macOS.
 *   [V] Chromium's `queryLocalFonts` reads `kCTFontFamilyNameAttribute`
 *       verbatim with no dot-prefix / system-font filter — see
 *       `content/browser/font_access/font_enumeration_data_source_mac.mm`
 *       (fetched 2026-05-13). SFNS.ttf therefore reaches `family =
 *       "System Font"` on macOS Chromium.
 *   [R] `mappings.ts:49-51` and `web-to-fig/font-resolver/darwin.ts`
 *       already document the SFNS ↔ "System Font" identity in the
 *       sibling code paths.
 *   [V] The user's error report
 *       (`preloadFonts: font "SF Pro" (weight=400, style=normal) is
 *       not available …`) confirms Figma stores the marketing name
 *       "SF Pro" in `fontName.family`.
 *
 * ## "SF Pro Display" / "SF Pro Text" → "SF Pro" → "System Font"
 *
 *   [C] Pre-Big-Sur shipped `SFNSDisplay-*.otf` / `SFNSText-*.otf`
 *       as separate files; macOS 11+ collapses both into the
 *       variable `SFNS.ttf` with an `opsz` axis. The chain reaches
 *       the same variable file SFNS.ttf serves on modern macOS; on
 *       pre-Big-Sur the direct match at the head of the chain
 *       catches the .otf before the alias walk activates.
 *   [R] `COMMON_FONT_MAPPINGS` already lists both labels.
 *
 * ## "SF Pro Rounded" ↔ ".SF NS Rounded"
 *
 *   [V] `SFNSRounded.ttf` carries `name.fontFamily.en = ".SF NS
 *       Rounded"` — a different physical file with rounded glyphs
 *       (not the same bytes as SFNS.ttf). Verified via
 *       `system_profiler` 2026-05-13 and via the on-disk
 *       `name`-table check in `darwin-name-table-reality.spec.ts`.
 *   [V] The macOS Chromium font catalogue surfaces the file under
 *       `kCTFontFamilyNameAttribute` verbatim — same name-table
 *       value — so the browser-side `queryLocalFonts` catalogue
 *       reaches the same key.
 *   The marketing label Figma stores is "SF Pro Rounded"; the OS
 *   catalogue key is ".SF NS Rounded". Aliasing them is mandatory
 *   for the rounded glyph set to render; the dot-prefix is part of
 *   the on-disk name-table identity, not a CSS keyword.
 *   The alias chain MUST NOT include "System Font" — that file is
 *   the non-rounded SFNS.ttf, and substituting it would silently
 *   swap rounded glyphs for square ones.
 *
 * # linux — no entries yet (intentional)
 *
 * Linux relies on fontconfig (`fc-match`) for OS-level aliasing.
 * `fc-list` reports each font under its own embedded family name;
 * the renderer's Linux loader (`discoverLinux` + fontconfig) walks
 * generic stacks via `GENERIC_FONT_STACKS` for CSS keywords. There
 * is no documented OS-level "SF Pro ↔ X" alias on Linux because
 * neither SFNS.ttf nor the Apple marketing labels ship with the
 * platform; a `.fig` that authors "SF Pro" on Linux is genuinely
 * unrenderable without an explicit install, and the fail-fast
 * undefined-return surfaces that loudly.
 *
 * # win32 — no entries yet (intentional)
 *
 * The Windows Fonts registry uses display names (e.g. "Segoe UI
 * Variable") that match what `kCTFontFamilyNameAttribute`'s Windows
 * equivalent (`Get*FontFamilyName` via DirectWrite) reports — no
 * marketing-vs-name-table divergence has been verified for
 * Windows-shipped fonts. Until a concrete divergence is documented,
 * any "SF Pro" request on Windows fails fast (the marketing name
 * is macOS-specific).
 *
 * # unknown — empty
 *
 * Sandboxed / non-standard environments default to no aliases. Any
 * loader running on an unknown platform must treat the catalogue as
 * authoritative — no inferred substitution.
 *
 * # Adding new entries
 *
 * Only when the alternate name corresponds to the *same* `.ttf` /
 * `.ttc` / variable font for that specific platform, with [V]-level
 * on-disk evidence cited in the entry's comment. CSS-fallback
 * style aliases belong in `COMMON_FONT_MAPPINGS`.
 */

/**
 * Platforms the alias SoT understands. `unknown` is the safe
 * default for hosts where the running environment cannot be
 * determined (sandboxed runners without a UA, CI with stripped
 * `process.platform`, future OSes the catalogue has not been
 * audited against).
 */
export type FontPlatform = "darwin" | "linux" | "win32" | "unknown";

/**
 * Map a Node.js `process.platform` value into the SoT's
 * `FontPlatform`. Non-darwin/linux/win32 values become `unknown`;
 * the loader treats that as "no aliasing, catalogue is
 * authoritative".
 */
export function fontPlatformFromNodePlatform(p: NodeJS.Platform): FontPlatform {
  if (p === "darwin" || p === "linux" || p === "win32") {
    return p;
  }
  return "unknown";
}

/**
 * Detect the host OS the running browser reports through
 * `navigator.userAgent`. Returns `unknown` when navigator is absent
 * (Node, jsdom-less Vitest, headless contexts before init scripts).
 *
 * The browser does not expose the OS directly through the Local
 * Font Access API; UA sniffing is the only signal available before
 * the catalogue is built. Test harnesses can pre-set
 * `navigator.userAgent` (or `globalThis.navigator`) via Playwright's
 * `addInitScript` / Vitest's environment override to drive each
 * platform's resolution path deterministically.
 */
export function detectBrowserFontPlatform(): FontPlatform {
  if (typeof navigator === "undefined") {
    return "unknown";
  }
  const ua = navigator.userAgent;
  if (typeof ua !== "string" || ua.length === 0) {
    return "unknown";
  }
  if (/Mac OS X|Macintosh|iPhone|iPad/i.test(ua)) {
    // iPhone / iPad don't expose Local Font Access (the API is
    // chromium-desktop-only at the time of writing), but if a future
    // mobile browser ever ships it, SFNS.ttf still records "System
    // Font" — the alias chain is correct for the same OS family.
    return "darwin";
  }
  if (/Windows NT|Win64|Win32/i.test(ua)) {
    return "win32";
  }
  if (/X11|Linux|FreeBSD|OpenBSD|NetBSD/i.test(ua)) {
    return "linux";
  }
  return "unknown";
}

const DARWIN_ALIASES: ReadonlyMap<string, readonly string[]> = new Map([
  // SFNS.ttf (verified — see file docstring).
  ["SF Pro", ["SF Pro", "System Font"]],
  // Pre-Big-Sur optical-size variants — collapsed into SFNS.ttf via
  // the `opsz` axis on modern macOS.
  ["SF Pro Display", ["SF Pro Display", "SF Pro", "System Font"]],
  ["SF Pro Text", ["SF Pro Text", "SF Pro", "System Font"]],
  // Reverse direction: a tool that catalogues SFNS.ttf under its
  // name-table family ("System Font") and later receives a request
  // authored against Apple's marketing name still finds the same
  // physical bytes.
  ["System Font", ["System Font", "SF Pro"]],
  // SFNSRounded.ttf (verified — see file docstring). The marketing
  // label "SF Pro Rounded" and the on-disk name-table family
  // ".SF NS Rounded" point at the same physical file; the rounded
  // glyph set is in this file and ONLY this file. The chain MUST
  // NOT include "System Font" — that's the non-rounded SFNS.ttf.
  ["SF Pro Rounded", ["SF Pro Rounded", ".SF NS Rounded"]],
  // Reverse: tools that catalogue the file under its name-table
  // family still reach the marketing-name request.
  [".SF NS Rounded", [".SF NS Rounded", "SF Pro Rounded"]],
]);

const EMPTY_ALIASES: ReadonlyMap<string, readonly string[]> = new Map();

const ALIASES_BY_PLATFORM: Readonly<Record<FontPlatform, ReadonlyMap<string, readonly string[]>>> = {
  darwin: DARWIN_ALIASES,
  linux: EMPTY_ALIASES,
  win32: EMPTY_ALIASES,
  unknown: EMPTY_ALIASES,
};

/**
 * Public introspection — returns the alias map for `platform`.
 * Consumers typically only need `getPhysicalFamilyAliases`; this
 * accessor exists for the spec layer to assert per-platform
 * contents without duplicating the map literal.
 */
export function physicalFamilyAliasesFor(
  platform: FontPlatform,
): ReadonlyMap<string, readonly string[]> {
  return ALIASES_BY_PLATFORM[platform];
}

/**
 * Return the alias chain a loader running on `platform` should walk
 * when resolving `family`. The first entry is always `family`
 * itself, even when no alias entry is registered for the
 * (platform, family) pair — that keeps the call site a single
 * for-loop regardless of whether the family has known aliases on
 * the current environment.
 *
 * Lookups are case-insensitive; the returned chain preserves the
 * canonical spelling from the platform's map so diagnostics stay
 * readable.
 */
export function getPhysicalFamilyAliases(
  family: string,
  platform: FontPlatform,
): readonly string[] {
  const map = ALIASES_BY_PLATFORM[platform];
  const familyLower = family.toLowerCase();
  for (const [key, aliases] of map) {
    if (key.toLowerCase() === familyLower) {
      return aliases;
    }
  }
  return [family];
}
