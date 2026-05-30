/**
 * @file Regression pin for Figma Crop → CSS background mapping.
 *
 * Figma's binary `imageScaleMode` enum only declares STRETCH / FIT /
 * FILL / TILE — there is no `CROP` value. When the editor's Crop tool
 * is used, Figma serialises the result as STRETCH plus a non-identity
 * `paint.transform` describing the visible sub-rectangle. The renderer
 * SoT (`@higma-document-renderers/fig/scene-graph/convert/fill.ts:
 * resolveImageScaleMode`) honours this convention. fig-to-web must
 * mirror it so the web (React) emission shows the same cropped image
 * as the authoritative Figma SVG render — instead of silently flatten-
 * ing it back to a full STRETCH that distorts the source.
 */
import type { FigImagePaint, FigPaint } from "@higma-document-models/fig/types";
import type { TokenIndex } from "../../tokens";
import { imageElementForNode, paintsToBackgroundStyle } from "./paint";

function makeTokenIndex(): TokenIndex {
  return {
    colorIdForPaints: () => undefined,
    spacingIdFor: () => undefined,
    radiusIdFor: () => undefined,
    shadowIdFor: () => undefined,
    typographyIdFor: () => undefined,
  };
}

function imagePaint(transform: FigImagePaint["transform"] | undefined): FigPaint {
  const paint: FigImagePaint = {
    type: { value: 5, name: "IMAGE" },
    opacity: 1,
    visible: true,
    blendMode: { value: 1, name: "NORMAL" },
    image: { hash: [0], name: "image" },
    imageScaleMode: { value: 0, name: "STRETCH" },
    transform,
  } as FigImagePaint;
  return paint as FigPaint;
}

function pinResolver(): (paint: FigImagePaint) => string {
  return () => "/assets/test.png";
}

describe("paintsToBackgroundStyle — Figma Crop on STRETCH paint", () => {
  it("translates an axis-aligned crop transform into pixel backgroundSize and backgroundPosition", () => {
    // image 12 from the user-reported Blog page > Group 234 case:
    // 63x63 node, paint.transform = (0.8, 0; 0, 0.6179; 0.1746, 0.04604).
    // Figma's paint.transform maps fill-unit coords back to image-unit
    // coords (cf. inv(paintTransform) baked into the SVG renderer's
    // pattern `<use>`), so the image is rendered LARGER than the node
    // and the node displays only a sub-rectangle.
    const paint = imagePaint({
      m00: 0.8,
      m01: 0,
      m02: 0.1746,
      m10: 0,
      m11: 0.6179,
      m12: 0.04604,
    });
    const style = paintsToBackgroundStyle(
      [paint],
      makeTokenIndex(),
      pinResolver(),
      { width: 63, height: 63 },
    );
    expect(style.backgroundImage).toBe("url('/assets/test.png')");
    // size = (W / m00, H / m11) = (78.75, 101.96)
    expect(style.backgroundSize).toBe("78.75px 101.96px");
    // position = (-m02·W/m00, -m12·H/m11) = (-13.75, -4.69)
    expect(style.backgroundPosition).toBe("-13.75px -4.69px");
    expect(style.backgroundRepeat).toBe("no-repeat");
  });

  it("keeps the legacy STRETCH 100%×100% emission when the paint transform is identity", () => {
    const paint = imagePaint({ m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 });
    const style = paintsToBackgroundStyle(
      [paint],
      makeTokenIndex(),
      pinResolver(),
      { width: 100, height: 100 },
    );
    expect(style.backgroundSize).toBe("100% 100%");
    expect(style.backgroundPosition).toBeUndefined();
  });

  it("keeps the legacy STRETCH 100%×100% emission when the paint transform is absent", () => {
    const paint = imagePaint(undefined);
    const style = paintsToBackgroundStyle(
      [paint],
      makeTokenIndex(),
      pinResolver(),
      { width: 100, height: 100 },
    );
    expect(style.backgroundSize).toBe("100% 100%");
    expect(style.backgroundPosition).toBeUndefined();
  });

  it("throws when an axis-aligned crop transform is paired with no usable node size", () => {
    // A node carrying an image-cropped paint must have positive
    // pixel dimensions for the unit-space transform to land somewhere
    // on screen. Silently degrading to STRETCH 100% would hide the
    // contradiction in the source file; fail-fast surfaces it at emit
    // time instead.
    const paint = imagePaint({ m00: 0.5, m01: 0, m02: 0.25, m10: 0, m11: 0.5, m12: 0.25 });
    expect(() => paintsToBackgroundStyle([paint], makeTokenIndex(), pinResolver(), undefined)).toThrow(
      /positive node size/,
    );
  });
});

