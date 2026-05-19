/**
 * @file Scene Graph type definitions
 *
 * Format-agnostic intermediate representation for Figma rendering and
 * code-generation. SVG, WebGL, React, and the various exporter tools
 * all consume this scene graph.
 *
 * Parity contract: every visual property that the SVG renderer handles
 * MUST have a corresponding field in these types. The
 * builder-feature-parity test enforces the mapping.
 */

import type { AffineMatrix, CornerRadius, PathCommand } from "@higma-primitives/path";
import type { ImagePaintFilter } from "@higma-codecs/raster";
import type { FontQuery } from "@higma-document-models/fig/font";

// =============================================================================
// Branded ID Type
// =============================================================================

export type SceneNodeId = string & { readonly __brand: "SceneNodeId" };

/** Create a unique node identifier string */
export function createNodeId(id: string): SceneNodeId {
  return id as SceneNodeId;
}

// =============================================================================
// Primitive Types
// =============================================================================

export type Point = { readonly x: number; readonly y: number };

export type Color = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

// =============================================================================
// Blend Mode
// =============================================================================

/**
 * CSS mix-blend-mode values corresponding to Figma blend modes.
 * PASS_THROUGH and NORMAL produce undefined (no explicit CSS needed).
 */
export type BlendMode =
  | "darken"
  | "multiply"
  | "plus-darker"     // LINEAR_BURN
  | "color-burn"
  | "lighten"
  | "screen"
  | "plus-lighter"    // LINEAR_DODGE
  | "color-dodge"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

// =============================================================================
// Fill Types
// =============================================================================

export type GradientStop = {
  readonly position: number;
  readonly color: Color;
};

export type SolidFill = {
  readonly type: "solid";
  readonly color: Color;
  readonly opacity: number;
  /** Paint-level blend mode (Figma supports per-paint blend) */
  readonly blendMode?: BlendMode;
};

export type LinearGradientFill = {
  readonly type: "linear-gradient";
  readonly start: Point;
  readonly end: Point;
  readonly stops: readonly GradientStop[];
  readonly opacity: number;
  readonly blendMode?: BlendMode;
  /**
   * Original Figma paint transform matrix.
   * Preserved for accurate SVG gradientTransform generation.
   * When absent, start/end coordinates define the gradient direction directly.
   */
  readonly gradientTransform?: AffineMatrix;
};

export type RadialGradientFill = {
  readonly type: "radial-gradient";
  readonly center: Point;
  readonly radius: number;
  readonly stops: readonly GradientStop[];
  readonly opacity: number;
  readonly blendMode?: BlendMode;
  /**
   * Original Figma paint transform matrix.
   * Required for elliptical and rotated radial gradients.
   * The 2x2 rotation+scale part encodes the ellipse shape.
   */
  readonly gradientTransform?: AffineMatrix;
};

/**
 * Angular (conic) gradient fill.
 * Rendered via CSS conic-gradient in foreignObject (SVG)
 * or shader (WebGL).
 */
export type AngularGradientFill = {
  readonly type: "angular-gradient";
  readonly center: Point;
  readonly stops: readonly GradientStop[];
  readonly opacity: number;
  readonly blendMode?: BlendMode;
  /** Rotation angle in radians (Figma gradient handle angle) */
  readonly rotation: number;
};

/**
 * Diamond gradient fill.
 * Rendered via four mirrored gradient rects (SVG) or shader (WebGL).
 */
export type DiamondGradientFill = {
  readonly type: "diamond-gradient";
  readonly center: Point;
  readonly stops: readonly GradientStop[];
  readonly opacity: number;
  readonly blendMode?: BlendMode;
};

export type ImageFill = {
  readonly type: "image";
  readonly imageHash: string;
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly scaleMode: string;
  readonly opacity: number;
  readonly blendMode?: BlendMode;
  readonly width?: number;
  readonly height?: number;
  /** Tile scale multiplier for TILE image fills. */
  readonly scalingFactor?: number;
  /** Natural image dimensions (from PNG/JPEG header) */
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
  /** Image transform (for non-FILL scale modes) */
  readonly imageTransform?: AffineMatrix;
  readonly paintFilter?: ImagePaintFilter;
  readonly imageShouldColorManage?: boolean;
};

export type Fill =
  | SolidFill
  | LinearGradientFill
  | RadialGradientFill
  | AngularGradientFill
  | DiamondGradientFill
  | ImageFill;

// =============================================================================
// Stroke Types
// =============================================================================

/**
 * A single stroke layer.
 *
 * Figma supports multiple stroke paints, each potentially with a gradient
 * fill and blend mode. The scene-graph stores each as a StrokeLayer,
 * and the Stroke type wraps them with shared geometric properties.
 */
