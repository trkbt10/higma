/**
 * @file Round-trip tests for the paint boundary codec.
 */
import { figPaintToIR, irPaintToFig } from "./paint";
import { asGradientPaint, asImagePaint, asSolidPaint, getPaintType } from "@higma-document-models/fig/color";
import { PAINT_TYPE_VALUES, SCALE_MODE_VALUES } from "@higma-document-models/fig/constants";

describe("paint boundary codec round-trip", () => {
  it("round-trips a solid", () => {
    const ir = figPaintToIR({
      type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
      color: { r: 0.5, g: 0.25, b: 0.75, a: 0.5 },
    });
    expect(ir.kind).toBe("solid");
    if (ir.kind !== "solid") {
      throw new Error("not a solid");
    }
    expect(ir.color).toEqual({ r: 0.5, g: 0.25, b: 0.75, a: 0.5 });
    const back = irPaintToFig(ir);
    expect(getPaintType(back)).toBe("SOLID");
    const solid = asSolidPaint(back);
    if (solid === undefined) {
      throw new Error("not solid");
    }
    expect(solid.color).toEqual({ r: 0.5, g: 0.25, b: 0.75, a: 0.5 });
  });

  it("round-trips a horizontal linear gradient", () => {
    const ir = figPaintToIR({
      type: { value: PAINT_TYPE_VALUES.GRADIENT_LINEAR, name: "GRADIENT_LINEAR" },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      stops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
    });
    expect(ir.kind).toBe("linear-gradient");
    if (ir.kind !== "linear-gradient") {
      throw new Error();
    }
    // Left → right is CSS 90deg.
    expect(ir.angle).toBeCloseTo(90, 5);
    expect(ir.stops).toHaveLength(2);

    const back = irPaintToFig(ir);
    expect(getPaintType(back)).toBe("GRADIENT_LINEAR");
    const gradient = asGradientPaint(back);
    if (gradient === undefined) {
      throw new Error();
    }
    expect(gradient.stops).toHaveLength(2);
    expect(gradient.transform?.m00).toBeCloseTo(1);
    expect(gradient.transform?.m01).toBeCloseTo(0);
  });

  it("round-trips an image fill", () => {
    const ir = figPaintToIR({
      type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
      image: { hash: [0xab, 0xc1, 0x23] },
      imageScaleMode: { value: SCALE_MODE_VALUES.FILL, name: "FILL" },
    });
    expect(ir.kind).toBe("image");
    if (ir.kind !== "image") {
      throw new Error();
    }
    expect(ir.imageId).toBe("abc123");
    expect(ir.scaleMode).toBe("cover");
    const back = irPaintToFig(ir);
    expect(getPaintType(back)).toBe("IMAGE");
    const image = asImagePaint(back);
    if (image === undefined) {
      throw new Error();
    }
    expect(image.image?.hash).toEqual([0xab, 0xc1, 0x23]);
    expect(image.imageScaleMode).toMatchObject({ name: "FILL" });
  });

  it("rejects radial gradient (not in bridge)", () => {
    expect(() =>
      figPaintToIR({
        type: { value: PAINT_TYPE_VALUES.GRADIENT_RADIAL, name: "GRADIENT_RADIAL" },
        transform: { m00: 0.5, m02: 0.5, m12: 0.5 },
        stops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }],
      }),
    ).toThrow(/not part of the bridge IR/);
  });
});
