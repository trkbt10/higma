/**
 * @file Render a FigNode subtree to a JSX tree.
 *
 * The output is a `JsxNode` value (from `src/lib/jsx-tree`) — never a
 * raw markup string. The single serializer in `lib/jsx-tree`
 * eventually emits TSX, funnelling every Figma-author string
 * (TEXT characters, layer names, font family overrides) through
 * JSON-string escaping at the boundary. Building strings in this
 * file would put each call site back in charge of its own escaping;
 * the typed tree makes that impossible.
 *
 * Layout fidelity: every emit recurs with a `parentLayout` argument
 * that says whether THIS node sits inside a flex (auto-layout) parent
 * or a static one. The child's style is computed accordingly so that
 * `position: absolute` and `display: flex` never conflict on the same
 * subtree — flex children flow, static children pin via FigMatrix.
 *
 * INSTANCE handling:
 *   - The instance's referenced component target is resolved through
 *     the EmitRegistry. INSTANCE → `<ComponentName variant="X" />`.
 *   - Nested INSTANCE bodies are NOT inlined: the referenced component
 *     owns its own JSX in its own file.
 *   - When the component target carries variants, the INSTANCE's
 *     selected variant string flows into the `variant` prop.
 *   - INSTANCE wrappers are placed by the same flow/absolute decision
 *     as any other node so they integrate cleanly with auto-layout
 *     parents.
 */
import type { FigMatrix, FigNode } from "@higma-document-models/fig/types";
import type { TokenIndex } from "../../tokens";
import type { EmitRegistry } from "../types";
import type { ParentContext, ParentLayout, RootMode, StyleInputs } from "../style/style";
import { nodeToStyle, parentLayoutOf } from "../style/style";
import type { ImageResolver } from "../style/paint";
import { absorbBackgroundDecoration } from "../style/decoration";
import { isPlainRule } from "../style/rule";
import type { PropBindings } from "../plan/prop-bindings";
import { lookupInstanceTarget, variantValueForInstance } from "../plan/registry";
import type { FigSource } from "../../fig-source";
import { emitMergedVectorSvg, emitVectorSvg, isVectorOnlyContainer, isVectorShaped } from "../svg/svg";
import { hasOverrides, resolveTextRuns } from "../text/text-runs";
import type { InferenceResult } from "../layout/infer-layout";
import { inferLayout } from "../layout/infer-layout";
import { collapseChain } from "../layout/collapse";
import type { ReparentResult } from "../layout/reparent";
import { guidToString, safeChildren as safeChildrenDomain } from "@higma-document-models/fig/domain";
import type { FigStyleRegistry } from "@higma-document-models/fig/domain";
import { resolvePaintRef } from "@higma-document-models/fig/symbols";
import type { FigPaint, FigStyleId } from "@higma-document-models/fig/types";
import type { JsxNode, JsxProp } from "../../lib/jsx-tree/types";
import { el, expr, exprProp, flagProp, strProp, styleProp, text } from "../../lib/jsx-tree/builder";

const TEXT_NODE_TYPE = "TEXT";
const INSTANCE_NODE_TYPE = "INSTANCE";
const NON_RENDERED_TYPES: ReadonlySet<string> = new Set([
  "SLICE",
]);

export type EmitContext = {
  readonly source: FigSource;
  readonly registry: EmitRegistry;
  readonly index: TokenIndex;
  readonly imageResolver: ImageResolver;
  /**
   * Descendant-guid → prop binding map for the component currently
   * being emitted. Empty when emitting a page (pages don't define
   * typed props). When non-empty, TEXT nodes whose guid is a key
   * render the bound prop instead of literal characters, and
   * VISIBLE-bound nodes wrap themselves in the prop's truthiness.
   */
  readonly propBindings: PropBindings;
  /**
   * The path of the file currently being emitted, relative to the
   * output root (e.g. `"pages/design/home.tsx"`). Used to compute
   * relative import paths.
   */
  readonly emittingFile: string;
  /** Imports collected as a side-effect — `import { Name } from "./foo"`. */
  readonly imports: Map<string, string>;
  /**
   * When true, emit `data-fig-name` / `data-fig-type` attributes on
   * every node so the source layer is traceable from the rendered DOM.
   * The default is false because those attributes leak the source's
   * Figma authoring (auto-generated names like `"Vector"`, `"Frame 24"`)
   * and make the output look obviously machine-generated.
   */
  readonly debugAttrs: boolean;
  /**
   * Spatial reparenting overlay: when image-to-fig flattens a
   * hierarchical Figma tree, this map restores the implied parent →
   * children relationships so empty section frames adopt their
   * spatially-contained siblings. Empty when the source already
   * carries proper nesting.
   */
  readonly reparent: ReparentResult;
};

function styleInputsOf(context: EmitContext): StyleInputs {
  return {
    index: context.index,
    imageResolver: context.imageResolver,
    textBoundGuids: textBoundGuidsOf(context.propBindings),
  };
}

function textBoundGuidsOf(bindings: PropBindings): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [guidStr, binding] of bindings) {
    if (binding.field === "TEXT_DATA") {
      out.add(guidStr);
    }
  }
  return out;
}

function parentContextOf(options: EmitOptions): ParentContext | undefined {
  if (options.parentAlignItems === undefined && options.parentContent === undefined) {
    return undefined;
  }
  return { alignItems: options.parentAlignItems, content: options.parentContent };
}

/**
 * Resolve a TEXT node's display string. Figma stores the visible
 * characters in `textData.characters`; the top-level `characters`
 * field is only populated for nodes built via the high-level
 * `addNode` builder, never for nodes loaded from real .fig binaries.
 */
function textCharacters(node: FigNode): string {
  if (typeof node.textData?.characters === "string") {
    return node.textData.characters;
  }
  if (typeof node.characters === "string") {
    return node.characters;
  }
  return "";
}

/**
 * Produce CSS `transform` value for non-translation parts of a
 * FigMatrix. Returns undefined when the matrix is pure translation
 * (the common case) so the emitted style stays clean.
 */
