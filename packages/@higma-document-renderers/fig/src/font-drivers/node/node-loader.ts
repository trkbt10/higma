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
import type { LoadedFont } from "../../font/types";

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

/** Indexed font file metadata. `query` is the canonical face descriptor. */
type FontFileInfo = {
  readonly path: string;
  readonly query: FontQuery;
  readonly postscriptName?: string;
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
 * Check if file is a font file
 *
 * Note: .ttc (TrueType Collection) files are NOT supported by opentype.js,
 * so they are excluded.
 */
function isFontFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".ttf", ".otf", ".woff", ".woff2"].includes(ext);
}

/**
 * Read a font file and parse it via opentype.js.
 *
 * Node's `Buffer.buffer` is typed as `ArrayBufferLike` (so it accepts
 * SharedArrayBuffer-backed buffers, which `readFileSync` never produces),
 * but opentype.js's `parseFont` only accepts `ArrayBuffer`. The single
 * cast at this boundary tags Node's runtime guarantee onto the type.
 */
function readFontFile(fontPath: string): ReturnType<typeof parseFont> {
  const data = fs.readFileSync(fontPath);
  return parseFont(data.buffer as ArrayBuffer);
}

async function getFontInfo(fontPath: string): Promise<FontFileInfo | null> {
  const font = readFontFile(fontPath);

  const family = fontNameValue(font.names, "fontFamily") ?? fontNameValue(font.names, "preferredFamily") ?? "";
  const subfamily = fontNameValue(font.names, "fontSubfamily") ?? "";
  const postscriptName = fontNameValue(font.names, "postScriptName");

  if (!family) {return null;}

  // Defer (weight, style) detection to the canonical SoT — `figmaFontToQuery`
  // applies the same `detectWeight` / `detectStyle` rules a resolver call
  // would, so driver indexing matches resolver lookups exactly.
  const query = figmaFontToQuery({ family, style: subfamily || family });

  return {
    path: fontPath,
    query,
    postscriptName,
  };
}

async function tryIndexFontFile(
  fullPath: string,
  index: Map<string, FontFileInfo[]>
): Promise<void> {
  const info = await getFontInfo(fullPath);
  if (info) {
    const familyLower = info.query.family.toLowerCase();
    const existing = index.get(familyLower) ?? [];
    index.set(familyLower, [...existing, info]);
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
    const familyLower = query.family.toLowerCase();
    const variants = index.get(familyLower);

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

    const font = toLoadedFontType(readFontFile(bestMatch.path));

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
      return index.has(family.toLowerCase());
    },

    async listFontFamilies(): Promise<readonly string[]> {
      const index = await ensureIndex();
      return Array.from(index.values()).map((variants) => variants[0].query.family);
    },

    async addFontFile(fontPath: string): Promise<void> {
      const index = await ensureIndex();
      const info = await getFontInfo(fontPath);

      if (info) {
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
