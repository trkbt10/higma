# Byte-parity handoff — fig-to-godot pixel diff reduction

## Status snapshot (2026-05-11, fifth pass — contract restoration)

The spec/cases caps have been aligned with the SwiftUI peer
(`fig-to-swiftui/spec/cases`) where each fixture's per-frame cap is
0.5% (or 2% for blur where renderer-level gaussian discretisation
legitimately leaks). Loose caps were papering over real implementation
gaps; tightening them surfaces 30 concrete bugs to fix.

- Suite: **367/397 spec tests pass, 30 failures** (the 30 are real
  implementation gaps documented in "Implementation gaps" below).
- Contract: `.fig` → `emitFrameFile` → Godot batch render → diff vs
  `reference.png` (WebGL). The diff cap expresses how close the
  Godot output is to the WebGL ref. The SwiftUI peer demonstrates
  0.5% is achievable for effects on the SAME inputs through a
  different renderer, so the same target is the right ceiling for
  Godot output too.
- Note: `comparePng` defaults to `includeAA: false`. Earlier doc
  claimed "includes AA pixels" but code didn't pass `includeAA: true`.
- Caveat: the batch render in `scripts/measure-all-cases.ts` and the
  spec tests both hit non-determinism — runs occasionally flag
  dozens of cases at 99%+ then recover on the next invocation. Treat
  single-run results with suspicion and re-run before concluding a
  regression.

## Implementation gaps (failing under SwiftUI-peer caps)

Each entry below is "the rendered Godot output diverges from WebGL by
more than the cap". The fix is implementation work, NOT cap loosening.

### Effect-bearing fixtures (cap 0.5%, blur 2%)

