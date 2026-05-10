/**
 * @file Compose a Figma BOOLEAN_OPERATION node into a single SwiftUI
 * `Path { ... }`. Plumbs the renderer's path-bool engine: child
 * geometry → SVG d-strings → boolean evaluation → resulting d-strings
 * → PathCommand[] → SwiftUI Path closure.
 *
 * Without this, BOOLEAN_OPERATION nodes fall back to a ZStack of
 * children which paints all silhouettes overlapping rather than
 * the union/subtract/intersect/exclude result. The fallback diff
 * lands in the 17-35% range; the composed result aims for
 * pixel-perfect.
 */
import type {
  FigBlob,
  PathCommand,
} from "@higma-document-models/fig/domain";
import { decodePathCommands } from "@higma-document-models/fig/domain";
import type { FigNode, FigMatrix } from "@higma-document-models/fig/types";
import {
  evaluateBooleanPathResult,
  resolveBooleanOperationType,
  parseSvgPathD,
  type BooleanOperationType,
  type BooleanPathInput,
} from "@higma-document-renderers/fig/scene-graph";
import {
  generateEllipseContour,
  generatePolygonContour,
  generateRectContour,
  generateStarContour,
} from "@higma-document-renderers/fig/scene-graph/convert";
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

/**
 * Try to compose a BOOLEAN_OPERATION node into a single Path. Returns
 * `undefined` when:
 *
 *   - the document blobs aren't available (caller should fall back),
 *   - any child has no decodable geometry (rare; the path-bool engine
 *     would throw), or
 *   - the path engine itself rejects the input.
 *
 * On success, returns a SwiftView leaf carrying a `Path { ... }`
 * with `.fill` / `.stroke` / `.frame` modifiers driven by the
 * BOOLEAN_OPERATION node's own paints.
 */
export function tryComposeBooleanLeaf(
  node: FigNode,
  blobs: readonly FigBlob[] | undefined,
): SwiftView | undefined {
  if (!blobs) {
    return undefined;
  }
  const op = resolveBooleanOperationType(node.booleanOperation);
  const childInputs = collectChildPathInputs(node, blobs);
  if (childInputs.length === 0) {
    return undefined;
  }
  const result = evaluateBooleanPathResult(childInputs, op);
  if (!result.ok) {
    return undefined;
  }
  // Concatenate every result d-string into one PathCommand list and
  // emit it in one Path closure. The result paths are already in the
  // BOOLEAN_OPERATION node's local coord space (relative to its
  // top-left).
  const commands: PathCommand[] = [];
  for (const d of result.paths) {
    for (const cmd of parseSvgPathD(d)) {
      commands.push(cmd);
    }
  }
  if (commands.length === 0) {
    return undefined;
  }
  const pathSrc = swiftPathSource(commands);
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
    return undefined;
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
  // Node-level opacity applies to the composited boolean result —
  // each child has been merged into a single Path, so a single
  // `.opacity(α)` on the leaf attenuates the whole shape uniformly.
  if (typeof node.opacity === "number" && node.opacity !== 1) {
    mods.push(modifier("opacity", [{ value: num(node.opacity) }]));
  }
  return leaf(pathExpr, mods);
}

function collectChildPathInputs(
  node: FigNode,
  blobs: readonly FigBlob[],
): BooleanPathInput[] {
  const out: BooleanPathInput[] = [];
  for (const child of node.children ?? []) {
    if (!child) {
      continue;
    }
    if (child.visible === false) {
      continue;
    }
    // Nested BOOLEAN_OPERATION: recursively evaluate the inner
    // op and flatten its result paths into our input list, each
    // transformed by the nested node's own transform.
    if (child.type.name === "BOOLEAN_OPERATION") {
      const innerOp = resolveBooleanOperationType(child.booleanOperation);
      const innerInputs = collectChildPathInputs(child, blobs);
      if (innerInputs.length === 0) {
        continue;
      }
      const innerResult = evaluateBooleanPathResult(innerInputs, innerOp);
      if (!innerResult.ok) {
        continue;
      }
      for (const d of innerResult.paths) {
        const cmds = parseSvgPathD(d);
        const transformed = applyTransformToCommands(cmds, child.transform);
        const transformedD = pathCommandsToSvgD(transformed);
        if (transformedD.length > 0) {
          out.push({ d: transformedD, windingRule: "nonzero" });
        }
      }
      continue;
    }
    const commands = childCommands(child, blobs);
    if (commands.length === 0) {
      continue;
    }
    const transformedCommands = applyTransformToCommands(commands, child.transform);
    const d = pathCommandsToSvgD(transformedCommands);
    if (d.length === 0) {
      continue;
    }
    out.push({ d, windingRule: "nonzero" });
  }
  return out;
}

/**
 * Read a child's local-space PathCommand list. Order of preference:
 *
 *   1. `fillGeometry` blob (the canonical channel for vector / star
 *      / regular polygon shapes that already carry decoded geometry)
 *   2. Synthesised contour from RECTANGLE / ELLIPSE / STAR /
 *      REGULAR_POLYGON primitives via the renderer's generators
 */
function childCommands(child: FigNode, blobs: readonly FigBlob[]): readonly PathCommand[] {
  const fromBlob = readBlobCommands(child, blobs);
  if (fromBlob.length > 0) {
    return fromBlob;
  }
  const fromPrimitive = synthesisePrimitiveCommands(child);
  return fromPrimitive ?? [];
}

