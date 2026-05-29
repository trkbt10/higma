/**
 * @file Paint → CSS background pipeline.
 *
 * Figma's paint model (`FigPaint[]`) covers solid colours, four
 * gradient kinds, and image fills. Each is reachable from any
 * paintable node — TEXT included — and any node may stack multiple
 * paints, with the *first* entry painted **bottom**-most. CSS
 * `background:` reverses that order — the first declared layer is on
 * top. We honour Figma's authoring by reversing the array on output.
 *
 * Image paints are special: they reference a binary asset by hash and
 * need a URL to resolve to. The orchestrator passes an
 * `ImageResolver` here that returns a stable file path
 * (`./assets/<hash>.<ext>`) and writes the bytes to disk on the side.
 *
 * Gradient angle and stop interpretation is delegated to the renderer
 * paint SoT so CSS emission does not re-derive Kiwi transform semantics.
 */
import type {
  FigGradientPaint,
  FigGradientStop,
  FigImagePaint,
  FigNode,
  FigPaint,
} from "@higma-document-models/fig/types";
import { asGradientPaint, asImagePaint, asSolidPaint, getPaintType } from "@higma-document-models/fig/color";
import { canonicaliseImageScaleMode, type ScaleMode } from "@higma-document-models/fig/constants";
import { getGradientDirection, getGradientStops, getImageTransform, getScaleMode } from "@higma-document-renderers/fig/paint";
import type { TokenIndex } from "../../tokens";
import { figColorToCss } from "../../lib/css-format/color";
import { clamp01, formatPx, round3 } from "../../lib/css-format/numeric";
import { solidPaintToCss } from "../../lib/css-format/paint";

export type ImageResolver = (paint: FigImagePaint) => string | undefined;

/**
 * Pixel dimensions of the node whose paint stack is being emitted.
 *
 * The CROP-from-paint-transform path needs to convert the paint's
 * normalised (object-bounding-box) transform into `background-size` /
 * `background-position` in CSS pixels. Callers without a usable size
 * pass `undefined`; the emitter falls back to the scale-mode-only
 * shorthand and the cropped sub-rectangle is silently lost (matches the
 * legacy behaviour). Threading a real size through eliminates that
 * silent loss for the common axis-aligned crop.
 */
export type NodeSize = { readonly width: number; readonly height: number };

/** Result of converting a paint stack. `imagesUsed` lets the orchestrator's
 *  asset writer skip unused images even when the resolver was called. */
export type PaintResult = {
  readonly css: string | undefined;
};

function sortedStops(stops: readonly FigGradientStop[]): readonly FigGradientStop[] {
  return [...stops].sort((a, b) => a.position - b.position);
}

function stopsCss(stops: readonly FigGradientStop[]): string {
  const ordered = sortedStops(stops);
  return ordered
    .map((stop) => `${figColorToCss(stop.color)} ${round3(clamp01(stop.position) * 100)}%`)
    .join(", ");
}

function paintStops(paint: FigGradientPaint): readonly FigGradientStop[] {
  return getGradientStops(paint);
}

/**
 * Compute a CSS gradient angle from the Kiwi paint transform. Returns
 * degrees with 0deg = "to top" per the CSS spec.
 *
 * Math:
 *   - Figma normalised coords: x rightward, y downward.
 *   - Direction vector D = end - start in object-normalised space.
 *   - CSS angle is measured clockwise from the positive y-up axis,
 *     i.e. atan2(Dx, -Dy) in radians.
 */
function linearGradientAngle(paint: FigGradientPaint): number {
  const { start, end } = getGradientDirection(paint);
  return atan2DegFromUp(end.x - start.x, end.y - start.y);
}

function atan2DegFromUp(dx: number, dy: number): number {
  const rad = Math.atan2(dx, -dy);
  const deg = (rad * 180) / Math.PI;
  // Normalise to [0, 360).
  const wrapped = ((deg % 360) + 360) % 360;
  return Math.round(wrapped * 100) / 100;
}

