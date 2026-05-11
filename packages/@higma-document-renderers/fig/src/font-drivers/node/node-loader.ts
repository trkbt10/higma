/**
 * @file Node.js font loader implementation.
 *
 * OS-correct font resolution: the loader asks the host operating
 * system itself which fonts are installed, then indexes those files
 * and answers `(family, weight, style)` queries against the index.
 *
 * Discovery strategy per platform:
 *
 *   darwin
 *     Scan the directories CoreText / Font Book consult:
 *     `/System/Library/Fonts`, `/Library/Fonts`, `~/Library/Fonts`.
 *     CoreText itself walks these same paths, so the disk view
 *     matches what the OS resolves.
 *
 *   linux
 *     Invoke `fc-list` — fontconfig is the Linux OS-canonical
 *     resolver. This honours every `<dir>` entry from
 *     `/etc/fonts/fonts.conf`, `/etc/fonts/conf.d/*.conf`, and
 *     `~/.config/fontconfig/fonts.conf`, so we resolve against the
 *     same catalogue every other Linux GUI app uses. If `fc-list`
 *     is unavailable we fall back to scanning the canonical
 *     XDG / FHS dirs.
 *
 *   win32
 *     Read the Fonts registry keys (`HKLM` + `HKCU`) — that is the
 *     OS's record of which fonts are installed; the directory
 *     `C:\Windows\Fonts` is only the default storage location.
 *     If `reg.exe` is unavailable we fall back to scanning the
 *     canonical Fonts dirs.
 *
 * Weight/style detection delegates to the canonical SoT
 * (`figmaFontToQuery`); driver-local re-implementations would drift
 * from the resolver's interpretation and produce mismatched cache
 * lookups.
 *
 * Fail-fast policy: when the requested family is not present in the
 * index, `loadFont` returns `undefined`. The path-renderer caller
 * treats that as a hard error (see `path-render.ts`). The loader
 * does NOT silently substitute a generic-stack fallback for
 * arbitrary user families — that would mask missing-font installs
 * as successful renders. Only requests that themselves name a CSS
 * generic keyword (`sans-serif`, `serif`, `monospace`, `system-ui`,
 * ...) walk the keyword's published stack; that is CSS-defined
 * behaviour, not a defensive rescue.
 */

import { spawn } from "node:child_process";
import * as fsDefault from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseFont } from "opentype.js";
import type { FontLoader } from "@higma-document-models/fig/font";
import type { FontQuery } from "@higma-document-models/fig/font";
import { figmaFontToQuery } from "@higma-document-models/fig/font";
import { GENERIC_FONT_STACKS } from "@higma-document-models/fig/font";
import type { LoadedFont } from "@higma-document-models/fig/font";
import { extractTtcFaces, isTtc } from "./ttc";
import { discoverDarwin } from "./discover-darwin";
import { discoverLinux } from "./discover-linux";
import { discoverWin32 } from "./discover-win32";
import { classifyFontFile, scanFontDirectories } from "./discover-dirs";
import { getVariableAxes, variationForWeight, wrapFontWithVariation } from "./variable-font";
import { applyGposExtensionFixup } from "./gpos-extension/fixup";
import type {
  DiscoveredFontFile,
  DiscoveryEnv,
  DiscoveryExec,
  DiscoveryFs,
  DiscoveryResult,
  DiscoverySource,
} from "./discover-types";

type FontNameRecord = Record<string, { en?: string } | undefined>;
type PlatformFontNameRecord = Record<string, FontNameRecord | undefined>;

function isNameRecord(names: unknown): names is FontNameRecord {
  return typeof names === "object" && names !== null;
}

function toNameRecord(names: unknown): FontNameRecord {
  if (isNameRecord(names)) {
    return names;
  }
  return {};
}

function isPlatformNameRecord(names: unknown): names is PlatformFontNameRecord {
  return typeof names === "object" && names !== null;
}

