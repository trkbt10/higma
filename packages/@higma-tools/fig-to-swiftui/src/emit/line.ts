/**
 * @file Emit a Figma LINE node as a SwiftUI `Path { … }.stroke(…)`.
 *
 * LINE in Figma is always a 1D segment along the local x-axis (its
 * `size.y` is 0). The shape carries `strokePaints` and `strokeWeight`;
 * `fillPaints` are unused. To realise that in SwiftUI we draw a
 * `Path` with a single `move(to:) + addLine(to:)` from `(0, 0)` to
 * `(size.x, 0)` and stroke it with the node's stroke color, weight,
 * and (optional) dash pattern.
 *
 * The 0-height frame is preserved via `.frame(width: size.x, height:
 * 0, alignment: .topLeading)` so the rotation around `.topLeading` and
 * the parent ZStack's offset position the line correctly. SwiftUI
 * paints the stroke half above and half below the y=0 axis,
 * matching Figma's CENTER stroke alignment (the only alignment a
 * LINE supports).
 */
import type { FigNode, FigStrokeWeight } from "@higma-document-models/fig/types";
import { asSolidPaint } from "@higma-document-models/fig/color";
import { solidPaintToColor } from "../style/color";
import { rotationModifier } from "../style/modifiers";
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
  type SwiftView,
} from "../swift-tree";

const LINE_TYPE = "LINE";

/** True when the node is a Figma LINE primitive. */
export function isLineNode(node: FigNode): boolean {
  return node.type.name === LINE_TYPE;
}

/**
 * Emit the SwiftUI view that paints a Figma LINE.
 *
 * The path-construction closure uses the explicit
 * `{ (path: inout Path) in … }` form rather than the trailing-closure
 * convenience because the IR builder doesn't yet model trailing
 * closures — emitting an explicit closure expression keeps the
 * source within the existing SwiftCallArg grammar. The serializer
 * prints `{ inputName in body }` from a regular `call` whose callee
 * is the literal closure-syntax string.
 */
export function emitLineLeaf(node: FigNode): SwiftView {
  const stroke = pickFirstSolidStroke(node);
  if (!stroke) {
    throw new Error(
      `fig-to-swiftui: LINE node "${node.name ?? "unnamed"}" has no SOLID stroke`,
    );
  }
  const widthValue = node.size?.x ?? 0;
  const lineWidth = readUniformStrokeWeight(node.strokeWeight);
  const color = solidPaintToColor(stroke);
  // SwiftUI clips a `Path` rendered into a 0-height frame to
  // nothing visible. Frame the line as `widthValue × lineWidth`
  // (so the stroke's full vertical extent fits) and place the
  // path at `y = lineWidth/2` so the centred stroke hits the
  // middle of that box. Then `.offset(y: -lineWidth/2)` aligns the
  // stroke's centreline back to Figma's authored y=0 — the LINE
  // node's transform.m12 already lands the centre line at the
  // authored y, and a stroke-on-y=0 in Figma is rendered with the
  // strokeWidth distributed half above / half below.
  const yMid = lineWidth / 2;
  const pathClosure = ident(
    `{ path in path.move(to: CGPoint(x: 0, y: ${printCgFloat(yMid)})); path.addLine(to: CGPoint(x: ${printCgFloat(widthValue)}, y: ${printCgFloat(yMid)})) }`,
  );
  const styleArgs = [namedArg("lineWidth", num(lineWidth))];
  if (node.dashPattern && node.dashPattern.length > 0) {
    styleArgs.push(namedArg("dash", array(node.dashPattern.map((d) => num(d)))));
  }
  const strokeStyle = call("StrokeStyle", styleArgs);
  const mods: Modifier[] = [
    modifier("stroke", [{ value: color }, namedArg("style", strokeStyle)]),
    modifier("frame", [
      namedArg("width", num(widthValue)),
      namedArg("height", num(lineWidth)),
      namedArg("alignment", member("topLeading")),
    ]),
    modifier("offset", [namedArg("x", num(0)), namedArg("y", num(-lineWidth / 2))]),
  ];
  // Figma's LINE is authored as a horizontal segment along the local
  // x-axis; the on-canvas direction is encoded in `node.transform`'s
  // rotation block. The path emitted above is also horizontal, so we
  // need to apply that rotation explicitly. `rotationModifier` reads
  // the matrix's `(m00, m10)` and emits `.rotationEffect(.degrees(θ),
  // anchor: .topLeading)` — the same anchor we use for shape leaves
  // so the parent ZStack's `.offset(x: m02, y: m12)` lands the line's
  // start point at the authored position.
  const rotation = rotationModifier(node);
  if (rotation) {
    mods.push(rotation);
  }
  return leaf(call("Path", [{ value: pathClosure }]), mods);
}

function pickFirstSolidStroke(node: FigNode) {
  const paints = node.strokePaints;
  if (!paints) {
    return undefined;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    const solidPaint = asSolidPaint(paint);
    if (solidPaint !== undefined) {
      return solidPaint;
    }
  }
  return undefined;
}

function readUniformStrokeWeight(weight: FigStrokeWeight | undefined): number {
  if (weight === undefined) {
    return 1;
  }
  if (typeof weight === "number") {
    return weight > 0 ? weight : 1;
  }
  // Per-side weights aren't authorable on a LINE in the Figma UI;
  // fall back to the top weight if a per-side shape ever arrives.
  return weight.top > 0 ? weight.top : 1;
}

function printCgFloat(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  // Up to six significant digits, trimmed trailing zeros — matches
  // the `printNumber` convention used by the serializer.
  return Number(value.toFixed(6)).toString();
}