function linearGradientCss(paint: FigGradientPaint): string | undefined {
  const stops = paintStops(paint);
  const angle = linearGradientAngle(paint);
  return `linear-gradient(${angle}deg, ${stopsCss(stops)})`;
}

function radialGradientCss(paint: FigGradientPaint): string | undefined {
  const stops = paintStops(paint);
  // Figma radial gradients use the second handle as the radius point.
  // Without solving the ellipse mapping we fall back to `closest-side`,
  // which matches Figma's default circular gradient at the box's
  // shorter axis. Authors that need a stretched radial can still
  // specify it via Figma's gradient handles — that case will look
  // mildly off and is tracked separately.
  return `radial-gradient(closest-side, ${stopsCss(stops)})`;
}

function angularGradientCss(paint: FigGradientPaint): string | undefined {
  const stops = paintStops(paint);
  return `conic-gradient(${stopsCss(stops)})`;
}

function diamondGradientCss(paint: FigGradientPaint): string | undefined {
  const stops = paintStops(paint);
  // CSS has no native diamond gradient. We approximate via a layered
  // conic-gradient — close enough for most authoring intent and
  // strictly better than rendering nothing.
  return `conic-gradient(from 45deg, ${stopsCss(stops)})`;
}

function imagePaintCss(paint: FigImagePaint, resolver: ImageResolver): string | undefined {
  const url = resolver(paint);
  if (!url) {
    return undefined;
  }
  return `url('${url.replace(/'/g, "\\'")}')`;
}

function imageScaleMode(paint: FigImagePaint): ScaleMode {
  return canonicaliseImageScaleMode(getScaleMode(paint));
}

function imageBackgroundLayer(
  paint: FigImagePaint,
  resolver: ImageResolver,
  nodeSize: NodeSize | undefined,
): {
  readonly image: string;
  readonly size?: string;
  readonly repeat?: string;
  readonly position?: string;
} | undefined {
  // CSS background cannot rotate or skew an image — only translate and
  // independently scale on the two axes. When the paint's transform
  // carries rotation or skew, the JSX emitter routes the paint through
  // `imageElementForNode` to a structural `<div><img/></div>` instead.
  // Returning `undefined` here keeps the background layer stack from
  // double-painting the same paint via a degraded shorthand.
  if (paintRequiresStructuralEmission(paint)) {
    return undefined;
  }
  const image = imagePaintCss(paint, resolver);
  if (!image) {
    return undefined;
  }
  const mode = imageScaleMode(paint);
  // Figma's binary `imageScaleMode` enum only declares STRETCH / FIT /
  // FILL / TILE — there is no `CROP` value. The editor's Crop tool
  // serialises as STRETCH plus a non-identity `paint.transform` that
  // positions the image inside the fill rect. The renderer SoT
  // (`@higma-document-renderers/fig/scene-graph/convert/fill.ts:
  // resolveImageScaleMode`) honours that contract; mirror it here so
  // the React side does not silently treat the paint as a full stretch.
  const cropLayer = imageCropLayer(paint, image, mode, nodeSize);
  if (cropLayer !== undefined) {
    return cropLayer;
  }
  switch (mode) {
    case "FILL":
      return { image, size: "cover", repeat: "no-repeat", position: "center" };
    case "FIT":
      return { image, size: "contain", repeat: "no-repeat", position: "center" };
    case "TILE":
      return { image, size: "auto", repeat: "repeat" };
    case "STRETCH":
      return { image, size: "100% 100%", repeat: "no-repeat" };
  }
}

