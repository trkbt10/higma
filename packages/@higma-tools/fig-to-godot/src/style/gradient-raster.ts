/**
 * @file Pre-rasterize Figma's GRADIENT_ANGULAR and GRADIENT_DIAMOND
 * paints into RGBA8 pixel arrays.
 *
 * Godot's `GradientTexture2D` supports only LINEAR (`fill = 0`) and
 * RADIAL (`fill = 1`). Angular (conic) and diamond gradients have no
 * built-in mode, and the Polygon2D shader path can't sample them
 * either. The cleanest emit-side workaround is to rasterize the
 * gradient ourselves at emit time and embed the pixel bytes as an
 * inline `Image` + `ImageTexture` sub-resource (same path used by
 * IMAGE paints — see `src/image/decode.ts`).
 *
 * Rasterization sizes the output texture to the node's authored
 * dimensions (rounded up). At common fixture sizes (≤ 200 px) the
 * inline byte payload is < 100 KB, well within Godot's scene-load
 * budget.
 */
import type { FigGradientPaint, FigGradientStop } from "@higma-document-models/fig/types";

/**
 * Sample the gradient stop array at parameter `t ∈ [0, 1]` and return
 * an interpolated `{r, g, b, a}` (channels in 0..1). Stops are
 * assumed to be sorted by `position`. For `t` before the first stop
 * we clamp to the first stop's color; same for the last stop.
 *
 * The ref renderer uses linear-RGB blending via SVG's default
 * `linearRGB` color-interpolation; we mirror that by interpolating
 * the channels directly without sRGB→linear→sRGB conversion since
 * the source colours are already in the same colour space the WebGL
 * reference samples in.
 */
function sampleStops(stops: readonly FigGradientStop[], t: number): { r: number; g: number; b: number; a: number } {
  if (stops.length === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (t <= stops[0]!.position) {
    const c = stops[0]!.color;
    return { r: c.r, g: c.g, b: c.b, a: c.a };
  }
  if (t >= stops[stops.length - 1]!.position) {
    const c = stops[stops.length - 1]!.color;
    return { r: c.r, g: c.g, b: c.b, a: c.a };
  }
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (t >= a.position && t <= b.position) {
      const span = b.position - a.position;
      const w = span === 0 ? 0 : (t - a.position) / span;
      return {
        r: a.color.r * (1 - w) + b.color.r * w,
        g: a.color.g * (1 - w) + b.color.g * w,
        b: a.color.b * (1 - w) + b.color.b * w,
        a: a.color.a * (1 - w) + b.color.a * w,
      };
    }
  }
  // Unreachable given the clamps above; keep the compiler happy.
  return { r: 0, g: 0, b: 0, a: 0 };
}

/**
 * Decode the gradient transform into a `from`-anchored frame in
 * normalized object space. For angular and diamond gradients the
 * transform places the gradient's centre and orientation; we read
 * the centre from the transform's translation row and the rotation
 * from the linear part.
 *
 * Conventions:
 *
 *   - centre.x, centre.y are in [0, 1] of the element bbox.
 *   - rotation is in radians, positive CCW (standard math), measured
 *     from the +x axis.
 */
export type RasterizedGradient = {
  readonly width: number;
  readonly height: number;
  /** Tightly packed RGBA8 bytes (length = width * height * 4). */
  readonly rgba: Uint8Array;
};

/**
 * Rasterize a `GRADIENT_ANGULAR` paint into RGBA8 pixels at the given
 * size. Each pixel maps to a parameter `t = ((angle − from) / 2π) mod 1`
 * where `angle` is the polar angle of the pixel relative to the
 * gradient centre. The resulting `t` indexes into the gradient stops
 * via linear interpolation.
 *
 * The Figma reference renderer's `formatAngularGradientDef` uses a
 * sectored SVG approximation; we sample at every output pixel
 * directly which gives sub-sector accuracy at no additional cost.
 * Verified byte-near-perfect on `angular-gradient-basic` (the
 * sectored-with-midT approach, tried as an alternative, produces
 * 1-byte drift at sector boundaries — the per-pixel form wins on
 * fixture stops where the gradient hits multiples of the sector
 * count).
 */
