/** @file AutoLayout property section adapter. */

import { useCallback } from "react";
import type { AutoLayoutProps, FigDesignNode } from "@higma-document-models/fig/domain";
import type { KiwiEnumValue } from "@higma-document-models/fig/types";
import { STACK_ALIGN_VALUES, STACK_MODE_VALUES, type StackAlign, type StackMode } from "@higma-document-models/fig/constants";
import { toEnumValue } from "@higma-document-models/fig/constants";
import {
  AutoLayoutSectionView,
  type AutoLayoutPaddingSide,
  type StackAlignId,
  type StackModeId,
} from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyTargetUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";

type AutoLayoutSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

type EditableAutoLayout = Required<Pick<AutoLayoutProps, "stackMode" | "stackPadding">> & Omit<AutoLayoutProps, "stackMode" | "stackPadding">;

function enumName<T extends string>(val: KiwiEnumValue | undefined, fallback: T): T {
  return (val?.name ?? fallback) as T;
}

function withDefaults(layout: AutoLayoutProps | undefined): EditableAutoLayout {
  return {
    stackMode: layout?.stackMode ?? toEnumValue("NONE", STACK_MODE_VALUES)!,
    stackSpacing: layout?.stackSpacing ?? 0,
    stackPadding: layout?.stackPadding ?? { top: 0, right: 0, bottom: 0, left: 0 },
    stackPrimaryAlignItems: layout?.stackPrimaryAlignItems ?? toEnumValue("MIN", STACK_ALIGN_VALUES),
    stackCounterAlignItems: layout?.stackCounterAlignItems ?? toEnumValue("MIN", STACK_ALIGN_VALUES),
    stackPrimaryAlignContent: layout?.stackPrimaryAlignContent,
    stackWrap: layout?.stackWrap ?? false,
    stackCounterSpacing: layout?.stackCounterSpacing,
    stackReverseZIndex: layout?.stackReverseZIndex,
  };
}

/** Panel section for viewing and editing auto layout properties of a Figma node. */
export function AutoLayoutSection({ node, target, dispatch }: AutoLayoutSectionProps) {
  const layout = withDefaults(node.autoLayout);

  const updateAutoLayout = useCallback(
    (updater: (layout: EditableAutoLayout) => AutoLayoutProps | undefined) => {
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (current) => ({ ...current, autoLayout: updater(withDefaults(current.autoLayout)) }),
      }));
    },
    [dispatch, target],
  );

  const handleModeChange = useCallback((mode: StackModeId) => {
    updateAutoLayout((current) => {
      if (mode === "NONE") {
        return undefined;
      }
      return { ...current, stackMode: toEnumValue(mode as StackMode, STACK_MODE_VALUES)! };
    });
  }, [updateAutoLayout]);

  const handlePaddingChange = useCallback((side: AutoLayoutPaddingSide, value: number) => {
    updateAutoLayout((current) => ({ ...current, stackPadding: { ...current.stackPadding, [side]: value } }));
  }, [updateAutoLayout]);

  return (
    <AutoLayoutSectionView
      mode={enumName(layout.stackMode, "NONE") as StackModeId}
      gap={layout.stackSpacing ?? 0}
      padding={layout.stackPadding}
      primaryAlign={enumName(layout.stackPrimaryAlignItems, "MIN") as StackAlignId}
      counterAlign={enumName(layout.stackCounterAlignItems, "MIN") as StackAlignId}
      alignContent={enumName(layout.stackPrimaryAlignContent, "MIN") as StackAlignId}
      counterGap={layout.stackCounterSpacing ?? 0}
      wrap={Boolean(layout.stackWrap)}
      reverseZ={Boolean(layout.stackReverseZIndex)}
      onModeChange={handleModeChange}
      onGapChange={(value) => updateAutoLayout((current) => ({ ...current, stackSpacing: value }))}
      onPaddingChange={handlePaddingChange}
      onPrimaryAlignChange={(align) => updateAutoLayout((current) => ({ ...current, stackPrimaryAlignItems: toEnumValue(align as StackAlign, STACK_ALIGN_VALUES) }))}
      onCounterAlignChange={(align) => updateAutoLayout((current) => ({ ...current, stackCounterAlignItems: toEnumValue(align as StackAlign, STACK_ALIGN_VALUES) }))}
      onAlignContentChange={(align) => updateAutoLayout((current) => ({ ...current, stackPrimaryAlignContent: toEnumValue(align as StackAlign, STACK_ALIGN_VALUES) }))}
      onCounterGapChange={(value) => updateAutoLayout((current) => ({ ...current, stackCounterSpacing: value }))}
      onWrapChange={(value) => updateAutoLayout((current) => ({ ...current, stackWrap: value }))}
      onReverseZChange={(value) => updateAutoLayout((current) => ({ ...current, stackReverseZIndex: value }))}
    />
  );
}
