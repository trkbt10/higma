/**
 * @file Pre-rasterize a fig shape with `FOREGROUND_BLUR` /
 * `LAYER_BLUR` into an inline blurred RGBA8 texture.
 *
 * Godot's `gl_compatibility` renderer's `CanvasGroup` + custom
 * `ShaderMaterial` path doesn't surface the off-screen buffer as
 * `TEXTURE` reliably in headless mode (verified empirically: an
 * identity shader on the CanvasGroup produced blank output). The
 * cleanest workaround at emit time is to rasterise the shape in
 * TypeScript, apply a 2D Gaussian, and emit the result as an
 * inline `Image` + `ImageTexture` sub-resource (the same path used
 * by IMAGE paints and angular/diamond gradients).
 *
 * The output texture is **larger** than the source shape — Gaussian
 * blur extends visible pixels past the silhouette by roughly
 * 3 × sigma. We pad by `ceil(radius * 3)` on every side so the
 * blur falloff isn't clipped at the texture bounds.
 *
 * Currently handles RECTANGLE / ROUNDED_RECTANGLE / ELLIPSE
 * silhouettes with a SOLID fill. Other paint types and shape types
 * fall through to `undefined` (caller skips the blur path).
 */
import type { FigGradientPaint, FigGradientStop, FigNode, FigPaint, FigSolidPaint } from "@higma-document-models/fig/types";

export type BlurRasterResult = {
  readonly width: number;
  readonly height: number;
  /** Tightly packed RGBA8 bytes (width * height * 4). */
  readonly rgba: Uint8Array;
  /**
   * Offset in node-local space where this texture should be
   * positioned. Equal to `-padding` (negative because the texture
   * extends ABOVE and LEFT of the original shape bounds).
   */
  readonly offsetX: number;
  readonly offsetY: number;
};

/**
 * Rasterize a shape's filled silhouette plus its Gaussian blur into
 * a single RGBA8 texture, padded by `3*radius` on every side.
 *
 * Returns `undefined` when the shape isn't a simple SOLID-filled
 * rect/rounded-rect/ellipse — callers fall through to the regular
 * unblurred emit. Other blur cases need shader-based work, deferred.
 */
export type ShapeEffect = {
  readonly kind: "layer-blur" | "drop-shadow" | "inner-shadow";
  /** Gaussian radius (sigma * 2 in our convention). */
  readonly radius: number;
  /** Shadow color (0..1 channels). Unused for layer-blur. */
  readonly color?: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
  /** Shadow offset in shape-local pixels. Unused for layer-blur. */
  readonly offset?: { readonly x: number; readonly y: number };
};

/**
 * Rasterize a shape's filled silhouette + optional effect chain
 * (LAYER_BLUR / DROP_SHADOW) into a single RGBA8 texture.
 *
 * For LAYER_BLUR, the whole shape (including its fill) is blurred.
 * For DROP_SHADOW, a coloured silhouette is offset, blurred, and
 * composited behind the unmodified shape fill.
 *
 * Output texture padding accommodates the maximum extent: shadow
 * offset + 3 × shadow radius (or blur radius, whichever wider).
 *
 * Returns `undefined` when the shape kind / paint kind can't be
 * rasterized in TS (callers fall through to the regular emit, which
 * won't render the soft-edge effect but at least preserves the
 * unmodified shape).
 */
export function rasterizeBlurredShape(
  node: FigNode,
  radius: number,
): BlurRasterResult | undefined {
  return rasterizeShapeWithEffects(node, [{ kind: "layer-blur", radius }]);
}

/**
 * Callback used by the rasterizer to resolve an IMAGE paint's decoded
 * RGBA8 bytes. Caller (walk.ts) holds the document-level image map +
 * PNG decoder; the rasterizer just asks for bytes when it encounters
 * an IMAGE paint in the fill stack. Returns undefined when the image
 * isn't resolvable — the caller's stack-builder will treat that as an
 * unsupported paint and fall back to the Polygon2D emit path.
 */
export type ImageResolver = (paint: FigPaint) => { readonly width: number; readonly height: number; readonly rgba: Uint8Array } | undefined;

