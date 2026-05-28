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
import type { FigColor, FigGuid, FigMatrix, FigNode, FigVariableID, FigSolidPaint } from "@higma-document-models/fig/types";
import { asImagePaint, asSolidPaint } from "@higma-document-models/fig/color";
import { kiwiEnumName } from "@higma-document-models/fig/constants";
import { figmaFontToQuery, isItalic } from "@higma-document-models/fig/font";
import type { TokenIndex } from "../../tokens";
import type { EmitRegistry } from "../types";
import type { ParentContext, ParentLayout, RootMode, StyleInputs } from "../style/style";
import { nodeToStyle, parentLayoutOf } from "../style/style";
import type { ImageElementEmission, ImageResolver } from "../style/paint";
import { imageElementForNode } from "../style/paint";
import { absorbBackgroundDecoration } from "../style/decoration";
import { isPlainRule } from "../style/rule";
import type { PropBindings } from "../plan/prop-bindings";
import { componentTargetForInstance, SYNTHETIC_TEXT_PREFIX, SYNTHETIC_VARIANT_PREFIX, variantValueForInstance } from "../plan/registry";
import type { FigDocumentContext } from "@higma-document-io/fig/context";
import { collectPathsFor, emitMergedVectorSvg, emitVectorSvg, isVectorOnlyContainer, isVectorShaped } from "../svg/svg";
import { hasOverrides, resolveTextRuns } from "../text/text-runs";
import type { InferenceResult } from "../layout/infer-layout";
import { inferLayout } from "../layout/infer-layout";
import { collapseChain } from "../layout/collapse";
import type { ReparentResult } from "../layout/reparent";
import { guidToString } from "@higma-document-models/fig/domain";
import { isVariantSetFrame } from "@higma-document-models/fig/symbols";
import type { FigPaint } from "@higma-document-models/fig/types";
import type { JsxNode, JsxProp } from "../../lib/jsx-tree/types";
import { el, expr, exprProp, flagProp, strProp, styleProp, text } from "../../lib/jsx-tree/builder";
import type { IconRegistry } from "../assets/icons";
import type { AssetStrategy } from "../orchestrate";
import { complexityScore } from "@higma-document-renderers/fig/asset-plan";
import { serializeSvgDocument } from "../style/strategy/svg-serialize";

const TEXT_NODE_TYPE = "TEXT";
const INSTANCE_NODE_TYPE = "INSTANCE";
const NON_RENDERED_TYPES: ReadonlySet<string> = new Set([
  "SLICE",
]);

