/**
 * @file Stacked editor panel tests.
 */

import { renderToStaticMarkup } from "react-dom/server";

import { StackedEditorPanel } from "./StackedEditorPanel";

describe("StackedEditorPanel", () => {
  it("renders fixed and scrollable sections with stable panel attributes", () => {
    const markup = renderToStaticMarkup(
      <StackedEditorPanel
        sections={[
          { id: "fixed", content: <span>Fixed</span>, grow: false, scrollable: false },
          { id: "scroll", content: <span>Scroll</span>, grow: true, scrollable: true },
        ]}
      />,
    );

    expect(markup).toContain('data-editor-panel-section="fixed"');
    expect(markup).toContain('data-editor-panel-section="scroll"');
    expect(markup).toContain("overflow-y:auto");
    expect(markup).toContain("min-height:0");
  });

  it("throws when no sections are provided", () => {
    expect(() => renderToStaticMarkup(<StackedEditorPanel sections={[]} />)).toThrow(
      "StackedEditorPanel requires at least one section",
    );
  });
});
