/**
 * @file Font family stacks and Figma → CSS family mappings.
 *
 * The single source of truth for "what generic stack does this family fall
 * back to" and "what real CSS family chain does this Figma family map to".
 * Anything that hard-codes a `system-ui, -apple-system, sans-serif` chain
 * elsewhere is a duplication bug.
 */

/**
 * System UI font stack.
 *
 * macOS' `system-ui` resolves to SFNS.ttf, but that file is a variable
 * font: opentype.js exposes only its default-axis (Regular) instance, so
 * weight 700 renders identically to weight 400. Putting the SFNS-derived
 * families ahead of `Helvetica Neue` would defeat every Bold heading.
 * Until variable-font axis instancing lands in the loader, prefer
 * `Helvetica Neue` (.ttc with proper Bold variant) and only fall back to
 * SFNS when nothing better is installed.
 */
export const SYSTEM_UI_STACK = [
  "system-ui",
  "-apple-system",
  "BlinkMacSystemFont",
  "Segoe UI",
  "Roboto",
  "Helvetica Neue",
  "Arial",
  "sans-serif",
] as const;

export const MONOSPACE_STACK = [
  "ui-monospace",
  "SFMono-Regular",
  "SF Mono",
  "Menlo",
  "Consolas",
  "Liberation Mono",
  "monospace",
] as const;

export const SERIF_STACK = [
  "ui-serif",
  "Georgia",
  "Cambria",
  "Times New Roman",
  "Times",
  "serif",
] as const;

export const SANS_SERIF_STACK = [
  "ui-sans-serif",
  "Helvetica Neue",
  "Arial",
  "sans-serif",
] as const;

/**
 * Common Figma font to CSS font mappings.
 *
 * Maps Figma font family names to their web equivalents.
 */
export const COMMON_FONT_MAPPINGS: ReadonlyMap<string, readonly string[]> = new Map([
  // Google Fonts (commonly used in Figma)
  ["Inter", ["Inter", ...SANS_SERIF_STACK]],
  ["Roboto", ["Roboto", ...SANS_SERIF_STACK]],
  ["Open Sans", ["Open Sans", ...SANS_SERIF_STACK]],
  ["Lato", ["Lato", ...SANS_SERIF_STACK]],
  ["Montserrat", ["Montserrat", ...SANS_SERIF_STACK]],
  ["Poppins", ["Poppins", ...SANS_SERIF_STACK]],
  ["Source Sans Pro", ["Source Sans Pro", "Source Sans 3", ...SANS_SERIF_STACK]],
  ["Noto Sans", ["Noto Sans", ...SANS_SERIF_STACK]],
  ["Noto Sans JP", ["Noto Sans JP", "Noto Sans CJK JP", ...SANS_SERIF_STACK]],
  ["Noto Sans KR", ["Noto Sans KR", "Noto Sans CJK KR", ...SANS_SERIF_STACK]],
  ["Noto Sans SC", ["Noto Sans SC", "Noto Sans CJK SC", ...SANS_SERIF_STACK]],
  ["Noto Sans TC", ["Noto Sans TC", "Noto Sans CJK TC", ...SANS_SERIF_STACK]],

  // Serif fonts
  ["Roboto Slab", ["Roboto Slab", ...SERIF_STACK]],
  ["Playfair Display", ["Playfair Display", ...SERIF_STACK]],
  ["Merriweather", ["Merriweather", ...SERIF_STACK]],
  ["Lora", ["Lora", ...SERIF_STACK]],
  ["Noto Serif", ["Noto Serif", ...SERIF_STACK]],
  ["Noto Serif JP", ["Noto Serif JP", "Noto Serif CJK JP", ...SERIF_STACK]],

  // Monospace fonts
  ["Roboto Mono", ["Roboto Mono", ...MONOSPACE_STACK]],
  ["Source Code Pro", ["Source Code Pro", ...MONOSPACE_STACK]],
  ["Fira Code", ["Fira Code", ...MONOSPACE_STACK]],
  ["JetBrains Mono", ["JetBrains Mono", ...MONOSPACE_STACK]],
  ["IBM Plex Mono", ["IBM Plex Mono", ...MONOSPACE_STACK]],

  // System fonts
  ["SF Pro", ["SF Pro", "-apple-system", "BlinkMacSystemFont", ...SANS_SERIF_STACK]],
  ["SF Pro Display", ["SF Pro Display", "SF Pro", "-apple-system", ...SANS_SERIF_STACK]],
  ["SF Pro Text", ["SF Pro Text", "SF Pro", "-apple-system", ...SANS_SERIF_STACK]],
  ["SF Pro Rounded", ["SF Pro Rounded", "SF Pro", "-apple-system", ...SANS_SERIF_STACK]],
  ["SF Mono", ["SF Mono", "SFMono-Regular", ...MONOSPACE_STACK]],
  ["New York", ["New York", "ui-serif", ...SERIF_STACK]],
  ["Segoe UI", ["Segoe UI", ...SANS_SERIF_STACK]],
  ["Helvetica", ["Helvetica", "Helvetica Neue", ...SANS_SERIF_STACK]],
  ["Helvetica Neue", ["Helvetica Neue", "Helvetica", ...SANS_SERIF_STACK]],
  ["Arial", ["Arial", "Helvetica", ...SANS_SERIF_STACK]],
  ["Times New Roman", ["Times New Roman", "Times", ...SERIF_STACK]],
  ["Georgia", ["Georgia", ...SERIF_STACK]],
  ["Courier New", ["Courier New", "Courier", ...MONOSPACE_STACK]],

  // Display/decorative fonts
  ["Bebas Neue", ["Bebas Neue", ...SANS_SERIF_STACK]],
  ["Oswald", ["Oswald", ...SANS_SERIF_STACK]],
  ["Raleway", ["Raleway", ...SANS_SERIF_STACK]],
]);

