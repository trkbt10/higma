/**
 * @file Font weight detection from style strings.
 *
 * Single source of truth for "Bold/Light/SemiBold..." → numeric weight.
 * Anywhere else in the codebase that re-implements this is a bug.
 */

/** Standard CSS font weight values. */
export const FONT_WEIGHTS = {
  THIN: 100,
  EXTRA_LIGHT: 200,
  LIGHT: 300,
  REGULAR: 400,
  MEDIUM: 500,
  SEMI_BOLD: 600,
  BOLD: 700,
  EXTRA_BOLD: 800,
  BLACK: 900,
} as const;

export type FontWeight = (typeof FONT_WEIGHTS)[keyof typeof FONT_WEIGHTS];

/** Weight detection rule. */
type WeightRule = {
  readonly patterns: readonly string[];
  readonly weight: FontWeight;
  /** Exclude patterns (e.g., "bold" but not "extrabold"). */
  readonly excludePatterns?: readonly string[];
};

/**
 * Font weight detection rules.
 *
 * Order matters: more specific patterns come first; the `excludePatterns`
 * field guards specific-then-generic substring overlaps (e.g. "extrabold"
 * matches "bold" too if we don't exclude it explicitly).
 */
const WEIGHT_RULES: readonly WeightRule[] = [
  { patterns: ["thin", "hairline"], weight: FONT_WEIGHTS.THIN },
  {
    patterns: ["extralight", "extra light", "ultralight", "ultra light"],
    weight: FONT_WEIGHTS.EXTRA_LIGHT,
  },
  {
    patterns: ["light"],
    weight: FONT_WEIGHTS.LIGHT,
    excludePatterns: ["extralight", "extra light", "ultralight", "ultra light"],
  },
  { patterns: ["regular", "normal", "book", "roman"], weight: FONT_WEIGHTS.REGULAR },
  { patterns: ["medium"], weight: FONT_WEIGHTS.MEDIUM },
  {
    patterns: ["semibold", "semi bold", "demibold", "demi bold", "demi"],
    weight: FONT_WEIGHTS.SEMI_BOLD,
  },
  {
    patterns: ["extrabold", "extra bold", "ultrabold", "ultra bold"],
    weight: FONT_WEIGHTS.EXTRA_BOLD,
  },
  {
    patterns: ["bold"],
    weight: FONT_WEIGHTS.BOLD,
    excludePatterns: ["semibold", "semi bold", "demibold", "demi bold", "extrabold", "extra bold", "ultrabold", "ultra bold"],
  },
  { patterns: ["black", "heavy"], weight: FONT_WEIGHTS.BLACK },
];

/**
 * Detect font weight from style string.
 *
 * @example
 * detectWeight("Bold") // 700
 * detectWeight("Light Italic") // 300
 * detectWeight("ExtraBold") // 800
 * detectWeight("Regular") // 400
 */
export function detectWeight(style: string | undefined): FontWeight | undefined {
  if (!style) {
    return undefined;
  }
  const styleLower = style.toLowerCase();
  for (const rule of WEIGHT_RULES) {
    if (rule.excludePatterns?.some((p) => styleLower.includes(p))) {
      continue;
    }
    if (rule.patterns.some((p) => styleLower.includes(p))) {
      return rule.weight;
    }
  }
  return undefined;
}

/** Snap an arbitrary numeric weight to the nearest standard CSS weight. */
export function normalizeWeight(weight: number): FontWeight {
  const weights: readonly FontWeight[] = Object.values(FONT_WEIGHTS);
  const closestRef: { value: FontWeight } = { value: FONT_WEIGHTS.REGULAR };
  const minDiffRef = { value: Math.abs(weight - closestRef.value) };
  for (const w of weights) {
    const diff = Math.abs(weight - w);
    if (diff < minDiffRef.value) {
      minDiffRef.value = diff;
      closestRef.value = w;
    }
  }
  return closestRef.value;
}

/** Get a human-readable weight name from a numeric value. */
export function getWeightName(weight: number): string {
  const normalized = normalizeWeight(weight);
  const entry = Object.entries(FONT_WEIGHTS).find(([, v]) => v === normalized);
  return entry ? entry[0].replace(/_/g, " ").toLowerCase() : "regular";
}

/**
 * Inverse of `detectWeight` — turn a numeric weight into the Figma
 * `fontName.style` label (`"Thin"`, `"Light"`, `"SemiBold"`, …).
 *
 * Uses the closest standard-weight bucket via `normalizeWeight` so a
 * round-trip `detectWeight(figmaWeightLabel(detectWeight("Bold")!))`
 * is the identity for the standard weight values. Anywhere that
 * round-trips Figma fontName.style — e.g. web-to-fig emit, Figma
 * file builders — must use this function rather than re-deriving
 * the label so the inverse stays consistent with the forward.
 */
export function figmaWeightLabel(weight: number): string {
  const normalized = normalizeWeight(weight);
  switch (normalized) {
    case FONT_WEIGHTS.THIN:
      return "Thin";
    case FONT_WEIGHTS.EXTRA_LIGHT:
      return "ExtraLight";
    case FONT_WEIGHTS.LIGHT:
      return "Light";
    case FONT_WEIGHTS.REGULAR:
      return "Regular";
    case FONT_WEIGHTS.MEDIUM:
      return "Medium";
    case FONT_WEIGHTS.SEMI_BOLD:
      return "SemiBold";
    case FONT_WEIGHTS.BOLD:
      return "Bold";
    case FONT_WEIGHTS.EXTRA_BOLD:
      return "ExtraBold";
    case FONT_WEIGHTS.BLACK:
      return "Black";
  }
}
