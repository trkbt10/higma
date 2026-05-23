/**
 * @file Figma SVG export numeric precision serialization.
 *
 * Figma's SVG exporter quantizes numeric geometry by exported viewport
 * position. This module applies that export-boundary serialization while
 * serializing the structured SVG element tree produced by scene-renderer.
 */

import { unsafeSvg, type SvgString } from "./primitives";
import {
  serializeSvgNode,
  type SvgAttributeValue,
  type SvgAttributes,
  type SvgElementNode,
  type SvgNode,
} from "./element-primitives";

type ExportPoint = {
  readonly x: number;
  readonly y: number;
};

type TranslationScope = {
  readonly tx: number;
  readonly ty: number;
  readonly txRaw: number;
  readonly tyRaw: number;
};

type TranslationTransform = {
  readonly kind: "matrix" | "translate";
  readonly dx: number;
  readonly dy: number;
};

type RewrittenTranslation = {
  readonly attrs: SvgAttributes;
  readonly scope: TranslationScope;
};

const SVG_X_POSITION_ATTRIBUTES = new Set(["x", "cx", "x1", "x2", "fx"]);
const SVG_Y_POSITION_ATTRIBUTES = new Set(["y", "cy", "y1", "y2", "fy"]);
const SVG_SIZE_ATTRIBUTES = new Set(["width", "height", "r", "rx", "ry", "stroke-width", "fill-opacity", "stroke-opacity", "opacity"]);
const SVG_PRECISION_TAG_NAMES = new Set(["path", "rect", "circle", "ellipse", "linearGradient", "radialGradient", "line", "stop", "filter", "mask"]);
const PLAIN_SVG_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Serialize a structured SVG tree with Figma-compatible export precision.
 */
export function serializeFigmaExportSvg(root: SvgNode): SvgString {
  return unsafeSvg(serializeSvgNode(applyFigmaExportSvgPrecision(root)));
}

/**
 * Apply Figma-compatible export precision to a structured SVG tree.
 *
 * React SVG rendering and string serialization both consume this same
 * structured result, so DOM-backed editor pixels and exported SVG text
 * do not diverge on coordinate quantization.
 */
export function applyFigmaExportSvgPrecision(root: SvgNode): SvgNode {
  if (root.kind !== "element" || root.name !== "svg") {
    throw new Error("serializeFigmaExportSvg requires an <svg> root element");
  }
  const viewportOrigin = readSvgExportViewportOrigin(root);
  const stack: TranslationScope[] = [{ tx: 0, ty: 0, txRaw: 0, tyRaw: 0 }];
  const projected = precisionNode(root, stack, viewportOrigin);
  if (stack.length !== 1) {
    throw new Error("serializeFigmaExportSvg found unclosed SVG group scopes");
  }
  return projected;
}

function precisionNode(
  node: SvgNode,
  stack: TranslationScope[],
  viewportOrigin: ExportPoint,
): SvgNode {
  if (node.kind === "text") {
    return node;
  }
  if (node.kind === "fragment") {
    return {
      ...node,
      children: node.children.map((child) => precisionNode(child, stack, viewportOrigin)),
    };
  }
  if (node.name === "g") {
    return precisionGroupNode(node, stack, viewportOrigin);
  }
  return precisionElementNode(node, currentScope(stack), stack, viewportOrigin);
}

function precisionGroupNode(
  node: SvgElementNode,
  stack: TranslationScope[],
  viewportOrigin: ExportPoint,
): SvgElementNode {
  const parent = currentScope(stack);
  const rewritten = rewriteTranslationScope(node.attrs, parent, viewportOrigin);
  const attrs = roundCoordinateAttributes(rewritten.attrs, parent, viewportOrigin);
  stack.push(rewritten.scope);
  const children = node.children.map((child) => precisionNode(child, stack, viewportOrigin));
  stack.pop();
  return { ...node, attrs, children };
}

function precisionElementNode(
  node: SvgElementNode,
  parent: TranslationScope,
  stack: TranslationScope[],
  viewportOrigin: ExportPoint,
): SvgElementNode {
  const attrs = precisionAttributes(node, parent, viewportOrigin);
  const children = node.children.map((child) => precisionNode(child, stack, viewportOrigin));
  return { ...node, attrs, children };
}

