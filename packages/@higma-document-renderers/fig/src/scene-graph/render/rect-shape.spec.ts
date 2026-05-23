/** @file Tests for shared rectangle SVG primitive resolution. */

import { buildRoundedRectPathD, buildSmoothedRoundedRectPathD } from "@higma-primitives/path";
import {
  resolveLayeredRectShapePrimitive,
  resolvePathBackedRectShapePrimitive,
  resolvePathContourRectPrimitive,
  resolveRectShapePrimitive,
} from "./rect-shape";

describe("rect-shape primitive resolution", () => {
  it("emits uniform rounded rectangles as native rect primitives", () => {
    expect(resolveRectShapePrimitive(100, 80, 12)).toEqual({
      kind: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      rx: 12,
    });
  });

  it("keeps smoothed and per-corner rectangles as path primitives", () => {
    expect(resolveRectShapePrimitive(100, 80, 12, 0.6).kind).toBe("path");
    expect(resolveRectShapePrimitive(100, 80, [0, 12, 0, 0]).kind).toBe("path");
  });

  it("emits rounded stacked paint layers as path primitives", () => {
    const primitive = resolveLayeredRectShapePrimitive(226, 48, 24);

    expect(primitive).toEqual({
      kind: "path",
      d: buildRoundedRectPathD(226, 48, [24, 24, 24, 24]),
    });
  });

  it("keeps sharp stacked paint layers as native rect primitives", () => {
    expect(resolveLayeredRectShapePrimitive(100, 80, undefined)).toEqual({
      kind: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
  });

  it("emits rounded effect source rectangles as path primitives", () => {
    const primitive = resolvePathBackedRectShapePrimitive(290, 62, 31);

    expect(primitive).toEqual({
      kind: "path",
      d: buildRoundedRectPathD(290, 62, [31, 31, 31, 31]),
    });
  });

  it("recognises closed axis-aligned contour paths as rect primitives", () => {
    expect(resolvePathContourRectPrimitive({ d: "M0 0L20 0L20 10L0 10Z" })).toEqual({
      kind: "rect",
      x: 0,
      y: 0,
      width: 20,
      height: 10,
    });
  });

  it("recognises baked rounded-rectangle contour paths as rect rx primitives", () => {
    const primitive = resolvePathContourRectPrimitive(
      {
        d: "M0 23.51C0 10.526 10.526 0 23.51 0L142.299 0C155.283 0 165.809 10.526 165.809 23.51L165.809 336.979C165.809 349.965 155.283 360.485 142.299 360.485L23.51 360.485C10.526 360.485 0 349.965 0 336.98L0 23.51",
      },
      { width: 165.8087615966797, height: 360.4897155761719 },
    );

    expect(primitive).toEqual({
      kind: "rect",
      x: 0,
      y: 0,
      width: 165.8087615966797,
      height: 360.4897155761719,
      rx: 23.51,
    });
  });

  it("recognises top-edge-started rounded rectangle stroke contours as rect rx primitives", () => {
    expect(resolvePathContourRectPrimitive({
      d: "M3 1H16C17.104568 1 18 1.895431 18 3V21C18 22.104568 17.104568 23 16 23H3C1.895431 23 1 22.104568 1 21V3C1 1.895431 1.895431 1 3 1Z",
    })).toEqual({
      kind: "rect",
      x: 1,
      y: 1,
      width: 17,
      height: 22,
      rx: 2,
    });
  });

  it("does not collapse evenodd or smoothed contour paths", () => {
    const smoothed = buildSmoothedRoundedRectPathD(100, 80, [20, 20, 20, 20], 0.6);

    expect(resolvePathContourRectPrimitive({ d: "M0 0L20 0L20 10L0 10Z", fillRule: "evenodd" })).toBeUndefined();
    expect(resolvePathContourRectPrimitive({ d: smoothed })).toBeUndefined();
  });
});