function transformFromMatrix(matrix: FigMatrix | undefined): string | undefined {
  if (!matrix) {
    return undefined;
  }
  const { m00, m01, m10, m11 } = matrix;
  const isIdentity = m00 === 1 && m01 === 0 && m10 === 0 && m11 === 1;
  if (isIdentity) {
    return undefined;
  }
  return `matrix(${m00}, ${m10}, ${m01}, ${m11}, 0, 0)`;
}

function safeChildren(node: FigNode, context?: EmitContext): readonly FigNode[] {
  if (context) {
    const overlay = context.reparent.childrenByParent.get(guidToString(node.guid));
    if (overlay) {
      return overlay;
    }
  }
  const out: FigNode[] = [];
  for (const child of node.children ?? []) {
    if (child) {
      out.push(child);
    }
  }
  // Figma encodes z-order as a `parentIndex.position` fractional-index
  // string on each child, NOT by the array order in the raw
  // `nodeChanges` payload. The parser's `buildNodeTree` keeps the
  // native array order, so two siblings authored as "circle behind /
  // plus on top" can land in our `children` array as `[plus, circle]`
  // — emitting them in DOM order then paints the circle on top of
  // the plus and the icon disappears. Sorting by the position string
  // here restores the bottom-to-top stack the renderer expects.
  return [...out].sort((a, b) => positionKey(a).localeCompare(positionKey(b)));
}

function positionKey(node: FigNode): string {
  const pos = node.parentIndex?.position;
  return typeof pos === "string" ? pos : "";
}

function isRendered(node: FigNode): boolean {
  if (node.visible === false) {
    return false;
  }
  if (NON_RENDERED_TYPES.has(node.type.name)) {
    return false;
  }
  return true;
}

/**
 * Compose the `style` prop for a node. When a non-translation
 * transform is present, append `transform` and pin
 * `transform-origin: 0 0` so the rotation pivot matches Figma's
 * authored `(0,0)` corner — CSS's default `50% 50%` would visibly
 * displace every rotated node by the centre-vs-corner offset.
 */
function styleAsProp(style: Record<string, string>, transform: string | undefined): JsxProp {
  if (!transform) {
    return styleProp(style);
  }
  return styleProp({ ...style, transform, transformOrigin: "0 0" });
}

/** Render a top-level frame as a self-contained JSX tree. */
export function emitFrameJsx(node: FigNode, context: EmitContext, root: RootMode): JsxNode {
  return emitNodeJsx(node, context, { rootMode: root, parentLayout: "none" });
}

/**
 * Render only the children of a node (not the node itself). Used when
 * the parent wrapper is owned by another emitter — for example, a
 * variant case wraps each branch in its own `<div>`.
 */
export function emitNodeChildrenJsx(node: FigNode, context: EmitContext): readonly JsxNode[] {
  const parentLayout = parentLayoutOf(node);
  const out: JsxNode[] = [];
  for (const child of safeChildren(node, context)) {
    if (!isRendered(child)) {
      continue;
    }
    out.push(emitNodeJsx(child, context, { rootMode: undefined, parentLayout }));
  }
  return out;
}

type EmitOptions = {
  readonly rootMode: RootMode | undefined;
  readonly parentLayout: ParentLayout;
  /**
   * Translation accumulated from collapsed transparent-wrapper
   * ancestors. The emitter adds this to the node's own translation
   * when computing `left` / `top`, so collapsed wrappers cause no
   * visual shift.
   */
  readonly offsetBias?: { readonly dx: number; readonly dy: number };
  /**
   * Parent's effective `align-items` value, derived from Figma's
   * `stackCounterAlignItems` (or the inferred-layout result). Used by
   * `applyChildSizing` to decide whether a child's counter-axis FIXED
   * size is redundant (CSS stretch from a stretching parent already
   * fills it) — that's the `width: 360px` pruning the user objected
   * to as `ご都合主義`.
   */
  readonly parentAlignItems?: "stretch" | "flex-start" | "center" | "flex-end" | "baseline";
  /**
   * Parent's content-area size (size minus padding). When a child's
   * counter-axis FIXED dimension equals this number AND
   * `parentAlignItems === "stretch"`, the explicit dimension is
   * dropped — CSS auto-stretch produces the same result.
   */
  readonly parentContent?: { readonly width: number; readonly height: number };
};

function emitNodeJsx(node: FigNode, context: EmitContext, options: EmitOptions): JsxNode {
  // Page / component roots emit their own wrapper unconditionally —
  // collapsing the root would erase the file's outer shell. Other
  // nodes flow through `collapseChain` which walks past any
  // transparent same-size wrapper layers and accumulates their
  // translation onto `offsetBias`.
  const effective = collapseForEmit(node, options);
  const next: EmitOptions = { ...options, offsetBias: nextBias(options.offsetBias, effective) };
  const target = effective.node;

  if (target.type.name === INSTANCE_NODE_TYPE) {
    return emitInstanceJsx(target, context, next);
  }
  if (target.type.name === TEXT_NODE_TYPE) {
    return emitTextJsx(target, context, next);
  }
  return emitContainerJsx(target, context, next);
}

type CollapsedNode = { readonly node: FigNode; readonly offsetX: number; readonly offsetY: number };

function collapseForEmit(node: FigNode, options: EmitOptions): CollapsedNode {
  if (options.rootMode !== undefined) {
    return { node, offsetX: 0, offsetY: 0 };
  }
  return collapseChain(node, options.parentLayout);
}

function nextBias(
  current: { readonly dx: number; readonly dy: number } | undefined,
  effective: { offsetX: number; offsetY: number },
): { readonly dx: number; readonly dy: number } | undefined {
  if (effective.offsetX === 0 && effective.offsetY === 0) {
    return current;
  }
  return addBias(current, effective.offsetX, effective.offsetY);
}

