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
 * Why not centralise gradient handling earlier? Because two encodings
 * coexist in real .fig files:
 *
 *   1. **API form** — `gradientHandlePositions` (start, end, width)
 *      and `gradientStops`. Builder-emitted documents use this.
 *   2. **Kiwi form** — `transform` matrix mapping gradient space
 *      `(s, t)` → object normalised space, with `(1, 0)` = start and
 *      `(0, 0)` = end (per the type docs in
 *      `@higma-document-models/fig/types`). Real exports use this.
 *
 * The angle math diverges between the two and a single hardcoded
 * `180deg` (which the previous emitter shipped) gets it wrong for
 * every non-vertical gradient. This module derives the angle from
 * whichever encoding the paint actually carries.
 */
import type {
  FigColor,
  FigGradientPaint,
  FigGradientStop,
  FigImagePaint,
  FigNode,
  FigPaint,
  FigSolidPaint,
} from "@higma-document-models/fig/types";
import type { TokenIndex } from "../tokens";

export type ImageResolver = (paint: FigImagePaint) => string | undefined;

/** Result of converting a paint stack. `imagesUsed` lets the orchestrator's
 *  asset writer skip unused images even when the resolver was called. */
export type PaintResult = {
  readonly css: string | undefined;
};

function colorToCss(c: FigColor): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  if (c.a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${round3(c.a)})`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function clamp01(n: number): number {
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

function sortedStops(stops: readonly FigGradientStop[]): readonly FigGradientStop[] {
  return [...stops].sort((a, b) => a.position - b.position);
}

function stopsCss(stops: readonly FigGradientStop[]): string {
  const ordered = sortedStops(stops);
  return ordered
    .map((stop) => `${colorToCss(stop.color)} ${round3(clamp01(stop.position) * 100)}%`)
    .join(", ");
}

function paintStops(paint: FigGradientPaint): readonly FigGradientStop[] | undefined {
  if (paint.gradientStops && paint.gradientStops.length > 0) {
    return paint.gradientStops;
  }
  if (paint.stops && paint.stops.length > 0) {
    return paint.stops;
  }
  return undefined;
}

/**
 * Compute a CSS gradient angle from `gradientHandlePositions` (API
 * form) or from `transform` (Kiwi form). Returns degrees with 0deg =
 * "to top" per the CSS spec (matches `linear-gradient(<angle>, ...)`
 * usage). Returns undefined when the gradient lacks usable handles.
 *
 * Math:
 *   - Figma normalised coords: x rightward, y downward.
 *   - Direction vector D = end - start in object-normalised space.
 *   - CSS angle is measured clockwise from the positive y-up axis,
 *     i.e. atan2(Dx, -Dy) in radians.
 */
function linearGradientAngle(paint: FigGradientPaint): number | undefined {
  const handles = paint.gradientHandlePositions;
  if (handles && handles.length >= 2) {
    const start = handles[0];
    const end = handles[1];
    if (start && end) {
      return atan2DegFromUp(end.x - start.x, end.y - start.y);
    }
  }
  if (paint.transform) {
    // (1, 0) is start, (0, 0) is end → end - start = (-m00, -m10).
    const m00 = paint.transform.m00 ?? 1;
    const m10 = paint.transform.m10 ?? 0;
    return atan2DegFromUp(-m00, -m10);
  }
  return undefined;
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
  if (!stops) {
    return undefined;
  }
  const angle = linearGradientAngle(paint);
  const angleStr = angle === undefined ? "180deg" : `${angle}deg`;
  return `linear-gradient(${angleStr}, ${stopsCss(stops)})`;
}

function radialGradientCss(paint: FigGradientPaint): string | undefined {
  const stops = paintStops(paint);
  if (!stops) {
    return undefined;
  }
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
  if (!stops) {
    return undefined;
  }
  return `conic-gradient(${stopsCss(stops)})`;
}

function diamondGradientCss(paint: FigGradientPaint): string | undefined {
  const stops = paintStops(paint);
  if (!stops) {
    return undefined;
  }
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
  return `url(${JSON.stringify(url)})`;
}

function imageScaleMode(paint: FigImagePaint): string | undefined {
  return paint.scaleMode ?? paint.imageScaleMode;
}

function imageBackgroundLayer(paint: FigImagePaint, resolver: ImageResolver): {
  readonly image: string;
  readonly size?: string;
  readonly repeat?: string;
  readonly position?: string;
} | undefined {
  const image = imagePaintCss(paint, resolver);
  if (!image) {
    return undefined;
  }
  const mode = imageScaleMode(paint);
  switch (mode) {
    case "FILL":
    case "CROP":
      return { image, size: "cover", repeat: "no-repeat", position: "center" };
    case "FIT":
      return { image, size: "contain", repeat: "no-repeat", position: "center" };
    case "TILE":
      return { image, size: "auto", repeat: "repeat" };
    case "STRETCH":
      return { image, size: "100% 100%", repeat: "no-repeat" };
    default:
      return { image, size: "cover", repeat: "no-repeat", position: "center" };
  }
}

function paintOpacity(paint: FigPaint): number {
  if (typeof paint.opacity === "number") {
    return paint.opacity;
  }
  return 1;
}

function isVisible(paint: FigPaint): boolean {
  return paint.visible !== false;
}

function solidLayer(paint: FigSolidPaint, index: TokenIndex): string | undefined {
  const tokenId = index.colorIdForPaint(paint);
  if (tokenId) {
    return `var(--${tokenId})`;
  }
  const opacity = paintOpacity(paint);
  if (opacity === 1) {
    return colorToCss(paint.color);
  }
  return colorToCss({ ...paint.color, a: paint.color.a * opacity });
}

type BackgroundLayer = {
  readonly image: string;
  readonly size?: string;
  readonly repeat?: string;
  readonly position?: string;
};

function gradientLayer(paint: FigGradientPaint): BackgroundLayer | undefined {
  const css = (() => {
    switch (paint.type) {
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

function paintToLayer(paint: FigPaint, index: TokenIndex, resolver: ImageResolver): BackgroundLayer | undefined {
  if (!isVisible(paint)) {
    return undefined;
  }
  switch (paint.type) {
    case "SOLID": {
      const css = solidLayer(paint, index);
      return css ? { image: css } : undefined;
    }
    case "GRADIENT_LINEAR":
    case "GRADIENT_RADIAL":
    case "GRADIENT_ANGULAR":
    case "GRADIENT_DIAMOND":
      return gradientLayer(paint);
    case "IMAGE":
      return imageBackgroundLayer(paint, resolver);
  }
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
): Record<string, string> {
  if (!paints || paints.length === 0) {
    return {};
  }
  const visible = paints.filter(isVisible);
  if (visible.length === 0) {
    return {};
  }

  // Single SOLID — keep the simple form.
  if (visible.length === 1 && visible[0]?.type === "SOLID") {
    const css = solidLayer(visible[0], index);
    return css ? { background: css } : {};
  }

  // Pull out the bottom-most SOLID for `background-color`. Figma's
  // array order is bottom-first, so the FIRST solid we encounter is
  // the one that paints under everything else.
  const bottomSolid = pickBottomSolid(visible, index);
  const layers = collectImageGradientLayers(visible, index, resolver);

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
    if (paint.type === "SOLID") {
      return solidLayer(paint, index);
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
): readonly BackgroundLayer[] {
  const layers: BackgroundLayer[] = [];
  for (const paint of [...visible].reverse()) {
    if (paint.type === "SOLID") {
      continue;
    }
    const layer = paintToLayer(paint, index, resolver);
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
): { readonly color?: string; readonly fancy?: Record<string, string> } {
  if (!paints || paints.length === 0) {
    return {};
  }
  const visible = paints.filter(isVisible);
  if (visible.length === 0) {
    return {};
  }
  if (visible.length === 1 && visible[0]?.type === "SOLID") {
    const css = solidLayer(visible[0], index);
    return css ? { color: css } : {};
  }
  const fancy = paintsToBackgroundStyle(paints, index, resolver);
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
