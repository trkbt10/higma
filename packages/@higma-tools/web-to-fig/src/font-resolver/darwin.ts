/**
 * @file macOS-backed FontResolver implementation.
 *
 * Reads the installed-font registry from `system_profiler
 * SPFontsDataType -json` and resolves a captured CSS font-family
 * stack to the first concrete installed family name. Generic
 * families (`sans-serif`, `monospace`, …) and the Apple-specific
 * keywords every browser stack starts with (`-apple-system`,
 * `system-ui`, `BlinkMacSystemFont`) route to the macOS defaults
 * that those keywords map to in WebKit / Blink: SF Pro Text /
 * SF Mono / New York. The mapping table mirrors WebKit's
 * `PlatformFontFamilies.cpp` so the IR carries the same family the
 * browser actually painted with.
 *
 * The implementation is deliberately synchronous (shells out once at
 * resolver-construction time and caches the parsed Set in memory).
 * The catalog is small (a few hundred entries) and the resolver gets
 * called once per text-bearing node, so an async per-call lookup
 * would be a worse trade than a one-shot load.
 *
 * Throws when the host is not macOS — there is no fall-through to a
 * generic implementation per AGENTS.md Fail-Fast policy. Callers
 * select this implementation only when `process.platform === "darwin"`.
 */
import { execFileSync } from "node:child_process";
import {
  UnresolvedFontStackError,
  type FontResolver,
  type FontStackCandidate,
  type GenericFamily,
} from "../normalize/font-resolver";

/**
 * macOS-installed font catalog. The Set holds *family* names (the
 * label that authors use in CSS, e.g. `"Helvetica Neue"`), the
 * `fullname` (e.g. `"Helvetica Neue Bold"`), and the PostScript
 * `_name` (e.g. `"HelveticaNeue-Bold"`) — all three because CSS
 * `font-family: 'HelveticaNeue-Bold'` is legal and browsers accept
 * any of the three forms.
 */
export type DarwinFontCatalog = {
  readonly installed: ReadonlySet<string>;
};

/**
 * Map a CSS generic family to the macOS default that ships under
 * that keyword on Sequoia / Sonoma / Ventura. `system-ui` and
 * friends route to SF Pro Text — the family WebKit dispatches to
 * when JavaScript reads `getComputedStyle(...).fontFamily` on an
 * element whose author CSS says `system-ui`.
 *
 * Sourced from WebKit's
 * `Source/WebCore/platform/graphics/cocoa/SystemFontDatabaseCocoa.mm`
 * (the `systemFontFamily()` helper) and Apple's "System Fonts" docs.
 * Hard-coded here rather than queried from `system_profiler` because
 * the alias chain is platform behaviour, not catalogue data.
 */
/**
 * Map a CSS generic family / Apple-specific keyword to the family
 * name macOS's own `name` table records for the font WebKit dispatches
 * to. The values here MUST match the strings the node-loader's font
 * index would return for the same physical file — otherwise the
 * resolver writes "SF Pro" into the IR and the renderer's font
 * driver, scanning the same `/System/Library/Fonts/SFNS.ttf` and
 * reading its `windows.fontFamily.en` ("System Font"), can't find a
 * match. The values were derived by inspecting the `name` table of
 * each `.ttf` reachable under `/System/Library/Fonts/` on macOS Sonoma /
 * Ventura / Sequoia (e.g. `SFNS.ttf` → "System Font", `Menlo.ttc` →
 * "Menlo", `Helvetica.ttc` → "Helvetica Neue"). Re-deriving the
 * mapping when Apple ships a renamed file is a single-table edit here.
 */
const GENERIC_TO_MACOS_FAMILY: Readonly<Record<GenericFamily, string>> = {
  serif: "Times New Roman",
  "sans-serif": "Helvetica Neue",
  monospace: "Menlo",
  cursive: "Apple Chancery",
  fantasy: "Papyrus",
  "system-ui": "System Font",
  "ui-serif": "New York",
  "ui-sans-serif": "System Font",
  "ui-monospace": "Menlo",
  "ui-rounded": ".SF NS Rounded",
  math: "STIX Two Math",
  emoji: "Apple Color Emoji",
  fangsong: "STSong",
};

/**
 * Apple-specific keyword aliases the browser exposes verbatim through
 * `getComputedStyle`. They are NOT generic CSS keywords (so
 * `parseFontStack` classifies them as `kind: "name"`), but they
 * route to the same OS family the corresponding `system-ui` branch
 * resolves to — every `-apple-system*` variant the browser exposes
 * targets `SFNS.ttf`, which the OS `name` table labels "System Font".
 */