export function rasterizeShapeWithEffects(
  node: FigNode,
  effects: readonly ShapeEffect[],
  imageResolver?: ImageResolver,
): BlurRasterResult | undefined {
  const size = node.size;
  if (!size || size.x <= 0 || size.y <= 0) {
    return undefined;
  }
  // Build per-paint samplers for every visible fill in the stack.
  // The single-paint path was a v0 limitation; multi-paint fixtures
  // (paint-advanced/multi-fill-gradient et al.) need the full stack
  // composited in fig-order (first paint = bottom, last = top).
  const samplers = buildPaintSamplerStack(node.fillPaints, Math.round(size.x), Math.round(size.y), imageResolver);
  if (samplers.length === 0) {
    return undefined;
  }
  const w0 = Math.round(size.x);
  const h0 = Math.round(size.y);
  const silhouetteInset = 0;
  // Compute padding to fit the widest effect's blur + offset.
  let padTop = 0;
  let padRight = 0;
  let padBottom = 0;
  let padLeft = 0;
  for (const effect of effects) {
    const blurExtent = Math.ceil(effect.radius * 4);
    const ox = effect.offset?.x ?? 0;
    const oy = effect.offset?.y ?? 0;
    padLeft = Math.max(padLeft, blurExtent - Math.min(0, ox));
    padRight = Math.max(padRight, blurExtent + Math.max(0, ox));
    padTop = Math.max(padTop, blurExtent - Math.min(0, oy));
    padBottom = Math.max(padBottom, blurExtent + Math.max(0, oy));
  }
  const w = w0 + padLeft + padRight;
  const h = h0 + padTop + padBottom;
  const silhouette = rasterizeShapeSilhouette(node, w0, h0, silhouetteInset);
  if (!silhouette) {
    return undefined;
  }
  // Composite buffer lives in float32 throughout — quantising to byte
  // at each layer leaks 0–1 byte error per pixel that compounds along
  // the shape's halo and produces a systematic 1-byte diff vs the
  // WebGL reference in cases like realistic-card / solid-stroke-radius
  // -shadow. Convert to byte ONCE at the end.
  const accum = new Float32Array(w * h * 4);
  const blurEffect = effects.find((e) => e.kind === "layer-blur");
  const shadowEffects = effects.filter((e) => e.kind === "drop-shadow");
  const innerShadowEffects = effects.filter((e) => e.kind === "inner-shadow");

  // 1. Paint shadow(s) BEHIND the shape fill. Each shadow is the
  //    silhouette painted in shadow.color, offset by shadow.offset,
  //    then blurred.
  for (const shadow of shadowEffects) {
    if (!shadow.color) continue;
    const shadowBuf = new Float32Array(w * h * 4);
    const ox = (shadow.offset?.x ?? 0);
    const oy = (shadow.offset?.y ?? 0);
    const sr = shadow.color.r;
    const sg = shadow.color.g;
    const sb = shadow.color.b;
    const sa = shadow.color.a;
    for (let y = 0; y < h0; y += 1) {
      for (let x = 0; x < w0; x += 1) {
        const coverage = silhouette[y * w0 + x]! / 255;
        if (coverage === 0) continue;
        const sx = x + padLeft + ox;
        const sy = y + padTop + oy;
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
        const i = (sy * w + sx) * 4;
        shadowBuf[i] = sr;
        shadowBuf[i + 1] = sg;
        shadowBuf[i + 2] = sb;
        shadowBuf[i + 3] = sa * coverage;
      }
    }
    const shadowBlurred = gaussianBlur2DFloat(shadowBuf, w, h, shadow.radius);
    // Composite over accum (accum starts transparent).
    for (let i = 0; i < accum.length; i += 4) {
      const sA = shadowBlurred[i + 3]!;
      const dA = accum[i + 3]!;
      const outA = sA + dA * (1 - sA);
      if (outA < 1e-5) continue;
      accum[i] = (shadowBlurred[i]! * sA + accum[i]! * dA * (1 - sA)) / outA;
      accum[i + 1] = (shadowBlurred[i + 1]! * sA + accum[i + 1]! * dA * (1 - sA)) / outA;
      accum[i + 2] = (shadowBlurred[i + 2]! * sA + accum[i + 2]! * dA * (1 - sA)) / outA;
      accum[i + 3] = outA;
    }
  }

  // 2. Paint the shape fill stack (with optional blur) on top.
  // Multi-paint composite happens BEFORE the silhouette coverage is
  // applied: stack the layers in their fig order in straight-alpha
  // space, then multiply the resulting alpha by the coverage so the
  // shape edge AA stays clean.
  const shapeBuf = new Float32Array(w * h * 4);
  for (let y = 0; y < h0; y += 1) {
    for (let x = 0; x < w0; x += 1) {
      const coverage = silhouette[y * w0 + x]! / 255;
      if (coverage === 0) continue;
      // Composite the paint stack in float space. Bottom paint =
      // samplers[0]; subsequent paints alpha-blend on top.
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let ca = 0;
      for (let s = 0; s < samplers.length; s += 1) {
        const c = samplers[s]!(x, y);
        const sA = c.a;
        if (sA === 0) continue;
        const outA = sA + ca * (1 - sA);
        if (outA < 1e-7) continue;
        cr = (c.r * sA + cr * ca * (1 - sA)) / outA;
        cg = (c.g * sA + cg * ca * (1 - sA)) / outA;
        cb = (c.b * sA + cb * ca * (1 - sA)) / outA;
        ca = outA;
      }
      if (ca === 0) continue;
      const i = ((y + padTop) * w + (x + padLeft)) * 4;
      shapeBuf[i] = cr;
      shapeBuf[i + 1] = cg;
      shapeBuf[i + 2] = cb;
      shapeBuf[i + 3] = ca * coverage;
    }
  }
  const shapeOutput = blurEffect ? gaussianBlur2DFloat(shapeBuf, w, h, blurEffect.radius) : shapeBuf;
  for (let i = 0; i < accum.length; i += 4) {
    const sA = shapeOutput[i + 3]!;
    if (sA === 0) continue;
    const dA = accum[i + 3]!;
    const outA = sA + dA * (1 - sA);
    if (outA < 1e-5) continue;
    accum[i] = (shapeOutput[i]! * sA + accum[i]! * dA * (1 - sA)) / outA;
    accum[i + 1] = (shapeOutput[i + 1]! * sA + accum[i + 1]! * dA * (1 - sA)) / outA;
    accum[i + 2] = (shapeOutput[i + 2]! * sA + accum[i + 2]! * dA * (1 - sA)) / outA;
    accum[i + 3] = outA;
  }

  // 3. Render inner shadows ON TOP of the shape fill.
  //
  // WebGL recipe (per fig renderer's inner-shadow fragment shader):
  //   shadowMask(x,y) = shapeAlpha(x,y) * (1 - blurredAlpha(x+ox, y+oy))
  // where blurredAlpha is the silhouette blurred (no offset applied),
  // and the offset is applied at sample time. This concentrates the
  // shadow on the side of the shape OPPOSITE the offset — exactly
  // where a "light source" at the offset direction would cast inward.
  //
  // Compositing: shadow color is added on top of the shape fill at
  // alpha = u_color.a * shadowMask. Where shadowMask is high (near
  // edge opposite offset), the shape fill is overpainted with the
  // shadow color.
  if (innerShadowEffects.length > 0) {
    // Pre-blur the silhouette ONCE (no offset). Stored as a float
    // mask in `blurredMask` — only the alpha channel matters for
    // the inner-shadow formula.
    const silhouetteFloat = new Float32Array(w * h * 4);
    for (let y = 0; y < h0; y += 1) {
      for (let x = 0; x < w0; x += 1) {
        const sA = silhouette[y * w0 + x]! / 255;
        if (sA === 0) continue;
        const i = ((y + padTop) * w + (x + padLeft)) * 4;
        silhouetteFloat[i + 3] = sA;
      }
    }
    for (const innerShadow of innerShadowEffects) {
      if (!innerShadow.color) continue;
      const ox = innerShadow.offset?.x ?? 0;
      const oy = innerShadow.offset?.y ?? 0;
      const ir = innerShadow.color.r;
      const ig = innerShadow.color.g;
      const ib = innerShadow.color.b;
      const ia = innerShadow.color.a;
      const blurredMask = gaussianBlur2DFloat(silhouetteFloat, w, h, innerShadow.radius);
      for (let y = 0; y < h0; y += 1) {
        for (let x = 0; x < w0; x += 1) {
          const shapeAlpha = silhouette[y * w0 + x]! / 255;
          if (shapeAlpha === 0) continue;
          // Sample blurred at OPPOSITE offset position. WebGL's inner
          // shadow shader samples at `texCoord + u_offset`, but in
          // WebGL texCoord conventions (y-up) this effectively shifts
          // OPPOSITE the Figma fig.offset direction. Our buffer is
          // y-down, so we negate the offset to match: sample at
          // (x - ox, y - oy). Verified against shadow-inner: offset
          // (0, 2) → darkening appears at TOP edge (y decreasing
          // from shape's top edge), which requires sampling BELOW
          // each pixel to find "outside-of-shape" blurred values.
          const bx = x + padLeft - ox;
          const by = y + padTop - oy;
          let blurredAlpha = 0;
          if (bx >= 0 && bx < w && by >= 0 && by < h) {
            blurredAlpha = blurredMask[(by * w + bx) * 4 + 3]!;
          }
          const shadowMask = shapeAlpha * (1 - blurredAlpha);
          const sA = ia * shadowMask;
          if (sA <= 0) continue;
          const i = ((y + padTop) * w + (x + padLeft)) * 4;
          const dA = accum[i + 3]!;
          const outA = sA + dA * (1 - sA);
          if (outA < 1e-5) continue;
          accum[i] = (ir * sA + accum[i]! * dA * (1 - sA)) / outA;
          accum[i + 1] = (ig * sA + accum[i + 1]! * dA * (1 - sA)) / outA;
          accum[i + 2] = (ib * sA + accum[i + 2]! * dA * (1 - sA)) / outA;
          accum[i + 3] = outA;
        }
      }
    }
  }

  // Final byte quantisation: only here, after all compositing is done
  // in float32. This collapses the systematic 1-byte error caused by
  // intermediate re-quantisation between layers.
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < accum.length; i += 4) {
    rgba[i] = byteFromUnit(accum[i]!);
    rgba[i + 1] = byteFromUnit(accum[i + 1]!);
    rgba[i + 2] = byteFromUnit(accum[i + 2]!);
    rgba[i + 3] = byteFromUnit(accum[i + 3]!);
  }
  return { width: w, height: h, rgba, offsetX: -padLeft, offsetY: -padTop };
}

