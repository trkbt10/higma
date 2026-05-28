/** @file Node spec types for creating Kiwi fig nodes. */

import type {
  FigColor,
  FigEffect,
  FigImageScaleMode,
  FigPaint,
  FigSolidPaint,
  FigGradientPaint,
  FigImagePaint,
  FigStrokeAlign,
  FigStrokeCap,
  FigStrokeJoin,
  FigGuid,
  FigNode,
} from "@higma-document-models/fig/types";
import type {
  BlendMode,
  EffectType,
  LeadingTrim,
  TextAlignHorizontal,
  TextAlignVertical,
  TextAutoResize,
  TextCase,
  TextDecoration,
  TextTruncation,
} from "@higma-document-models/fig/constants";
import type { BooleanOperation } from "@higma-document-models/fig/boolean-operation";

// =============================================================================
// Paint / Effect specs
// =============================================================================
//
// The spec-side discriminated unions for paints and effects. `FigPaint`
// / `FigEffect` are the on-disk Kiwi types in `@higma-document-models`;
// the wire-format `type` and `blendMode` fields there carry
// `KiwiEnumValue<...>` payloads bound to schema enums. The spec uses
// the same schema-derived string unions directly as the discriminator
// — `BlendMode`, `FigImageScaleMode`, the literal type-name unions
// imported from `FigSolidPaint["type"]` etc. — so adding a new enum
// entry in the schema propagates simultaneously through `FigPaint`'s
// `KiwiEnumValue<T>` parameterisation and the spec's string union T.
//
// The factory's paint/effect lift (in `node-ops/paint-spec.ts` and
// `node-ops/effect-spec.ts`, called from `createNodeFromSpec`)
// translates these specs into `FigPaint` / `FigEffect` payloads
// using `toEnumValue(name, TABLE)` for every enum-typed field — the
// same single SoT helper the rest of the factory uses.

/**
 * Solid colour paint spec. Mirror of `FigSolidPaint` with the wire
 * format's `KiwiEnumValue` fields (`type`, `blendMode`) replaced by
 * their schema-derived string unions.
 */
export type SolidPaintSpec = Omit<FigSolidPaint, "type" | "blendMode"> & {
  readonly type: "SOLID";
  readonly blendMode?: BlendMode;
};

/**
 * Gradient paint spec. The `type` discriminator carries the same
 * string-name set as `FigGradientPaint["type"]`'s `KiwiEnumValue` T —
 * `"GRADIENT_LINEAR"` / `"GRADIENT_RADIAL"` / `"GRADIENT_ANGULAR"`
 * / `"GRADIENT_DIAMOND"`.
 */
export type GradientPaintSpec = Omit<FigGradientPaint, "type" | "blendMode"> & {
  readonly type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND";
  readonly blendMode?: BlendMode;
};

/**
 * Image paint spec. `imageScaleMode` reuses `FigImageScaleMode` (the
 * schema-derived string union also used by `FigImagePaint`).
 */
export type ImagePaintSpec = Omit<FigImagePaint, "type" | "blendMode" | "imageScaleMode"> & {
  readonly type: "IMAGE";
  readonly blendMode?: BlendMode;
  readonly imageScaleMode?: FigImageScaleMode;
};

export type PaintSpec = SolidPaintSpec | GradientPaintSpec | ImagePaintSpec;

/**
 * Effect spec. Mirror of `FigEffect` with the `type` and `blendMode`
 * wire-format fields replaced by their schema-derived string unions
 * (`EffectType` and `BlendMode`). The spec does not currently surface
 * `REPEAT` / `SYMMETRY` effects (the schema has them but no consumer
 * authors them through the builder); they round-trip through the
 * runtime layer untouched if a parsed `FigEffect` flows directly back
 * into `NodeSpec.effects`.
 */
export type EffectSpec = Omit<FigEffect, "type" | "blendMode"> & {
  readonly type: EffectType;
  readonly blendMode?: BlendMode;
};

/**
 * Parent-side auto-layout / grid fields, picked verbatim from
 * `FigNode`. `FigNode` is the single source of truth — each enum-typed
 * slot here is whatever `FigNode` declares (e.g. `KiwiEnumValue<StackMode>`),
 * and adding / removing layout slots is done by changing `FigNode`
 * itself rather than restating the shape on the spec side.
 *
 * Consumers that prefer authoring string names lift via
 * `toEnumValue(name, TABLE)` from `@higma-document-models/fig/constants`,
 * which is itself the canonical lift helper bound to the same Kiwi
 * value tables that `FigNode`'s `KiwiEnumValue<T>` parameterisation is
 * derived from. Keeping the spec field shape identical to `FigNode`
 * means a Kiwi-schema-driven change to `FigNode` (a new enum entry,
 * a parameter tightening) propagates here without a second edit.
 */
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
  | "gridColumns"
  | "gridRows"
  | "gridColumnsSizing"
  | "gridRowsSizing"
>;

