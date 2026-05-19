/**
 * @file SVG-shaped emission for vector / line / star / boolean nodes.
 *
 * Figma stores vector geometry in two interchangeable forms:
 *
 *   1. `vectorPaths[*].data` — pre-decoded SVG path strings on
 *      builder-generated nodes. We pass these through verbatim.
 *
 *   2. `fillGeometry[*].commandsBlob` — a blob-index pointing into
 *      `source.loaded.blobs` whose bytes encode the path commands in
 *      Figma's binary format. We decode through
 *      `@higma-document-models/fig/domain`'s shared decoder so this
 *      generator stays on the same SoT as the SVG / WebGL renderer.
 *
 * The previous emitter rendered vectors as `<div style={{
 * background: <color> }}>` placeholders — that turns every vector into a
 * coloured rectangle and forfeits the actual path. The new path here:
 *
 *   - emit `<svg viewBox="0 0 W H">` sized to the node's `size`,
 *   - emit one `<path d="..." fill="..." />` per fill geometry,
 *   - emit additional stroke paths when stroke paints are present,
 *   - apply CSS via the SVG's `fill` attribute (NOT `background`) so the
 *     paint is the actual rendered ink rather than the bounding-box.
 *
 * The functions here return `JsxNode` trees so the JSX emitter can
 * splice them into its own structured output without ever touching
 * raw markup strings — every attribute crosses through the
 * `jsx-tree` serializer's JSON-string escape.
 */
import type {
  FigFillGeometry,
  FigNode,
  FigStrokeWeight,
  FigVectorPath,
  KiwiEnumValue,
} from "@higma-document-models/fig/types";
import type { FigBlob, FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import { decodeBlobToSvgPath } from "@higma-document-models/fig/domain";
import type { FigDocumentContext } from "@higma-document-io/fig/context";
import type { TokenIndex } from "../../tokens";
import { synthesizeShapePath } from "./synth-shape";
import type { JsxNode, JsxProp } from "../../lib/jsx-tree/types";
import { el, flagProp, strProp } from "../../lib/jsx-tree/builder";
import { firstSolidPaintCss } from "../../lib/css-format/paint";

const VECTOR_NODE_TYPES: ReadonlySet<string> = new Set([
  "VECTOR",
  "LINE",
  "STAR",
  "REGULAR_POLYGON",
  "BOOLEAN_OPERATION",
]);

/**
 * Whether a node should render through the SVG emitter rather than
 * as a div.
 *
 * Plain ellipses (no `arcData`, or `arcData` describing a full
 * circle with no inner radius) take the cheaper `<div>` +
 * `border-radius: 50%` path — CSS produces the correct shape and
 * the wrapper can hold an IMAGE / GRADIENT background fill, which
 * SVG `<path fill="...">` cannot. ELLIPSE *with* a partial-sweep or
 * donut `arcData` encodes a shape CSS cannot draw, so it routes
 * through SVG synthesis like the other parametric shapes.
 */
export function isVectorShaped(node: FigNode): boolean {
  if (VECTOR_NODE_TYPES.has(node.type.name)) {
    return true;
  }
  if (node.type.name === "ELLIPSE") {
    return hasNonTrivialArc(node);
  }
  return false;
}

function hasNonTrivialArc(node: FigNode): boolean {
  const arc = (node as { readonly arcData?: { readonly startingAngle: number; readonly endingAngle: number; readonly innerRadius: number } }).arcData;
  if (!arc) {
    return false;
  }
  if (arc.innerRadius && arc.innerRadius > 0) {
    return true;
  }
  const sweep = Math.abs(arc.endingAngle - arc.startingAngle);
  return Math.abs(sweep - 2 * Math.PI) >= 1e-3;
}

const ICON_CONTAINER_TYPES: ReadonlySet<string> = new Set(["FRAME", "GROUP", "BOOLEAN_OPERATION"]);

function hasVisible(paints: readonly { readonly visible?: boolean }[] | undefined): boolean {
  if (!paints) {
    return false;
  }
  for (const paint of paints) {
    if (paint.visible !== false) {
      return true;
    }
  }
  return false;
}

function isPlainContainer(node: FigNode): boolean {
  if (!ICON_CONTAINER_TYPES.has(node.type.name)) {
    return false;
  }
  if (hasVisible(node.fillPaints) || hasVisible(node.backgroundPaints)) {
    return false;
  }
  if (hasVisible(node.strokePaints)) {
    return false;
  }
  if (node.effects && node.effects.length > 0) {
    return false;
  }
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    return false;
  }
  if (node.clipsContent === true) {
    return false;
  }
  if (typeof node.opacity === "number" && node.opacity < 1) {
    return false;
  }
  const stack = node.stackMode?.name;
  if (stack === "VERTICAL" || stack === "HORIZONTAL") {
    return false;
  }
  return true;
}