/**
 * Paint a stroke band of the given width and color onto an RGBA8
 * buffer, using the shape's analytic signed-distance function.
 *
 * `align` controls where the stroke band sits relative to the
 * geometric edge:
 *   - "INSIDE":  band is [-w, 0] from edge (inset entirely inside)
 *   - "CENTER":  band is [-w/2, +w/2] (straddles the edge)
 *   - "OUTSIDE": band is [0, +w] (outset entirely outside)
 *
 * The buffer's pixel `(x, y)` maps to shape-local coords
 * `(x - offsetX, y - offsetY)` — the `offsetX/Y` are the padded-
 * buffer offsets (negative; from `BlurRasterResult.offsetX/Y`).
 *
 * Returns silently when the shape kind isn't supported. No-op when
 * the stroke is zero-width or transparent.
 */
export function paintStrokeBand(
  rgba: Uint8Array,
  bufW: number,
  bufH: number,
  offsetX: number,
  offsetY: number,
  node: FigNode,
  strokeWidth: number,
  strokeAlign: "INSIDE" | "CENTER" | "OUTSIDE",
  color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number },
): void {
  if (strokeWidth <= 0 || color.a <= 0) return;
  const size = node.size;
  if (!size) return;
  const w0 = Math.round(size.x);
  const h0 = Math.round(size.y);
  const typeName = node.type?.name;
  // Signed distance to the shape's edge in shape-local coords.
  // Negative inside, positive outside.
  let sdf: ((px: number, py: number) => number) | undefined;
  if (typeName === "ELLIPSE") {
    const cx = w0 / 2;
    const cy = h0 / 2;
    const rx = Math.max(0.1, w0 / 2);
    const ry = Math.max(0.1, h0 / 2);
    sdf = (px: number, py: number) => {
      const nx = (px - cx) / rx;
      const ny = (py - cy) / ry;
      const r = Math.sqrt(nx * nx + ny * ny);
      // Approximate signed distance in shape-local pixels: (r - 1)
      // is in normalised radius units; scale by the local radius
      // along the gradient direction. Using the geometric mean of
      // rx and ry as the scale factor produces a reasonable
      // approximation for near-circular ellipses; for highly
      // elongated ellipses the band width varies slightly with
      // angle. Good enough for the v0 stroke fixtures.
      const scale = Math.sqrt(rx * ry);
      return (r - 1) * scale;
    };
  } else if (typeName === "RECTANGLE" || typeName === "ROUNDED_RECTANGLE") {
    const cr = readCornerRadius(node);
    const r = Math.max(0, Math.min(cr, w0 / 2, h0 / 2));
    sdf = (px: number, py: number) => {
      // Distance to nearest edge of a rounded rect.
      // Compute distance from each corner-center: if in the corner
      // region, distance is the corner arc; otherwise straight line.
      const dx = px < r ? r - px : px > w0 - r ? px - (w0 - r) : 0;
      const dy = py < r ? r - py : py > h0 - r ? py - (h0 - r) : 0;
      if (dx === 0 && dy === 0) {
        // Inside the inner rect — signed distance is negative,
        // taken as the nearest-edge distance.
        return -Math.min(px, w0 - px, py, h0 - py);
      }
      const cornerDist = Math.sqrt(dx * dx + dy * dy);
      // If we're outside the corner region's circle, positive;
      // otherwise negative (inside the rounded corner).
      return cornerDist - r;
    };
  }
  if (!sdf) return;

  // Compute band range in shape-local edge-distance.
  let bandInner: number;
  let bandOuter: number;
  if (strokeAlign === "INSIDE") {
    bandInner = -strokeWidth;
    bandOuter = 0;
  } else if (strokeAlign === "OUTSIDE") {
    bandInner = 0;
    bandOuter = strokeWidth;
  } else {
    bandInner = -strokeWidth / 2;
    bandOuter = strokeWidth / 2;
  }

  const sr = byteFromUnit(color.r);
  const sg = byteFromUnit(color.g);
  const sb = byteFromUnit(color.b);
  const sa = color.a;

  for (let y = 0; y < bufH; y += 1) {
    for (let x = 0; x < bufW; x += 1) {
      // Map padded-buffer pixel to shape-local coord.
      const px = x + offsetX + 0.5;
      const py = y + offsetY + 0.5;
      // Coverage from 2×2 supersampling against the band.
      let coverage = 0;
      for (let s = 0; s < 4; s += 1) {
        const sxOff = (s & 1) === 0 ? -0.25 : 0.25;
        const syOff = (s & 2) === 0 ? -0.25 : 0.25;
        const d = sdf(px + sxOff, py + syOff);
        if (d >= bandInner && d <= bandOuter) {
          coverage += 1;
        }
      }
      if (coverage === 0) continue;
      const cov = (coverage / 4) * sa;
      const i = (y * bufW + x) * 4;
      const dA = rgba[i + 3]! / 255;
      const outA = cov + dA * (1 - cov);
      if (outA < 1 / 255) continue;
      rgba[i] = byteFromUnit((sr / 255 * cov + rgba[i]! / 255 * dA * (1 - cov)) / outA);
      rgba[i + 1] = byteFromUnit((sg / 255 * cov + rgba[i + 1]! / 255 * dA * (1 - cov)) / outA);
      rgba[i + 2] = byteFromUnit((sb / 255 * cov + rgba[i + 2]! / 255 * dA * (1 - cov)) / outA);
      rgba[i + 3] = byteFromUnit(outA);
    }
  }
}

