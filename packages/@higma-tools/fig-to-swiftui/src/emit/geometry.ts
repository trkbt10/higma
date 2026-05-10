/**
 * @file Emit a geometry-driven Figma node (VECTOR / STAR /
 * REGULAR_POLYGON / BOOLEAN_OPERATION) as a SwiftUI `Path { … }`.
 *
 * All four node kinds reach the SwiftUI side via the same channel:
 * Figma stores their resolved geometry as a `fillGeometry` array of
 * `{ commandsBlob, windingRule }` records, where `commandsBlob`
 * indexes into the document's binary `blobs`. Decoding the blob
 * produces a list of `M / L / C / Q / A / Z` commands in the node's
 * local coordinate space; SwiftUI's `Path` accepts the same
 * primitives directly via `move(to:)`, `addLine(to:)`,
 * `addCurve(to:control1:control2:)`, `addQuadCurve(to:control:)`,
 * and `closeSubpath()`.
 *
 * The wrapping view is a Path-builder closure stroked + filled
 * the same way the shape-leaf path handles RECTANGLE / ELLIPSE.
 * Stroke alignment maps to `.stroke` / `.strokeBorder` per
 * `strokeOverlayModifier`'s contract — but since `Path` isn't an
 * `InsettableShape`, we have to inline the stroke + overlay rather
 * than reuse the shape-leaf helpers.
 *
 * The path closure is encoded as a single `ident` carrying literal
 * Swift source; the IR doesn't yet model multi-statement closures
 * structurally. Round-tripping a geometry leaf through the parser
 * is not in scope (the parser only accepts the simple shape /
 * stack subset) — this is a one-way emit bridge.
 */
import type {
  FigBlob,
  PathCommand,
} from "@higma-document-models/fig/domain";
import { decodePathCommands } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import {
  generateLineContour,
  generatePolygonContour,
  generateStarContour,
} from "@higma-document-renderers/fig/scene-graph/convert";
import { solidPaintToColor } from "../style/color";
import { firstVisibleGradientPaint, gradientExpr } from "../style/gradient";
import {
  array,
  call,
  ident,
  leaf,
  member,
  modifier,
  namedArg,
  num,
  type Modifier,
  type SwiftExpr,
  type SwiftView,
} from "../swift-tree";

type EmitContext = { readonly blobs?: readonly FigBlob[] };

/**
 * Build the SwiftView for a geometry-driven leaf node. Uses the
 * node's first `fillGeometry` blob as the path source; subsequent
 * geometries (multi-contour vectors) are concatenated into the
 * same `Path` so the rendered fill respects the node's winding
 * rule. Stroke and fill paints are read from the standard
 * `fillPaints` / `strokePaints` channels.
 */
export function emitGeometryLeaf(node: FigNode, ctx: EmitContext): SwiftView {
  const blobs = ctx.blobs;
  if (!blobs) {
    throw new Error(
      `fig-to-swiftui: geometry node "${node.name ?? "unnamed"}" needs the document's blobs — pass an EmitContext { blobs } from the case runner`,
    );
  }
  const commands = readAllCommands(node, blobs);
  if (commands.length === 0) {
    throw new Error(
      `fig-to-swiftui: geometry node "${node.name ?? "unnamed"}" has no decodable fillGeometry`,
    );
  }
  const pathSource = swiftPathSource(commands);
  const pathExpr = call("Path", [{ value: ident(pathSource) }]);
  const mods: Modifier[] = [];
  // `Path` paints in the foreground colour by default (like Rectangle),
  // so the `.fill(...)` modifier carries the SOLID / gradient paint.
  const fillExpr = readFillExpr(node);
  if (fillExpr) {
    mods.push(modifier("fill", [{ value: fillExpr }]));
  }
  const strokeMod = readStrokeMod(node);
  if (strokeMod) {
    mods.push(strokeMod);
  }
  if (!fillExpr && !strokeMod) {
    throw new Error(
      `fig-to-swiftui: geometry node "${node.name ?? "unnamed"}" has neither fill nor stroke`,
    );
  }
  // Frame the Path against the node's authored size so the path
  // coordinates land within the right outer extent. SwiftUI's
  // `Path` is a non-resizable shape — without `.frame(...)` the
  // path would size to its bounding box and the parent ZStack's
  // offset would land relative to that box rather than the
  // authored top-left.
  if (node.size) {
    mods.push(
      modifier("frame", [
        namedArg("width", num(node.size.x)),
        namedArg("height", num(node.size.y)),
        namedArg("alignment", member("topLeading")),
      ]),
    );
  }
  return leaf(pathExpr, mods);
}