function isVisible(node: FigNode): boolean {
  return node.visible !== false;
}

function visibleChildren(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): readonly FigNode[] {
  const out: FigNode[] = [];
  for (const child of childrenOf(node)) {
    if (isVisible(child)) {
      out.push(child);
    }
  }
  return out;
}

/**
 * True when the node's entire visible subtree is composed of vector
 * shapes (and transparent wrappers around them). Such nodes can emit
 * as a single `<svg>` element with composed paths instead of a
 * forest of `<div>` wrappers, each individually `position: absolute`.
 *
 * The check is recursive: a FRAME with only pure-vector-subtree
 * children is itself a pure-vector subtree.
 */
export function isPureVectorSubtree(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): boolean {
  if (isVectorShaped(node)) {
    return true;
  }
  if (!isPlainContainer(node)) {
    return false;
  }
  const children = visibleChildren(node, childrenOf);
  if (children.length === 0) {
    return false;
  }
  for (const child of children) {
    if (!isPureVectorSubtree(child, childrenOf)) {
      return false;
    }
  }
  return true;
}

/**
 * True when the node should be emitted as a single SVG that bundles
 * its vector descendants. The node itself must be a *plain container*
 * (so we can replace its `<div>` with an `<svg>` without losing visible
 * styling), and at least one descendant must contribute a real path.
 */
export function isVectorOnlyContainer(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): boolean {
  if (!isPlainContainer(node)) {
    return false;
  }
  const children = visibleChildren(node, childrenOf);
  if (children.length === 0) {
    return false;
  }
  for (const child of children) {
    if (!isPureVectorSubtree(child, childrenOf)) {
      return false;
    }
  }
  return countVectors(node, childrenOf) > 0;
}

function countVectors(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): number {
  if (isVectorShaped(node)) {
    return 1;
  }
  return visibleChildren(node, childrenOf).reduce((sum, child) => sum + countVectors(child, childrenOf), 0);
}

function maxStrokeWidth(weight: FigStrokeWeight | undefined): number | undefined {
  if (weight === undefined) {
    return undefined;
  }
  if (typeof weight === "number") {
    return weight;
  }
  return Math.max(weight.top, weight.right, weight.bottom, weight.left);
}

function windingRuleProp(rule: string | KiwiEnumValue | undefined): JsxProp | undefined {
  if (!rule) {
    return undefined;
  }
  const name = typeof rule === "string" ? rule : rule.name;
  if (name === "EVENODD" || name === "ODD") {
    return strProp("fill-rule", "evenodd");
  }
  return undefined;
}

/**
 * Pull every available SVG path string for a node from its vector
 * data. Order: authored `vectorPaths`, decoded `fillGeometry`
 * blobs, then synthetic primitives (polygons / stars / lines /
 * arc-shaped ellipses) when neither pre-built source is available.
 *
 * The synthesis fallback only fires when both authored sources are
 * empty — it must never override a real geometry that the renderer
 * already provided. That order matches the Figma renderer's own
 * path resolution.
 */
