/** @file Kiwi component property definition resolution. */

import type {
  FigComponentPropDef,
  FigComponentPropValue,
  FigGuid,
  FigNode,
  KiwiEnumValue,
} from "../types";
import type { FigKiwiDocumentIndex } from "./kiwi-document-index";
import { guidToString } from "./fig-guid";

export type FigComponentPropertyTypeName =
  | "BOOL"
  | "TEXT"
  | "COLOR"
  | "INSTANCE_SWAP"
  | "VARIANT"
  | "NUMBER"
  | "IMAGE"
  | "SLOT";

export type ResolvedFigComponentPropDef = {
  readonly id: FigGuid;
  readonly name: string;
  readonly type: FigComponentPropertyTypeName;
  readonly initialValue?: FigComponentPropValue;
  readonly sourceDef: FigComponentPropDef;
};

export type ResolveFigComponentPropDefOptions = {
  readonly ownerNode: FigNode;
  readonly def: FigComponentPropDef;
  readonly document: FigKiwiDocumentIndex;
};

type ComponentPropDefWithOwner = {
  readonly ownerNode: FigNode;
  readonly def: FigComponentPropDef;
};

function requireComponentPropDefId(def: FigComponentPropDef): FigGuid {
  if (def.id === undefined) {
    throw new Error("Component property definition is missing id");
  }
  return def.id;
}

function componentPropertyTypeName(type: KiwiEnumValue, defId: FigGuid): FigComponentPropertyTypeName {
  const name = type.name;
  switch (name) {
    case "BOOL":
    case "TEXT":
    case "COLOR":
    case "INSTANCE_SWAP":
    case "VARIANT":
    case "NUMBER":
    case "IMAGE":
    case "SLOT":
      return name;
    case undefined:
      throw new Error(`Component property definition ${guidToString(defId)} type is missing enum name`);
    default:
      throw new Error(`Unsupported component property type ${name} on definition ${guidToString(defId)}`);
  }
}

function parentNode(ownerNode: FigNode, document: FigKiwiDocumentIndex): FigNode | undefined {
  const parentGuid = ownerNode.parentIndex?.guid;
  if (parentGuid === undefined) {
    return undefined;
  }
  return document.nodesByGuid.get(guidToString(parentGuid));
}

function componentPropDefByIdOnNode(node: FigNode, parentDefId: FigGuid): FigComponentPropDef | undefined {
  const parentDefKey = guidToString(parentDefId);
  return (node.componentPropDefs ?? []).find((def) => {
    const id = def.id;
    if (id === undefined) {
      return false;
    }
    return guidToString(id) === parentDefKey;
  });
}

function findAncestorComponentPropDef(
  ownerNode: FigNode,
  parentDefId: FigGuid,
  document: FigKiwiDocumentIndex,
): ComponentPropDefWithOwner | undefined {
  const parent = parentNode(ownerNode, document);
  if (parent === undefined) {
    return undefined;
  }
  const parentDef = componentPropDefByIdOnNode(parent, parentDefId);
  if (parentDef !== undefined) {
    return { ownerNode: parent, def: parentDef };
  }
  return findAncestorComponentPropDef(parent, parentDefId, document);
}

function componentPropDefChain(
  current: ComponentPropDefWithOwner,
  document: FigKiwiDocumentIndex,
  visitedDefIds: readonly string[],
): readonly ComponentPropDefWithOwner[] {
  const currentId = requireComponentPropDefId(current.def);
  const currentKey = guidToString(currentId);
  if (visitedDefIds.includes(currentKey)) {
    throw new Error(`Component property definition inheritance cycle at ${currentKey}`);
  }
  const parentDefId = current.def.parentPropDefId;
  if (parentDefId === undefined) {
    return [current];
  }
  const parent = findAncestorComponentPropDef(current.ownerNode, parentDefId, document);
  if (parent === undefined) {
    throw new Error(
      `Component property definition ${currentKey} references missing ancestor parent ${guidToString(parentDefId)}`,
    );
  }
  return [current, ...componentPropDefChain(parent, document, [...visitedDefIds, currentKey])];
}

function resolvedComponentPropDefName(chain: readonly ComponentPropDefWithOwner[], defId: FigGuid): string {
  for (const entry of chain) {
    if (entry.def.name !== undefined) {
      return entry.def.name;
    }
  }
  throw new Error(`Component property definition ${guidToString(defId)} is missing name`);
}

function resolvedComponentPropDefType(
  chain: readonly ComponentPropDefWithOwner[],
  defId: FigGuid,
): FigComponentPropertyTypeName {
  for (const entry of chain) {
    if (entry.def.type !== undefined) {
      return componentPropertyTypeName(entry.def.type, defId);
    }
  }
  throw new Error(`Component property definition ${guidToString(defId)} is missing type`);
}

function resolvedComponentPropDefInitialValue(
  chain: readonly ComponentPropDefWithOwner[],
): FigComponentPropValue | undefined {
  for (const entry of chain) {
    if (entry.def.initialValue !== undefined) {
      return entry.def.initialValue;
    }
  }
  return undefined;
}

/**
 * Resolve a Kiwi component property definition through `parentPropDefId`.
 *
 * Figma stores child SYMBOL property definitions as local ids that may carry
 * only `parentPropDefId`; the owning ancestor FRAME carries the authored
 * name, type, and initial value. The owner node is therefore part of the
 * SoT and is required explicitly so duplicate definition ids elsewhere in the
 * document are never collapsed into a global map.
 */
export function resolveFigComponentPropDef({
  ownerNode,
  def,
  document,
}: ResolveFigComponentPropDefOptions): ResolvedFigComponentPropDef {
  const id = requireComponentPropDefId(def);
  const chain = componentPropDefChain({ ownerNode, def }, document, []);
  return {
    id,
    name: resolvedComponentPropDefName(chain, id),
    type: resolvedComponentPropDefType(chain, id),
    initialValue: resolvedComponentPropDefInitialValue(chain),
    sourceDef: def,
  };
}