function addBias(
  current: { readonly dx: number; readonly dy: number } | undefined,
  dx: number,
  dy: number,
): { readonly dx: number; readonly dy: number } {
  if (!current) {
    return { dx, dy };
  }
  return { dx: current.dx + dx, dy: current.dy + dy };
}

function emitContainerJsx(node: FigNode, context: EmitContext, options: EmitOptions): JsxNode {
  const { rootMode, parentLayout } = options;
  const dataAttrs = dataAttributes(node, context.debugAttrs);
  const rootClass = rootClassProp(rootMode);

  // Vector-only container collapse: a plain container whose entire
  // subtree is composed of vector shapes becomes one merged SVG. The
  // merged SVG's `<path transform="translate(...)">` already encodes
  // each vector's offset relative to the container, so we deliberately
  // do NOT run `inferLayout` here — that would double-emit the offset
  // as `padding` on the SVG element. The container's own style is
  // therefore computed without an inference result.
  if (rootMode === undefined && isVectorOnlyContainer(node)) {
    const svgStyle = nodeToStyle(node, styleInputsOf(context), rootMode, parentLayout, options.offsetBias, undefined, parentContextOf(options));
    const transform = transformForNode(node, rootMode, parentLayout);
    const wrapperProps: JsxProp[] = [...dataAttrs];
    if (rootClass) {
      wrapperProps.push(rootClass);
    }
    wrapperProps.push(styleAsProp(svgStyle, transform));
    const merged = emitMergedVectorSvg(node, { source: context.source, index: context.index }, wrapperProps);
    if (merged) {
      return merged;
    }
  }

  // Background-decoration absorption: a full-bleed first child becomes
  // part of the parent's `background*` style and is dropped from
  // children emission. The decoration's removal often unlocks layout
  // inference on the remaining children — what was a 2-child overlap
  // pattern becomes a 1-child inset pattern.
  const absorbed = absorbBackgroundDecoration(node, styleInputsOf(context));
  const baseChildren = safeChildren(node, context)
    .filter(isRendered)
    .filter((c) => c !== absorbed.absorbed);
  const inferred = inferLayout(node, baseChildren);

  const computedStyle = nodeToStyle(node, styleInputsOf(context), rootMode, parentLayout, options.offsetBias, inferred, parentContextOf(options));
  const style = mergeAbsorbedStyle(computedStyle, absorbed.style);
  const transform = transformForNode(node, rootMode, parentLayout);

  const orderedChildren = childrenForEmit(node, baseChildren, inferred);
  const props: JsxProp[] = [...dataAttrs];
  if (rootClass) {
    props.push(rootClass);
  }
  props.push(styleAsProp(style, transform));
  if (orderedChildren.length === 0) {
    return emitLeafJsx(node, context, style, props);
  }
  const childParentLayout = effectiveChildParentLayout(node, inferred);
  const childContext = childContextFor(node, inferred, childParentLayout);
  const children = orderedChildren.map((child) => emitNodeJsx(child, context, {
    rootMode: undefined,
    parentLayout: childParentLayout,
    parentAlignItems: childContext.alignItems,
    parentContent: childContext.content,
  }));
  return el("div", { props, children, layout: "block" });
}

/**
 * The `className="fig-page"` attribute that scopes the
 * `box-sizing: border-box` reset (see tokens/css.ts) to the generated
 * subtree. Emitted only on page / component roots; descendants
 * inherit the scope through the ancestor selector.
 */
function rootClassProp(rootMode: RootMode | undefined): JsxProp | undefined {
  if (rootMode === undefined) {
    return undefined;
  }
  return strProp("className", "fig-page");
}

/**
 * Compute the parent-side context children need to decide whether to
 * drop redundant `width` / `height`:
 *
 *   - `alignItems`: the Figma-faithful counter-axis alignment. For
 *     explicit auto-layout we read `stackCounterAlignItems` (default
 *     `flex-start` per Figma's MIN convention). For inferred stack
 *     layouts `inferLayout` already produced the value.
 *   - `content`: the inner content size (frame size minus padding).
 *     A child whose FIXED counter dimension equals this value is
 *     redundant when alignItems is `stretch`.
 */
function childContextFor(
  node: FigNode,
  inferred: InferenceResult,
  childParentLayout: ParentLayout,
): {
  readonly alignItems: "stretch" | "flex-start" | "center" | "flex-end" | "baseline" | undefined;
  readonly content: { readonly width: number; readonly height: number } | undefined;
} {
  if (childParentLayout !== "flex-row" && childParentLayout !== "flex-column") {
    return { alignItems: undefined, content: undefined };
  }
  const stackMode = node.stackMode?.name;
  if (stackMode === "VERTICAL" || stackMode === "HORIZONTAL") {
    const explicit = explicitFlexContext(node);
    return explicit;
  }
  if (inferred?.direction === "row" || inferred?.direction === "column") {
    return inferredFlexContext(node, inferred);
  }
  if (inferred?.direction === "inset") {
    return inferredInsetContext(node, inferred);
  }
  return { alignItems: undefined, content: undefined };
}

function explicitFlexContext(node: FigNode): {
  readonly alignItems: "stretch" | "flex-start" | "center" | "flex-end" | "baseline";
  readonly content: { readonly width: number; readonly height: number } | undefined;
} {
  const padTop = node.stackVerticalPadding ?? node.stackPadding ?? 0;
  const padLeft = node.stackHorizontalPadding ?? node.stackPadding ?? 0;
  const padRight = node.stackPaddingRight ?? padLeft;
  const padBottom = node.stackPaddingBottom ?? padTop;
  const align = stackCounterAlignToCss(node.stackCounterAlignItems?.name);
  const content = computeContentSize(node, padTop, padRight, padBottom, padLeft);
  return { alignItems: align, content };
}

function computeContentSize(
  node: FigNode,
  top: number,
  right: number,
  bottom: number,
  left: number,
): { readonly width: number; readonly height: number } | undefined {
  if (!node.size) {
    return undefined;
  }
  return { width: node.size.x - left - right, height: node.size.y - top - bottom };
}

