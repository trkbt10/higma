/**
 * @file Fill conversion tests
 *
 * Verifies that the scene graph fill conversion correctly handles
 * Kiwi paint payloads.
 */

import { convertPaintToFill, convertPaintsToFills } from "./fill";
import type {
  FigImagePaint,
  FigSolidPaint,
  FigGradientPaint,
} from "@higma-document-models/fig/types";
import { getPaintType } from "@higma-document-models/fig/color";
import type { FigPackageImage } from "@higma-figma-containers/package";
import { BLEND_MODE_VALUES, PAINT_TYPE_VALUES, SCALE_MODE_VALUES } from "@higma-document-models/fig/constants";

const NO_IMAGES: ReadonlyMap<string, FigPackageImage> = new Map();

function isObject(value: unknown): value is { readonly type: unknown } {
  return typeof value === "object" && value !== null && "type" in value;
}

function isRawImagePaint(value: unknown): value is FigImagePaint {
  if (!isObject(value)) {
    return false;
  }
  return getPaintType(value) === "IMAGE";
}

describe("convertPaintToFill", () => {
  describe("solid paint", () => {
    it("converts SOLID paint", () => {
      const paint: FigSolidPaint = {
        type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
        color: { r: 0, g: 0.5, b: 1, a: 1 },
        opacity: 0.8,
        visible: true,
      };
      const fill = convertPaintToFill(paint, NO_IMAGES);
      expect(fill).toEqual({
        type: "solid",
        color: { r: 0, g: 0.5, b: 1, a: 1 },
        opacity: 0.8,
      });
    });
  });

  describe("linear gradient", () => {
    it("converts Kiwi linear gradient", () => {
      const paint: FigGradientPaint = {
        type: { value: PAINT_TYPE_VALUES.GRADIENT_LINEAR, name: "GRADIENT_LINEAR" },
        opacity: 1,
        visible: true,
        blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
        stops: [
          { color: { r: 0.24, g: 0.47, b: 0.85, a: 1 }, position: 0 },
          { color: { r: 0.55, g: 0.30, b: 0.85, a: 1 }, position: 1 },
        ],
        transform: { m00: 0.5, m01: 0, m02: 0.5, m10: 0, m11: 1, m12: 0 },
      };

      const fill = convertPaintToFill(paint, NO_IMAGES);
      expect(fill).not.toBeNull();
      expect(fill!.type).toBe("linear-gradient");
      if (fill!.type === "linear-gradient") {
        expect(fill!.stops).toHaveLength(2);
        expect(fill!.stops[0].color).toEqual({ r: 0.24, g: 0.47, b: 0.85, a: 1 });
        expect(fill!.stops[1].color).toEqual({ r: 0.55, g: 0.30, b: 0.85, a: 1 });
        expect(typeof fill!.start.x).toBe("number");
        expect(typeof fill!.end.x).toBe("number");
      }
    });
  });

  describe("radial gradient", () => {
    it("converts Kiwi radial gradient", () => {
      const paint: FigGradientPaint = {
        type: { value: PAINT_TYPE_VALUES.GRADIENT_RADIAL, name: "GRADIENT_RADIAL" },
        opacity: 1,
        visible: true,
        blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
        stops: [
          { color: { r: 0.95, g: 0.55, b: 0.15, a: 1 }, position: 0 },
          { color: { r: 0.90, g: 0.25, b: 0.25, a: 1 }, position: 1 },
        ],
        transform: { m00: 0.5, m01: 0, m02: 0.5, m10: 0, m11: 0.5, m12: 0.5 },
      };

      const fill = convertPaintToFill(paint, NO_IMAGES);
      expect(fill).not.toBeNull();
      expect(fill!.type).toBe("radial-gradient");
      if (fill!.type === "radial-gradient") {
        expect(fill!.stops).toHaveLength(2);
        expect(fill!.center.x).toBe(0.5);
        expect(fill!.center.y).toBe(0.5);
        expect(fill!.radius).toBe(0.5);
      }
    });
  });

  describe("invisible paints", () => {
    it("skips paints with visible=false", () => {
      const hidden: FigSolidPaint = { type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" }, color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: false };
      const visible: FigSolidPaint = { type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" }, color: { r: 0, g: 1, b: 0, a: 1 }, opacity: 1, visible: true };
      const fills = convertPaintsToFills([hidden, visible], NO_IMAGES);
      expect(fills).toHaveLength(1);
      expect(fills[0].type).toBe("solid");
      if (fills[0].type === "solid") {
        expect(fills[0].color.g).toBe(1);
      }
    });
  });

  describe("image paint", () => {
    it("preserves Kiwi image transform and TILE scale", () => {
      const image = { ref: "abcdef", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
      const images: ReadonlyMap<string, FigPackageImage> = new Map([["abcdef", image]]);
      const paint: FigImagePaint = {
        type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
        image: { hash: [0xab, 0xcd, 0xef] },
        imageScaleMode: { value: SCALE_MODE_VALUES.TILE, name: "TILE" },
        scale: 0.5,
        transform: { m00: 0.5, m01: 0, m02: 0.25, m10: 0, m11: 0.5, m12: 0.25 },
      };

      const fill = convertPaintToFill(paint, images);

      expect(fill).toEqual({
        type: "image",
        imageHash: "abcdef",
        data: image.data,
        mimeType: "image/png",
        scaleMode: "TILE",
        opacity: 1,
        scalingFactor: 0.5,
        imageTransform: { m00: 0.5, m01: 0, m02: 0.25, m10: 0, m11: 0.5, m12: 0.25 },
      });
    });

    it("preserves paintFilter and explicit color management", () => {
      const image = { ref: "abcdef", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
      const images: ReadonlyMap<string, FigPackageImage> = new Map([["abcdef", image]]);
      const paint: FigImagePaint = {
        type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
        image: { hash: [0xab, 0xcd, 0xef] },
        imageScaleMode: { value: SCALE_MODE_VALUES.FILL, name: "FILL" },
        paintFilter: { highlights: -0.98 },
        imageShouldColorManage: true,
      };

      const fill = convertPaintToFill(paint, images);

      expect(fill).toMatchObject({
        type: "image",
        paintFilter: { highlights: -0.98 },
        imageShouldColorManage: true,
      });
    });

    it("normalises STRETCH + non-identity transform to CROP (wire-format spelling of Figma's Crop mode)", () => {
      const image = { ref: "abcdef", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
      const images: ReadonlyMap<string, FigPackageImage> = new Map([["abcdef", image]]);
      // Figma's binary ImageScaleMode enum has no CROP value: when the user
      // picks "Crop" in the editor, the wire-level scaleMode stays STRETCH
      // and the user's crop rectangle is written into paint.transform. The
      // convert layer must reconcile this so the renderers see scaleMode
      // "CROP" and honour the transform instead of plain-stretching.
      const paint: FigImagePaint = {
        type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
        image: { hash: [0xab, 0xcd, 0xef] },
        imageScaleMode: { value: SCALE_MODE_VALUES.STRETCH, name: "STRETCH" },
        transform: { m00: 2.143, m01: 0, m02: -1.063, m10: 0, m11: 0.658, m12: 0.046 },
      };

      const fill = convertPaintToFill(paint, images);

      expect(fill).toMatchObject({
        type: "image",
        scaleMode: "CROP",
        imageTransform: { m00: 2.143, m01: 0, m02: -1.063, m10: 0, m11: 0.658, m12: 0.046 },
      });
    });

    it("leaves STRETCH with an identity transform untouched", () => {
      const image = { ref: "abcdef", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
      const images: ReadonlyMap<string, FigPackageImage> = new Map([["abcdef", image]]);
      const paint: FigImagePaint = {
        type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
        image: { hash: [0xab, 0xcd, 0xef] },
        imageScaleMode: { value: SCALE_MODE_VALUES.STRETCH, name: "STRETCH" },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      };

      const fill = convertPaintToFill(paint, images);

      expect(fill).toMatchObject({ type: "image", scaleMode: "STRETCH" });
    });

    it("converts decoded Kiwi enum image paints", () => {
      const image = { ref: "abcdef", data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
      const images: ReadonlyMap<string, FigPackageImage> = new Map([["abcdef", image]]);
      const raw = {
        type: { value: 5, name: "IMAGE" },
        image: { hash: [0xab, 0xcd, 0xef] },
        imageScaleMode: { value: 1, name: "FILL" },
        scale: 0.5,
      };
      if (!isRawImagePaint(raw)) {
        throw new Error("test fixture must be a raw IMAGE paint");
      }

      const fill = convertPaintToFill(raw, images);

      expect(fill).toMatchObject({
        type: "image",
        imageHash: "abcdef",
        scaleMode: "FILL",
        scalingFactor: 0.5,
      });
    });
  });
});