/**
 * Build a per-pixel colour sampler for the given paint. The sampler
 * takes (x, y) in element-local space (`[0, width) × [0, height)`)
 * and returns `{r, g, b, a}` in 0..1.
 *
 * Supports SOLID and GRADIENT_LINEAR / GRADIENT_RADIAL fills.
 * Returns `undefined` for paint kinds we don't handle here yet
 * (ANGULAR / DIAMOND would need a different sampler; IMAGE blur
 * isn't useful).
 */
/**
 * Build a sampler for every visible paint in the stack that the
 * rasterizer can handle. Returns the bottom-up list (fig order) so
 * callers can composite the stack via standard alpha-over.
 *
 * Unsupported paint kinds (IMAGE) are dropped silently — the caller
 * falls back to the regular Polygon2D path on unsupported stacks.
 */
function buildPaintSamplerStack(
  paints: readonly FigPaint[] | undefined,
  width: number,
  height: number,
  imageResolver?: ImageResolver,
): readonly ((x: number, y: number) => { r: number; g: number; b: number; a: number })[] {
  if (!paints || paints.length === 0) return [];
  const out: ((x: number, y: number) => { r: number; g: number; b: number; a: number })[] = [];
  for (const paint of paints) {
    if (paint.visible === false) continue;
    const sampler = buildPaintSampler(paint, width, height, imageResolver);
    if (!sampler) {
      // Unsupported paint in the stack — abandon the whole stack so
      // the caller can fall back to the Polygon2D emit path.
      return [];
    }
    out.push(sampler);
  }
  return out;
}

