/**
 * @file In-page DOM snapshot — the raw payload returned by the
 * Playwright capture script before normalization.
 *
 * The shape is deliberately simple: every visible element becomes a
 * `RawElement` carrying its computed style, bounding box (relative to
 * the document), tag, and `nodeIndex`-keyed children. Image bytes
 * referenced by `background-image: url(...)` and `<img src>` are
 * captured separately so the caller can choose to inline them as
 * Uint8Array or skip them for a lighter snapshot.
 *
 * The snapshot intentionally does NOT carry IR / Figma vocabulary:
 * normalisation lives in `../normalize/` and is the only place that
 * makes interpretive choices (which CSS values become which IR
 * paints, which positioning model becomes auto-layout, etc.).
 */

/** Bounding box reported by `getBoundingClientRect`, in CSS pixels. */
export type RawRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * 2x3 affine matrix in column-major order. Maps (x, y) to
 * (a*x + c*y + e, b*x + d*y + f).
 */
export type RawAffine = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

/**
 * Captured `<path>` data from a host `<svg>` element. Resolved colours
 * use the path's own computed style (Cascade — including
 * `<svg>`-level inheritance) so the IR stage doesn't need to
 * re-resolve CSS variables.
 *
 * `transform` is the accumulated `<g transform>` chain (plus any
 * `transform` on the path / shape itself) of every ancestor between
 * the path and the host `<svg>`. The host-side normaliser bakes it
 * into `d` via `transformPathData` so the final geometry lands in the
 * SVG viewport's coordinate frame. `undefined` means identity (no
 * transform anywhere along the chain).
 */
export type RawSvgPath = {
  readonly d: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly fillRule?: "nonzero" | "evenodd";
  readonly transform?: RawAffine;
};

/**
 * Captured `<svg>` content — the structural information required to
 * round-trip through the bridge as a vector node rather than a
 * raster image. Only inline SVG with a flat `<path>` set is
 * captured at the moment; nested `<g>` and `<use>` references are a
 * future extension and will surface as additional fields here.
 */
export type RawSvgContent = {
  readonly viewBox?: { readonly minX: number; readonly minY: number; readonly width: number; readonly height: number };
  readonly paths: readonly RawSvgPath[];
};

/**
 * Captured `::before` / `::after` pseudo-element content. Pseudo-
 * elements aren't reachable through the DOM tree so the in-page
 * walker queries `getComputedStyle(el, "::before"|"::after")` for
 * every visible element and surfaces non-empty `content` strings
 * here. The normaliser turns them into synthetic TEXT IR children
 * placed at the host's content-box edge — close enough for the
 * fidelity diff because these are usually short separators
 * (" / ", "•", "→") whose layout is anchored to the host.
 *
 * Image / `attr()` / counter content is not yet captured; only the
 * literal-string form (the most common in the wild) is.
 */
export type RawPseudoContent = {
  readonly which: "before" | "after";
  readonly text: string;
  readonly computedStyle: Readonly<Record<string, string>>;
};

/**
 * One captured DOM element. Only the computed-style properties
 * relevant to the bridge IR are pulled — adding a property here
 * requires extending the IR and the normalizer in tandem.
 */