export type CollectedPath = {
  readonly d: string;
  readonly rule?: string | KiwiEnumValue;
  /**
   * `"stroke"` when the path geometry came from `strokeGeometry` —
   * Figma stores those as the *outline* of the conceptual stroke
   * (already widened, rounded caps inlined). They paint with the
   * stroke colour as a `fill` and must NOT receive an SVG `stroke`
   * attribute; otherwise the outline gets stroked again and the
   * line appears 2× thick. `"fill"` (the default) keeps the
   * historical fill+stroke composition.
   */
  readonly source?: "fill" | "stroke";
};

/**
 * Pull every available SVG path string for a node, tagged with the
 * geometry source so the emitter knows whether to paint the result
 * as a fill, a stroke, or already-widened-outline-as-fill.
 */
export function collectPathsFor(node: FigNode, blobs: readonly FigBlob[]): readonly CollectedPath[] {
  // ELLIPSE with non-trivial `arcData` (partial sweep or donut)
  // carries a `fillGeometry` blob describing the *full* ellipse —
  // Figma always stores the canonical path and recomputes the arc
  // at render time. Using that blob would paint the whole disc on
  // top of the synthesised arc, so the synthesis pathway has to win
  // for arc-shaped ellipses. Full-circle `arcData` (no-op arc) does
  // not reach this branch — `isVectorShaped` keeps it on the plain
  // div + border-radius pathway.
  if (node.type.name === "ELLIPSE" && hasNonTrivialArc(node)) {
    const synth = synthesizeShapePath(node);
    return synth ? [{ d: synth, source: "fill" }] : [];
  }

  const out: CollectedPath[] = [];

  for (const path of node.vectorPaths ?? []) {
    const decoded = pathFromVectorPath(path);
    if (decoded) {
      out.push({ ...decoded, source: "fill" });
    }
  }

  for (const geom of node.fillGeometry ?? []) {
    const decoded = pathFromGeometry(geom, blobs);
    if (decoded) {
      out.push({ ...decoded, source: "fill" });
    }
  }

  // Stroke-only vectors (icons drawn purely as outlines: arrows,
  // tick marks, dividers) carry their geometry in `strokeGeometry`
  // rather than `fillGeometry`. The blob already encodes the
  // stroke's outline (widened, with the authored line caps baked
  // in), so the path paints as a *fill* using the stroke colour.
  // Adding an SVG `stroke` would expand the outline a second time
  // and make every such icon appear at twice the authored
  // thickness — this was the source of the visibly-too-thick back
  // arrow in the YouTube fixture.
  if (out.length === 0) {
    for (const geom of node.strokeGeometry ?? []) {
      const decoded = pathFromGeometry(geom, blobs);
      if (decoded) {
        out.push({ ...decoded, source: "stroke" });
      }
    }
  }

  if (out.length === 0) {
    const synth = synthesizeShapePath(node);
    if (synth) {
      out.push({ d: synth, source: "fill" });
    }
  }

  return out;
}


function pathFromVectorPath(path: FigVectorPath): { d: string; rule?: string | KiwiEnumValue } | undefined {
  if (typeof path.data !== "string" || path.data.length === 0) {
    return undefined;
  }
  return { d: path.data, rule: path.windingRule };
}

function pathFromGeometry(geom: FigFillGeometry, blobs: readonly FigBlob[]): { d: string; rule?: string | KiwiEnumValue } | undefined {
  if (typeof geom.commandsBlob !== "number") {
    return undefined;
  }
  const blob = blobs[geom.commandsBlob];
  if (!blob) {
    return undefined;
  }
  const d = decodeBlobToSvgPath(blob);
  if (d.length === 0) {
    return undefined;
  }
  return { d, rule: geom.windingRule };
}

export type VectorEmitInputs = {
  readonly source: FigDocumentContext;
  readonly index: TokenIndex;
  readonly childrenOf: FigKiwiDocumentIndex["childrenOf"];
};