describe("paintsToBackgroundStyle — rotation / skew routes to structural emit", () => {
  it("drops the image from the background layer stack when the paint transform carries rotation", () => {
    // `background-image` + `-size` + `-position` cannot rotate an
    // image. Rather than emit a degraded, half-correct shorthand the
    // emitter omits the image layer entirely here; the JSX emitter
    // picks up the same paint via `imageElementForNode` and inserts a
    // structural `<img>` child instead.
    const paint = imagePaint({ m00: 0.7, m01: 0.3, m02: 0, m10: -0.3, m11: 0.7, m12: 0 });
    const style = paintsToBackgroundStyle(
      [paint],
      makeTokenIndex(),
      pinResolver(),
      { width: 100, height: 100 },
    );
    expect(style.backgroundImage).toBeUndefined();
    expect(style.backgroundSize).toBeUndefined();
    expect(style.backgroundPosition).toBeUndefined();
  });
});

describe("imageElementForNode — structural <img> emission for rotation / skew", () => {
  it("returns img-element data with a CSS matrix transform for a rotated paint", () => {
    // A pure +30° rotation: m00 = cos30 ≈ 0.866, m01 = -sin30 = -0.5,
    // m10 = sin30 = 0.5, m11 = cos30. det = m00·m11 - m01·m10 = 1.
    const cos30 = Math.cos(Math.PI / 6);
    const sin30 = Math.sin(Math.PI / 6);
    const paint = imagePaint({ m00: cos30, m01: -sin30, m02: 0, m10: sin30, m11: cos30, m12: 0 });
    const emission = imageElementForNode([paint], pinResolver(), { width: 100, height: 100 });
    expect(emission).toBeDefined();
    if (emission === undefined) {
      throw new Error("expected structural emission for a rotated image paint");
    }
    expect(emission.src).toBe("/assets/test.png");
    expect(emission.imgStyle.position).toBe("absolute");
    expect(emission.imgStyle.left).toBe("0px");
    expect(emission.imgStyle.top).toBe("0px");
    expect(emission.imgStyle.width).toBe("100px");
    expect(emission.imgStyle.height).toBe("100px");
    expect(emission.imgStyle.transformOrigin).toBe("0 0");
    // inv(T) for a rotation by 30° equals rotation by -30°: M_a = cos30,
    // M_b = -sin30·H/W = -sin30, M_c = sin30·W/H = sin30, M_d = cos30.
    // With W = H and a zero translation, M_tx = M_ty = 0.
    const transform = emission.imgStyle.transform;
    expect(transform).toMatch(/^matrix\(/);
    const args = transform.replace(/^matrix\(/, "").replace(/\)$/, "").split(",").map((s) => Number(s.trim()));
    expect(args).toHaveLength(6);
    expect(args[0]).toBeCloseTo(cos30, 6);
    expect(args[1]).toBeCloseTo(-sin30, 6);
    expect(args[2]).toBeCloseTo(sin30, 6);
    expect(args[3]).toBeCloseTo(cos30, 6);
    expect(args[4]).toBeCloseTo(0, 6);
    expect(args[5]).toBeCloseTo(0, 6);
  });

  it("returns undefined for axis-aligned crops (those still take the background-image path)", () => {
    const paint = imagePaint({ m00: 0.8, m01: 0, m02: 0.1, m10: 0, m11: 0.6, m12: 0.05 });
    expect(imageElementForNode([paint], pinResolver(), { width: 100, height: 100 })).toBeUndefined();
  });

  it("returns undefined when no image paint is present", () => {
    expect(imageElementForNode([], pinResolver(), { width: 100, height: 100 })).toBeUndefined();
    expect(imageElementForNode(undefined, pinResolver(), { width: 100, height: 100 })).toBeUndefined();
  });

  it("returns undefined for an identity transform (no rotation, no crop)", () => {
    const paint = imagePaint({ m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 });
    expect(imageElementForNode([paint], pinResolver(), { width: 100, height: 100 })).toBeUndefined();
  });
});
