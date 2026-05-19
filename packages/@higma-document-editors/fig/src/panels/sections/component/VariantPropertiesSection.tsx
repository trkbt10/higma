/** @file Variant property controls over Kiwi variantPropSpecs. */
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigGuid, FigNode, FigVariantPropSpec } from "@higma-document-models/fig/types";
import {
  VariantPropertiesSectionView,
  type VariantPropertyView,
} from "@higma-editor-kernel/ui/property-sections";
import { useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

function requirePropDefId(spec: FigVariantPropSpec): FigGuid {
  if (spec.propDefId === undefined) {
    throw new Error("Variant property spec is missing propDefId");
  }
  return spec.propDefId;
}

function requireSpecValue(spec: FigVariantPropSpec): string {
  if (spec.value === undefined) {
    throw new Error(`Variant property spec ${guidToString(requirePropDefId(spec))} is missing value`);
  }
  return spec.value;
}

function variantSpecViews(specs: readonly FigVariantPropSpec[]): readonly VariantPropertyView[] {
  return specs.map((spec) => ({
    id: guidToString(requirePropDefId(spec)),
    value: requireSpecValue(spec),
  }));
}

function writeVariantSpecValue(node: FigNode, propDefKey: string, value: string): FigNode {
  const specs = node.variantPropSpecs ?? [];
  const hasSpec = specs.some((spec) => guidToString(requirePropDefId(spec)) === propDefKey);
  if (!hasSpec) {
    throw new Error(`Variant property spec ${propDefKey} is not present on ${guidToString(node.guid)}`);
  }
  return {
    ...node,
    variantPropSpecs: specs.map((spec) => {
      if (guidToString(requirePropDefId(spec)) !== propDefKey) {
        return spec;
      }
      return { ...spec, value };
    }),
  };
}

/** Render and edit SYMBOL variant values carried by Kiwi variantPropSpecs. */
export function VariantPropertiesSection({ node }: { readonly node: FigNode }) {
  const { updateNode } = useFigEditor();
  const specs = node.variantPropSpecs ?? [];
  if (specs.length === 0) {
    return null;
  }
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Variant</div>
      <VariantPropertiesSectionView
        specs={variantSpecViews(specs)}
        onChange={(id, value) => {
          updateNode(node.guid, (current) => writeVariantSpecValue(current, id, value), "property-panel");
        }}
      />
    </section>
  );
}