function inferredFlexContext(
  node: FigNode,
  inferred: { readonly paddingTop: number; readonly paddingRight: number; readonly paddingBottom: number; readonly paddingLeft: number; readonly alignItems: "flex-start" | "center" | "flex-end" | "stretch" },
): {
  readonly alignItems: "stretch" | "flex-start" | "center" | "flex-end";
  readonly content: { readonly width: number; readonly height: number } | undefined;
} {
  const content = computeContentSize(
    node,
    inferred.paddingTop,
    inferred.paddingRight,
    inferred.paddingBottom,
    inferred.paddingLeft,
  );
  return { alignItems: inferred.alignItems, content };
}

function inferredInsetContext(
  node: FigNode,
  inferred: { readonly paddingTop: number; readonly paddingRight: number; readonly paddingBottom: number; readonly paddingLeft: number },
): {
  readonly alignItems: undefined;
  readonly content: { readonly width: number; readonly height: number } | undefined;
} {
  const content = computeContentSize(
    node,
    inferred.paddingTop,
    inferred.paddingRight,
    inferred.paddingBottom,
    inferred.paddingLeft,
  );
  return { alignItems: undefined, content };
}

/**
 * Translate Figma `stackCounterAlignItems` to CSS `alignItems`,
 * defaulting to `flex-start` (Figma's MIN default for counter axis)
 * when the field is absent.
 */
function stackCounterAlignToCss(name: string | undefined): "stretch" | "flex-start" | "center" | "flex-end" | "baseline" {
  switch (name) {
    case "STRETCH":
      return "stretch";
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "BASELINE":
      return "baseline";
    case "MIN":
    default:
      return "flex-start";
  }
}

/**
 * Merge absorbed-decoration style entries onto the parent's computed
 * style. Absorption replaces only entries the parent didn't already
 * set, so an explicit parent fill / radius / shadow always wins.
 */
function mergeAbsorbedStyle(
  base: Record<string, string>,
  absorbed: Record<string, string>,
): Record<string, string> {
  if (Object.keys(absorbed).length === 0) {
    return base;
  }
  const out: Record<string, string> = { ...absorbed, ...base };
  return out;
}

/**
 * Compute the layout regime children of `node` should be emitted
 * under. Inferred row/column inferences flip the parent's regime to
 * the corresponding flex axis so children land in flow order. Inferred
 * "inset" still flows the single child under flex semantics — CSS
 * `padding` alone would leave a static child fixed at (0,0), but a
 * flex parent makes the inferred padding work without explicit
 * positioning.
 */
function effectiveChildParentLayout(node: FigNode, inferred: InferenceResult): ParentLayout {
  if (inferred?.direction === "row") {
    return "flex-row";
  }
  if (inferred?.direction === "column") {
    return "flex-column";
  }
  if (inferred?.direction === "inset") {
    return "flex-row";
  }
  return parentLayoutOf(node);
}

function childrenForEmit(
  parent: FigNode,
  baseChildren: readonly FigNode[],
  inferred: InferenceResult,
): readonly FigNode[] {
  if (inferred?.direction === "row" || inferred?.direction === "column") {
    return inferred.orderedChildren.filter(isRendered);
  }
  // For explicit auto-layout (Figma `stackMode`) the source `children`
  // array is NOT guaranteed to be in flow order — image-to-fig and
  // similar tools sometimes emit siblings in z-order or arbitrary
  // sequence and rely on each child's stored `transform` to position
  // itself inside the layout. CSS flex emits children in DOM order,
  // so without sorting here the React render shows the right-side
  // section before the left-side section (and vice-versa). Sorting by
  // the primary-axis coordinate restores Figma's visible flow.
  const stack = parent.stackMode?.name;
  if (stack === "HORIZONTAL" || stack === "VERTICAL") {
    return sortChildrenByStackAxis(baseChildren, stack);
  }
  return baseChildren;
}

function sortChildrenByStackAxis(
  children: readonly FigNode[],
  stack: "HORIZONTAL" | "VERTICAL",
): readonly FigNode[] {
  const axis = stack === "HORIZONTAL" ? "m02" : "m12";
  return [...children].sort((a, b) => {
    const av = a.transform?.[axis] ?? 0;
    const bv = b.transform?.[axis] ?? 0;
    return av - bv;
  });
}

function emitLeafJsx(
  node: FigNode,
  context: EmitContext,
  style: Record<string, string>,
  baseProps: readonly JsxProp[],
): JsxNode {
  // Plain horizontal / vertical rules — but only when the layout
  // would otherwise collapse the SVG to zero pixels (flex children
  // with size.x or size.y = 0). `style.ts :: applyPlainRule` runs
  // in tandem and sets `background` *only* in the override case;
  // we use that as the signal so the absolute-positioned line
  // path (which the existing SVG `overflow:visible` trick already
  // handles correctly) doesn't get re-routed and pixel-shifted.
  if (style.background !== undefined && isPlainRule(node, context.index)) {
    return el("div", { props: [...baseProps, flagProp("aria-hidden")] });
  }
  if (isVectorShaped(node)) {
    const svg = emitVectorSvg(node, { source: context.source, index: context.index }, baseProps);
    if (svg) {
      return svg;
    }
    return el("div", { props: [...baseProps, flagProp("aria-hidden")] });
  }
  return el("div", { props: [...baseProps] });
}

function emitTextJsx(node: FigNode, context: EmitContext, options: EmitOptions): JsxNode {
  const { rootMode, parentLayout } = options;
  const style = nodeToStyle(node, styleInputsOf(context), rootMode, parentLayout, options.offsetBias, undefined, parentContextOf(options));
  const transform = transformForNode(node, rootMode, parentLayout);
  const dataAttrs = dataAttributes(node, context.debugAttrs);
  const baseProps: JsxProp[] = [...dataAttrs, styleAsProp(style, transform)];
  const characters = textCharacters(node);
  const runChildren = renderRunsBody(node, context, characters, style);
  if (runChildren !== undefined) {
    return el("span", { props: baseProps, children: runChildren, layout: "inline" });
  }
  const body = renderTextBody(node, context, characters);
  return el("span", { props: baseProps, children: [body], layout: "inline" });
}

