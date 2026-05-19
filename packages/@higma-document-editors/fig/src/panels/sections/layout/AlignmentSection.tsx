/** @file Alignment section placeholder for Kiwi auto-layout alignment fields. */
import type { FigNode } from "@higma-document-models/fig/types";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

/** Render auto-layout alignment enum values when present. */
export function AlignmentSection({ node }: { readonly node: FigNode }) {
  if (node.stackPrimaryAlignItems === undefined && node.stackCounterAlignItems === undefined) {
    return null;
  }
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Alignment</div>
      <div>Primary: {node.stackPrimaryAlignItems?.name ?? "unset"}</div>
      <div>Counter: {node.stackCounterAlignItems?.name ?? "unset"}</div>
    </section>
  );
}
