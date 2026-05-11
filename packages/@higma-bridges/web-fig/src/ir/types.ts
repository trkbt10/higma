/**
 * @file Neutral intermediate representation shared by `@higma-tools/fig-to-web`
 * and `@higma-tools/web-to-fig`.
 *
 * Contract: every conversion between Fig and Web goes through this IR.
 * Neither side may invent fields the other side cannot interpret;
 * adding a field requires updating both adapters and the round-trip
 * spec under `@higma-tools/web-to-fig/spec`.
 *
 * The IR is intentionally a *strict subset* of Figma's domain — only
 * the visual / layout properties that have a well-defined CSS
 * counterpart and vice versa. Extensions (component variants, complex
 * vector paths, fancy typography) are *not* part of the bridge; tools
 * that need them must use the full `@higma-document-models/fig` types
 * directly.
 *
 * Fail-fast policy: missing required values must throw at the adapter
 * boundary, not be silently filled in. The IR uses `undefined` only
 * for fields that are genuinely optional (e.g. `cornerRadius` on a
 * rectangle that has none).
 */

/** Pixel rectangle in the IR's local coordinate space. */
export type BoxIR = {
  /** Left edge relative to the parent container's content box. */
  readonly x: number;
  /** Top edge relative to the parent container's content box. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * 2D affine transform applied to the node *after* its `box` is
 * placed. CSS shape: `matrix(a, b, c, d, tx, ty)` — i.e.
 *
 *     | a  c  tx |
 *     | b  d  ty |
 *     | 0  0  1  |
 *
 * Translation is normally baked into `box.x/y` by the capture
 * (browser's `getBoundingClientRect` already returns the post-
 * transform AABB), so the most common reason to surface a transform
 * here is rotation or non-uniform scaling that the box dimensions
 * alone cannot express. The capture rotates the AABB into the box
 * dimensions and writes the rotation matrix here so the renderer can
 * apply the actual rotation around the box centre.
 *
 * Identity (`a=1, b=0, c=0, d=1, tx=0, ty=0`) is omitted — the IR
 * uses `transform: undefined` for the no-op case to keep tree
 * snapshots small.
 */
export type TransformIR = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
};

/**
 * CSS `<length-percentage>` carrier — the Single Source of Truth for
 * any field whose source value can be either a literal pixel length
 * (`24px`) or a percentage of an axis on the owning element
 * (`50%` border-radius, `2em` padding once `getComputedStyle`
 * resolves to px). The capture layer stores the original value
 * verbatim; the emit layer resolves percentages against the owning
 * element's box at the call site that knows the axis (width,
 * height, or min(width,height)) the percentage references.
 *
 * Storing pre-resolved px upstream would require the normaliser to
 * know each property's percentage axis (radius → min, padding-top →
 * width, padding-left → width, gap → main axis), which fragments the
 * resolution rules across the codebase. Carrying the unit through to
 * emit keeps the SoT in one place — the resolver function in
 * `@higma-bridges/web-fig/length`.
 */
export type LengthIR =
  | { readonly kind: "px"; readonly value: number }
  | { readonly kind: "percent"; readonly value: number };

/** Normalised RGBA color. Each channel is in `[0, 1]`. */
export type ColorIR = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

/** Solid fill or stroke. */
export type SolidPaintIR = {
  readonly kind: "solid";
  readonly color: ColorIR;
  /** Whether the paint is currently active. Default true. */
  readonly visible?: boolean;
  /** Multiplied with the color's alpha. Default 1. */
  readonly opacity?: number;
};

/** Linear gradient. Stops are sorted by position 0..1 ascending. */
export type LinearGradientPaintIR = {
  readonly kind: "linear-gradient";
  /** Angle in degrees, CSS convention: 0deg points up, 90deg points right. */
  readonly angle: number;
  readonly stops: readonly GradientStopIR[];
  readonly visible?: boolean;
  readonly opacity?: number;
};

export type GradientStopIR = {
  /** Position along the gradient axis, in `[0, 1]`. */
  readonly position: number;
  readonly color: ColorIR;
};

