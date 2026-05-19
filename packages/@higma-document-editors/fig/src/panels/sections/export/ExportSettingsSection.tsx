/** @file Export settings section. */
import type { FigNode } from "@higma-document-models/fig/types";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

/** Render the export setting count carried by the selected Kiwi node. */
export function ExportSettingsSection({ node }: { readonly node: FigNode }) {
  if (node.exportSettings === undefined || node.exportSettings.length === 0) {
    return null;
  }
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Export</div>
      <div>{node.exportSettings.length} setting(s)</div>
    </section>
  );
}