/**
 * Read an English-localized name table entry. Tries the top-level record
 * first, then the Windows and Macintosh platform-specific tables. Some
 * font files (notably Adobe-tagged TTFs and certain Asian faces) only
 * populate the platform-scoped tables.
 */
function fontNameValue(names: unknown, key: string): string | undefined {
  const direct = toNameRecord(names)[key]?.en;
  if (direct !== undefined) {
    return direct;
  }
  if (!isPlatformNameRecord(names)) {
    return undefined;
  }
  const windows = names.windows?.[key]?.en;
  if (windows !== undefined) {
    return windows;
  }
  const macintosh = names.macintosh?.[key]?.en;
  if (macintosh !== undefined) {
    return macintosh;
  }
  return undefined;
}

function isLoadedFontType(font: unknown): font is LoadedFont["font"] {
  return typeof font === "object" && font !== null;
}

function toLoadedFontType(font: unknown): LoadedFont["font"] {
  if (isLoadedFontType(font)) {
    return font;
  }
  throw new Error("Invalid font data");
}

/**
 * Indexed font face metadata. `query` is the canonical face descriptor.
 *
 * `faceIndex` selects a single face inside a `.ttc` collection (0 for
 * standalone files). The loader copies that face out to a fresh
 * single-face TTF buffer at parse time so opentype.js can read it.
 */
type FontFileInfo = {
  readonly path: string;
  readonly query: FontQuery;
  readonly postscriptName?: string;
  readonly faceIndex: number;
};

/**
 * Pluggable host-environment surface — `fs` access, current platform,
 * exec for OS resolver invocations, and the env vars used to locate
 * per-user font dirs. The default factory wires this to the real
 * `node:fs`, `child_process`, and `process` so production call sites
 * are unchanged. Unit tests inject a fake to drive platform-specific
 * discovery without touching the host filesystem.
 */
export type NodeFontLoaderEnv = {
  readonly fs: DiscoveryFs;
  readonly exec: DiscoveryExec;
  readonly platform: NodeJS.Platform;
  /** Absolute path to the user's home directory (`os.homedir()`). */
  readonly homeDir: string | undefined;
  /** Resolved `%LOCALAPPDATA%` (Windows) — empty/undefined when missing. */
  readonly localAppData: string | undefined;
  /** Resolved `%WINDIR%` / `%SystemRoot%` (Windows). */
  readonly windowsDir: string | undefined;
  /** `$XDG_DATA_HOME` for Linux per-user font discovery. */
  readonly xdgDataHome: string | undefined;
  /** `$XDG_CONFIG_HOME` — reserved for future fontconfig user-config parsing. */
  readonly xdgConfigHome: string | undefined;
  /** `process.cwd()` — used by the `@fontsource` discovery helper. */
  readonly cwd: string;
};