/**
 * Translate a STRETCH paint whose `paint.transform` encodes a Figma
 * Crop into pixel-precise `background-size` and `background-position`.
 *
 * SoT: `@higma-document-renderers/fig/scene-graph/render/image-pattern-finalize.ts`
 * builds the SVG pattern's `<use>` transform as
 * `inv(paint.transform) × diag(1/imgW, 1/imgH)`. That means
 * `paint.transform` maps *unit fill coordinates* `(x, y) ∈ [0,1]` of
 * the node back to *unit image coordinates* `(u, v) ∈ [0,1]` of the
 * source: for an axis-aligned matrix (`m01 = m10 = 0`),
 *
 *   u = m00 · x + m02
 *   v = m11 · y + m12
 *
 * CSS `background-image` instead asks for the image's displayed
 * rectangle inside the element: sampling a div pixel `x` reads image
 * pixel `(x − Px) / Sw · imgW`. Equating the two yields the inverse
 * mapping
 *
 *   Sw = W / m00,             Sh = H / m11,
 *   Px = − m02 · W / m00,     Py = − m12 · H / m11.
 *
 * Returns `undefined` when the paint is not a Crop-on-STRETCH at all
 * (mode mismatch, identity transform, or no transform). Rotation /
 * skew are intercepted upstream in `imageBackgroundLayer` and never
 * reach this function — a sanity throw catches a stale caller.
 */
function imageCropLayer(
  paint: FigImagePaint,
  image: string,
  mode: ScaleMode,
  nodeSize: NodeSize | undefined,
): { readonly image: string; readonly size: string; readonly repeat: string; readonly position: string } | undefined {
  if (mode !== "STRETCH") {
    return undefined;
  }
  const transform = getImageTransform(paint);
  if (transform === undefined) {
    return undefined;
  }
  const m00 = transform.m00 ?? 1;
  const m01 = transform.m01 ?? 0;
  const m02 = transform.m02 ?? 0;
  const m10 = transform.m10 ?? 0;
  const m11 = transform.m11 ?? 1;
  const m12 = transform.m12 ?? 0;
  if (m00 === 1 && m01 === 0 && m02 === 0 && m10 === 0 && m11 === 1 && m12 === 0) {
    return undefined;
  }
  if (m01 !== 0 || m10 !== 0) {
    throw new Error(
      `imageCropLayer reached for a paint with rotation/skew (m01=${m01}, m10=${m10}); ` +
        "the JSX emitter must route such paints through imageElementForNode instead.",
    );
  }
  // Crop requires the node's pixel dimensions to convert the unit-space
  // matrix into `background-size` / `background-position`. A sizeless
  // node with an image-cropped paint is a contradiction in the source
  // file rather than something to paper over; throw so the missing
  // dimension surfaces at emit time.
  if (nodeSize === undefined || nodeSize.width <= 0 || nodeSize.height <= 0) {
    throw new Error(
      "imageCropLayer requires a positive node size to translate Figma Crop's normalised paint transform into CSS pixels",
    );
  }
  if (m00 === 0 || m11 === 0) {
    throw new Error(
      `imageCropLayer requires an invertible axis-aligned transform; got m00=${m00}, m11=${m11}`,
    );
  }
  const sizeWidth = nodeSize.width / m00;
  const sizeHeight = nodeSize.height / m11;
  const positionX = -m02 * nodeSize.width / m00;
  const positionY = -m12 * nodeSize.height / m11;
  return {
    image,
    size: `${formatPx(sizeWidth)} ${formatPx(sizeHeight)}`,
    repeat: "no-repeat",
    position: `${formatPx(positionX)} ${formatPx(positionY)}`,
  };
}

/**
 * True when the image paint's `transform` carries rotation or skew that
 * CSS `background-image` cannot express. The JSX emitter routes such
 * paints through `imageElementForNode` to a structural `<div><img/></div>`
 * instead of polluting the background layer stack with a degraded
 * shorthand.
 */
function paintRequiresStructuralEmission(paint: FigImagePaint): boolean {
  const transform = getImageTransform(paint);
  if (transform === undefined) {
    return false;
  }
  const m01 = transform.m01 ?? 0;
  const m10 = transform.m10 ?? 0;
  return m01 !== 0 || m10 !== 0;
}