/**
 * Build the JSX body of a TEXT span when the node carries
 * `styleOverrideTable` runs. Each run becomes its own child `<span>`
 * with only the *deviation* from the parent style — colour, font
 * family/style, font size, line-height, letter-spacing — set
 * inline. Properties the override doesn't touch fall through to the
 * outer span's typography token, so baseline cases (just a colour
 * change, just a font-weight bump) emit minimal style records.
 */
function renderRunsBody(
  node: FigNode,
  context: EmitContext,
  characters: string,
  baseStyle: Record<string, string>,
): readonly JsxNode[] | undefined {
  if (textCharsArePropBound(node, context)) {
    return undefined;
  }
  const runs = resolveTextRuns(node, context.index);
  if (runs.length <= 1 && !hasOverrides(runs)) {
    return undefined;
  }
  if (!hasOverrides(runs)) {
    return undefined;
  }
  const baseFamily = node.fontName?.family;
  const baseStyleName = node.fontName?.style;
  const baseFontSize = typeof node.fontSize === "number" ? node.fontSize : undefined;
  const segments: JsxNode[] = [];
  for (const run of runs) {
    const slice = characters.slice(run.start, run.end);
    if (slice.length === 0) {
      continue;
    }
    const runStyle = buildRunInlineStyle(run, {
      family: baseFamily,
      styleName: baseStyleName,
      fontSize: baseFontSize,
      baseColor: baseStyle.color,
    }, context);
    if (Object.keys(runStyle).length === 0) {
      segments.push(text(slice));
      continue;
    }
    segments.push(el("span", {
      props: [styleProp(runStyle)],
      children: [text(slice)],
      layout: "inline",
    }));
  }
  return segments;
}

function buildRunInlineStyle(
  run: { readonly color?: string; readonly fontFamily?: string; readonly fontStyle?: string; readonly fontSize?: number },
  base: { readonly family?: string; readonly styleName?: string; readonly fontSize?: number; readonly baseColor?: string },
  _context: EmitContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (run.color !== undefined && run.color !== base.baseColor) {
    out.color = run.color;
  }
  // Font family/style/size: when at least one differs from the base,
  // emit only the deltas so the run inherits everything else (line
  // height, letter spacing, family if unchanged) from the parent
  // span's typography token. We deliberately do not try to resolve
  // a fresh typography token here — the tokens index only matches
  // exact family+style+size+lineHeight+letterSpacing tuples and run
  // overrides commonly skip lineHeight/letterSpacing, so a strict
  // lookup would miss. Inline weights/sizes/families are correct
  // for any single-run deviation.
  if (run.fontFamily !== undefined && run.fontFamily !== base.family) {
    // Wrap the family in quotes so multi-word names render as a
    // single value. JSON-string escaping in the serializer keeps
    // any special character in the family name safe.
    out.fontFamily = `"${run.fontFamily.replace(/"/g, '\\"')}"`;
  }
  if (run.fontStyle !== undefined && run.fontStyle !== base.styleName) {
    const weight = fontStyleToWeight(run.fontStyle);
    if (weight !== undefined) {
      out.fontWeight = `${weight}`;
    }
    if (isItalicStyleName(run.fontStyle)) {
      out.fontStyle = "italic";
    }
  }
  if (run.fontSize !== undefined && run.fontSize !== base.fontSize) {
    out.fontSize = `${run.fontSize}px`;
  }
  return out;
}

const FONT_WEIGHT_BY_STYLE_NAME: ReadonlyMap<string, number> = new Map([
  ["thin", 100],
  ["extralight", 200],
  ["ultralight", 200],
  ["light", 300],
  ["regular", 400],
  ["normal", 400],
  ["medium", 500],
  ["semibold", 600],
  ["demibold", 600],
  ["bold", 700],
  ["extrabold", 800],
  ["ultrabold", 800],
  ["black", 900],
  ["heavy", 900],
]);

function fontStyleToWeight(styleName: string): number | undefined {
  const norm = styleName.toLowerCase().replace(/italic|oblique/g, "").replace(/[^a-z]/g, "");
  if (norm.length === 0) {
    return 400;
  }
  return FONT_WEIGHT_BY_STYLE_NAME.get(norm);
}

function isItalicStyleName(styleName: string): boolean {
  const lower = styleName.toLowerCase();
  return lower.includes("italic") || lower.includes("oblique");
}

function textCharsArePropBound(node: FigNode, context: EmitContext): boolean {
  const binding = context.propBindings.get(guidToString(node.guid));
  return binding?.field === "TEXT_DATA";
}

/**
 * Resolve the JSX body that fills a TEXT node.
 *
 * If the node is bound to a TEXT-typed component prop (via
 * `componentPropRefs[].componentPropNodeField === "TEXT_DATA"`), the
 * span renders the prop value at runtime and the SYMBOL-default
 * characters become the prop's default — the INSTANCE supplies the
 * real string.
 *
 * Otherwise the span renders the literal SYMBOL-default characters.
 */
function renderTextBody(node: FigNode, context: EmitContext, characters: string): JsxNode {
  const binding = context.propBindings.get(guidToString(node.guid));
  if (binding?.field === "TEXT_DATA") {
    return expr(propIdentForBinding(binding.decl.name));
  }
  return text(characters);
}

/**
 * Convert a Figma prop name to a JS identifier readable in JSX. The
 * result must match the destructure pattern `files.ts` chose for the
 * component signature (`jsIdentForKey` there). For anything that's
 * not a plain JS identifier, the destructure renames to a safe
 * camelCase form and uses the original key as a string property.
 */