export type StrokeLayer = {
  /** Stroke color (for solid strokes) */
  readonly color: Color;
  readonly opacity: number;
  /** Gradient fill reference — when set, color is ignored */
  readonly gradientFill?: LinearGradientFill | RadialGradientFill;
  readonly blendMode?: BlendMode;
};

export type StrokeAlign = "CENTER" | "INSIDE" | "OUTSIDE";

export type Stroke = {
  readonly width: number;
  readonly linecap: "butt" | "round" | "square";
  readonly linejoin: "miter" | "round" | "bevel";
  readonly dashPattern?: readonly number[];
  /**
   * Stroke alignment relative to the path.
   * - CENTER (default): stroke straddles the path (SVG default)
   * - INSIDE: stroke is drawn inside the shape (requires mask in SVG)
   * - OUTSIDE: stroke is drawn outside the shape (requires mask in SVG)
   */
  readonly align?: StrokeAlign;
  /** Primary layer (first visible stroke paint) */
  readonly color: Color;
  readonly opacity: number;
  /** All stroke layers (for multi-paint stroke rendering) */
  readonly layers?: readonly StrokeLayer[];
};

// =============================================================================
// Effect Types
// =============================================================================

export type DropShadowEffect = {
  readonly type: "drop-shadow";
  readonly offset: Point;
  readonly radius: number;
  readonly color: Color;
  /** Shadow spread (positive = dilate, negative = erode) */
  readonly spread?: number;
  readonly blendMode?: BlendMode;
  readonly showShadowBehindNode?: boolean;
};

export type InnerShadowEffect = {
  readonly type: "inner-shadow";
  readonly offset: Point;
  readonly radius: number;
  readonly color: Color;
  readonly spread?: number;
  readonly blendMode?: BlendMode;
};

export type LayerBlurEffect = {
  readonly type: "layer-blur";
  readonly radius: number;
};

export type BackgroundBlurEffect = {
  readonly type: "background-blur";
  readonly radius: number;
};

export type Effect =
  | DropShadowEffect
  | InnerShadowEffect
  | LayerBlurEffect
  | BackgroundBlurEffect;

// =============================================================================
// Path Types
// =============================================================================

export type PathContour = {
  readonly commands: readonly PathCommand[];
  readonly windingRule: "nonzero" | "evenodd";
  /** Per-contour fill override (for vector nodes with styleOverrideTable) */
  readonly fillOverride?: Fill;
};

/**
 * Glyph annotation: the source-character index that a glyph outline
 * corresponds to. `firstCharacter` is `undefined` for contours that
 * don't map to a single source character (Figma's auto-inserted
 * ellipsis glyph, opentype fallback line contours). The run grouper
 * folds those into the base run.
 */
export type GlyphCharacterIndex = {
  readonly firstCharacter: number | undefined;
};

/**
 * A scene-graph glyph contour: scene-graph's `PathContour` plus the
 * shared `GlyphCharacterIndex` annotation. SoT for run grouping in the
 * scene-graph → render-tree pipeline.
 */
export type GlyphContour = PathContour & GlyphCharacterIndex;

// =============================================================================
// Arc Data (for ellipse partial arcs and donuts)
// =============================================================================

/**
 * Parametric arc data for ellipses.
 * When present, the ellipse is a partial arc and/or donut.
 */
export type ArcData = {
  /** Starting angle in radians (0 = 3 o'clock, clockwise) */
  readonly startingAngle: number;
  /** Ending angle in radians */
  readonly endingAngle: number;
  /** Inner radius ratio (0..1, 0 = no hole = pie slice, >0 = donut) */
  readonly innerRadius: number;
};

// =============================================================================
// Clip & Mask Types
// =============================================================================

export type RectClip = {
  readonly type: "rect";
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: CornerRadius;
  /**
   * iOS-style continuous-curvature corner smoothing in `[0, 1]`.
   * `0` (or undefined) yields the standard quarter-circle corner;
   * higher values widen each corner along the adjacent edges and
   * shape the curve as Figma's "smooth corners" toggle does. Only
   * meaningful when `cornerRadius > 0`.
   */
  readonly cornerSmoothing?: number;
};

export type PathClip = {
  readonly type: "path";
  readonly contours: readonly PathContour[];
};

export type ClipShape = RectClip | PathClip;

export type MaskNode = {
  readonly maskId: SceneNodeId;
  /** SVG content of the mask (for SVG backend) or node reference (for WebGL) */
  readonly maskContent: SceneNode;
};

// =============================================================================
// Text Types
// =============================================================================

/** Text auto-resize mode — determines wrapping and overflow behavior. */
export type TextAutoResize = "WIDTH_AND_HEIGHT" | "HEIGHT" | "NONE" | "TRUNCATE";

