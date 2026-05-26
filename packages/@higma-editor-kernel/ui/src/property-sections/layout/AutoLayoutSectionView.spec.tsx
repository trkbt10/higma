/** @file AutoLayoutSectionView tests. */

import { renderToStaticMarkup } from "react-dom/server";
import { AutoLayoutSectionView } from "./AutoLayoutSectionView";

describe("AutoLayoutSectionView", () => {
  it("renders Kiwi justify values for align content controls", () => {
    const html = renderToStaticMarkup(
      <AutoLayoutSectionView
        mode="HORIZONTAL"
        gap={8}
        padding={{ top: 1, right: 2, bottom: 3, left: 4 }}
        primaryAlign="MIN"
        counterAlign="CENTER"
        alignContent="SPACE_BETWEEN"
        counterGap={5}
        wrap
        reverseZ={false}
        onModeChange={() => undefined}
        onGapChange={() => undefined}
        onPaddingChange={() => undefined}
        onPrimaryAlignChange={() => undefined}
        onCounterAlignChange={() => undefined}
        onAlignContentChange={() => undefined}
        onCounterGapChange={() => undefined}
        onWrapChange={() => undefined}
        onReverseZChange={() => undefined}
      />
    );

    expect(html).toContain("aria-label=\"Auto layout align content\"");
    expect(html).toContain("value=\"SPACE_BETWEEN\" selected");
    expect(html).toContain("value=\"SPACE_EVENLY\"");
  });
});
