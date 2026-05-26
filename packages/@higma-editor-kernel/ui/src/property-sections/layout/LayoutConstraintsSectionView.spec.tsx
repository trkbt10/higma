/** @file LayoutConstraintsSectionView tests. */

import { renderToStaticMarkup } from "react-dom/server";
import { LayoutConstraintsSectionView } from "./LayoutConstraintsSectionView";

describe("LayoutConstraintsSectionView", () => {
  it("keeps AUTO and MIN as distinct align-self values", () => {
    const html = renderToStaticMarkup(
      <LayoutConstraintsSectionView
        positioning="AUTO"
        primarySizing="FIXED"
        counterSizing="RESIZE_TO_FIT"
        horizontalConstraint="MIN"
        verticalConstraint="SCALE"
        alignSelf="AUTO"
        grow={0}
        onPositioningChange={() => undefined}
        onPrimarySizingChange={() => undefined}
        onCounterSizingChange={() => undefined}
        onHorizontalConstraintChange={() => undefined}
        onVerticalConstraintChange={() => undefined}
        onAlignSelfChange={() => undefined}
        onGrowChange={() => undefined}
      />
    );

    expect(html).toContain("aria-label=\"Layout align self\"");
    expect(html).toContain("value=\"AUTO\" selected");
    expect(html).toContain("<option value=\"MIN\">Min</option>");
  });
});
