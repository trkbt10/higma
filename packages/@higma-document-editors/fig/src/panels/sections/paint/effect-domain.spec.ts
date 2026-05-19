/** @file Tests for effect summaries. */

import { effectSummary } from "./effect-domain";
import { EFFECT_TYPE_VALUES } from "@higma-document-models/fig/constants";

describe("effectSummary", () => {
  it("returns the count carried by the Kiwi effects array", () => {
    expect(effectSummary([
      {
        type: { value: EFFECT_TYPE_VALUES.DROP_SHADOW, name: "DROP_SHADOW" },
        visible: true,
        radius: 8,
        offset: { x: 0, y: 4 },
        color: { r: 0, g: 0, b: 0, a: 0.25 },
      },
    ])).toBe("1");
  });

  it("returns zero for an absent Kiwi effects array", () => {
    expect(effectSummary(undefined)).toBe("0");
  });
});