/** Bitmap fill referenced by a stable id (resolves through the asset map). */
export type ImagePaintIR = {
  readonly kind: "image";
  /** Stable id into the IR's `assets` map; the image bytes live there. */
  readonly imageId: string;
  /**
   * `cover` (Figma `FILL`) — scale to cover the box, cropping the
   * overhanging axis. `contain` (Figma `FIT`) — scale to contain,
   * letterboxing the under-fitting axis. `tile` — repeat at natural
   * size. `stretch` (Figma `STRETCH`) — non-uniform scale to fill.
   */
  readonly scaleMode: "cover" | "contain" | "tile" | "stretch";
  readonly visible?: boolean;
  readonly opacity?: number;
};

export type PaintIR = SolidPaintIR | LinearGradientPaintIR | ImagePaintIR;

/** Drop shadow / inner shadow / blur. */
export type ShadowEffectIR = {
  readonly kind: "drop-shadow" | "inner-shadow";
  readonly color: ColorIR;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blurRadius: number;
  /** Spread radius in px. CSS `box-shadow`'s fourth length component. Default 0. */
  readonly spread?: number;
  readonly visible?: boolean;
};

export type BlurEffectIR = {
  readonly kind: "layer-blur" | "background-blur";
  readonly radius: number;
  readonly visible?: boolean;
};

export type EffectIR = ShadowEffectIR | BlurEffectIR;

/** CSS stroke alignment vs the box edge. */
export type StrokeAlignIR = "inside" | "center" | "outside";

export type StrokeIR = {
  readonly paint: PaintIR;
  readonly weight: number;
  readonly align: StrokeAlignIR;
  /** Authored dash pattern in CSS / SVG order. Empty array = solid. */
  readonly dashes?: readonly number[];
};

/**
 * Auto-layout descriptor.
 *
 * Maps 1:1 to both Figma's `stackMode` family and CSS flexbox so the
 * round trip is invariant. Counter-axis alignment maps to CSS
 * `align-items`; primary-axis alignment maps to `justify-content`.
 *
 * `none` represents an absolute-positioning container (Figma frame
 * with no `stackMode`, or a CSS block / position:relative ancestor of
 * absolutely-positioned children).
 */
export type AutoLayoutIR =
  | { readonly direction: "none" }
  | {
      readonly direction: "row" | "column";
      /** Distance between consecutive children along the primary axis. */
      readonly gap: number;
      readonly paddingTop: number;
      readonly paddingRight: number;
      readonly paddingBottom: number;
      readonly paddingLeft: number;
      readonly primaryAlign: "start" | "center" | "end" | "space-between";
      readonly counterAlign: "start" | "center" | "end" | "stretch";
      /** Whether children may wrap onto multiple lines along the primary axis. */
      readonly wrap?: boolean;
    };

export type AxisSizingIR = "fixed" | "fill" | "hug";

/**
 * Per-child sizing for a flow child of an auto-layout parent.
 *
 * `primary` is the parent's flex direction (the axis along which the
 * child's gap matters). `counter` is the perpendicular axis. The
 * `none` case is for static-positioned children (absolute layout).
 */
export type ChildSizingIR =
  | {
      readonly mode: "flow";
      readonly primary: AxisSizingIR;
      readonly counter: AxisSizingIR;
    }
  | { readonly mode: "absolute" };