function buildPaintSampler(
  paint: FigPaint,
  width: number,
  height: number,
  imageResolver?: ImageResolver,
): ((x: number, y: number) => { r: number; g: number; b: number; a: number }) | undefined {
  const opacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  if (paint.type === "SOLID") {
    const solid = paint as FigSolidPaint;
    const r = solid.color.r;
    const g = solid.color.g;
    const b = solid.color.b;
    const a = solid.color.a * opacity;
    return () => ({ r, g, b, a });
  }
  if (paint.type === "GRADIENT_LINEAR") {
    return buildLinearSampler(paint as FigGradientPaint, width, height, opacity);
  }
  if (paint.type === "GRADIENT_RADIAL") {
    return buildRadialSampler(paint as FigGradientPaint, width, height, opacity);
  }
  if (paint.type === "GRADIENT_ANGULAR") {
    return buildAngularSampler(paint as FigGradientPaint, width, height, opacity);
  }
  if (paint.type === "GRADIENT_DIAMOND") {
    return buildDiamondSampler(paint as FigGradientPaint, width, height, opacity);
  }
  if (paint.type === "IMAGE" && imageResolver) {
    return buildImageSampler(paint, width, height, opacity, imageResolver);
  }
  return undefined;
}

/**
 * IMAGE paint sampler. The image is treated as a single STRETCH-fill
 * texture covering the node's bounds (`width × height`); each pixel
 * samples the nearest decoded RGBA8 pixel from the image data.
 *
 * Figma image paints have several scale modes (FILL, FIT, CROP, TILE)
 * but the most common — and the one all the image-fill fixtures
 * exercise — is STRETCH (FILL). Other modes fall through to the
 * existing Polygon2D emit path for now.
 *
 * Nearest-neighbour sampling matches the Polygon2D `texture_filter =
 * LINEAR` path Godot uses for the same texture; with the texture sized
 * to the same dimensions as the node, there's no actual filtering
 * (each output pixel maps 1:1 to a source pixel). This means I/O byte
 * parity hinges on the rasterizer using the same UV→pixel mapping
 * Godot does. Godot's linear filter at integer UVs reads the source
 * pixel center, which matches my (sx + 0.5)/w → integer index here.
 */
