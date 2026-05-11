/**
 * @file Palette analysis.
 *
 * Builds a normalised palette of every solid colour used inside the
 * user-visible canvases, attaches each colour to its dominant Figma
 * FILL style proxy when one already exists, and proposes new theme
 * tokens (with semantic names — accent / surface / on-surface / …)
 * for the colours that occur often enough to deserve a slot.
 *
 * Two-stage canonicalisation:
 *
 *   1. `colorKey` (3-decimal quantisation) gives a stable fine-grain
 *      bucket — same colour collapses across one round of 1/1000
 *      precision drift. The fine key is what scaffold / decisions /
 *      plan use as their record key, so it must remain stable across
 *      runs of the same file.
 *
 *   2. A perceptual-distance merge pass groups fine buckets whose
 *      colours are visually indistinguishable (sRGB Euclidean ≤ ε).
 *      Necessary because an SVG → Figma round-trip perturbs every
 *      channel by ≤ 3/255, so a Win98-style palette of #000000 fans
 *      out into ~9 micro-buckets that must be reported as one entry.
 *      The representative bucket (most usages, lex-smallest key on
 *      tie) becomes the entry; absorbed buckets are recorded in
 *      `PaletteEntry.aliases` so the bind step still finds every
 *      original node.
 */
import type { FigColor, FigNode, FigPaint } from "@higma-document-models/fig/types";
import { getNodeType, safeChildren, guidToString } from "@higma-document-models/fig/domain";

const PRECISION = 1000;

function round3(x: number): number {
  return Math.round(x * PRECISION) / PRECISION;
}

function clamp01(x: number): number {
  if (x < 0) {
    return 0;
  }
  if (x > 1) {
    return 1;
  }
  return x;
}

/** Canonical key for paint deduplication. */
export function colorKey(color: FigColor): string {
  return `${round3(color.r)},${round3(color.g)},${round3(color.b)},${round3(color.a)}`;
}

/** Hex encoding (#rrggbb or #rrggbbaa) — used for human-readable plan output. */
export function colorHex(color: FigColor): string {
  const toHex = (x: number): string => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0");
  const base = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  if (color.a < 0.999) {
    return `${base}${toHex(color.a)}`;
  }
  return base;
}

/** Resolve a paint to a colour, folding paint opacity into alpha (matches tokens/color). */
function paintToColor(paint: FigPaint): FigColor | undefined {
  if (paint.type !== "SOLID") {
    return undefined;
  }
  if (paint.visible === false) {
    return undefined;
  }
  const baseAlpha = paint.color.a;
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  return {
    r: paint.color.r,
    g: paint.color.g,
    b: paint.color.b,
    a: clamp01(baseAlpha * paintOpacity),
  };
}

export type PaintRole = "fill" | "stroke" | "background";

export type PaintUsage = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly role: PaintRole;
  /** Index of the paint in node.fillPaints / strokePaints / backgroundPaints. */
  readonly paintIndex: number;
};

export type PaletteAlias = {
  /** Fine-grain `colorKey` of the absorbed bucket. */
  readonly key: string;
  readonly color: FigColor;
  readonly hex: string;
  /** Usage count of this absorbed bucket alone (not the merged total). */
  readonly usageCount: number;
};

export type PaletteEntry = {
  readonly key: string;
  readonly hex: string;
  readonly color: FigColor;
  /** All places this colour appears (representative + every alias). */
  readonly usages: readonly PaintUsage[];
  /**
   * Fine buckets absorbed into this entry by the perceptual-merge pass.
   * Empty array when no merging occurred. The representative bucket's
   * `colorKey` is `entry.key` and is NOT repeated here.
   */
  readonly aliases: readonly PaletteAlias[];
  /** Existing FILL proxy whose paint matches this colour, if any. */
  readonly proxyGuid: string | undefined;
  readonly proxyName: string | undefined;
  /** Semantic role suggested by relative luminance and usage. */
  readonly suggestedRole: SuggestedRole;
  /** Slug suggested for a new proxy when none exists. */
  readonly suggestedSlug: string;
};

