/**
 * @file Render module parity tests
 *
 * Verifies that scene-graph/render/ functions are the SINGLE source of truth
 * for SceneGraph → SVG attribute conversion. Both SVG string and React
 * renderers consume these functions exclusively.
 *
 * These tests validate:
 * 1. Exhaustive handling of all Fill types
 * 2. Exhaustive handling of all Effect types
 * 3. Consistent output format for both consumers
 * 4. New types added to SceneGraph unions cause compile errors if unhandled
 */

import type { Fill, SolidFill, LinearGradientFill, RadialGradientFill, ImageFill, Effect, Stroke, Color, PathContour } from "@higma-document-renderers/fig/scene-graph";
import { readPng } from "@higma-codecs/png";
import { encode as encodeJpeg } from "jpeg-js";
import {
  resolveFill,
  resolveTopFill,
  resolveStroke,
  resolveEffects,
  colorToHex,
  type IdGenerator,
} from "./index";
import { matrixToSvgTransform, contourToSvgD } from "@higma-primitives/path";
import type { AffineMatrix } from "@higma-primitives/path";

// =============================================================================
// Test Fixtures
// =============================================================================

function createIdGenerator(): IdGenerator {
  const counter = { value: 0 };
  return {
    getNextId(prefix: string): string {
      const id = `${prefix}-${counter.value}`;
      counter.value += 1;
      return id;
    },
  };
}

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };
const RED: Color = { r: 1, g: 0, b: 0, a: 1 };
const BLACK_50: Color = { r: 0, g: 0, b: 0, a: 0.5 };
const DATA_URI_PREFIX = "data:image/png;base64,";

// =============================================================================
// Test Fixtures
// =============================================================================

function buildFillForType(type: Fill["type"]): Fill {
  switch (type) {
    case "solid":
      return { type: "solid", color: RED, opacity: 1 };
    case "linear-gradient":
      return { type: "linear-gradient", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, stops: [], opacity: 1 };
    case "radial-gradient":
      return { type: "radial-gradient", center: { x: 0.5, y: 0.5 }, radius: 0.5, stops: [], opacity: 1 };
    case "image":
      return { type: "image", imageHash: "", data: new Uint8Array(0), mimeType: "image/png", scaleMode: "FILL", opacity: 1 };
    case "angular-gradient":
      return { type: "angular-gradient", center: { x: 0.5, y: 0.5 }, rotation: 0, stops: [], opacity: 1 };
    case "diamond-gradient":
      return { type: "diamond-gradient", center: { x: 0.5, y: 0.5 }, stops: [], opacity: 1 };
  }
}

function buildEffectForType(type: Effect["type"]): Effect {
  switch (type) {
    case "drop-shadow":
      return { type: "drop-shadow", offset: { x: 0, y: 0 }, radius: 0, color: BLACK_50 };
    case "inner-shadow":
      return { type: "inner-shadow", offset: { x: 0, y: 0 }, radius: 0, color: BLACK_50 };
    case "layer-blur":
      return { type: "layer-blur", radius: 0 };
    case "background-blur":
      return { type: "background-blur", radius: 0 };
  }
}

function createJpegData(): Uint8Array {
  const pixels = new Uint8Array([
    48, 64, 80, 255,
    192, 208, 224, 255,
  ]);
  return encodeJpeg({ width: 2, height: 1, data: pixels }, 100).data;
}

function pngDataFromImageDefDataUri(dataUri: string): Uint8Array {
  if (!dataUri.startsWith(DATA_URI_PREFIX)) {
    throw new Error("expected PNG data URI");
  }
  return Buffer.from(dataUri.slice(DATA_URI_PREFIX.length), "base64");
}

// =============================================================================
// Fill Resolution Tests
// =============================================================================