function buildImageSampler(
  paint: FigPaint,
  width: number,
  height: number,
  opacity: number,
  imageResolver: ImageResolver,
): ((x: number, y: number) => { r: number; g: number; b: number; a: number }) | undefined {
  const decoded = imageResolver(paint);
  if (!decoded) return undefined;
  const iw = decoded.width;
  const ih = decoded.height;
  const data = decoded.rgba;
  return (x, y) => {
    // STRETCH fill with bilinear filtering. The image is mapped to
    // the shape's bounds (aspect-stretched). Bilinear matches Godot's
    // Polygon2D `texture_filter = LINEAR` and the WebGL reference's
    // default sampling — image-fill fixtures use tiny (2×2) source
    // textures stretched to 120×80 shapes, so the visible color comes
    // entirely from the bilinear interpolation between the 4 source
    // pixels.
    const fx = (x + 0.5) * iw / width - 0.5;
    const fy = (y + 0.5) * ih / height - 0.5;
    const x0 = Math.max(0, Math.min(iw - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(ih - 1, Math.floor(fy)));
    const x1 = Math.max(0, Math.min(iw - 1, x0 + 1));
    const y1 = Math.max(0, Math.min(ih - 1, y0 + 1));
    const wx = Math.max(0, Math.min(1, fx - x0));
    const wy = Math.max(0, Math.min(1, fy - y0));
    const i00 = (y0 * iw + x0) * 4;
    const i10 = (y0 * iw + x1) * 4;
    const i01 = (y1 * iw + x0) * 4;
    const i11 = (y1 * iw + x1) * 4;
    const w00 = (1 - wx) * (1 - wy);
    const w10 = wx * (1 - wy);
    const w01 = (1 - wx) * wy;
    const w11 = wx * wy;
    const r = (data[i00]! * w00 + data[i10]! * w10 + data[i01]! * w01 + data[i11]! * w11) / 255;
    const g = (data[i00 + 1]! * w00 + data[i10 + 1]! * w10 + data[i01 + 1]! * w01 + data[i11 + 1]! * w11) / 255;
    const b = (data[i00 + 2]! * w00 + data[i10 + 2]! * w10 + data[i01 + 2]! * w01 + data[i11 + 2]! * w11) / 255;
    const a = (data[i00 + 3]! * w00 + data[i10 + 3]! * w10 + data[i01 + 3]! * w01 + data[i11 + 3]! * w11) / 255;
    return { r, g, b, a: a * opacity };
  };
}

/**
 * GRADIENT_ANGULAR sampler — mirror of `rasterizeAngularGradient` in
 * `gradient-raster.ts`. Maps element-normalised offset from centre
 * through the forward 2×2 transform, then `t = atan2(-gx, gy) / 2π`.
 */
function buildAngularSampler(
  paint: FigGradientPaint,
  width: number,
  height: number,
  opacity: number,
): (x: number, y: number) => { r: number; g: number; b: number; a: number } {
  const stops = readStops(paint);
  const t = paint.transform ?? {};
  const m00 = t.m00 ?? 1;
  const m01 = t.m01 ?? 0;
  const m10 = t.m10 ?? 0;
  const m11 = t.m11 ?? 1;
  return (x, y) => {
    const ox = (x + 0.5) / width - 0.5;
    const oy = (y + 0.5) / height - 0.5;
    const gx = m00 * ox + m01 * oy;
    const gy = m10 * ox + m11 * oy;
    let tt = Math.atan2(-gx, gy) / (2 * Math.PI);
    tt = tt - Math.floor(tt);
    const c = sampleStops(stops, tt);
    return { r: c.r, g: c.g, b: c.b, a: c.a * opacity };
  };
}

/**
 * GRADIENT_DIAMOND sampler — mirror of `rasterizeDiamondGradient`.
 * `t = (|dx|/dxMax + |dy|/dyMax) / 2` (4-quadrant reflected linear).
 */
function buildDiamondSampler(
  paint: FigGradientPaint,
  width: number,
  height: number,
  opacity: number,
): (x: number, y: number) => { r: number; g: number; b: number; a: number } {
  const stops = readStops(paint);
  const t = paint.transform ?? {};
  const m00 = t.m00 ?? 1;
  const m11 = t.m11 ?? 1;
  const cx = width / 2;
  const cy = height / 2;
  const dxMax = Math.max(1e-6, (Math.max(width - cx, cx)) * Math.abs(m00));
  const dyMax = Math.max(1e-6, (Math.max(height - cy, cy)) * Math.abs(m11));
  return (x, y) => {
    const dx = Math.abs(x + 0.5 - cx) / dxMax;
    const dy = Math.abs(y + 0.5 - cy) / dyMax;
    const tt = Math.min(1, (dx + dy) / 2);
    const c = sampleStops(stops, tt);
    return { r: c.r, g: c.g, b: c.b, a: c.a * opacity };
  };
}

/**
 * GRADIENT_LINEAR sampler. The fig transform maps element-space to
 * gradient-space; we apply the forward transform to each pixel's
 * element-normalised offset and take the gradient parameter `t` from
 * the gradient-space x-coordinate.
 *
 * Fig's convention (verified against linear gradient fixtures): stop
 * 0 lives at gradient-space (0, 0), stop 1 at (1, 0). The transform
 * maps element-coords → gradient-coords directly, so the parameter
 * `t = transform(p_elem).x`.
 */
function buildLinearSampler(
  paint: FigGradientPaint,
  width: number,
  height: number,
  opacity: number,
): (x: number, y: number) => { r: number; g: number; b: number; a: number } {
  const stops = readStops(paint);
  const t = paint.transform ?? {};
  const m00 = t.m00 ?? 1;
  const m01 = t.m01 ?? 0;
  const m02 = t.m02 ?? 0;
  const m10 = t.m10 ?? 0;
  const m11 = t.m11 ?? 1;
  const m12 = t.m12 ?? 0;
  return (x, y) => {
    const u = (x + 0.5) / width;
    const v = (y + 0.5) / height;
    const gx = m00 * u + m01 * v + m02;
    // gy unused for linear; the parameter lives entirely on the x-axis
    void m10;
    void m11;
    void m12;
    const c = sampleStops(stops, clamp01(gx));
    return { r: c.r, g: c.g, b: c.b, a: c.a * opacity };
  };
}

/**
 * GRADIENT_RADIAL sampler. Fig stores the radial centre at (m02, m12)
 * (the renderer's `getRadialGradientCenterAndRadius` is the SoT) and
 * the radius at m00. The parameter `t` is the normalised distance
 * from the centre, clamped to [0, 1].
 */
function buildRadialSampler(
  paint: FigGradientPaint,
  width: number,
  height: number,
  opacity: number,
): (x: number, y: number) => { r: number; g: number; b: number; a: number } {
  const stops = readStops(paint);
  const t = paint.transform ?? {};
  const cxNorm = t.m02 ?? 0.5;
  const cyNorm = t.m12 ?? 0.5;
  const rxNorm = Math.abs(t.m00 ?? 0.5);
  const ryNorm = Math.abs(t.m11 ?? 0.5);
  const cx = cxNorm * width;
  const cy = cyNorm * height;
  const rx = Math.max(1e-6, rxNorm * width);
  const ry = Math.max(1e-6, ryNorm * height);
  return (x, y) => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    const tValue = Math.min(1, Math.sqrt(dx * dx + dy * dy));
    const c = sampleStops(stops, tValue);
    return { r: c.r, g: c.g, b: c.b, a: c.a * opacity };
  };
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
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
  return { r: 0, g: 0, b: 0, a: 0 };
}