function precisionAttributes(
  node: SvgElementNode,
  parent: TranslationScope,
  viewportOrigin: ExportPoint,
): SvgAttributes {
  if (!SVG_PRECISION_TAG_NAMES.has(node.name)) {
    return node.attrs;
  }
  return roundCoordinateAttributes(precisionSourceAttributes(node, parent, viewportOrigin), parent, viewportOrigin);
}

function precisionSourceAttributes(
  node: SvgElementNode,
  parent: TranslationScope,
  viewportOrigin: ExportPoint,
): SvgAttributes {
  if (node.name === "path") {
    return rewritePathAttribute(node.attrs, parent, viewportOrigin);
  }
  return node.attrs;
}

function currentScope(stack: readonly TranslationScope[]): TranslationScope {
  const scope = stack[stack.length - 1];
  if (scope === undefined) {
    throw new Error("serializeFigmaExportSvg lost its SVG group scope");
  }
  return scope;
}

function rewriteTranslationScope(
  attrs: SvgAttributes,
  parent: TranslationScope,
  viewportOrigin: ExportPoint,
): RewrittenTranslation {
  const transform = readStringAttribute(attrs, "transform");
  const translation = readTranslationTransform(transform);
  if (translation === undefined) {
    return { attrs, scope: parent };
  }
  const newDx = roundExportPosition(parent.txRaw + translation.dx, "x", viewportOrigin) - parent.tx;
  const newDy = roundExportPosition(parent.tyRaw + translation.dy, "y", viewportOrigin) - parent.ty;
  const rewrittenTransform = formatTranslationTransform(translation.kind, newDx, newDy);
  return {
    attrs: { ...attrs, transform: rewrittenTransform },
    scope: {
      tx: parent.tx + newDx,
      ty: parent.ty + newDy,
      txRaw: parent.txRaw + translation.dx,
      tyRaw: parent.tyRaw + translation.dy,
    },
  };
}

function readTranslationTransform(value: string | undefined): TranslationTransform | undefined {
  if (value === undefined) {
    return undefined;
  }
  const matrixMatch = /^matrix\(1,0,0,1,(-?[\d.]+),(-?[\d.]+)\)$/.exec(value);
  if (matrixMatch !== null) {
    return {
      kind: "matrix",
      dx: parseFiniteSvgNumber(matrixMatch[1], "matrix tx"),
      dy: parseFiniteSvgNumber(matrixMatch[2], "matrix ty"),
    };
  }
  const translateMatch = /^translate\((-?[\d.]+)[ ,]+(-?[\d.]+)\)$/.exec(value);
  if (translateMatch !== null) {
    return {
      kind: "translate",
      dx: parseFiniteSvgNumber(translateMatch[1], "translate x"),
      dy: parseFiniteSvgNumber(translateMatch[2], "translate y"),
    };
  }
  return undefined;
}

function formatTranslationTransform(kind: TranslationTransform["kind"], dx: number, dy: number): string {
  const x = formatFigmaRoundedNumber(dx);
  const y = formatFigmaRoundedNumber(dy);
  if (kind === "matrix") {
    return `matrix(1,0,0,1,${x},${y})`;
  }
  return `translate(${x} ${y})`;
}

function rewritePathAttribute(
  attrs: SvgAttributes,
  parent: TranslationScope,
  viewportOrigin: ExportPoint,
): SvgAttributes {
  const d = readStringAttribute(attrs, "d");
  if (d === undefined) {
    return attrs;
  }
  return { ...attrs, d: rewritePathDWithMagnitudeRule(d, parent, viewportOrigin) };
}

function roundCoordinateAttributes(
  attrs: SvgAttributes,
  parent: TranslationScope,
  viewportOrigin: ExportPoint,
): SvgAttributes {
  return Object.fromEntries(
    Object.entries(attrs).map(([name, value]) => [name, roundCoordinateAttribute(name, value, parent, viewportOrigin)]),
  );
}

