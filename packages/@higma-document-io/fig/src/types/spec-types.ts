/** @file Node spec types for creating Kiwi fig nodes. */

import type {
  FigColor,
  FigPaint,
  FigEffect,
  FigStrokeAlign,
  FigStrokeCap,
  FigStrokeJoin,
  FigGuid,
  FigNode,
  KiwiEnumValue,
} from "@higma-document-models/fig/types";

export type KiwiStackLayoutFields = Pick<
  FigNode,
  | "stackMode"
  | "stackSpacing"
  | "stackPadding"
  | "stackVerticalPadding"
  | "stackHorizontalPadding"
  | "stackPaddingRight"
  | "stackPaddingBottom"
  | "stackPrimaryAlignItems"
  | "stackCounterAlignItems"
  | "stackPrimaryAlignContent"
  | "stackCounterAlignContent"
  | "stackWrap"
  | "stackCounterSpacing"
  | "stackReverseZIndex"
>;

export type KiwiChildLayoutFields = Pick<
  FigNode,
  | "stackPositioning"
  | "stackPrimarySizing"
  | "stackCounterSizing"
  | "horizontalConstraint"
  | "verticalConstraint"
  | "stackChildAlignSelf"
  | "stackChildPrimaryGrow"
>;

// =============================================================================
// Base Spec
// =============================================================================

/**
 * Common properties shared by all node specs.
 */
export type BaseNodeSpec = {
  readonly name?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
  readonly fills?: readonly FigPaint[];
  readonly strokes?: readonly FigPaint[];
  readonly strokeWeight?: number;
  /**
   * Stroke geometry attributes. Load-bearing for Figma import — every
   * shape node with strokes carries `strokeAlign`, `strokeJoin`, and
   * (for LINE / VECTOR) `strokeCap`.
   */
  readonly strokeCap?: KiwiEnumValue<FigStrokeCap>;
  readonly strokeJoin?: KiwiEnumValue<FigStrokeJoin>;
  readonly strokeAlign?: KiwiEnumValue<FigStrokeAlign>;
  /**
   * Dash pattern as a sequence of pixel lengths (CSS `stroke-dasharray`
   * semantics: `[on, off, on, off, …]`). When set, the renderer paints
   * the stroke as a dashed line; missing/empty array means solid.
   */
  readonly strokeDashes?: readonly number[];
  readonly effects?: readonly FigEffect[];
  readonly opacity?: number;
  readonly visible?: boolean;
} & Partial<KiwiChildLayoutFields>;

// =============================================================================
// Shape Specs
// =============================================================================

export type RectNodeSpec = BaseNodeSpec & {
  readonly type: "RECTANGLE";
};

export type RoundedRectNodeSpec = BaseNodeSpec & {
  readonly type: "ROUNDED_RECTANGLE";
  readonly cornerRadius?: number;
  readonly rectangleCornerRadii?: readonly [number, number, number, number];
};

export type EllipseNodeSpec = BaseNodeSpec & {
  readonly type: "ELLIPSE";
};

export type LineNodeSpec = BaseNodeSpec & {
  readonly type: "LINE";
};

export type StarNodeSpec = BaseNodeSpec & {
  readonly type: "STAR";
  readonly pointCount?: number;
  readonly starInnerRadius?: number;
};

export type PolygonNodeSpec = BaseNodeSpec & {
  readonly type: "REGULAR_POLYGON";
  readonly pointCount?: number;
};

export type VectorNodeSpec = BaseNodeSpec & {
  readonly type: "VECTOR";
  readonly vectorPaths?: readonly { readonly windingRule?: string; readonly data?: string }[];
};

// =============================================================================
// Container Specs
// =============================================================================

export type FrameNodeSpec = BaseNodeSpec & {
  readonly type: "FRAME";
  readonly clipsContent?: boolean;
  readonly backgroundColor?: FigColor;
  /**
   * Optional uniform corner radius. CSS `border-radius` on a non-leaf
   * container (a `<div>` with descendants) maps to this field on the
   * resulting FRAME — leaving the field off would silently flatten
   * rounded panels into square ones during web-to-fig conversion.
   */
  readonly cornerRadius?: number;
  /**
   * Optional per-corner radii in TL/TR/BR/BL order. Set when CSS
   * authors asymmetric corners (e.g. only `border-top-left-radius`).
   * Mutually exclusive with `cornerRadius`; the factory honours
   * whichever the caller supplied.
   */
  readonly rectangleCornerRadii?: readonly [number, number, number, number];
} & Partial<KiwiStackLayoutFields>;

export type GroupNodeSpec = BaseNodeSpec & {
  readonly type: "GROUP";
};

export type SectionNodeSpec = BaseNodeSpec & {
  readonly type: "SECTION";
};

export type BooleanOperationNodeSpec = BaseNodeSpec & {
  readonly type: "BOOLEAN_OPERATION";
  readonly booleanOperation: KiwiEnumValue;
};

// =============================================================================
// Content Specs
// =============================================================================

export type TextNodeSpec = BaseNodeSpec & {
  readonly type: "TEXT";
  readonly characters: string;
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly fontStyle?: string;
  readonly lineHeight?: number;
  /**
   * Tracking between glyphs, expressed in CSS pixels. The builder
   * forwards this verbatim to Figma's `letterSpacing` field with unit
   * `PIXELS` (Figma also supports `PERCENT`, but the web pipeline
   * resolves CSS `letter-spacing` to its computed pixel value so the
   * downstream surface is pixel-only). Defaults to `undefined`, which
   * the builder reads as "leave the Figma default tracking" — distinct
   * from `0`, which the builder explicitly serialises as zero pixels.
   */
  readonly letterSpacing?: number;
  readonly textAlignHorizontal?: KiwiEnumValue;
  readonly textAlignVertical?: KiwiEnumValue;
};

// =============================================================================
// Component Specs
// =============================================================================

/**
 * Spec for creating a SYMBOL node — the on-disk encoding of the Figma
 * UI concept "Component". The schema has no COMPONENT NodeType; see
 * `docs/refactor/component-type-cleanup.md`.
 */
export type SymbolNodeSpec = BaseNodeSpec & {
  readonly type: "SYMBOL";
  readonly clipsContent?: boolean;
} & Partial<KiwiStackLayoutFields>;

export type InstanceNodeSpec = BaseNodeSpec & {
  readonly type: "INSTANCE";
  readonly symbolId: FigGuid;
};

// =============================================================================
// Union
// =============================================================================

/**
 * Discriminated union of all node creation specs.
 * The `type` field determines which node type to create.
 */
export type NodeSpec =
  | RectNodeSpec
  | RoundedRectNodeSpec
  | EllipseNodeSpec
  | LineNodeSpec
  | StarNodeSpec
  | PolygonNodeSpec
  | VectorNodeSpec
  | FrameNodeSpec
  | GroupNodeSpec
  | SectionNodeSpec
  | BooleanOperationNodeSpec
  | TextNodeSpec
  | SymbolNodeSpec
  | InstanceNodeSpec;
