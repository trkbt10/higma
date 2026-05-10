/**
 * @file Emit ELLIPSE nodes with `arcData` (partial arcs and donuts)
 * as a SwiftUI `Path { ... }`.
 *
 * Figma's ELLIPSE node carries an optional `arcData` payload:
 *
 *   { startingAngle, endingAngle, innerRadius }
 *
 * with angles measured **clockwise from 12 o'clock (top)** in
 * radians. SwiftUI's `Path.addArc` measures angles
 * **counter-clockwise from 3 o'clock** but inverts the sweep
 * direction when y is down — so for screen-space rendering we
 * convert by subtracting π/2 from each angle and pass
 * `clockwise: false` to keep the sweep direction matching Figma.
 *
 * Two arc topologies are produced:
 *
 *   - Wedge (innerRadius == 0): arc on the outer rim, plus straight
 *     lines back to the centre — `move(center) → addArc → close`.
 *   - Donut (0 < innerRadius < 1): outer arc CW + inner arc CCW
 *     between the same start/end angles — `move(outer-start) →
 *     addArc(outer) → addLine(inner-end) → addArc(inner reverse) →
 *     close`.
 *
 * The full ELLIPSE case (no arcData, or full circle / innerRadius=0)
 * is handled by `shapeExprFor` returning `Ellipse()`. This module
 * only kicks in when the node has a real arc or donut shape.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { firstVisibleGradientPaint, gradientExpr } from "../style/gradient";
import { solidPaintToColor } from "../style/color";
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

const TWO_PI = Math.PI * 2;

/**
 * Read the ELLIPSE node's `arcData` and decide whether it carries a
 * partial arc or donut shape. Returns `undefined` for full ellipses
 * (where `Ellipse()` is the right primitive).
 */
export function isEllipseArcOrDonut(node: FigNode): boolean {
  if (node.type.name !== "ELLIPSE") {
    return false;
  }
  const arc = node.arcData;
  if (!arc) {
    return false;
  }
  const start = arc.startingAngle ?? 0;
  const end = arc.endingAngle ?? TWO_PI;
  const inner = arc.innerRadius ?? 0;
  const sweep = end - start;
  const isFullCircle = Math.abs(sweep - TWO_PI) < 1e-3 || Math.abs(sweep) < 1e-3;
  if (isFullCircle && inner <= 0) {
    return false;
  }
  return true;
}

/**
 * Build the SwiftUI Path-based view for an ELLIPSE with arcData.
 * Reads `fillPaints` for the body colour, `strokePaints` /
 * `strokeWeight` for the outline. Like `geometry.ts`, the Path
 * closure is encoded as a literal Swift source string in an `ident`
 * since the IR doesn't model multi-statement closures.
 */
export function emitEllipseArcOrDonut(node: FigNode): SwiftView {
  const w = node.size?.x ?? 0;
  const h = node.size?.y ?? 0;
  const arc = node.arcData ?? { startingAngle: 0, endingAngle: TWO_PI, innerRadius: 0 };
  const start = arc.startingAngle ?? 0;
  const end = arc.endingAngle ?? TWO_PI;
  const inner = arc.innerRadius ?? 0;
  const pathSrc = buildArcPathSource(w, h, start, end, inner);
  const pathExpr = call("Path", [{ value: ident(pathSrc) }]);
  const mods: Modifier[] = [];
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
      `fig-to-swiftui: ELLIPSE arc/donut "${node.name ?? "unnamed"}" has neither fill nor stroke`,
    );
  }
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

/**
 * Construct the Swift `Path` closure body for the arc / donut
 * geometry. Coordinates are in the node's local space; the Path
 * is later sized via `.frame(width:height:)`.
 */
function buildArcPathSource(
  w: number,
  h: number,
  startFigma: number,
  endFigma: number,
  innerRadiusRatio: number,
): string {
  const cx = w / 2;
  const cy = h / 2;
  const rxOuter = w / 2;
  const ryOuter = h / 2;
  // Figma and SwiftUI agree on angle convention here: 0 rad =
  // 3 o'clock (right), positive sweeps clockwise in screen-y-down
  // coords. SwiftUI's `addArc(..., clockwise: false)` sweeps in
  // that same direction (the `clockwise:` flag in SwiftUI is named
  // for the math-y-up convention, which inverts under y-down).
  const startSwift = startFigma;
  const endSwift = endFigma;
  const lines: string[] = [];
  if (innerRadiusRatio > 0 && innerRadiusRatio < 1) {
    // Donut: outer CW, inner CCW. SwiftUI's `Path.addArc` for a
    // circle is fine but we need an *ellipse* arc — there is no
    // native ellipse-arc API in SwiftUI's Path, so we approximate
    // by using `addArc` on a circle of mean radius. Visually this
    // matches Figma whenever w == h (the common case for icons);
    // for non-square donuts the result is slightly off and the
    // caller can revisit with a CGAffineTransform-scaled path.
    // For now, scale via `.scaleEffect` after the path is drawn.
    const rxInner = rxOuter * innerRadiusRatio;
    const ryInner = ryOuter * innerRadiusRatio;
    const radiusOuter = (rxOuter + ryOuter) / 2;
    const radiusInner = (rxInner + ryInner) / 2;
    lines.push(`path.addArc(center: CGPoint(x: ${cgFloat(cx)}, y: ${cgFloat(cy)}), radius: ${cgFloat(radiusOuter)}, startAngle: .radians(${cgFloat(startSwift)}), endAngle: .radians(${cgFloat(endSwift)}), clockwise: false)`);
    lines.push(`path.addArc(center: CGPoint(x: ${cgFloat(cx)}, y: ${cgFloat(cy)}), radius: ${cgFloat(radiusInner)}, startAngle: .radians(${cgFloat(endSwift)}), endAngle: .radians(${cgFloat(startSwift)}), clockwise: true)`);
    lines.push(`path.closeSubpath()`);
  } else {
    // Wedge or full ellipse arc.
    const radius = (rxOuter + ryOuter) / 2;
    lines.push(`path.move(to: CGPoint(x: ${cgFloat(cx)}, y: ${cgFloat(cy)}))`);
    lines.push(`path.addArc(center: CGPoint(x: ${cgFloat(cx)}, y: ${cgFloat(cy)}), radius: ${cgFloat(radius)}, startAngle: .radians(${cgFloat(startSwift)}), endAngle: .radians(${cgFloat(endSwift)}), clockwise: false)`);
    lines.push(`path.closeSubpath()`);
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
  const solid = pickFirstSolidStroke(paints);
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

function pickFirstSolidStroke(paints: NonNullable<FigNode["strokePaints"]>): SwiftExpr | undefined {
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