/**
 * Rasterize an unblurred shape silhouette into an alpha-only Uint8
 * coverage array (0-255 per pixel). Returns `undefined` for shape
 * kinds we don't yet rasterise here.
 *
 * `outset` (default 0) grows the silhouette outward in pixels — used
 * by the stroke band computation: the outer silhouette = silhouette
 * with outset = +width/2, inner = -width/2.
 */
function rasterizeShapeSilhouette(
  node: FigNode,
  width: number,
  height: number,
  outset: number = 0,
): Uint8Array | undefined {
  const typeName = node.type?.name;
  if (typeName === "ELLIPSE") {
    return rasterizeEllipseSilhouette(width, height, outset);
  }
  if (typeName === "RECTANGLE" || typeName === "ROUNDED_RECTANGLE") {
    const cr = readCornerRadius(node);
    return rasterizeRoundedRectSilhouette(width, height, cr, outset);
  }
  return undefined;
}

/**
 * Read a uniform corner radius from a rect node. We fall back to
 * the smallest per-corner value when independent radii are authored
 * — for blur this approximation is fine because blur softens the
 * edges anyway.
 */
function readCornerRadius(node: FigNode): number {
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    return node.cornerRadius;
  }
  return 0;
}

/**
 * Rasterise an ellipse inscribed in the (0,0)-(width,height) box
 * with sub-pixel coverage AA. Each pixel's coverage is computed by
 * super-sampling 4 sub-samples in a 2×2 grid; the average gives a
 * smooth edge without needing a full distance-field.
 */
function rasterizeEllipseSilhouette(width: number, height: number, outset: number = 0): Uint8Array {
  const buf = new Uint8Array(width * height);
  const cx = width / 2;
  const cy = height / 2;
  // outset: positive grows the ellipse outward; negative shrinks it.
  // Used by the no-effect AA-fill path to tighten the AA band to
  // match WebGL's pixel-center evaluation.
  const rx = Math.max(0.1, width / 2 + outset);
  const ry = Math.max(0.1, height / 2 + outset);
  // Hybrid sampler: 8×8 supersampling inside a ±1 px band of the edge,
  // binary classification elsewhere. The dense supersampling lifts
  // the AA band from 4-level (2×2) to 64-level intensity at oblique
  // edges where the GPU-rasterised ref shows smooth byte gradients.
  // Far-from-edge pixels short-circuit so cost stays O(rim) instead
  // of O(area).
  const SS = 8;
  const SS2 = SS * SS;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Cheap inside/outside test at pixel center.
      const ncx = (x + 0.5 - cx) / rx;
      const ncy = (y + 0.5 - cy) / ry;
      const centerDist2 = ncx * ncx + ncy * ncy;
      // The ellipse's tangent-space pixel width is ~max(1/rx, 1/ry).
      // Mark as "near edge" if centerDist2 is within (1 ± 4*pxWidth)
      // — generous margin so the supersampled rim isn't undercaught.
      const pxW = Math.max(1 / rx, 1 / ry);
      const innerBound = (1 - 4 * pxW) ** 2;
      const outerBound = (1 + 4 * pxW) ** 2;
      if (centerDist2 < innerBound) {
        buf[y * width + x] = 255;
        continue;
      }
      if (centerDist2 > outerBound) {
        buf[y * width + x] = 0;
        continue;
      }
      let inside = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = (x + (sx + 0.5) / SS - cx) / rx;
          const py = (y + (sy + 0.5) / SS - cy) / ry;
          if (px * px + py * py <= 1) {
            inside += 1;
          }
        }
      }
      buf[y * width + x] = Math.round((inside / SS2) * 255);
    }
  }
  return buf;
}

/**
 * Rasterise a rounded rectangle silhouette. The corners are
 * sampled at 4× the inner pixel density (same supersampling pattern
 * as the ellipse rasteriser) so the rounded edge has sub-pixel AA.
 */
