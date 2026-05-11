/**
 * @file Split a single SVG path `d` string into per-subpath segments.
 *
 * Why split: Figma's VECTOR node accepts an array of `vectorPaths`,
 * each treated as an independent subpath stack with its own winding
 * decision. When a captured `<path>` carries multiple subpaths in one
 * `d` (icons authored as `M ... Z M ... Z M ... Z` for cluster glyphs,
 * compound shapes that should render as separate strokes, multi-piece
 * mask silhouettes), feeding the whole string to one `vectorPath`
 * forces Figma to evaluate every subpath under the same winding rule
 * — and any *open* subpath (no closing `Z`) ends up visually merging
 * with the next subpath's start point as the renderer connects the
 * remaining pen position to the next M's coordinates. The user-
 * visible symptom is "parts of the icon that shouldn't connect appear
 * connected by a thin straight line".
 *
 * Splitting on the SVG `M` / `m` boundary turns each subpath into its
 * own `vectorPath` entry, and Figma's pen position resets between
 * entries — independent subpaths render independently, with no
 * cross-subpath fills or strokes leaking between them.
 *
 * Contract:
 *   - Returns one entry per `M`/`m` command in the input.
 *   - Each entry is a complete, well-formed `d` string starting with
 *     a single `M` (preserving the original case so relative-vs-
 *     absolute semantics survive).
 *   - When the input has zero `M` commands (degenerate / malformed),
 *     returns `[d]` unchanged so the caller still emits *something*
 *     and the failure surfaces downstream.
 *   - Whitespace and command separators inside a subpath are
 *     preserved verbatim — we only insert split points, never
 *     re-format the path.
 *
 * The splitter is purely textual: it does not parse coordinates,
 * resolve relative `m` against the prior subpath, or attempt to bake
 * transforms. Those responsibilities live higher up the pipeline.
 */

/**
 * Return the input `d` split into one entry per `M`/`m` subpath.
 * The relative-`m` form is intentionally preserved as-is — its
 * starting coordinate references the *current* pen position, which
 * for the first command in a subpath equals (0, 0) by SVG spec, so
 * keeping `m` untouched is correct as long as each split entry is
 * emitted as a fresh `vectorPath` (Figma resets the pen at every
 * entry).
 */
export function splitSubpaths(d: string): readonly string[] {
  const trimmed = d.trim();
  if (trimmed.length === 0) {
    return [trimmed];
  }
  const indices = findMoveIndices(trimmed);
  if (indices.length === 0) {
    return [trimmed];
  }
  if (indices.length === 1 && indices[0] === 0) {
    return [trimmed];
  }
  return sliceAt(trimmed, indices);
}

/**
 * Fill-rule-aware splitter. SVG `fill-rule: evenodd` resolves the
 * fill of every subpath in one path *together* — that is how a
 * "donut" icon (outer circle + inner circle) renders with the inner
 * subpath cancelling the outer fill so the hole appears. Splitting
 * such a path into separate `vectorPath` entries breaks the cross-
 * subpath winding cancellation: Figma evaluates each entry's
 * winding independently, so the inner circle becomes a second
 * filled disk on top of the outer instead of a hole.
 *
 * Decision matrix:
 *   - `evenodd`  → never split. Keep the entire `d` as one entry so
 *                  Figma's winding evaluator sees every subpath in
 *                  one stack and the donut hole survives.
 *   - `nonzero`  → split. Each subpath fills independently under
 *                  nonzero winding, and splitting prevents Figma
 *                  from connecting an open subpath's pen position
 *                  to the next subpath's `M` with a stray segment.
 *   - undefined  → behave like `nonzero` (the SVG default fill-rule
 *                  is `nonzero`).
 *
 * Returns the list of subpath strings to feed to Figma's
 * `vectorPaths` array, in source order.
 */
export function splitSubpathsRespectingFillRule(
  d: string,
  fillRule: "nonzero" | "evenodd" | undefined,
): readonly string[] {
  if (fillRule === "evenodd") {
    const trimmed = d.trim();
    return trimmed.length === 0 ? [trimmed] : [trimmed];
  }
  return splitSubpaths(d);
}

/**
 * Return every index in `d` where a top-level `M` or `m` command
 * begins. "Top-level" means outside an arc-flag context (which has no
 * such commands anyway) — SVG path-data syntax forbids `M` inside the
 * argument list of any other command, so the simple "alpha character
 * is a command" rule is enough.
 *
 * Embedded `M` characters inside numeric exponents (`1.5e-M` would be
 * malformed anyway) and string literals (the `d` grammar has none)
 * are not a concern.
 */
function findMoveIndices(d: string): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i < d.length; i += 1) {
    const ch = d[i]!;
    if (ch === "M" || ch === "m") {
      out.push(i);
    }
  }
  return out;
}

function sliceAt(d: string, indices: readonly number[]): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < indices.length; i += 1) {
    const start = indices[i]!;
    const end = i + 1 < indices.length ? indices[i + 1]! : d.length;
    const segment = d.slice(start, end).trim();
    if (segment.length > 0) {
      out.push(segment);
    }
  }
  if (out.length === 0) {
    return [d];
  }
  return out;
}
