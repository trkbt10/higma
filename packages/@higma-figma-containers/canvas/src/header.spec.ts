/**
 * @file Tests for raw fig-family canvas headers
 */

import {
  buildFigCanvasFile,
  buildFigCanvasHeader,
  getFigCanvasPayload,
  isFigCanvas,
  parseFigCanvasHeader,
} from "./header";

describe("fig canvas header", () => {
  it("parses adjacent raw canvas magic values", () => {
    const header = buildFigCanvasHeader(42, "j", "fig-site");
    expect(isFigCanvas(header)).toBe(true);
    expect(parseFigCanvasHeader(header)).toEqual({
      magic: "fig-site",
      version: "j",
      payloadSize: 42,
    });
  });

  it("builds raw canvas files with payload bytes", () => {
    const payload = new Uint8Array([1, 2, 3]);
    const file = buildFigCanvasFile(payload, "e", "fig-buzz");
    expect(parseFigCanvasHeader(file).magic).toBe("fig-buzz");
    expect(getFigCanvasPayload(file)).toEqual(payload);
  });
});