const APPLE_KEYWORD_TO_MACOS_FAMILY: Readonly<Record<string, string>> = {
  "-apple-system": "System Font",
  "-apple-system-headline": "System Font",
  "-apple-system-subheadline": "System Font",
  "-apple-system-body": "System Font",
  "-apple-system-caption1": "System Font",
  "-apple-system-caption2": "System Font",
  "-apple-system-footnote": "System Font",
  "-apple-system-short-headline": "System Font",
  "-apple-system-short-subheadline": "System Font",
  "-apple-system-short-body": "System Font",
  "-apple-system-short-caption1": "System Font",
  "-apple-system-short-footnote": "System Font",
  "-apple-system-tall-body": "System Font",
  "BlinkMacSystemFont": "System Font",
};

/**
 * Build a FontResolver backed by the host's installed-font catalogue.
 * Shells out to `system_profiler` once and parses the result; the
 * resulting resolver is pure and reuses the parsed catalogue for
 * every call.
 */
export function createDarwinFontResolver(): FontResolver {
  if (process.platform !== "darwin") {
    throw new Error(
      `createDarwinFontResolver: unsupported platform "${process.platform}" — `
        + "use the in-page resolver or supply a different platform-specific implementation.",
    );
  }
  const catalog = loadDarwinFontCatalog();
  return resolverFromCatalog(catalog);
}

/**
 * Build a resolver from a pre-parsed catalogue. Exposed for the
 * `darwin-font-resolver.spec.ts` unit tests so they can drive
 * deterministic catalogues without depending on the host's installed
 * fonts (which would make CI flaky across machines).
 */
export function resolverFromCatalog(catalog: DarwinFontCatalog): FontResolver {
  return {
    resolve(stack: readonly FontStackCandidate[]): string {
      for (const candidate of stack) {
        const resolved = resolveCandidate(candidate, catalog);
        if (resolved !== undefined) {
          return resolved;
        }
      }
      throw new UnresolvedFontStackError(stack);
    },
  };
}

function resolveCandidate(
  candidate: FontStackCandidate,
  catalog: DarwinFontCatalog,
): string | undefined {
  if (candidate.kind === "generic") {
    return GENERIC_TO_MACOS_FAMILY[candidate.value];
  }
  // Apple keyword (`-apple-system`, …) → mapped default. We DO NOT
  // walk the catalogue for these — the OS resolves them through a
  // separate font-descriptor chain that the catalogue listing can't
  // see, so trusting the alias map is more accurate than
  // approximating with "does the literal string match any installed
  // family?".
  const apple = APPLE_KEYWORD_TO_MACOS_FAMILY[candidate.value];
  if (apple !== undefined) {
    return apple;
  }
  if (catalog.installed.has(candidate.value)) {
    return candidate.value;
  }
  return undefined;
}

/**
 * Shell out to `system_profiler` and convert the JSON dump into a
 * Set of all known font identifiers (family names + full names +
 * PostScript names). Throws when the subprocess fails — there is no
 * fall-through to "assume no fonts installed", because that branch
 * would silently produce a resolver that always returns the generic
 * default and the diff would silently regress.
 */
export function loadDarwinFontCatalog(): DarwinFontCatalog {
  const raw = execFileSync(
    "/usr/sbin/system_profiler",
    ["SPFontsDataType", "-json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return parseDarwinFontDump(raw);
}

/** Parse the JSON payload produced by `system_profiler SPFontsDataType -json`. */
export function parseDarwinFontDump(json: string): DarwinFontCatalog {
  const parsed = JSON.parse(json) as DarwinFontDump;
  const installed = new Set<string>();
  for (const entry of parsed.SPFontsDataType ?? []) {
    for (const face of entry.typefaces ?? []) {
      if (typeof face.family === "string" && face.family.length > 0) {
        installed.add(face.family);
      }
      if (typeof face.fullname === "string" && face.fullname.length > 0) {
        installed.add(face.fullname);
      }
      if (typeof face._name === "string" && face._name.length > 0) {
        installed.add(face._name);
      }
    }
  }
  return { installed };
}

type DarwinFontDump = {
  readonly SPFontsDataType?: readonly {
    readonly typefaces?: readonly {
      readonly _name?: string;
      readonly family?: string;
      readonly fullname?: string;
    }[];
  }[];
};
