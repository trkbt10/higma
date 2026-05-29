/**
 * @file Liquid layout translation — re-express a fixed-width design so it
 * shrinks uniformly to fit the viewport, the standard "px → vw via calc"
 * technique.
 *
 * A design authored at width `W` should, at viewport width `V`, render at
 * scale `V / W` below `W` and freeze at its authored size at / above `W`.
 * That single uniform factor is carried by one inherited CSS unit:
 *
 *   --lqd: min(1vw, (W / 100)px);
 *
 *   - below the design width `1vw = V/100 px` is the smaller term, so
 *     `--lqd = V/100 px` and the page scales with the viewport;
 *   - at / above the design width `(W/100)px` is the smaller term, so
 *     `--lqd` freezes and the page stays at its authored size.
 *
 * Every authored length `L px` becomes `calc(L/W*100 * var(--lqd))`:
 *   - below `W`: `= L/W*100 * V/100 px = L * V/W` (scaled);
 *   - at / above `W`: `= L/W*100 * W/100 px = L px` (frozen).
 *
 * Because EVERY length (width, height, top, left, padding, gap,
 * font-size, radius, shadow offsets, …) uses the same factor, the whole
 * page is a similarity transform of the viewport width — **aspect ratio
 * is preserved** without the `aspect-ratio` property, and without a
 * `transform: scale()` (this is real layout: text stays crisp and
 * selectable, the box model is honoured). The cap + centring replace a
 * `max-width` wrapper, so no extra `<body>`-duplicating div is emitted.
 *
 * The translation is a pure transform of the emitted style record keyed
 * only on the design width, so it is orthogonal to `cssMode`: whatever
 * CSS-delivery strategy runs downstream simply packages the `calc(...)`
 * values.
 *
 * Known limitations (documented, not silently handled):
 *   - Lengths already emitted as design-token references
 *     (`var(--spacing-…)`) are not scaled — they carry no px literal to
 *     rewrite. Tokenised spacing therefore stays fixed.
 *   - A referenced component re-bases `--lqd` to its OWN authored width,
 *     so deep nesting scales relative to the component rather than the
 *     embedding page. Identical at the design width; mildly divergent
 *     below it.
 */
import { round2 } from "../../lib/css-format/numeric";
import type { JsxNode, JsxProp } from "../../lib/jsx-tree/types";
import { el, styleProp } from "../../lib/jsx-tree/builder";
import type { TokenIndex } from "../../tokens";

/** Configuration for a liquid emit: the design width every length scales against. */
export type LiquidConfig = {
  /** Authored width of the emit's root frame — the denominator of the scale. */
  readonly designWidth: number;
};

/** The node's role in its file, which decides whether it seeds the scale unit. */
export type LiquidRole = "page-root" | "component-root" | "descendant";

/**
 * A token index that suppresses every SIZE-bearing design token
 * (spacing / radius / shadow / typography) while keeping colour tokens.
 *
 * Why: size tokens resolve to fixed px in the shared `tokens.css`, which
 * the per-page liquid pass cannot scale (the sheet is global; pages have
 * different design widths). Forcing those lengths to inline px instead —
 * the emitter already falls back to px when the index returns no id, and
 * still emits `font-weight` via `detectWeight`, so nothing is lost — lets
 * the tree pass scale them per page. Colours are never scaled, so their
 * tokens stay intact.
 */
export function detokenizeSizingTokens(index: TokenIndex): TokenIndex {
  return {
    colorIdForPaints: index.colorIdForPaints,
    spacingIdFor: () => undefined,
    radiusIdFor: () => undefined,
    shadowIdFor: () => undefined,
    typographyIdFor: () => undefined,
  };
}

/** Inherited custom property carrying the capped per-viewport scale unit. */
const LIQUID_UNIT = "--lqd";
/**
 * The scale unit an INSTANCE wrapper hands DOWN to its component subtree.
 * A reusable component cannot key off the viewport (`vw`) — it must scale
 * with the box it is dropped into. The wrapper, which knows both its
 * parent scope's width and the component's authored width, derives this
 * from its parent's `--lqd`; the component root then adopts it as its own
 * `--lqd`. Each nesting level re-derives from its parent's `--lqd`, so the
 * chain composes to any depth with no self-referential cycle.
 */
const LIQUID_UNIT_DOWN = "--lqd-down";

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * The `--lqd-down` declaration an INSTANCE wrapper sets so its component
 * subtree scales with the page rather than freezing at the component's
 * own (small) design width. `componentWidth / parentWidth` is the
 * component's footprint in its parent scope; multiplying the parent's
 * `--lqd` by it yields the component's local unit.
 */
