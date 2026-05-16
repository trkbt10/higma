/** @file Variant property metadata controls adapter. */

import type { FigDesignNode, FigNodeId } from "@higma-document-models/fig/domain";
import {
  VariantPropertiesSectionView,
  type VariantPropertyView,
} from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyPrimaryUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";
import { updateVariantSpec } from "./variant-domain";

type VariantPropertiesSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

/** Edit SYMBOL variant values backed by Kiwi `variantPropSpecs`. */
export function VariantPropertiesSection({ node, target, dispatch }: VariantPropertiesSectionProps) {
  const specs = node.variantPropSpecs ?? [];

  if (specs.length === 0) {
    return null;
  }

  const views: readonly VariantPropertyView[] = specs.map((spec) => ({
    id: spec.propDefId,
    value: spec.value,
  }));

  return (
    <VariantPropertiesSectionView
      specs={views}
      onChange={(id, value) => {
        dispatch(createPropertyPrimaryUpdateAction({
          target,
          updater: (current) => ({
            ...current,
            variantPropSpecs: updateVariantSpec(
              current.variantPropSpecs ?? [],
              id as FigNodeId,
              value,
            ),
          }),
        }));
      }}
    />
  );
}
