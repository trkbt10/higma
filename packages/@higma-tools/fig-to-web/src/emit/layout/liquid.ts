/**
 * @file Liquid layout translation — the post-process that re-expresses
 * a web-inferred layout's **horizontal** lengths as percentages of their
 * containing box so the emitted page fluidly scales with the viewport.
 *
 * Why a separate upstream pass (peer of `reparent` / `cluster` /
 * `infer-layout`): the percentage `childWidth / parentContentWidth` is
 * only correct when the denominator matches the layout the emitter
 * actually produced. This pass therefore reuses the *same fig context*
 * the emitter consumes — `node.size`, the reparent/cluster child reader,
 * and `resolveContainerLayout` (which runs the identical `inferLayout`).
 * It does NOT read the emitted CSS tree (where `auto` / `100%` / flex
 * widths have erased the px the denominator needs). Selecting liquid is
 * orthogonal to `cssMode`: the chosen CSS-delivery strategy runs
 * downstream on whatever values this pass produced.
 *
 * Output: a `guid → LiquidOverlayEntry` map the JSX emitter consults
 * (via `applyLiquidOverlay`) to splice `%` values onto the otherwise
 * fixed-px style record. At the authored width every `%` resolves back
 * to its original px, so the liquid render is identical to the fixed
 * render — the invariant the visual harness checks.
 *
 * ## Scope (v1)
 *
 * Only the **flow** children of flex-row / flex-column / inset
 * containers are fluidised, plus the page root and each container's own
 * horizontal padding / row-gap. Flow children are never run through
 * `collapseChain` (the emitter short-circuits collapse under a flex
 * parent), so this pass and the emitter agree on their parent and size
 * with no collapse-bias bookkeeping.
 *
 * Deliberately left at fixed px in v1 (documented boundaries):
 *   - **Absolutely-positioned children** (children of a static frame
 *     where inference declined, and `stackPositioning: ABSOLUTE`
 *     overlays). Their emitted `left` carries collapsed-wrapper bias and
 *     resolves against the padding box, so a faithful `%` needs the
 *     emitter's collapse bookkeeping — out of scope here. Their whole
 *     subtree stays fixed.
 *   - **CSS-Grid containers** (`stackMode: GRID`): tracks are already
 *     `fr` / `minmax`, i.e. intrinsically fluid.
 *   - **Vertical** lengths (height, y, top, row-gap, vertical padding):
 *     liquid is horizontal-only by request.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { guidToString } from "@higma-document-models/fig/domain";
import type { ParentLayout, StyleInputs, AxisSizing } from "../style/style";
import { axisSizingFrom } from "../style/style";
import { round2, formatPx } from "../../lib/css-format/numeric";
import type { InferenceResult } from "./infer-layout";
import { effectiveChildParentLayout, isRendered, resolveContainerLayout } from "./resolve";

/**
 * The full-bleed page-root directive. The emitter wraps a page root so
 * the background paints span the viewport (`width: 100%`) while the
 * content column is capped (`max-width`) and centred. `minHeight` keeps
 * the authored height as a floor so reflowed content grows rather than
 * clips.
 */
export type LiquidRootDirective = {
  readonly maxWidth: string;
  readonly minHeight: string;
};

/**
 * Pre-formatted horizontal-sizing overrides for one node. Every value is
 * a finished CSS string the consumer splices onto the fixed-mode style
 * record (see `applyLiquidOverlay` in `render/jsx.ts`). Horizontal
 * entries are `%`; the vertical padding / row-gap companions are `px`
 * so the consumer can replace the `padding` / `gap` shorthand wholesale
 * without re-deriving the vertical components from a possibly-tokenised
 * string.
 */
export type LiquidOverlayEntry = {
  /** Flow-child width as a percentage of the parent content box. */
  readonly width?: string;
  /** Longhand vertical padding (`px`, preserved) — paired with the horizontal `%`. */
  readonly paddingTop?: string;
  readonly paddingBottom?: string;
  /** Longhand horizontal padding as a percentage of the containing block. */
  readonly paddingLeft?: string;
  readonly paddingRight?: string;
  /** flex-row horizontal gap as a percentage of the container content box. */
  readonly columnGap?: string;
  /** Preserved vertical gap (`px`) for the same container — relevant when the row wraps. */
  readonly rowGap?: string;
  /** Page-root full-bleed directive (set on the page root only). */
  readonly root?: LiquidRootDirective;
};

export type LiquidOverlay = ReadonlyMap<string, LiquidOverlayEntry>;

