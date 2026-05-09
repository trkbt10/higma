/**
 * @file Apply site render-unit move operations to fig-family canvas nodes.
 */

import type { SiteDocument } from "@higma-document-models/site";
import {
  asRecord,
  buildNodeMatrix,
  IDENTITY_MATRIX,
  readEnumName,
  readGuidString,
  readNumber,
  readParentGuidString,
  readString,
  type SiteAffineMatrix,
} from "./internal/site-node-helpers";

export type SiteUnitMove = {
  readonly unitId: string;
  readonly deltaX: number;
  readonly deltaY: number;
};

function invertLinearDelta(
  matrix: SiteAffineMatrix,
  delta: { readonly x: number; readonly y: number },
  nodeId: string,
): { readonly x: number; readonly y: number } {
  const determinant = matrix.m00 * matrix.m11 - matrix.m01 * matrix.m10;
  if (determinant === 0) {
    throw new Error(`Site edit transform parent matrix is not invertible for ${nodeId}`);
  }
  return {
    x: (matrix.m11 * delta.x - matrix.m01 * delta.y) / determinant,
    y: (-matrix.m10 * delta.x + matrix.m00 * delta.y) / determinant,
  };
}

function createNodeById(nodeChanges: readonly unknown[]): ReadonlyMap<string, Record<string, unknown>> {
  return new Map(nodeChanges.flatMap((nodeChange) => {
    const node = asRecord(nodeChange, "nodeChange");
    const id = readGuidString(node);
    if (!id) {
      return [];
    }
    return [[id, node]];
  }));
}

function resolveMove(moves: readonly SiteUnitMove[], nodeId: string): SiteUnitMove | null {
  const move = moves.find((item) => item.unitId === nodeId);
  if (!move) {
    return null;
  }
  return move;
}

function readParentMatrix(
  node: Record<string, unknown>,
  nodeId: string,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
): SiteAffineMatrix {
  const parentId = readParentGuidString(node);
  if (!parentId) {
    return IDENTITY_MATRIX;
  }
  return buildNodeMatrix(parentId, nodesById);
}