function readBlobCommands(child: FigNode, blobs: readonly FigBlob[]): readonly PathCommand[] {
  const out: PathCommand[] = [];
  for (const geom of child.fillGeometry ?? []) {
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
    for (const cmd of decodePathCommands(blob)) {
      out.push(cmd);
    }
  }
  return out;
}

function synthesisePrimitiveCommands(node: FigNode): readonly PathCommand[] | undefined {
  if (!node.size) {
    return undefined;
  }
  const w = node.size.x;
  const h = node.size.y;
  switch (node.type.name) {
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE": {
      const r = pickUniformCornerRadius(node);
      const contour = generateRectContour(w, h, r ? { topLeft: r, topRight: r, bottomRight: r, bottomLeft: r } : undefined);
      return contour.commands;
    }
    case "ELLIPSE":
      return generateEllipseContour(w, h).commands;
    case "STAR":
      return generateStarContour({
        width: w,
        height: h,
        pointCount: node.pointCount ?? 5,
        innerRadius: node.starInnerRadius,
      }).commands;
    case "REGULAR_POLYGON":
      return generatePolygonContour(w, h, node.pointCount ?? 3).commands;
    default:
      return undefined;
  }
}

function pickUniformCornerRadius(node: FigNode): number | undefined {
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    return node.cornerRadius;
  }
  return undefined;
}

/**
 * Apply the child's transform matrix to each PathCommand so the
 * resulting d-string is in the parent BOOLEAN_OPERATION node's
 * local coord space. Without this, every child's path would land
 * at the parent origin and the boolean result would collapse.
 */
function applyTransformToCommands(
  commands: readonly PathCommand[],
  transform: FigMatrix | undefined,
): readonly PathCommand[] {
  if (!transform) {
    return commands;
  }
  const m00 = transform.m00 ?? 1;
  const m01 = transform.m01 ?? 0;
  const m02 = transform.m02 ?? 0;
  const m10 = transform.m10 ?? 0;
  const m11 = transform.m11 ?? 1;
  const m12 = transform.m12 ?? 0;
  const isIdentity =
    m00 === 1 && m01 === 0 && m02 === 0 && m10 === 0 && m11 === 1 && m12 === 0;
  if (isIdentity) {
    return commands;
  }
  const apply = (x: number, y: number): { readonly x: number; readonly y: number } => ({
    x: m00 * x + m01 * y + m02,
    y: m10 * x + m11 * y + m12,
  });
  return commands.map((cmd) => {
    switch (cmd.type) {
      case "M":
      case "L": {
        const p = apply(cmd.x, cmd.y);
        return { type: cmd.type, x: p.x, y: p.y };
      }
      case "C": {
        const p1 = apply(cmd.x1, cmd.y1);
        const p2 = apply(cmd.x2, cmd.y2);
        const p = apply(cmd.x, cmd.y);
        return {
          type: "C",
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          x: p.x,
          y: p.y,
        };
      }
      case "Q": {
        const p1 = apply(cmd.x1, cmd.y1);
        const p = apply(cmd.x, cmd.y);
        return { type: "Q", x1: p1.x, y1: p1.y, x: p.x, y: p.y };
      }
      case "A": {
        const p = apply(cmd.x, cmd.y);
        return { ...cmd, x: p.x, y: p.y };
      }
      case "Z":
        return cmd;
    }
  });
}

/**
 * Serialise a PathCommand list as an SVG path `d` attribute. Used
 * as input to the path-bool engine which speaks SVG d-strings.
 */
function pathCommandsToSvgD(commands: readonly PathCommand[]): string {
  const parts: string[] = [];
  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        parts.push(`M ${num6(cmd.x)} ${num6(cmd.y)}`);
        break;
      case "L":
        parts.push(`L ${num6(cmd.x)} ${num6(cmd.y)}`);
        break;
      case "C":
        parts.push(
          `C ${num6(cmd.x1)} ${num6(cmd.y1)} ${num6(cmd.x2)} ${num6(cmd.y2)} ${num6(cmd.x)} ${num6(cmd.y)}`,
        );
        break;
      case "Q":
        parts.push(`Q ${num6(cmd.x1)} ${num6(cmd.y1)} ${num6(cmd.x)} ${num6(cmd.y)}`);
        break;
      case "A":
        parts.push(
          `A ${num6(cmd.rx)} ${num6(cmd.ry)} ${num6(cmd.rotation)} ${cmd.largeArc ? 1 : 0} ${cmd.sweep ? 1 : 0} ${num6(cmd.x)} ${num6(cmd.y)}`,
        );
        break;
      case "Z":
        parts.push("Z");
        break;
    }
  }
  return parts.join(" ");
}

/** Render the Path-builder closure body for a sequence of commands. */
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
        // SVG-arc → straight-line approximation. Boolean results
        // very rarely emit arcs (the path-bool engine renders them
        // as cubic curves), so this fallback is mostly cosmetic.
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

function num6(v: number): string {
  if (Number.isInteger(v)) {
    return String(v);
  }
  return Number(v.toFixed(6)).toString();
}

function cgFloat(v: number): string {
  return num6(v);
}

// `BooleanOperationType` is referenced via the result-type union
// only; export it indirectly through this `void` to avoid a
// "declared but never read" diagnostic if a future caller wants
// the named type.
void (undefined as BooleanOperationType | undefined);