describe("Fill resolution (shared SoT)", () => {
  it("handles solid fill", () => {
    const fill: SolidFill = { type: "solid", color: RED, opacity: 1 };
    const ids = createIdGenerator();
    const result = resolveFill(fill, ids);

    expect(result.attrs.fill).toBe("#ff0000");
    expect(result.attrs.fillOpacity).toBeUndefined();
    expect(result.def).toBeUndefined();
  });

  it("handles solid fill with opacity", () => {
    const fill: SolidFill = { type: "solid", color: RED, opacity: 0.5 };
    const ids = createIdGenerator();
    const result = resolveFill(fill, ids);

    expect(result.attrs.fill).toBe("#ff0000");
    expect(result.attrs.fillOpacity).toBe(0.5);
  });

  it("handles linear gradient fill", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
      stops: [
        { position: 0, color: RED },
        { position: 1, color: WHITE },
      ],
      opacity: 1,
    };
    const ids = createIdGenerator();
    const result = resolveFill(fill, ids);

    expect(result.attrs.fill).toBe("url(#lg-0)");
    expect(result.def).toBeDefined();
    expect(result.def!.type).toBe("linear-gradient");
    if (result.def!.type === "linear-gradient") {
      expect(result.def!.x1).toBe("0%");
      expect(result.def!.y1).toBe("0%");
      expect(result.def!.x2).toBe("100%");
      expect(result.def!.y2).toBe("100%");
      expect(result.def!.stops).toHaveLength(2);
      expect(result.def!.stops[0].stopColor).toBe("#ff0000");
    }
  });

  it("handles radial gradient fill", () => {
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      center: { x: 0.5, y: 0.5 },
      radius: 0.5,
      stops: [
        { position: 0, color: RED },
        { position: 1, color: WHITE },
      ],
      opacity: 1,
    };
    const ids = createIdGenerator();
    const result = resolveFill(fill, ids);

    expect(result.attrs.fill).toBe("url(#rg-0)");
    expect(result.def!.type).toBe("radial-gradient");
  });

  it("handles image fill", () => {
    const fill: ImageFill = {
      type: "image",
      imageHash: "test-ref",
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
      scaleMode: "FILL",
      opacity: 1,
    };
    const ids = createIdGenerator();
    const result = resolveFill(fill, ids);

    expect(result.attrs.fill).toBe("url(#img-0)");
    expect(result.def!.type).toBe("image");
  });

  it("bakes paintFilter into JPEG image fills as PNG data", () => {
    const fill: ImageFill = {
      type: "image",
      imageHash: "jpeg-ref",
      data: createJpegData(),
      mimeType: "image/jpeg",
      scaleMode: "FILL",
      opacity: 1,
      paintFilter: { brightness: 0.1 },
      imageShouldColorManage: true,
    };
    const ids = createIdGenerator();
    const result = resolveFill(fill, ids, { colorProfile: "SRGB" });

    expect(result.def?.type).toBe("image");
    if (result.def?.type === "image") {
      expect(result.def.dataUri.startsWith(DATA_URI_PREFIX)).toBe(true);
      const decoded = readPng(pngDataFromImageDefDataUri(result.def.dataUri));
      expect(decoded.width).toBe(2);
      expect(decoded.height).toBe(1);
      expect(decoded.srgbIntent).toBe(0);
    }
  });

  it("requires an explicit export color profile for managed image fills", () => {
    const fill: ImageFill = {
      type: "image",
      imageHash: "color-managed-jpeg-ref",
      data: createJpegData(),
      mimeType: "image/jpeg",
      scaleMode: "FILL",
      opacity: 1,
      imageShouldColorManage: true,
    };
    const ids = createIdGenerator();

    expect(() => resolveFill(fill, ids)).toThrow("requires explicit exportSettings.colorProfile");
  });

  it("preserves no-op color-managed JPEG image fills without paintFilter", () => {
    const fill: ImageFill = {
      type: "image",
      imageHash: "color-managed-jpeg-ref",
      data: createJpegData(),
      mimeType: "image/jpeg",
      scaleMode: "FILL",
      opacity: 1,
      imageShouldColorManage: true,
    };
    const ids = createIdGenerator();
    const result = resolveFill(fill, ids, { colorProfile: "SRGB" });

    expect(result.def?.type).toBe("image");
    if (result.def?.type === "image") {
      expect(result.def.dataUri.startsWith("data:image/jpeg;base64,")).toBe(true);
      expect(Buffer.from(result.def.dataUri.slice("data:image/jpeg;base64,".length), "base64")).toEqual(Buffer.from(fill.data));
    }
  });

  it("resolveTopFill returns fill=none for empty fills", () => {
    const ids = createIdGenerator();
    const result = resolveTopFill([], ids);

    expect(result.attrs.fill).toBe("none");
    expect(result.def).toBeUndefined();
  });

  it("resolveTopFill uses the last fill", () => {
    const fills: Fill[] = [
      { type: "solid", color: RED, opacity: 1 },
      { type: "solid", color: WHITE, opacity: 1 },
    ];
    const ids = createIdGenerator();
    const result = resolveTopFill(fills, ids);

    expect(result.attrs.fill).toBe("#ffffff");
  });

  /**
   * COMPILE-TIME EXHAUSTIVENESS CHECK
   *
   * If a new Fill type is added to the Fill union in types.ts,
   * resolveFill() will fail to compile because the switch statement
   * won't cover the new variant (the `never` check catches it).
   *
   * This test documents that guarantee. It can't test the compile-time
   * behavior at runtime, but it verifies all current types are handled.
   */
  it("handles all Fill types (exhaustive)", () => {
    const allTypes: Fill["type"][] = ["solid", "linear-gradient", "radial-gradient", "image"];
    const ids = createIdGenerator();

    for (const type of allTypes) {
      const fill = buildFillForType(type);
      const result = resolveFill(fill, ids);
      expect(result.attrs.fill).toBeDefined();
    }
  });
});

