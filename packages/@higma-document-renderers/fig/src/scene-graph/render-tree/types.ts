/**
 * @file RenderTree — fully-resolved, format-agnostic render instruction tree
 *
 * ## Purpose
 *
 * The RenderTree is the intermediate representation between SceneGraph (data)
 * and output backends (SVG string, React JSX, WebGL). It captures all
 * rendering decisions — visibility filtering, attribute resolution, clip
 * path generation, node composition — so that backends are thin formatters.
 *
 * ## Architecture
 *
 * ```
 * SceneGraph (domain data)
 *       ↓
 * resolveRenderTree() [this module]
 *       ↓
 * RenderTree (fully-resolved instructions)
 *       ↓
 * ┌─────────────────┬───────────────┬────────────────┐
 * │ SVG string      │ React JSX     │ WebGL           │
 * │ (format only)   │ (format only) │ (tessellate +   │
 * │                 │               │  draw)          │
 * └─────────────────┴───────────────┴────────────────┘
 * ```
 *
 * ## Design principles
 *
 * 1. **No rendering logic in backends**: Backends format RenderNodes to their
 *    output type. They don't resolve fills, compute transforms, or decide
 *    clipping — that's already done.
 *
 * 2. **Carry both resolved attrs and source data**: SVG/React need resolved
 *    SVG attributes (hex colors, url(#id) fill refs, filter attr strings).
 *    WebGL needs original Fill/Stroke/Contour data for tessellation.
 *    RenderNodes carry both.
 *
 * 3. **Defs are pre-collected**: Gradient defs, filter defs, clip-path defs
 *    are generated during resolution and stored in RenderDefs. SVG/React
 *    format them; WebGL ignores them.
 *
 * 4. **Exhaustive by construction**: Adding a new SceneNode type without
 *    handling it in the resolver produces a compile error (never check).
 */

import type { SceneNodeId, Fill, Stroke, PathContour, Color, TextLineLayout, SceneNode, GroupNode, FrameNode, RectNode, EllipseNode, PathNode, TextNode, ImageNode, BlendMode } from "@higma-document-renderers/fig/scene-graph";

import type { TextAutoResize } from "@higma-document-renderers/fig/scene-graph";

import type {
  ResolvedFillAttrs,
  ResolvedFillDef,
  ResolvedStrokeAttrs,
  ResolvedStrokeLayer,
  ResolvedFilter,
} from "../render";
import type { CornerRadius } from "@higma-primitives/path";

// =============================================================================
// Resolved SVG Attributes (pre-computed for SVG/React backends)
// =============================================================================

/**
 * Common resolved wrapper attributes.
 * Every RenderNode that produces a visual element has these.
 */
export type ResolvedWrapperAttrs = {
  /** SVG transform string, or undefined for identity */
  readonly transform?: string;
  /** Opacity value (only if < 1) */
  readonly opacity?: number;
  /** Resolved filter URL string (e.g. "url(#filter-0)") */
  readonly filterAttr?: string;
  /** CSS mix-blend-mode value (undefined = normal) */
  readonly blendMode?: BlendMode;
};

/**
 * Exhaustive field registry for ResolvedWrapperAttrs.
 *
 * This is the SINGLE source of truth for which fields exist on
 * ResolvedWrapperAttrs. Both SVG and React backends import this
 * constant and must handle every key. Adding a field to
 * ResolvedWrapperAttrs without adding it here causes a compile error
 * (via satisfies). A backend that doesn't use every key from this
 * registry is not exhaustive.
 */
export const WRAPPER_ATTRS_FIELDS = {
  transform: true,
  opacity: true,
  filterAttr: true,
  blendMode: true,
} as const satisfies Record<keyof ResolvedWrapperAttrs, true>;

/**
 * A resolved fill for SVG output: attrs to apply + optional def to declare.
 */
export type ResolvedFillResult = {
  readonly attrs: ResolvedFillAttrs;
  readonly def?: ResolvedFillDef;
  /**
   * Paint-level blend mode from the original Fill.blendMode.
   *
   * When a Figma paint carries a non-NORMAL blend mode (e.g. OVERLAY,
   * HUE, LUMINOSITY), the SVG output must emit `style="mix-blend-mode:
   * <mode>"` on the element that draws the paint. Without this, paints
   * like card-style FRAMEs' GRADIENT_RADIAL overlays drop to a
   * plain flat colour and the composite vibrancy (purple → magenta →
   * pink) is lost. Multi-fill layers carry the same field via
   * `ResolvedFillLayer`; single-fill results propagate through here.
   */
  readonly blendMode?: BlendMode;
};