function defaultExec(): DiscoveryExec {
  return {
    run(cmd: string, args: readonly string[]): Promise<string> {
      return new Promise((resolve, reject) => {
        const child = spawn(cmd, [...args], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
        child.on("error", (err) => reject(err));
        child.on("close", (code) => {
          if (code === 0) {
            resolve(Buffer.concat(stdoutChunks).toString("utf8"));
            return;
          }
          const stderr = Buffer.concat(stderrChunks).toString("utf8");
          reject(new Error(`${cmd} exited with code ${code ?? "null"}: ${stderr}`));
        });
      });
    },
  };
}

function defaultNodeFontLoaderEnv(): NodeFontLoaderEnv {
  return {
    fs: fsDefault,
    exec: defaultExec(),
    platform: process.platform,
    homeDir: os.homedir() || undefined,
    localAppData: process.env.LOCALAPPDATA || undefined,
    windowsDir: process.env.WINDIR || process.env.SystemRoot || undefined,
    xdgDataHome: process.env.XDG_DATA_HOME || undefined,
    xdgConfigHome: process.env.XDG_CONFIG_HOME || undefined,
    cwd: process.cwd(),
  };
}

function toDiscoveryEnv(env: NodeFontLoaderEnv): DiscoveryEnv {
  return {
    fs: env.fs,
    exec: env.exec,
    homeDir: env.homeDir,
    localAppData: env.localAppData,
    windowsDir: env.windowsDir,
    xdgDataHome: env.xdgDataHome,
    xdgConfigHome: env.xdgConfigHome,
  };
}

async function discoverForPlatform(env: NodeFontLoaderEnv): Promise<DiscoveryResult> {
  const discovery = toDiscoveryEnv(env);
  switch (env.platform) {
    case "darwin":
      return discoverDarwin(discovery);
    case "linux":
      return discoverLinux(discovery);
    case "win32":
      return discoverWin32(discovery);
    default:
      // Unknown platform — return an empty catalogue rather than
      // pretending one of the strategies applies. Callers will see
      // `loadFont` return `undefined` and surface the missing OS
      // support at the call site.
      return { files: [], source: "empty" };
  }
}

function weightDistance(requested: number, actual: number): number {
  return Math.abs(requested - actual);
}

/** Node font loader with additional capabilities. */
export type NodeFontLoaderInstance = FontLoader & {
  /** List available font families. */
  listFontFamilies(): Promise<readonly string[]>;
  /** Add a custom font file. */
  addFontFile(fontPath: string): Promise<void>;
  /**
   * Discovery source used to populate the catalogue (e.g. `linux-fontconfig`,
   * `darwin-dirs`). Awaits index construction. Useful for diagnostics
   * and tests.
   */
  catalogueSource(): Promise<DiscoverySource>;
};

/**
 * Read a font file off disk into a fresh `ArrayBuffer`.
 *
 * Why the explicit copy: `fs.readFileSync` returns a Node `Buffer`
 * whose `.buffer` is a slab shared with other Buffers allocated near
 * it. Passing `.buffer` raw to opentype.js makes the parser walk
 * neighbouring files' bytes whenever the slab is reused — which
 * silently corrupts every face after the first in a directory scan.
 * We copy the exact byte range we own into a brand-new ArrayBuffer
 * here so downstream consumers always see clean input.
 */
function readFontFileBytes(fs: DiscoveryFs, fontPath: string): ArrayBuffer {
  const data = fs.readFileSync(fontPath);
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return copy;
}

/**
 * Parse one face out of an on-disk font file and apply the GPOS
 * Extension Positioning fixup so kerning works on macOS system fonts.
 *
 * For `.ttc` collections, `faceIndex` selects which face to return
 * (0..N-1). For single-face files `faceIndex` must be 0.
 *
 * The fixup mutates `font.tables.gpos.lookups` in place to resolve
 * LookupType 9 (Extension Positioning) wrappers that opentype.js 1.3.x
 * leaves unparsed. Without it `font.getKerningValue` returns 0 for every
 * pair on SFNS / SF Compact, and the path renderer accumulates a
 * horizontal drift across every paragraph. See `gpos-extension/fixup.ts`
 * for the full diagnosis.
 */
function parseFaceAt(
  fs: DiscoveryFs,
  fontPath: string,
  faceIndex: number,
): ReturnType<typeof parseFont> {
  const buffer = readFontFileBytes(fs, fontPath);
  if (isTtc(buffer)) {
    const faces = extractTtcFaces(buffer);
    const face = faces[faceIndex];
    if (face === undefined) {
      throw new Error(`parseFaceAt: TTC ${fontPath} has no face at index ${faceIndex}`);
    }
    const font = parseFont(face);
    applyGposExtensionFixup(font, face);
    return font;
  }
  if (faceIndex !== 0) {
    throw new Error(`parseFaceAt: non-TTC ${fontPath} has only one face but faceIndex=${faceIndex} was requested`);
  }
  const font = parseFont(buffer);
  applyGposExtensionFixup(font, buffer);
  return font;
}

async function getFontInfos(
  fs: DiscoveryFs,
  discovered: DiscoveredFontFile,
): Promise<readonly FontFileInfo[]> {
  const buffer = readFontFileBytes(fs, discovered.path);
  if (isTtc(buffer)) {
    const faces = extractTtcFaces(buffer);
    if (discovered.faceIndex !== undefined) {
      const face = faces[discovered.faceIndex];
      if (!face) {
        return [];
      }
      const info = describeFace(parseFont(face), discovered.path, discovered.faceIndex);
      return info ? [info] : [];
    }
    const out: FontFileInfo[] = [];
    for (let i = 0; i < faces.length; i += 1) {
      const info = describeFace(parseFont(faces[i]!), discovered.path, i);
      if (info) {
        out.push(info);
      }
    }
    return out;
  }
  const info = describeFace(parseFont(buffer), discovered.path, 0);
  return info ? [info] : [];
}

function describeFace(
  font: ReturnType<typeof parseFont>,
  fontPath: string,
  faceIndex: number,
): FontFileInfo | null {
  const family = fontNameValue(font.names, "fontFamily")
    ?? fontNameValue(font.names, "preferredFamily")
    ?? deriveFamilyFromFilename(fontPath);
  const subfamily = fontNameValue(font.names, "fontSubfamily")
    ?? deriveSubfamilyFromFilename(fontPath)
    ?? "";
  const postscriptName = fontNameValue(font.names, "postScriptName");
  if (!family) {
    return null;
  }
  // Defer (weight, style) detection to the canonical SoT — `figmaFontToQuery`
  // applies the same `detectWeight` / `detectStyle` rules a resolver call
  // would, so driver indexing matches resolver lookups exactly.
  const query = figmaFontToQuery({ family, style: subfamily || family });
  return { path: fontPath, query, postscriptName, faceIndex };
}

/**
 * Derive a usable family name from a font filename when the font's
 * embedded `name` table doesn't expose one. The single case we
 * accommodate is the macOS variable system font `SFNS.ttf` — its
 * names are gated behind named instances opentype.js doesn't surface,
 * so without a derive step every variable system font on disk silently
 * disappears from the index.
 *
 * The derive step is deliberately narrow: only basenames that look like
 * a single family token ("SFNS", "Helvetica") with at most a single
 * trailing weight/style descriptor qualify. Anything containing
 * multiple `-` or `_` segments — typical of fontsource bundles
 * (`inter-cyrillic-400-normal.woff`) or web-distributed subsets —
 * is left out so we don't pollute the family index with synthetic
 * names that would never match a real `loadFont` query.
 */
function deriveFamilyFromFilename(fontPath: string): string | undefined {
  const base = path.basename(fontPath, path.extname(fontPath));
  if (/[-_]/.test(base.replace(/(?:[ _-]?(Italic|Oblique|Bold|Black|Heavy|Light|Thin|Medium|Regular))+$/i, ""))) {
    return undefined;
  }
  const stripped = base.replace(/(?:[ _-]?(Italic|Oblique|Bold|Black|Heavy|Light|Thin|Medium|Regular))+$/i, "");
  if (stripped.length === 0) {
    return undefined;
  }
  return stripped;
}

function deriveSubfamilyFromFilename(fontPath: string): string | undefined {
  const base = path.basename(fontPath, path.extname(fontPath));
  if (/[-_]/.test(base.replace(/(?:[ _-]?(Italic|Oblique|Bold|Black|Heavy|Light|Thin|Medium|Regular))+$/i, ""))) {
    return undefined;
  }
  const match = /(Italic|Oblique|Bold|Black|Heavy|Light|Thin|Medium|Regular)$/i.exec(base);
  return match ? match[1] : undefined;
}

async function indexDiscoveredFiles(
  fs: DiscoveryFs,
  files: readonly DiscoveredFontFile[],
): Promise<Map<string, FontFileInfo[]>> {
  const index = new Map<string, FontFileInfo[]>();
  for (const file of files) {
    // Indexing must be resilient: an OS-installed font directory always
    // contains at least one file the parser can't read on a given
    // version of opentype.js. Catching and skipping per-file means a
    // bad apple doesn't sink the whole index. Throwing during the
    // parse would only mask the rest of the system font catalogue.
    const infos = await safelyReadFontInfos(fs, file);
    for (const info of infos) {
      const familyLower = info.query.family.toLowerCase();
      const existing = index.get(familyLower) ?? [];
      index.set(familyLower, [...existing, info]);
    }
  }
  return index;
}

async function safelyReadFontInfos(
  fs: DiscoveryFs,
  discovered: DiscoveredFontFile,
): Promise<readonly FontFileInfo[]> {
  // Unparseable fonts (corrupt cmap, missing decoder, exotic
  // subtables) silently drop out of the index — callers asking for
  // them via loadFont will get `undefined`. Throwing here would
  // sink the entire system-font scan.
  try {
    return await getFontInfos(fs, discovered);
  } catch (err) {
    void err;
    return [];
  }
}

/**
 * Look up an indexed family.
 *
 * Resolution rules:
 *   1. Direct case-insensitive match on the requested family.
 *   2. If the request is itself a CSS generic keyword
 *      (`sans-serif`, `serif`, `monospace`, `system-ui`, `cursive`,
 *      `fantasy`), walk the keyword's published stack and return the
 *      first match. This is CSS-correct behaviour, not a defensive
 *      rescue: a request that explicitly asks for the generic keyword
 *      means "any font in this category".
 *   3. Otherwise return `undefined`. The caller treats that as a
 *      hard failure (the path renderer throws). The loader never
 *      silently substitutes an unrelated family for a missing one —
 *      that would mask real install gaps as successful renders.
 */
function resolveVariants(
  index: Map<string, FontFileInfo[]>,
  family: string,
): FontFileInfo[] | undefined {
  const direct = index.get(family.toLowerCase());
  if (direct && direct.length > 0) {
    return direct;
  }
  const stack = GENERIC_FONT_STACKS.get(family.toLowerCase());
  if (!stack) {
    return undefined;
  }
  for (const candidate of stack) {
    const found = index.get(candidate.toLowerCase());
    if (found && found.length > 0) {
      return found;
    }
  }
  return undefined;
}

/**
 * Rank candidate variants for a query.
 *
 * Order of priority:
 *   1. style match (italic vs upright) — a wrong style is more
 *      visually disruptive than a near-miss weight.
 *   2. weight distance — minimal absolute delta from the requested
 *      numeric weight.
 *   3. postscriptName / path lex order — deterministic tiebreaker so
 *      two equally-good faces in the same family always resolve to
 *      the same one.
 */
function rankVariants(variants: readonly FontFileInfo[], query: FontQuery): readonly FontFileInfo[] {
  return [...variants].sort((a, b) => {
    const aStyleMatch = a.query.style === query.style ? 0 : 1;
    const bStyleMatch = b.query.style === query.style ? 0 : 1;
    if (aStyleMatch !== bStyleMatch) {
      return aStyleMatch - bStyleMatch;
    }

    const aWeight = weightDistance(query.weight, a.query.weight);
    const bWeight = weightDistance(query.weight, b.query.weight);
    if (aWeight !== bWeight) {
      return aWeight - bWeight;
    }

    const aPs = a.postscriptName ?? a.path;
    const bPs = b.postscriptName ?? b.path;
    if (aPs < bPs) {
      return -1;
    }
    if (aPs > bPs) {
      return 1;
    }
    return a.faceIndex - b.faceIndex;
  });
}

export type CreateNodeFontLoaderOptions = {
  /**
   * Additional directories to scan beyond the OS catalogue. Useful for
   * shipping bundled fonts alongside an application.
   */
  readonly fontDirs?: readonly string[];
  /**
   * Whether to consult the OS-canonical catalogue for the host
   * platform. Defaults to `true`; pass `false` to use only
   * `fontDirs`. Setting `false` with no `fontDirs` produces an
   * empty index — every `loadFont` call returns `undefined`.
   */
  readonly includeSystemFontDirs?: boolean;
};

/**
 * Public helper exposed for unit tests — internal callers should use
 * `createNodeFontLoader`. Tests inject a fake `NodeFontLoaderEnv` so
 * per-platform discovery can be exercised without touching the host
 * filesystem.
 */
export function createNodeFontLoaderWithEnv(
  env: NodeFontLoaderEnv,
  options?: CreateNodeFontLoaderOptions,
): NodeFontLoaderInstance {
  const customFontDirs = options?.fontDirs ?? [];
  const includeSystemFontDirs = options?.includeSystemFontDirs ?? true;
  const stateRef = {
    value: null as { readonly index: Map<string, FontFileInfo[]>; readonly source: DiscoverySource } | null,
  };
  const buildPromiseRef = { value: null as Promise<void> | null };

  async function buildIndex(): Promise<void> {
    const customFiles = scanFontDirectories(env.fs, customFontDirs);

    if (!includeSystemFontDirs) {
      const index = await indexDiscoveredFiles(env.fs, customFiles);
      stateRef.value = {
        index,
        source: customFontDirs.length > 0 ? "custom-dirs" : "empty",
      };
      return;
    }

    const osDiscovery = await discoverForPlatform(env);
    // OS files first so user-supplied custom dirs win on duplicate
    // family names — callers shipping a bundled "Inter" expect their
    // copy to take precedence over an older system install.
    const merged = mergeDiscovered([...osDiscovery.files], customFiles);
    const index = await indexDiscoveredFiles(env.fs, merged);

    const source: DiscoverySource = customFiles.length > 0 ? "custom-dirs" : osDiscovery.source;
    stateRef.value = { index, source };
  }

  async function ensureIndex(): Promise<Map<string, FontFileInfo[]>> {
    if (stateRef.value) {
      return stateRef.value.index;
    }
    if (!buildPromiseRef.value) {
      buildPromiseRef.value = buildIndex();
    }
    await buildPromiseRef.value;
    return stateRef.value!.index;
  }

  async function loadFont(query: FontQuery): Promise<LoadedFont | undefined> {
    const index = await ensureIndex();
    const variants = resolveVariants(index, query.family);

    if (!variants || variants.length === 0) {
      return undefined;
    }

    const sorted = rankVariants(variants, query);
    const bestMatch = sorted[0];
    if (!bestMatch) {
      return undefined;
    }

    const rawFont = toLoadedFontType(parseFaceAt(env.fs, bestMatch.path, bestMatch.faceIndex));

    // Variable fonts (SF Pro / SFNS, Roboto Flex, system Inter
    // variable, …) ship one file covering the full weight axis.
    // `glyph.getPath` in opentype.js does NOT consult the font's
    // variation table, so without wrapping the renderer paints the
    // file's default instance regardless of the requested CSS
    // weight. Wrap the Font in a thin view that routes per-glyph
    // path extraction through `font.variation.getTransform` so the
    // path commands the renderer extracts match the requested
    // weight/width.
    const variableAxes = getVariableAxes(rawFont);
    // The wrapping returns a Font view that applies `wght` immediately
    // and leaves `opsz` at the file's default. Per-render
    // `font-size` reaches the path renderer separately and updates
    // `opsz` via `setVariationOpticalSize` — the loader doesn't see
    // the size, so wiring it through here would split the SoT.
    const font = variableAxes
      ? wrapFontWithVariation(rawFont, variationForWeight(variableAxes, query.weight), variableAxes)
      : rawFont;

    return {
      font,
      query: bestMatch.query,
      postscriptName: bestMatch.postscriptName,
    };
  }

  return {
    loadFont,

    async isFontAvailable(family: string): Promise<boolean> {
      const index = await ensureIndex();
      return resolveVariants(index, family) !== undefined;
    },

    async listFontFamilies(): Promise<readonly string[]> {
      const index = await ensureIndex();
      const seen = new Set<string>();
      const out: string[] = [];
      for (const variants of index.values()) {
        const name = variants[0]?.query.family;
        if (!name) {
          continue;
        }
        const key = name.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        out.push(name);
      }
      return out;
    },

    async addFontFile(fontPath: string): Promise<void> {
      const kind = classifyFontFile(fontPath);
      if (kind === "woff2") {
        // Caller asked for an explicit `.woff2` add. opentype.js cannot
        // decompress brotli-encoded WOFF2 without an external decoder
        // wired in; rather than silently no-op (which would make the
        // family disappear from `loadFont` later) throw at the call
        // site so the configuration error is observable.
        throw new Error(
          `addFontFile: WOFF2 (.woff2) is not supported by the Node font loader (${fontPath}). ` +
            `Provide the .woff or .ttf/.otf variant instead.`,
        );
      }
      if (kind === "unknown") {
        throw new Error(`addFontFile: unsupported font extension: ${fontPath}`);
      }
      const index = await ensureIndex();
      const infos = await getFontInfos(env.fs, { path: fontPath });
      for (const info of infos) {
        const familyLower = info.query.family.toLowerCase();
        const existing = index.get(familyLower) ?? [];
        index.set(familyLower, [...existing, info]);
      }
    },

    async catalogueSource(): Promise<DiscoverySource> {
      await ensureIndex();
      return stateRef.value!.source;
    },
  };
}

function mergeDiscovered(
  primary: DiscoveredFontFile[],
  secondary: readonly DiscoveredFontFile[],
): readonly DiscoveredFontFile[] {
  const seen = new Set<string>();
  const out: DiscoveredFontFile[] = [];
  for (const file of [...primary, ...secondary]) {
    const key = `${file.path}\t${file.faceIndex ?? -1}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(file);
  }
  return out;
}

/**
 * Create a Node.js font loader wired to the host OS's font catalogue.
 *
 * Tests should use `createNodeFontLoaderWithEnv` with a fake
 * `NodeFontLoaderEnv`.
 */
export function createNodeFontLoader(
  options?: CreateNodeFontLoaderOptions,
): NodeFontLoaderInstance {
  return createNodeFontLoaderWithEnv(defaultNodeFontLoaderEnv(), options);
}

/**
 * Create a Node.js font loader that supplements the OS catalogue with
 * `@fontsource` packages installed under `node_modules`.
 *
 * `@fontsource` is NOT an OS resolver — it is a JavaScript-package-
 * distributed bundle of web fonts. This helper exists so tools that
 * want to render with a specific bundled-font version (web roundtrip
 * comparisons, deterministic snapshot generation) can opt in. It is
 * not the right entry point for general OS-correct rendering; use
 * `createNodeFontLoader()` for that.
 */
export function createNodeFontLoaderWithFontsource(): NodeFontLoaderInstance {
  const env = defaultNodeFontLoaderEnv();
  const fontsourceDirs: string[] = [];

  const nodeModulesPath = path.resolve(env.cwd, "node_modules/@fontsource");
  if (env.fs.existsSync(nodeModulesPath)) {
    const packages = env.fs.readdirSync(nodeModulesPath, { withFileTypes: true });
    for (const pkg of packages) {
      if (!pkg.isDirectory()) {
        continue;
      }
      const filesDir = path.join(nodeModulesPath, pkg.name, "files");
      if (env.fs.existsSync(filesDir)) {
        fontsourceDirs.push(filesDir);
      }
    }
  }

  return createNodeFontLoaderWithEnv(env, { fontDirs: fontsourceDirs });
}
