/**
 * @file Geometry interpretation — pure-domain Figma policies.
 *
 * Maps Figma encoded fields (winding rule enum, per-corner radii, clip
 * defaults) to renderer-neutral values that downstream renderers and
 * code generators all consume directly. Lives in document-models so the
 * Figma → portable mapping is owned alongside the rest of the domain
 * model, not duplicated per backend.
 */

export type WindingRule = "nonzero" | "evenodd";

/**
 * Map a Figma winding rule (string or `KiwiEnumValue`) to the renderer
 * token (`"nonzero"` / `"evenodd"`).
 *
 * Accepts:
 * - `"NONZERO"` / `"EVENODD"` / `"ODD"` strings
 * - `{ name: "NONZERO" | "EVENODD" }` enum objects
 * - `null` / `undefined` → defaults to `"nonzero"` (Figma's default fill rule)
 */
export function mapWindingRule(
  rule: string | { name?: string; [key: string]: unknown } | null | undefined,
): WindingRule {
  const name = typeof rule === "string" ? rule : rule?.name;
  if (name === "EVENODD" || name === "ODD") {
    return "evenodd";
  }
  return "nonzero";
}

/**
 * Reduce per-corner / uniform corner radius input to a single numeric
 * scalar. When per-corner radii differ, returns the arithmetic average.
 *
 * Used by parity checks and renderer paths that need a single radius
 * value. Production render paths that must preserve per-corner detail
 * read Kiwi `rectangleCornerRadii` directly at the renderer boundary.
 */
export function extractUniformCornerRadius(
  cornerRadius: number | undefined,
  rectangleCornerRadii: readonly number[] | undefined,
): number | undefined {
  if (!rectangleCornerRadii || rectangleCornerRadii.length !== 4) {
    return cornerRadius;
  }
  const [tl, tr, br, bl] = rectangleCornerRadii;
  const allSame = tl === tr && tr === br && br === bl;
  if (allSame) { return tl || undefined; }
  const avg = (tl + tr + br + bl) / 4;
  return avg || undefined;
}

/**
 * Clamp a scalar corner radius to the geometric maximum allowed by the
 * element dimensions (`min(width, height) / 2`).
 *
 * Returns `undefined` for `undefined` / `0` input. The
 * `CornerRadius`-aware (uniform-or-per-corner) version lives in
 * `@higma-primitives/path`; this one operates strictly on scalars.
 */
export function clampCornerRadius(
  radius: number | undefined,
  width: number,
  height: number,
): number | undefined {
  if (!radius || radius <= 0) { return undefined; }
  return Math.min(radius, Math.min(width, height) / 2);
}

const CLIPPING_NODE_TYPES = new Set(["FRAME"]);

/**
 * Resolve whether a node clips its content.
 *
 * Order:
 * 1. Explicit domain `clipsContent` field
 * 2. `frameMaskDisabled` Kiwi field (inverted)
 * 3. Default by node type — only `FRAME` clips by default; the
 *    canonical schema has no COMPONENT / COMPONENT_SET (Variant Sets
 *    are FRAMEs), and SYMBOL (on-disk Component) does not default-clip.
 */
export function resolveClipsContent(
  clipsContent: boolean | undefined,
  frameMaskDisabled: boolean | undefined,
  nodeType: string,
): boolean {
  if (clipsContent !== undefined) { return clipsContent; }
  if (frameMaskDisabled !== undefined) { return !frameMaskDisabled; }
  return CLIPPING_NODE_TYPES.has(nodeType);
}