/** Typography descriptor. CSS-shaped values, not Figma raw enums. */
export type TextStyleIR = {
  readonly fontFamily: string;
  /** CSS font-style keyword (`normal` / `italic` / `oblique`). */
  readonly fontStyle: "normal" | "italic" | "oblique";
  /** Numeric CSS font-weight (100..900). */
  readonly fontWeight: number;
  readonly fontSize: number;
  /**
   * Line-height in CSS units. `{px}` is an explicit pixel stride;
   * `{ratio}` is a unitless multiplier (CSS `line-height: 1.5`); `normal`
   * defers to the font's intrinsic line-height.
   */
  readonly lineHeight:
    | { readonly unit: "px"; readonly value: number }
    | { readonly unit: "ratio"; readonly value: number }
    | { readonly unit: "normal" };
  /** Letter-spacing, in px. 0 means default. */
  readonly letterSpacing: number;
  readonly textAlign: "left" | "center" | "right" | "justify";
  /**
   * Vertical alignment within the TEXT box.
   *
   * CSS does not have a direct text-vertical-align. The IR defaults to
   * `top` (Figma's `TOP` is the no-op). The web-to-fig normaliser
   * promotes it to `center` / `bottom` when the captured element's
   * computed style describes a leaf-text host whose flex container is
   * centring its single text child vertically (a `display: flex;
   * align-items: center;` button label, an `inline-flex` chip, etc.).
   * That promotion lives in `promoteLeafTextToFrame`'s inner-text path
   * and only runs when a TEXT node is the sole flex child of a
   * centring container — pages that drive vertical centring through
   * `padding-top: <height/2>` or `line-height = box-height` keep the
   * default `top` and rely on glyph metrics to land in place.
   */
  readonly textAlignVertical: "top" | "center" | "bottom";
  readonly textTransform: "none" | "uppercase" | "lowercase" | "capitalize";
  readonly textDecoration: "none" | "underline" | "line-through";
};

/** Visible style applied to a `frame` or `text` node. */
export type StyleIR = {
  /** Bottom-up paint stack — first entry paints first. */
  readonly fills: readonly PaintIR[];
  readonly strokes: readonly StrokeIR[];
  readonly effects: readonly EffectIR[];
  /** Multiplied with descendant opacities. Default 1. */
  readonly opacity: number;
  /**
   * Per-corner radius, top-left, top-right, bottom-right, bottom-left.
   * Stored as `<length-percentage>` so capture preserves the original
   * unit; emit resolves any percentage against `min(width, height)`
   * of the owning element via `resolveLength` from the bridge.
   */
  readonly cornerRadius?: readonly [LengthIR, LengthIR, LengthIR, LengthIR];
  /** Whether overflow is clipped to the box. */
  readonly clipsContent: boolean;
  /** CSS `mix-blend-mode` value. `normal` is the default. */
  readonly blendMode:
    | "normal"
    | "multiply"
    | "screen"
    | "overlay"
    | "darken"
    | "lighten"
    | "color-dodge"
    | "color-burn"
    | "hard-light"
    | "soft-light"
    | "difference"
    | "exclusion"
    | "hue"
    | "saturation"
    | "color"
    | "luminosity";
};

/** Common fields every IR node carries. */
export type NodeBaseIR = {
  /**
   * Stable id that survives the round trip. The producer assigns it; the
   * consumer must preserve it. For Fig→Web this is the FigNode guid; for
   * Web→Fig this is the DOM element's deterministic xpath-like address.
   */
  readonly id: string;
  /**
   * Cross-viewport identity key.
   *
   * Two nodes that share `componentKey` are the same logical component
   * rendered at different breakpoints. The Fig writer collapses them
   * into a single SYMBOL definition + per-viewport INSTANCE references,
   * which is the structure that lets a Figma designer resize one
   * INSTANCE and watch auto-layout reflow inside the SYMBOL — i.e. the
   * concrete proof that the captured layout is responsive.
   *
   * For Web→Fig this is the DOM element's path (`0/0/2/1` etc.) —
   * stable across viewports unless media queries alter the tree.
   */
  readonly componentKey: string;
  /** Human-readable label. Carried into the Figma layer name. */
  readonly name: string;
  readonly box: BoxIR;
  readonly style: StyleIR;
  /** Whether the producer marked this node visible. Hidden nodes still appear. */
  readonly visible: boolean;
  /**
   * How this node sizes itself relative to its parent's auto-layout.
   * Required for round-trip fidelity — without it, "fill width" and
   * "fixed 100px" collapse into a single representation and the inverse
   * direction can't recover authorial intent.
   */
  readonly sizing: ChildSizingIR;
  /**
   * Optional 2D affine transform applied after the node is positioned
   * by its `box`. Surfaced when the captured CSS `transform` is
   * non-identity AND the transform is not pure translation (translation
   * is already baked into `box.x/y` by the browser's getBoundingClientRect).
   * Undefined for the common no-transform case.
   */
  readonly transform?: TransformIR;
};

/** A frame / div / container. */
export type FrameNodeIR = NodeBaseIR & {
  readonly kind: "frame";
  readonly autoLayout: AutoLayoutIR;
  readonly children: readonly NodeIR[];
};