/**
 * Child-side layout fields (constraints + flex-child sizing), picked
 * verbatim from `FigNode`. See {@link KiwiStackLayoutFields} for the
 * SoT rationale.
 */
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
 *
 * `visible` and `opacity` are *required* even though Figma's wire
 * format encodes them with implicit zero defaults: omitting them when
 * generating a .fig file produces output that opens in Figma's editor
 * with every layer hidden / fully transparent (Kiwi's "field absent"
 * is read as the zero value, which for these fields means off). The
 * SoT for this contract is `REQUIRED_NODE_DISPLAY_FIELDS` in
 * `../types/required-fields.ts`, and the same names are enforced
 * post-construction by the `fig.shape.display-fields` lint rule. Spec
 * authors who want the standard "fully visible, fully opaque" output
 * can spread `DEFAULT_DISPLAY_FIELDS` from the same module.
 */
export type BaseNodeSpec = {
  readonly name?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
  /**
   * Fill paints. Accepts both the schema-derived `PaintSpec`
   * discriminated union (string `type` / `blendMode`, lifted by the
   * factory at insertion) and pre-built `FigPaint` payloads (for
   * codecs and importers that already produced wire-format paints).
   * The factory's paint lift in `node-ops/paint-spec.ts` branches on
   * which form each entry takes.
   */
  readonly fills?: readonly (PaintSpec | FigPaint)[];
  readonly strokes?: readonly (PaintSpec | FigPaint)[];
  readonly strokeWeight?: number;
  /**
   * Stroke geometry attributes. Load-bearing for Figma import — every
   * shape node with strokes carries `strokeAlign`, `strokeJoin`, and
   * (for LINE / VECTOR) `strokeCap`. The spec takes the canonical
   * string name from `@higma-document-models/fig/constants`; the
   * factory looks up the Kiwi numeric value once, so consumers never
   * need to know the wire-format encoding.
   */
  readonly strokeCap?: FigStrokeCap;
  readonly strokeJoin?: FigStrokeJoin;
  readonly strokeAlign?: FigStrokeAlign;
  /**
   * Dash pattern as a sequence of pixel lengths (CSS `stroke-dasharray`
   * semantics: `[on, off, on, off, …]`). When set, the renderer paints
   * the stroke as a dashed line; missing/empty array means solid.
   */
  readonly strokeDashes?: readonly number[];
  /**
   * Visual effects. Accepts both the schema-derived `EffectSpec`
   * union (string `type` / `blendMode`) and pre-built `FigEffect`
   * payloads. The factory's effect lift branches on the form.
   */
  readonly effects?: readonly (EffectSpec | FigEffect)[];
  readonly opacity: number;
  readonly visible: boolean;
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
  /**
   * Boolean operation applied across the node's children. Spec takes
   * the canonical `BooleanOperation` string union (`UNION` /
   * `INTERSECT` / `SUBTRACT` / `EXCLUDE`); factory lifts it to the
   * wire-format `KiwiEnumValue` via `toEnumValue`.
   */
  readonly booleanOperation: BooleanOperation;
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
  /**
   * Horizontal text alignment. Spec takes the canonical string name
   * (`LEFT` / `CENTER` / `RIGHT` / `JUSTIFIED`); the factory looks up
   * the Kiwi enum entry.
   */
  readonly textAlignHorizontal?: TextAlignHorizontal;
  /**
   * Vertical text alignment. Spec takes the canonical string name
   * (`TOP` / `CENTER` / `BOTTOM`); the factory looks up the Kiwi enum
   * entry.
   */
  readonly textAlignVertical?: TextAlignVertical;
  /**
   * Letter-case transformation applied at render time. The spec
   * mirrors the `TextCase` SoT enum (`ORIGINAL` / `UPPER` / `LOWER`
   * / `TITLE` / `SMALL_CAPS` / `SMALL_CAPS_FORCED`). Set to
   * `undefined` (the default) leaves Figma's original casing.
   */
  readonly textCase?: TextCase;
  /**
   * Decoration line drawn beneath / through the text. Spec takes
   * `NONE` / `UNDERLINE` / `STRIKETHROUGH`.
   */
  readonly textDecoration?: TextDecoration;
  /**
   * Auto-resize behaviour of the text bounding box. `NONE` keeps the
   * authored width / height and wraps inside; `WIDTH_AND_HEIGHT`
   * grows to fit content without wrapping; `HEIGHT` grows height
   * only while preserving the authored width (the wrap target).
   */
  readonly textAutoResize?: TextAutoResize;
  /**
   * Truncation mode. `ENDING` wraps inside the bounding box then cuts
   * with an ellipsis when the box runs out of vertical space;
   * `DISABLED` allows the text to overflow without an indicator. The
   * spec takes the human-readable name (the canonical SoT enum from
   * `@higma-document-models/fig/constants`); the factory looks up the
   * numeric Kiwi value, so consumers never need to know it.
   * Truncation only fires under `textAutoResize: NONE` (fixed bounds).
   */
  readonly textTruncation?: TextTruncation;
  /**
   * Vertical leading trim. `CAP_HEIGHT` crops the empty space above
   * the cap line and below the baseline so the bounding box matches
   * the visual extent of the glyphs — Figma's "Vertical trim: cap
   * height to baseline" toggle. Spec takes the string name; factory
   * resolves the Kiwi enum entry.
   */
  readonly leadingTrim?: LeadingTrim;
  /**
   * Additional vertical space inserted between paragraphs (anything
   * separated by `\n` in `characters`), in CSS pixels. Figma stores
   * this as the literal pixel offset added after a paragraph break.
   */
  readonly paragraphSpacing?: number;
  /**
   * First-line indent applied to each paragraph, in CSS pixels.
   */
  readonly paragraphIndent?: number;
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