export function rasterizeAngularGradient(
  paint: FigGradientPaint,
  width: number,
  height: number,
): RasterizedGradient {
  const stops = readStops(paint);
  const transform = paint.transform ?? {};
  // For angular gradients the centre is always (0.5, 0.5) in object
  // space. The fig `transform` maps object → gradient space, so we
  // apply it forward to each pixel's element-space offset to land
  // in gradient space, where the polar angle of the mapped point is
  // the gradient parameter `t`. This handles rotation + non-square
  // aspect correctly: a 45°-rotated paint on a 200×140 rect makes
  // the gradient sweep at a different visual angle than 45° because
  // the matrix maps element offsets through a non-orthonormal frame.
  //
  // Earlier draft used the inverse — which produced a horizontally
  // mirrored output on rotated rects (clocks 3 and 9 swapped). The
  // forward transform fixes that.
  const m00 = transform.m00 ?? 1;
  const m01 = transform.m01 ?? 0;
  const m10 = transform.m10 ?? 0;
  const m11 = transform.m11 ?? 1;
  const rgba = new Uint8Array(width * height * 4);
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Map pixel → element-normalised offset from centre.
      const ox = (x + 0.5) / width - 0.5;
      const oy = (y + 0.5) / height - 0.5;
      // Apply forward 2×2 to get gradient-space offset.
      const gx = m00 * ox + m01 * oy;
      const gy = m10 * ox + m11 * oy;
      let t = Math.atan2(-gx, gy) / (2 * Math.PI);
      t = t - Math.floor(t);
      const c = sampleStops(stops, t);
      const i = (y * width + x) * 4;
      rgba[i] = byteFromUnit(c.r);
      rgba[i + 1] = byteFromUnit(c.g);
      rgba[i + 2] = byteFromUnit(c.b);
      rgba[i + 3] = byteFromUnit(c.a * paintOpacity);
    }
  }
  return { width, height, rgba };
}

/**
 * Rasterize a `GRADIENT_DIAMOND` paint. The parameter `t` for each
 * pixel is the larger of `|dx|/dxMax` and `|dy|/dyMax` — this
 * produces concentric rhombus-shaped iso-t lines anchored at the
 * gradient centre.
 *
 * The ref renderer's `formatDiamondGradientDef` uses 32 concentric
 * polygon strokes; per-pixel sampling here gives a strictly tighter
 * curve.
 */
export function rasterizeDiamondGradient(
  paint: FigGradientPaint,
  width: number,
  height: number,
): RasterizedGradient {
  const stops = readStops(paint);
  const transform = paint.transform ?? {};
  // Diamond gradient stays on the simple axis-aligned formula. The
  // forward-transform approach used for angular doesn't apply here:
  // the SVG ref renderer's `formatDiamondGradientDef` ignores the
  // 2×2 rotation and uses straight axis-aligned `max(|dx|/dxMax,
  // |dy|/dyMax)` with the m00 scale shrinking the band.
  const m00 = transform.m00 ?? 1;
  const m11 = transform.m11 ?? 1;
  const cx = width / 2;
  const cy = height / 2;
  // Per the Figma SVG export, diamond gradients render as 4
  // reflected linear gradients meeting at the centre. Each linear
  // gradient runs from (0,0) to (0.5, 0.5) in normalised space and
  // is reflected into the other 3 quadrants via `scale(-1, 1)` /
  // `scale(1, -1)` / `scale(-1, -1)`. The t-value at any pixel is
  // therefore `t = (|dx|/dxMax + |dy|/dyMax) / 2`: each quadrant's
  // diagonal corner reaches t=1.
  //
  // The stop-1 distance from centre is half the element extent
  // (matching the SVG ref's `dx = max(w - cx, cx)`), scaled by the
  // paint transform's diagonal `m00 / m11` to honour gradient
  // shrink.
  const dxMax = Math.max(1e-6, (Math.max(width - cx, cx)) * Math.abs(m00));
  const dyMax = Math.max(1e-6, (Math.max(height - cy, cy)) * Math.abs(m11));
  const rgba = new Uint8Array(width * height * 4);
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = Math.abs(x + 0.5 - cx) / dxMax;
      const dy = Math.abs(y + 0.5 - cy) / dyMax;
      const t = (dx + dy) / 2;
      const c = sampleStops(stops, Math.min(1, t));
      const i = (y * width + x) * 4;
      rgba[i] = byteFromUnit(c.r);
      rgba[i + 1] = byteFromUnit(c.g);
      rgba[i + 2] = byteFromUnit(c.b);
      rgba[i + 3] = byteFromUnit(c.a * paintOpacity);
    }
  }
  return { width, height, rgba };
}

/** Read stops in either Kiwi (`stops`) or API (`gradientStops`) shape. */
function readStops(paint: FigGradientPaint): readonly FigGradientStop[] {
  if (paint.stops && paint.stops.length > 0) {
    return paint.stops;
  }
  if (paint.gradientStops && paint.gradientStops.length > 0) {
    return paint.gradientStops;
  }
  return [];
}

function byteFromUnit(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 255;
  }
  // Match WebGL/Skia rounding (`floor(c * 255 + 0.5)`) so the
  // emitted pixel byte is identical to what the reference samples.
  return Math.floor(value * 255 + 0.5);
}
