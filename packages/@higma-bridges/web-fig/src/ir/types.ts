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
  /** Per-corner radius, top-left, top-right, bottom-right, bottom-left. */
  readonly cornerRadius?: readonly [number, number, number, number];
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
};

/** Plain rectangle with no children — for backgrounds / dividers. */
export type RectNodeIR = NodeBaseIR & {
  readonly kind: "rectangle";
};

/** Vector blob carrying SVG path data. Round-trips via `<svg>`. */
export type VectorNodeIR = NodeBaseIR & {
  readonly kind: "vector";
  /** SVG path `d` attribute. */
  readonly path: string;
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
  readonly root: FrameNodeIR;
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