export type BuildLiquidOverlayDeps = {
  /** Reparent/cluster-aware child reader (the emitter's `childrenOfEmitNode`). */
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
  /** Style inputs `resolveContainerLayout` threads into `absorbBackgroundDecoration`. */
  readonly styleInputs: StyleInputs;
  /**
   * Whether the root is a page (gets the full-bleed `max-width` shell)
   * or a component (embeds fluidly; no shell, internals still fluidised).
   */
  readonly rootKind: "page" | "component";
};

/**
 * Express `px` as a percentage of `denom`, rounded to the same 2-decimal
 * precision the px formatter uses. Throws when the denominator is not a
 * usable positive width — per the fail-fast policy, a missing content
 * width means the layout decision diverged and the `%` would be a guess.
 */
export function liquidPercent(px: number, denom: number): string {
  if (!Number.isFinite(px)) {
    throw new Error(`liquid: non-finite length ${px} cannot be made relative.`);
  }
  if (!Number.isFinite(denom) || denom <= 0) {
    throw new Error(`liquid: containing width must be a positive finite number, got ${denom}.`);
  }
  return `${round2((px / denom) * 100)}%`;
}

/**
 * Node types whose width must NOT be rewritten to `%`: TEXT (content
 * drives its box; the emitter pins single-line measurement) and vector
 * shapes (their emitted box may be expanded off the authored size to
 * carry a stroke centreline, so `node.size.x` is not the rendered px).
 */
const NON_LIQUID_WIDTH_TYPES: ReadonlySet<string> = new Set([
  "TEXT",
  "VECTOR",
  "LINE",
  "STAR",
  "REGULAR_POLYGON",
  "BOOLEAN_OPERATION",
]);

function liquefiableWidth(node: FigNode): boolean {
  return !NON_LIQUID_WIDTH_TYPES.has(node.type.name);
}

type PaddingNums = { readonly t: number; readonly r: number; readonly b: number; readonly l: number };

/**
 * The container's resolved padding, mirroring the emitter exactly:
 * explicit auto-layout reads the `stack*Padding` fields (the same
 * precedence `collapsePadding` uses), an inferred stack/inset reads the
 * descriptor's numeric paddings, and everything else has none. Returns
 * `undefined` when the emitter would emit no `padding` at all.
 */
function paddingNums(node: FigNode, inferred: InferenceResult): PaddingNums | undefined {
  if (inferred && (inferred.direction === "row" || inferred.direction === "column" || inferred.direction === "inset")) {
    const { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l } = inferred;
    if (t === 0 && r === 0 && b === 0 && l === 0) {
      return undefined;
    }
    return { t, r, b, l };
  }
  // Explicit auto-layout padding (same field precedence as collapsePadding).
  const top = node.stackVerticalPadding ?? node.stackPadding;
  const left = node.stackHorizontalPadding ?? node.stackPadding;
  const right = node.stackPaddingRight ?? left;
  const bottom = node.stackPaddingBottom ?? top;
  if (top === undefined && left === undefined && right === undefined && bottom === undefined) {
    return undefined;
  }
  return { t: top ?? 0, r: right ?? 0, b: bottom ?? 0, l: left ?? 0 };
}

/**
 * The horizontal gap the emitter emits for a flex-row container, or
 * `undefined` when none. Mirrors `applyExplicitStack` (no gap under
 * SPACE_BETWEEN / SPACE_EVENLY, which distribute their own spacing) and
 * `applyInferredStack` (the inferred uniform gap).
 */
function rowGapPx(node: FigNode, inferred: InferenceResult): number | undefined {
  if (inferred && inferred.direction === "row") {
    return inferred.gap > 0 ? inferred.gap : undefined;
  }
  const primary = node.stackPrimaryAlignItems?.name;
  const distributed = primary === "SPACE_BETWEEN" || primary === "SPACE_EVENLY";
  if (typeof node.stackSpacing === "number" && node.stackSpacing > 0 && !distributed) {
    return node.stackSpacing;
  }
  return undefined;
}

/**
 * The flow children of `node` — those that participate in the inferred
 * or authored stack (and are therefore never collapse-shifted). Absolute
 * overlays and the children of a static / un-inferred frame are excluded
 * so the v1 pass leaves their subtrees at fixed px.
 */
function flowChildren(
  node: FigNode,
  inferred: InferenceResult,
  kind: ParentLayout,
  baseChildren: readonly FigNode[],
): readonly FigNode[] {
  if (inferred && (inferred.direction === "row" || inferred.direction === "column")) {
    return inferred.orderedChildren.filter(isRendered);
  }
  if (inferred && inferred.direction === "inset") {
    return [inferred.child];
  }
  if (kind === "flex-row" || kind === "flex-column" || kind === "grid") {
    return baseChildren.filter((c) => c.stackPositioning?.name !== "ABSOLUTE");
  }
  return [];
}