/**
 * A fill layer for multi-paint fill rendering.
 * Each layer has resolved fill attrs and optional paint-level blend mode.
 */
export type ResolvedFillLayer = {
  readonly attrs: ResolvedFillAttrs;
  readonly def?: ResolvedFillDef;
  /** Paint-level blend mode (from the original Fill.blendMode) */
  readonly blendMode?: BlendMode;
};

// =============================================================================
// Render Defs — collected during resolution
// =============================================================================

/**
 * A def (gradient, filter, clip-path, pattern) to be declared in SVG <defs>.
 *
 * Each def carries its type and all resolved attributes, so backends
 * can format it without any computation.
 */
/**
 * Stroke-align mask: a simple shape mask used for INSIDE/OUTSIDE stroke clipping.
 * The mask contains a white filled shape that matches the node's geometry,
 * so the doubled stroke is clipped to the correct side.
 */
export type RenderStrokeMaskDef = {
  readonly type: "stroke-mask";
  readonly id: string;
  readonly shape: ClipPathShape;
  /** Stroke alignment — determines whether the mask shows inside or outside the shape. */
  readonly strokeAlign: "INSIDE" | "OUTSIDE";
};

export type RenderDef =
  | RenderGradientDef
  | RenderFilterDef
  | RenderClipPathDef
  | RenderPatternDef
  | RenderMaskDef
  | RenderStrokeMaskDef;

export type RenderMaskDef = {
  readonly type: "mask";
  readonly id: string;
  /** The resolved mask content node */
  readonly maskContent: RenderNode;
};

/**
 * Mask reference on a node — points to a mask def by ID.
 */
export type RenderMask = {
  readonly maskAttr: string;  // "url(#mask-id)"
};

export type RenderLinearGradientDef = {
  readonly type: "linear-gradient";
  readonly def: ResolvedFillDef & { readonly type: "linear-gradient" };
};

export type RenderRadialGradientDef = {
  readonly type: "radial-gradient";
  readonly def: ResolvedFillDef & { readonly type: "radial-gradient" };
};

export type RenderAngularGradientDef = {
  readonly type: "angular-gradient";
  readonly def: ResolvedFillDef & { readonly type: "angular-gradient" };
};

export type RenderDiamondGradientDef = {
  readonly type: "diamond-gradient";
  readonly def: ResolvedFillDef & { readonly type: "diamond-gradient" };
};

export type RenderGradientDef =
  | RenderLinearGradientDef
  | RenderRadialGradientDef
  | RenderAngularGradientDef
  | RenderDiamondGradientDef;

export type RenderFilterDef = {
  readonly type: "filter";
  readonly filter: ResolvedFilter;
};

export type RenderClipPathDef = {
  readonly type: "clip-path";
  readonly id: string;
  readonly shape: ClipPathShape;
};

export type RenderPatternDef = {
  readonly type: "pattern";
  readonly def: ResolvedFillDef & { readonly type: "image" };
};

export type ClipPathRectShape = {
  readonly kind: "rect";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx?: number;
  readonly ry?: number;
};

export type ClipPathPathShape = {
  readonly kind: "path";
  readonly d: string;
};

export type ClipPathEllipseShape = {
  readonly kind: "ellipse";
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
};

export type ClipPathShape = ClipPathRectShape | ClipPathPathShape | ClipPathEllipseShape;

export type RenderFrameSurfaceRectShape = {
  readonly kind: "rect";
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: CornerRadius;
  readonly cornerSmoothing?: number;
};

export type RenderFrameSurfacePathShape = {
  readonly kind: "path";
  readonly paths: readonly RenderPathContour[];
};

export type RenderFrameSurfaceShape = RenderFrameSurfaceRectShape | RenderFrameSurfacePathShape;

// =============================================================================
// RenderNode — discriminated union of all renderable instructions
// =============================================================================

/**
 * Base for all render nodes.
 */
/**
 * Background blur rendering info.
 *
 * Background blur cannot be expressed as an SVG filter — it uses
 * foreignObject + CSS backdrop-filter. This data is carried separately
 * from the filter pipeline so backends can render it appropriately.
 */
export type RenderBackgroundBlur = {
  /** Blur radius in pixels */
  readonly radius: number;
  /** Clip path ID that defines the node's shape (for clipping the foreignObject) */
  readonly clipId: string;
  /** Element bounds */
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
};

