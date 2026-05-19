/** @file Tests for canvas interaction policy resolution. */

import { resolveCanvasInteractionPolicy } from "./interaction-policy";

describe("resolveCanvasInteractionPolicy", () => {
  it("enables selection and movement only for select mode", () => {
    expect(resolveCanvasInteractionPolicy("select")).toEqual({
      canSelect: true,
      canMove: true,
      canCreate: false,
      canEditPath: false,
      marqueeEnabled: true,
    });
  });

  it("routes pen mode to path editing without node movement", () => {
    expect(resolveCanvasInteractionPolicy("pen")).toEqual({
      canSelect: true,
      canMove: false,
      canCreate: false,
      canEditPath: true,
      marqueeEnabled: false,
    });
  });

  it("routes shape tools to creation without selection mutation", () => {
    expect(resolveCanvasInteractionPolicy("rectangle")).toEqual({
      canSelect: false,
      canMove: false,
      canCreate: true,
      canEditPath: false,
      marqueeEnabled: false,
    });
  });
});