/**
 * Structural emission for a node's image paint when CSS `background-*`
 * cannot represent its `paint.transform` (rotation / skew). The caller
 * (the JSX emitter) wraps the node in a `<div style={overflow:hidden,
 * position:relative}>` and inserts the returned `<img/>` as the first
 * child so subsequent Figma children paint over the image.
 *
 * Math: the `<img>` is sized to the container's `W × H` and positioned
 * absolutely at `(0, 0)`. CSS `transform: matrix(M_a, M_b, M_c, M_d,
 * M_tx, M_ty)` then maps the img's local rectangle into the container.
 * `paint.transform` `T` maps unit fill coordinates back to unit image
 * coordinates (cf. `inv(paint.transform)` baked into the SVG renderer's
 * pattern `<use>`); when the `<img>` is rendered at the container's
 * pixel dimensions, the parent→local mapping `N` is
 *
 *   N = diag(W, H) · T · diag(1/W, 1/H)
 *
 * and the CSS transform we need is `M = inv(N)`. Working that out
 * yields
 *
 *   M_a = m11/det,                       M_b = -m10·H/(W·det),
 *   M_c = -m01·W/(H·det),                M_d = m00/det,
 *   M_tx = W · (-m11·m02 + m01·m12)/det, M_ty = H · (m10·m02 - m00·m12)/det
 *
 * with `det = m00·m11 - m01·m10`. The formula handles axis-aligned and
 * rotated/skewed matrices uniformly; the JSX emitter dispatches the
 * axis-aligned case through `background-image` for compactness.
 *
 * Notably this does NOT depend on the source image's natural pixel
 * dimensions — sizing the `<img>` to `W × H` makes the matrix express
 * the entire mapping. This sidesteps Figma's undocumented
 * `originalImageWidth/Height` paint fields.
 */
export type ImageElementEmission = {
  readonly src: string;
  readonly imgStyle: Record<string, string>;
  readonly altText: string;
};

export function imageElementForNode(
  paints: readonly FigPaint[] | undefined,
  resolver: ImageResolver,
  nodeSize: NodeSize | undefined,
): ImageElementEmission | undefined {
  if (!paints || paints.length === 0) {
    return undefined;
  }
  if (nodeSize === undefined || nodeSize.width <= 0 || nodeSize.height <= 0) {
    return undefined;
  }
  for (const paint of paints) {
    if (!isVisible(paint)) {
      continue;
    }
    const image = asImagePaint(paint);
    if (image === undefined) {
      continue;
    }
    if (!paintRequiresStructuralEmission(image)) {
      continue;
    }
    return buildImageElementEmission(image, resolver, nodeSize);
  }
  return undefined;
}

function buildImageElementEmission(
  image: FigImagePaint,
  resolver: ImageResolver,
  nodeSize: NodeSize,
): ImageElementEmission {
  const src = resolver(image);
  if (!src) {
    throw new Error(
      `imageElementForNode: ImageResolver returned no URL for an image paint requiring structural emission`,
    );
  }
  const transform = getImageTransform(image);
  if (transform === undefined) {
    throw new Error("imageElementForNode: structural emission requested for a paint without a transform");
  }
  const m00 = transform.m00 ?? 1;
  const m01 = transform.m01 ?? 0;
  const m02 = transform.m02 ?? 0;
  const m10 = transform.m10 ?? 0;
  const m11 = transform.m11 ?? 1;
  const m12 = transform.m12 ?? 0;
  const det = m00 * m11 - m01 * m10;
  if (Math.abs(det) < 1e-12) {
    throw new Error(
      `imageElementForNode: paint.transform is not invertible (det≈0): m00=${m00}, m01=${m01}, m10=${m10}, m11=${m11}`,
    );
  }
  const w = nodeSize.width;
  const h = nodeSize.height;
  // M = inv(diag(W, H) · T · diag(1/W, 1/H)). See the docstring above
  // for the derivation; this is also the same matrix the SVG pattern
  // `<use>` carries, just expressed in container-pixel coordinates so
  // it can ride on CSS `transform`.
  const a  =  m11 / det;
  const b  = -m10 * h / (w * det);
  const c  = -m01 * w / (h * det);
  const d  =  m00 / det;
  const tx = w * (-m11 * m02 + m01 * m12) / det;
  const ty = h * ( m10 * m02 - m00 * m12) / det;
  return {
    src,
    // No `altText` accessor on the typed `FigImagePaint`; alt is left
    // empty rather than reaching for an undocumented runtime field.
    altText: "",
    imgStyle: {
      position: "absolute",
      left: "0px",
      top: "0px",
      width: `${formatPx(w)}`,
      height: `${formatPx(h)}`,
      transform: `matrix(${a}, ${b}, ${c}, ${d}, ${tx}, ${ty})`,
      transformOrigin: "0 0",
    },
  };
}