/**
 * Base shape shared by every RenderNode.
 *
 * `source` is the typed SceneNode this render node was resolved from.
 * Specialized RenderXxxNode types narrow `source` to their matching
 * SceneNode variant (e.g. RenderFrameNode carries `source: FrameNode`),
 * so backends can reach scene-graph-resolved data without runtime
 * discrimination on `source.type`.
 */
export type RenderNodeBase<TSource extends SceneNode = SceneNode> = {
  /** Original SceneNode ID */
  readonly id: SceneNodeId;
  /** Resolved wrapper attributes (transform, opacity, filter, blendMode) */
  readonly wrapper: ResolvedWrapperAttrs;
  /**
   * The node has shadow effects but no visible fill/stroke source. SVG filters
   * still need an opaque geometry source for SourceAlpha, while the terminal
   * filter output omits SourceGraphic so the geometry itself does not paint.
   */
  readonly filterSource?: "effect-shape";
  /** Inline defs needed by this node (gradients, filters, clip-paths) */
  readonly defs: readonly RenderDef[];
  /**
   * Original SceneNode reference.
   *
   * Specialized RenderXxxNode types use the generic to narrow this to the
   * exact SceneNode variant (FrameNode / RectNode / TextNode / ...). This
   * eliminates the need for backends to do `source as { … }` casts.
   */
  readonly source: TSource;
  /** Mask applied to this node (from parent's mask processing) */
  readonly mask?: RenderMask;
  /**
   * Background blur info — rendered via foreignObject + CSS backdrop-filter.
   * Present only on nodes that have a BACKGROUND_BLUR effect.
   */
  readonly backgroundBlur?: RenderBackgroundBlur;
};

// -- Group --

export type RenderGroupNode = RenderNodeBase<GroupNode> & {
  readonly type: "group";
  readonly children: readonly RenderNode[];
  /** Clip path ID for children when the source GROUP carries Kiwi geometry. */
  readonly childClipId?: string;
  /**
   * When true, the group wrapper <g> can be elided if there's only one child
   * and no wrapper attrs. (Optimization hint from original renderer.)
   */
  readonly canUnwrapSingleChild: boolean;
};

// -- Frame --

export type RenderFrameNode = RenderNodeBase<FrameNode> & {
  readonly type: "frame";
  /** Background rect (null if no fills) */
  readonly background: RenderFrameBackground | null;
  /** Children, optionally wrapped in a clip group */
  readonly children: readonly RenderNode[];
  /** Clip path ID for children (if clipsContent is true) */
  readonly childClipId?: string;
  /** Viewport-equivalent root frames are already clipped by the SVG viewport. */
  readonly omitChildClip?: boolean;
  /** Frame dimensions (needed for background rect and clip) */
  readonly width: number;
  readonly height: number;
  readonly surfaceShape: RenderFrameSurfaceShape;
  /** Clamped corner radius */
  readonly cornerRadius?: CornerRadius;
  /**
   * iOS-style continuous-curvature smoothing `[0, 1]`, forwarded from
   * the source node. When present and non-zero, the background rect,
   * children clip and stroke shape emit as a smoothed-corner path
   * (see `buildSmoothedRoundedRectPathD`) rather than `<rect rx>`.
   */
  readonly cornerSmoothing?: number;
  /**
   * Source fills for backend-specific draw data (e.g. WebGL GPU fills).
   * Parity with RenderRectNode/RenderEllipseNode — backends should never
   * discriminate `node.source.type` to reach these.
   */
  readonly sourceFills: readonly Fill[];
  /** Source stroke for backend-specific draw data. */
  readonly sourceStroke?: Stroke;
  /** Kiwi-authored surface geometry for backend tessellation. */
  readonly sourceSurfaceShape: FrameNode["surfaceShape"];
};

/**
 * Shape descriptor for stroke rendering.
 *
 * Contains all geometric parameters needed to draw the stroked shape.
 * Backends format this to their output (SVG string / React JSX)
 * without needing to know the parent node type.
 */
export type StrokeShape =
  | { readonly kind: "rect"; readonly width: number; readonly height: number; readonly cornerRadius?: CornerRadius; readonly cornerSmoothing?: number }
  | { readonly kind: "ellipse"; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }
  | { readonly kind: "path"; readonly paths: readonly { readonly d: string; readonly fillRule?: "evenodd" }[] };

/**
 * Stroke rendering instruction — discriminated union.
 *
 * Resolver determines the mode AND the shape; backends format without
 * branching on node type. This is the SoT for how strokes are drawn —
 * adding a new mode here forces both SVG and React backends to handle it.
 *
 * Every non-uniform mode carries the shape to stroke, so backends never
 * need to reconstruct shape parameters from the parent node.
 */