/**
 * Resolved fill applied to a contiguous run of source characters.
 *
 * A `TextRun` is a maximal contiguous span of source characters that
 * share a single resolved fill. Runs partition
 * `[0, sourceIndexLength)` exactly: no gaps, no overlaps, no
 * zero-length runs. `sourceIndexLength` is the Figma text index
 * space carried by the resolved TEXT data; raw TEXT commonly uses
 * JS string length, while symbol-override text with derived glyphs
 * can use Figma logical glyph indices.
 */
export type TextRun = {
  /** Inclusive source-character start index. */
  readonly start: number;
  /** Exclusive source-character end index. */
  readonly end: number;
  /** Resolved CSS hex colour string (e.g. "#ff0000"). */
  readonly fillColor: string;
  /** Resolved alpha in [0, 1]. */
  readonly fillOpacity: number;
  /**
   * Font override for this run. `undefined` means "use the text node's
   * base font". When set, the renderer must route per-character glyph
   * lookups through this query rather than the base font.
   */
  readonly font?: FontQuery;
};

export type TextLineBounds = {
  readonly text: string;
  readonly x: number;
  readonly y: number;
};

export type TextLineLayout = {
  readonly lines: readonly TextLineBounds[];
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight?: number;
  readonly fontStyle?: string;
  readonly letterSpacing?: number;
  readonly lineHeight: number;
  readonly textAnchor: "start" | "middle" | "end";
  readonly textDecoration?: "underline" | "strikethrough";
  /**
   * CSS font-variation-settings value for variable fonts.
   * e.g. "'wght' 700, 'wdth' 100"
   */
  readonly fontVariationSettings?: string;
};

// =============================================================================
// Scene Node Types (Discriminated Union)
// =============================================================================

export type SceneNodeBase = {
  readonly id: SceneNodeId;
  readonly name?: string;
  readonly transform: AffineMatrix;
  readonly opacity: number;
  readonly visible: boolean;
  readonly effects: readonly Effect[];
  readonly clip?: ClipShape;
  readonly mask?: MaskNode;
  /** CSS mix-blend-mode (undefined = normal) */
  readonly blendMode?: BlendMode;
};

export type GroupNode = SceneNodeBase & {
  readonly type: "group";
  readonly children: readonly SceneNode[];
};

export type FrameNode = SceneNodeBase & {
  readonly type: "frame";
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: CornerRadius;
  /** See `RectClip.cornerSmoothing`. */
  readonly cornerSmoothing?: number;
  readonly fills: readonly Fill[];
  readonly stroke?: Stroke;
  /**
   * Per-side stroke weights. When set, each side of the frame's border
   * has an independent stroke width. SVG renders each side as a separate
   * stroked line rather than a single stroke-width on the rect.
   */
  readonly individualStrokeWeights?: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly clipsContent: boolean;
  readonly children: readonly SceneNode[];
};

export type RectNode = SceneNodeBase & {
  readonly type: "rect";
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: CornerRadius;
  /** See `RectClip.cornerSmoothing`. */
  readonly cornerSmoothing?: number;
  readonly fills: readonly Fill[];
  readonly stroke?: Stroke;
  /** Per-side stroke weights (same as FrameNode) */
  readonly individualStrokeWeights?: FrameNode["individualStrokeWeights"];
};

export type EllipseNode = SceneNodeBase & {
  readonly type: "ellipse";
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly fills: readonly Fill[];
  readonly stroke?: Stroke;
  /** Parametric arc data for partial arcs and donuts */
  readonly arcData?: ArcData;
};

export type PathNode = SceneNodeBase & {
  readonly type: "path";
  readonly contours: readonly PathContour[];
  readonly fills: readonly Fill[];
  readonly stroke?: Stroke;
  /** Bounding box size from the Figma node (for gradient coordinate computation) */
  readonly width?: number;
  readonly height?: number;
  /**
   * Source `cornerRadius` carried alongside the baked contour data so the
   * stroke emitter can recognise a smoothed-corner rectangle authored as
   * a VECTOR (e.g. iPhone bezel "Aluminum" / "Corner Shading" SYMBOLs —
   * type VECTOR, size 432×904, cornerRadius 76, cornerSmoothing 0.6,
   * strokeAlign INSIDE, strokeWeight 6). Figma's SVG exporter treats
   * these as rectangles for stroke emission, producing a single smoothed
   * inset path stroked at the actual strokeWidth instead of the masked-
   * doubled-stroke fallback used for arbitrary contours. The fillGeometry
   * blob carries the same smoothed outline verbatim, so this metadata is
   * purely a stroke-emission hint — fill is still rendered from `contours`.
   */
  readonly cornerRadius?: CornerRadius;
  /** Continuous-curvature smoothing factor (0..1); see `cornerRadius`. */
  readonly cornerSmoothing?: number;
};

