/**
 * @file Node.js font loader implementation
 *
 * Loads fonts from the filesystem using common system font directories.
 * macOS, Linux, and Windows font paths are supported.
 *
 * Weight/style detection delegates to the canonical SoT (`detectWeight` /
 * `detectStyle`); driver-local re-implementations would drift from the
 * resolver's interpretation and produce mismatched cache lookups.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseFont } from "opentype.js";
import type { FontLoader } from "../../font/loader";
import type { FontQuery } from "../../font/query";
import { figmaFontToQuery } from "../../font/query";
import { GENERIC_FONT_STACKS } from "../../font/mappings";
import type { LoadedFont } from "../../font/types";
import { extractTtcFaces, isTtc } from "./ttc";

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
 * Indexed font file metadata. `query` is the canonical face descriptor.
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

const SYSTEM_FONT_DIRS: Record<string, readonly string[]> = {
  darwin: [
    "/System/Library/Fonts",
    "/Library/Fonts",
    `${process.env.HOME}/Library/Fonts`,
  ],
  linux: [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    `${process.env.HOME}/.fonts`,
    `${process.env.HOME}/.local/share/fonts`,
  ],
  win32: [
    "C:\\Windows\\Fonts",
    `${process.env.LOCALAPPDATA}\\Microsoft\\Windows\\Fonts`,
  ],
};

function getSystemFontDirs(): readonly string[] {
  const platform = process.platform;
  return SYSTEM_FONT_DIRS[platform] ?? [];
}

function weightDistance(requested: number, actual: number): number {
  return Math.abs(requested - actual);
}

/** Node font loader with additional capabilities */
export type NodeFontLoaderInstance = FontLoader & {
  /** List available font families */
  listFontFamilies(): Promise<readonly string[]>;
  /** Add a custom font file */
  addFontFile(fontPath: string): Promise<void>;
};

/**
 * Check if a file's extension marks it as parseable by this loader.
 *
 * `.ttc` is included — TrueType Collections are decomposed into their
 * embedded faces by `extractTtcFaces` before the parser sees them.
 *
 * `.woff2` is intentionally excluded. opentype.js needs an external
 * brotli decompressor to read WOFF2; until that decoder is wired in,
 * indexing a `.woff2` file would just throw.
 */
function isFontFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".ttf", ".otf", ".ttc", ".woff"].includes(ext);
}

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
function readFontFileBytes(fontPath: string): ArrayBuffer {
  const data = fs.readFileSync(fontPath);
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return copy;
}

/**
 * Parse one face out of an on-disk font file.
 *
 * For `.ttc` collections, `faceIndex` selects which face to return
 * (0..N-1). For single-face files `faceIndex` must be 0.
 */
function parseFaceAt(fontPath: string, faceIndex: number): ReturnType<typeof parseFont> {
  const buffer = readFontFileBytes(fontPath);
  if (isTtc(buffer)) {
    const faces = extractTtcFaces(buffer);
    const face = faces[faceIndex];
    if (face === undefined) {
      throw new Error(`parseFaceAt: TTC ${fontPath} has no face at index ${faceIndex}`);
    }
    return parseFont(face);
  }
  if (faceIndex !== 0) {
    throw new Error(`parseFaceAt: non-TTC ${fontPath} has only one face but faceIndex=${faceIndex} was requested`);
  }
  return parseFont(buffer);
}

async function getFontInfos(fontPath: string): Promise<readonly FontFileInfo[]> {
  const buffer = readFontFileBytes(fontPath);
  if (isTtc(buffer)) {
    const faces = extractTtcFaces(buffer);
    const out: FontFileInfo[] = [];
    for (let i = 0; i < faces.length; i += 1) {
      const info = describeFace(parseFont(faces[i]!), fontPath, i);
      if (info) {
        out.push(info);
      }
    }
    return out;
  }
  const info = describeFace(parseFont(buffer), fontPath, 0);
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

async function tryIndexFontFile(
  fullPath: string,
  index: Map<string, FontFileInfo[]>,
): Promise<void> {
  // Indexing must be resilient: the system font directory always
  // contains at least one file the parser can't read on a given
  // version of opentype.js. Catching and skipping per-file means a
  // bad apple doesn't sink the whole index. Throwing during the
  // parse would only mask the rest of the system font catalogue.
  const infos = await safelyReadFontInfos(fullPath);
  for (const info of infos) {
    const familyLower = info.query.family.toLowerCase();
    const existing = index.get(familyLower) ?? [];
    index.set(familyLower, [...existing, info]);
  }
}

async function safelyReadFontInfos(fontPath: string): Promise<readonly FontFileInfo[]> {
  // Unparseable fonts (corrupt cmap, missing decoder, exotic
  // subtables) silently drop out of the index — callers asking for
  // them via loadFont will get `undefined`. Throwing here would
  // sink the entire system-font scan.
  try {
    return await getFontInfos(fontPath);
  } catch (err) {
    void err;
    return [];
  }
}

async function indexDirectory(
  dir: string,
  index: Map<string, FontFileInfo[]>
): Promise<void> {
  if (!fs.existsSync(dir)) {return;}

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await indexDirectory(fullPath, index);
    } else if (isFontFile(entry.name)) {
      await tryIndexFontFile(fullPath, index);
    }
  }
}