/**
 * The sizing of a flow child along the axis that maps to CSS `width`.
 * In a row that is the primary axis; in a column the counter axis. An
 * inset child (the emitter flows it as a row) and inferred-stack
 * children carry no `stack*Sizing`, so they resolve to `fixed` and get a
 * width `%`.
 */
function childWidthSizing(kind: ParentLayout, child: FigNode): AxisSizing {
  if (kind === "flex-column") {
    return axisSizingFrom(child.stackCounterSizing?.name, false);
  }
  return axisSizingFrom(child.stackPrimarySizing?.name, false);
}

type WalkContext = {
  /**
   * Width of this node's containing block — the denominator for its
   * flow `width` and own horizontal `padding`. The parent's content box
   * for a descendant; the root's own width for the root (it fills the
   * viewport up to `max-width = size.x`).
   */
  readonly containingBlockWidth: number;
  /** Whether the parent fluidises this node's width (flex-row / flex-column flow). */
  readonly widthFluid: boolean;
  /** This node's sizing on the width axis (only consulted when `widthFluid`). */
  readonly widthSizing: AxisSizing;
  readonly isRoot: boolean;
};

function emptyEntry(): {
  width?: string;
  paddingTop?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  paddingRight?: string;
  columnGap?: string;
  rowGap?: string;
  root?: LiquidRootDirective;
} {
  return {};
}

/**
 * Build the liquid overlay for one emitted file's root subtree. Walks
 * the same (reparent/cluster-resolved) tree the emitter renders.
 */
export function buildLiquidOverlay(root: FigNode, deps: BuildLiquidOverlayDeps): LiquidOverlay {
  const overlay = new Map<string, LiquidOverlayEntry>();
  if (!root.size) {
    return overlay;
  }
  walk(root, { containingBlockWidth: root.size.x, widthFluid: false, widthSizing: "fixed", isRoot: true }, deps, overlay);
  return overlay;
}

function walk(
  node: FigNode,
  ctx: WalkContext,
  deps: BuildLiquidOverlayDeps,
  overlay: Map<string, LiquidOverlayEntry>,
): void {
  if (!node.size) {
    return;
  }
  const { inferred, baseChildren } = resolveContainerLayout(node, {
    childrenOf: deps.childrenOf,
    styleInputs: deps.styleInputs,
  });
  const kind = effectiveChildParentLayout(node, inferred);
  const pads = paddingNums(node, inferred);
  const hPad = pads ? pads.l + pads.r : 0;
  const ownContentWidth = node.size.x - hPad;

  const entry = emptyEntry();

  // This node's own width, when its parent fluidises it.
  if (ctx.widthFluid && ctx.widthSizing === "fixed" && liquefiableWidth(node) && ctx.containingBlockWidth > 0) {
    entry.width = liquidPercent(node.size.x, ctx.containingBlockWidth);
  }

  // This node's own horizontal padding (% of its containing block); the
  // vertical longhand is preserved in px so the consumer can replace the
  // `padding` shorthand wholesale. The consumer applies this only when
  // the emitted style actually carries `padding`, so an over-eager entry
  // here is inert.
  if (pads && ctx.containingBlockWidth > 0) {
    entry.paddingTop = formatPx(pads.t);
    entry.paddingBottom = formatPx(pads.b);
    entry.paddingLeft = liquidPercent(pads.l, ctx.containingBlockWidth);
    entry.paddingRight = liquidPercent(pads.r, ctx.containingBlockWidth);
  }

  // This node's own horizontal (row) gap.
  if (kind === "flex-row" && ownContentWidth > 0) {
    const gap = rowGapPx(node, inferred);
    if (gap !== undefined) {
      entry.columnGap = liquidPercent(gap, ownContentWidth);
      entry.rowGap = formatPx(gap);
    }
  }

  // Page-root full-bleed directive.
  if (ctx.isRoot && deps.rootKind === "page") {
    entry.root = { maxWidth: formatPx(node.size.x), minHeight: formatPx(node.size.y) };
  }

  if (Object.keys(entry).length > 0) {
    overlay.set(guidToString(node.guid), entry);
  }

  // Recurse into flow children only. Their width axis fluidises for
  // flex-row / flex-column (and inset, which the emitter flows as a
  // row); grid children keep their track sizing.
  const flow = flowChildren(node, inferred, kind, baseChildren);
  if (flow.length === 0 || ownContentWidth <= 0) {
    return;
  }
  const childWidthFluid = kind === "flex-row" || kind === "flex-column";
  for (const child of flow) {
    walk(
      child,
      {
        containingBlockWidth: ownContentWidth,
        widthFluid: childWidthFluid,
        widthSizing: childWidthSizing(kind, child),
        isRoot: false,
      },
      deps,
      overlay,
    );
  }
}