export type TextNode = SceneNodeBase & {
  readonly type: "text";
  /** Bounding box width */
  readonly width: number;
  /** Bounding box height */
  readonly height: number;
  /** Text auto-resize mode — determines wrapping and overflow behavior */
  readonly textAutoResize: TextAutoResize;
  /**
   * Text truncation mode. When "ENDING", text that overflows the bounding box
   * is truncated with an ellipsis ("...").
   */
  readonly textTruncation?: string;
  /**
   * Leading trim mode. When "CAP_HEIGHT", the text's leading is trimmed
   * to cap height rather than full ascent, affecting vertical positioning.
   */
  readonly leadingTrim?: string;
  /** Hyperlink URL — wraps the text in an SVG <a> element */
  readonly hyperlink?: string;
  /** Pre-outlined glyph path contours (from opentype or derived data) */
  readonly glyphContours?: readonly GlyphContour[];
  /** Decoration paths (underlines, strikethroughs) as contours */
  readonly decorationContours?: readonly PathContour[];
  /**
   * Per-character fill runs covering `[0, characters.length)`. A single
   * base-fill run is the degenerate case used when no character-level
   * style overrides are present. SoT for "what colour applies to which
   * character" — every text-bearing renderer consumes this list rather
   * than re-deriving the colour from raw fillPaints + override table.
   */
  readonly runs: readonly TextRun[];
  /**
   * Base fill (= the runs[0] equivalent for unstyled text). Retained
   * because decorations (underline, strikethrough) always paint with
   * the base fill regardless of per-character overrides, and because
   * the line-mode renderer that does not yet split per run uses this
   * as its single fill.
   */
  /**
   * Stacked fill paints, in source paint-order. Each entry is one full
   * paint pass over every glyph; painter's-algorithm composition over
   * the list produces the final colour, matching Figma's own
   * multi-fill semantic (e.g. a TEXT with `[{black, opacity=0.15},
   * {black, opacity=1}]` paints a faint pass first and a fully opaque
   * pass on top, landing as solid black after rasterisation).
   *
   * The single-fill case is just a one-element array. An empty array
   * means the node has no visible SOLID fill — decorations and the
   * line-mode renderer have nothing to paint with and should skip.
   *
   * SoT-rationale: Figma's raw `FigNode.fillPaints` is a `Paint[]`
   * (Kiwi schema, also exposed by Figma's plugin / REST APIs and
   * documented as a stack — see help.figma.com "Apply fill colors to a
   * shape"). The scene-graph SoT mirrors that shape; a single
   * `fill: Fill` (or a `fill + extraFills` split) collapses the array
   * and historically lost stacked paints below the first.
   *
   * Renderers that want the "first / decoration base" fill read
   * `fills[0]` (when present); they MUST NOT assume there is exactly
   * one.
   */
  /**
   * Each stacked entry carries the source `Paint.blendMode` (resolved
   * to the scene-graph CSS-token form via `convertFigmaBlendMode`).
   * `undefined` denotes the implicit NORMAL pass; the renderer
   * projects non-undefined values onto the per-pass output via
   * `style="mix-blend-mode:…"`. Without this field stacked fills like
   * Event metadata's `[{black @0.15 NORMAL}, {black @1 OVERLAY}]`
   * collapse to solid black (the second pass paints opaque over the
   * faint first pass) instead of the intended mid-grey overlay
   * composite Figma's renderer produces.
   */
  readonly fills: readonly {
    readonly color: Color;
    readonly opacity: number;
    readonly blendMode?: BlendMode;
  }[];
  /** Text line layout for SVG <text> rendering */
  readonly textLineLayout?: TextLineLayout;
};

export type ImageNode = SceneNodeBase & {
  readonly type: "image";
  readonly width: number;
  readonly height: number;
  readonly imageHash: string;
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly scaleMode: string;
  readonly imageShouldColorManage?: boolean;
};

export type SceneNode =
  | GroupNode
  | FrameNode
  | RectNode
  | EllipseNode
  | PathNode
  | TextNode
  | ImageNode;

// =============================================================================
// Scene Graph Root
// =============================================================================

export type SceneGraph = {
  readonly width: number;
  readonly height: number;
  /**
   * World-space window shown by the output surface. `width`/`height` remain
   * the surface size; `viewport` is the viewBox-style world rectangle.
   */
  readonly viewport?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly backgroundColor?: Color;
  readonly root: GroupNode;
  readonly defs?: readonly string[];
  readonly version: number;
};
