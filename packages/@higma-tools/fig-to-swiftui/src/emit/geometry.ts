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
  arg,
  array,
  call,
  ident,
  leaf,
  member,
  modifier,
  namedArg,
  num,
  viewExpr,
  type Modifier,
  type SwiftExpr,
  type SwiftView,
} from "../swift-tree";

type EmitContext = { readonly blobs?: readonly FigBlob[] };

/**
 * Single-modifier list that frames the node to its authored size.
 * Used by the empty-path fallback so the placeholder leaf still
 * occupies the correct slot in the parent's layout — without the
 * `.frame(...)` an empty `Path` would size to zero and shift the
 * surrounding ZStack's offsets.
 */
function framedNodeMods(node: FigNode): readonly Modifier[] {
  if (!node.size) {
    return [];
  }
  return [
    modifier("frame", [
      namedArg("width", num(node.size.x)),
      namedArg("height", num(node.size.y)),
      namedArg("alignment", member("topLeading")),
    ]),
  ];
}

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
    // Real fig files occasionally carry geometry nodes whose
    // commands blob is missing (e.g. a stroke-only path that has
    // already been flattened upstream). Rather than fail-fast on
    // these — which would break emit for an entire frame because
    // of one malformed node — emit a frame-sized empty `Path`.
    // The result is invisible at the leaf, and any sibling content
    // still renders. Surfaces the problem to the consumer via the
    // empty Path while keeping the CLI usable for one-shot exports
    // where one missing path is preferable to a hard failure.
    return leaf(
      call("Path", [{ value: ident("{ _ in }") }]),
      framedNodeMods(node),
    );
  }
  const pathSource = swiftPathSource(commands);
  const pathExpr = call("Path", [{ value: ident(pathSource) }]);
  const mods: Modifier[] = [];
  // `Path` paints in the foreground colour by default (like Rectangle),
  // so the `.fill(...)` modifier carries the SOLID / gradient paint.
  //
  // When both fill AND stroke are present, we cannot just chain
  // `.fill(...).stroke(...)` — `.fill(_:)` returns a `View` (not a
  // `Shape`), so `.stroke(...)` afterwards is a type error. The
  // correct shape is `<path>.fill(<paint>).overlay(<path-clone>.stroke(<paint>))`,
  // which renders the fill behind and the stroke on top of the same
  // silhouette. We re-emit the path closure inside the overlay so
  // SwiftUI evaluates two independent `Path` shapes (the closure
  // body is value-stable, just slightly more verbose).
  //
  // Fill rule note: SwiftUI's default `.fill(_:)` uses the
  // non-zero winding rule, which paints both an outer loop and
  // an inner counter-loop as one solid blob. Win98 chrome icons
  // (the maximize / minimize / close glyphs, the menu underline
  // brackets, etc.) encode "hollow square" shapes as an outer
  // loop + inner loop in a single fig VECTOR — that requires
  // even-odd to render hollow. We pick `eoFill: true` whenever
  // the path contains more than one `move` command (i.e. ≥2
  // subpaths). Single-subpath paths keep the default winding
  // rule because non-zero is the SVG `fill-rule: nonzero`
  // default and matches the figma renderer for ordinary fills.
  const fillExpr = readFillExpr(node);
  const strokeMod = readStrokeMod(node);
  const fillArgs = (paint: SwiftExpr) => buildFillArgs(paint, commands);
  if (fillExpr && strokeMod) {
    mods.push(modifier("fill", fillArgs(fillExpr)));
    const strokeOverlayPath = call("Path", [{ value: ident(pathSource) }]);
    const strokedView = leaf(strokeOverlayPath, [strokeMod]);
    mods.push(modifier("overlay", [arg(viewExpr(strokedView))]));
  } else if (fillExpr) {
    mods.push(modifier("fill", fillArgs(fillExpr)));
  } else if (strokeMod) {
    mods.push(strokeMod);
  }
  if (!fillExpr && !strokeMod) {
    // Real fig files sometimes carry geometry nodes with no
    // visible paint (e.g. mask layers that the upstream pipeline
    // already absorbed into a `.mask(...)` modifier on a sibling).
    // Emit a frame-sized empty Path rather than throwing, mirroring
    // the no-decodable-commands fallback above.
    if (node.size) {
      mods.push(
        modifier("frame", [
          namedArg("width", num(node.size.x)),
          namedArg("height", num(node.size.y)),
          namedArg("alignment", member("topLeading")),
        ]),
      );
    }
    return leaf(call("Path", [{ value: ident("{ _ in }") }]), mods);
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

function decodeBlobList(
  geometries: readonly { readonly commandsBlob?: number }[] | undefined,
  blobs: readonly FigBlob[],
): readonly PathCommand[] {
  const out: PathCommand[] = [];
  for (const geom of geometries ?? []) {
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
  return out;
}

function readAllCommands(node: FigNode, blobs: readonly FigBlob[]): readonly PathCommand[] {
  const fillCommands = decodeBlobList(node.fillGeometry, blobs);
  if (fillCommands.length > 0) {
    return fillCommands;
  }
  // Real-world fig files (e.g. text-decoration underlines, stroke-
  // only icon strokes) frequently carry only `strokeGeometry`, not
  // `fillGeometry` — Figma stores the path differently when the
  // shape is intended to be stroked rather than filled. Fall back
  // to the stroke channel so the emitter doesn't fail-fast on these
  // perfectly valid nodes. The path commands are the same shape;
  // the only difference is which paint channel renders them.
  const strokeCommands = decodeBlobList(node.strokeGeometry, blobs);
  if (strokeCommands.length > 0) {
    return strokeCommands;
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
  return [];
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
 * Build the argument list for the SwiftUI `.fill(...)` modifier
 * emitted on a `Path`. When the path body contains more than one
 * `move` command we treat it as a multi-subpath silhouette (outer
 * loop + inner loop for a hollow square, etc.) and switch the
 * fill rule to even-odd so SwiftUI carves the inner region out
 * of the outer one. Single-subpath paths keep the default
 * non-zero winding rule, matching SVG `fill-rule: nonzero` and
 * the figma renderer's default.
 *
 * Emitted Swift forms:
 *
 *   .fill(<paint>)                                       single subpath
 *   .fill(<paint>, style: FillStyle(eoFill: true))       multi subpath
 */
export function buildFillArgs(
  paint: SwiftExpr,
  commands: readonly PathCommand[],
): readonly { readonly name?: string; readonly value: SwiftExpr }[] {
  const head: { value: SwiftExpr } = { value: paint };
  if (countSubpaths(commands) <= 1) {
    return [head];
  }
  return [head, namedArg("style", ident("FillStyle(eoFill: true)"))];
}

/**
 * Count distinct subpaths in a decoded command list. Every `M`
 * (`move`) instruction starts a new subpath; the leading `M`
 * counts as the first one, so a path with two `M` commands has
 * two subpaths. Paths without any `M` (e.g. an empty geometry
 * blob) are treated as 0 subpaths and the caller falls back to
 * the non-zero default.
 */
export function countSubpaths(commands: readonly PathCommand[]): number {
  return commands.reduce((n, cmd) => (cmd.type === "M" ? n + 1 : n), 0);
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
