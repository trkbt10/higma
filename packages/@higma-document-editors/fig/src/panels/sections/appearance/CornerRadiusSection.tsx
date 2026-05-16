/**
 * @file Corner radius property section adapter
 *
 * Bridges the kernel CornerRadiusSectionView to FigDesignNode corner radius
 * storage (cornerRadius vs rectangleCornerRadii).
 */

import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { CornerRadiusSectionView } from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyTargetUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";
import {
  collapseToUniformCornerRadius,
  expandToIndividualCornerRadii,
  hasIndividualCornerRadii,
  isCornerRadiusEditableNode,
  resolveIndividualCornerRadii,
  resolveUniformCornerRadius,
  setIndividualCornerRadius,
  setUniformCornerRadius,
} from "./corner-radius-domain";

type CornerRadiusSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

/** Panel section for editing corner radius properties of a Figma node. */
export function CornerRadiusSection({ node, target, dispatch }: CornerRadiusSectionProps) {
  if (!isCornerRadiusEditableNode(node)) {
    return null;
  }

  const mode = hasIndividualCornerRadii(node) ? "individual" : "uniform";
  const uniformRadius = resolveUniformCornerRadius(node);
  const individualRadii = resolveIndividualCornerRadii(node);

  return (
    <CornerRadiusSectionView
      mode={mode}
      uniformRadius={uniformRadius}
      individualRadii={individualRadii}
      onUniformChange={(value) => {
        dispatch(createPropertyTargetUpdateAction({
          target,
          updater: (n) => setUniformCornerRadius(n, value),
        }));
      }}
      onIndividualChange={(index, value) => {
        dispatch(createPropertyTargetUpdateAction({
          target,
          updater: (n) => setIndividualCornerRadius(n, index, value),
        }));
      }}
      onSwitchToIndividual={() => {
        dispatch(createPropertyTargetUpdateAction({
          target,
          updater: expandToIndividualCornerRadii,
        }));
      }}
      onSwitchToUniform={() => {
        dispatch(createPropertyTargetUpdateAction({
          target,
          updater: collapseToUniformCornerRadius,
        }));
      }}
    />
  );
}