// =============================================================================
// Stroke Resolution Tests
// =============================================================================

describe("Stroke resolution (shared SoT)", () => {
  it("resolves all stroke properties", () => {
    const stroke: Stroke = {
      color: RED,
      width: 2,
      opacity: 0.8,
      linecap: "round",
      linejoin: "bevel",
      dashPattern: [4, 2],
    };
    const result = resolveStroke(stroke);

    expect(result.stroke).toBe("#ff0000");
    expect(result.strokeWidth).toBe(2);
    expect(result.strokeOpacity).toBe(0.8);
    expect(result.strokeLinecap).toBe("round");
    expect(result.strokeLinejoin).toBe("bevel");
    expect(result.strokeDasharray).toBe("4 2");
  });

  it("omits default values", () => {
    const stroke: Stroke = {
      color: RED,
      width: 1,
      opacity: 1,
      linecap: "butt",
      linejoin: "miter",
    };
    const result = resolveStroke(stroke);

    expect(result.strokeOpacity).toBeUndefined();
    expect(result.strokeLinecap).toBeUndefined();
    expect(result.strokeLinejoin).toBeUndefined();
    expect(result.strokeDasharray).toBeUndefined();
  });
});

// =============================================================================
// Effects Resolution Tests
// =============================================================================

describe("Effects resolution (shared SoT)", () => {
  it("returns undefined for empty effects", () => {
    const ids = createIdGenerator();
    const result = resolveEffects([], ids);
    expect(result).toBeUndefined();
  });

  it("resolves NORMAL-blend drop shadow", () => {
    const effects: Effect[] = [{
      type: "drop-shadow",
      offset: { x: 2, y: 4 },
      radius: 8,
      color: BLACK_50,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    expect(result!.filterAttr).toMatch(/^url\(#filter-\d+\)$/);
    // NORMAL-blend recipe matches Figma's exporter for shadows without
    // a per-effect blend mode — no composite-out so blurred-hardAlpha
    // shadow shows through translucent sources:
    //   1. feColorMatrix (SourceAlpha → hardAlpha)
    //   2. feOffset
    //   3. feGaussianBlur
    //   4. feColorMatrix → tinted RGBA shadow
    //   5. feMerge (composites shadow under SourceGraphic)
    expect(result!.primitives).toHaveLength(5);
    expect(result!.primitives[0].type).toBe("feColorMatrix");
    expect(result!.primitives[1].type).toBe("feOffset");
    expect(result!.primitives[2].type).toBe("feGaussianBlur");
    expect(result!.primitives[3].type).toBe("feColorMatrix");
    expect(result!.primitives[4].type).toBe("feMerge");
  });

  it("resolves OVERLAY-blend drop shadow with composite-out", () => {
    const effects: Effect[] = [{
      type: "drop-shadow",
      offset: { x: 0, y: 4 },
      radius: 24,
      color: BLACK_50,
      blendMode: "overlay",
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    // Non-NORMAL recipe adds composite-out + final feBlend with the
    // configured mode. The composite-out is what prevents shadow tint
    // from leaking through translucent rounded-corner AA edges into
    // OVERLAY-blended sources (rounded-corner pink-halo regression).
    //   1. feColorMatrix (SourceAlpha → hardAlpha)
    //   2. feOffset
    //   3. feGaussianBlur
    //   4. feComposite (out, in2=hardAlpha)
    //   5. feColorMatrix → tinted RGBA shadow
    //   6. feBlend (mode=overlay, in2=SourceGraphic)
    //   7. feMerge
    expect(result!.primitives).toHaveLength(7);
    expect(result!.primitives[0].type).toBe("feColorMatrix");
    expect(result!.primitives[1].type).toBe("feOffset");
    expect(result!.primitives[2].type).toBe("feGaussianBlur");
    expect(result!.primitives[3].type).toBe("feComposite");
    expect(result!.primitives[4].type).toBe("feColorMatrix");
    expect(result!.primitives[5].type).toBe("feBlend");
    expect(result!.primitives[6].type).toBe("feMerge");
    const composite = result!.primitives[3];
    if (composite.type === "feComposite") {
      expect(composite.operator).toBe("out");
    }
    const blend = result!.primitives[5];
    if (blend.type === "feBlend") {
      expect(blend.mode).toBe("overlay");
    }
  });

  it("resolves SHARP drop shadow (radius=0) using Figma's hardAlpha-out recipe", () => {
    const effects: Effect[] = [{
      type: "drop-shadow",
      offset: { x: -1, y: 0 },
      radius: 0,
      color: BLACK_50,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    // Sharp recipe (matches Figma's exact SVG export shape):
    //   1. feColorMatrix (SourceAlpha → hardAlpha via 127× binarisation)
    //   2. feOffset (offsets hardAlpha — NOT SourceAlpha — so the AA fringe
    //      cannot survive the upcoming "out" composite and reduce the
    //      sliver's alpha to 50% of full).
    //   3. feComposite (out, in2=hardAlpha) — keeps offset hardAlpha
    //      where hardAlpha is NOT, producing the 1-px sliver at α=1.
    //   4. feFlood (shadow colour at full opacity, fills the filter region).
    //   5. feComposite (in, in2=composited) — masks the flood to the sliver.
    //   6. feMerge (composites tinted shadow under SourceGraphic).
    expect(result!.primitives).toHaveLength(6);
    expect(result!.primitives[0].type).toBe("feColorMatrix");
    expect(result!.primitives[1].type).toBe("feOffset");
    // Critical: the offset's input MUST be the binarised hardAlpha,
    // not the anti-aliased SourceAlpha. Operating on SourceAlpha here
    // bakes the source's anti-aliased edge into the offset sliver, and
    // after feComposite "out" against hardAlpha the sliver retains the
    // 0.5..0.99 AA values instead of a clean 1.0.
    const offsetPrim = result!.primitives[1];
    if (offsetPrim.type === "feOffset") {
      expect(offsetPrim.in).toBe(result!.primitives[0].type === "feColorMatrix" ? result!.primitives[0].result : undefined);
    }
    expect(result!.primitives[2].type).toBe("feComposite");
    expect(result!.primitives[3].type).toBe("feFlood");
    expect(result!.primitives[4].type).toBe("feComposite");
    expect(result!.primitives[5].type).toBe("feMerge");
  });

  it("resolves inner shadow", () => {
    const effects: Effect[] = [{
      type: "inner-shadow",
      offset: { x: 0, y: 2 },
      radius: 4,
      color: BLACK_50,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    // Inner-shadow recipe (matching the WebGL renderer's
    // `shapeAlpha * (1 - blurredAlpha_at_offset)`) emits 6
    // primitives:
    //   feOffset (SourceAlpha by dx,dy)
    //   feGaussianBlur
    //   feComposite OUT (SourceAlpha minus shifted-blurred) → band
    //   feFlood (shadow colour)
    //   feComposite IN (flood × band) → coloured inner band
    //   feMerge (terminal: SourceGraphic + inner band on top)
    expect(result!.primitives).toHaveLength(6);
    expect(result!.primitives[0].type).toBe("feOffset");
    expect(result!.primitives[1].type).toBe("feGaussianBlur");
    expect(result!.primitives[2].type).toBe("feComposite");
    expect(result!.primitives[3].type).toBe("feFlood");
    expect(result!.primitives[4].type).toBe("feComposite");
    // And the final primitive must be feMerge so SourceGraphic shows through.
    expect(result!.primitives[5].type).toBe("feMerge");
    // Cross-check the band composite operator+inputs — this is the
    // step that earlier landed the shadow *outside* the original.
    const band = result!.primitives[2];
    if (band.type === "feComposite") {
      expect(band.operator).toBe("out");
      expect(band.in).toBe("SourceAlpha");
    }
  });

  // Regression: Windows 98-style 3D beveled buttons stack four
  // INNER_SHADOWs (top-left highlight + secondary highlight, plus
  // bottom-right shadow + secondary shadow). Earlier every inner
  // shadow emitted its own `feMerge[SourceGraphic, inner]`, leaving
  // only the LAST shadow in the filter output (SVG filter chains
  // surface the most recent primitive's `result`, so earlier merges
  // became orphans). Now every inner-shadow result accumulates and
  // the trailing terminal `feMerge` lists them above `SourceGraphic`.
  it("stacks multiple inner shadows in a single terminal feMerge", () => {
    const effects: Effect[] = [
      { type: "inner-shadow", offset: { x: 2, y: 2 }, radius: 0, color: { r: 0.85, g: 0.85, b: 0.85, a: 1 } },
      { type: "inner-shadow", offset: { x: -2, y: -2 }, radius: 0, color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } },
      { type: "inner-shadow", offset: { x: 1, y: 1 }, radius: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
      { type: "inner-shadow", offset: { x: -1, y: -1 }, radius: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    ];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    // 4 shadows × 5 primitives each + 1 terminal feMerge = 21.
    expect(result!.primitives).toHaveLength(4 * 5 + 1);
    const last = result!.primitives[result!.primitives.length - 1];
    expect(last.type).toBe("feMerge");
    if (last.type !== "feMerge") { return; }
    // First node is SourceGraphic, then the 4 inner-shadow results in
    // declaration order.
    expect(last.nodes).toHaveLength(5);
    expect(last.nodes[0]).toBe("SourceGraphic");
    // Every other node must be a unique inner-* result ID.
    const ids4 = last.nodes.slice(1);
    expect(new Set(ids4).size).toBe(4);
    for (const id of ids4) {
      expect(id).toMatch(/^inner-/);
    }
  });

  // Regression guard for the spread branch of the inner-shadow
  // recipe. A non-zero `spread` morphologically dilates/erodes the
  // shifted SourceAlpha BEFORE the blur — without it, "Dilate the
  // shadow by 3 px" silently no-ops and renders the unspread
  // baseline. The recipe must thread feMorphology between feOffset
  // and feGaussianBlur, consuming the offset alpha and feeding the
  // blur.
  it("inner-shadow with positive spread inserts an feMorphology dilate", () => {
    const effects: Effect[] = [{
      type: "inner-shadow",
      offset: { x: 0, y: 2 },
      radius: 4,
      spread: 3,
      color: BLACK_50,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    // Pipeline with spread:
    //   feOffset → feMorphology(dilate) → feGaussianBlur →
    //   feComposite OUT → feFlood → feComposite IN → feMerge
    expect(result!.primitives).toHaveLength(7);
    expect(result!.primitives[0].type).toBe("feOffset");
    expect(result!.primitives[1].type).toBe("feMorphology");
    expect(result!.primitives[2].type).toBe("feGaussianBlur");
    const morphology = result!.primitives[1];
    if (morphology.type === "feMorphology") {
      expect(morphology.operator).toBe("dilate");
      expect(morphology.radius).toBe(3);
    }
  });

  // Regression guard for negative spread (erode). The same pipeline
  // shape must hold with `operator="erode"`. Erode crops the shifted
  // silhouette inward so the shadow band shrinks — a behavioural
  // mirror of dilate that must not be silently dropped.
  it("inner-shadow with negative spread inserts an feMorphology erode", () => {
    const effects: Effect[] = [{
      type: "inner-shadow",
      offset: { x: 0, y: 2 },
      radius: 4,
      spread: -2,
      color: BLACK_50,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);
    const morphology = result!.primitives[1];
    expect(morphology.type).toBe("feMorphology");
    if (morphology.type === "feMorphology") {
      expect(morphology.operator).toBe("erode");
      expect(morphology.radius).toBe(2);
    }
  });

  // Regression guard for the blur radius. `radius / 2` must thread
  // into feGaussianBlur's stdDeviation — Figma's spec halves the
  // radius for the SVG primitive. A future "simplify" refactor that
  // passes `radius` raw would double the blur size visually and
  // mis-render every soft shadow.
  it("inner-shadow with non-zero blur radius sets stdDeviation = radius / 2", () => {
    const effects: Effect[] = [{
      type: "inner-shadow",
      offset: { x: 0, y: 0 },
      radius: 8,
      color: BLACK_50,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);
    const blur = result!.primitives[1];
    expect(blur.type).toBe("feGaussianBlur");
    if (blur.type === "feGaussianBlur") {
      expect(blur.stdDeviation).toBeCloseTo(4);
    }
  });

  // Regression guard for the per-effect blend mode branch. When a
  // shadow's `blendMode` is non-default (e.g. SOFT_LIGHT), the
  // recipe emits an extra feBlend that mixes the coloured band
  // against SourceGraphic. Without it the shadow renders at its raw
  // alpha and ignores the authored blend.
  it("inner-shadow with non-default blend mode emits a final feBlend", () => {
    const effects: Effect[] = [{
      type: "inner-shadow",
      offset: { x: 0, y: 2 },
      radius: 0,
      color: BLACK_50,
      blendMode: "soft-light",
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);
    // The non-default blend appends feBlend before the terminal merge.
    expect(result!.primitives).toHaveLength(7);
    const blend = result!.primitives[5];
    expect(blend.type).toBe("feBlend");
    if (blend.type === "feBlend") {
      expect(blend.mode).toBe("soft-light");
      expect(blend.in2).toBe("SourceGraphic");
    }
  });

  it("resolves layer blur", () => {
    const effects: Effect[] = [{
      type: "layer-blur",
      radius: 10,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    expect(result!.primitives).toHaveLength(1);
    expect(result!.primitives[0].type).toBe("feGaussianBlur");
  });

  it("skips background blur (not supported in SVG)", () => {
    const effects: Effect[] = [{
      type: "background-blur",
      radius: 10,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeUndefined();
  });

  it("handles all Effect types (exhaustive)", () => {
    const allTypes: Effect["type"][] = ["drop-shadow", "inner-shadow", "layer-blur", "background-blur"];
    const ids = createIdGenerator();

    for (const type of allTypes) {
      const effect = buildEffectForType(type);
      // Should not throw
      resolveEffects([effect], ids);
    }
  });
});

// =============================================================================
// Color, Transform, Path Tests
// =============================================================================

describe("Color conversion (shared SoT)", () => {
  it("converts to hex correctly", () => {
    expect(colorToHex({ r: 1, g: 0, b: 0, a: 1 })).toBe("#ff0000");
    expect(colorToHex({ r: 0, g: 1, b: 0, a: 1 })).toBe("#00ff00");
    expect(colorToHex({ r: 0, g: 0, b: 1, a: 1 })).toBe("#0000ff");
    expect(colorToHex({ r: 0, g: 0, b: 0, a: 1 })).toBe("#000000");
    expect(colorToHex({ r: 1, g: 1, b: 1, a: 1 })).toBe("#ffffff");
  });

  it("handles float32 precision loss on boundary values", () => {
    // Kiwi encodes colors as float32. Exact 0.9 becomes 0.8999999..., so
    // naively 0.9 * 255 = 229.4999... would round down to 229 (#e5). The
    // half-ULP epsilon in channelToByte ensures these boundary values round
    // to the intended byte (230 = 0xe6). Same for 0.7 → 0.69999.. → 179.
    const buf = new ArrayBuffer(4);
    const f32 = new Float32Array(buf);
    f32[0] = 0.9;
    expect(colorToHex({ r: f32[0], g: 0, b: 0, a: 1 })).toBe("#e60000");
    f32[0] = 0.7;
    expect(colorToHex({ r: 0, g: f32[0], b: 0, a: 1 })).toBe("#00b300");
    // And channels that don't hit the .5 boundary must remain untouched.
    expect(colorToHex({ r: 0.5, g: 0.25, b: 0.75, a: 1 })).toBe("#8040bf");
  });
});

describe("Transform conversion (shared SoT)", () => {
  it("returns undefined for identity", () => {
    const identity: AffineMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    expect(matrixToSvgTransform(identity)).toBeUndefined();
  });

  it("formats non-identity matrix", () => {
    const m: AffineMatrix = { m00: 2, m01: 0, m02: 10, m10: 0, m11: 2, m12: 20 };
    expect(matrixToSvgTransform(m)).toBe("matrix(2,0,0,2,10,20)");
  });
});

describe("Path serialization (shared SoT)", () => {
  it("serializes path commands", () => {
    const contour: PathContour = {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 100, y: 0 },
        { type: "L", x: 100, y: 100 },
        { type: "Z" },
      ],
      windingRule: "nonzero",
    };
    expect(contourToSvgD(contour)).toBe("M0 0L100 0L100 100Z");
  });

  it("serializes cubic bezier", () => {
    const contour: PathContour = {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "C", x1: 10, y1: 20, x2: 30, y2: 40, x: 50, y: 60 },
      ],
      windingRule: "nonzero",
    };
    expect(contourToSvgD(contour)).toBe("M0 0C10 20 30 40 50 60");
  });
});