function propIdentForBinding(name: string): string {
  if (name === "variant") {
    return "variant";
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    return name;
  }
  const camel = name
    .split(/[^A-Za-z0-9]+/)
    .filter((s) => s.length > 0)
    .map((s, i) => (i === 0 ? s.charAt(0).toLowerCase() : s.charAt(0).toUpperCase()) + s.slice(1).toLowerCase())
    .join("");
  return /^[0-9]/.test(camel) ? `p${camel}` : camel;
}

function emitInstanceJsx(node: FigNode, context: EmitContext, options: EmitOptions): JsxNode {
  const target = lookupInstanceTarget(context.source, context.registry, node);
  if (!target) {
    return emitContainerJsx(node, context, options);
  }

  const importPath = relativeImportPath(context.emittingFile, target.filePath);
  context.imports.set(target.componentName, importPath);

  const wrapStyle = nodeToStyle(node, styleInputsOf(context), options.rootMode, options.parentLayout, options.offsetBias, undefined, parentContextOf(options));
  const wrapTransform = transformForNode(node, options.rootMode, options.parentLayout);

  const variant = variantValueForInstance(context.source, context.registry, node);
  // INSTANCE-level paint overrides (Figma's `symbolOverrides` array)
  // re-colour individual children of the SYMBOL — the canonical case
  // is YouTube's Camera icon dropping a black-stroke SYMBOL onto the
  // dark Short page header where the overrides repaint it white.
  // Because the React emit shares one `<Component .../>` per SYMBOL,
  // we can't customise the inner paths per call site; we instead emit
  // the override as a CSS variable on the wrapper and rely on the
  // child path's `var(--token)` reference to inherit it. This works
  // when the override targets the same token as the SYMBOL's
  // authored paint (the common case for monochrome icon SYMBOLs);
  // mixed-token children quietly fall back to the SYMBOL default.
  const variantNode = pickVariantNode(target, variant);
  const overrideVars = resolveInstancePaintOverrides(node, variantNode ?? target.node, context);
  const mergedWrapStyle = Object.keys(overrideVars).length > 0 ? { ...wrapStyle, ...overrideVars } : wrapStyle;
  const wrapStyleProp = styleAsProp(mergedWrapStyle, wrapTransform);

  const componentProps: JsxProp[] = [];
  const variantProp = variantPropOf(variant);
  if (variantProp) {
    componentProps.push(variantProp);
  }
  for (const p of assignmentProps(node, target)) {
    componentProps.push(p);
  }

  const componentTag = el(target.componentName, { props: componentProps });

  // SYMBOLs render at their authored natural size; an INSTANCE that
  // resizes the symbol (Figma's standard scaling — e.g. a 127×28
  // logo dropped into a 90×20 slot) needs a CSS scale transform on
  // an inner wrapper so the rendered children shrink to fit instead
  // of overflowing the wrapper. We rely on the wrapper itself
  // having `overflow: visible` (the Figma default for INSTANCE) so
  // the scaled content paints at the wrapper's outer dimensions.
  const inner = wrapForScale(node, target, componentTag);

  const wrapperProps: JsxProp[] = [];
  if (context.debugAttrs && node.name) {
    wrapperProps.push(strProp("data-fig-instance", node.name));
  }
  wrapperProps.push(wrapStyleProp);
  return el("div", { props: wrapperProps, children: [inner], layout: "inline" });
}

/**
 * Pick the SYMBOL child a variant-set INSTANCE is rendering. For a
 * non-variant target the SYMBOL itself is the renderable; for a
 * variant set we look up by the resolved variant string. The
 * returned node is the right tree to walk for symbolOverride
 * targets — overrides reference variant-internal guids, not the
 * variant-set parent.
 */
function pickVariantNode(
  target: { readonly node: FigNode; readonly variants: ReadonlyMap<string, FigNode> },
  variant: string | undefined,
): FigNode | undefined {
  if (target.variants.size === 0) {
    return target.node;
  }
  if (variant === undefined) {
    return target.node;
  }
  return target.variants.get(variant);
}

/**
 * Resolve INSTANCE-level `symbolOverrides` into wrapper-level CSS
 * variable overrides. Each override that re-points a child's
 * stroke/fill style ID is converted to a `--<token>: <newColor>`
 * entry, where `<token>` is the CSS color token the SYMBOL's
 * authored paint maps to and `<newColor>` is the override paint's
 * resolved colour string. The Component's child path reads
 * `var(--<token>)`, so emitting the override on the wrapper makes
 * the CSS cascade hand it the new colour without forking the
 * Component file per call site.
 *
 * Limited scope: only SOLID overrides are supported (gradients /
 * images would need richer wrapper machinery), and only first-level
 * children are matched (deep guidPath chains aren't walked yet).
 * Anything we can't resolve cleanly is skipped — the SYMBOL's
 * default paint stays in place.
 */
function resolveInstancePaintOverrides(
  instance: FigNode,
  symbolBase: FigNode,
  context: EmitContext,
): Record<string, string> {
  const overrides = readSymbolOverrides(instance);
  if (overrides.length === 0) {
    return {};
  }
  const out: Record<string, string> = {};
  const registry = context.source.styleRegistry;
  for (const ov of overrides) {
    const guidPath = ov.guidPath?.guids;
    if (!guidPath || guidPath.length === 0) {
      continue;
    }
    const targetChild = findOverrideTarget(symbolBase, guidPath);
    if (!targetChild) {
      continue;
    }
    if (ov.styleIdForStrokeFill) {
      collectPaintOverride(targetChild.strokePaints, ov.styleIdForStrokeFill, registry, context, out);
    }
    if (ov.styleIdForFill) {
      collectPaintOverride(targetChild.fillPaints, ov.styleIdForFill, registry, context, out);
    }
    // Plain `fillPaints` overrides (no styleId indirection) re-paint
    // the child by literal paint array. Match against the target's
    // own `fillPaints` token so the wrapper var swap still works
    // when the SYMBOL's authored paint is already a SOLID we can
    // tokenise.
    if (ov.fillPaints && ov.fillPaints.length > 0) {
      collectPaintsOverride(targetChild.fillPaints, ov.fillPaints, context, out);
    }
  }
  return out;
}

