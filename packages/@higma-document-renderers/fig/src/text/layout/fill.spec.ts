/**
 * @file Unit spec for the fill functions in `fill.ts`.
 *
 * `getFillColorAndOpacity` returns the first visible SOLID paint as a
 * single flat colour. `getAllVisibleSolidFills` returns the entire
 * stack of visible SOLID paints in source order, which the glyph-mode
 * renderer needs to reproduce Figma's painter's-algorithm composite for
 * multi-fill text (e.g. the App Store template's Event metadata text
 * which stacks `[{black, opacity=0.15}, {black, opacity=1}]` to land
 * as solid black after rasterisation).
 */

import type { FigPaint } from "@higma-document-models/fig/types";
import { getFillColorAndOpacity, getAllVisibleSolidFills } from "./fill";
import { PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";

function solid(rgba: { r: number; g: number; b: number; a?: number }, opacity?: number, visible?: boolean): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color: { r: rgba.r, g: rgba.g, b: rgba.b, a: rgba.a ?? 1 },
    ...(opacity === undefined ? {} : { opacity }),
    ...(visible === undefined ? {} : { visible }),
  };
}

describe("getFillColorAndOpacity", () => {
  it("returns DEFAULT (black/1) when paints are undefined", () => {
    expect(getFillColorAndOpacity(undefined)).toEqual({ color: "#000000", opacity: 1 });
  });

  it("returns DEFAULT when paints are empty", () => {
    expect(getFillColorAndOpacity([])).toEqual({ color: "#000000", opacity: 1 });
  });

  it("returns the first visible solid paint when multiple stacks are present", () => {
    expect(getFillColorAndOpacity([
      solid({ r: 0, g: 0, b: 0 }, 0.15),
      solid({ r: 0, g: 0, b: 0 }, 1),
    ])).toEqual({ color: "#000000", opacity: 0.15 });
  });

  it("skips paints flagged invisible", () => {
    expect(getFillColorAndOpacity([
      solid({ r: 0, g: 0, b: 0 }, 0.5, false),
      solid({ r: 1, g: 0, b: 0 }, 1),
    ])).toEqual({ color: "#ff0000", opacity: 1 });
  });
});

describe("getAllVisibleSolidFills", () => {
  it("returns an empty array for undefined or empty input", () => {
    expect(getAllVisibleSolidFills(undefined)).toEqual([]);
    expect(getAllVisibleSolidFills([])).toEqual([]);
  });

  it("returns every visible solid paint in source order", () => {
    // Calibrated against Event metadata's "Description" TEXT (Dark variant):
    // fillPaints=[{white, opacity=0.15}, {white, opacity=1}] is supposed to
    // paint a faint pass FIRST, then an opaque pass ON TOP.
    expect(getAllVisibleSolidFills([
      solid({ r: 1, g: 1, b: 1 }, 0.15),
      solid({ r: 1, g: 1, b: 1 }, 1),
    ])).toEqual([
      { color: "#ffffff", opacity: 0.15 },
      { color: "#ffffff", opacity: 1 },
    ]);
  });

  it("drops invisible paints but keeps the surrounding order intact", () => {
    expect(getAllVisibleSolidFills([
      solid({ r: 0, g: 0, b: 0 }, 0.5, false),
      solid({ r: 1, g: 0, b: 0 }, 0.3),
      solid({ r: 0, g: 1, b: 0 }, 0.6),
    ])).toEqual([
      { color: "#ff0000", opacity: 0.3 },
      { color: "#00ff00", opacity: 0.6 },
    ]);
  });

  it("defaults paint opacity to 1 when the field is absent", () => {
    expect(getAllVisibleSolidFills([
      solid({ r: 0, g: 0, b: 0 }),
    ])).toEqual([
      { color: "#000000", opacity: 1 },
    ]);
  });
});