function strokeProps(
  strokeFill: string | undefined,
  strokeWidth: number | undefined,
  dashes: readonly number[] | undefined,
): readonly JsxProp[] {
  if (!strokeFill || !strokeWidth) {
    return [];
  }
  const out: JsxProp[] = [
    strProp("stroke", strokeFill),
    strProp("stroke-width", `${strokeWidth}`),
  ];
  if (dashes && dashes.length > 0) {
    out.push(strProp("stroke-dasharray", dashes.join(" ")));
  }
  return out;
}

/**
 * Pull the dash pattern from a Figma node. Different fig snapshots
 * use slightly different field names — we accept the common ones and
 * return `undefined` when there's no usable pattern, leaving the
 * stroke as a solid line.
 */
function strokeDashesFor(node: FigNode): readonly number[] | undefined {
  const candidate =
    (node as { readonly dashPattern?: readonly number[] }).dashPattern
    ?? (node as { readonly strokeDashes?: readonly number[] }).strokeDashes;
  if (!candidate || candidate.length === 0) {
    return undefined;
  }
  return candidate;
}

/**
 * Render an SVG element for a vector-shaped node. Returns undefined when
 * the node has no usable geometry — the caller falls back to a plain
 * div so the visual still occupies the right amount of space.
 *
 * `wrapperProps` carry node-level attributes the JSX emitter already
 * prepared (`data-fig-*`, `className`, `style`); this function adds
 * the SVG-specific props (`viewBox`, `preserveAspectRatio`, `fill`,
 * `stroke*`, `xmlns`, `aria-hidden`, `overflow`) on top.
 */
export function emitVectorSvg(
  node: FigNode,
  inputs: VectorEmitInputs,
  wrapperProps: readonly JsxProp[],
): JsxNode | undefined {
  const paths = collectPathsFor(node, inputs.source.blobs);
  if (paths.length === 0) {
    return undefined;
  }

  const rawWidth = node.size?.x ?? 0;
  const rawHeight = node.size?.y ?? 0;
  // LINE nodes (and other degenerate-bounding-box vectors) have a
  // zero-thickness path that's only visible because of stroke. The
  // bounding box itself has height 0, which would collapse the SVG
  // and clip the stroke. Pad the box and viewBox by the stroke width
  // so the rendered stroke survives — the same behaviour the
  // authoritative Figma SVG renderer relies on.
  const fill = firstSolidPaintCss(node.fillPaints, inputs.index);
  const strokeFill = firstSolidPaintCss(node.strokePaints, inputs.index);
  const strokeWidth = maxStrokeWidth(node.strokeWeight);
  const dims = expandDegenerateBox(rawWidth, rawHeight, strokeWidth);
  if (!dims) {
    return undefined;
  }

  // Per-path attributes: a `source: "stroke"` path already encodes
  // its widened outline as fill, so it MUST NOT receive a stroke
  // attr (would double-thicken the line). Mixed source paths inside
  // one node fall back to a per-path fill/stroke split rather than
  // applying SVG-element-level fill/stroke shared across paths.
  const dashes = strokeDashesFor(node);
  const styling = computeSvgStyling(paths, fill, strokeFill, strokeWidth, dashes);
  const pathChildren: JsxNode[] = paths.map((p) =>
    renderPathElement(p, styling, fill, strokeFill, strokeWidth, dashes),
  );

  const viewBox = `${dims.viewBoxX} ${dims.viewBoxY} ${dims.viewBoxW} ${dims.viewBoxH}`;
  const svgProps: JsxProp[] = [
    ...wrapperProps,
    // SVG's default `overflow: hidden` clips any path coordinate that
    // falls outside `viewBox`. That mis-clips two cases this emitter
    // routinely hits:
    //
    //   1. **Degenerate vectors** (zero-thickness LINE / single-axis
    //      VECTOR) — stroke needs to extend past the collapsed axis.
    //
    //   2. **Strokes with `strokeAlign: CENTER` (Figma's default) or
    //      `OUTSIDE`** — the rendered outline extends `strokeWeight/2`
    //      (CENTER) or `strokeWeight` (OUTSIDE) past `node.size` on
    //      every side, plus more for `strokeCap: ROUND`/`SQUARE` at
    //      path endpoints. Figma's layout uses the *centerline* bbox
    //      (`node.size`) so the SVG element keeps `width`/`height` at
    //      `node.size` for layout fidelity, and `overflow="visible"`
    //      lets the rendered stroke overshoot — the parent's
    //      `clipsContent` handles real clipping where the design wants
    //      it. Without this, the e-commerce plant-shop hero's two
    //      hand-drawn squiggles (`Vector 186/187`) lost their endpoints
    //      to a 2 px clip.
    //
    // Always emitting `overflow="visible"` is safe: pure fill paths
    // whose geometry sits inside the viewBox render identically either
    // way, and parents that clip (icon frames, scrollable cards) rely
    // on the surrounding container's `overflow: hidden`, not the SVG
    // element's own.
    strProp("overflow", "visible"),
    strProp("viewBox", viewBox),
    strProp("preserveAspectRatio", "none"),
  ];
  if (styling.svgFill !== undefined) {
    svgProps.push(strProp("fill", styling.svgFill));
  }
  for (const p of styling.svgStroke) {
    svgProps.push(p);
  }
  svgProps.push(strProp("xmlns", "http://www.w3.org/2000/svg"));
  svgProps.push(flagProp("aria-hidden"));
  return el("svg", { props: svgProps, children: pathChildren, layout: "inline" });
}