function isVisible(paint: FigPaint): boolean {
  return paint.visible !== false;
}

type BackgroundLayer = {
  readonly image: string;
  readonly size?: string;
  readonly repeat?: string;
  readonly position?: string;
};

function gradientLayer(paint: FigGradientPaint): BackgroundLayer | undefined {
  const css = (() => {
    switch (getPaintType(paint)) {
      case "GRADIENT_LINEAR":
        return linearGradientCss(paint);
      case "GRADIENT_RADIAL":
        return radialGradientCss(paint);
      case "GRADIENT_ANGULAR":
        return angularGradientCss(paint);
      case "GRADIENT_DIAMOND":
        return diamondGradientCss(paint);
    }
  })();
  if (!css) {
    return undefined;
  }
  return { image: css };
}

function paintToLayer(
  paint: FigPaint,
  index: TokenIndex,
  resolver: ImageResolver,
  nodeSize: NodeSize | undefined,
): BackgroundLayer | undefined {
  if (!isVisible(paint)) {
    return undefined;
  }
  const solid = asSolidPaint(paint);
  if (solid !== undefined) {
    const css = solidPaintToCss(solid, index);
    return css ? { image: css } : undefined;
  }
  const gradient = asGradientPaint(paint);
  if (gradient !== undefined) {
    return gradientLayer(gradient);
  }
  const image = asImagePaint(paint);
  if (image !== undefined) {
    return imageBackgroundLayer(image, resolver, nodeSize);
  }
  throw new Error(`paintToLayer: unsupported paint type "${getPaintType(paint)}"`);
}

/**
 * Convert a paint stack to CSS background properties, layered with
 * Figma's painting order: the FIRST entry is the bottom-most layer.
 *
 * Composition rules:
 *
 *   - Single SOLID → `background: <colour>` (most readable form).
 *   - Image / gradient layers → `backgroundImage` (+ size/repeat/
 *     position) with Figma's bottom-first order reversed into CSS's
 *     top-first order.
 *   - SOLID layers in a multi-paint stack → only the *bottom-most*
 *     solid is honoured, emitted as `backgroundColor`. Any solids
 *     stacked above an opaque image are visually invisible anyway,
 *     and CSS `background-color` accepts only one value. SOLIDs
 *     above transparent images are an edge case worth documenting
 *     but not solving with a CSS hack here.
 *
 * The caller decides which CSS property to attach this to —
 * `background` for plain elements, `color` (via SOLID extraction)
 * for text, etc.
 */
