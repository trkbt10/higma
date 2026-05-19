/** @file Appearance patch type boundary tests. */

import type { AppearanceNodePatch } from "./appearance-domain";
import { sectionInnerShadow, SECTION_COLORS, sectionPaints } from "../section-specimen";

describe("AppearanceNodePatch", () => {
  it("keeps Kiwi appearance fields together without a projection layer", () => {
    const patch: AppearanceNodePatch = {
      fillPaints: sectionPaints(SECTION_COLORS.blue),
      strokePaints: sectionPaints(SECTION_COLORS.dark),
      effects: [sectionInnerShadow()],
      opacity: 0.5,
      visible: true,
    };

    expect(patch.fillPaints?.length).toBe(1);
    expect(patch.effects?.length).toBe(1);
  });
});