export type StrokeRendering =
  | { readonly mode: "uniform"; readonly attrs: ResolvedStrokeAttrs }
  | { readonly mode: "masked"; readonly attrs: ResolvedStrokeAttrs; readonly maskId: string; readonly shape: StrokeShape; readonly blendMode?: BlendMode; readonly layer?: ResolvedStrokeLayer }
  | { readonly mode: "layers"; readonly layers: readonly ResolvedStrokeLayer[]; readonly shape: StrokeShape }
  | {
      readonly mode: "individual";
      readonly sides: {
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
        readonly left: number;
      };
      readonly color: string;
      readonly opacity?: number;
      readonly width: number;
      readonly height: number;
      /** Frame corner radius. Required so the per-side stroke lines can be
       * clipped to the rounded perimeter; otherwise a thick top stroke
       * (e.g. an 8-px gradient band on a rounded card) bleeds straight across the
       * corner and paints pixels outside the rounded rect. */
      readonly cornerRadius?: CornerRadius;
      /** Stroke alignment relative to each side's edge. Determines where
       * the stroke band paints relative to the geometric edge:
       *   INSIDE  → band lies inside  the rect (each line offset inward  by t/2)
       *   OUTSIDE → band lies outside the rect (each line offset outward by t/2)
       *   CENTER (undefined here) → band is centred on the edge (line ON the edge)
       *
       * Required because Figma's `_Separator` (a 299×1 OUTSIDE-stroked
       * INSTANCE used between Action rows) places its visible 1px band
       * one pixel ABOVE the geometry. Treating its individual top stroke
       * as INSIDE paints into the row's interior instead.
       */
      readonly strokeAlign?: "INSIDE" | "OUTSIDE";
    };

export type RenderFrameBackground = {
  readonly fill: ResolvedFillResult;
  readonly fillLayers?: readonly ResolvedFillLayer[];
  /** Stroke rendering — single discriminated union replaces stroke/strokeLayers/strokeMaskId/individualStrokes */
  readonly strokeRendering?: StrokeRendering;
  /** Drop/inner shadow filter for the frame surface only, not its children. */
  readonly filterAttr?: string;
};

// -- Rect --

export type RenderRectNode = RenderNodeBase<RectNode> & {
  readonly type: "rect";
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: CornerRadius;
  /** See `RenderFrameNode.cornerSmoothing`. */
  readonly cornerSmoothing?: number;
  readonly fill: ResolvedFillResult;
  /** All fill layers for multi-paint rendering (length >= 2 means stacked fills) */
  readonly fillLayers?: readonly ResolvedFillLayer[];
  /** Stroke rendering — single discriminated union */
  readonly strokeRendering?: StrokeRendering;
  /** Whether a wrapper <g> is needed (transform, opacity, filter, or defs present) */
  readonly needsWrapper: boolean;
  // Source data for WebGL
  readonly sourceFills: readonly Fill[];
  readonly sourceStroke?: Stroke;
};

// -- Ellipse --

export type RenderEllipseNode = RenderNodeBase<EllipseNode> & {
  readonly type: "ellipse";
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly fill: ResolvedFillResult;
  readonly fillLayers?: readonly ResolvedFillLayer[];
  readonly strokeRendering?: StrokeRendering;
  readonly needsWrapper: boolean;
  // Source data for WebGL
  readonly sourceFills: readonly Fill[];
  readonly sourceStroke?: Stroke;
};

// -- Path --

export type RenderPathNode = RenderNodeBase<PathNode | EllipseNode> & {
  readonly type: "path";
  /** Resolved SVG path data per contour */
  readonly paths: readonly RenderPathContour[];
  readonly fill: ResolvedFillResult;
  readonly fillLayers?: readonly ResolvedFillLayer[];
  readonly strokeRendering?: StrokeRendering;
  readonly needsWrapper: boolean;
  // Source data for WebGL
  readonly sourceContours: readonly PathContour[];
  readonly sourceFills: readonly Fill[];
  readonly sourceStroke?: Stroke;
};

export type RenderPathContour = {
  /** SVG d attribute string */
  readonly d: string;
  /** Fill rule (only if not "nonzero") */
  readonly fillRule?: "evenodd";
  /** Per-contour fill override (from vector style override table) */
  readonly fillOverride?: ResolvedFillResult;
};

// -- Text --