/** Generic font family keywords to CSS font stacks. */
export const GENERIC_FONT_STACKS: ReadonlyMap<string, readonly string[]> = new Map([
  ["sans-serif", [...SANS_SERIF_STACK]],
  ["serif", [...SERIF_STACK]],
  ["monospace", [...MONOSPACE_STACK]],
  ["system-ui", [...SYSTEM_UI_STACK]],
  ["cursive", ["Brush Script MT", "cursive"]],
  ["fantasy", ["Papyrus", "fantasy"]],
]);

/** Generic CSS font family keywords. */
export const GENERIC_CSS_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

/** Check if a font family name is a generic CSS keyword. */
export function isGenericCssFontFamily(family: string): boolean {
  return GENERIC_CSS_FONT_FAMILIES.has(family);
}

/** Detect font category from family name. */
export function detectFontCategory(
  family: string
): "sans-serif" | "serif" | "monospace" | "display" | "unknown" {
  const lower = family.toLowerCase();

  // Monospace indicators.
  if (
    lower.includes("mono") ||
    lower.includes("code") ||
    lower.includes("consol") ||
    lower.includes("courier")
  ) {
    return "monospace";
  }

  // Serif indicators (but not "sans-serif").
  if (
    lower.includes("serif") ||
    lower.includes("times") ||
    lower.includes("georgia") ||
    lower.includes("garamond") ||
    lower.includes("palatino")
  ) {
    if (!lower.includes("sans")) {
      return "serif";
    }
  }

  // Display/decorative indicators.
  if (
    lower.includes("display") ||
    lower.includes("headline") ||
    lower.includes("poster") ||
    lower.includes("decorative")
  ) {
    return "display";
  }

  // Sans-serif indicators (or default).
  if (
    lower.includes("sans") ||
    lower.includes("gothic") ||
    lower.includes("grotesk") ||
    lower.includes("helvetica") ||
    lower.includes("arial")
  ) {
    return "sans-serif";
  }

  return "unknown";
}

/** Get default CSS font stack for a font family. */
export function getDefaultFontStack(family: string): readonly string[] {
  const category = detectFontCategory(family);
  switch (category) {
    case "monospace":
      return MONOSPACE_STACK;
    case "serif":
      return SERIF_STACK;
    case "sans-serif":
    case "display":
      return SANS_SERIF_STACK;
    case "unknown":
      return [];
  }
}

/**
 * Build a final CSS font-family value (chain of quoted family names) for
 * an input family. The chain is: caller-provided + custom mapping (when
 * present) + COMMON_FONT_MAPPINGS or category-default + caller-provided
 * tail. Generic keywords are emitted unquoted.
 *
 * This is the single point that emits a CSS font-family string. Anywhere
 * else that hand-rolls `"font", "Helvetica Neue", sans-serif` is wrong.
 */
export function buildCssFontFamily(
  family: string,
  options?: {
    readonly customMappings?: ReadonlyMap<string, readonly string[]>;
    readonly tailStack?: readonly string[];
  },
): string {
  const chain = buildCssFontFamilyChain(family, options);
  return chain.map(quoteCssFamily).join(", ");
}

/** Same as `buildCssFontFamily` but returns the array of names. */
export function buildCssFontFamilyChain(
  family: string,
  options?: {
    readonly customMappings?: ReadonlyMap<string, readonly string[]>;
    readonly tailStack?: readonly string[];
  },
): readonly string[] {
  const customMappings = options?.customMappings;
  const tailStack = options?.tailStack ?? [];
  // Custom mapping wins (caller-provided).
  const mapped = customMappings?.get(family);
  if (mapped) {
    return [...mapped, ...tailStack];
  }
  // Common Figma family mapping.
  const common = COMMON_FONT_MAPPINGS.get(family);
  if (common) {
    return [...common, ...tailStack];
  }
  // Treat the input as the leading family, then a category-default stack.
  const generic = getDefaultFontStack(family);
  return [family, ...generic, ...tailStack];
}

/** Quote a single CSS family name; generics are emitted unquoted. */
export function quoteCssFamily(family: string): string {
  if (isGenericCssFontFamily(family)) {
    return family;
  }
  if (family.includes(" ") || family.includes("-") || /^\d/.test(family)) {
    return `"${family}"`;
  }
  return family;
}

/**
 * Build the CSS `font` shorthand string the Canvas 2D API consumes.
 *
 * Format: `[<style> ]<weight> <size>px <family>` — exactly what
 * `ctx.font = …` accepts. `style === "normal"` is omitted to match
 * the CSS shorthand defaults so two queries that differ only in
 * upright vs upright produce identical strings (matters for
 * deterministic measurement caching keyed by the shorthand itself).
 *
 * Anywhere that builds this string locally drifts on family quoting
 * rules — Canvas 2D rejects unquoted families with spaces, so the
 * SoT call is the only safe surface.
 */
export function buildCssFontShorthand(params: {
  readonly family: string;
  readonly weight: number;
  readonly style: string;
  readonly fontSize: number;
}): string {
  const styleSegment = params.style !== "normal" ? `${params.style} ` : "";
  return `${styleSegment}${params.weight} ${params.fontSize}px ${quoteCssFamily(params.family)}`;
}