export function instanceScaleVar(componentWidth: number, parentWidth: number): { readonly key: string; readonly value: string } {
  const ratio = round4(componentWidth / parentWidth);
  return { key: LIQUID_UNIT_DOWN, value: `calc(var(${LIQUID_UNIT}) * ${ratio})` };
}

/**
 * Express one authored pixel length as a fluid `calc(...)` against the
 * shared scale unit. `0` stays `0px` (it scales to nothing either way).
 */
function liquidLength(px: number, designWidth: number): string {
  if (px === 0) {
    return "0px";
  }
  const factor = round4((px / designWidth) * 100);
  return `calc(${factor} * var(${LIQUID_UNIT}))`;
}

/**
 * Rewrite every `<n>px` literal in a CSS value to its fluid `calc(...)`
 * form. Handles shorthands (`padding: 8px 16px`), multi-value props
 * (`box-shadow: 0px 2px 4px …`), and `border: 1px solid …` uniformly,
 * while leaving `%` / `auto` / `var(--token)` / colours untouched.
 */
function scaleLengths(value: string, designWidth: number): string {
  return value.replace(/-?\d*\.?\d+px/g, (match) => liquidLength(Number.parseFloat(match), designWidth));
}

/**
 * Liquefy a node's fixed-px style record. Descendants only have their
 * lengths rewritten; a root additionally seeds the `--lqd` scale unit
 * (so its subtree inherits the same factor). A page root also centres
 * the capped column (`margin: 0 auto`), lets it grow (`height` →
 * `min-height`), and drops `overflow` so the fluid page never clips
 * itself.
 */
export function liquefyStyle(
  style: Record<string, string>,
  designWidth: number,
  role: LiquidRole,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(style)) {
    out[key] = scaleLengths(value, designWidth);
  }
  if (role === "descendant") {
    return out;
  }
  if (role === "component-root") {
    // A component adopts the scale unit its INSTANCE wrapper handed down
    // (`--lqd-down`), so it scales with the page that placed it. The
    // fallback covers a component viewed on its own standalone page,
    // where no wrapper exists: it then scales against its own width.
    out[LIQUID_UNIT] = `var(${LIQUID_UNIT_DOWN}, min(1vw, ${round2(designWidth / 100)}px))`;
    return out;
  }
  // Page root: seed the viewport scale unit AFTER the rewrite, so its own
  // `px` term (the cap) is not itself scaled.
  out[LIQUID_UNIT] = `min(1vw, ${round2(designWidth / 100)}px)`;
  out.marginLeft = "auto";
  out.marginRight = "auto";
  delete out.overflow;
  if (out.height !== undefined) {
    out.minHeight = out.height;
    delete out.height;
  }
  return out;
}

/**
 * Liquefy an entire emitted JSX subtree: rewrite every `style` prop's
 * lengths to their fluid `calc(...)` form, and seed `--lqd` on the root.
 *
 * Running over the finished tree (rather than per node during emission)
 * is what makes the scaling COMPLETE: it catches every style — the main
 * node style, per-run text styles, INSTANCE override CSS variables
 * (`--fs-…` / `--lh-…`), structural-image styles, scale wrappers —
 * regardless of which emit path produced it. Anything left at a fixed px
 * while the layout around it scaled is exactly what makes text overflow
 * its box; one uniform pass removes that whole class of bug.
 *
 * Pure `JsxNode → JsxNode`, keyed only on the design width, so it
 * composes before the `cssMode` delivery rewriter (which then packages
 * the `calc(...)` values) — orthogonal, not a delivery strategy itself.
 */
export function rewriteForLiquid(node: JsxNode, designWidth: number, role: LiquidRole): JsxNode {
  if (node.kind === "text" || node.kind === "expr") {
    return node;
  }
  if (node.kind === "fragment") {
    return { kind: "fragment", children: node.children.map((child) => rewriteForLiquid(child, designWidth, "descendant")) };
  }
  const props = node.props.map((prop) => liquefyProp(prop, designWidth, role));
  const children = node.children.map((child) => rewriteForLiquid(child, designWidth, "descendant"));
  return el(node.tag, { props, children, layout: node.layout });
}

function liquefyProp(prop: JsxProp, designWidth: number, role: LiquidRole): JsxProp {
  if (prop.kind !== "style") {
    return prop;
  }
  const record: Record<string, string> = {};
  for (const entry of prop.entries) {
    record[entry.key] = entry.value;
  }
  return styleProp(liquefyStyle(record, designWidth, role));
}