function findOverrideTarget(
  base: FigNode,
  guidPath: ReadonlyArray<{ readonly sessionID: number; readonly localID: number }>,
): FigNode | undefined {
  // The mutable cursor is held in a const-bound ref struct so the
  // descent stays a flat loop without hitting the no-`let` rule.
  // `value: undefined` is the natural terminator when an intermediate
  // step's guid doesn't resolve under the current parent.
  const ref: { value: FigNode | undefined } = { value: base };
  for (const step of guidPath) {
    if (!ref.value) {
      return undefined;
    }
    ref.value = findChildByGuid(ref.value, step);
  }
  return ref.value;
}

function findChildByGuid(
  parent: FigNode,
  step: { readonly sessionID: number; readonly localID: number },
): FigNode | undefined {
  const targetStr = guidToString(step);
  for (const child of safeChildrenDomain(parent)) {
    if (guidToString(child.guid) === targetStr) {
      return child;
    }
  }
  return undefined;
}

function collectPaintOverride(
  originalPaints: readonly FigPaint[] | undefined,
  newStyleId: FigStyleId,
  registry: FigStyleRegistry,
  context: EmitContext,
  out: Record<string, string>,
): void {
  const newPaints = resolvePaintRef(newStyleId, registry);
  if (!newPaints || newPaints.length === 0) {
    return;
  }
  collectPaintsOverride(originalPaints, newPaints, context, out);
}

function collectPaintsOverride(
  originalPaints: readonly FigPaint[] | undefined,
  newPaints: readonly FigPaint[],
  context: EmitContext,
  out: Record<string, string>,
): void {
  if (!originalPaints || originalPaints.length === 0) {
    return;
  }
  const original = originalPaints.find((p) => p.visible !== false);
  const replacement = newPaints.find((p) => p.visible !== false);
  if (!original || !replacement) {
    return;
  }
  const originalToken = context.index.colorIdForPaint(original);
  if (!originalToken) {
    return;
  }
  const newColor = solidPaintToCss(replacement);
  if (!newColor) {
    return;
  }
  out[`--${originalToken}`] = newColor;
}

/**
 * Read a Kiwi enum's `.name` field. Raw fig nodes carry enum values
 * either as a serialised string or as a `{ value, name }` struct;
 * this helper converges both shapes onto the string `name` channel
 * with no implicit defaults.
 */
function readKiwiEnumName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { readonly name?: unknown }).name;
    if (typeof name === "string") {
      return name;
    }
  }
  return undefined;
}

