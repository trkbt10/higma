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
 */
import type {
  FigColor,
  FigFillGeometry,
  FigNode,
  FigPaint,
  FigStrokeWeight,
  FigVectorPath,
  KiwiEnumValue,
} from "@higma-document-models/fig/types";
import type { FigBlob } from "@higma-document-models/fig/domain";
import { decodeBlobToSvgPath } from "@higma-document-models/fig/domain";
import type { FigSource } from "../fig-source";
import type { TokenIndex } from "../tokens";
import { synthesizeShapePath } from "./synth-shape";

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

function visibleChildren(node: FigNode): readonly FigNode[] {
  const out: FigNode[] = [];
  for (const child of node.children ?? []) {
    if (child && isVisible(child)) {
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
export function isPureVectorSubtree(node: FigNode): boolean {
  if (isVectorShaped(node)) {
    return true;
  }
  if (!isPlainContainer(node)) {
    return false;
  }
  const children = visibleChildren(node);
  if (children.length === 0) {
    return false;
  }
  for (const child of children) {
    if (!isPureVectorSubtree(child)) {
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
export function isVectorOnlyContainer(node: FigNode): boolean {
  if (!isPlainContainer(node)) {
    return false;
  }
  const children = visibleChildren(node);
  if (children.length === 0) {
    return false;
  }
  // Every child must itself be a pure-vector subtree.
  for (const child of children) {
    if (!isPureVectorSubtree(child)) {
      return false;
    }
  }
  // At least one vector somewhere — otherwise the wrapper is just empty
  // and a regular collapse already handled it.
  return countVectors(node) > 0;
}

function countVectors(node: FigNode): number {
  if (isVectorShaped(node)) {
    return 1;
  }
  return visibleChildren(node).reduce((sum, child) => sum + countVectors(child), 0);
}

function colorToCss(c: FigColor): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  if (c.a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${round3(c.a)})`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Resolve a single visible solid paint to its CSS colour string. */
function paintColor(paint: FigPaint, index: TokenIndex): string | undefined {
  if (paint.visible === false) {
    return undefined;
  }
  if (paint.type !== "SOLID") {
    return undefined;
  }
  const tokenId = index.colorIdForPaint(paint);
  if (tokenId) {
    return `var(--${tokenId})`;
  }
  const opacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  if (opacity === 1) {
    return colorToCss(paint.color);
  }
  return colorToCss({ ...paint.color, a: paint.color.a * opacity });
}

function firstSolidColor(paints: readonly FigPaint[] | undefined, index: TokenIndex): string | undefined {
  if (!paints) {
    return undefined;
  }
  for (const paint of paints) {
    const c = paintColor(paint, index);
    if (c) {
      return c;
    }
  }
  return undefined;
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

function windingRuleAttr(rule: string | KiwiEnumValue | undefined): string {
  if (!rule) {
    return "";
  }
  const name = typeof rule === "string" ? rule : rule.name;
  if (name === "EVENODD" || name === "ODD") {
    return ` fill-rule="evenodd"`;
  }
  return "";
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
  readonly source: FigSource;
  readonly index: TokenIndex;
};

function renderStrokeAttrs(
  strokeFill: string | undefined,
  strokeWidth: number | undefined,
  dashes: readonly number[] | undefined,
): string {
  if (!strokeFill || !strokeWidth) {
    return "";
  }
  const base = ` stroke=${JSON.stringify(strokeFill)} stroke-width=${JSON.stringify(`${strokeWidth}`)}`;
  if (dashes && dashes.length > 0) {
    return `${base} stroke-dasharray=${JSON.stringify(dashes.join(" "))}`;
  }
  return base;
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
 */
export function emitVectorSvg(
  node: FigNode,
  inputs: VectorEmitInputs,
  styleSrc: string,
  attrsAndIndent: { dataAttrs: string; indent: string; classAttr?: string },
): string | undefined {
  const paths = collectPathsFor(node, inputs.source.loaded.blobs);
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
  const fill = firstSolidColor(node.fillPaints, inputs.index);
  const strokeFill = firstSolidColor(node.strokePaints, inputs.index);
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
  const pathElements = paths
    .map((p) => renderPathElement(p, styling, fill, strokeFill, strokeWidth, dashes))
    .join("");

  const viewBox = `${dims.viewBoxX} ${dims.viewBoxY} ${dims.viewBoxW} ${dims.viewBoxH}`;
  const classAttr = attrsAndIndent.classAttr ?? "";
  // Degenerate vectors (zero-thickness lines) need `overflow: visible`
  // on the SVG itself so the stroke can extend past the zero-height
  // bounding box. The native `overflow` SVG attribute is the
  // cross-browser-safe way to express this — CSS `overflow: visible`
  // would have the same effect inside the React style record but
  // nothing else in this emitter writes through that channel.
  const overflowAttr = dims.degenerate ? ` overflow="visible"` : "";

  return `${attrsAndIndent.indent}<svg${attrsAndIndent.dataAttrs}${classAttr} style={${styleSrc}}${overflowAttr} viewBox=${JSON.stringify(viewBox)} preserveAspectRatio="none"${styling.svgFillAttr}${styling.svgStrokeAttrs} xmlns="http://www.w3.org/2000/svg" aria-hidden>${pathElements}</svg>`;
}

type SvgStyling = {
  readonly svgFillAttr: string;
  readonly svgStrokeAttrs: string;
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
    return { svgFillAttr: "", svgStrokeAttrs: "", perPath: false };
  }
  const allStroke = paths.every((p) => p.source === "stroke");
  const allFill = paths.every((p) => p.source !== "stroke");
  if (allStroke) {
    return {
      svgFillAttr: strokeFill ? ` fill=${JSON.stringify(strokeFill)}` : ` fill="none"`,
      svgStrokeAttrs: "",
      perPath: false,
    };
  }
  if (allFill) {
    return {
      svgFillAttr: fill ? ` fill=${JSON.stringify(fill)}` : ` fill="none"`,
      svgStrokeAttrs: renderStrokeAttrs(strokeFill, strokeWidth, dashes),
      perPath: false,
    };
  }
  return { svgFillAttr: "", svgStrokeAttrs: "", perPath: true };
}

function renderPathElement(
  p: { readonly d: string; readonly rule?: string | KiwiEnumValue; readonly source?: "fill" | "stroke" },
  styling: SvgStyling,
  fill: string | undefined,
  strokeFill: string | undefined,
  strokeWidth: number | undefined,
  dashes: readonly number[] | undefined,
): string {
  if (!styling.perPath) {
    return `<path d=${JSON.stringify(p.d)}${windingRuleAttr(p.rule)} />`;
  }
  const fa = perPathFillAttr(p.source, fill, strokeFill);
  const sa = p.source === "stroke" ? "" : renderStrokeAttrs(strokeFill, strokeWidth, dashes);
  return `<path d=${JSON.stringify(p.d)}${fa}${sa}${windingRuleAttr(p.rule)} />`;
}

function perPathFillAttr(
  source: "fill" | "stroke" | undefined,
  fill: string | undefined,
  strokeFill: string | undefined,
): string {
  if (source === "stroke") {
    return strokeFill ? ` fill=${JSON.stringify(strokeFill)}` : ` fill="none"`;
  }
  return fill ? ` fill=${JSON.stringify(fill)}` : ` fill="none"`;
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
  parent: AffineMatrix,
): readonly ComposedPath[] {
  if (isVectorShaped(node)) {
    return collectVectorPaths(node, blobs, index, parent);
  }
  const next = multiplyMatrix(parent, matrixOfNode(node));
  const out: ComposedPath[] = [];
  for (const child of visibleChildren(node)) {
    out.push(...collectComposedPaths(child, blobs, index, next));
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
  const fill = firstSolidColor(node.fillPaints, index);
  const stroke = firstSolidColor(node.strokePaints, index);
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
  for (const child of visibleChildren(container)) {
    out.push(...collectComposedPaths(child, inputs.source.loaded.blobs, inputs.index, IDENTITY_MATRIX));
  }
  return out;
}

function pathAttributesFor(p: ComposedPath): string {
  // Stroke-sourced paths already encode the widened outline; we paint
  // them as a fill using the stroke colour and skip the SVG `stroke`
  // attribute (otherwise the line gets stroked again on top of its
  // own outline and renders at twice the authored thickness).
  if (p.source === "stroke") {
    const fill = p.stroke ? ` fill=${JSON.stringify(p.stroke)}` : ` fill="none"`;
    return `${fill}${windingRuleAttr(p.rule)}${renderMatrixAttr(p.matrix)}`;
  }
  const fill = p.fill ? ` fill=${JSON.stringify(p.fill)}` : ` fill="none"`;
  const stroke = renderStrokeAttrs(p.stroke, p.strokeWidth, p.strokeDashes);
  return `${fill}${stroke}${windingRuleAttr(p.rule)}${renderMatrixAttr(p.matrix)}`;
}

function renderMatrixAttr(m: AffineMatrix): string {
  if (
    Math.abs(m.a - 1) < 1e-9
    && Math.abs(m.b) < 1e-9
    && Math.abs(m.c) < 1e-9
    && Math.abs(m.d - 1) < 1e-9
    && Math.abs(m.e) < 1e-9
    && Math.abs(m.f) < 1e-9
  ) {
    return "";
  }
  if (
    Math.abs(m.a - 1) < 1e-9
    && Math.abs(m.b) < 1e-9
    && Math.abs(m.c) < 1e-9
    && Math.abs(m.d - 1) < 1e-9
  ) {
    return ` transform=${JSON.stringify(`translate(${m.e} ${m.f})`)}`;
  }
  return ` transform=${JSON.stringify(`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`)}`;
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
  styleSrc: string,
  attrsAndIndent: { dataAttrs: string; indent: string },
): string | undefined {
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
  const pathElements = paths
    .map((p) => `<path d=${JSON.stringify(p.d)}${pathAttributesFor(p)} />`)
    .join("");
  return `${attrsAndIndent.indent}<svg${attrsAndIndent.dataAttrs} style={${styleSrc}} viewBox=${JSON.stringify(viewBox)} xmlns="http://www.w3.org/2000/svg" aria-hidden>${pathElements}</svg>`;
}
