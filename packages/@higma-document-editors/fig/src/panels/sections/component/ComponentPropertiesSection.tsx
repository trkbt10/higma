/**
 * @file Component Properties section adapter
 *
 * Resolves component property definitions and current values from FigDesignNode +
 * FigDesignDocument, then renders the kernel ComponentPropertiesSectionView.
 */

import { useCallback } from "react";
import type {
  FigDesignNode,
  FigDesignDocument,
  FigNodeId,
  ComponentPropertyDef,
  ComponentPropertyAssignment,
  ComponentPropertyValue,
} from "@higma-document-models/fig/domain";
import {
  ComponentPropertiesSectionView,
  type ComponentPropertyTypeId,
  type ComponentPropertyValueView,
  type ResolvedComponentPropertyView,
} from "@higma-editor-kernel/ui/property-sections";
import type { SelectOption } from "@higma-editor-kernel/ui/types";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyPrimaryUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";

// =============================================================================
// Resolution logic (kept here so callers can reuse it for inspector views).
// =============================================================================

/**
 * A single resolved property with its definition and current effective value.
 */
export type ResolvedComponentProperty = {
  readonly def: ComponentPropertyDef;
  readonly value: ComponentPropertyValue | undefined;
  readonly isOverridden: boolean;
};

/**
 * Resolve component properties for an INSTANCE node by looking up the referenced
 * SYMBOL's property definitions and merging in any instance assignments.
 */
export function resolveComponentProperties(
  instanceNode: FigDesignNode,
  document: FigDesignDocument,
): readonly ResolvedComponentProperty[] {
  if (instanceNode.type !== "INSTANCE" || !instanceNode.symbolId) {
    return [];
  }

  const symbol = document.components.get(instanceNode.symbolId);
  if (!symbol || !symbol.componentPropertyDefs || symbol.componentPropertyDefs.length === 0) {
    return [];
  }

  const assignmentMap = new Map<string, ComponentPropertyAssignment>();
  if (instanceNode.componentPropertyAssignments) {
    for (const assign of instanceNode.componentPropertyAssignments) {
      assignmentMap.set(assign.defId, assign);
    }
  }

  return symbol.componentPropertyDefs.map((def) => {
    const assignment = assignmentMap.get(def.id);
    return {
      def,
      value: assignment ? assignment.value : def.initialValue,
      isOverridden: assignment !== undefined,
    };
  });
}

type Props = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly document: FigDesignDocument;
  readonly dispatch: (action: FigEditorAction) => void;
};

function toValueView(def: ComponentPropertyDef, value: ComponentPropertyValue | undefined): ComponentPropertyValueView {
  switch (def.type) {
    case "BOOL":
      return { kind: "bool", value: value?.boolValue ?? false };
    case "TEXT":
      return { kind: "text", value: value?.textValue?.characters ?? "" };
    case "NUMBER":
      return { kind: "number", value: value?.numberValue ?? 0 };
    case "INSTANCE_SWAP":
    case "VARIANT":
    case "COLOR":
    case "IMAGE":
    case "SLOT":
      return { kind: "reference", value: value?.referenceValue ?? "" };
  }
}

function toResolvedView(resolved: ResolvedComponentProperty): ResolvedComponentPropertyView {
  return {
    id: resolved.def.id,
    name: resolved.def.name,
    type: resolved.def.type as ComponentPropertyTypeId,
    value: toValueView(resolved.def, resolved.value),
    isOverridden: resolved.isOverridden,
  };
}

function toComponentPropertyValue(viewValue: ComponentPropertyValueView): ComponentPropertyValue {
  switch (viewValue.kind) {
    case "bool":
      return { boolValue: viewValue.value };
    case "text":
      return { textValue: { characters: viewValue.value } };
    case "number":
      return { numberValue: viewValue.value };
    case "reference":
      return viewValue.value === "" ? {} : { referenceValue: viewValue.value as FigNodeId };
  }
}

function updateComponentPropertyAssignments(
  {
    assignments,
    defId,
    value,
    exists,
  }: {
    readonly assignments: readonly ComponentPropertyAssignment[];
    readonly defId: FigNodeId;
    readonly value: ComponentPropertyValue;
    readonly exists: boolean;
  },
): readonly ComponentPropertyAssignment[] {
  if (!exists) {
    return [...assignments, { defId, value }];
  }
  return assignments.map((assignment) => {
    if (assignment.defId === defId) {
      return { ...assignment, value };
    }
    return assignment;
  });
}

function buildComponentOptions(document: FigDesignDocument): readonly SelectOption<FigNodeId | "">[] {
  return [
    { value: "", label: "None" },
    ...[...document.components.values()].map((component) => ({
      value: component.id,
      label: component.name,
    })),
  ];
}

/** Panel section for viewing and editing component instance properties. */
export function ComponentPropertiesSection({ node, target, document, dispatch }: Props) {
  const properties = resolveComponentProperties(node, document);
  const updateAssignment = useCallback(
    (defId: FigNodeId, value: ComponentPropertyValue) => {
      dispatch(createPropertyPrimaryUpdateAction({
        target,
        updater: (current) => {
          const assignments = current.componentPropertyAssignments ?? [];
          const exists = assignments.some((assignment) => assignment.defId === defId);
          const next = updateComponentPropertyAssignments({ assignments, defId, value, exists });
          return { ...current, componentPropertyAssignments: next };
        },
      }));
    },
    [dispatch, target],
  );

  const symbol = node.symbolId ? document.components.get(node.symbolId) : undefined;
  const referenceOptions = buildComponentOptions(document);

  return (
    <ComponentPropertiesSectionView
      componentName={symbol?.name}
      properties={properties.map(toResolvedView)}
      referenceOptions={referenceOptions}
      instanceSwapOptions={referenceOptions}
      onValueChange={(propertyId, value) => updateAssignment(propertyId as FigNodeId, toComponentPropertyValue(value))}
    />
  );
}
