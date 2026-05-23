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
const KIWI_TINY_OPACITY_SENTINEL = Math.fround(0.0001);

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
      return { type: "drop-shadow", offset: { x: 0, y: 0 }, radius: 0, color: BLACK_50, showShadowBehindNode: true };
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

  it("applies solid fill color alpha to SVG fill opacity", () => {
    const fill: SolidFill = { type: "solid", color: { ...RED, a: 0.25 }, opacity: 0.5 };
    const ids = createIdGenerator();
    const result = resolveFill(fill, ids);

    expect(result.attrs.fill).toBe("#ff0000");
    expect(result.attrs.fillOpacity).toBe(0.125);
  });

  it("matches Figma SVG export for Kiwi tiny opacity sentinel", () => {
    const fill: SolidFill = { type: "solid", color: RED, opacity: KIWI_TINY_OPACITY_SENTINEL };
    const ids = createIdGenerator();
    const result = resolveFill(fill, ids);

    expect(result.attrs.fillOpacity).toBe(0.01);
  });

  it("handles linear gradient fill", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
      stops: [
        { position: 0, color: RED },
        { position: 1, color: { r: 1, g: 1, b: 1, a: KIWI_TINY_OPACITY_SENTINEL } },
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
      expect(result.def!.stops[1].stopOpacity).toBe(0.01);
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
    const allTypes: Fill["type"][] = ["solid", "linear-gradient", "radial-gradient", "image", "angular-gradient", "diamond-gradient"];
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

  it("applies stroke color alpha to SVG stroke opacity", () => {
    const stroke: Stroke = {
      color: { ...RED, a: 0.25 },
      width: 2,
      opacity: 0.8,
      linecap: "butt",
      linejoin: "miter",
    };
    const result = resolveStroke(stroke);

    expect(result.stroke).toBe("#ff0000");
    expect(result.strokeOpacity).toBe(0.2);
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

  it("matches Figma SVG export for Kiwi tiny stroke opacity sentinel", () => {
    const stroke: Stroke = {
      color: RED,
      width: 1,
      opacity: KIWI_TINY_OPACITY_SENTINEL,
      linecap: "butt",
      linejoin: "miter",
    };
    const result = resolveStroke(stroke);

    expect(result.strokeOpacity).toBe(0.01);
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
      showShadowBehindNode: true,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    expect(result!.filterAttr).toMatch(/^url\(#filter-\d+\)$/);
    // NORMAL-blend recipe matches Figma's exporter: a transparent
    // BackgroundImageFix seed, shadow tint blended over that seed, and
    // SourceGraphic blended over the accumulated shadow.
    expect(result!.primitives).toHaveLength(7);
    expect(result!.primitives[0].type).toBe("feFlood");
    expect(result!.primitives[1].type).toBe("feColorMatrix");
    expect(result!.primitives[2].type).toBe("feOffset");
    expect(result!.primitives[3].type).toBe("feGaussianBlur");
    expect(result!.primitives[4].type).toBe("feColorMatrix");
    expect(result!.primitives[5].type).toBe("feBlend");
    expect(result!.primitives[6].type).toBe("feBlend");
    const sourceBlend = result!.primitives[6];
    if (sourceBlend.type === "feBlend") {
      expect(sourceBlend.in).toBe("SourceGraphic");
      expect(sourceBlend.mode).toBe("normal");
    }
  });

  it("resolves OVERLAY-blend drop shadow with composite-out", () => {
    const effects: Effect[] = [{
      type: "drop-shadow",
      offset: { x: 0, y: 4 },
      radius: 24,
      color: BLACK_50,
      blendMode: "overlay",
      showShadowBehindNode: false,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    // showShadowBehindNode=false adds composite-out, then blends the
    // shadow over the current drop-shadow backdrop with the authored mode.
    expect(result!.primitives).toHaveLength(8);
    expect(result!.primitives[0].type).toBe("feFlood");
    expect(result!.primitives[1].type).toBe("feColorMatrix");
    expect(result!.primitives[2].type).toBe("feOffset");
    expect(result!.primitives[3].type).toBe("feGaussianBlur");
    expect(result!.primitives[4].type).toBe("feComposite");
    expect(result!.primitives[5].type).toBe("feColorMatrix");
    expect(result!.primitives[6].type).toBe("feBlend");
    expect(result!.primitives[7].type).toBe("feBlend");
    const composite = result!.primitives[4];
    if (composite.type === "feComposite") {
      expect(composite.operator).toBe("out");
    }
    const blend = result!.primitives[6];
    if (blend.type === "feBlend") {
      expect(blend.mode).toBe("overlay");
      expect(blend.in2).toBe("BackgroundImageFix");
    }
  });

  it("resolves LINEAR_DODGE effect blend as Figma SVG plus-lighter", () => {
    const effects: Effect[] = [{
      type: "drop-shadow",
      offset: { x: 0, y: 2 },
      radius: 8,
      color: WHITE,
      blendMode: "plus-lighter",
      showShadowBehindNode: true,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    const blend = result!.primitives[5];
    expect(blend.type).toBe("feBlend");
    if (blend.type === "feBlend") {
      expect(blend.mode).toBe("plus-lighter");
      expect(blend.in2).toBe("BackgroundImageFix");
    }
  });

  it("resolves LINEAR_BURN effect blend as Figma SVG plus-darker", () => {
    const effects: Effect[] = [{
      type: "drop-shadow",
      offset: { x: 0, y: 2 },
      radius: 8,
      color: WHITE,
      blendMode: "plus-darker",
      showShadowBehindNode: true,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    const blend = result!.primitives[5];
    expect(blend.type).toBe("feBlend");
    if (blend.type === "feBlend") {
      expect(blend.mode).toBe("plus-darker");
      expect(blend.in2).toBe("BackgroundImageFix");
    }
  });

  it("does not composite-out a blended drop shadow when Kiwi keeps it behind the source", () => {
    const effects: Effect[] = [{
      type: "drop-shadow",
      offset: { x: 0, y: 0 },
      radius: 5,
      color: WHITE,
      blendMode: "plus-lighter",
      showShadowBehindNode: true,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    expect(result!.primitives).toHaveLength(7);
    expect(result!.primitives[4].type).toBe("feColorMatrix");
    expect(result!.primitives[5].type).toBe("feBlend");
    const blend = result!.primitives[5];
    if (blend.type === "feBlend") {
      expect(blend.mode).toBe("plus-lighter");
      expect(blend.in2).toBe("BackgroundImageFix");
    }
  });

  it("resolves SHARP drop shadow (radius=0) using Figma's hardAlpha-out recipe", () => {
    const effects: Effect[] = [{
      type: "drop-shadow",
      offset: { x: -1, y: 0 },
      radius: 0,
      color: BLACK_50,
      showShadowBehindNode: false,
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
    //   6. feBlend (composites tinted shadow over BackgroundImageFix).
    //   7. feBlend (composites SourceGraphic over that shadow).
    expect(result!.primitives).toHaveLength(8);
    expect(result!.primitives[0].type).toBe("feFlood");
    expect(result!.primitives[1].type).toBe("feColorMatrix");
    expect(result!.primitives[2].type).toBe("feOffset");
    // Critical: the offset's input MUST be the binarised hardAlpha,
    // not the anti-aliased SourceAlpha. Operating on SourceAlpha here
    // bakes the source's anti-aliased edge into the offset sliver, and
    // after feComposite "out" against hardAlpha the sliver retains the
    // 0.5..0.99 AA values instead of a clean 1.0.
    const offsetPrim = result!.primitives[2];
    if (offsetPrim.type === "feOffset") {
      expect(offsetPrim.in).toBe(result!.primitives[1].type === "feColorMatrix" ? result!.primitives[1].result : undefined);
    }
    expect(result!.primitives[3].type).toBe("feComposite");
    expect(result!.primitives[4].type).toBe("feFlood");
    expect(result!.primitives[5].type).toBe("feComposite");
    expect(result!.primitives[6].type).toBe("feBlend");
    expect(result!.primitives[7].type).toBe("feBlend");
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
    // Inner-shadow recipe mirrors Figma's SVG exporter:
    //   feFlood (transparent BackgroundImageFix)
    //   feBlend (SourceGraphic over BackgroundImageFix) → shape
    //   feColorMatrix (SourceAlpha → hardAlpha via 127x binarisation)
    //   feOffset (hardAlpha by dx,dy)
    //   feGaussianBlur
    //   feComposite arithmetic (hardAlpha - shifted blurred alpha) → band
    //   feColorMatrix (tint the band)
    //   feBlend (band over the composed foreground)
    expect(result!.primitives).toHaveLength(8);
    expect(result!.primitives[0].type).toBe("feFlood");
    expect(result!.primitives[1].type).toBe("feBlend");
    expect(result!.primitives[2].type).toBe("feColorMatrix");
    expect(result!.primitives[3].type).toBe("feOffset");
    expect(result!.primitives[4].type).toBe("feGaussianBlur");
    expect(result!.primitives[5].type).toBe("feComposite");
    expect(result!.primitives[6].type).toBe("feColorMatrix");
    expect(result!.primitives[7].type).toBe("feBlend");
    const shape = result!.primitives[1];
    if (shape.type === "feBlend") {
      expect(shape.in).toBe("SourceGraphic");
      expect(shape.in2).toBe("BackgroundImageFix");
    }
    const hardAlpha = result!.primitives[2];
    const offset = result!.primitives[3];
    if (hardAlpha.type === "feColorMatrix") {
      expect(hardAlpha.in).toBe("SourceAlpha");
    }
    if (offset.type === "feOffset") {
      expect(offset.in).toBe(hardAlpha.type === "feColorMatrix" ? hardAlpha.result : undefined);
    }
    const band = result!.primitives[5];
    if (band.type === "feComposite") {
      expect(band.operator).toBe("arithmetic");
      expect(band.k2).toBe(-1);
      expect(band.k3).toBe(1);
      expect(band.in2).toBe(hardAlpha.type === "feColorMatrix" ? hardAlpha.result : undefined);
    }
    const blend = result!.primitives[7];
    if (blend.type === "feBlend") {
      expect(blend.in2).toBe(shape.type === "feBlend" ? shape.result : undefined);
    }
  });

  it("expands inner-shadow filter bounds in the offset direction", () => {
    const effects: Effect[] = [{
      type: "inner-shadow",
      offset: { x: -1, y: 0 },
      radius: 0.5,
      color: BLACK_50,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids, { x: 10, y: 20, width: 30, height: 40 });

    expect(result?.filterBounds).toEqual({ x: 9.5, y: 20, width: 30.5, height: 40 });
  });

  it("unions mixed shadow filter bounds from drop-shadow and inner-shadow", () => {
    const effects: Effect[] = [
      {
        type: "inner-shadow",
        offset: { x: 0, y: -8 },
        radius: 16,
        color: BLACK_50,
      },
      {
        type: "drop-shadow",
        offset: { x: 0, y: 1 },
        radius: 2,
        color: BLACK_50,
        showShadowBehindNode: false,
      },
    ];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids, { x: 0, y: 0, width: 10, height: 10 });

    expect(result?.filterBounds).toEqual({ x: -2, y: -16, width: 14, height: 29 });
  });

  // Regression: Windows 98-style 3D beveled buttons stack four
  // INNER_SHADOWs (top-left highlight + secondary highlight, plus
  // bottom-right shadow + secondary shadow). Each band must blend
  // over the previously composed foreground in declaration order.
  it("stacks multiple inner shadows as sequential foreground blends", () => {
    const effects: Effect[] = [
      { type: "inner-shadow", offset: { x: 2, y: 2 }, radius: 0, color: { r: 0.85, g: 0.85, b: 0.85, a: 1 } },
      { type: "inner-shadow", offset: { x: -2, y: -2 }, radius: 0, color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } },
      { type: "inner-shadow", offset: { x: 1, y: 1 }, radius: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
      { type: "inner-shadow", offset: { x: -1, y: -1 }, radius: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    ];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    // BackgroundImageFix + shape, then 4 shadows x 5 band
    // primitives each + 4 foreground blends.
    expect(result!.primitives).toHaveLength(2 + 4 * 5 + 4);
    const last = result!.primitives[result!.primitives.length - 1];
    expect(last.type).toBe("feBlend");
    const blends = result!.primitives.filter((primitive) => {
      if (primitive.type !== "feBlend") {
        return false;
      }
      return primitive.result?.startsWith("inner-shadow-") === true;
    });
    expect(blends).toHaveLength(4);
    const firstBlend = blends[0];
    if (firstBlend.type === "feBlend") {
      expect(firstBlend.in2).toMatch(/^shape-/);
    }
    for (const blend of blends) {
      if (blend.type === "feBlend") {
        expect(blend.result).toMatch(/^inner-shadow-/);
      }
    }
  });

  // Regression guard for the spread branch of the inner-shadow
  // recipe. Figma's SVG exporter applies positive inset shadow spread
  // as an erode of SourceAlpha before the offset/blur chain; this
  // widens the inner band after `hardAlpha - blurred(erodedAlpha)`.
  it("inner-shadow with positive spread inserts an feMorphology erode", () => {
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
    //   feFlood → feBlend(shape) → feColorMatrix → feOffset →
    //   feMorphology(dilate) → feGaussianBlur →
    //   feComposite arithmetic → feColorMatrix → feBlend
    expect(result!.primitives).toHaveLength(9);
    expect(result!.primitives[0].type).toBe("feFlood");
    expect(result!.primitives[1].type).toBe("feBlend");
    expect(result!.primitives[2].type).toBe("feColorMatrix");
    expect(result!.primitives[3].type).toBe("feMorphology");
    expect(result!.primitives[4].type).toBe("feOffset");
    expect(result!.primitives[5].type).toBe("feGaussianBlur");
    const morphology = result!.primitives[3];
    if (morphology.type === "feMorphology") {
      expect(morphology.in).toBe("SourceAlpha");
      expect(morphology.operator).toBe("erode");
      expect(morphology.radius).toBe(3);
    }
    const offset = result!.primitives[4];
    if (offset.type === "feOffset") {
      expect(offset.in).toBe(morphology.type === "feMorphology" ? morphology.result : undefined);
    }
  });

  // Regression guard for negative spread. It is the inverse branch of
  // Figma's inset-shadow spread semantics and must dilate SourceAlpha.
  it("inner-shadow with negative spread inserts an feMorphology dilate", () => {
    const effects: Effect[] = [{
      type: "inner-shadow",
      offset: { x: 0, y: 2 },
      radius: 4,
      spread: -2,
      color: BLACK_50,
    }];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);
    const morphology = result!.primitives[3];
    expect(morphology.type).toBe("feMorphology");
    if (morphology.type === "feMorphology") {
      expect(morphology.in).toBe("SourceAlpha");
      expect(morphology.operator).toBe("dilate");
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
    const blur = result!.primitives[4];
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
    expect(result!.primitives).toHaveLength(8);
    const blend = result!.primitives[7];
    expect(blend.type).toBe("feBlend");
    if (blend.type === "feBlend") {
      expect(blend.mode).toBe("soft-light");
      expect(blend.in2).toMatch(/^shape-/);
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
    expect(result!.primitives).toHaveLength(3);
    expect(result!.primitives[0]).toEqual({ type: "feFlood", floodOpacity: 0, result: "BackgroundImageFix" });
    expect(result!.primitives[1].type).toBe("feBlend");
    expect(result!.primitives[2].type).toBe("feGaussianBlur");
  });

  it("expands foreground blur filter region by co-authored background blur radius", () => {
    const effects: Effect[] = [
      {
        type: "background-blur",
        radius: 40,
      },
      {
        type: "layer-blur",
        radius: 20,
      },
    ];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids, { x: 0, y: 0, width: 290, height: 62 });

    expect(result?.filterBounds).toEqual({ x: -40, y: -40, width: 370, height: 142 });
    expect(result?.primitives).toHaveLength(3);
    expect(result?.primitives[0]).toEqual({ type: "feFlood", floodOpacity: 0, result: "BackgroundImageFix" });
    expect(result?.primitives[1].type).toBe("feBlend");
    expect(result?.primitives[2]).toEqual({
      type: "feGaussianBlur",
      in: "shape-0",
      stdDeviation: 10,
    });
  });

  it("unions foreground blur bounds from source bounds, not accumulated inner-shadow bounds", () => {
    const effects: Effect[] = [
      {
        type: "inner-shadow",
        offset: { x: -1, y: 0 },
        radius: 0.5,
        color: BLACK_50,
      },
      {
        type: "inner-shadow",
        offset: { x: 2, y: 0 },
        radius: 2,
        color: BLACK_50,
      },
      {
        type: "layer-blur",
        radius: 4,
      },
    ];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids, { x: 0, y: 0, width: 5, height: 107 });

    expect(result?.filterBounds).toEqual({ x: -4, y: -4, width: 13, height: 115 });
  });

  it("applies foreground blur to the composed shadow result", () => {
    const effects: Effect[] = [
      {
        type: "inner-shadow",
        offset: { x: 0.2, y: 0 },
        radius: 0.2,
        color: { r: 0.65, g: 0.65, b: 0.63, a: 1 },
      },
      {
        type: "inner-shadow",
        offset: { x: -0.2, y: 0 },
        radius: 0.2,
        color: BLACK_50,
      },
      {
        type: "layer-blur",
        radius: 0.803652,
      },
    ];
    const ids = createIdGenerator();
    const result = resolveEffects(effects, ids);

    expect(result).toBeDefined();
    const primitives = result!.primitives;
    const composed = primitives[primitives.length - 2];
    const blur = primitives[primitives.length - 1];
    expect(composed.type).toBe("feBlend");
    expect(blur.type).toBe("feGaussianBlur");
    if (composed.type === "feBlend") {
      expect(composed.result).toMatch(/^inner-shadow-/);
    }
    if (blur.type === "feGaussianBlur") {
      expect(blur.in).toBe(composed.type === "feBlend" ? composed.result : undefined);
      expect(blur.stdDeviation).toBeCloseTo(0.401826);
    }
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
    expect(contourToSvgD(contour)).toBe("M0 0H100V100Z");
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

  it("serializes Figma contours closed by returning to the subpath start with Z", () => {
    const contour: PathContour = {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 10, y: 0 },
        { type: "L", x: 10, y: 10 },
        { type: "L", x: 0, y: 10 },
        { type: "L", x: 0, y: 0 },
      ],
      windingRule: "nonzero",
    };
    expect(contourToSvgD(contour)).toBe("M0 0H10V10H0V0Z");
  });

  it("serializes every implicitly closed Figma subpath with Z", () => {
    const contour: PathContour = {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 10, y: 0 },
        { type: "L", x: 0, y: 0 },
        { type: "M", x: 20, y: 20 },
        { type: "L", x: 30, y: 20 },
        { type: "L", x: 20, y: 20 },
      ],
      windingRule: "nonzero",
    };
    expect(contourToSvgD(contour)).toBe("M0 0H10H0ZM20 20H30H20Z");
  });
});