export type SuggestedRole =
  | "background"
  | "surface"
  | "surface-alt"
  | "border"
  | "muted"
  | "text"
  | "text-muted"
  | "accent"
  | "accent-alt"
  | "on-accent"
  | "danger"
  | "success"
  | "warning"
  | "info";

export type PaletteAnalysis = {
  readonly entries: readonly PaletteEntry[];
  /** Colours grouped by suggested role for quick reading. */
  readonly byRole: ReadonlyMap<SuggestedRole, readonly PaletteEntry[]>;
};

type PaintBucket = {
  readonly color: FigColor;
  readonly usages: PaintUsage[];
};

function relativeLuminance(c: FigColor): number {
  const linear = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

function chroma(c: FigColor): number {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max - min;
}

function dominantHueRole(c: FigColor): SuggestedRole | undefined {
  const ch = chroma(c);
  if (ch < 0.07) {
    return undefined;
  }
  const r = c.r;
  const g = c.g;
  const b = c.b;
  if (r > g && r > b && r - Math.max(g, b) > 0.15) {
    return "danger";
  }
  if (g > r && g > b && g - Math.max(r, b) > 0.15) {
    return "success";
  }
  if (b > r && b > g && b - Math.max(r, g) > 0.15) {
    return "info";
  }
  if (r > 0.6 && g > 0.5 && b < 0.3) {
    return "warning";
  }
  return "accent";
}

function suggestRole(color: FigColor, usages: readonly PaintUsage[]): SuggestedRole {
  const lum = relativeLuminance(color);
  const ch = chroma(color);
  const hueRole = dominantHueRole(color);
  if (hueRole) {
    // Vivid hues default to accent unless they dominate full-frame surfaces.
    const usedAsBackgroundCount = usages.filter((u) => u.role === "background" || (u.role === "fill" && u.nodeType === "FRAME")).length;
    if (usedAsBackgroundCount >= 4 && ch > 0.5) {
      return "accent";
    }
    return hueRole;
  }
  // Achromatic — split by luminance.
  if (lum < 0.06) {
    return "text";
  }
  if (lum < 0.2) {
    return "text-muted";
  }
  if (lum < 0.45) {
    return "muted";
  }
  if (lum < 0.7) {
    return "border";
  }
  if (lum < 0.93) {
    return "surface-alt";
  }
  if (lum < 0.985) {
    return "surface";
  }
  return "background";
}

const ROLE_BASE_SLUG: Readonly<Record<SuggestedRole, string>> = {
  background: "background",
  surface: "surface",
  "surface-alt": "surface-alt",
  border: "border",
  muted: "muted",
  text: "text",
  "text-muted": "text-muted",
  accent: "accent",
  "accent-alt": "accent-alt",
  "on-accent": "on-accent",
  danger: "danger",
  success: "success",
  warning: "warning",
  info: "info",
};

function pushUsage(buckets: Map<string, PaintBucket>, color: FigColor, usage: PaintUsage): void {
  const key = colorKey(color);
  const existing = buckets.get(key);
  if (existing) {
    existing.usages.push(usage);
    return;
  }
  buckets.set(key, { color, usages: [usage] });
}

function alreadyBoundFor(node: FigNode, role: PaintRole): boolean {
  // A node whose paint already comes from a shared style proxy does
  // not need another binding action. Mirrors the renderer's SoT —
  // styleIdForFill / styleIdForStrokeFill point at the live paint via
  // the registry, and overwriting the binding adds no information.
  if (role === "fill" || role === "background") {
    return Boolean(node.styleIdForFill?.guid);
  }
  if (role === "stroke") {
    return Boolean(node.styleIdForStrokeFill?.guid);
  }
  return false;
}

/**
 * A paint stack is "single-solid" when it contains exactly one
 * visible paint, that paint is SOLID, and no per-paint blend mode
 * other than NORMAL is in effect. Multi-paint stacks (image-over-
 * solid, gradient-over-solid, two solids stacked, …) are NOT
 * eligible for fill-style binding — pointing styleIdForFill at a
 * SOLID proxy on such a node would erase the IMAGE / GRADIENT layer
 * the renderer expects on top.
 */
export function isSingleSolidStack(paints: readonly FigPaint[] | undefined): boolean {
  if (!paints) {
    return false;
  }
  const visible = paints.filter((p) => p.visible !== false);
  if (visible.length !== 1) {
    return false;
  }
  const sole = visible[0];
  if (!sole || sole.type !== "SOLID") {
    return false;
  }
  // FigPaintBase.blendMode is already a typed BlendMode | undefined.
  // Anything other than the two pass-through-equivalent values means
  // the paint is materially different from the proxy's flat SOLID.
  if (sole.blendMode !== undefined && sole.blendMode !== "NORMAL" && sole.blendMode !== "PASS_THROUGH") {
    return false;
  }
  return true;
}

/**
 * The list of paints that the binding action would replace, given a
 * role. We only return paints when the stack is bind-eligible (single
 * SOLID, visible, default blend) — otherwise undefined so the caller
 * skips this node entirely.
 */
export function bindablePaintsFor(
  node: FigNode,
  role: PaintRole,
): readonly FigPaint[] | undefined {
  if (alreadyBoundFor(node, role)) {
    return undefined;
  }
  if (role === "fill") {
    if (isSingleSolidStack(node.fillPaints)) {
      return node.fillPaints;
    }
    return undefined;
  }
  if (role === "stroke") {
    if (isSingleSolidStack(node.strokePaints)) {
      return node.strokePaints;
    }
    return undefined;
  }
  if (role === "background") {
    if (isSingleSolidStack(node.backgroundPaints)) {
      return node.backgroundPaints;
    }
    return undefined;
  }
  return undefined;
}

function visitPaintsRole(
  paints: readonly FigPaint[] | undefined,
  role: PaintRole,
  node: FigNode,
  buckets: Map<string, PaintBucket>,
): void {
  if (!paints) {
    return;
  }
  if (alreadyBoundFor(node, role)) {
    return;
  }
  // Palette histograms include any visible SOLID paint we encounter,
  // even when the paint sits inside a multi-paint stack (e.g. SOLID
  // tint over an IMAGE thumbnail). The "do we bind this node?" gate
  // is enforced later in build-plan via `bindablePaintsFor` so the
  // histogram remains an accurate report of colour usage while bind
  // actions stay restricted to safely substitutable single-SOLID
  // stacks.
  paints.forEach((paint, paintIndex) => {
    const color = paintToColor(paint);
    if (!color) {
      return;
    }
    pushUsage(buckets, color, {
      nodeGuid: guidToString(node.guid),
      nodeName: node.name ?? "(unnamed)",
      nodeType: getNodeType(node),
      role,
      paintIndex,
    });
  });
}

function walkForPaints(node: FigNode, buckets: Map<string, PaintBucket>): void {
  visitPaintsRole(node.fillPaints, "fill", node, buckets);
  visitPaintsRole(node.strokePaints, "stroke", node, buckets);
  visitPaintsRole(node.backgroundPaints, "background", node, buckets);
  for (const child of safeChildren(node)) {
    walkForPaints(child, buckets);
  }
}

/** Build a colour-key → fill style proxy index from the Internal Only Canvas. */
function indexFillProxiesByColor(proxies: readonly FigNode[]): ReadonlyMap<string, FigNode> {
  const out = new Map<string, FigNode>();
  for (const proxy of proxies) {
    const fp = proxy.fillPaints ?? [];
    for (const paint of fp) {
      const color = paintToColor(paint);
      if (!color) {
        continue;
      }
      const key = colorKey(color);
      if (out.has(key)) {
        continue;
      }
      out.set(key, proxy);
    }
  }
  return out;
}

export type AnalysePaletteOptions = {
  /**
   * Tolerance for the perceptual-merge pass, expressed as a Euclidean
   * distance in sRGB (each channel ∈ [0, 1], alpha included). A pair
   * of buckets whose colour distance is ≤ this value is collapsed.
   *
   * Default is small enough to absorb 3/255 ≈ 0.012 drift on a single
   * channel but tight enough to keep distinct theme tokens apart. Set
   * to 0 to disable merging.
   */
  readonly mergeToleranceSrgb?: number;
};

/**
 * Default merge tolerance: 0.025 in sRGB Euclidean. Empirically this
 * absorbs the ≤ 3/255 per-channel drift produced by a single SVG →
 * Figma round-trip (Δ ≤ √3 · 3/255 ≈ 0.020) without collapsing
 * adjacent design-token colours such as Win98's #5555aa / #5455aa
 * neighbouring colour palette is unrelated; 0.025 leaves a margin for
 * compounded drift while staying well below the smallest meaningful
 * theme-colour spacing observed in the codebase's fixtures.
 */
const DEFAULT_MERGE_TOLERANCE_SRGB = 0.025;

/**
 * One per-colour observation produced by the bucket walk. The merge
 * pass groups these by perceptual distance.
 */
type FineBucket = {
  readonly key: string;
  readonly color: FigColor;
  readonly usages: readonly PaintUsage[];
};

function sortFineBuckets(buckets: readonly FineBucket[]): readonly FineBucket[] {
  // Most usages first; lex-smallest key on tie. Determines representative
  // selection and is consumed by the linear-scan grouping below.
  return [...buckets].sort((a, b) => {
    if (a.usages.length !== b.usages.length) {
      return b.usages.length - a.usages.length;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

function colorDistance(a: FigColor, b: FigColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  const da = a.a - b.a;
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da);
}

type MergedBucket = {
  readonly representative: FineBucket;
  readonly aliases: FineBucket[];
};

/**
 * Group fine buckets by perceptual distance. Representative is the
 * first bucket of each group in the sorted order, so most-used wins.
 */
function mergeBuckets(buckets: readonly FineBucket[], tolerance: number): readonly MergedBucket[] {
  if (tolerance <= 0) {
    return buckets.map((b) => ({ representative: b, aliases: [] }));
  }
  const sorted = sortFineBuckets(buckets);
  const groups: MergedBucket[] = [];
  for (const bucket of sorted) {
    const home = groups.find((g) => colorDistance(g.representative.color, bucket.color) <= tolerance);
    if (home) {
      home.aliases.push(bucket);
      continue;
    }
    groups.push({ representative: bucket, aliases: [] });
  }
  return groups;
}

function mergedColor(group: MergedBucket): FigColor {
  return group.representative.color;
}

function mergedUsages(group: MergedBucket): readonly PaintUsage[] {
  return [
    ...group.representative.usages,
    ...group.aliases.flatMap((a) => a.usages),
  ];
}

/**
 * Resolve which existing FILL proxy (if any) belongs to a merged
 * group. The match is again perceptual — proxies in the file can also
 * have drifted exactly the way usage paints have. Throws when two
 * different proxies both belong to the group: that is a real conflict
 * in the file's style proxy set and the agent must resolve it before
 * any plan can name the colour unambiguously.
 */
function resolveProxyForGroup(
  group: MergedBucket,
  proxyByColor: ReadonlyMap<string, FigNode>,
  tolerance: number,
): { readonly node: FigNode | undefined } {
  // Every proxy whose colour falls inside the group's perceptual
  // radius is a candidate — direct fine-key match and perceptual match
  // are the same test once the radius is non-zero. We always scan the
  // full proxy set so a second proxy that lies just outside the fine
  // keys but inside the perceptual radius cannot be silently missed.
  const candidates: FigNode[] = [];
  const targetKeys = new Set<string>([group.representative.key, ...group.aliases.map((a) => a.key)]);
  for (const [key, proxy] of proxyByColor) {
    if (targetKeys.has(key)) {
      candidates.push(proxy);
      continue;
    }
    if (tolerance <= 0) {
      continue;
    }
    const proxyColor = firstSolidColor(proxy);
    if (!proxyColor) {
      continue;
    }
    if (colorDistance(proxyColor, group.representative.color) <= tolerance) {
      candidates.push(proxy);
    }
  }
  if (candidates.length === 0) {
    return { node: undefined };
  }
  const distinct = dedupeByGuid(candidates);
  if (distinct.length > 1) {
    const names = distinct.map((p) => p.name ?? guidToString(p.guid)).join(", ");
    throw new Error(
      `analysePalette: two FILL proxies match the same merged colour (${colorHex(group.representative.color)}): ${names}. `
      + `Rename or recolour one of them before running refine-fig — automatic disambiguation would silently lose either proxy.`,
    );
  }
  return { node: distinct[0] };
}

function firstSolidColor(proxy: FigNode): FigColor | undefined {
  const fp = proxy.fillPaints ?? [];
  for (const paint of fp) {
    const color = paintToColor(paint);
    if (color) {
      return color;
    }
  }
  return undefined;
}

function dedupeByGuid(nodes: readonly FigNode[]): readonly FigNode[] {
  const seen = new Set<string>();
  const out: FigNode[] = [];
  for (const n of nodes) {
    const id = guidToString(n.guid);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(n);
  }
  return out;
}

function toAlias(bucket: FineBucket): PaletteAlias {
  return {
    key: bucket.key,
    color: bucket.color,
    hex: colorHex(bucket.color),
    usageCount: bucket.usages.length,
  };
}

/**
 * Analyse the palette of a set of frames.
 *
 * @param frames        — top-level frames whose subtree we inspect.
 * @param fillProxies   — children of the Internal Only Canvas whose
 *                        styleType is FILL.
 */
export function analysePalette(
  frames: readonly FigNode[],
  fillProxies: readonly FigNode[],
  options: AnalysePaletteOptions = {},
): PaletteAnalysis {
  const tolerance = options.mergeToleranceSrgb ?? DEFAULT_MERGE_TOLERANCE_SRGB;
  const rawBuckets = new Map<string, PaintBucket>();
  for (const frame of frames) {
    walkForPaints(frame, rawBuckets);
  }
  const fineBuckets: FineBucket[] = [...rawBuckets.entries()].map(([key, b]) => ({
    key,
    color: b.color,
    usages: b.usages,
  }));
  const merged = mergeBuckets(fineBuckets, tolerance);
  const proxyByColor = indexFillProxiesByColor(fillProxies);

  const byRole = new Map<SuggestedRole, PaletteEntry[]>();
  const sorted = [...merged].sort((a, b) => mergedUsages(b).length - mergedUsages(a).length);
  const roleCounts = new Map<SuggestedRole, number>();
  const entries: PaletteEntry[] = [];
  for (const group of sorted) {
    const usages = mergedUsages(group);
    const color = mergedColor(group);
    const role = suggestRole(color, usages);
    const ord = (roleCounts.get(role) ?? 0) + 1;
    roleCounts.set(role, ord);
    const baseSlug = ROLE_BASE_SLUG[role];
    const suggestedSlug = ord === 1 ? baseSlug : `${baseSlug}-${ord}`;
    const { node: proxy } = resolveProxyForGroup(group, proxyByColor, tolerance);
    const entry: PaletteEntry = {
      key: group.representative.key,
      hex: colorHex(color),
      color,
      usages,
      aliases: group.aliases.map(toAlias),
      proxyGuid: proxy ? guidToString(proxy.guid) : undefined,
      proxyName: proxy?.name,
      suggestedRole: role,
      suggestedSlug,
    };
    entries.push(entry);
    const arr = byRole.get(role) ?? [];
    arr.push(entry);
    byRole.set(role, arr);
  }
  return { entries, byRole };
}