function rasterizeRoundedRectSilhouette(width: number, height: number, cornerRadius: number, outset: number = 0): Uint8Array {
  // outset: positive grows the silhouette outward (stroke band outer
  // edge); negative shrinks it (matches WebGL's pixel-center AA which
  // is ~0.5 px tighter than the 2×2 supersampling result).
  const r = Math.min(cornerRadius, width / 2, height / 2) + outset;
  const left = -outset;
  const top = -outset;
  const right = width + outset;
  const bottom = height + outset;
  const buf = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let inside = 0;
      for (let sy = 0; sy < 2; sy += 1) {
        for (let sx = 0; sx < 2; sx += 1) {
          const px = x + (sx + 0.5) / 2;
          const py = y + (sy + 0.5) / 2;
          if (px < left || px >= right || py < top || py >= bottom) {
            continue;
          }
          // Corner-center origin shifted by outset.
          const cxLeft = left + r;
          const cyTop = top + r;
          const cxRight = right - r;
          const cyBottom = bottom - r;
          const dx = px < cxLeft ? cxLeft - px : px > cxRight ? px - cxRight : 0;
          const dy = py < cyTop ? cyTop - py : py > cyBottom ? py - cyBottom : 0;
          if (dx * dx + dy * dy <= r * r) {
            inside += 1;
          }
        }
      }
      buf[y * width + x] = Math.round((inside / 4) * 255);
    }
  }
  return buf;
}

/**
 * 2D Gaussian convolution on premultiplied-alpha RGBA8 bytes.
 *
 * Implementation: two passes (horizontal then vertical) of a 1D
 * Gaussian kernel — O(width × height × kernel_size) total instead
 * of the O(width × height × kernel_size²) of a naive 2D loop. The
 * separable property of a Gaussian (G2D(x, y) = G1D(x) × G1D(y))
 * makes this exact, not an approximation.
 *
 * The input is treated as straight (un-premultiplied) RGBA. We
 * premultiply on the fly during the horizontal pass and divide back
 * out at the end so colour bleeding stops at the alpha boundary.
 */
function gaussianBlur2DFloat(input: Float32Array, width: number, height: number, radius: number): Float32Array {
  // Figma's "blur radius" maps to sigma via a 0.5 factor — verified
  // against effects/blur-layer at radius=4: sigma=2.0 produces the
  // closest visual + byte match to the WebGL ref.
  // Input is straight-alpha float RGBA; we premultiply on the fly
  // and un-premultiply at the end so colour bleeding stops at the
  // alpha boundary.
  const sigma = Math.max(0.01, radius * 0.5);
  // 4σ truncation captures ~99.97% of Gaussian energy. Verified
  // against effects/realistic-badge and effects/blur-layer where the
  // 1-byte halo tail past 3σ shows visible ref pixels; 4σ picks it
  // up at the cost of a slightly wider kernel.
  const kernelRadius = Math.max(1, Math.ceil(sigma * 4));
  const kernelSize = kernelRadius * 2 + 1;
  const kernel: number[] = new Array(kernelSize);
  let total = 0;
  for (let i = 0; i < kernelSize; i += 1) {
    const offset = i - kernelRadius;
    const w = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[i] = w;
    total += w;
  }
  for (let i = 0; i < kernelSize; i += 1) {
    kernel[i] = kernel[i]! / total;
  }
  // Horizontal pass: premultiply input, blur into temp.
  const temp = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < kernelSize; k += 1) {
        const sx = clamp(x + k - kernelRadius, 0, width - 1);
        const i = (y * width + sx) * 4;
        const w = kernel[k]!;
        const sa = input[i + 3]!;
        r += input[i]! * sa * w;
        g += input[i + 1]! * sa * w;
        b += input[i + 2]! * sa * w;
        a += sa * w;
      }
      const o = (y * width + x) * 4;
      temp[o] = r;
      temp[o + 1] = g;
      temp[o + 2] = b;
      temp[o + 3] = a;
    }
  }
  // Vertical pass: blur the horizontal-pass output and un-premultiply
  // into straight-alpha float output.
  const output = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < kernelSize; k += 1) {
        const sy = clamp(y + k - kernelRadius, 0, height - 1);
        const i = (sy * width + x) * 4;
        const w = kernel[k]!;
        r += temp[i]! * w;
        g += temp[i + 1]! * w;
        b += temp[i + 2]! * w;
        a += temp[i + 3]! * w;
      }
      const o = (y * width + x) * 4;
      if (a < 1e-7) {
        output[o] = 0;
        output[o + 1] = 0;
        output[o + 2] = 0;
        output[o + 3] = 0;
      } else {
        output[o] = r / a;
        output[o + 1] = g / a;
        output[o + 2] = b / a;
        output[o + 3] = a;
      }
    }
  }
  return output;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function byteFromUnit(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 255;
  return Math.floor(value * 255 + 0.5);
}

/**
 * Pick the first visible paint of a kind the blur sampler supports
 * (SOLID, GRADIENT_LINEAR, GRADIENT_RADIAL, GRADIENT_ANGULAR,
 * GRADIENT_DIAMOND). Multi-paint stacks aren't supported yet for
 * blur — caller falls through to the unblurred polygon path.
 */
function firstVisibleSupportedFill(paints: readonly FigPaint[] | undefined): FigPaint | undefined {
  if (!paints) return undefined;
  for (const paint of paints) {
    if (paint.visible === false) continue;
    if (
      paint.type === "SOLID"
      || paint.type === "GRADIENT_LINEAR"
      || paint.type === "GRADIENT_RADIAL"
      || paint.type === "GRADIENT_ANGULAR"
      || paint.type === "GRADIENT_DIAMOND"
    ) {
      return paint;
    }
  }
  return undefined;
}
