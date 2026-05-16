/**
 * @file Variant Set authoring controls adapter.
 *
 * A "Component Set" / "Variant Set" on disk is a FRAME bearing
 * `isStateGroup` + VARIANT-typed `componentPropertyDefs`; the canonical
 * Figma schema has no COMPONENT_SET NodeType.
 */

import type { ComponentPropertyDef, FigDesignNode, FigNodeId } from "@higma-document-models/fig/domain";
import { isVariantSetFrame } from "@higma-document-models/fig/domain";
import {
  ComponentSetVariantsSectionView,
  type VariantChildValueView,
  type VariantDefView,
} from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyPrimaryUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";
import { updateVariantSpec, findVariantSpec } from "./variant-domain";

type ComponentSetVariantsSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

/** Edit variant definitions and child component variant values on a Variant-Set FRAME. */
export function ComponentSetVariantsSection({ node, target, dispatch }: ComponentSetVariantsSectionProps) {
  if (!isVariantSetFrame(node)) {
    return null;
  }

  const variantDefs = (node.componentPropertyDefs ?? []).filter((def) => def.type === "VARIANT");
  const componentChildren = (node.children ?? []).filter((child) => child.type === "SYMBOL");

  const defViews: readonly VariantDefView[] = variantDefs.map((def) => ({ id: def.id, name: def.name }));
  const childValues: readonly VariantChildValueView[] = componentChildren.flatMap((child) =>
    variantDefs.map((def) => {
      const spec = findVariantSpec(child.variantPropSpecs ?? [], def.id);
      return {
        childId: child.id,
        defId: def.id,
        childName: child.name,
        defName: def.name,
        value: spec?.value ?? "",
      };
    })
  );

  return (
    <ComponentSetVariantsSectionView
      variantDefs={defViews}
      childValues={childValues}
      onDefNameChange={(defId, name) => {
        dispatch(createPropertyPrimaryUpdateAction({
          target,
          updater: (current) => updateVariantDefName(current, defId as FigNodeId, name),
        }));
      }}
      onChildValueChange={(childId, defId, value) => {
        dispatch(createPropertyPrimaryUpdateAction({
          target,
          updater: (current) => updateChildVariantValue({
            node: current,
            childId: childId as FigNodeId,
            propDefId: defId as FigNodeId,
            value,
          }),
        }));
      }}
    />
  );
}

function updateVariantDefName(node: FigDesignNode, defId: FigNodeId, name: string): FigDesignNode {
  return {
    ...node,
    componentPropertyDefs: (node.componentPropertyDefs ?? []).map((def) => (
      def.id === defId ? { ...def, name } satisfies ComponentPropertyDef : def
    )),
  };
}

function updateChildVariantValue({
  node,
  childId,
  propDefId,
  value,
}: {
  readonly node: FigDesignNode;
  readonly childId: FigNodeId;
  readonly propDefId: FigNodeId;
  readonly value: string;
}): FigDesignNode {
  return {
    ...node,
    children: (node.children ?? []).map((child) => {
      if (child.id !== childId) {
        return child;
      }
      return {
        ...child,
        variantPropSpecs: updateVariantSpec(child.variantPropSpecs ?? [], propDefId, value),
      };
    }),
  };
}