export type EmitContext = {
  readonly source: FigDocumentContext;
  readonly registry: EmitRegistry;
  readonly index: TokenIndex;
  readonly imageResolver: ImageResolver;
  /**
   * Icon externalisation registry. Non-undefined iff
   * `assetStrategy === "externalize-complex"`. When present, the
   * vector-emit path consults `complexityScore` and registers the
   * SVG payload via this registry when the score crosses
   * `assetComplexityThreshold`.
   */
  readonly iconRegistry: IconRegistry | undefined;
  /**
   * Asset-output strategy. The JSX emitter inspects this in tandem
   * with `iconRegistry` so a present-but-unused registry doesn't
   * silently externalise icons in `"inline"` mode.
   */
  readonly assetStrategy: AssetStrategy;
  /**
   * Complexity threshold for vector externalisation. Same scorer as
   * `@higma-document-renderers/fig/asset-plan` consults; the JSX
   * emitter compares each candidate subtree against this value.
   */
  readonly assetComplexityThreshold: number;
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
  /**
   * The guid string of the source node whose body the current emit
   * pass is rendering (the FRAME for a page or the SYMBOL /
   * COMPONENT_SET for a component file). Used by the synthetic-prop
   * forwarding logic to tell SYMBOL-body emission ("forward the
   * outer prop into the inner INSTANCE") from per-call-site
   * emission ("bake the override character as a literal").
   */
  readonly emittingRootGuid: string;
  /**
   * For the currently-emitting SYMBOL body: map from inner-
   * descendant guid → number of distinct override values authored
   * by sibling INSTANCEs inside this SYMBOL body. When the count is
   * 1, all sibling INSTANCEs supply the same value and the SYMBOL's
   * own prop default captures it — inner-INSTANCE call sites can
   * safely forward the outer prop. When the count is ≥ 2, the
   * SYMBOL author wrote distinct sibling values and no single prop
   * can carry them all; inner-INSTANCE call sites emit literals.
   * Empty for pages and for SYMBOLs whose body has no authored
   * textData override.
   */
  readonly authoredTextOverrideDistinctValueCount: ReadonlyMap<string, number>;
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
    childrenOf: (node) => childrenOfEmitNode(node, context),
    textBoundGuids: textBoundGuidsOf(context.propBindings),
    imageFillOverrideTargets: context.registry.imageFillOverrideTargets,
    fontSizeOverrideTargets: context.registry.fontSizeOverrideTargets,
    visibleOverrideTargets: context.registry.visibleOverrideTargets,
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
 *
 * Soft line-break characters (U+2028 LINE SEPARATOR and U+2029
 * PARAGRAPH SEPARATOR) are folded to LF (U+000A) so CSS
 * `white-space: pre-line` honours them. Figma's editor records a
 * Shift-Enter as U+2028 (a Unicode line break), but browsers'
 * line-break heuristics ignore U+2028 inside a normal `<span>` —
 * the text would render on a single overflowing line even though
 * the author asked for a paragraph break. Normalising to LF here
 * is one place; the alternative (sprinkling `wordBreak` /
 * `whiteSpace: pre` rules) handles fewer cases and surfaces the
 * Unicode artefact in style instead of in the data.
 */
function textCharacters(node: FigNode): string {
  if (typeof node.textData?.characters === "string") {
    return normaliseSoftLineBreaks(node.textData.characters);
  }
  if (typeof node.characters === "string") {
    return normaliseSoftLineBreaks(node.characters);
  }
  return "";
}

function normaliseSoftLineBreaks(value: string): string {
  // Figma stores Shift-Enter soft breaks as U+2028 LINE SEPARATOR
  // (and U+2029 PARAGRAPH SEPARATOR for hard paragraph breaks).
  // Browser layout treats those as invisible whitespace that does
  // NOT trigger a line break inside white-space: pre-line, so we
  // normalise both to LF up-front. Fast-exit when neither is present
  // (the dominant case is plain text without soft breaks).
  if (value.indexOf("\u2028") < 0 && value.indexOf("\u2029") < 0) {
    return value;
  }
  return value.replace(/[\u2028\u2029]/g, "\n");
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

function childrenOfEmitNode(node: FigNode, context: EmitContext): readonly FigNode[] {
  const overlay = context.reparent.childrenByParent.get(guidToString(node.guid));
  if (overlay !== undefined) {
    return overlay;
  }
  return context.source.document.childrenOf(node);
}

function isRendered(node: FigNode): boolean {
  if (node.visible === false) {
    return false;
  }
  if (NON_RENDERED_TYPES.has(node.type.name)) {
    return false;
  }
  // Figma mask-children carry `mask: true`. They don't paint
  // themselves — they only clip their following siblings. The mask
  // application is handled by `applyMaskClipToFollowingSiblings`
  // before children are emitted; here we drop the mask from the
  // visible-children list so it never produces ink.
  if (isFigmaMaskNode(node)) {
    return false;
  }
  return true;
}

function isFigmaMaskNode(node: FigNode): boolean {
  return node.mask === true;
}

/**
 * When a container's children include a Figma mask vector
 * (`mask: true`), build the CSS `clip-path` value that confines the
 * remaining children to the mask's shape. Returns `undefined` when
 * no mask is present or the mask geometry is unreadable.
 *
 * The mask is reduced to ONE SVG path string in container-local
 * coordinates. The mask vector's own `transform` translates the
 * geometry into the container's coord space; we apply that
 * translation when building `M`/`L`/`C` commands so the
 * `clip-path: path(...)` value aligns with the children CSS layout.
 */
function computeFigmaMaskClipPath(
  children: readonly FigNode[],
  context: EmitContext,
): string | undefined {
  for (const child of children) {
    if (!isFigmaMaskNode(child)) {
      continue;
    }
    const paths = collectPathsFor(child, context.source.blobs);
    if (paths.length === 0) {
      continue;
    }
    const tx = child.transform?.m02 ?? 0;
    const ty = child.transform?.m12 ?? 0;
    const m00 = child.transform?.m00 ?? 1;
    const m01 = child.transform?.m01 ?? 0;
    const m10 = child.transform?.m10 ?? 0;
    const m11 = child.transform?.m11 ?? 1;
    const segments: string[] = [];
    for (const p of paths) {
      // `decodeBlobToSvgPath` (called by collectPathsFor) emits an
      // SVG `d` string in the mask vector's *own* coordinate space.
      // To apply it as `clip-path: path(...)` on the container we
      // need the path expressed in the container's coordinate
      // space. The cleanest way is `path("M(...) ...")` with the
      // child's affine applied per command.
      const translated = applyAffineToSvgPathD(p.d, m00, m01, m10, m11, tx, ty);
      if (translated) {
        segments.push(translated);
      }
    }
    if (segments.length === 0) {
      continue;
    }
    return `path('${segments.join(" ")}')`;
  }
  return undefined;
}

/**
 * Apply a 2x3 affine transform to an SVG path-`d` string by
 * mapping each absolute command's anchor points through the
 * transform. Supports M / L / H / V / C / Q / S / T / Z (the set
 * Figma's exporter actually emits via `decodeBlobToSvgPath`).
 */
function applyAffineToSvgPathD(
  d: string,
  m00: number,
  m01: number,
  m10: number,
  m11: number,
  tx: number,
  ty: number,
): string {
  const map = (x: number, y: number): { x: number; y: number } => ({
    x: m00 * x + m01 * y + tx,
    y: m10 * x + m11 * y + ty,
  });
  const tokens = d.match(/[MLHVCQSTAZmlhvcqstaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: string[] = [];
  let i = 0;
  let cmd = "";
  while (i < tokens.length) {
    const tk = tokens[i]!;
    if (/[A-Za-z]/.test(tk)) {
      cmd = tk;
      out.push(tk);
      i += 1;
      if (cmd === "Z" || cmd === "z") {
        continue;
      }
      continue;
    }
    // numeric token: handle the current command's parameter set
    const upper = cmd.toUpperCase();
    if (upper === "M" || upper === "L" || upper === "T") {
      const x = Number(tokens[i]!);
      const y = Number(tokens[i + 1]!);
      const p = map(x, y);
      out.push(`${formatPathNum(p.x)} ${formatPathNum(p.y)}`);
      i += 2;
    } else if (upper === "H") {
      const x = Number(tokens[i]!);
      const p = map(x, 0); // no y-axis info in H — assume 0 (will be wrong for non-identity rotation; OK for Figma's mask translations)
      out.push(`${formatPathNum(p.x)}`);
      i += 1;
    } else if (upper === "V") {
      const y = Number(tokens[i]!);
      const p = map(0, y);
      out.push(`${formatPathNum(p.y)}`);
      i += 1;
    } else if (upper === "C") {
      const x1 = Number(tokens[i]!);
      const y1 = Number(tokens[i + 1]!);
      const x2 = Number(tokens[i + 2]!);
      const y2 = Number(tokens[i + 3]!);
      const x = Number(tokens[i + 4]!);
      const y = Number(tokens[i + 5]!);
      const p1 = map(x1, y1);
      const p2 = map(x2, y2);
      const p = map(x, y);
      out.push(`${formatPathNum(p1.x)} ${formatPathNum(p1.y)} ${formatPathNum(p2.x)} ${formatPathNum(p2.y)} ${formatPathNum(p.x)} ${formatPathNum(p.y)}`);
      i += 6;
    } else if (upper === "Q" || upper === "S") {
      const x1 = Number(tokens[i]!);
      const y1 = Number(tokens[i + 1]!);
      const x = Number(tokens[i + 2]!);
      const y = Number(tokens[i + 3]!);
      const p1 = map(x1, y1);
      const p = map(x, y);
      out.push(`${formatPathNum(p1.x)} ${formatPathNum(p1.y)} ${formatPathNum(p.x)} ${formatPathNum(p.y)}`);
      i += 4;
    } else if (upper === "A") {
      // Arc command — preserve rx, ry, rotation, large-arc, sweep
      // flags verbatim and transform only the end point. This is
      // imperfect under shear/scale but matches the common case
      // (pure translation) Figma masks use.
      const rx = Number(tokens[i]!);
      const ry = Number(tokens[i + 1]!);
      const rot = Number(tokens[i + 2]!);
      const largeArc = Number(tokens[i + 3]!);
      const sweep = Number(tokens[i + 4]!);
      const x = Number(tokens[i + 5]!);
      const y = Number(tokens[i + 6]!);
      const p = map(x, y);
      out.push(`${formatPathNum(rx)} ${formatPathNum(ry)} ${formatPathNum(rot)} ${largeArc} ${sweep} ${formatPathNum(p.x)} ${formatPathNum(p.y)}`);
      i += 7;
    } else {
      // Unknown — copy through.
      out.push(tk);
      i += 1;
    }
  }
  return out.join(" ");
}

function formatPathNum(n: number): string {
  if (!Number.isFinite(n)) {
    return "0";
  }
  return Math.round(n * 1000) / 1000 + "";
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
  for (const child of childrenOfEmitNode(node, context)) {
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
  const effective = collapseForEmit(node, context, options);
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

function collapseForEmit(node: FigNode, context: EmitContext, options: EmitOptions): CollapsedNode {
  if (options.rootMode !== undefined) {
    return { node, offsetX: 0, offsetY: 0 };
  }
  return collapseChain(node, options.parentLayout, (candidate) => childrenOfEmitNode(candidate, context));
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

function nodeHasOwnFillGeometry(node: FigNode): boolean {
  return Array.isArray(node.fillGeometry) && node.fillGeometry.length > 0;
}

function emitVectorLeafJsx(
  node: FigNode,
  context: EmitContext,
  options: EmitOptions,
  dataAttrs: readonly JsxProp[],
): JsxNode {
  const svgStyle = nodeToStyle(
    node,
    styleInputsOf(context),
    options.rootMode,
    options.parentLayout,
    options.offsetBias,
    undefined,
    parentContextOf(options),
  );
  const transform = transformForNode(node, options.rootMode);
  const baseProps: JsxProp[] = [...dataAttrs, styleAsProp(svgStyle, transform)];
  const svg = emitVectorSvg(
    node,
    { source: context.source, index: context.index, childrenOf: (candidate) => childrenOfEmitNode(candidate, context), imageResolver: context.imageResolver },
    baseProps,
  );
  if (svg !== undefined) {
    return svg;
  }
  return el("div", { props: baseProps });
}

function emitVectorOnlyContainerJsx(
  node: FigNode,
  context: EmitContext,
  options: EmitOptions,
  dataAttrs: readonly JsxProp[],
): JsxNode | undefined {
  if (options.rootMode !== undefined) {
    return undefined;
  }
  const childrenOf = (candidate: FigNode): readonly FigNode[] => childrenOfEmitNode(candidate, context);
  if (!isVectorOnlyContainer(node, childrenOf)) {
    return undefined;
  }
  const svgStyle = nodeToStyle(
    node,
    styleInputsOf(context),
    options.rootMode,
    options.parentLayout,
    options.offsetBias,
    undefined,
    parentContextOf(options),
  );
  const transform = transformForNode(node, options.rootMode);
  const wrapperProps: JsxProp[] = [...dataAttrs];
  wrapperProps.push(styleAsProp(svgStyle, transform));
  const merged = emitMergedVectorSvg(node, { source: context.source, index: context.index, childrenOf, imageResolver: context.imageResolver }, wrapperProps);
  if (merged === undefined) {
    return undefined;
  }
  // Icon externalisation: when the subtree's complexity score
  // crosses the configured threshold AND the consumer asked for
  // `externalize-complex`, write the SVG to `assets/icons/<slug>.svg`
  // and replace the inline `<svg>` JSX with an `<img>` reference.
  // Inline mode (or sub-threshold complexity) keeps the previous
  // behaviour of emitting the SVG inline.
  const externalized = maybeExternalizeIcon(merged, node, context, svgStyle, transform);
  if (externalized !== undefined) {
    return externalized;
  }
  return merged;
}

function emitContainerJsx(node: FigNode, context: EmitContext, options: EmitOptions): JsxNode {
  const { rootMode, parentLayout } = options;
  const dataAttrs = dataAttributes(node, context.debugAttrs);

  // BOOLEAN_OPERATION nodes (UNION / SUBTRACT / INTERSECT / EXCLUDE)
  // carry `fillGeometry` for the resolved boolean result; rendering
  // them as flex containers wrapped around their authored children
  // (e.g. the three rectangles in the hamburger glyph) would
  // re-layout the bars and discard the boolean-merged shape. When
  // such a node has fillGeometry of its own, route through the
  // single-vector emit path so the merged path lands in one <svg>.
  if (rootMode === undefined && nodeHasOwnFillGeometry(node) && isVectorShaped(node)) {
    return emitVectorLeafJsx(node, context, options, dataAttrs);
  }

  // Vector-only container collapse: a plain container whose entire
  // subtree is composed of vector shapes becomes one merged SVG. The
  // merged SVG's `<path transform="translate(...)">` already encodes
  // each vector's offset relative to the container, so we deliberately
  // do NOT run `inferLayout` here — that would double-emit the offset
  // as `padding` on the SVG element. The container's own style is
  // therefore computed without an inference result.
  const vectorOnlyContainer = emitVectorOnlyContainerJsx(node, context, options, dataAttrs);
  if (vectorOnlyContainer !== undefined) {
    return vectorOnlyContainer;
  }

  // Background-decoration absorption: a full-bleed first child becomes
  // part of the parent's `background*` style and is dropped from
  // children emission. The decoration's removal often unlocks layout
  // inference on the remaining children — what was a 2-child overlap
  // pattern becomes a 1-child inset pattern.
  const absorbed = absorbBackgroundDecoration(node, styleInputsOf(context));
  const rawChildren = childrenOfEmitNode(node, context);
  const baseChildren = rawChildren
    .filter(isRendered)
    .filter((c) => c !== absorbed.absorbed);
  const inferred = inferLayout(node, baseChildren);

  const computedStyle = nodeToStyle(node, styleInputsOf(context), rootMode, parentLayout, options.offsetBias, inferred, parentContextOf(options));
  // Figma mask-child support: when the container's children include
  // a node with `mask: true`, the mask vector's fillGeometry defines
  // a clip applied to the remaining children. Emit it as CSS
  // `clip-path: path('M...')` on the container so the photo
  // clipped into a parallelogram (about-desktop "Mask group") shows
  // the right shape instead of the full image rectangle.
  const maskClipPath = computeFigmaMaskClipPath(rawChildren, context);
  const baseStyle = mergeAbsorbedStyle(
    maskClipPath !== undefined ? { ...computedStyle, clipPath: maskClipPath } : computedStyle,
    absorbed.style,
  );
  const transform = transformForNode(node, rootMode);

  // Structural image emission: when `paint.transform` carries
  // rotation / skew that `background-image` cannot express, the paint
  // resolver returns an `<img>` element instead and we host it as the
  // first child of this container. `overflow: hidden` clips the image
  // to the node's box (including its `borderRadius`); `position` is
  // forced to a non-`static` value so the absolutely-positioned `<img>`
  // is laid out against this container, not an ancestor.
  const imageBody = imageElementChildFor(node, context);
  const style = withStructuralImageContainer(baseStyle, imageBody);

  const orderedChildren = childrenForEmit(node, baseChildren, inferred);
  const props: JsxProp[] = [...dataAttrs];
  props.push(styleAsProp(style, transform));
  if (orderedChildren.length === 0 && imageBody === undefined) {
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
  const finalChildren = imageBody === undefined ? children : [imageBody, ...children];
  return el("div", { props, children: finalChildren, layout: "block" });
}

/**
 * Build the structural `<img>` JsxNode for a node's image paint when
 * the paint's `transform` carries rotation / skew (and therefore can
 * not be expressed via `background-image` + `background-size` /
 * `-position`). Returns `undefined` for nodes whose image paints all
 * map cleanly to CSS background shorthand.
 */
function imageElementChildFor(node: FigNode, context: EmitContext): JsxNode | undefined {
  const paints = node.fillPaints ?? node.backgroundPaints;
  const emission = imageElementForNode(paints, context.imageResolver, nodeSizeForStructuralImage(node));
  if (emission === undefined) {
    return undefined;
  }
  return renderImageElementEmission(emission);
}

function renderImageElementEmission(emission: ImageElementEmission): JsxNode {
  return el("img", {
    props: [
      strProp("src", emission.src),
      strProp("alt", emission.altText),
      styleProp(emission.imgStyle),
    ],
  });
}

function nodeSizeForStructuralImage(node: FigNode): { readonly width: number; readonly height: number } | undefined {
  const size = node.size;
  if (size === undefined) {
    return undefined;
  }
  if (size.x <= 0 || size.y <= 0) {
    return undefined;
  }
  return { width: size.x, height: size.y };
}

/**
 * Adjust the container style for a structural image emission. The
 * `<img>` is positioned absolute at `(0, 0)` and then transformed; the
 * container therefore needs a positioning context and explicit clipping
 * so the image stays inside the node's bounds (including its
 * `borderRadius`). Unchanged when no structural emission applies.
 */
function withStructuralImageContainer(
  style: Record<string, string>,
  imageBody: JsxNode | undefined,
): Record<string, string> {
  if (imageBody === undefined) {
    return style;
  }
  const next: Record<string, string> = { ...style };
  if (next.position !== "absolute" && next.position !== "fixed" && next.position !== "sticky") {
    next.position = "relative";
  }
  next.overflow = "hidden";
  return next;
}

/**
 * Decide whether to externalise the merged-vector SVG subtree as a
 * standalone `.svg` asset. Returns the replacement `<img>` JsxNode
 * when externalisation applies, or `undefined` to keep the inline
 * `<svg>`.
 *
 * The decision walks two gates:
 *
 *   1. The consumer must have asked for `externalize-complex` AND
 *      the context must carry an `iconRegistry` (the orchestrator
 *      only instantiates one for that mode). If either is missing,
 *      the subtree stays inline.
 *
 *   2. `complexityScore(node, { blobs })` must cross
 *      `assetComplexityThreshold`. Subtrees below the threshold
 *      stay inline so simple icons (a few path commands) don't
 *      generate a separate file — the bundler overhead outweighs the
 *      JS size win for small icons.
 *
 * When both gates pass the routine:
 *   - serialises the SVG JsxNode subtree to standalone XML via
 *     `serializeSvgDocument`,
 *   - registers it with `iconRegistry.register(node, svgText)`,
 *   - emits a `<img>` element carrying the same wrapper style
 *     (position / size / transform) as the SVG it replaces so the
 *     surrounding layout is unaffected by the swap.
 */
function maybeExternalizeIcon(
  merged: JsxNode,
  node: FigNode,
  context: EmitContext,
  svgStyle: Record<string, string>,
  transform: string | undefined,
): JsxNode | undefined {
  if (context.assetStrategy !== "externalize-complex" || !context.iconRegistry) {
    return undefined;
  }
  if (merged.kind !== "element" || merged.tag !== "svg") {
    // `emitMergedVectorSvg` is the single SoT producer for merged
    // vector containers; its contract is "returns an `<svg>` element
    // or `undefined`". A non-`<svg>` element here means that
    // contract was violated upstream — silently keeping the content
    // inline would hide the breakage. Throw per the fail-fast
    // policy so the caller has to address the producer.
    throw new Error(
      `icons: emitMergedVectorSvg returned a non-<svg> root for node ${guidToString(node.guid)} — refusing to externalise.`,
    );
  }
  const score = complexityScore(node, {
    blobs: context.source.blobs,
    childrenOf: (candidate) => childrenOfEmitNode(candidate, context),
  });
  if (score < context.assetComplexityThreshold) {
    return undefined;
  }
  // Externalisation derives the slug AND the `<img alt>` from the
  // Figma layer name. A blank name is a contract violation upstream
  // — the registry throws on it, but we narrow the variable here so
  // the alt-text prop carries the same validated string without an
  // implicit `?? ""` fallback (fail-fast policy).
  const name = requireNodeName(node, "icons: cannot externalise vector");
  const svgText = serializeSvgDocument(merged);
  const relativePath = context.iconRegistry.register(node, svgText);
  const imgProps: JsxProp[] = [
    strProp("src", relativePath),
    strProp("alt", name),
    styleAsProp(svgStyle, transform),
  ];
  return el("img", { props: imgProps });
}

/**
 * Return the node's authored layer name as a non-empty string. The
 * registry path and the `<img alt>` attribute both depend on this
 * value, and the data contract is that every Figma node carrying
 * vector content was authored with a layer name (Figma auto-
 * generates "Vector" / "Frame 24" if the designer leaves it blank).
 * Empty or whitespace-only means something upstream stripped data
 * the contract requires — throw so the caller has to fix the source
 * rather than silently substitute a guid-derived stand-in.
 */
function requireNodeName(node: FigNode, contextMessage: string): string {
  const name = node.name;
  if (!name || name.trim().length === 0) {
    throw new Error(
      `${contextMessage}: node ${guidToString(node.guid)} has no usable layer name. ` +
      `The authored Figma name is required; inspect the source .fig file.`,
    );
  }
  return name;
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
    return emitVectorShapeJsx(node, context, baseProps);
  }
  return el("div", { props: [...baseProps] });
}

function emitVectorShapeJsx(node: FigNode, context: EmitContext, baseProps: readonly JsxProp[]): JsxNode {
  const svg = emitVectorSvg(node, {
    source: context.source,
    index: context.index,
    childrenOf: (candidate) => childrenOfEmitNode(candidate, context),
  }, baseProps);
  if (svg !== undefined) {
    return svg;
  }
  return el("div", { props: [...baseProps, flagProp("aria-hidden")] });
}

function emitTextJsx(node: FigNode, context: EmitContext, options: EmitOptions): JsxNode {
  const { rootMode, parentLayout } = options;
  const style = nodeToStyle(node, styleInputsOf(context), rootMode, parentLayout, options.offsetBias, undefined, parentContextOf(options));
  const transform = transformForNode(node, rootMode);
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

type RunInlineStyleSource = {
  readonly color?: string;
  readonly fontFamily?: string;
  readonly fontStyle?: string;
  readonly fontSize?: number;
};

type RunInlineStyleBase = {
  readonly family?: string;
  readonly styleName?: string;
  readonly fontSize?: number;
  readonly baseColor?: string;
};

function buildRunInlineStyle(run: RunInlineStyleSource, base: RunInlineStyleBase, _context: EmitContext): Record<string, string> {
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
  applyRunFontStyle(out, run, base);
  if (run.fontSize !== undefined && run.fontSize !== base.fontSize) {
    out.fontSize = `${run.fontSize}px`;
  }
  return out;
}

function applyRunFontStyle(out: Record<string, string>, run: RunInlineStyleSource, base: RunInlineStyleBase): void {
  const fontStyle = run.fontStyle;
  if (fontStyle === undefined || fontStyle === base.styleName) {
    return;
  }
  // SoT: weight + style detection routes through `figmaFontToQuery`
  // so per-run overrides match cache keys / resolver lookups
  // elsewhere. `figmaFontToQuery` requires a non-empty `family`
  // structurally; we use the run's family (or the base, or an
  // empty placeholder) — none of those affect the detected
  // numeric weight or italic style which is what we read.
  const query = figmaFontToQuery({
    family: run.fontFamily ?? base.family ?? "",
    style: fontStyle,
  });
  out.fontWeight = `${query.weight}`;
  if (!isItalic(fontStyle)) {
    return;
  }
  out.fontStyle = "italic";
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
  const target = componentTargetForInstance(context.source, context.registry, node);
  if (!target) {
    return emitContainerJsx(node, context, options);
  }
  const resolved = resolvedInstanceForComponent(node, context);

  const importPath = relativeImportPath(context.emittingFile, target.filePath);
  context.imports.set(target.componentName, importPath);

  const wrapStyle = nodeToStyle(node, styleInputsOf(context), options.rootMode, options.parentLayout, options.offsetBias, undefined, parentContextOf(options));
  const wrapTransform = transformForNode(node, options.rootMode);

  const variant = variantValueForInstance(context.source, context.registry, node);
  const overrideVars = resolveInstancePaintOverrides(resolved.effectiveSymbol, resolved.resolvedChildren, context);
  const mergedWrapStyle = mergeInstanceWrapperStyle(wrapStyle, overrideVars);
  // Clip the wrapper when the INSTANCE is authored at a non-uniform
  // size relative to its SYMBOL — Figma cannot scale that case
  // (different x/y ratios), so its export crops the content to the
  // INSTANCE bounds (the about-desktop Management block is a 680×16
  // crop of a much taller block-features SYMBOL; without clipping
  // the inner heading and body text overflow and paint over the
  // sibling layers below). Uniform scaling stays on the visible
  // path so `wrapForScale`'s transformed wrapper still paints
  // outside its own bounds.
  applyInstanceClipIfTruncated(node, context, mergedWrapStyle);
  const wrapStyleProp = styleAsProp(mergedWrapStyle, wrapTransform);

  const componentProps: JsxProp[] = [];
  // Variant-prop forwarding: when the outer component the body
  // currently belongs to declares a synthetic-variant prop for this
  // INSTANCE's guid, forward that prop into the inner component so
  // outer call sites can swap the variant. Otherwise emit the
  // resolved variant value as a string literal.
  const guidStr = guidToString(node.guid);
  const outerVariantBinding = context.propBindings.get(guidStr);
  const outerHasSyntheticVariant =
    outerVariantBinding?.field === "OVERRIDDEN_SYMBOL_ID" && outerVariantBinding.decl.kind === "variant";
  if (outerHasSyntheticVariant) {
    componentProps.push(exprProp("variant", propIdentForBinding(outerVariantBinding.decl.name)));
  } else {
    const variantProp = variantPropOf(variant);
    if (variantProp) {
      componentProps.push(variantProp);
    }
  }
  for (const p of assignmentProps(node, target, resolved, context)) {
    componentProps.push(p);
  }
  appendCallSiteSyntheticVariantProps(componentProps, target.props, node, context, variant);

  const componentTag = el(target.componentName, { props: componentProps });

  // SYMBOLs render at their authored natural size; an INSTANCE that
  // resizes the symbol (Figma's standard scaling — e.g. a 127×28
  // logo dropped into a 90×20 slot) needs a CSS scale transform on
  // an inner wrapper so the rendered children shrink to fit instead
  // of overflowing the wrapper. We rely on the wrapper itself
  // having `overflow: visible` (the Figma default for INSTANCE) so
  // the scaled content paints at the wrapper's outer dimensions.
  const inner = wrapForScale(node, context, componentTag);

  const wrapperProps: JsxProp[] = [];
  if (context.debugAttrs && node.name) {
    wrapperProps.push(strProp("data-fig-instance", node.name));
  }
  wrapperProps.push(wrapStyleProp);
  return el("div", { props: wrapperProps, children: [inner], layout: "inline" });
}

type ResolvedInstanceForEmit = {
  readonly effectiveSymbol: FigNode;
  readonly resolvedChildren: readonly FigNode[];
};

function resolvedInstanceForComponent(instance: FigNode, context: EmitContext): ResolvedInstanceForEmit {
  const resolvedTarget = context.source.symbolResolver.resolveReferences(instance).effectiveSymbol;
  if (resolvedTarget === undefined) {
    throw new Error(`fig-to-web: INSTANCE ${guidToString(instance.guid)} has no SymbolResolver target`);
  }
  const resolved = context.source.symbolResolver.resolveInstance(instance);
  return { effectiveSymbol: resolvedTarget.node, resolvedChildren: resolved.children };
}

function mergeInstanceWrapperStyle(
  base: Record<string, string>,
  overrideVars: Record<string, string>,
): Record<string, string> {
  if (Object.keys(overrideVars).length === 0) {
    return base;
  }
  return { ...base, ...overrideVars };
}

function resolveInstancePaintOverrides(
  symbolBase: FigNode,
  resolvedChildren: readonly FigNode[],
  context: EmitContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  // Shallow scope: paint / image / fontSize overrides only fire on
  // descendants the outer SYMBOL body authored directly. Going deeper
  // would let paint changes on nested INSTANCE descendants bubble up
  // their token-level CSS vars (e.g. `--color-base-text`) onto the
  // outer wrapper, where they bleed across the entire subtree.
  const baseByGuid = symbolDescendantsByGuid(symbolBase, context.source.document.childrenOf);
  // Deep scope: visible-override detection has to reach descendants
  // inside nested INSTANCE bodies because the override path is
  // typically two levels deep (footer → footer-parts-bread → TEXT).
  // The wrapper variable `--vis-<guid>` is guid-specific, so deep
  // emission can't leak across siblings.
  const deepBaseByGuid = symbolDescendantsByGuidScoped(
    symbolBase,
    context.source.document.childrenOf,
    context.source.document,
  );
  visitResolvedInstanceChildren(resolvedChildren, context, (resolvedNode) => {
    const shallowBase = baseByGuid.get(guidToString(resolvedNode.guid));
    if (shallowBase !== undefined) {
      collectChangedPaints(shallowBase, resolvedNode, context, out);
      collectImageFillOverride(resolvedNode, context, out);
      collectFontSizeOverride(shallowBase, resolvedNode, context, out);
    }
    const deepBase = deepBaseByGuid.get(guidToString(resolvedNode.guid));
    if (deepBase !== undefined) {
      collectVisibleOverride(deepBase, resolvedNode, context, out);
    }
  });
  return out;
}

/**
 * Emit `--vis-<guid>: none` on the wrapper when the resolved
 * descendant is hidden (`visible: false`) but the SYMBOL author
 * left it visible. The SYMBOL body picks this up via
 * `display: var(--vis-<guid>, ...)` and the slot vanishes — the
 * card-news photo rectangle in the validation file's news cards
 * without a photo is the motivating case.
 */
function collectVisibleOverride(
  baseNode: FigNode,
  resolvedNode: FigNode,
  context: EmitContext,
  out: Record<string, string>,
): void {
  const guidStr = guidToString(resolvedNode.guid);
  if (!context.registry.visibleOverrideTargets.has(guidStr)) {
    return;
  }
  if (resolvedNode.visible !== false) {
    return;
  }
  if (baseNode.visible === false) {
    // The SYMBOL author already hid this descendant; no per-call-site
    // override needed.
    return;
  }
  out[`--vis-${resolvedNode.guid.sessionID}-${resolvedNode.guid.localID}`] = "none";
}

/**
 * When the resolved TEXT's `fontSize` differs from the SYMBOL
 * author's value, emit `--fs-<guid>: <Npx>` on the wrapper. The
 * SYMBOL body's TEXT emit reads through `var(--fs-<guid>, default)`
 * (registered via `fontSizeOverrideTargets` in the document scan)
 * and picks up the per-instance value. Without this, a breakpoint-
 * scaled INSTANCE renders at the SYMBOL author's size instead of
 * the size Figma actually rasterised at.
 */
function collectFontSizeOverride(
  baseNode: FigNode,
  resolvedNode: FigNode,
  context: EmitContext,
  out: Record<string, string>,
): void {
  if (resolvedNode.type?.name !== "TEXT") {
    return;
  }
  const guidStr = guidToString(resolvedNode.guid);
  if (!context.registry.fontSizeOverrideTargets.has(guidStr)) {
    return;
  }
  const resolvedSize = resolvedNode.fontSize;
  if (typeof resolvedSize !== "number") {
    return;
  }
  const baseSize = baseNode.fontSize;
  if (typeof baseSize === "number" && Math.abs(baseSize - resolvedSize) < 0.5) {
    return;
  }
  out[`--fs-${resolvedNode.guid.sessionID}-${resolvedNode.guid.localID}`] = `${resolvedSize}px`;
  // Line-height scales alongside font-size whenever the SYMBOL stored
  // it as a multiplier / PERCENT (the validation file's BlockFeatures
  // heading goes 32 px / 48 px → 42 px / 63 px at the breakpoint-
  // scaled INSTANCE). Read the resolved baseline stride directly
  // because Figma's exporter pre-bakes the multiplier into
  // `derivedTextData.baselines[*].lineHeight`.
  const resolvedLh = resolvedNode.derivedTextData?.baselines?.[0]?.lineHeight;
  if (typeof resolvedLh === "number" && resolvedLh > 0) {
    const baseLh = baseNode.derivedTextData?.baselines?.[0]?.lineHeight;
    if (typeof baseLh !== "number" || Math.abs(baseLh - resolvedLh) >= 0.5) {
      out[`--lh-${resolvedNode.guid.sessionID}-${resolvedNode.guid.localID}`] = `${resolvedLh}px`;
    }
  }
}

/**
 * When the resolved descendant has an IMAGE fill paint and its guid
 * is in the document's image-fill override target set, emit a CSS
 * variable on the wrapper that supplies the image URL. The SYMBOL
 * body uses `background: var(--bg-<guid>, <default>)` so the
 * resulting wrapper-style + inner-style chain delivers the photo
 * to the right descendant box.
 */
function collectImageFillOverride(
  resolvedNode: FigNode,
  context: EmitContext,
  out: Record<string, string>,
): void {
  const guidStr = guidToString(resolvedNode.guid);
  if (!context.registry.imageFillOverrideTargets.has(guidStr)) {
    return;
  }
  const paints = resolvedNode.fillPaints;
  if (!paints || paints.length === 0) {
    return;
  }
  const imagePaint = findFirstImagePaint(paints);
  if (imagePaint === undefined) {
    return;
  }
  const src = context.imageResolver(imagePaint);
  if (!src) {
    return;
  }
  out[`--bg-${resolvedNode.guid.sessionID}-${resolvedNode.guid.localID}`] = `url("${src}")`;
}

function findFirstImagePaint(paints: readonly FigPaint[]): ReturnType<typeof asImagePaint> {
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    const image = asImagePaint(paint);
    if (image !== undefined) {
      return image;
    }
  }
  return undefined;
}

function symbolDescendantsByGuid(
  root: FigNode,
  childrenOf: (node: FigNode) => readonly FigNode[],
): ReadonlyMap<string, FigNode> {
  return symbolDescendantsByGuidScoped(root, childrenOf, undefined);
}

type SymbolGraphDoc = {
  readonly nodesByGuid: ReadonlyMap<string, FigNode>;
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
};

/**
 * Index every descendant of `root` by guid, including descendants
 * inside nested INSTANCE bodies. Without the cross-instance hop,
 * `baseByGuid` lookups for a TEXT inside an inner SYMBOL (e.g.
 * icon-item's button-primary INSTANCE → its inner TEXT 66:387) fall
 * back to the materialised resolved node, which obscures whether a
 * given INSTANCE actually overrode the descendant. `document` is
 * required to follow INSTANCE → SYMBOL by guid; pass `undefined` when
 * the caller already has the resolved tree in-hand and doesn't need
 * the deep base view.
 *
 * Visited SYMBOL guids prevent the index from looping when a SYMBOL
 * graph references itself or another SYMBOL that references back.
 */
function symbolDescendantsByGuidScoped(
  root: FigNode,
  childrenOf: (node: FigNode) => readonly FigNode[],
  document: SymbolGraphDoc | undefined,
): ReadonlyMap<string, FigNode> {
  const out = new Map<string, FigNode>();
  const visitedSymbols = new Set<string>();
  function visitSymbolAndSiblingVariants(symbol: FigNode): void {
    visit(symbol);
    if (document === undefined) {
      return;
    }
    // When the SYMBOL is a member of a variant set, also walk every
    // authored sibling SYMBOL inside the same set so descendants that
    // only exist in the OTHER variant (e.g. eyecatch's TEXT 28:960
    // when the default variant is "number") still register here.
    // Without this hop, a call-site override that variant-swaps the
    // inner INSTANCE and overrides the swapped-in TEXT looks like an
    // "authored" value because base lookup misses the descendant.
    const parentGuid = symbol.parentIndex?.guid;
    if (!parentGuid) {
      return;
    }
    const parent = document.nodesByGuid.get(guidToString(parentGuid));
    if (!parent || !isVariantSetFrame(parent)) {
      return;
    }
    for (const sib of document.childrenOf(parent)) {
      if (sib.type?.name !== "SYMBOL") {
        continue;
      }
      const sibKey = guidToString(sib.guid);
      if (visitedSymbols.has(sibKey)) {
        continue;
      }
      visitedSymbols.add(sibKey);
      visit(sib);
    }
  }
  function visit(node: FigNode): void {
    for (const child of childrenOf(node)) {
      const key = guidToString(child.guid);
      if (!out.has(key)) {
        out.set(key, child);
      }
      visit(child);
      if (document !== undefined && child.type?.name === "INSTANCE") {
        const symbolGuid = child.symbolData?.symbolID;
        if (symbolGuid) {
          const symbolKey = guidToString(symbolGuid);
          if (!visitedSymbols.has(symbolKey)) {
            visitedSymbols.add(symbolKey);
            const symbol = document.nodesByGuid.get(symbolKey);
            if (symbol !== undefined) {
              visitSymbolAndSiblingVariants(symbol);
            }
          }
        }
      }
    }
  }
  if (document !== undefined && root.type?.name === "SYMBOL") {
    const rootKey = guidToString(root.guid);
    visitedSymbols.add(rootKey);
    visitSymbolAndSiblingVariants(root);
  } else {
    visit(root);
  }
  return out;
}

function visitResolvedInstanceChildren(
  roots: readonly FigNode[],
  context: EmitContext,
  visit: (node: FigNode) => void,
): void {
  visitResolvedInstanceChildrenWithScope(roots, context, visit, new Set());
}

/**
 * Walk every node in a resolved INSTANCE subtree, descending through
 * nested INSTANCE boundaries by re-resolving each inner INSTANCE so
 * its own children become visible. Without re-resolution, the visitor
 * stops at the first nested INSTANCE — the inner SYMBOL body sits
 * behind that boundary and a per-call-site override on a TEXT inside
 * it (e.g. icon-item → button-primary → TEXT) never reaches the
 * synthetic-prop forwarding logic.
 *
 * Each visited INSTANCE guid is tracked so a cycle (the same INSTANCE
 * reachable twice through resolved overrides) cannot send the walk
 * into an infinite descent.
 */
function visitResolvedInstanceChildrenWithScope(
  roots: readonly FigNode[],
  context: EmitContext,
  visit: (node: FigNode) => void,
  visitedInstanceGuids: Set<string>,
): void {
  for (const node of roots) {
    visit(node);
    const direct = context.source.symbolResolver.childrenOfResolvedNode(node);
    if (direct.length > 0) {
      visitResolvedInstanceChildrenWithScope(direct, context, visit, visitedInstanceGuids);
    }
    if (node.type?.name === "INSTANCE") {
      const key = guidToString(node.guid);
      if (visitedInstanceGuids.has(key)) {
        continue;
      }
      visitedInstanceGuids.add(key);
      try {
        const innerResolved = context.source.symbolResolver.resolveInstance(node);
        visitResolvedInstanceChildrenWithScope(innerResolved.children, context, visit, visitedInstanceGuids);
      } catch {
        // Resolution failure (e.g. external library reference) is
        // surfaced by the resolver elsewhere; the visitor itself
        // skips the subtree rather than aborting the outer walk.
      }
    }
  }
}

function collectChangedPaints(
  baseNode: FigNode,
  resolvedNode: FigNode,
  context: EmitContext,
  out: Record<string, string>,
): void {
  if (baseNode.strokePaints !== resolvedNode.strokePaints) {
    collectPaintsOverride(baseNode.strokePaints, resolvedNode.strokePaints ?? [], context, out);
  }
  if (baseNode.fillPaints !== resolvedNode.fillPaints) {
    collectPaintsOverride(baseNode.fillPaints, resolvedNode.fillPaints ?? [], context, out);
  }
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
  // Single-paint lookup routes through the array API so token
  // eligibility rules can't drift across call sites (SoT contract on
  // `TokenIndex.colorIdForPaints`).
  const originalToken = context.index.colorIdForPaints([original]);
  if (!originalToken) {
    return;
  }
  const newColor = solidPaintToCss(replacement, context);
  if (!newColor) {
    return;
  }
  out[`--${originalToken}`] = newColor;
}

function solidPaintToCss(paint: FigPaint, context?: EmitContext): string | undefined {
  const solid = asSolidPaint(paint);
  if (solid === undefined) {
    return undefined;
  }
  // When the paint references a Figma VARIABLE the paint's literal
  // RGB is only a fallback — the effective colour is the variable's
  // resolved value. Tokenisation built its color→id index from raw
  // RGB, so look up via the variable's resolved value to find the
  // matching token (e.g. `var(--color-base-text)`), and only fall
  // through to the literal RGB when the variable can't be resolved
  // or its colour isn't tokenised. Without this hop a symbolOverride
  // that swaps the POLYGON's fill to a variable-aliased dark colour
  // renders as the override's raw stub RGB (often opaque white) and
  // the design's theme variable is lost at the override boundary.
  const aliasGuid = variableAliasGuid(solid.colorVar?.value?.alias);
  if (context !== undefined && aliasGuid !== undefined) {
    const resolved = resolveColorVariable(aliasGuid, context);
    if (resolved !== undefined) {
      return formatVariableColor(solid, resolved, context);
    }
  }
  return formatSolidColor(solid);
}

function formatVariableColor(
  paint: FigSolidPaint,
  resolved: FigColor,
  context: EmitContext,
): string {
  const aliasToken = context.index.colorIdForPaints([variableColorAsPaint(resolved)]);
  if (aliasToken) {
    return `var(--${aliasToken})`;
  }
  const opacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  const r = Math.round(resolved.r * 255);
  const g = Math.round(resolved.g * 255);
  const b = Math.round(resolved.b * 255);
  const a = (resolved.a ?? 1) * opacity;
  if (a >= 0.999) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function formatSolidColor(paint: FigSolidPaint): string {
  const c = paint.color;
  const opacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  const a = (c.a ?? 1) * opacity;
  if (a >= 0.999) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

/**
 * Resolve a Figma VARIABLE alias to its concrete colour value by
 * walking `variableDataValues`. Variables can chain (one variable
 * aliases another); follow the chain until a literal colour appears
 * or the chain dead-ends.
 */
function resolveColorVariable(
  aliasGuid: FigGuid,
  context: EmitContext,
  visited: Set<string> = new Set(),
): FigColor | undefined {
  const key = guidToString(aliasGuid);
  if (visited.has(key)) {
    return undefined;
  }
  visited.add(key);
  const variable = context.source.document.nodesByGuid.get(key);
  if (!variable) {
    return undefined;
  }
  const entries = variable.variableDataValues?.entries;
  if (!entries || entries.length === 0) {
    return undefined;
  }
  // Pick the first entry's value. Figma variables can have multiple
  // modes; without resolved-mode context this falls back to mode 0
  // which matches what `nodesByGuid` gives us at emit time.
  const value = entries[0]?.variableData?.value;
  if (!value) {
    return undefined;
  }
  if (value.colorValue) {
    return { r: value.colorValue.r, g: value.colorValue.g, b: value.colorValue.b, a: value.colorValue.a ?? 1 };
  }
  const aliasTarget = variableAliasGuid(value.alias);
  if (aliasTarget !== undefined) {
    return resolveColorVariable(aliasTarget, context, visited);
  }
  return undefined;
}

/**
 * Figma `FigVariableID` is `FigGuid | { assetRef: { key, version? } }`,
 * but real .fig binaries sometimes wrap the guid as `{ guid: FigGuid }`
 * (the canonical `FigKiwiVariableAnyValue.alias` shape from the
 * parser). Accept both forms; the asset-ref form points at an
 * external library variable whose colour value we don't have
 * locally and is dropped.
 */
function variableAliasGuid(
  alias: FigVariableID | { readonly guid?: FigGuid } | undefined,
): FigGuid | undefined {
  if (alias === undefined) {
    return undefined;
  }
  if ("sessionID" in alias && "localID" in alias) {
    return alias;
  }
  if ("guid" in alias && alias.guid !== undefined) {
    return alias.guid;
  }
  return undefined;
}

function variableColorAsPaint(color: FigColor): FigSolidPaint {
  return {
    type: { value: 0, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
    blendMode: { value: 1, name: "NORMAL" },
  };
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
  context: EmitContext,
  componentTag: JsxNode,
): JsxNode {
  const symbolSize = naturalSymbolSize(instance, context);
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

/**
 * Add `overflow: hidden` to an INSTANCE wrapper when its authored
 * box is smaller than the SYMBOL's natural box on at least one axis
 * and the two axes don't share a single scale ratio. The non-
 * uniform case can't be folded into `wrapForScale`'s CSS scale, so
 * the SYMBOL renders at full size and overflows the wrapper. Figma
 * crops in that case; mirroring with `overflow: hidden` keeps
 * sibling layout from being painted over.
 */
function applyInstanceClipIfTruncated(
  instance: FigNode,
  context: EmitContext,
  wrapStyle: Record<string, string>,
): void {
  if (wrapStyle.overflow) {
    return;
  }
  const symbolSize = naturalSymbolSize(instance, context);
  if (!symbolSize || !instance.size) {
    return;
  }
  if (symbolSize.x <= 0 || symbolSize.y <= 0) {
    return;
  }
  const sx = instance.size.x / symbolSize.x;
  const sy = instance.size.y / symbolSize.y;
  // Only clip when the INSTANCE is *dramatically* smaller than the
  // SYMBOL on at least one axis — the about-desktop Management
  // sliver is 680×16 against a much taller block-features SYMBOL,
  // so one ratio is below 0.5 while the other stays near 1.
  // Card-style components with tiny dimension drift (a 200×300
  // INSTANCE of a 200×300 SYMBOL whose autolayout adjusts the
  // wrapper by 1-2 px) must not trigger this branch — their content
  // is supposed to overflow the wrapper because the wrapper is
  // smaller only by rounding.
  const minSquishRatio = Math.min(sx, sy);
  if (minSquishRatio >= 0.5) {
    return;
  }
  if (Math.abs(sx - sy) <= SCALE_RATIO_TOLERANCE) {
    // Uniform scale: wrapForScale will paint at SYMBOL size; let the
    // scaled inner overflow the wrapper deliberately.
    return;
  }
  wrapStyle.overflow = "hidden";
}

function naturalSymbolSize(
  instance: FigNode,
  context: EmitContext,
): { readonly x: number; readonly y: number } | undefined {
  const resolved = context.source.symbolResolver.resolveReferences(instance).effectiveSymbol;
  if (resolved === undefined) {
    throw new Error(`fig-to-web: INSTANCE ${guidToString(instance.guid)} has no SymbolResolver target for scaling`);
  }
  return resolved.node.size ?? undefined;
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
  resolved: ResolvedInstanceForEmit,
  context: EmitContext,
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
  appendResolvedTextProps(out, target.props, resolved, context);
  return out;
}

function appendResolvedTextProps(
  out: JsxProp[],
  props: readonly { readonly defId: string; readonly name: string; readonly kind: string; readonly defaultValue?: unknown }[],
  resolved: ResolvedInstanceForEmit,
  context: EmitContext,
): void {
  const propsByDefId = new Map(props.map((prop) => [prop.defId, prop]));
  const baseByGuid = symbolDescendantsByGuidScoped(
    resolved.effectiveSymbol,
    context.source.document.childrenOf,
    context.source.document,
  );
  const emittedForGuid = new Set<string>();
  const visitNode = (node: FigNode): void => {
    if (node.type?.name !== TEXT_NODE_TYPE) {
      return;
    }
    const guidStr = guidToString(node.guid);
    if (emittedForGuid.has(guidStr)) {
      return;
    }
    const decl = propsByDefId.get(`${SYNTHETIC_TEXT_PREFIX}${guidStr}`);
    if (decl === undefined) {
      return;
    }
    // Forward via outer prop when the currently-emitting SYMBOL
    // body has the descendant covered by a single authored
    // override value (or none). With one distinct authored value
    // the SYMBOL's prop default carries it; forwarding keeps inner
    // call sites pluggable from outside.
    //
    // When the SYMBOL body has multiple sibling INSTANCEs that
    // override the same descendant with different values (e.g.
    // footer's three icon-item INSTANCEs each writing a different
    // label into TEXT 66:387), no single outer prop can represent
    // all of them. Fall through to emit the resolved character
    // literal so each `<IconItem>` call site bakes the value the
    // SYMBOL author wrote.
    const outerBinding = context.propBindings.get(guidStr);
    const distinctOverrideValues = context.authoredTextOverrideDistinctValueCount.get(guidStr) ?? 0;
    if (outerBinding?.field === "TEXT_DATA" && distinctOverrideValues < 2) {
      out.push(exprProp(decl.name, propIdentForBinding(outerBinding.decl.name)));
      emittedForGuid.add(guidStr);
      return;
    }
    const characters = textCharacters(node);
    const baseCharacters = textCharacters(baseByGuid.get(guidStr) ?? node);
    if (characters === baseCharacters) {
      return;
    }
    out.push(textValueProp(decl.name, characters));
    emittedForGuid.add(guidStr);
  };
  visitResolvedInstanceChildren(resolved.resolvedChildren, context, visitNode);
  // The resolved tree only materialises the *currently selected*
  // variant — for a variant-set INSTANCE whose default is "number"
  // (TEXT 70:934 only), the resolved tree never exposes "eyecatch"'s
  // TEXT 28:960. But the outer component's prop list DOES declare a
  // synthetic prop for that guid (because of `visitDescendantsInner`'s
  // variant-set sibling walk in prop-bindings.ts), so its forwarding
  // must fire here too. Walk every authored sibling variant's body
  // directly so each forwarded prop reaches its inner counterpart
  // regardless of which variant the SYMBOL author defaulted to.
  visitVariantSetSiblingBodies(resolved.effectiveSymbol, context, visitNode);
}

function visitVariantSetSiblingBodies(
  symbol: FigNode,
  context: EmitContext,
  visit: (descendant: FigNode) => void,
): void {
  const parentGuid = symbol.parentIndex?.guid;
  if (!parentGuid) {
    return;
  }
  const document = context.source.document;
  const parent = document.nodesByGuid.get(guidToString(parentGuid));
  if (!parent || !isVariantSetFrame(parent)) {
    return;
  }
  const visited = new Set<string>([guidToString(symbol.guid)]);
  function walk(node: FigNode): void {
    for (const child of document.childrenOf(node)) {
      visit(child);
      walk(child);
    }
  }
  for (const sib of document.childrenOf(parent)) {
    if (sib.type?.name !== "SYMBOL") {
      continue;
    }
    const sibKey = guidToString(sib.guid);
    if (visited.has(sibKey)) {
      continue;
    }
    visited.add(sibKey);
    walk(sib);
  }
}

/**
 * Emit a JSX prop carrying a string value. When the value contains
 * a newline, use the expression form (`name={"..."}`) so the
 * embedded `\n` is interpreted as a real newline by the TypeScript
 * string literal — JSX attribute strings (`name="..."`) read `\n`
 * as the literal two-character sequence backslash-n, which then
 * renders as visible "\n" text inside a `whiteSpace: pre-line`
 * span instead of breaking the line.
 */
function textValueProp(name: string, value: string): JsxProp {
  if (value.includes("\n") || value.includes("\r")) {
    return exprProp(name, JSON.stringify(value));
  }
  return strProp(name, value);
}

/**
 * For each synthetic-variant prop the inner component declares, look
 * up the corresponding INSTANCE descendant in the resolved tree of
 * this outer INSTANCE call site. If the resolved INSTANCE's
 * `overriddenSymbolID` (or its `symbolID`) selects a different
 * variant than the inner component's prop default, emit a literal
 * `variant_<innerGuid>` prop. When the outer component the body
 * currently belongs to ALSO declares a synthetic variant prop for the
 * same inner-INSTANCE guid, forward via the outer prop name instead
 * so consumers further up can keep swapping.
 */
function appendCallSiteSyntheticVariantProps(
  out: JsxProp[],
  innerProps: readonly { readonly defId: string; readonly name: string; readonly kind: string; readonly defaultValue?: unknown }[],
  instance: FigNode,
  context: EmitContext,
  resolvedRootVariant: string | undefined,
): void {
  void resolvedRootVariant;
  for (const prop of innerProps) {
    if (!prop.defId.startsWith(SYNTHETIC_VARIANT_PREFIX) || prop.kind !== "variant") {
      continue;
    }
    const innerGuidStr = prop.defId.slice(SYNTHETIC_VARIANT_PREFIX.length);
    // Outer-binding forwarding: if the outer component body that's
    // currently emitting also exposes a synthetic variant prop for
    // the same inner-INSTANCE guid, forward via that name so the
    // outer consumer can keep choosing the variant.
    const outerBinding = context.propBindings.get(innerGuidStr);
    const outerForwards = outerBinding?.field === "OVERRIDDEN_SYMBOL_ID" && outerBinding.decl.kind === "variant";
    if (outerForwards) {
      out.push(exprProp(prop.name, propIdentForBinding(outerBinding.decl.name)));
      continue;
    }
    // Otherwise: emit the literal selected variant from the resolved
    // tree of THIS outer INSTANCE, if it differs from the prop's
    // default. Skip when the resolved variant equals the inner
    // component's prop default.
    const resolvedInner = findResolvedInstanceByGuid(context, instance, innerGuidStr);
    if (resolvedInner === undefined) {
      continue;
    }
    const innerSymbolGuid = resolvedInner.overriddenSymbolID ?? resolvedInner.symbolData?.symbolID;
    if (!innerSymbolGuid) {
      continue;
    }
    const variantKey = resolveVariantKeyForSymbol(context, innerSymbolGuid);
    if (variantKey === undefined) {
      continue;
    }
    if (variantKey === prop.defaultValue) {
      continue;
    }
    out.push(strProp(prop.name, variantKey));
  }
}

function findResolvedInstanceByGuid(
  context: EmitContext,
  outerInstance: FigNode,
  innerGuidStr: string,
): FigNode | undefined {
  let found: FigNode | undefined;
  try {
    const resolved = context.source.symbolResolver.resolveInstance(outerInstance);
    visitResolvedInstanceChildren(resolved.children, context, (n) => {
      if (found !== undefined) {
        return;
      }
      if (n.type?.name === "INSTANCE" && guidToString(n.guid) === innerGuidStr) {
        found = n;
      }
    });
  } catch {
    // External / unresolvable reference — no match.
  }
  return found;
}

function resolveVariantKeyForSymbol(
  context: EmitContext,
  symbolGuid: FigGuid,
): string | undefined {
  const symbol = context.source.document.nodesByGuid.get(guidToString(symbolGuid));
  if (!symbol) {
    return undefined;
  }
  const parentGuid = symbol.parentIndex?.guid;
  if (!parentGuid) {
    return undefined;
  }
  const parent = context.source.document.nodesByGuid.get(guidToString(parentGuid));
  if (!parent) {
    return undefined;
  }
  const target = context.registry.components.get(guidToString(parent.guid));
  if (!target) {
    return undefined;
  }
  const symbolKey = guidToString(symbolGuid);
  for (const [key, variant] of target.variants) {
    if (guidToString(variant.guid) === symbolKey) {
      return key;
    }
  }
  return undefined;
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
      return textValueProp(decl.name, chars);
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

/**
 * Translate a FigNode's stored matrix into the CSS `transform` value
 * for emission. `transformFromMatrix` already strips the translation
 * components (the matrix is emitted with `0, 0` in the translation
 * slots and `undefined` is returned when the 2x2 part is identity), so
 * autolayout-flow children whose Figma matrix is pure translation
 * naturally produce no `transform` here. A rotated / scaled / skewed
 * child preserves its visual transform regardless of whether the
 * parent positions it via flex flow or absolute coordinates — flex
 * owns the layout slot, the matrix owns what happens inside that slot.
 *
 * The root frame is mounted by the harness at (0,0) with no transform,
 * so its own matrix is suppressed here.
 */
function transformForNode(
  node: FigNode,
  rootMode: RootMode | undefined,
): string | undefined {
  if (rootMode !== undefined) {
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