| Case | Current diff | Cap | Notes |
|------|------|-----|-------|
| `bool-opacity` | 17.90% | 0.5% | Godot framebuffer rounding (round-half-up) at CanvasGroup `self_modulate` blend differs from WebGL (banker's/floor). +1 B-channel drift everywhere. |
| `grad-multi-effect` | 15.61% | 0.5% | Multi-shadow stack on gradient fill; halo distribution mismatch. |
| `shadow-drop-color` | 13.48% | 0.5% | Coloured drop shadow halo. |
| `image-fill-shadow` | 11.02% | 0.5% | Image + shadow halo + bilinear precision. |
| `effects-combined` | 9.13% | 0.5% | shadow + blur + inner shadow combo. |
| `grad-opacity` | 7.92% | 0.5% | gradient inside CanvasGroup opacity wrap. |
| `image-fill-basic` | 7.38% | 0.5% | Image bilinear sampling precision vs WebGL texture filter. |
| `realistic-badge` | 7.30% | 0.5% | Gradient pill + drop shadow halo tail. |
| `image-fill-multi` | 5.65% | 0.5% | Image over solid: double-premult emit imperfect at edge AA. |
| `shadow-inner` | 5.39% | 0.5% | Inner shadow mask alpha distribution mismatch. |
| `image-fill-circle` | 5.00% | 0.5% | Image + ellipse mask edge AA. |
| `grad-shadow-inner` | 4.70% | 0.5% | Gradient + inner shadow combo. |
| `grad-shadow-drop` | 4.30% | 0.5% | Gradient + drop shadow combo; halo 1-byte deficit. |
| `realistic-card` | 4.10% | 0.5% | Card composition halo. |
| `solid-stroke-radius-shadow` | 3.02% | 0.5% | Stroke at corner + shadow; corner stroke AA. |
| `shadow-drop-multi` | 2.99% | 0.5% | Two-stack drop shadow halo. |
| `frame-inner-shadow` | 2.95% | 0.5% | Frame-level inner shadow at canvas edges. |
| `shadow-drop-offset` | 2.70% | 0.5% | Diagonal offset shadow halo. |
| `stroke-basic` | 2.48% | 0.5% | Plain-rect StyleBoxFlat stroke positions 0.5px off; no AA. |
| `shadow-drop-basic` | 2.26% | 0.5% | Standard drop shadow halo. |
| `shadow-shapes` | 2.09% | 0.5% | Multi-shape shadow in one frame. |
| `clip-shadow` | 2.09% | 0.5% | Shape with shadow inside clip frame. |
| `grad-blur` | 23.98% | 2% | Gradient + layer blur; far-tail kernel truncation. |
| `blur-layer` | 16.64% | 2% | Layer blur on solid ellipse; oblique-edge intensity. |

### Non-effect fixtures

| Case | Current | Cap | Notes |
|------|---------|-----|-------|
| `solid-colors` | 1.42% | 0.5% | Plain-rect stroke positioning 0.5px shift. |
| `diamond-gradient` | 1.03% | 0.5% | Diamond gradient sampling precision. |
| `angular-gradient-effect` | 1.11% | 0.5% | Angular gradient + drop shadow. |
| `rect-dashed` | 1.13% | 0.5% | Dashed-stroke line-cap geometry. |
| `rect-effect` | 1.07% | 0.5% | Rect with effect. |

### Constraints fixture (cap 0.5%, was 12-38%)

`constraints/render.spec.ts` previously had 12-38% caps on SCALE/STRETCH
permutations — papered over real constraint-emission bugs. Now at 0.5%;
these tests will surface SCALE constraint resolution gaps as failures
once the actual.png refreshes.

### Wins this iteration

| Case | Before | After |
|------|--------|-------|
| `multi-fill-gradient` | 21.82% | **0.00%** |
| `image-fill-multi` | 45.94% | **5.65%** |
| `clip-rounded-gradient` | 11.94% | **0.00%** |
| `clip-gradient-rounded` | 9.69% | **0.00%** |
| `mask-rounded` | 43.27% | **0.00%** |
| `mask-basic` | 15.15% | **0.22%** |
| `bool-gradient-union` | 23.23% | **0.00%** |
| `bool-gradient-subtract-shadow` | 13.20% | **0.00%** |
| `frame-drop-shadow` | 9.12% | **3.78%** |
| `frame-inner-shadow` | 7.97% | **2.95%** |
| `grad-stroke-radius` | 1.71% | **0.05%** |
| `grad-multi-effect` | 15.61% | (3-pass blur regressed, reverted; remains 15.61%) |

### Key code changes

1. **Multi-paint composite in pre-raster** (`src/style/blur-raster.ts`)
   - Lifted the `visibleCount !== 1` gate in `tryEmitAntialiasedFillShape` to accept multi-paint stacks.
   - Added byte-quantize between paint layers inside `rasterizeShapeWithEffects` to mirror WebGL's per-paint framebuffer chain. Each layer's accumulator gets snapped to byte then back to float before the next layer reads it.

2. **IMAGE paint sampler double-premult fix** (`src/style/blur-raster.ts`)
   - WebGL's textured shader emits `gl_FragColor = texColor * u_opacity` AND then GL's `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` blend multiplies by src.alpha again → effective image contribution is `rgb * opacity²`.
   - Sampler now emits `{r * opacity, g * opacity, b * opacity, a * opacity}` so my CPU straight-alpha-over reproduces the byte-for-byte same composite. Verified on `image-fill-multi` interior pixels.

3. **Plain-rect gradient through pre-raster** (`src/emit/walk.ts`)
   - `tryEmitAntialiasedFillShape` now accepts RECTANGLE without corner radius IF the fill is non-SOLID (gradient or image). Plain SOLID rectangles continue through StyleBoxFlat (already byte-perfect).
   - Cleared 4 cases (clip-rounded-gradient, clip-gradient-rounded, mask-rounded, mask-basic). Plain SOLID rects are unaffected.

4. **Polygon2D color compensate flag in CanvasGroup** (`src/style/color.ts`, `src/shape/polygon.ts`, `src/emit/walk.ts`)
   - `solidPaintToPolygon2DColor` accepts a `compensate: boolean` param. The +0.5 centring bias gets skipped when the polygon will render inside a `CanvasGroup self_modulate`-alpha composite — the bias would otherwise survive the float buffer and overshoot the blended byte by 1 (`bool-opacity` 140→141 drift).
   - Did not fix bool-opacity (different root cause: Godot vs WebGL round-half-up vs round-half-down at the framebuffer write step), but the principled fix is plumbed for future correctness.

5. **Measure script accuracy** (`scripts/measure-all-cases.ts`)
   - Now passes `companions: file.assets` and `images: ctx.images` to the batch render so image-fill cases get their textures. Previously the script under-reported by treating image-fill cases as broken.

6. **BOOLEAN_OPERATION + LINEAR/RADIAL gradient pre-raster** (`src/style/gradient-raster.ts`, `src/shape/polygon.ts`, `src/emit/walk.ts`)
   - Added `rasterizeLinearGradient` / `rasterizeRadialGradient` to `gradient-raster.ts`. The linear variant follows the WebGL reference EXACTLY: invert the fig transform, compute `start = inv⋅(0, 0)` and `end = inv⋅(1, 0)`, then `t = dot(localPos - start, gradDir) / |gradDir|²`. The forward-transform shortcut only matches WebGL for orthonormal transforms.
   - Threaded `resolveLinear` / `resolveRadial` through `buildPolygon2DNodes`. The BOOLEAN_OPERATION / VECTOR caller in `emitPathBlobLeaf` sets `preRasterLinearRadial: true` to opt into pre-raster for those paths.
   - **Critical**: the texture is rasterised at the merged contour's BOUNDING BOX dimensions (not `node.size`), matching the WebGL ref's `elementSize = { width: bounds.maxX - bounds.minX, ... }` in `renderer.ts` `drawStencilFill`. `node.size` for a BOOLEAN_OPERATION is the Figma-authored size, which is typically looser than the actual merged contour. Pre-rasterising at node.size produces a gradient sampled along the wrong axis.
   - `buildRasterizedGradientPolygon` accepts an optional `textureOrigin` and `textureSize` for UV remap: `uv = (vertex - origin) * texSize / size`. This lets the texture span only the bounds region while polygon vertices stay in shape-local coords.
   - Wins: `bool-gradient-union` 23.23% → 0.00%, `bool-gradient-subtract-shadow` 13.20% → 0.00%.

7. **FRAME-with-shadow pre-raster with canvas-fill flag** (`src/style/blur-raster.ts`, `src/emit/walk.ts`)
   - `rasterizeShapeWithEffects` now accepts an `options.silhouetteFillsCanvas` flag. When true (top-level FRAME case), the shadow path:
     - Blurs the silhouette in SHAPE-SIZE space (no padding) so `gaussianBlur2DFloat`'s clamp-to-edge mirrors WebGL's `CLAMP_TO_EDGE` on the canvas-sized silhouette FBO. Padding-zero outside the silhouette region was causing the kernel to read zero past the shape edge — at a frame's top edge with shadow offset DOWN, my blur picked up only partial shadow contribution while WebGL clamped to silhouette interior and gave full shadow.
     - Initialises `accum` to opaque white instead of transparent black, mirroring the canvas's clear-color (`environment/defaults/default_clear_color = Color(1, 1, 1, 1)`). Without this, the shadow composite starts on a black-transparent buffer and the chain compounds a 1-byte drift vs WebGL's `framebuffer-white → shadow → shape` chain.
     - Byte-quantises `accum` between shadow and shape composite passes (and again before inner shadow), mirroring WebGL's framebuffer write-quantization between draw calls. Without this, the intermediate float value `0.65` differs from WebGL's stored byte `166 → 0.6510` and propagates a 1-byte drift through the final output.
   - The inner-shadow path also has a canvas-fill branch: blurs the silhouette in shape-size space with clamp-to-edge instead of the padded-with-zero buffer.
   - `tryEmitFrameWithShadow` in `walk.ts` re-enabled (previously disabled). Passes `silhouetteFillsCanvas: true` for FRAME nodes with shadow effects.
   - Wins: `frame-drop-shadow` 9.12% → 3.78%, `frame-inner-shadow` 7.97% → 2.95%.

8. **Stroke padding for pre-raster paths** (`src/style/blur-raster.ts`, `src/emit/walk.ts`)
   - `rasterizeShapeWithEffects` now accepts `options.strokePadding` to reserve room around the silhouette for a CENTER / OUTSIDE stroke band that extends past the silhouette edge. Without this padding, a 2px CENTER stroke extends 1px outside the silhouette but the texture stopped at the silhouette edge — the outer half of the stroke got clipped (`grad-stroke-radius` showed 217-byte deviation at the outer band).
   - `computeStrokePadding` helper computes the right padding from the stroke's weight and alignment.
   - Called from both `tryEmitAntialiasedFillShape` (AA-fill path, no effects) and `tryEmitBlurredShape` (effects path) before invoking the rasterizer.
   - Win: `grad-stroke-radius` 1.71% → 0.05%. Cap tightened from 2% to 0.1%.
   - Note: stroke-only plain rects (no corner radius, no fill, e.g. `stroke-basic`) routed through pre-raster regressed 2.48%→5.00% — `paintStrokeBand`'s SDF positions the stroke 1px off from Godot's StyleBoxFlat stroke for hard-cornered rects. Reverted that experiment; only fill+stroke combinations (already routing through pre-raster) get the padding benefit.

### Failed experiments this iteration

- **Inverse-transform fix in `buildLinearSampler` (blur-raster.ts)** — the same WebGL-exact math applied to the multi-paint / FRAME-effect path. Spec suite regressed (49 autolayout cases jumped to 99% diff). The blur-raster's sampler is consumed by a different compositor (per-pixel CPU loop) and its forward-transform interpretation appears calibrated against the existing compositing math. Reverted; the BOOLEAN_OPERATION inverse-transform fix above stays scoped to `gradient-raster.ts`.

- **FRAME-pre-raster without canvas-fill awareness** (resolved in pass 4 by the canvas-fill flag) — the first attempt at FRAME pre-raster regressed 9% → 72% because of the silhouette-buffer-edge mismatch with WebGL's `CLAMP_TO_EDGE` FBO sampling. The fourth pass solved it by adding the `silhouetteFillsCanvas` flag and re-applying byte-quantize between composite passes.

The reference pipeline is the fig WebGL renderer driven by puppeteer + headless Chrome (see `@higma-tools/web-fig-roundtrip`). Reference PNGs are sourced from `@higma-tools/fig-to-swiftui/cases/<case>/<frame>/reference.png` and copied into `packages/@higma-tools/fig-to-godot/cases/<case>/<frame>/reference.png` at fixture-prep time.

## What's been done

### Pre-rasterization pipeline (`src/style/blur-raster.ts`)

A CPU-side compositing pipeline that rasterizes a shape with its fills + effects into an inline `Image` + `ImageTexture` sub-resource emitted as a Polygon2D. This sidesteps Godot's renderer-pipeline limitations (gl_compatibility CanvasGroup blank-output bug) and gives byte-level control over the composite math.

The path is reached via two entry points in `src/emit/walk.ts`:

1. **`tryEmitBlurredShape(node, ctx)`** — fires when the node has any visible `LAYER_BLUR` / `FOREGROUND_BLUR` / `DROP_SHADOW` / `INNER_SHADOW`. The fill is rasterized with the effect stack applied behind/on top of it.
2. **`tryEmitAntialiasedFillShape(node, ctx)`** — fires when the node has NO effects but a curved silhouette + a single gradient OR image fill. Captures the AA-edge win for shapes whose Polygon2D-default rendering produces sharp corners.

Both go through `rasterizeShapeWithEffects(node, effects, imageResolver?)`. The composite buffer is **Float32Array** throughout (RGBA), quantized to byte ONCE at the end — this collapses the systematic 1-byte error that re-quantizing between layers used to introduce.

### Effect support inside the rasterizer

- **Layer blur**: separable 2-pass Gaussian (premultiplied alpha in the horizontal pass, un-premultiplied at the vertical output). `sigma = radius * 0.5`, kernel radius `ceil(sigma * 4)`. Calibrated against `effects/realistic-badge` and `effects/blur-layer` — the 1-byte halo tail past 3σ shows visible ref pixels, 4σ picks it up.
- **Drop shadow**: silhouette painted in shadow color, offset by `shadow.offset`, blurred, composited behind the shape fill.
- **Inner shadow**: matches the WebGL fragment shader formula `shadowMask = shapeAlpha * (1 - blurredAlpha_at_offset)`. Important: the offset is applied at SAMPLE time (look up the pre-blurred silhouette at `(x - ox, y - oy)`), NOT during silhouette construction. Y-down buffer convention requires negating the fig offset compared to the WebGL shader's texCoord-relative `+u_offset`.

### Paint sampler stack

`buildPaintSamplerStack(paints, w, h, imageResolver?)` returns a list of per-pixel samplers, one per visible paint, in fig order (bottom-up).

Sampler kinds:
- `SOLID` (constant)
- `GRADIENT_LINEAR` (forward 2×2 transform → `t = gx`)
- `GRADIENT_RADIAL` (centre + radius from transform, `t = distance / radius`)
- `GRADIENT_ANGULAR` (mirror of `rasterizeAngularGradient` — forward 2×2, `t = atan2(-gx, gy) / 2π`)
- `GRADIENT_DIAMOND` (mirror of `rasterizeDiamondGradient` — 4-quadrant linear, `t = (|dx|/dxMax + |dy|/dyMax) / 2`)
- `IMAGE` (STRETCH fill with bilinear filtering; requires `imageResolver` callback)

The rasterizer composites the whole stack in float space when the AA-fill path lets multi-paint through. **CURRENTLY the AA-fill gate is single-paint-only** because the float composite drifts ~1 byte vs WebGL's per-paint framebuffer-quantize chain on `paint-advanced/multi-fill-gradient`. See "Multi-paint compositing" below for next-step ideas.

### Silhouette rasterization (`rasterizeShapeSilhouette` family)

- **ELLIPSE**: hybrid 8×8 supersampling on a ±1 px band around the elliptical edge, binary classification elsewhere. Caught the oblique-edge AA win on `realistic-avatar`.
- **RECTANGLE / ROUNDED_RECTANGLE**: 2×2 supersampling. Multiple attempts to improve (8×8 hybrid, SDF-based, ±0.25 px inset) all caused net regressions on already-calibrated cases — 2×2 is the local optimum given the current blur-kernel calibration. **FRAME nodes are NOT supported** because frame pre-raster swallows the children's geometry.

### Stroke painting on the rasterized buffer

`paintStrokeBand` paints an analytic stroke band on top of the rasterized fill+effects using the shape's SDF (signed distance). Supports `ELLIPSE` and `ROUNDED_RECTANGLE` with `INSIDE` / `CENTER` / `OUTSIDE` alignment and 2×2 supersampling AA. Activated from `paintStrokeOnRaster(node_, raster)` in walk.ts.

Both `tryEmitBlurredShape` and `tryEmitAntialiasedFillShape` call it after the fill rasterization, so stroked curved-gradient shapes route through pre-raster too.

### Color quantization helpers (`src/style/color.ts`)

Two compensation paths because Godot's `Color` quantization differs per widget:

- `solidPaintToPolygon2DColor` uses `(targetByte + 0.5) / 255` (centred-byte bias). Polygon2D's vertex-pipeline rounds through float32, and the centring bias compensates for float32 round-trip noise so opaque output lands on `round(c * 255)`.
- `solidPaintToLine2DColor` uses `targetByte / 255` (lower-bound). Line2D's `default_color` quantises through `Color::to_argb32` which is round-half-up; the lower-bound form means `round(b)` returns `b` exactly.

The same compensation choice was attempted parametrically (`{ blended: boolean }`) — **all attempts caused regressions** (see "Failed experiments" below).

## Cumulative wins (recent iterations)

| Case | Before | After |
|------|--------|-------|
| `grad-radius-linear` | 18.23% | **0.01%** (pm@0-ish) |
| `grad-radius-pill` | 40.38% | **0.19%** |
| `grad-radius-card` | 15.70% | **0.06%** |
| `angular-gradient-effect` | 19.17% | **1.11%** |
| `grad-stroke-radius` | 17.25% | **1.71%** |
| `image-fill-basic` | 46.02% | **7.38%** |
| `image-fill-circle` | 31.80% | **5.00%** |
| `image-fill-shadow` | 48.15% | **11.02%** |
| `shadow-drop-multi` | 9.96% | **2.99%** |
| `effects-combined` | 15.71% | **9.13%** |
| `grad-shadow-drop` | 8.02% | **4.30%** |
| `clip-shadow` | 4.01% | **2.09%** |
| `shadow-shapes` | 5.12% | **2.09%** |
| `realistic-avatar` | 3.15% | **1.65%** |
| `realistic-card` | 6.75% | **4.10%** |

## Remaining OVER cases (sorted by current diff%)

Cap reference: per-spec caps in `spec/cases/<case>/render.spec.ts`. Direct pixelmatch percentages from `actual.png` on disk shown.

### Top remaining work

1. **`image-fill/image-fill-multi` — 45.94%** — multi-paint (SOLID + IMAGE @ 0.6 opacity). The AA-fill gate skips multi-paint, so this routes to the legacy Polygon2D-stack path which composites two polygons with `self_modulate`. The UV mapping in the legacy emit looks wrong (uvs use `0.2667-3.7333` of a 4-texel image, fractional-texel indexing).

2. **`decoration-combo/grad-blur` — 23.98%** — gradient + LAYER_BLUR on a small shape. The blur halo intensity at oblique edges differs from WebGL by a few bytes per pixel. Possible causes investigated: per-pass sigma split (WebGL uses 3 passes), 33-tap kernel truncation per pass. Single-pass 4σ truncation gives similar but not exact match.

3. **`decoration-combo/bool-gradient-union` — 23.23%** & **`bool-gradient-subtract-shadow` — 13.20%** — `BOOLEAN_OPERATION` with gradient fill. Boolean ops have a separate emit path that doesn't go through the pre-rasterizer (the silhouette comes from the path-bool composer, not `rasterizeShapeSilhouette`). Extending pre-raster to consume the bool composer's output is the path forward — see "Open work" #4.

4. **`paint-advanced/multi-fill-gradient` — 21.82%** — multi-paint stack (SOLID + LINEAR_GRADIENT). Same gate issue as image-fill-multi. The systematic 1-byte drift on multi-paint composite is documented in `src/style/blur-raster.ts` near the `singlePaint` branch.

5. **`boolean/bool-opacity` — 17.90%** — uniform 1-byte B-channel drift. The blue overlay (0.2, 0.2, 0.8) at 50% alpha over yellow gives ref=140 (`floor(140.5)`) while Godot gives 141 (`round-half-up`). Caused by the `(targetByte + 0.5) / 255` centring bias in `polygon2DByteCompensate` — the bias is needed for opaque Polygon2D rendering through float32 vertex pipeline but adds sub-byte drift to blended composites.

6. **`effects/blur-layer` — 16.64%** — single GRADIENT_LINEAR (well actually FOREGROUND_BLUR on a SOLID-fill ellipse). The oblique-edge issue: at pixels just outside the shape's radius at 45° angle, ref shows colors that are mathematically impossible from a uniform white-to-shape blend in straight or linear-light space. **Suspect WebGL is doing premultiplied-alpha blur in linear-light, but full linear-light decode + per-pass truncation didn't match either.** This is a known limitation — see "Investigated dead ends" below.

7. **`decoration-combo/grad-multi-effect` — 15.61%**, **`effects/shadow-drop-color` — 13.48%**, **`decoration-combo/clip-rounded-gradient` — 11.98%**, **`decoration-combo/clip-gradient-rounded` — 9.69%** — combinations of effects + clipped frames. The `clip-*` cases use FRAME `clipsContent=true` with rounded corners; my emit uses Control `clip_contents=true` which is RECTANGULAR, not rounded. Children's gradient extends past the rounded mask in my output.

8. **`frame-properties/frame-drop-shadow` — 9.12%**, **`frame-properties/frame-inner-shadow` — 7.97%** — FRAME nodes with shadow effects. Pre-raster path supports RECT/ROUNDED_RECT/ELLIPSE only — adding FRAME caused 94% diff because the FRAME pre-raster swallows the children's geometry.

9. **`decoration-combo/grad-opacity` — 7.92%** — two overlapping rounded shapes (red rect + gradient overlay at 0.6 opacity). The overlay's corner AA extends 1 px wider than ref's MSAA result. Attempted fix with `silhouetteInset = -0.25` regressed grad-radius-linear (which is at pm@0 currently).

10. **`decoration-combo/realistic-badge` — 7.30%** — gradient pill + drop shadow. Most of the diff is the 1-byte halo tail at distances >4σ from the shape edge. Pushing the kernel to 5σ caused 37 regressions elsewhere; 4σ is the calibrated local optimum.

## Open work / next steps

### High-impact, well-defined

1. **Multi-paint compositing (multi-fill-gradient, image-fill-multi)** — the rasterizer's `buildPaintSamplerStack` already handles multi-paint. The gate in `tryEmitAntialiasedFillShape` is `visibleCount !== 1` to skip. The issue is that the FLOAT composite differs from WebGL's per-paint-byte-quantize chain by ~1 byte per channel. **Approach**: between paint layers, quantize the float accumulator to byte before continuing. Verified attempt regressed via stale Godot batch render (cleanup may have masked the actual signal — worth re-trying). Watch `paint-advanced/multi-fill-gradient` and `image-fill/image-fill-multi`.

2. **Polygon2D blended-color drift (bool-opacity)** — emit `targetByte / 255` (no centring bias) when the polygon will be alpha-blended. Two failed attempts:
   - Removing the bias entirely → regressed 29 opaque rendering cases (float32 round-trip noise pushes them 1 byte low).
   - Parametric `{ blended: boolean }` option → regressed `multi-fill-gradient` because the SOLID base in a multi-paint stack got byte-quantized but the gradient overlay didn't.
   
   The correct approach is per-CHANNEL emission of `byte / 255` only when the channel is going to be read back through framebuffer quantization. That requires distinguishing the rendering chain at emit time — the existing emit doesn't have that info.

3. **Frame-level pre-rasterization (frame-drop-shadow, frame-inner-shadow, clip-rounded-gradient, clip-gradient-rounded)** — extend `rasterizeShapeSilhouette` to support `FRAME` nodes by rasterizing the frame's silhouette (just the rounded bg) WITHOUT the children. Then the children render OVER the rasterized frame texture as normal child nodes. The pitfall: my naive FRAME implementation last iteration produced 94% diff because the entire FRAME (including the area where children should appear) got rasterized + composited as if it were a leaf shape. The fix is to emit the children INSIDE the frame's pre-rasterized Polygon2D as actual scene-graph children.

4. **BOOLEAN_OPERATION pre-rasterization (bool-gradient-union, bool-gradient-subtract-shadow)** — boolean ops produce a silhouette via path-bool composition. The output is a polygon contour. To pre-rasterize, scan-convert that contour to an alpha mask and use it as the silhouette buffer. The fill stack rasterizes on top normally. **Touches: `src/shape/boolean.ts` (composer output) and `src/style/blur-raster.ts` (silhouette consumer).**

### Lower-impact, polish

5. **Clip-rounded structural fix (`clip-rounded-gradient`, `clip-gradient-rounded`)** — these cases have a FRAME with rounded corners that clips a rectangular gradient child. My current emit uses Godot's `clip_contents=true` which is rectangular — children extend past the rounded mask. Fix candidates:
   - Pre-rasterize the entire clipped-frame structure into one texture (cleanest match but requires recursive child walk).
   - Use Godot's `CanvasGroup` with a clip shader (works in forward+ but blank in gl_compatibility per the original blur investigation).
   - Use Godot 4's `clip_children = 2` (CLIP_AND_DRAW) — the parent's drawn shape becomes the clip, not the rect. Needs verification.

6. **Far halo (`realistic-badge`, `effects-combined`, et al.)** — 1-byte tail at distance >4σ from shape edge. Increasing kernel to 5σ caused mass regressions. The WebGL renderer uses 3 separable passes each truncated at 16 taps (`sigmaPerPass = sigmaTotal / sqrt(3)`); the COMBINED kernel has a different far-tail shape than a single-pass 4σ truncation. Try implementing the 3-pass split with per-pass truncation matching WebGL exactly.

7. **Oblique-edge intensity (`effects/blur-layer`, `decoration-combo/grad-blur`)** — at pixels just outside the shape edge along the diagonal, ref shows lower R than mathematically possible from straight/linear-light Gaussian over uniform fill. Investigated:
   - Straight alpha blend — doesn't explain ref values
   - Linear-light blend with sRGB encode — doesn't either
   - γ=2.0 fast approximation — closer but still off
   - Premultiplied alpha blend in linear space — checked
   
   The remaining hypothesis: **GPU MSAA samples + premult-alpha texture write to sRGB framebuffer with the framebuffer's automatic linear↔sRGB conversion compounds with per-sample blend in a way that's hard to reproduce on CPU without simulating MSAA sample positions.** Decided to defer until a more general renderer-compat investigation.

### Diagnostic / housekeeping

8. **`measure-all-cases.ts` accuracy** — the in-script comparePng output sometimes shows 96% when on-disk pixelmatch shows 7%. The fresh-batch render in the script may be using a different Godot output than what hits disk (spec batch render vs measure batch render produce different bytes for some cases). Investigate the Godot driver-level non-determinism or the script's freshness handling.

9. **Stale `actual.png`** — cases not listed in any `spec/cases/<case>/render.spec.ts` `frameNames` don't get re-rendered. The on-disk `actual.png` may be days old. Affects `mask-rounded`, `mask-basic`, and other deferred cases that show in measure but never run through spec. Either prune the stale PNGs or include them in their spec at a loose cap (e.g. 100%) so they refresh.

## Investigated dead ends (do not retry without new info)

- **Removing `polygon2DByteCompensate` bias entirely** — regressed 29 opaque rendering cases (vector-winding et al.) due to float32 round-trip in Godot's vertex pipeline.
- **8×8 supersampling for ROUNDED_RECT silhouette** — regressed shadow-drop-* cases by 0.1-0.3% each because the calibrated blur halos shift relative to the slightly-different silhouette AA.
- **SDF-based coverage for ROUNDED_RECT silhouette** (`coverage = clamp(0.5 - d, 0, 1)`) — regressed 7 cases by ≤0.3% each.
- **Silhouette inset −0.25 px on no-effect path** — no net win; `grad-radius-linear` flipped from pm@0 to 0.01%, `grad-opacity` got slightly worse, no big wins elsewhere.
- **Kernel reach 3.25σ, 3.5σ, 5σ** — all caused net regressions vs 4σ. 4σ is the calibrated local optimum.
- **Sigma multiplier 0.495 vs 0.5** — 8 failures from a 1% sigma change. The blur calibration is very tight.
- **FRAME nodes in `rasterizeShapeSilhouette`** — without re-emitting children inside the rasterized frame, the frame's children get swallowed → 94% diff.
- **Pre-rasterizing solid-only curved shapes through AA-fill path** — solid-on-rounded-rect already matches WebGL byte-perfectly via StyleBoxFlat; routing through pre-raster changes the registry and regresses.

## Where to look first

For a new contributor picking up this work:

1. Read `src/style/blur-raster.ts` end-to-end — it's the heart of the byte-parity work.
2. Read `src/emit/walk.ts` around `tryEmitBlurredShape` (line ~2329) and `tryEmitAntialiasedFillShape` (line ~2438) to understand the two entry points.
3. Run `bun run vitest run packages/@higma-tools/fig-to-godot/spec` to confirm baseline passing.
4. Use `bun scripts/probe.tmp.ts <case-path-segment>` (e.g. `bun scripts/probe.tmp.ts effects/blur-layer`) to dump the first 10 diff pixels with ref/act side-by-side.
5. Use the inline diff loop pattern (see this doc's "Top remaining work" section commands) to count diff direction per channel.

Per-case caps live in `spec/cases/<case>/render.spec.ts` files. Tightening a cap after a win is good hygiene — the suite then catches future regressions.

## Standing constraints (carried from CLAUDE.md / AGENTS.md)

- 「BOOLEAN_OPERATION / STAR / POLYGON / VECTOR / フレーム」 are first-class targets — corner-cutting in these areas is discouraged.
- 「少しでもfallbackに逃げていたら絶対に通らない」 — only correct/maximal solutions are accepted. Tightening a cap to absorb a regression is acceptable IF the regression is a known systematic limitation (e.g. WebGL MSAA reproduction), but using fallback rendering paths to mask issues is not.
- 「シンプル...よりも、難しくて困難であっても正しく書くこと」 — solve correctly even if difficult.

The /loop 20m cron (`*/20 * * * *`, job `7f6c40ec`) is in-session only and dies on session exit. For durable cloud-based loops, `/schedule` is the right interface.
