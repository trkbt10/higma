/**
 * @file Palette analysis.
 *
 * Builds a normalised palette of every solid colour used inside the
 * user-visible canvases, attaches each colour to its dominant Figma
 * FILL style proxy when one already exists, and proposes new theme
 * tokens (with semantic names — accent / surface / on-surface / …)
 * for the colours that occur often enough to deserve a slot.
 *
 * The output drives two refinement actions:
 *
 *   1. `style-bind`  — when a colour matches an existing fill proxy,
 *                       rebind every node still carrying the inline
 *                       cached paint to the proxy's GUID. This lets
 *                       Figma's style panel drive future edits.
 *
 *   2. `style-create` — when a colour has no proxy but is used widely
 *                       enough, propose a new fill proxy on the
 *                       Internal Only Canvas with a semantic name
 *                       inferred from the colour's role (background,
 *                       surface, accent, on-accent, …).
 *
 * The colour key matches fig-to-web's tokens/color.ts (3-decimal
 * precision so 1/255 rounding noise collapses to a single bucket).
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

export type PaletteEntry = {
  readonly key: string;
  readonly hex: string;
  readonly color: FigColor;
  /** All places this colour appears. */
  readonly usages: readonly PaintUsage[];
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
): PaletteAnalysis {
  const buckets = new Map<string, PaintBucket>();
  for (const frame of frames) {
    walkForPaints(frame, buckets);
  }
  const proxyByColor = indexFillProxiesByColor(fillProxies);

  const byRole = new Map<SuggestedRole, PaletteEntry[]>();
  const sorted = [...buckets.values()].sort((a, b) => b.usages.length - a.usages.length);
  const roleCounts = new Map<SuggestedRole, number>();
  const entries: PaletteEntry[] = [];
  for (const bucket of sorted) {
    const role = suggestRole(bucket.color, bucket.usages);
    const ord = (roleCounts.get(role) ?? 0) + 1;
    roleCounts.set(role, ord);
    const baseSlug = ROLE_BASE_SLUG[role];
    const suggestedSlug = ord === 1 ? baseSlug : `${baseSlug}-${ord}`;
    const proxy = proxyByColor.get(colorKey(bucket.color));
    const entry: PaletteEntry = {
      key: colorKey(bucket.color),
      hex: colorHex(bucket.color),
      color: bucket.color,
      usages: bucket.usages,
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