/**
 * A single character range inside a TEXT node carrying styles that
 * differ from the node's base. Modelled after Figma's
 * `styleOverrideTable` + `characterStyleIDs` pair: each run owns a
 * half-open `[start, end)` over `characters`, contiguous runs do not
 * overlap, and characters not covered by any run inherit the base
 * style on the node itself.
 *
 * The bridge IR keeps the run model lossless across Web → Fig → Web.
 * The web-side producer emits one run per inline element whose
 * computed style differs from its block-level paragraph host (e.g.
 * `<a>` / `<strong>` / `<em>` / `<span style="...">`). The fig-side
 * producer emits one run per `styleOverrideTable` entry referenced
 * by `characterStyleIDs`.
 */
export type TextRunIR = {
  readonly start: number;
  readonly end: number;
  /** Glyph color override. Undefined inherits the node's base fill. */
  readonly color?: ColorIR;
  /** Font family override. Undefined inherits the node base. */
  readonly fontFamily?: string;
  /** Font weight override. */
  readonly fontWeight?: number;
  /** Font style override (`italic` / `oblique`). */
  readonly fontStyle?: "normal" | "italic" | "oblique";
  /** Text decoration override (e.g. `<a>` underline inside a paragraph). */
  readonly textDecoration?: "none" | "underline" | "line-through";
};

/**
 * A text node. The base style on `textStyle` covers every character
 * not claimed by an entry in `runs`; the runs carry per-character
 * deviations (a hyperlink's blue colour, an italic span, etc.).
 */
export type TextNodeIR = NodeBaseIR & {
  readonly kind: "text";
  readonly characters: string;
  readonly textStyle: TextStyleIR;
  /** Optional ordered runs. Each run's `[start, end)` must not overlap any other. */
  readonly runs?: readonly TextRunIR[];
  /**
   * Captured per-line client rects (from `Range.getClientRects()` on
   * the source DOM node). Length == number of visual lines the
   * browser laid the text into; the rects are in the same coordinate
   * space as `box`. Renderers trust this list as the authoritative
   * wrap breakdown so the rendered `.fig` reproduces the captured
   * line count without re-deriving wrap from approximate glyph
   * advance widths.
   *
   * Absent for hand-built IR (synthetic snapshots, multi-fig synth)
   * and any TEXT node whose source didn't go through a browser walker.
   */
  readonly capturedLineRects?: readonly BoxIR[];
  /**
   * Per-visual-line baseline Y offsets in the same coordinate space
   * as `box` (relative to the text node's parent). One entry per
   * `capturedLineRects` entry; renderers use them to place each
   * line's glyph baseline at the exact spot the browser painted.
   *
   * Why per-line and not just first-line: CSS allows the line box's
   * baseline to vary line-to-line when inline children with different
   * font-sizes, line-heights, or vertical-align values share a line.
   * Even within a single line, the line's baseline can shift downward
   * if an inline `<span style="line-height:2em">` forces a taller
   * strut. Capturing baseline per visual line preserves that — a
   * single `firstLineBaselineY` would collapse the data and produce
   * the same drift on any wrap whose later lines pick up a different
   * baseline from the first.
   *
   * Browser-side derivation: each line's baseline is computed as
   * `lineRect.bottom - fontBoundingBoxDescent` against the element's
   * computed font, so the value matches the layout pass that drew
   * the actual pixels. The element-level font metric is correct here
   * because lines sharing a single element share a font; per-run
   * line-height overrides surface as separate inline elements whose
   * own walker entry carries its own line list and baselines.
   *
   * Absent for hand-built IR (synthetic snapshots, multi-fig synth)
   * and any TEXT node whose source didn't go through a browser
   * walker. Renderers fall back to font-metric-derived baseline
   * placement when this field is absent.
   *
   * Length contract: when present, length equals `capturedLineRects`
   * length. A walker that fails to compute baselines for some lines
   * but not others omits the whole array rather than mixing valid
   * and undefined entries.
   */
  readonly capturedLineBaselineYs?: readonly number[];
};

