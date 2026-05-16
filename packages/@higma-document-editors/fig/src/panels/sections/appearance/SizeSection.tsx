/**
 * @file Size property section adapter
 *
 * Translates between the kernel SizeSectionView (W/H) and FigDesignNode.size.
 *
 * When the parent of the selected node is an AutoLayout container, the W/H
 * suffix slot is replaced with a SuffixSelect exposing the per-axis sizing
 * mode (Fixed / Hug / Fill — mapped to fig's `stackPrimarySizing` /
 * `stackCounterSizing` enums on the node's layoutConstraints). This mirrors
 * Figma's behaviour where the Size inputs flip into a mode-selector when
 * the parent's layout owns positioning.
 */

import { useCallback, useMemo } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { STACK_SIZING_VALUES, type StackSizing, toEnumValue } from "@higma-document-models/fig/constants";
import type { KiwiEnumValue } from "@higma-document-models/fig/types";
import { findParentNode } from "@higma-document-io/fig/node-ops";
import {
  SizeSectionView,
  SuffixSelect,
  type SelectOption,
  type SizeSectionField,
} from "@higma-editor-kernel/ui";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { useFigEditor } from "../../../context/FigEditorContext";
import { createPropertyPrimaryUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";

type SizeSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

type SizingModeId = "FIXED" | "HUG" | "FILL";

const SIZING_OPTIONS: readonly SelectOption<SizingModeId>[] = [
  { value: "FIXED", label: "px" },
  { value: "HUG", label: "Hug" },
  { value: "FILL", label: "Fill" },
];

function sizingEnumToId(value: KiwiEnumValue | undefined): SizingModeId {
  const name = value?.name;
  if (name === "RESIZE_TO_FIT" || name === "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE") {
    return "HUG";
  }
  if (name === "FIXED") {
    return "FIXED";
  }
  return "FIXED";
}

function sizingIdToEnum(id: SizingModeId): KiwiEnumValue | undefined {
  switch (id) {
    case "HUG":
      return toEnumValue("RESIZE_TO_FIT" as StackSizing, STACK_SIZING_VALUES);
    case "FILL":
      // Fig's StackSizing has no explicit FILL; FILL is expressed via the
      // child's grow factor. We keep the size mode at FIXED and let the
      // grow path own that case; callers that need true FILL semantics
      // should wire grow=1 separately.
      return toEnumValue("FIXED" as StackSizing, STACK_SIZING_VALUES);
    case "FIXED":
      return toEnumValue("FIXED" as StackSizing, STACK_SIZING_VALUES);
  }
}

/** W/H editor — adds Fixed/Hug/Fill SuffixSelect when the node owns or sits inside an AutoLayout container. */
export function SizeSection({ node, target, dispatch }: SizeSectionProps) {
  const { activePage } = useFigEditor();

  const parent = useMemo(() => {
    if (!activePage) {
      return undefined;
    }
    return findParentNode(activePage.children, node.id);
  }, [activePage, node.id]);

  const parentHasAutoLayout = Boolean(parent?.autoLayout);
  const nodeIsAutoLayoutContainer = Boolean(node.autoLayout);
  const exposeSizingModes = parentHasAutoLayout || nodeIsAutoLayoutContainer;

  const w = Math.round(node.size.x * 100) / 100;
  const h = Math.round(node.size.y * 100) / 100;

  const updateSize = useCallback(
    (field: SizeSectionField, value: number) => {
      dispatch(createPropertyPrimaryUpdateAction({
        target,
        updater: (n) => ({
          ...n,
          size: field === "w" ? { ...n.size, x: value } : { ...n.size, y: value },
        }),
      }));
    },
    [dispatch, target],
  );

  const updateAxisSizing = useCallback(
    (axis: "primary" | "counter", id: SizingModeId) => {
      const enumValue = sizingIdToEnum(id);
      dispatch(createPropertyPrimaryUpdateAction({
        target,
        updater: (n) => {
          const current = n.layoutConstraints ?? {};
          if (axis === "primary") {
            return { ...n, layoutConstraints: { ...current, stackPrimarySizing: enumValue } };
          }
          return { ...n, layoutConstraints: { ...current, stackCounterSizing: enumValue } };
        },
      }));
    },
    [dispatch, target],
  );

  if (!exposeSizingModes) {
    return <SizeSectionView width={w} height={h} onChange={updateSize} />;
  }

  const primarySizing = sizingEnumToId(node.layoutConstraints?.stackPrimarySizing);
  const counterSizing = sizingEnumToId(node.layoutConstraints?.stackCounterSizing);
  // The stack direction governing axis-to-mode mapping is the *owning* layout's
  // direction: when the node owns AutoLayout, that's its own stack mode; when
  // it sits inside one, that's the parent's stack mode.
  const owningStackMode = nodeIsAutoLayoutContainer
    ? node.autoLayout?.stackMode?.name
    : parent?.autoLayout?.stackMode?.name;
  const isHorizontalStack = owningStackMode === "HORIZONTAL";

  // For HORIZONTAL stack: width is primary, height is counter.
  // For VERTICAL stack: height is primary, width is counter.
  // (GRID is treated as horizontal for the suffix mapping until we have grid-specific UI.)
  const widthAxis: "primary" | "counter" = isHorizontalStack ? "primary" : "counter";
  const heightAxis: "primary" | "counter" = isHorizontalStack ? "counter" : "primary";
  const widthMode = widthAxis === "primary" ? primarySizing : counterSizing;
  const heightMode = heightAxis === "primary" ? primarySizing : counterSizing;

  return (
    <SizeSectionView
      width={w}
      height={h}
      onChange={updateSize}
      widthSuffix={
        <SuffixSelect
          value={widthMode}
          options={SIZING_OPTIONS}
          onChange={(value) => updateAxisSizing(widthAxis, value)}
          ariaLabel="Width sizing mode"
        />
      }
      heightSuffix={
        <SuffixSelect
          value={heightMode}
          options={SIZING_OPTIONS}
          onChange={(value) => updateAxisSizing(heightAxis, value)}
          ariaLabel="Height sizing mode"
        />
      }
    />
  );
}