type SvgStyling = {
  readonly svgFill: string | undefined;
  readonly svgStroke: readonly JsxProp[];
  readonly perPath: boolean;
};

/**
 * Decide whether the wrapping `<svg>` element can hoist a single
 * fill/stroke pair (the common case) or whether each path needs its
 * own attributes because the node mixes `source: "stroke"`
 * (already-widened outlines) with `source: "fill"` paths.
 */
function computeSvgStyling(
  paths: readonly { readonly source?: "fill" | "stroke" }[],
  fill: string | undefined,
  strokeFill: string | undefined,
  strokeWidth: number | undefined,
  dashes: readonly number[] | undefined,
): SvgStyling {
  if (paths.length === 0) {
    return { svgFill: undefined, svgStroke: [], perPath: false };
  }
  const allStroke = paths.every((p) => p.source === "stroke");
  const allFill = paths.every((p) => p.source !== "stroke");
  if (allStroke) {
    return {
      svgFill: strokeFill ?? "none",
      svgStroke: [],
      perPath: false,
    };
  }
  if (allFill) {
    return {
      svgFill: fill ?? "none",
      svgStroke: strokeProps(strokeFill, strokeWidth, dashes),
      perPath: false,
    };
  }
  return { svgFill: undefined, svgStroke: [], perPath: true };
}

function renderPathElement(
  p: { readonly d: string; readonly rule?: string | KiwiEnumValue; readonly source?: "fill" | "stroke" },
  styling: SvgStyling,
  fill: string | undefined,
  strokeFill: string | undefined,
  strokeWidth: number | undefined,
  dashes: readonly number[] | undefined,
): JsxNode {
  const props: JsxProp[] = [strProp("d", p.d)];
  if (styling.perPath) {
    props.push(perPathFillProp(p.source, fill, strokeFill));
    if (p.source !== "stroke") {
      for (const sp of strokeProps(strokeFill, strokeWidth, dashes)) {
        props.push(sp);
      }
    }
  }
  const winding = windingRuleProp(p.rule);
  if (winding) {
    props.push(winding);
  }
  return el("path", { props });
}

function perPathFillProp(
  source: "fill" | "stroke" | undefined,
  fill: string | undefined,
  strokeFill: string | undefined,
): JsxProp {
  if (source === "stroke") {
    return strProp("fill", strokeFill ?? "none");
  }
  return strProp("fill", fill ?? "none");
}