function applyMoveToNode(
  node: Record<string, unknown>,
  nodeId: string,
  move: SiteUnitMove,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> {
  const transform = asRecord(node.transform, `node ${nodeId}.transform`);
  const localDelta = invertLinearDelta(
    readParentMatrix(node, nodeId, nodesById),
    { x: move.deltaX, y: move.deltaY },
    nodeId,
  );
  return {
    ...node,
    transform: {
      ...transform,
      m02: readNumber(transform.m02, `node ${nodeId}.transform.m02`) + localDelta.x,
      m12: readNumber(transform.m12, `node ${nodeId}.transform.m12`) + localDelta.y,
    },
  };
}

/** Apply direct site unit moves to raw fig-family node changes. */
export function applySiteUnitMovesToNodeChanges<NodeChange>(
  nodeChanges: readonly NodeChange[],
  moves: readonly SiteUnitMove[],
): readonly NodeChange[] {
  const nodesById = createNodeById(nodeChanges);
  return nodeChanges.map((nodeChange): NodeChange => {
    const node = asRecord(nodeChange, "nodeChange");
    const id = readGuidString(node);
    if (!id) {
      return nodeChange;
    }
    const move = resolveMove(moves, id);
    if (!move) {
      return nodeChange;
    }
    return applyMoveToNode(node, id, move, nodesById) as NodeChange;
  });
}

/** Create a draft site document whose canvas reflects direct unit moves. */
export function createSiteDocumentWithUnitMoves(
  document: SiteDocument,
  moves: readonly SiteUnitMove[],
): SiteDocument {
  return {
    ...document,
    canvas: {
      ...document.canvas,
      nodeChanges: applySiteUnitMovesToNodeChanges(document.canvas.nodeChanges, moves),
    },
  };
}

// ---------------------------------------------------------------------------
// CMS field edits — write back into the canvas
// ---------------------------------------------------------------------------

export type SiteCmsFieldEdit = {
  readonly collectionId: string;
  readonly itemId: string;
  readonly fieldId: string;
  readonly text: string;
};

const ALIAS_SOURCES = ["parameter", "variable"] as const;
type SiteCmsAliasSource = (typeof ALIAS_SOURCES)[number];

const TEXT_VARIABLE_FIELDS: ReadonlySet<string> = new Set(["TEXT_DATA"]);

type AliasSlot = {
  readonly collectionId: string;
  readonly itemId: string;
  readonly fieldId: string;
  readonly variableField: string;
};

function readAliasSlot(
  entry: Record<string, unknown>,
  source: SiteCmsAliasSource,
  index: number,
): AliasSlot | null {
  if (entry.variableData === undefined) {
    return null;
  }
  const variableData = asRecord(entry.variableData, `${source}ConsumptionMap.entries[${index}].variableData`);
  if (!variableData.value || typeof variableData.value !== "object") {
    return null;
  }
  const value = variableData.value as Record<string, unknown>;
  if (value.cmsAliasValue === undefined) {
    return null;
  }
  const alias = asRecord(value.cmsAliasValue, `${source}ConsumptionMap.entries[${index}].variableData.value.cmsAliasValue`);
  return {
    collectionId: readString(alias.collectionId, `${source}ConsumptionMap.entries[${index}].variableData.value.cmsAliasValue.collectionId`),
    fieldId: readString(alias.fieldId, `${source}ConsumptionMap.entries[${index}].variableData.value.cmsAliasValue.fieldId`),
    itemId: readString(alias.itemId, `${source}ConsumptionMap.entries[${index}].variableData.value.cmsAliasValue.itemId`),
    variableField: readEnumName(entry.variableField, `${source}ConsumptionMap.entries[${index}].variableField`),
  };
}

function nodeMatchesAnyEdit(
  node: Record<string, unknown>,
  editsByKey: ReadonlyMap<string, SiteCmsFieldEdit>,
): SiteCmsFieldEdit | null {
  for (const source of ALIAS_SOURCES) {
    const map = node[`${source}ConsumptionMap`];
    if (map === undefined) {
      continue;
    }
    const mapRecord = asRecord(map, `${source}ConsumptionMap`);
    if (mapRecord.entries === undefined) {
      continue;
    }
    if (!Array.isArray(mapRecord.entries)) {
      throw new Error(`Expected ${source}ConsumptionMap.entries to be an array`);
    }
    for (let index = 0; index < mapRecord.entries.length; index += 1) {
      const entry = mapRecord.entries[index];
      if (entry === undefined) {
        continue;
      }
      const slot = readAliasSlot(asRecord(entry, `${source}ConsumptionMap.entries[${index}]`), source, index);
      if (!slot) {
        continue;
      }
      if (!TEXT_VARIABLE_FIELDS.has(slot.variableField)) {
        continue;
      }
      const edit = editsByKey.get(`${slot.collectionId} ${slot.itemId} ${slot.fieldId}`);
      if (edit) {
        return edit;
      }
    }
  }
  return null;
}

function applyEditToTextNode(node: Record<string, unknown>, edit: SiteCmsFieldEdit): Record<string, unknown> {
  if (node.textData === undefined) {
    return node;
  }
  const textData = asRecord(node.textData, "node.textData");
  return {
    ...node,
    textData: {
      ...textData,
      characters: edit.text,
    },
  };
}

function buildEditsByKey(edits: readonly SiteCmsFieldEdit[]): ReadonlyMap<string, SiteCmsFieldEdit> {
  const map = new Map<string, SiteCmsFieldEdit>();
  for (const edit of edits) {
    map.set(`${edit.collectionId} ${edit.itemId} ${edit.fieldId}`, edit);
  }
  return map;
}

/**
 * Apply CMS field edits to raw fig-family node changes by mutating the
 * `textData.characters` of every consumer node whose `cmsAliasValue`
 * targets the edited (collection, item, field) triple.
 *
 * Only TEXT_DATA-typed bindings are written by this v1 path; rich-text /
 * image / date / link / number / boolean fields require structured
 * encoders that the .site source does not yet expose, so calling code must
 * route those through dedicated paths instead of this function.
 */
export function applySiteCmsFieldEditsToNodeChanges<NodeChange>(
  nodeChanges: readonly NodeChange[],
  edits: readonly SiteCmsFieldEdit[],
): readonly NodeChange[] {
  if (edits.length === 0) {
    return nodeChanges;
  }
  const editsByKey = buildEditsByKey(edits);
  return nodeChanges.map((nodeChange): NodeChange => {
    const node = asRecord(nodeChange, "nodeChange");
    const edit = nodeMatchesAnyEdit(node, editsByKey);
    if (!edit) {
      return nodeChange;
    }
    return applyEditToTextNode(node, edit) as NodeChange;
  });
}

/** Create a draft site document whose canvas reflects pending CMS field edits. */
export function createSiteDocumentWithCmsFieldEdits(
  document: SiteDocument,
  edits: readonly SiteCmsFieldEdit[],
): SiteDocument {
  return {
    ...document,
    canvas: {
      ...document.canvas,
      nodeChanges: applySiteCmsFieldEditsToNodeChanges(document.canvas.nodeChanges, edits),
    },
  };
}