/** Plain rectangle with no children — for backgrounds / dividers. */
export type RectNodeIR = NodeBaseIR & {
  readonly kind: "rectangle";
};

/**
 * Vector content captured from inline `<svg>` markup. The IR is the
 * single source of truth for resolved SVG drawing — emit paths /
 * sub-paths verbatim into the fig's VECTOR nodes so the round-trip
 * keeps the original geometry. We deliberately do NOT downcast to
 * an image fill: that would force the renderer to rasterise icons
 * and lose Figma's native vector editing surface.
 *
 * `paths` carries each `<path d="…">` within the SVG, with the
 * resolved fill / stroke / nonzero-rule colour pre-translated into
 * IR `PaintIR` values. `viewBox` is kept verbatim so emit can
 * compose path coordinates against the right reference frame even
 * when the captured `<svg>` had no explicit `width`/`height`.
 */
export type VectorPathIR = {
  /** SVG path `d` attribute. */
  readonly d: string;
  /** Resolved `fill` (CSS computed style on the path). Undefined for unfilled. */
  readonly fill?: PaintIR;
  /** Resolved stroke as a single SOLID/IMAGE paint (Figma's vector model). */
  readonly stroke?: PaintIR;
  /** Stroke weight in SVG user units. */
  readonly strokeWeight?: number;
  /**
   * `nonzero` (default) or `evenodd`. Translated 1:1 to Figma's
   * `windingRule` field at emit time.
   */
  readonly fillRule?: "nonzero" | "evenodd";
};

export type VectorNodeIR = NodeBaseIR & {
  readonly kind: "vector";
  /** Captured `<svg viewBox="x y w h">` reference frame. Defaults to the node box. */
  readonly viewBox?: { readonly minX: number; readonly minY: number; readonly width: number; readonly height: number };
  /** Captured SVG paths. */
  readonly paths: readonly VectorPathIR[];
};

export type NodeIR = FrameNodeIR | TextNodeIR | RectNodeIR | VectorNodeIR;

/** Asset bytes referenced by image paints. */
export type AssetIR = {
  readonly id: string;
  readonly mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
  readonly bytes: Uint8Array;
};

/**
 * Top-level capture of a single rendered surface — a Figma frame, a
 * web viewport, a captured Playwright page. The viewport carries the
 * outermost dimensions so consumers can lay it out at the authored
 * size without inferring it from descendants.
 */
export type ViewportIR = {
  /** Source URL or Figma frame name — diagnostic, not interpreted. */
  readonly source: string;
  /** Breakpoint label (`mobile` / `tablet` / `desktop` / `default`). */
  readonly breakpoint: string;
  readonly box: BoxIR;
  /** Device-pixel-ratio at capture time. 1 for Figma. */
  readonly devicePixelRatio: number;
  readonly background: ColorIR;
  /**
   * The static-flow content tree rooted at the captured surface's
   * outermost element. `position: fixed` / `sticky` subtrees are
   * lifted out into `viewportLayer` so they can be emitted at
   * viewport-anchored absolute coordinates without distorting the
   * static layout's auto-layout inference.
   */
  readonly root: FrameNodeIR;
  /**
   * Subtrees that paint at viewport-anchored coordinates regardless
   * of how the static content scrolls / reflows — i.e. anything CSS
   * declared `position: fixed` (or `sticky` once it has stuck).
   * Each entry's `box` is in viewport-absolute coordinates (top-left
   * = (0, 0) of the viewport), and its `sizing.mode === "absolute"`
   * so the emitter pins it as `stackPositioning: ABSOLUTE`.
   */
  readonly viewportLayer: readonly NodeIR[];
  readonly assets: ReadonlyMap<string, AssetIR>;
};

/**
 * A page captured at multiple breakpoints. Each breakpoint is an
 * independent ViewportIR — different sizes, possibly different DOM
 * because of media queries — but cross-breakpoint identity lives in
 * `NodeBaseIR.componentKey`. The Fig writer uses that to emit a
 * single SYMBOL definition per logical component referenced by all
 * viewports, so resizing an INSTANCE in Figma exercises the auto-
 * layout the page actually depends on.
 */
export type MultiViewportIR = {
  readonly source: string;
  readonly viewports: readonly ViewportIR[];
};