/**
 * Compute the SVG bounding-box / viewBox for a vector node. Plain
 * shapes use the node's own size; degenerate ones (zero-thickness
 * lines) get expanded by the stroke radius on the collapsed axis so
 * the stroke remains visible — `overflow: visible` cannot be relied
 * on across browsers when the SVG itself has a zero dimension.
 */
function expandDegenerateBox(
  width: number,
  height: number,
  strokeWidth: number | undefined,
): {
  readonly viewBoxX: number;
  readonly viewBoxY: number;
  readonly viewBoxW: number;
  readonly viewBoxH: number;
  readonly degenerate: boolean;
} | undefined {
  const stroke = strokeWidth && strokeWidth > 0 ? strokeWidth : 0;
  const wIsDegenerate = width <= 0;
  const hIsDegenerate = height <= 0;
  if (wIsDegenerate && hIsDegenerate) {
    return undefined;
  }
  if (!wIsDegenerate && !hIsDegenerate) {
    return { viewBoxX: 0, viewBoxY: 0, viewBoxW: width, viewBoxH: height, degenerate: false };
  }
  if (stroke <= 0) {
    return undefined;
  }
  const half = stroke / 2;
  if (hIsDegenerate) {
    return { viewBoxX: 0, viewBoxY: -half, viewBoxW: width, viewBoxH: stroke, degenerate: true };
  }
  return { viewBoxX: -half, viewBoxY: 0, viewBoxW: stroke, viewBoxH: height, degenerate: true };
}

type ComposedPath = {
  readonly d: string;
  readonly rule: string | KiwiEnumValue | undefined;
  readonly fill: string | undefined;
  readonly stroke: string | undefined;
  readonly strokeWidth: number | undefined;
  readonly strokeDashes: readonly number[] | undefined;
  /**
   * `"stroke"` when the geometry came from `strokeGeometry` — the
   * outline is already widened, so we paint it with the stroke
   * colour as a fill and skip the SVG `stroke` attribute (otherwise
   * the line would render at twice its authored thickness).
   */
  readonly source: "fill" | "stroke";
  /**
   * Composed 2x3 affine matrix from the merged-svg root down to this
   * leaf vector. Rotation, scaling and shearing are real fields here
   * — not just translation — so an icon with a rotated stroke (e.g.
   * the vertical bar of a "+" stored as a rotated horizontal line)
   * survives the merge.
   */
  readonly matrix: AffineMatrix;
};

type AffineMatrix = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

const IDENTITY_MATRIX: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function matrixOfNode(node: FigNode): AffineMatrix {
  const t = node.transform;
  if (!t) {
    return IDENTITY_MATRIX;
  }
  return { a: t.m00, b: t.m10, c: t.m01, d: t.m11, e: t.m02, f: t.m12 };
}

function multiplyMatrix(parent: AffineMatrix, child: AffineMatrix): AffineMatrix {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
  };
}

/**
 * Walk a pure-vector subtree and emit one path entry per vector
 * descendant. Each entry carries the path data plus the *composed*
 * affine matrix from every ancestor wrapper between the container
 * root and the leaf, so the merged SVG places (and rotates / scales)
 * every shape correctly relative to its container's origin.
 */
function collectComposedPaths(
  node: FigNode,
  blobs: readonly FigBlob[],
  index: TokenIndex,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
  parent: AffineMatrix,
): readonly ComposedPath[] {
  if (isVectorShaped(node)) {
    return collectVectorPaths(node, blobs, index, parent);
  }
  const next = multiplyMatrix(parent, matrixOfNode(node));
  const out: ComposedPath[] = [];
  for (const child of visibleChildren(node, childrenOf)) {
    out.push(...collectComposedPaths(child, blobs, index, childrenOf, next));
  }
  return out;
}