export function paintsToBackgroundStyle(
  paints: readonly FigPaint[] | undefined,
  index: TokenIndex,
  resolver: ImageResolver,
  nodeSize: NodeSize | undefined = undefined,
): Record<string, string> {
  if (!paints || paints.length === 0) {
    return {};
  }
  const visible = paints.filter(isVisible);
  if (visible.length === 0) {
    return {};
  }

  // Single SOLID — keep the simple form.
  const singleSolid = visible.length === 1 ? asSolidPaint(visible[0]!) : undefined;
  if (singleSolid !== undefined) {
    const css = solidPaintToCss(singleSolid, index);
    return css ? { background: css } : {};
  }

  // Pull out the bottom-most SOLID for `background-color`. Figma's
  // array order is bottom-first, so the FIRST solid we encounter is
  // the one that paints under everything else.
  const bottomSolid = pickBottomSolid(visible, index);
  const layers = collectImageGradientLayers(visible, index, resolver, nodeSize);

  const out: Record<string, string> = {};
  if (bottomSolid !== undefined) {
    out.backgroundColor = bottomSolid;
  }
  if (layers.length > 0) {
    out.backgroundImage = layers.map((l) => l.image).join(", ");
    if (layers.some((l) => l.size !== undefined)) {
      out.backgroundSize = layers.map((l) => l.size ?? "auto").join(", ");
    }
    if (layers.some((l) => l.repeat !== undefined)) {
      out.backgroundRepeat = layers.map((l) => l.repeat ?? "repeat").join(", ");
    }
    if (layers.some((l) => l.position !== undefined)) {
      out.backgroundPosition = layers.map((l) => l.position ?? "0% 0%").join(", ");
    }
  }
  return out;
}

function pickBottomSolid(visible: readonly FigPaint[], index: TokenIndex): string | undefined {
  for (const paint of visible) {
    const solid = asSolidPaint(paint);
    if (solid !== undefined) {
      return solidPaintToCss(solid, index);
    }
  }
  return undefined;
}

/**
 * Collect non-SOLID paint layers (images and gradients) and reverse
 * Figma's bottom-first order to CSS's top-first order. Each layer
 * carries its own size / repeat / position because CSS shorthand
 * needs them positionally aligned with `background-image`.
 */
function collectImageGradientLayers(
  visible: readonly FigPaint[],
  index: TokenIndex,
  resolver: ImageResolver,
  nodeSize: NodeSize | undefined,
): readonly BackgroundLayer[] {
  const layers: BackgroundLayer[] = [];
  for (const paint of [...visible].reverse()) {
    if (asSolidPaint(paint) !== undefined) {
      continue;
    }
    const layer = paintToLayer(paint, index, resolver, nodeSize);
    if (layer) {
      layers.push(layer);
    }
  }
  return layers;
}

/**
 * Resolve a paint stack to a single CSS colour value suitable for
 * `color:` on text. Figma can paint text with gradients and images;
 * we render those with `background-clip: text` and a transparent
 * `color`, returning a special marker so the caller can install the
 * extra rules.
 */
export function paintsForText(
  paints: readonly FigPaint[] | undefined,
  index: TokenIndex,
  resolver: ImageResolver,
  nodeSize: NodeSize | undefined = undefined,
): { readonly color?: string; readonly fancy?: Record<string, string> } {
  if (!paints || paints.length === 0) {
    return {};
  }
  const visible = paints.filter(isVisible);
  if (visible.length === 0) {
    return {};
  }
  const singleSolid = visible.length === 1 ? asSolidPaint(visible[0]!) : undefined;
  if (singleSolid !== undefined) {
    const css = solidPaintToCss(singleSolid, index);
    return css ? { color: css } : {};
  }
  const fancy = paintsToBackgroundStyle(paints, index, resolver, nodeSize);
  if (Object.keys(fancy).length === 0) {
    return {};
  }
  return {
    fancy: {
      ...fancy,
      backgroundClip: "text",
      WebkitBackgroundClip: "text",
      color: "transparent",
    },
  };
}

/**
 * Convenience for ad-hoc node-shaped lookups.
 *
 * Some emitters need either `node.fillPaints` or `node.backgroundPaints`
 * (frame backgrounds use the latter on real Figma exports). The
 * caller picks the right field per node-type before calling here.
 */
export function preferredPaintsOf(node: FigNode): readonly FigPaint[] | undefined {
  if (node.fillPaints && node.fillPaints.length > 0) {
    return node.fillPaints;
  }
  return node.backgroundPaints;
}
