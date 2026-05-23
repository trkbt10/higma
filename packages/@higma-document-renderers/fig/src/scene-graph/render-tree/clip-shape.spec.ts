/** @file Tests for RenderTree clip shape resolution. */

import { buildClipShape } from "./clip-shape";

describe("buildClipShape", () => {
  it("uses native rect clips for unsmoothed uniform rounded rectangles", () => {
    expect(buildClipShape(20, 20, 10)).toEqual({
      kind: "rect",
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      rx: 10,
    });
  });

  it("keeps smoothed and per-corner rounded clips as paths", () => {
    expect(buildClipShape(20, 20, 10, 0.6).kind).toBe("path");
    expect(buildClipShape(20, 20, [0, 10, 0, 0]).kind).toBe("path");
  });
});
