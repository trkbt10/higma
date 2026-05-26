/** @file Variant set controls over Kiwi FRAME state-group fields. */
import {
  guidToString,
  resolveFigComponentPropDef,
  type FigKiwiDocumentIndex,
} from "@higma-document-models/fig/domain";
import { isVariantSetFrame } from "@higma-document-models/fig/symbols";
import type {
  FigComponentPropDef,
  FigGuid,
  FigNode,
  FigVariantPropSpec,
} from "@higma-document-models/fig/types";
import {
  ComponentSetVariantsSectionView,
  type VariantChildValueView,
  type VariantDefView,
} from "@higma-editor-kernel/ui/property-sections";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

function requireDefId(def: FigComponentPropDef): FigGuid {
  if (def.id === undefined) {
    throw new Error("Component set variant definition is missing id");
  }
  return def.id;
}

function requireDefName(def: FigComponentPropDef): string {
  if (def.name === undefined) {
    throw new Error(`Component set variant definition ${guidToString(requireDefId(def))} is missing name`);
  }
  return def.name;
}

function requireChildName(child: FigNode): string {
  if (child.name === undefined) {
    throw new Error(`Component set child ${guidToString(child.guid)} is missing name`);
  }
  return child.name;
}

function requireSpecPropDefId(spec: FigVariantPropSpec): FigGuid {
  if (spec.propDefId === undefined) {
    throw new Error("Component set child variant spec is missing propDefId");
  }
  return spec.propDefId;
}

function requireSpecValue(spec: FigVariantPropSpec): string {
  if (spec.value === undefined) {
    throw new Error(`Component set child variant spec ${guidToString(requireSpecPropDefId(spec))} is missing value`);
  }
  return spec.value;
}

function variantDefs(node: FigNode, document: FigKiwiDocumentIndex): readonly FigComponentPropDef[] {
  return (node.componentPropDefs ?? []).filter((def) => (
    resolveFigComponentPropDef({ ownerNode: node, def, document }).type === "VARIANT"
  ));
}

function defViews(defs: readonly FigComponentPropDef[]): readonly VariantDefView[] {
  return defs.map((def) => ({
    id: guidToString(requireDefId(def)),
    name: requireDefName(def),
  }));
}

function specForDef(child: FigNode, def: FigComponentPropDef): FigVariantPropSpec {
  const defKey = guidToString(requireDefId(def));
  const spec = (child.variantPropSpecs ?? []).find((entry) => guidToString(requireSpecPropDefId(entry)) === defKey);
  if (spec === undefined) {
    throw new Error(`Component set child ${guidToString(child.guid)} is missing variant spec ${defKey}`);
  }
  return spec;
}

function childValueViews(
  children: readonly FigNode[],
  defs: readonly FigComponentPropDef[],
): readonly VariantChildValueView[] {
  return children.flatMap((child) => defs.map((def) => ({
    childId: guidToString(child.guid),
    defId: guidToString(requireDefId(def)),
    childName: requireChildName(child),
    defName: requireDefName(def),
    value: requireSpecValue(specForDef(child, def)),
  })));
}

function writeVariantDefName(node: FigNode, defKey: string, name: string): FigNode {
  const defs = node.componentPropDefs ?? [];
  const hasDef = defs.some((def) => guidToString(requireDefId(def)) === defKey);
  if (!hasDef) {
    throw new Error(`Component set variant definition ${defKey} is not present on ${guidToString(node.guid)}`);
  }
  return {
    ...node,
    componentPropDefs: defs.map((def) => {
      if (guidToString(requireDefId(def)) !== defKey) {
        return def;
      }
      return { ...def, name };
    }),
  };
}

function writeChildVariantValue(node: FigNode, defKey: string, value: string): FigNode {
  const specs = node.variantPropSpecs ?? [];
  const hasSpec = specs.some((spec) => guidToString(requireSpecPropDefId(spec)) === defKey);
  if (!hasSpec) {
    throw new Error(`Component set child ${guidToString(node.guid)} is missing variant spec ${defKey}`);
  }
  return {
    ...node,
    variantPropSpecs: specs.map((spec) => {
      if (guidToString(requireSpecPropDefId(spec)) !== defKey) {
        return spec;
      }
      return { ...spec, value };
    }),
  };
}

/** Render and edit Variant Set metadata from Kiwi FRAME + child SYMBOL fields. */
export function ComponentSetVariantsSection({ node }: { readonly node: FigNode }) {
  const { context, updateNode } = useFigEditor();
  if (!isVariantSetFrame(node)) {
    return null;
  }
  const defs = variantDefs(node, context.document);
  if (defs.length === 0) {
    return null;
  }
  const children = context.document.childrenOf(node).filter((child) => child.type.name === "SYMBOL");
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Component set</div>
      <ComponentSetVariantsSectionView
        variantDefs={defViews(defs)}
        childValues={childValueViews(children, defs)}
        onDefNameChange={(defId, name) => {
          updateNode(node.guid, (current) => writeVariantDefName(current, defId, name), FIG_NODE_MUTATION_SOURCE.propertyPanel);
        }}
        onChildValueChange={(childId, defId, value) => {
          const child = context.document.nodesByGuid.get(childId);
          if (child === undefined) {
            throw new Error(`Component set child ${childId} is not present in the Kiwi document`);
          }
          updateNode(child.guid, (current) => writeChildVariantValue(current, defId, value), FIG_NODE_MUTATION_SOURCE.propertyPanel);
        }}
      />
    </section>
  );
}
