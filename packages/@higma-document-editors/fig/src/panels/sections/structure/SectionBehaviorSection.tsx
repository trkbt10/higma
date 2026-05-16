/** @file Section-specific property controls adapter. */

import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { SectionBehaviorSectionView } from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyTargetUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";

type SectionBehaviorSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

/** Edit SECTION node behavior fields that are modeled directly by fig Kiwi. */
export function SectionBehaviorSection({ node, target, dispatch }: SectionBehaviorSectionProps) {
  return (
    <SectionBehaviorSectionView
      contentsHidden={Boolean(node.sectionContentsHidden)}
      onContentsHiddenChange={(hidden) => {
        dispatch(createPropertyTargetUpdateAction({
          target,
          updater: (current) => ({ ...current, sectionContentsHidden: hidden }),
        }));
      }}
    />
  );
}
