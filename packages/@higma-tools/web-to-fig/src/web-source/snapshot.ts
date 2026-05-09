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
  /** `<img>` src or first `background-image` url; resolves into the snapshot.images map. */
  readonly imageId?: string;
  /** Concatenated direct text content. Empty for non-leaf containers. */
  readonly text?: string;
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