export type RenderTextNode = RenderNodeBase<TextNode> & {
  readonly type: "text";
  readonly width: number;
  readonly height: number;
  /** Base fill (= the source `fill` colour) — used for decorations and as
   * the default for line mode. Per-character fills live on `content.runs`. */
  readonly fillColor: string;
  readonly fillOpacity?: number;
  /** Clip path ID when textAutoResize is NONE or TRUNCATE */
  readonly textClipId?: string;
  /**
   * When "ENDING", text is truncated with ellipsis.
   * SVG backend applies text-overflow:ellipsis via foreignObject for <text> mode,
   * or relies on clip for glyph mode.
   */
  readonly textTruncation?: string;
  /** Leading trim mode (e.g. "CAP_HEIGHT") */
  readonly leadingTrim?: string;
  /** Hyperlink URL — wraps the text content in an SVG <a> element */
  readonly hyperlink?: string;
  /** Rendering mode: outlined glyphs or resolved text line layout */
  readonly content: RenderTextGlyphs | RenderTextLines;
  // Source data for WebGL
  readonly sourceGlyphContours?: readonly PathContour[];
  readonly sourceDecorationContours?: readonly PathContour[];
  /** Base text run fill, retained for diagnostics and legacy WebGL state mirrors. */
  readonly sourceFillColor: Color;
  /** Base text run opacity. Glyph rendering consumes `content.runs[].fillOpacity` directly. */
  readonly sourceFillOpacity: number;
  readonly sourceTextLineLayout?: TextLineLayout;
  readonly sourceTextAutoResize: TextAutoResize;
};

/**
 * One per-fill segment in glyph mode: a chunk of the glyph + decoration
 * path data that should be painted with `fillColor`/`fillOpacity`.
 *
 * Glyph contours are pre-grouped by which `TextRun` their `firstCharacter`
 * falls into; decorations land on a single base run because Figma applies
 * them at the line level, not per character.
 *
 * SoT also re-used by the shared `format-rendering.ts` text formatter
 * (which produces the same shape from `TextRendering` rather than from
 * a `RenderTextNode`) — no separate inline declaration of the
 * `{ fillColor, fillOpacity, d }` triple anywhere downstream.
 */
export type RenderTextGlyphRun = {
  readonly fillColor: string;
  readonly fillOpacity: number;
  /**
   * Per-pass blend mode (resolved CSS-token form). `undefined` means
   * implicit NORMAL — the formatter omits `style="mix-blend-mode:…"`
   * in that case. Carries the source `Fill.blendMode` so stacked
   * fills like `[{black @0.15 NORMAL}, {black @1 OVERLAY}]` render
   * with the same painter's-algorithm composite Figma uses (instead
   * of collapsing to solid black when the second pass paints opaque
   * over the faint first pass).
   */
  readonly blendMode?: BlendMode;
  /** Combined SVG path `d` for this run's glyph (and any decoration) contours. */
  readonly d: string;
};

export type RenderTextGlyphs = {
  readonly mode: "glyphs";
  /**
   * Per-fill path segments. `runs.length === 1` is the common case
   * (uniform fill); `> 1` indicates character-level style overrides.
   * Empty array == empty source text.
   */
  readonly runs: readonly RenderTextGlyphRun[];
};

export type RenderTextLines = {
  readonly mode: "lines";
  readonly layout: TextLineLayout;
};

// -- Image --

export type RenderImageNode = RenderNodeBase<ImageNode> & {
  readonly type: "image";
  readonly width: number;
  readonly height: number;
  /** Data URI for SVG/React (base64-encoded) */
  readonly dataUri?: string;
  /** Resolved SVG preserveAspectRatio from Figma scaleMode */
  readonly preserveAspectRatio: string;
  readonly needsWrapper: boolean;
  // Source data for WebGL
  readonly sourceImageHash: string;
  readonly sourceData: Uint8Array;
  readonly sourceMimeType: string;
  readonly sourceScaleMode: string;
  readonly sourceImageShouldColorManage?: boolean;
};

// =============================================================================
// RenderNode union
// =============================================================================

export type RenderNode =
  | RenderGroupNode
  | RenderFrameNode
  | RenderRectNode
  | RenderEllipseNode
  | RenderPathNode
  | RenderTextNode
  | RenderImageNode;

// =============================================================================
// RenderTree root
// =============================================================================

/**
 * The fully-resolved render tree.
 *
 * Produced by resolveRenderTree(sceneGraph).
 * Consumed by SVG/React/WebGL backends.
 */
export type RenderTree = {
  readonly width: number;
  readonly height: number;
  readonly viewport: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly children: readonly RenderNode[];
};