function roundCoordinateAttribute(
  name: string,
  value: SvgAttributeValue,
  parent: TranslationScope,
  viewportOrigin: ExportPoint,
): SvgAttributeValue {
  if (value === undefined || value === false || value === true) {
    return value;
  }
  const stringValue = String(value);
  if (SVG_X_POSITION_ATTRIBUTES.has(name)) {
    return roundAxisPositionAttribute(stringValue, parent.tx, "x", viewportOrigin);
  }
  if (SVG_Y_POSITION_ATTRIBUTES.has(name)) {
    return roundAxisPositionAttribute(stringValue, parent.ty, "y", viewportOrigin);
  }
  if (SVG_SIZE_ATTRIBUTES.has(name)) {
    return roundPlainNumberAttribute(stringValue);
  }
  if (name === "transform") {
    return roundPureTranslationTransformAttribute(stringValue, parent, viewportOrigin);
  }
  return value;
}

function roundPureTranslationTransformAttribute(
  value: string,
  parent: TranslationScope,
  viewportOrigin: ExportPoint,
): SvgAttributeValue {
  const translation = readTranslationTransform(value);
  if (translation === undefined) {
    return value;
  }
  const dx = roundExportPosition(translation.dx + parent.tx, "x", viewportOrigin) - parent.tx;
  const dy = roundExportPosition(translation.dy + parent.ty, "y", viewportOrigin) - parent.ty;
  return formatTranslationTransform(translation.kind, dx, dy);
}

function roundAxisPositionAttribute(
  value: string,
  parentOffset: number,
  axis: "x" | "y",
  viewportOrigin: ExportPoint,
): SvgAttributeValue {
  const parsed = parsePlainSvgNumber(value);
  if (parsed === undefined) {
    return value;
  }
  const rounded = roundExportPosition(parsed + parentOffset, axis, viewportOrigin) - parentOffset;
  return formatFigmaRoundedNumber(rounded);
}

function roundPlainNumberAttribute(value: string): SvgAttributeValue {
  const parsed = parsePlainSvgNumber(value);
  if (parsed === undefined) {
    return value;
  }
  return formatFigmaRoundedNumber(roundMagnitude(parsed));
}

function roundExportPosition(worldCoord: number, axis: "x" | "y", viewportOrigin: ExportPoint): number {
  const origin = axis === "x" ? viewportOrigin.x : viewportOrigin.y;
  return origin + roundMagnitude(worldCoord - origin);
}

function roundMagnitude(value: number): number {
  const precision = figmaSixSignificantDecimalPlaces(Math.abs(value));
  const factor = 10 ** precision;
  const tieGuard = Math.sign(value) / (factor * 1_000);
  return Math.round((value - tieGuard) * factor) / factor;
}

function readSvgExportViewportOrigin(root: SvgElementNode): ExportPoint {
  const viewBox = readStringAttribute(root.attrs, "viewBox");
  if (viewBox === undefined) {
    throw new Error("serializeFigmaExportSvg requires an SVG viewBox");
  }
  const parts = viewBox.trim().split(/\s+/);
  if (parts.length !== 4) {
    throw new Error("serializeFigmaExportSvg requires a four-number SVG viewBox");
  }
  const x = parseFiniteSvgNumber(parts[0], "viewBox x");
  const y = parseFiniteSvgNumber(parts[1], "viewBox y");
  return { x, y };
}

function readStringAttribute(attrs: SvgAttributes, name: string): string | undefined {
  const value = attrs[name];
  if (value === undefined || value === false || value === true) {
    return undefined;
  }
  return String(value);
}

function parsePlainSvgNumber(value: string): number | undefined {
  if (!PLAIN_SVG_NUMBER_RE.test(value)) {
    return undefined;
  }
  return parseFiniteSvgNumber(value, "SVG numeric attribute");
}

function parseFiniteSvgNumber(value: string, context: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`serializeFigmaExportSvg requires finite ${context}`);
  }
  return parsed;
}

function formatFigmaRoundedNumber(value: number): string {
  const cleaned = Number(value.toPrecision(12));
  if (Object.is(cleaned, -0)) {
    return "0";
  }
  return cleaned.toString();
}

