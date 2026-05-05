/**
 * @file Tests for fig-family schema profiles
 */

import {
  FIG_CANVAS_MAGICS,
  getFigSchemaProfileByMagic,
  isFigCanvasMagic,
} from "./profiles";

describe("fig schema profiles", () => {
  it("recognizes known raw canvas magic values", () => {
    expect(FIG_CANVAS_MAGICS).toEqual(["fig-kiwi", "fig-deck", "fig-buzz", "fig-site"]);
    expect(isFigCanvasMagic("fig-site")).toBe(true);
    expect(isFigCanvasMagic("fig-pptx")).toBe(false);
  });

  it("maps canvas magic to a schema profile", () => {
    expect(getFigSchemaProfileByMagic("fig-deck")).toMatchObject({
      name: "deck",
      domain: "presentation",
      extension: ".deck",
    });
  });
});
