/** @file Tests for Kiwi paint editing operations. */

import { PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigPaint } from "@higma-document-models/fig/types";
import { figColorToHex, firstSolidPaint, hexToFigColor, solidPaint } from "./paint-domain";

const solid: FigPaint = {
  type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
  color: { r: 0.2, g: 0.4, b: 0.6, a: 0.8 },
  opacity: 0.5,
  visible: true,
};

const image: FigPaint = {
  type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
  image: { hash: [1, 2, 3] },
};

describe("paint-domain", () => {
  it("converts between Fig colors and CSS hex without inventing alpha", () => {
    expect(figColorToHex({ r: 0.2, g: 0.4, b: 0.6, a: 0.25 })).toBe("#336699");
    expect(hexToFigColor("#336699", 0.25)).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 0.25 });
  });

  it("reads the first solid paint through Kiwi enum narrowing", () => {
    expect(firstSolidPaint([image, solid])).toBe(solid);
  });

  it("creates a Kiwi solid paint while preserving existing paint fields", () => {
    expect(solidPaint({ r: 1, g: 0, b: 0, a: 0.8 }, firstSolidPaint([solid]))).toEqual({
      type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
      color: { r: 1, g: 0, b: 0, a: 0.8 },
      opacity: 0.5,
      visible: true,
    });
  });
});