export type RawElement = {
  /** Stable address — the in-document path, e.g. `0/2/1`. */
  readonly id: string;
  readonly tag: string;
  /** Page-relative bounding rect (CSS pixels). */
  readonly rect: RawRect;
  /** Pixel-perfect content rect (excluding borders), used for child positioning. */
  readonly contentRect: RawRect;
  /** `true` when the element passes the visibility filter (display / visibility / opacity). */
  readonly visible: boolean;
  /** Subset of `getComputedStyle(...)` keyed verbatim. */
  readonly computedStyle: Readonly<Record<string, string>>;
  /**
   * `<img>` src or *first* `background-image` URL. Kept for legacy
   * call sites that only need the dominant image (e.g. img-tag
   * normalisation). Multi-layer backgrounds also populate
   * `imageIds` below, with `imageId` mirroring `imageIds[0]`.
   */
  readonly imageId?: string;
  /**
   * Per-layer image ids for `background-image` URL layers. Index
   * matches the CSS source order — `imageIds[0]` is the
   * top-most paint layer (the one a CSS author wrote first).
   * Populated even for single-layer backgrounds so consumers can
   * walk a uniform shape.
   */
  readonly imageIds?: readonly string[];
  /**
   * Intrinsic pixel dimensions of `imageId`'s asset. Populated
   * host-side by sniffing the response bytes. Required for
   * `background-size: auto` semantics — the renderer must paint
   * the image at intrinsic size, which the IR can only express by
   * synthesising a child frame whose box equals the natural size.
   */
  readonly imageNaturalWidth?: number;
  readonly imageNaturalHeight?: number;
  /**
   * CSS `mask-image` URL captured separately from `imageId`. The
   * browser uses the mask asset's alpha channel to silhouette the
   * element's `background-color` / `color`; surfacing the asset
   * itself as an image fill (which we used to do) renders the
   * mask bitmap instead. Host-side resolves this id into either
   * `maskSvgContent` (when the URL responded with an SVG —
   * preferred, lets us render a clean vector path filled with the
   * host's CSS colour) or to a raster asset (when the mask is a
   * raster).
   */
  readonly maskImageId?: string;
  /**
   * Vector geometry for the captured `mask-image` SVG, parsed
   * host-side from the SVG bytes the browser already downloaded.
   * When present the normaliser emits a vector node whose paths
   * are filled with the host element's CSS `color`.
   */
  readonly maskSvgContent?: RawSvgContent;
  /** Intrinsic pixel size of the `maskImageId` asset. */
  readonly maskNaturalWidth?: number;
  readonly maskNaturalHeight?: number;
  /** Captured SVG geometry when `tag === "svg"`. */
  readonly svgContent?: RawSvgContent;
  /** Concatenated direct text content. Empty for non-leaf containers. */
  readonly text?: string;
  /**
   * Per-position direct-text fragments. `textFragments[i]` is the
   * direct text node that immediately precedes
   * `children[i]`; `textFragments[children.length]` carries any
   * trailing text after the last child. Length equals
   * `children.length + 1`. Empty strings mean "no text in that
   * position". Populated only when the element actually has
   * interleaved text + element children — leaf-text nodes use the
   * legacy `text` field instead.
   */
  readonly textFragments?: readonly string[];
  /**
   * Per-line client rects captured via `Range.getClientRects()` over
   * the element's text content. The renderer trusts this to know
   * exactly where the browser wrapped the text, so it doesn't have
   * to re-derive line breaks from imperfect glyph-advance metrics.
   * Absent for non-text elements.
   */
  readonly textLineRects?: readonly RawRect[];
  /**
   * Per-visual-line baseline Y positions in viewport coordinates,
   * captured from the browser's text layout pass. One entry per
   * `textLineRects` entry. Renderers place each line's glyph
   * baseline at the captured value to sidestep font-metric-derived
   * baseline drift. Absent when the element has no text-bearing
   * line or when the in-page Canvas font-metric API was unavailable.
   */
  readonly textLineBaselineYs?: readonly number[];
  /**
   * Per-codepoint resolved-font runs over the element's direct text.
   * Each entry is a half-open `[start, end)` range whose codepoints
   * all resolved (via Chromium's font fallback) to `fontFamily`.
   * Reproduces per-glyph fallback so emit can lift CJK fragments in
   * a Latin-first stack onto separate fig `styleRuns[i].fontName`.
   *
   * Absent for non-text elements; never partial.
   */
  readonly textCharacterFontRuns?: readonly { readonly start: number; readonly end: number; readonly fontFamily: string }[];
  /** Captured `::before` / `::after` pseudo-element strings. */
  readonly pseudo?: readonly RawPseudoContent[];
  readonly children: readonly RawElement[];
};

/** A captured asset referenced by an element's `imageId`. */
export type RawAsset = {
  readonly id: string;
  readonly mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
  readonly bytes: Uint8Array;
};

export type RawViewportSnapshot = {
  /** URL or `file://` path the snapshot was captured from. */
  readonly source: string;
  readonly viewport: RawRect;
  readonly devicePixelRatio: number;
  readonly background: string;
  readonly root: RawElement;
  readonly assets: ReadonlyMap<string, RawAsset>;
};
