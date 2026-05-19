/** @file Export settings section tests. */

import { createElement } from "react";
import { renderSection, sectionExportSettings, sectionNode } from "../section-specimen";
import { ExportSettingsSection } from "./ExportSettingsSection";

describe("ExportSettingsSection", () => {
  it("renders the Kiwi exportSettings count", () => {
    const node = sectionNode("FRAME", { exportSettings: sectionExportSettings() });
    const html = renderSection(createElement(ExportSettingsSection, { node }), [node]);

    expect(html).toContain("Export");
    expect(html).toContain("1 setting(s)");
  });
});
