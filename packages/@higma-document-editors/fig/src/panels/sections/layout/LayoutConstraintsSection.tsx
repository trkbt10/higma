/** @file Child layout constraints property section adapter. */

import { useCallback } from "react";
import type { FigDesignNode, LayoutConstraints } from "@higma-document-models/fig/domain";
import type { KiwiEnumValue } from "@higma-document-models/fig/types";
import {
  CONSTRAINT_TYPE_VALUES,
  STACK_COUNTER_ALIGN_VALUES,
  STACK_POSITIONING_VALUES,
  STACK_SIZING_VALUES,
  type ConstraintType,
  type StackCounterAlign,
  type StackPositioning,
  type StackSizing,
} from "@higma-document-models/fig/constants";
import { toEnumValue } from "@higma-document-models/fig/constants";
import {
  LayoutConstraintsSectionView,
  type ConstraintTypeId,
  type StackCounterAlignId,
  type StackPositioningId,
  type StackSizingId,
} from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyTargetUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";

type LayoutConstraintsSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

type EditableLayoutConstraints = Required<
  Pick<
    LayoutConstraints,
    | "stackPositioning"
    | "stackPrimarySizing"
    | "stackCounterSizing"
    | "horizontalConstraint"
    | "verticalConstraint"
    | "stackChildPrimaryGrow"
  >
> & Pick<LayoutConstraints, "stackChildAlignSelf">;

function enumName<T extends string>(val: KiwiEnumValue | undefined, fallback: T): T {
  return (val?.name ?? fallback) as T;
}

function withDefaults(constraints: LayoutConstraints | undefined): EditableLayoutConstraints {
  return {
    stackPositioning: constraints?.stackPositioning ?? toEnumValue("AUTO", STACK_POSITIONING_VALUES)!,
    stackPrimarySizing: constraints?.stackPrimarySizing ?? toEnumValue("FIXED", STACK_SIZING_VALUES)!,
    stackCounterSizing: constraints?.stackCounterSizing ?? toEnumValue("FIXED", STACK_SIZING_VALUES)!,
    horizontalConstraint: constraints?.horizontalConstraint ?? toEnumValue("MIN", CONSTRAINT_TYPE_VALUES)!,
    verticalConstraint: constraints?.verticalConstraint ?? toEnumValue("MIN", CONSTRAINT_TYPE_VALUES)!,
    stackChildAlignSelf: constraints?.stackChildAlignSelf,
    stackChildPrimaryGrow: constraints?.stackChildPrimaryGrow ?? 0,
  };
}

/** Edit child sizing/position constraints consumed by AutoLayout and fixed frames. */
export function LayoutConstraintsSection({ node, target, dispatch }: LayoutConstraintsSectionProps) {
  const constraints = withDefaults(node.layoutConstraints);

  const updateConstraints = useCallback(
    (updater: (current: EditableLayoutConstraints) => LayoutConstraints) => {
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (current) => ({
          ...current,
          layoutConstraints: updater(withDefaults(current.layoutConstraints)),
        }),
      }));
    },
    [dispatch, target],
  );

  return (
    <LayoutConstraintsSectionView
      positioning={enumName(constraints.stackPositioning, "AUTO" as StackPositioningId) as StackPositioningId}
      primarySizing={enumName(constraints.stackPrimarySizing, "FIXED" as StackSizingId) as StackSizingId}
      counterSizing={enumName(constraints.stackCounterSizing, "FIXED" as StackSizingId) as StackSizingId}
      horizontalConstraint={enumName(constraints.horizontalConstraint, "MIN" as ConstraintTypeId) as ConstraintTypeId}
      verticalConstraint={enumName(constraints.verticalConstraint, "MIN" as ConstraintTypeId) as ConstraintTypeId}
      alignSelf={enumName(constraints.stackChildAlignSelf, "MIN" as StackCounterAlignId) as StackCounterAlignId}
      grow={constraints.stackChildPrimaryGrow}
      onPositioningChange={(value) => updateConstraints((current) => ({
        ...current,
        stackPositioning: toEnumValue(value as StackPositioning, STACK_POSITIONING_VALUES)!,
      }))}
      onPrimarySizingChange={(value) => updateConstraints((current) => ({
        ...current,
        stackPrimarySizing: toEnumValue(value as StackSizing, STACK_SIZING_VALUES)!,
      }))}
      onCounterSizingChange={(value) => updateConstraints((current) => ({
        ...current,
        stackCounterSizing: toEnumValue(value as StackSizing, STACK_SIZING_VALUES)!,
      }))}
      onHorizontalConstraintChange={(value) => updateConstraints((current) => ({
        ...current,
        horizontalConstraint: toEnumValue(value as ConstraintType, CONSTRAINT_TYPE_VALUES)!,
      }))}
      onVerticalConstraintChange={(value) => updateConstraints((current) => ({
        ...current,
        verticalConstraint: toEnumValue(value as ConstraintType, CONSTRAINT_TYPE_VALUES)!,
      }))}
      onAlignSelfChange={(value) => updateConstraints((current) => ({
        ...current,
        stackChildAlignSelf: value === "MIN" ? undefined : toEnumValue(value as StackCounterAlign, STACK_COUNTER_ALIGN_VALUES),
      }))}
      onGrowChange={(value) => updateConstraints((current) => ({
        ...current,
        stackChildPrimaryGrow: value,
      }))}
    />
  );
}
