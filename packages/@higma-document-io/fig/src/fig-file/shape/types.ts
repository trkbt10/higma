/**
 * @file Shape node type definitions
 */

import type { Paint, Stroke } from "../types";
import type { EffectData } from "../effect/types";
import type {
  StrokeCap,
  StrokeJoin,
  StrokeAlign,
  StackPositioning,
  StackSizing,
  ConstraintType,
} from "@higma-document-models/fig/constants";

export type ArcData = {
  readonly startingAngle: number; // radians
  readonly endingAngle: number; // radians
  readonly innerRadius: number; // 0-1 ratio (0 = full ellipse, >0 = donut)
};

export type BaseShapeNodeData = {
  readonly localID: number;
  readonly parentID: number;
  readonly name: string;
  readonly size: { x: number; y: number };
  readonly transform: {
    m00: number;
    m01: number;
    m02: number;
    m10: number;
    m11: number;
    m12: number;
  };
  readonly fillPaints: readonly Paint[];
  readonly strokePaints?: readonly Stroke[];
  readonly strokeWeight?: number;
  readonly strokeCap?: { value: number; name: StrokeCap };
  readonly strokeJoin?: { value: number; name: StrokeJoin };
  readonly strokeAlign?: { value: number; name: StrokeAlign };
  readonly dashPattern?: readonly number[];
  readonly visible: boolean;
  readonly opacity: number;
  // Child constraint properties
  readonly stackPositioning?: { value: number; name: StackPositioning };
  readonly stackPrimarySizing?: { value: number; name: StackSizing };
  readonly stackCounterSizing?: { value: number; name: StackSizing };
  readonly horizontalConstraint?: { value: number; name: ConstraintType };
  readonly verticalConstraint?: { value: number; name: ConstraintType };
  // Effects (drop shadow, inner shadow, blur, etc.)
  readonly effects?: readonly EffectData[];
  // Mask flag — when true, this node acts as a mask for subsequent siblings
  readonly mask?: boolean;
};

export type EllipseNodeData = BaseShapeNodeData & {
  readonly nodeType: 9;
  readonly arcData?: ArcData;
};

export type LineNodeData = BaseShapeNodeData & {
  readonly nodeType: 8;
};

export type StarNodeData = BaseShapeNodeData & {
  readonly nodeType: 7;
  readonly pointCount: number;
  readonly starInnerRadius: number; // 0-1 ratio
};

export type PolygonNodeData = BaseShapeNodeData & {
  readonly nodeType: 11;
  readonly pointCount: number;
};

export type VectorNodeData = BaseShapeNodeData & {
  readonly nodeType: 6;
  readonly vectorData?: {
    readonly vectorNetworkBlob?: number;
    readonly normalizedSize?: { x: number; y: number };
  };
  /**
   * SVG path `d` strings, one per sub-path. The fig-file writer
   * encodes each path into a `fillGeometry` blob (the same byte
   * format `encodeRectangleBlob` produces — confirmed against
   * Figma's own `.fig` exports: 78% of VECTOR nodes carry
   * `fillGeometry` with header 0x01 + start position + LineTo /
   * CubicTo command sequence).
   *
   * The matching `vectorData.vectorNetworkBlob` (anchor-network
   * data Figma uses for editable Bezier anchors) is intentionally
   * not synthesised here — its binary format is not fully
   * documented. Without it Figma still renders the vector but
   * anchors won't be directly editable in Figma's UI; this matches
   * what other importers (Sketch, Adobe XD) produce, and is
   * sufficient for a faithful round-trip of icon geometry.
   */
  readonly paths?: readonly string[];
  readonly windingRule?: "NONZERO" | "EVENODD";
  readonly handleMirroring?: { value: number; name: string };
};

export type RectangleNodeData = BaseShapeNodeData & {
  readonly nodeType: 10;
};

export type RoundedRectangleNodeData = BaseShapeNodeData & {
  readonly nodeType: 12;
  readonly cornerRadius?: number;
  readonly rectangleCornerRadii?: readonly [number, number, number, number];
};
