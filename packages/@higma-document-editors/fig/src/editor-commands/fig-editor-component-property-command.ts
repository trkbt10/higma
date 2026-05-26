/** @file Fig editor INSTANCE component property operations over SymbolResolver. */
import {
  getNodeType,
  guidToString,
  resolveFigComponentPropDef,
  type ResolvedFigComponentPropDef,
} from "@higma-document-models/fig/domain";
import type {
  FigComponentPropAssignment,
  FigComponentPropDef,
  FigComponentPropValue,
  FigGuid,
  FigNode,
} from "@higma-document-models/fig/types";
import type { ResolvedSymbolTarget } from "@higma-document-models/fig/symbols";
import type { FigEditorContextValue } from "../context/FigEditorContext";

export type FigEditorResolvedComponentProperty = {
  readonly def: FigComponentPropDef;
  readonly resolvedDef: ResolvedFigComponentPropDef;
  readonly value: FigComponentPropValue;
  readonly isOverridden: boolean;
};

export type FigEditorResolvedComponentProperties = {
  readonly symbol: ResolvedSymbolTarget;
  readonly properties: readonly FigEditorResolvedComponentProperty[];
};

export type FigEditorComponentPropertyReadContext = Pick<FigEditorContextValue, "context">;

function requireComponentPropertyDefinitionGuid(def: FigComponentPropDef): FigGuid {
  if (def.id === undefined) {
    throw new Error("Component property definition is missing Kiwi guid");
  }
  return def.id;
}

function componentPropertyAssignmentForDefinition(
  assignments: readonly FigComponentPropAssignment[],
  defID: FigGuid,
): FigComponentPropAssignment | undefined {
  const defKey = guidToString(defID);
  return assignments.find((assignment) => guidToString(assignment.defID) === defKey);
}

function resolvedComponentPropertyValue(
  resolvedDef: ResolvedFigComponentPropDef,
  assignment: FigComponentPropAssignment | undefined,
): FigComponentPropValue {
  if (assignment !== undefined) {
    return assignment.value;
  }
  if (resolvedDef.initialValue === undefined) {
    throw new Error(`Component property definition ${guidToString(resolvedDef.id)} is missing initialValue`);
  }
  return resolvedDef.initialValue;
}

function readResolvedComponentProperty(
  symbol: ResolvedSymbolTarget,
  def: FigComponentPropDef,
  assignments: readonly FigComponentPropAssignment[],
): FigEditorResolvedComponentProperty {
  const defID = requireComponentPropertyDefinitionGuid(def);
  const resolvedDef = resolveFigComponentPropDef({
    ownerNode: symbol.node,
    def,
    document: symbol.document,
  });
  const assignment = componentPropertyAssignmentForDefinition(assignments, defID);
  return {
    def,
    resolvedDef,
    value: resolvedComponentPropertyValue(resolvedDef, assignment),
    isOverridden: assignment !== undefined,
  };
}

/**
 * Read component properties for one Kiwi INSTANCE through the editor
 * SymbolResolver. Undefined means the INSTANCE currently has no resolved
 * SYMBOL target; callers must treat that as an explicit unresolved state.
 */
export function readFigEditorResolvedComponentProperties(
  editor: FigEditorComponentPropertyReadContext,
  instance: FigNode,
): FigEditorResolvedComponentProperties | undefined {
  if (getNodeType(instance) !== "INSTANCE") {
    throw new Error("readFigEditorResolvedComponentProperties requires an INSTANCE node");
  }
  const symbol = editor.context.symbolResolver.resolveReferences(instance).effectiveSymbol;
  if (symbol === undefined) {
    return undefined;
  }
  const assignments = instance.componentPropAssignments ?? [];
  return {
    symbol,
    properties: (symbol.node.componentPropDefs ?? []).map((def) => (
      readResolvedComponentProperty(symbol, def, assignments)
    )),
  };
}

/** Write one component property assignment onto a Kiwi INSTANCE node. */
export function writeFigEditorComponentPropertyAssignment(
  node: FigNode,
  defID: FigGuid,
  value: FigComponentPropValue,
): FigNode {
  if (getNodeType(node) !== "INSTANCE") {
    throw new Error("writeFigEditorComponentPropertyAssignment requires an INSTANCE node");
  }
  const assignments = node.componentPropAssignments ?? [];
  const existing = componentPropertyAssignmentForDefinition(assignments, defID);
  if (existing === undefined) {
    return {
      ...node,
      componentPropAssignments: [...assignments, { defID, value }],
    };
  }
  const defKey = guidToString(defID);
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
