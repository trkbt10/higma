/**
 * @file Round-trip tests for paint adapter.
 */
import { figPaintToIR, irPaintToFig } from "./paint";

describe("paint adapter round-trip", () => {
  it("round-trips a solid", () => {
    const ir = figPaintToIR({
      type: "SOLID",
      color: { r: 0.5, g: 0.25, b: 0.75, a: 0.5 },
    });
    expect(ir.kind).toBe("solid");
    if (ir.kind !== "solid") {
      throw new Error("not a solid");
    }
    expect(ir.color).toEqual({ r: 0.5, g: 0.25, b: 0.75, a: 0.5 });
    const back = irPaintToFig(ir);
    expect(back.type).toBe("SOLID");
    if (back.type !== "SOLID") {
      throw new Error("not solid");
    }
    expect(back.color).toEqual({ r: 0.5, g: 0.25, b: 0.75, a: 0.5 });
  });

  it("round-trips a horizontal linear gradient", () => {
    const ir = figPaintToIR({
      type: "GRADIENT_LINEAR",
      gradientHandlePositions: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
        { x: 0, y: 1 },
      ],
      gradientStops: [
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
    expect(back.type).toBe("GRADIENT_LINEAR");
    if (back.type !== "GRADIENT_LINEAR") {
      throw new Error();
    }
    const handles = back.gradientHandlePositions!;
    // Reconstructed handles should still describe a left-to-right axis
    // (handle[1].x > handle[0].x, both y values equal).
    expect(handles[1]!.x).toBeGreaterThan(handles[0]!.x);
    expect(handles[0]!.y).toBeCloseTo(handles[1]!.y, 5);
  });

  it("round-trips an image fill", () => {
    const ir = figPaintToIR({
      type: "IMAGE",
      imageRef: "abc123",
      scaleMode: "FILL",
    });
    expect(ir.kind).toBe("image");
    if (ir.kind !== "image") {
      throw new Error();
    }
    expect(ir.imageId).toBe("abc123");
    expect(ir.scaleMode).toBe("cover");
    const back = irPaintToFig(ir);
    expect(back.type).toBe("IMAGE");
    if (back.type !== "IMAGE") {
      throw new Error();
    }
    expect(back.imageRef).toBe("abc123");
    expect(back.scaleMode).toBe("FILL");
  });

  it("rejects radial gradient (not in bridge)", () => {
    expect(() =>
      figPaintToIR({
        type: "GRADIENT_RADIAL",
        gradientHandlePositions: [
          { x: 0.5, y: 0.5 },
          { x: 1, y: 0.5 },
        ],
        gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }],
      }),
    ).toThrow(/not part of the bridge IR/);
  });
});