function figmaSixSignificantDecimalPlaces(absValue: number): number {
  if (absValue < 1) {
    return 6;
  }
  const integerDigits = Math.floor(Math.log10(absValue)) + 1;
  return Math.max(0, 6 - integerDigits);
}

function rewritePathDWithMagnitudeRule(
  d: string,
  parent: TranslationScope,
  viewportOrigin: ExportPoint,
): string {
  function precisionForMag(value: number): number {
    return figmaSixSignificantDecimalPlaces(value);
  }
  function roundRelativeValue(value: number): string {
    const factor = 10 ** precisionForMag(Math.abs(value));
    const tieGuard = Math.sign(value) / (factor * 1_000);
    return formatFigmaRoundedNumber(Math.round((value - tieGuard) * factor) / factor);
  }
  function roundAbsoluteValue(local: number, isX: boolean): string {
    const emittedOffset = isX ? parent.tx : parent.ty;
    const geometryOffset = isX ? parent.txRaw : parent.tyRaw;
    const origin = isX ? viewportOrigin.x : viewportOrigin.y;
    const world = local + geometryOffset;
    const localToExport = world - origin;
    const factor = 10 ** precisionForMag(Math.abs(localToExport));
    const tieGuard = Math.sign(localToExport) / (factor * 1_000);
    const roundedWorld = origin + Math.round((localToExport - tieGuard) * factor) / factor;
    return formatFigmaRoundedNumber(roundedWorld - emittedOffset);
  }
  return d.replace(/([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g, (segment: string, cmd: string, argText: string) => {
    const upper = cmd.toUpperCase();
    if (upper === "Z") {
      return cmd;
    }
    const args = (argText || "").trim().split(/[\s,]+/).filter((part) => part.length > 0).map(Number);
    const useParent = cmd === upper;
    function emitPoint(x: number, y: number): string {
      if (useParent) {
        return `${roundAbsoluteValue(x, true)} ${roundAbsoluteValue(y, false)}`;
      }
      return `${roundRelativeValue(x)} ${roundRelativeValue(y)}`;
    }
    function emitValues(values: readonly number[], xMask: readonly (boolean | undefined)[]): string {
      const parts = values.map((value, index) => {
        if (xMask[index] === undefined) {
          return roundRelativeValue(value);
        }
        if (useParent) {
          return roundAbsoluteValue(value, xMask[index]);
        }
        return roundRelativeValue(value);
      });
      return parts.join(" ");
    }
    const segments: string[] = [];
    switch (upper) {
      case "M":
      case "L":
      case "T": {
        for (let k = 0; k < args.length; k += 2) {
          segments.push(emitPoint(args[k], args[k + 1]));
        }
        break;
      }
      case "C": {
        for (let k = 0; k < args.length; k += 6) {
          segments.push([
            emitPoint(args[k], args[k + 1]),
            emitPoint(args[k + 2], args[k + 3]),
            emitPoint(args[k + 4], args[k + 5]),
          ].join(" "));
        }
        break;
      }
      case "Q":
      case "S": {
        for (let k = 0; k < args.length; k += 4) {
          segments.push([
            emitPoint(args[k], args[k + 1]),
            emitPoint(args[k + 2], args[k + 3]),
          ].join(" "));
        }
        break;
      }
      case "H": {
        segments.push(args.map((value) => {
          if (useParent) {
            return roundAbsoluteValue(value, true);
          }
          return roundRelativeValue(value);
        }).join(" "));
        break;
      }
      case "V": {
        segments.push(args.map((value) => {
          if (useParent) {
            return roundAbsoluteValue(value, false);
          }
          return roundRelativeValue(value);
        }).join(" "));
        break;
      }
      case "A": {
        for (let k = 0; k < args.length; k += 7) {
          const xMask = [undefined, undefined, undefined, undefined, undefined, true, false] as const;
          segments.push(emitValues([args[k], args[k + 1], args[k + 2], args[k + 3], args[k + 4], args[k + 5], args[k + 6]], xMask));
        }
        break;
      }
      default: {
        return segment;
      }
    }
    return cmd + segments.join(" ");
  });
}
