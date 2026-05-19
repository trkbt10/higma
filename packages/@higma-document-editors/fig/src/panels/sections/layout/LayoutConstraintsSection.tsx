/** @file Child layout constraints for Kiwi nodes. */
import type { FigNode } from "@higma-document-models/fig/types";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

/** Render child layout constraints when the Kiwi fields are present. */
export function LayoutConstraintsSection({ node }: { readonly node: FigNode }) {
  if (node.horizontalConstraint === undefined && node.verticalConstraint === undefined) {
    return null;
  }
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Constraints</div>
      <div>H: {node.horizontalConstraint?.name ?? "unset"}</div>
      <div>V: {node.verticalConstraint?.name ?? "unset"}</div>
    </section>
  );
}