function solidPaintToCss(paint: FigPaint): string | undefined {
  const rawType = (paint as { readonly type?: unknown }).type;
  const typeName = readKiwiEnumName(rawType);
  if (typeName !== "SOLID") {
    return undefined;
  }
  const solid = paint as { readonly color?: { readonly r: number; readonly g: number; readonly b: number; readonly a?: number }; readonly opacity?: number };
  const c = solid.color;
  if (!c) {
    return undefined;
  }
  const opacity = typeof solid.opacity === "number" ? solid.opacity : 1;
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  const a = (c.a ?? 1) * opacity;
  if (a >= 0.999) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

const SCALE_EPSILON = 1e-3;

/**
 * Apply a CSS `scale` to the symbol render only when the INSTANCE
 * is a *uniform* resize of the SYMBOL (both axes scaled by the same
 * factor — the Logo case, where a 127×28 symbol drops into a 90×20
 * slot). When the axes diverge (Pill SYMBOLs are 38×30 by default
 * but each INSTANCE adopts a wider content-driven width like 56×30
 * for "Mixes"), the divergent ratio means the INSTANCE is using
 * Figma's content-driven sizing — auto-resize on the inner TEXT —
 * and a CSS scale would horizontally stretch the bitmap, making
 * the text look blurry/oversized. Skip in that case and let the
 * symbol render at its authored natural size; the wrapper still
 * occupies the INSTANCE's authored width via the parent layout.
 */
function wrapForScale(
  instance: FigNode,
  target: { readonly node: FigNode; readonly variants: ReadonlyMap<string, FigNode> },
  componentTag: JsxNode,
): JsxNode {
  const symbolSize = naturalSymbolSize(instance, target);
  if (!symbolSize || !instance.size) {
    return componentTag;
  }
  if (symbolSize.x <= 0 || symbolSize.y <= 0) {
    return componentTag;
  }
  const sx = instance.size.x / symbolSize.x;
  const sy = instance.size.y / symbolSize.y;
  if (Math.abs(sx - 1) < SCALE_EPSILON && Math.abs(sy - 1) < SCALE_EPSILON) {
    return componentTag;
  }
  if (Math.abs(sx - sy) > SCALE_RATIO_TOLERANCE) {
    return componentTag;
  }
  const scaleStyle: Record<string, string> = {
    transform: `scale(${sx}, ${sy})`,
    transformOrigin: "top left",
    width: `${symbolSize.x}px`,
    height: `${symbolSize.y}px`,
  };
  return el("div", {
    props: [styleProp(scaleStyle)],
    children: [componentTag],
    layout: "inline",
  });
}

const SCALE_RATIO_TOLERANCE = 0.05;

function naturalSymbolSize(
  instance: FigNode,
  target: { readonly node: FigNode; readonly variants: ReadonlyMap<string, FigNode> },
): { readonly x: number; readonly y: number } | undefined {
  if (target.variants.size === 0) {
    return target.node.size ?? undefined;
  }
  const symbolGuid = (instance as { readonly symbolData?: { readonly symbolID?: { readonly sessionID: number; readonly localID: number } } }).symbolData?.symbolID;
  if (!symbolGuid) {
    return target.node.size ?? undefined;
  }
  const symbolGuidStr = guidToString(symbolGuid);
  for (const variant of target.variants.values()) {
    if (guidToString(variant.guid) === symbolGuidStr) {
      return variant.size ?? undefined;
    }
  }
  // Pick any variant's size as a fallback — better than not scaling.
  for (const variant of target.variants.values()) {
    if (variant.size) {
      return variant.size;
    }
  }
  return undefined;
}

/**
 * Convert an INSTANCE's `componentPropAssignments` array into JSX
 * prop attributes targeting the component's typed props.
 *
 * Each assignment is matched to a propDecl by `defID`. The literal
 * value flows through as a JSX prop — strings as `JsxProp.string`
 * (the serializer JSON-escapes), booleans / numbers as JSX
 * expressions. INSTANCE_SWAP referencing a runtime symbolID is
 * skipped because there is no clean React equivalent yet (a future
 * iteration would resolve to the component import).
 */
function assignmentProps(
  instance: FigNode,
  target: { readonly props: readonly { readonly defId: string; readonly name: string; readonly kind: string }[] },
): readonly JsxProp[] {
  const out: JsxProp[] = [];
  for (const a of instance.componentPropAssignments ?? []) {
    if (!a.defID) {
      continue;
    }
    const defIdStr = guidToString(a.defID);
    const decl = target.props.find((p) => p.defId === defIdStr);
    if (!decl) {
      continue;
    }
    const prop = formatAssignmentProp(decl, a.value);
    if (prop) {
      out.push(prop);
    }
  }
  // Walk `symbolData.symbolOverrides` for descendant text/visibility
  // overrides that no `componentPropDefs` slot covers. The registry
  // has already added a synthetic `string` decl for every TEXT
  // descendant (see `augmentWithImplicitTextProps`); here we match
  // each override's `guidPath` tail to that decl's defId and emit
  // the override value as a JSX attribute.
  for (const override of readSymbolOverrides(instance)) {
    const targetGuid = lastGuidOf(override);
    if (!targetGuid) {
      continue;
    }
    const defIdStr = `synthetic-text:${targetGuid}`;
    const decl = target.props.find((p) => p.defId === defIdStr);
    if (!decl) {
      continue;
    }
    const characters = override.textData?.characters;
    if (typeof characters !== "string") {
      continue;
    }
    out.push(strProp(decl.name, characters));
  }
  return out;
}

type SymbolOverride = {
  readonly guidPath?: { readonly guids?: readonly { readonly sessionID: number; readonly localID: number }[] };
  readonly textData?: { readonly characters?: string };
  readonly styleIdForStrokeFill?: FigStyleId;
  readonly styleIdForFill?: FigStyleId;
  readonly fillPaints?: readonly FigPaint[];
};

function readSymbolOverrides(instance: FigNode): readonly SymbolOverride[] {
  const sd = (instance as { readonly symbolData?: { readonly symbolOverrides?: readonly SymbolOverride[] } }).symbolData;
  return sd?.symbolOverrides ?? [];
}

function lastGuidOf(override: SymbolOverride): string | undefined {
  const guids = override.guidPath?.guids;
  if (!guids || guids.length === 0) {
    return undefined;
  }
  const last = guids[guids.length - 1];
  return guidToString(last);
}

function formatAssignmentProp(
  decl: { readonly name: string; readonly kind: string },
  value: { readonly textValue?: { readonly characters: string }; readonly boolValue?: boolean; readonly numberValue?: number; readonly floatValue?: number },
): JsxProp | undefined {
  switch (decl.kind) {
    case "string": {
      const chars = value.textValue?.characters;
      if (typeof chars !== "string") {
        return undefined;
      }
      return strProp(decl.name, chars);
    }
    case "boolean": {
      if (typeof value.boolValue !== "boolean") {
        return undefined;
      }
      return exprProp(decl.name, `${value.boolValue}`);
    }
    case "number": {
      const n = typeof value.numberValue === "number" ? value.numberValue : value.floatValue;
      if (typeof n !== "number") {
        return undefined;
      }
      return exprProp(decl.name, `${n}`);
    }
    case "variant":
      // Already handled via `variantPropOf` from the instance's
      // resolved SYMBOL — skip here to avoid double-emission.
      return undefined;
    default:
      return undefined;
  }
}

function transformForNode(
  node: FigNode,
  rootMode: RootMode | undefined,
  parentLayout: ParentLayout,
): string | undefined {
  if (rootMode !== undefined) {
    return undefined;
  }
  if (flowsInParent(parentLayout, node)) {
    return undefined;
  }
  return transformFromMatrix(node.transform);
}

function variantPropOf(variant: string | undefined): JsxProp | undefined {
  if (variant === undefined) {
    return undefined;
  }
  return strProp("variant", variant);
}

function flowsInParent(parent: ParentLayout, node: FigNode): boolean {
  if (parent !== "flex-row" && parent !== "flex-column") {
    return false;
  }
  return node.stackPositioning?.name !== "ABSOLUTE";
}

/**
 * Compute a relative TS-import specifier from `fromFile` to `toFile`.
 * Both paths are POSIX-style relative paths from the output root and
 * neither starts with `./`. The returned specifier is the form
 * TypeScript wants in `import` declarations and always starts with
 * `./` or `../`.
 */
function relativeImportPath(fromFile: string, toFile: string): string {
  const fromDir = fromFile.split("/").slice(0, -1);
  const toFileNoExt = toFile.replace(/\.tsx$/, "");
  const toParts = toFileNoExt.split("/");
  const sharedCount = countSharedPrefix(fromDir, toParts.slice(0, -1));
  const ascendCount = fromDir.length - sharedCount;
  const remaining = toParts.slice(sharedCount).join("/");
  const prefix = ascendCount === 0 ? "./" : "../".repeat(ascendCount);
  return `${prefix}${remaining}`;
}

function countSharedPrefix(a: readonly string[], b: readonly string[]): number {
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i = i + 1) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return max;
}

function dataAttributes(node: FigNode, debug: boolean): readonly JsxProp[] {
  if (!debug) {
    return [];
  }
  const out: JsxProp[] = [];
  if (node.name) {
    out.push(strProp("data-fig-name", node.name));
  }
  out.push(strProp("data-fig-type", node.type.name));
  return out;
}