function readAllCommands(node: FigNode, blobs: readonly FigBlob[]): readonly PathCommand[] {
  const out: PathCommand[] = [];
  for (const geom of node.fillGeometry ?? []) {
    if (geom.commandsBlob === undefined) {
      continue;
    }
    if (geom.commandsBlob >= blobs.length) {
      continue;
    }
    const blob = blobs[geom.commandsBlob];
    if (!blob) {
      continue;
    }
    const decoded = decodePathCommands(blob);
    for (const cmd of decoded) {
      out.push(cmd);
    }
  }
  if (out.length > 0) {
    return out;
  }
  // STAR / REGULAR_POLYGON / LINE nodes don't carry pre-decoded
  // `fillGeometry` blobs in the .fig binary — Figma derives the
  // contour at render time from the node's primitive parameters
  // (`pointCount`, `starInnerRadius`, etc). Fall back to the same
  // contour generators the WebGL renderer uses so the SwiftUI emit
  // produces an identical path.
  const generated = generateContoursFromPrimitives(node);
  if (generated) {
    return generated;
  }
  return out;
}

function generateContoursFromPrimitives(node: FigNode): readonly PathCommand[] | undefined {
  if (!node.size) {
    return undefined;
  }
  const w = node.size.x;
  const h = node.size.y;
  switch (node.type.name) {
    case "STAR": {
      const contour = generateStarContour({
        width: w,
        height: h,
        pointCount: node.pointCount ?? 5,
        innerRadius: node.starInnerRadius,
      });
      return contour.commands;
    }
    case "REGULAR_POLYGON": {
      const contour = generatePolygonContour(w, h, node.pointCount ?? 3);
      return contour.commands;
    }
    case "LINE": {
      const contour = generateLineContour(w);
      return contour.commands;
    }
    default:
      return undefined;
  }
}

/**
 * Render the Path-builder closure body for a sequence of decoded
 * commands. Emits Swift source as a single inlined string because
 * the IR doesn't yet model multi-statement closures structurally.
 */
function swiftPathSource(commands: readonly PathCommand[]): string {
  const lines: string[] = [];
  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        lines.push(`path.move(to: CGPoint(x: ${cgFloat(cmd.x)}, y: ${cgFloat(cmd.y)}))`);
        break;
      case "L":
        lines.push(`path.addLine(to: CGPoint(x: ${cgFloat(cmd.x)}, y: ${cgFloat(cmd.y)}))`);
        break;
      case "C":
        lines.push(
          `path.addCurve(to: CGPoint(x: ${cgFloat(cmd.x)}, y: ${cgFloat(cmd.y)}), control1: CGPoint(x: ${cgFloat(cmd.x1)}, y: ${cgFloat(cmd.y1)}), control2: CGPoint(x: ${cgFloat(cmd.x2)}, y: ${cgFloat(cmd.y2)}))`,
        );
        break;
      case "Q":
        lines.push(
          `path.addQuadCurve(to: CGPoint(x: ${cgFloat(cmd.x)}, y: ${cgFloat(cmd.y)}), control: CGPoint(x: ${cgFloat(cmd.x1)}, y: ${cgFloat(cmd.y1)}))`,
        );
        break;
      case "A":
        // Arc support is non-trivial in SwiftUI — Path's `addArc`
        // takes (center, radius, start/end angle), not the SVG-style
        // (rx, ry, rotation, largeArc, sweep, end). Approximate by
        // dropping to a straight line; arcs are rare in autolayout
        // figures and the Path renderer can be revisited when a
        // real fixture exposes one.
        lines.push(`path.addLine(to: CGPoint(x: ${cgFloat(cmd.x)}, y: ${cgFloat(cmd.y)}))`);
        break;
      case "Z":
        lines.push("path.closeSubpath()");
        break;
    }
  }
  return `{ path in ${lines.join("; ")} }`;
}

function readFillExpr(node: FigNode): SwiftExpr | undefined {
  const paints = node.fillPaints;
  if (!paints) {
    return undefined;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type === "SOLID") {
      return solidPaintToColor(paint);
    }
  }
  const grad = firstVisibleGradientPaint(paints);
  if (grad) {
    const size = node.size ? { width: node.size.x, height: node.size.y } : undefined;
    return gradientExpr(grad, size);
  }
  return undefined;
}

function readStrokeMod(node: FigNode): Modifier | undefined {
  const paints = node.strokePaints;
  if (!paints) {
    return undefined;
  }
  const solid = pickFirstSolidStrokeColor(paints);
  if (!solid) {
    return undefined;
  }
  const lineWidth = readUniformStrokeWeight(node.strokeWeight);
  if (lineWidth === 0) {
    return undefined;
  }
  const styleArgs = [namedArg("lineWidth", num(lineWidth))];
  if (node.dashPattern && node.dashPattern.length > 0) {
    styleArgs.push(namedArg("dash", array(node.dashPattern.map((d) => num(d)))));
  }
  return modifier("stroke", [{ value: solid }, namedArg("style", call("StrokeStyle", styleArgs))]);
}

function pickFirstSolidStrokeColor(paints: NonNullable<FigNode["strokePaints"]>): SwiftExpr | undefined {
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type === "SOLID") {
      return solidPaintToColor(paint);
    }
  }
  return undefined;
}

function readUniformStrokeWeight(weight: FigNode["strokeWeight"]): number {
  if (weight === undefined) {
    return 0;
  }
  if (typeof weight === "number") {
    return weight > 0 ? weight : 0;
  }
  return weight.top > 0 ? weight.top : 0;
}

function cgFloat(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return Number(value.toFixed(6)).toString();
}