function collectVectorPaths(
  node: FigNode,
  blobs: readonly FigBlob[],
  index: TokenIndex,
  parent: AffineMatrix,
): readonly ComposedPath[] {
  const paths = collectPathsFor(node, blobs);
  if (paths.length === 0) {
    return [];
  }
  const matrix = multiplyMatrix(parent, matrixOfNode(node));
  const fill = firstSolidPaintCss(node.fillPaints, index);
  const stroke = firstSolidPaintCss(node.strokePaints, index);
  const strokeWidth = maxStrokeWidth(node.strokeWeight);
  const strokeDashes = strokeDashesFor(node);
  return paths.map((p) => ({
    d: p.d,
    rule: p.rule,
    fill,
    stroke,
    strokeWidth,
    strokeDashes,
    source: p.source ?? "fill",
    matrix,
  }));
}

function collectDescendantPaths(container: FigNode, inputs: VectorEmitInputs): readonly ComposedPath[] {
  const out: ComposedPath[] = [];
  for (const child of visibleChildren(container, inputs.childrenOf)) {
    out.push(...collectComposedPaths(child, inputs.source.blobs, inputs.index, inputs.childrenOf, IDENTITY_MATRIX));
  }
  return out;
}

function pathPropsFor(p: ComposedPath): readonly JsxProp[] {
  // Stroke-sourced paths already encode the widened outline; we paint
  // them as a fill using the stroke colour and skip the SVG `stroke`
  // attribute (otherwise the line gets stroked again on top of its
  // own outline and renders at twice the authored thickness).
  const out: JsxProp[] = [];
  if (p.source === "stroke") {
    out.push(strProp("fill", p.stroke ?? "none"));
  } else {
    out.push(strProp("fill", p.fill ?? "none"));
    for (const sp of strokeProps(p.stroke, p.strokeWidth, p.strokeDashes)) {
      out.push(sp);
    }
  }
  const winding = windingRuleProp(p.rule);
  if (winding) {
    out.push(winding);
  }
  const matrix = matrixProp(p.matrix);
  if (matrix) {
    out.push(matrix);
  }
  return out;
}

function matrixProp(m: AffineMatrix): JsxProp | undefined {
  if (
    Math.abs(m.a - 1) < 1e-9
    && Math.abs(m.b) < 1e-9
    && Math.abs(m.c) < 1e-9
    && Math.abs(m.d - 1) < 1e-9
    && Math.abs(m.e) < 1e-9
    && Math.abs(m.f) < 1e-9
  ) {
    return undefined;
  }
  if (
    Math.abs(m.a - 1) < 1e-9
    && Math.abs(m.b) < 1e-9
    && Math.abs(m.c) < 1e-9
    && Math.abs(m.d - 1) < 1e-9
  ) {
    return strProp("transform", `translate(${m.e} ${m.f})`);
  }
  return strProp("transform", `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
}

/**
 * Render a vector-only container subtree as a single merged SVG.
 * Returns undefined when no descendants contribute geometry — the
 * caller falls back to normal container emission.
 *
 * The container's own transform is *not* part of the path translation:
 * that transform belongs to the surrounding `style` (`left`/`top` on
 * the SVG element). Only the descendants' transforms accumulate into
 * each path's `transform="translate(...)"`. Mixing the two would
 * double-apply the container's translation and shoot every path off
 * by the container's offset within its grandparent.
 */
export function emitMergedVectorSvg(
  node: FigNode,
  inputs: VectorEmitInputs,
  wrapperProps: readonly JsxProp[],
): JsxNode | undefined {
  if (!node.size) {
    return undefined;
  }
  const paths = collectDescendantPaths(node, inputs);
  if (paths.length === 0) {
    return undefined;
  }
  const width = node.size.x;
  const height = node.size.y;
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  const viewBox = `0 0 ${width} ${height}`;
  const pathChildren: JsxNode[] = paths.map((p) => el("path", { props: [strProp("d", p.d), ...pathPropsFor(p)] }));
  const svgProps: JsxProp[] = [
    ...wrapperProps,
    strProp("viewBox", viewBox),
    strProp("xmlns", "http://www.w3.org/2000/svg"),
    flagProp("aria-hidden"),
  ];
  return el("svg", { props: svgProps, children: pathChildren, layout: "inline" });
}
