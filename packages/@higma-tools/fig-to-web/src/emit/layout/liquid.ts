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
 * The scale unit an INSTANCE wrapper hands DOWN to a UNIFORMLY-RESIZED
 * component so it fills its (smaller) slot. A reusable component cannot
 * key off the viewport (`vw`) — it must scale with the box it is dropped
 * into. For a uniform resize the wrapper derives this from its parent's
 * `--lqd` and the component's footprint; the component root adopts it as
 * its own `--lqd`. A NON-resized component does NOT get this — it
 * computes its `--lqd` from its OWN authored width (see {@link
 * componentScaleUnit}), which is the reliable source even when the
 * instance's resolved symbol size differs from the emitted component.
 */
const LIQUID_UNIT_DOWN = "--lqd-down";
/**
 * Inherited custom property an INSTANCE wrapper sets to the width of the
 * SCOPE it is placed in (its parent component / page design width, a
 * unitless number). A non-resized component reads it to scale its own
 * authored width against the scope — see {@link componentScaleUnit}.
 */
const LIQUID_UNIT_WIDTH = "--lqd-w";
/**
 * Inherited custom property an INSTANCE wrapper sets to the SCOPE's
 * `--lqd` (captured as `var(--lqd)` on the wrapper, which does not
 * itself redefine `--lqd`). A component root reads THIS rather than
 * `var(--lqd)` directly — referencing `--lqd` while defining `--lqd` on
 * the same element is a self-cycle (CSS makes it invalid).
 */
const LIQUID_UNIT_SCOPE = "--lqd-scope";

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * The `--lqd-down` declaration an INSTANCE wrapper sets for a UNIFORMLY
 * RESIZED component so it fills its slot rather than rendering at its
 * authored size. `componentWidth` is the instance footprint in the
 * scope; multiplying the parent's `--lqd` by `footprint / parentWidth`
 * yields the component's local unit (content scaled to the footprint).
 */
export function instanceScaleVar(componentWidth: number, parentWidth: number): { readonly key: string; readonly value: string } {
  const ratio = round4(componentWidth / parentWidth);
  return { key: LIQUID_UNIT_DOWN, value: `calc(var(${LIQUID_UNIT}) * ${ratio})` };
}

/**
 * The custom properties every INSTANCE wrapper sets so a non-resized
 * component can scale its OWN authored width against the scope it lands
 * in: the scope's `--lqd` (captured here, where reading `var(--lqd)` is
 * safe because the wrapper does not redefine it) and the scope's design
 * width (`scopeWidth`, a unitless number). Both are consumed by the
 * component root's {@link componentScaleUnit} expression.
 */
export function instanceScopeVars(scopeWidth: number): Record<string, string> {
  return { [LIQUID_UNIT_SCOPE]: `var(${LIQUID_UNIT})`, [LIQUID_UNIT_WIDTH]: `${round4(scopeWidth)}` };
}

/**
 * The `--lqd` value a component root adopts. A reusable component is
 * authored against its own width `Wc` but rendered at many scales, so it
 * derives its unit from the scope it lands in:
 *
 *   --lqd: var(--lqd-down,
 *              calc(var(--lqd-scope, min(1vw, Wc/100px)) * Wc / var(--lqd-w, Wc)))
 *
 *   - `--lqd-down` (set only by a UNIFORMLY-RESIZED instance's wrapper)
 *     wins when present — the component fills its resized slot;
 *   - otherwise the component scales its OWN authored width `Wc` against
 *     the scope: `scope--lqd * Wc / scopeWidth`. `Wc` comes from the
 *     emitted component (reliable) rather than the instance's resolved
 *     symbol size (which can disagree), so the component's lengths land
 *     at the right scale at every nesting depth. `--lqd-scope` carries
 *     the scope's `--lqd` (the wrapper captures it; the component can't
 *     read `var(--lqd)` while defining `--lqd` — that is a self-cycle);
 *   - the inner fallbacks (`min(1vw, Wc/100px)` for `--lqd-scope`, `Wc`
 *     for `--lqd-w`) make a standalone component (no wrapper) scale
 *     against its own width, exactly as before.
 */
function componentScaleUnit(designWidth: number): string {
  const wc = round4(designWidth);
  const standalone = `min(1vw, ${round2(designWidth / 100)}px)`;
  const fromScope = `calc(var(${LIQUID_UNIT_SCOPE}, ${standalone}) * ${wc} / var(${LIQUID_UNIT_WIDTH}, ${wc}))`;
  return `var(${LIQUID_UNIT_DOWN}, ${fromScope})`;
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
    out[LIQUID_UNIT] = componentScaleUnit(designWidth);
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
  const skipOffscreen = qualifiesForOffscreenSkip(node, role);
  const props = node.props.map((prop) => liquefyProp(prop, designWidth, role, skipOffscreen));
  const children = node.children.map((child) => rewriteForLiquid(child, designWidth, "descendant"));
  return el(node.tag, { props, children, layout: node.layout });
}

function liquefyProp(prop: JsxProp, designWidth: number, role: LiquidRole, skipOffscreen: boolean): JsxProp {
  if (prop.kind !== "style") {
    return prop;
  }
  const record: Record<string, string> = {};
  for (const entry of prop.entries) {
    record[entry.key] = entry.value;
  }
  const out = liquefyStyle(record, designWidth, role);
  if (skipOffscreen) {
    // The whole liquid page tracks the viewport, so a resize re-lays-out
    // EVERY length at once — measured at ~60ms for a 3000-element page,
    // which makes a drag-resize stutter. `content-visibility: auto` lets
    // the browser skip layout + paint for off-screen blocks. No
    // `contain-intrinsic-size` is needed because this only marks blocks
    // whose height is an EXPLICIT length (preserved by the rewrite as a
    // `calc(... var(--lqd))`): that height reserves the scroll space
    // exactly and still tracks the viewport, so a skipped block neither
    // collapses nor drifts the scrollbar.
    out.contentVisibility = "auto";
  }
  return styleProp(out);
}

/** Authored height (px) at/above which a container is worth skipping when off-screen. */
const OFFSCREEN_SKIP_MIN_HEIGHT = 480;

/**
 * Whether a node should carry `content-visibility: auto` so the browser
 * can skip its off-screen layout/paint (the liquid resize-cost fix).
 * Restricted to descendant CONTAINERS (a root must always render; a
 * leaf has no subtree to skip) that are tall enough to be worth it AND
 * whose box is sized by layout, not content: an explicit height (so the
 * skipped block reserves the right scroll space) and a width that is not
 * `auto` (so the `contain: size` applied while skipped cannot collapse
 * the inline axis to zero).
 */
function qualifiesForOffscreenSkip(node: JsxNode, role: LiquidRole): boolean {
  if (role !== "descendant" || node.kind !== "element" || node.children.length === 0) {
    return false;
  }
  const style = node.props.find((prop) => prop.kind === "style");
  if (style === undefined || style.kind !== "style") {
    return false;
  }
  const width = style.entries.find((entry) => entry.key === "width")?.value;
  const height = style.entries.find((entry) => entry.key === "height")?.value;
  if (width === undefined || width === "auto") {
    return false;
  }
  const heightPx = height === undefined ? undefined : pxLength(height);
  return heightPx !== undefined && heightPx >= OFFSCREEN_SKIP_MIN_HEIGHT;
}

/** Parse a bare `<n>px` length to its number, or undefined for any other form. */
function pxLength(value: string): number | undefined {
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  return match ? Number.parseFloat(match[1]) : undefined;
}
