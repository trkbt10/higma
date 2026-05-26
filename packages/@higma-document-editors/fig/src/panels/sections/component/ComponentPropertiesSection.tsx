/** @file Component property controls over Kiwi INSTANCE fields. */
import { memo } from "react";
import {
  getNodeType,
  guidToString,
  sameKiwiNodeExceptTransform,
} from "@higma-document-models/fig/domain";
import type {
  FigComponentPropDef,
  FigComponentPropValue,
  FigGuid,
  FigNode,
} from "@higma-document-models/fig/types";
import {
  readFigEditorResolvedComponentProperties,
  writeFigEditorComponentPropertyAssignment,
  type FigEditorResolvedComponentProperty,
} from "../../../editor-commands/fig-editor-component-property-command";
import {
  ComponentPropertiesSectionView,
  type ComponentPropertyValueView,
  type ResolvedComponentPropertyView,
} from "@higma-editor-kernel/ui/property-sections";
import type { SelectOption } from "@higma-editor-kernel/ui/types";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

type ComponentPropertiesSectionProps = {
  readonly node: FigNode;
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

function referenceValue(value: FigComponentPropValue, property: FigEditorResolvedComponentProperty): string {
  const guid = value.guidValue;
  if (guid === undefined) {
    throw new Error(`${property.resolvedDef.type} component property ${guidToString(property.resolvedDef.id)} requires guidValue`);
  }
  return guidToString(guid);
}

function toValueView(property: FigEditorResolvedComponentProperty): ComponentPropertyValueView {
  switch (property.resolvedDef.type) {
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
      return { kind: "reference", value: referenceValue(property.value, property) };
  }
}

function toPropertyView(property: FigEditorResolvedComponentProperty): ResolvedComponentPropertyView {
  return {
    id: guidToString(property.resolvedDef.id),
    name: property.resolvedDef.name,
    type: property.resolvedDef.type,
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

function symbolOptions(nodes: readonly FigNode[]): readonly SelectOption<string>[] {
  return nodes
    .filter((candidate) => getNodeType(candidate) === "SYMBOL")
    .map((candidate) => ({
      value: guidToString(candidate.guid),
      label: candidate.name ?? guidToString(candidate.guid),
    }));
}

function requirePropertyByKey(
  properties: readonly FigEditorResolvedComponentProperty[],
  key: string,
): FigEditorResolvedComponentProperty {
  const property = properties.find((candidate) => guidToString(requireDefId(candidate.def)) === key);
  if (property === undefined) {
    throw new Error(`Component property definition ${key} is not present on the resolved INSTANCE property set`);
  }
  return property;
}

/** Render component-instance properties from the document SymbolResolver. */
function ComponentPropertiesSectionContent({ node }: ComponentPropertiesSectionProps) {
  const editor = useFigEditor();
  const { context, updateNode } = editor;
  if (getNodeType(node) !== "INSTANCE") {
    return null;
  }
  const model = readFigEditorResolvedComponentProperties(editor, node);
  if (model === undefined) {
    return null;
  }
  const symbol = model.symbol.node;
  const properties = model.properties;
  if (properties.length === 0) {
    return null;
  }
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
          const property = requirePropertyByKey(properties, propertyId);
          const defID = requireDefId(property.def);
          const nextValue = componentPropValueFromView(value, context.document.nodesByGuid);
          updateNode(node.guid, (current) => writeFigEditorComponentPropertyAssignment(current, defID, nextValue), FIG_NODE_MUTATION_SOURCE.propertyPanel);
        }}
      />
    </section>
  );
}

function sameComponentPropertiesSectionProps(
  left: ComponentPropertiesSectionProps,
  right: ComponentPropertiesSectionProps,
): boolean {
  return sameKiwiNodeExceptTransform(left.node, right.node);
}

export const ComponentPropertiesSection = memo(
  ComponentPropertiesSectionContent,
  sameComponentPropertiesSectionProps,
);
