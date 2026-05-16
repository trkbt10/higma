/**
 * @file Opacity property section adapter
 *
 * Thin adapter: derives a 0-100 percent from FigDesignNode.opacity, renders
 * the kernel-level view, and converts changes back to fig editor actions.
 */

import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { OpacitySectionView } from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyTargetUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";

type OpacitySectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

/** Panel section for editing the opacity of a Figma node. */
export function OpacitySection({ node, target, dispatch }: OpacitySectionProps) {
  const percent = Math.round(node.opacity * 100);

  return (
    <OpacitySectionView
      percent={percent}
      onPercentChange={(value) => {
        dispatch(createPropertyTargetUpdateAction({
          target,
          updater: (n) => ({ ...n, opacity: Math.max(0, Math.min(1, value / 100)) }),
        }));
      }}
    />
  );
}