/**
 * Look up an indexed family with CSS-generic stack lookup.
 *
 * If the requested name is not present verbatim, walk the matching
 * generic stack (`system-ui` → SF / Helvetica Neue / Arial / ...) and
 * return the first family the system actually has installed. Without
 * this, a node-loader caller asking for `system-ui` would always get
 * `undefined` even on a Mac with the canonical stack fonts present.
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
 * Create a Node.js font loader with default settings
 */
export function createNodeFontLoader(
  options?: { fontDirs?: readonly string[]; includeSystemFontDirs?: boolean }
): NodeFontLoaderInstance {
  const customFontDirs = options?.fontDirs ?? [];
  const includeSystemFontDirs = options?.includeSystemFontDirs ?? true;
  const fontIndexRef = { value: null as Map<string, FontFileInfo[]> | null };
  const indexPromiseRef = { value: null as Promise<void> | null };

  function getFontDirs(): readonly string[] {
    if (!includeSystemFontDirs) {
      return customFontDirs;
    }
    return [...customFontDirs, ...getSystemFontDirs()];
  }

  async function buildFontIndex(): Promise<void> {
    const index = new Map<string, FontFileInfo[]>();
    const dirs = getFontDirs();

    for (const dir of dirs) {
      await indexDirectory(dir, index);
    }

    fontIndexRef.value = index;
  }

  async function ensureIndex(): Promise<Map<string, FontFileInfo[]>> {
    if (fontIndexRef.value) {
      return fontIndexRef.value;
    }

    if (!indexPromiseRef.value) {
      indexPromiseRef.value = buildFontIndex();
    }

    await indexPromiseRef.value;
    return fontIndexRef.value!;
  }

  async function loadFont(query: FontQuery): Promise<LoadedFont | undefined> {
    const index = await ensureIndex();
    const variants = resolveVariants(index, query.family);

    if (!variants || variants.length === 0) {
      return undefined;
    }

    // Closest-match selection. Style match takes precedence over weight
    // because a wrong style (italic vs upright) is more visually disruptive
    // than a near-miss weight.
    const sorted = [...variants].sort((a, b) => {
      const aIsLatin = a.path.includes("-latin-") ? 0 : 1;
      const bIsLatin = b.path.includes("-latin-") ? 0 : 1;
      if (aIsLatin !== bIsLatin) {return aIsLatin - bIsLatin;}

      const aStyleMatch = a.query.style === query.style ? 0 : 1;
      const bStyleMatch = b.query.style === query.style ? 0 : 1;
      if (aStyleMatch !== bStyleMatch) {return aStyleMatch - bStyleMatch;}

      return weightDistance(query.weight, a.query.weight) - weightDistance(query.weight, b.query.weight);
    });

    const bestMatch = sorted[0];
    if (!bestMatch) {return undefined;}

    const font = toLoadedFontType(parseFaceAt(bestMatch.path, bestMatch.faceIndex));

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
      return Array.from(index.values()).map((variants) => variants[0].query.family);
    },

    async addFontFile(fontPath: string): Promise<void> {
      const index = await ensureIndex();
      const infos = await getFontInfos(fontPath);
      for (const info of infos) {
        const familyLower = info.query.family.toLowerCase();
        const existing = index.get(familyLower) ?? [];
        index.set(familyLower, [...existing, info]);
      }
    },

  };
}

/**
 * Create a Node.js font loader that includes @fontsource fonts
 *
 * Automatically scans node_modules/@fontsource for installed font packages.
 */
export function createNodeFontLoaderWithFontsource(): NodeFontLoaderInstance {
  const fontsourceDirs: string[] = [];

  // Look for @fontsource packages in node_modules
  const nodeModulesPath = path.resolve(process.cwd(), "node_modules/@fontsource");
  if (fs.existsSync(nodeModulesPath)) {
    const packages = fs.readdirSync(nodeModulesPath);
    for (const pkg of packages) {
      const filesDir = path.join(nodeModulesPath, pkg, "files");
      if (fs.existsSync(filesDir)) {
        fontsourceDirs.push(filesDir);
      }
    }
  }

  return createNodeFontLoader({ fontDirs: fontsourceDirs });
}
