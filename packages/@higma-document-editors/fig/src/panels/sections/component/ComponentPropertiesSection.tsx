/** @file Component property controls over Kiwi INSTANCE fields. */
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import type {
  FigComponentPropAssignment,
  FigComponentPropDef,
  FigComponentPropValue,
  FigGuid,
  FigNode,
} from "@higma-document-models/fig/types";
import {
  ComponentPropertiesSectionView,
  type ComponentPropertyTypeId,
  type ComponentPropertyValueView,
  type ResolvedComponentPropertyView,
} from "@higma-editor-kernel/ui/property-sections";
import type { SelectOption } from "@higma-editor-kernel/ui/types";
import { useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

type ResolvedComponentProperty = {
  readonly def: FigComponentPropDef;
  readonly type: ComponentPropertyTypeId;
  readonly value: FigComponentPropValue;
  readonly isOverridden: boolean;
};

function requireGuid(value: FigGuid | undefined, owner: string): FigGuid {
  if (value === undefined) {
    throw new Error(`${owner} is missing Kiwi guid`);
  }
  return value;
}

function requireDefId(def: FigComponentPropDef): FigGuid {
  return requireGuid(def.id, "Component property definition");
}

function requireDefName(def: FigComponentPropDef): string {
  if (def.name === undefined) {
    throw new Error(`Component property definition ${guidToString(requireDefId(def))} is missing name`);
  }
  return def.name;
}

function componentPropertyType(def: FigComponentPropDef): ComponentPropertyTypeId {
  const name = def.type?.name;
  switch (name) {
    case "BOOL":
    case "TEXT":
    case "NUMBER":
    case "INSTANCE_SWAP":
    case "VARIANT":
    case "COLOR":
    case "IMAGE":
    case "SLOT":
      return name;
    case undefined:
      throw new Error(`Component property definition ${guidToString(requireDefId(def))} is missing type`);
    default:
      throw new Error(`Unsupported component property type ${name}`);
  }
}

function assignmentForDef(
  assignments: readonly FigComponentPropAssignment[],
  defID: FigGuid,
): FigComponentPropAssignment | undefined {
  const defKey = guidToString(defID);
  return assignments.find((assignment) => guidToString(assignment.defID) === defKey);
}

function resolvedValueForDef(
  def: FigComponentPropDef,
  assignment: FigComponentPropAssignment | undefined,
): FigComponentPropValue {
  if (assignment !== undefined) {
    return assignment.value;
  }
  if (def.initialValue === undefined) {
    throw new Error(`Component property definition ${guidToString(requireDefId(def))} is missing initialValue`);
  }
  return def.initialValue;
}

function resolveComponentProperties(
  symbol: FigNode,
  instance: FigNode,
): readonly ResolvedComponentProperty[] {
  const defs = symbol.componentPropDefs ?? [];
  const assignments = instance.componentPropAssignments ?? [];
  return defs.map((def) => {
    const defID = requireDefId(def);
    const assignment = assignmentForDef(assignments, defID);
    return {
      def,
      type: componentPropertyType(def),
      value: resolvedValueForDef(def, assignment),
      isOverridden: assignment !== undefined,
    };
  });
}

function boolValue(value: FigComponentPropValue, def: FigComponentPropDef): boolean {
  if (typeof value.boolValue !== "boolean") {
    throw new Error(`BOOL component property ${guidToString(requireDefId(def))} requires boolValue`);
  }
  return value.boolValue;
}

function textValue(value: FigComponentPropValue, def: FigComponentPropDef): string {
  const characters = value.textValue?.characters;
  if (characters === undefined) {
    throw new Error(`TEXT component property ${guidToString(requireDefId(def))} requires textValue.characters`);
  }
  return characters;
}

function numberValue(value: FigComponentPropValue, def: FigComponentPropDef): number {
  if (typeof value.numberValue === "number") {
    return value.numberValue;
  }
  if (typeof value.floatValue === "number") {
    return value.floatValue;
  }
  throw new Error(`NUMBER component property ${guidToString(requireDefId(def))} requires numberValue or floatValue`);
}

function referenceValue(value: FigComponentPropValue, def: FigComponentPropDef): string {
  const guid = value.guidValue;
  if (guid === undefined) {
    throw new Error(`${componentPropertyType(def)} component property ${guidToString(requireDefId(def))} requires guidValue`);
  }
  return guidToString(guid);
}

function toValueView(property: ResolvedComponentProperty): ComponentPropertyValueView {
  switch (property.type) {
    case "BOOL":
      return { kind: "bool", value: boolValue(property.value, property.def) };
    case "TEXT":
      return { kind: "text", value: textValue(property.value, property.def) };
    case "NUMBER":
      return { kind: "number", value: numberValue(property.value, property.def) };
    case "INSTANCE_SWAP":
    case "VARIANT":
    case "COLOR":
    case "IMAGE":
    case "SLOT":
      return { kind: "reference", value: referenceValue(property.value, property.def) };
  }
}

function toPropertyView(property: ResolvedComponentProperty): ResolvedComponentPropertyView {
  return {
    id: guidToString(requireDefId(property.def)),
    name: requireDefName(property.def),
    type: property.type,
    value: toValueView(property),
    isOverridden: property.isOverridden,
  };
}

function requireDocumentGuidByKey(nodes: ReadonlyMap<string, FigNode>, key: string): FigGuid {
  const node = nodes.get(key);
  if (node === undefined) {
    throw new Error(`Component property reference ${key} is not present in the Kiwi document`);
  }
  return node.guid;
}

function componentPropValueFromView(
  value: ComponentPropertyValueView,
  nodesByGuid: ReadonlyMap<string, FigNode>,
): FigComponentPropValue {
  switch (value.kind) {
    case "bool":
      return { boolValue: value.value };
    case "text":
      return { textValue: { characters: value.value } };
    case "number":
      return { numberValue: value.value };
    case "reference":
      return { guidValue: requireDocumentGuidByKey(nodesByGuid, value.value) };
  }
}

function writeComponentAssignment(
  node: FigNode,
  defID: FigGuid,
  value: FigComponentPropValue,
): FigNode {
  if (getNodeType(node) !== "INSTANCE") {
    throw new Error("Component property assignment updates require an INSTANCE node");
  }
  const defKey = guidToString(defID);
  const assignments = node.componentPropAssignments ?? [];
  const hasAssignment = assignments.some((assignment) => guidToString(assignment.defID) === defKey);
  if (!hasAssignment) {
    return {
      ...node,
      componentPropAssignments: [...assignments, { defID, value }],
    };
  }
  return {
    ...node,
    componentPropAssignments: assignments.map((assignment) => {
      if (guidToString(assignment.defID) !== defKey) {
        return assignment;
      }
      return { defID, value };
    }),
  };
}

function symbolOptions(nodes: readonly FigNode[]): readonly SelectOption<string>[] {
  return nodes
    .filter((candidate) => getNodeType(candidate) === "SYMBOL")
    .map((candidate) => ({
      value: guidToString(candidate.guid),
      label: candidate.name ?? guidToString(candidate.guid),
    }));
}

function requireDefByKey(defs: readonly FigComponentPropDef[], key: string): FigComponentPropDef {
  const def = defs.find((candidate) => guidToString(requireDefId(candidate)) === key);
  if (def === undefined) {
    throw new Error(`Component property definition ${key} is not present on the resolved SYMBOL`);
  }
  return def;
}

/** Render component-instance properties from the document SymbolResolver. */
export function ComponentPropertiesSection({ node }: { readonly node: FigNode }) {
  const { context, updateNode } = useFigEditor();
  if (getNodeType(node) !== "INSTANCE") {
    return null;
  }
  const resolution = context.symbolResolver.resolveReferences(node);
  const symbol = resolution.effectiveSymbol?.node;
  if (symbol === undefined) {
    return null;
  }
  const properties = resolveComponentProperties(symbol, node);
  if (properties.length === 0) {
    return null;
  }
  const defs = symbol.componentPropDefs ?? [];
  const options = symbolOptions(context.document.nodeChanges);
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Component</div>
      <ComponentPropertiesSectionView
        componentName={symbol.name}
        properties={properties.map(toPropertyView)}
        referenceOptions={options}
        instanceSwapOptions={options}
        onValueChange={(propertyId, value) => {
          const def = requireDefByKey(defs, propertyId);
          const defID = requireDefId(def);
          const nextValue = componentPropValueFromView(value, context.document.nodesByGuid);
          updateNode(node.guid, (current) => writeComponentAssignment(current, defID, nextValue), "property-panel");
        }}
      />
    </section>
  );
}
