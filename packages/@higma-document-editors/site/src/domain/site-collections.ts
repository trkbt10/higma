/**
 * @file CMS Collection domain extracted strictly from canvas node changes.
 *
 * No fallback / heuristic / defensive branches: every field that the figma
 * canvas spec mandates is read with `readString` / `readNumber` / `readEnumName`
 * which throw on absence or wrong type. Optional schema branches return `null`
 * (`readNodeText` for nodes without textData, `readSelectorIfPresent` for nodes
 * without `cmsSelector`, `readAliasIfPresent` for non-alias variable consumption
 * entries) and are only the "no information" signal — never a substitute value.
 */

import type { SiteDocument } from "@higma-document-models/site";

import {
  classifySiteCollectionFieldKindFromAll,
  type SiteCollectionFieldKind,
} from "./site-collection-field-kind";

const ALIAS_SOURCES = ["parameter", "variable"] as const;
export type SiteCollectionAliasSource = (typeof ALIAS_SOURCES)[number];

export type SiteCollectionFieldReference = {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly source: SiteCollectionAliasSource;
  readonly variableField: string;
  readonly dataType: string;
  readonly resolvedDataType: string;
  readonly text: string | null;
};

export type SiteCollectionField = {
  readonly id: string;
  readonly kind: SiteCollectionFieldKind;
  readonly variableFields: readonly string[];
  readonly references: readonly SiteCollectionFieldReference[];
};

export type SiteCollectionItemValue = {
  readonly fieldId: string;
  readonly text: string | null;
  readonly references: readonly SiteCollectionFieldReference[];
};

export type SiteCollectionItem = {
  readonly id: string;
  readonly values: readonly SiteCollectionItemValue[];
};

export type SiteCollectionFilter = {
  readonly fieldId: string;
  readonly operator: string;
  readonly comparisonValue: string | number | boolean | null;
};

export type SiteCollectionSelector = {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly matchType: string;
  readonly filters: readonly SiteCollectionFilter[];
  readonly sortCount: number;
  readonly limit: number;
};

export type SiteCollection = {
  readonly id: string;
  readonly fields: readonly SiteCollectionField[];
  readonly items: readonly SiteCollectionItem[];
  readonly selectors: readonly SiteCollectionSelector[];
};

// =============================================================================
// Strict readers
// =============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRecord(value: unknown, fieldLabel: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Expected ${fieldLabel} to be an object`);
  }
  return value;
}

function readString(value: unknown, fieldLabel: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${fieldLabel} to be a string`);
  }
  return value;
}

function readNumber(value: unknown, fieldLabel: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected ${fieldLabel} to be a finite number`);
  }
  return value;
}

function readArray(value: unknown, fieldLabel: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${fieldLabel} to be an array`);
  }
  return value;
}

function readRecordArray(value: unknown, fieldLabel: string): readonly Record<string, unknown>[] {
  return readArray(value, fieldLabel).map((entry, index) => readRecord(entry, `${fieldLabel}[${index}]`));
}

function readEnumName(value: unknown, fieldLabel: string): string {
  if (typeof value === "string") {
    return value;
  }
  const record = readRecord(value, fieldLabel);
  return readString(record.name, `${fieldLabel}.name`);
}

function readGuidString(value: unknown, fieldLabel: string): string {
  const record = readRecord(value, fieldLabel);
  const sessionID = readNumber(record.sessionID, `${fieldLabel}.sessionID`);
  const localID = readNumber(record.localID, `${fieldLabel}.localID`);
  return `${sessionID}:${localID}`;
}

function readComparisonValue(value: unknown, fieldLabel: string): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`Expected ${fieldLabel} to be a scalar (string, finite number, boolean, or null)`);
}

// =============================================================================
// Node attribute readers
// =============================================================================

function readNodeId(node: Record<string, unknown>): string {
  return readGuidString(node.guid, "node.guid");
}

function readNodeName(node: Record<string, unknown>): string {
  return readString(node.name, "node.name");
}

function readNodeType(node: Record<string, unknown>): string {
  return readEnumName(node.type, "node.type");
}

function readNodeText(node: Record<string, unknown>): string | null {
  if (node.textData === undefined) {
    return null;
  }
  const textData = readRecord(node.textData, "node.textData");
  if (textData.characters === undefined) {
    return null;
  }
  return readString(textData.characters, "node.textData.characters");
}

// =============================================================================
// Selector / alias readers
// =============================================================================

function readSelectorFilter(value: unknown, fieldLabel: string): SiteCollectionFilter {
  const record = readRecord(value, fieldLabel);
  return {
    fieldId: readString(record.cmsFieldId, `${fieldLabel}.cmsFieldId`),
    operator: readEnumName(record.op, `${fieldLabel}.op`),
    comparisonValue: readComparisonValue(record.comparisonValue, `${fieldLabel}.comparisonValue`),
  };
}

function readSelectorFilters(value: unknown, fieldLabel: string): readonly SiteCollectionFilter[] {
  return readArray(value, fieldLabel).map((entry, index) => readSelectorFilter(entry, `${fieldLabel}[${index}]`));
}

function readSelectorSortCount(value: unknown, fieldLabel: string): number {
  return readArray(value, fieldLabel).length;
}

type SelectorPresence = {
  readonly collectionId: string;
  readonly selector: SiteCollectionSelector;
};

function readSelectorIfPresent(node: Record<string, unknown>): SelectorPresence | null {
  if (node.cmsSelector === undefined) {
    return null;
  }
  const selector = readRecord(node.cmsSelector, "node.cmsSelector");
  const collectionId = readString(selector.cmsCollectionId, "node.cmsSelector.cmsCollectionId");
  const filterCriteria = readRecord(selector.filterCriteria, "node.cmsSelector.filterCriteria");
  const built: SiteCollectionSelector = {
    nodeId: readNodeId(node),
    nodeName: readNodeName(node),
    nodeType: readNodeType(node),
    matchType: readEnumName(filterCriteria.matchType, "node.cmsSelector.filterCriteria.matchType"),
    filters: readSelectorFilters(filterCriteria.filters, "node.cmsSelector.filterCriteria.filters"),
    sortCount: readSelectorSortCount(selector.sorts, "node.cmsSelector.sorts"),
    limit: readNumber(selector.limit, "node.cmsSelector.limit"),
  };
  return { collectionId, selector: built };
}

type AliasRecord = {
  readonly collectionId: string;
  readonly fieldId: string;
  readonly itemId: string;
  readonly reference: SiteCollectionFieldReference;
};

function readAliasIfPresent(
  entry: Record<string, unknown>,
  source: SiteCollectionAliasSource,
  node: Record<string, unknown>,
  fieldLabel: string,
): AliasRecord | null {
  if (entry.variableData === undefined) {
    return null;
  }
  const variableData = readRecord(entry.variableData, `${fieldLabel}.variableData`);
  if (!isRecord(variableData.value)) {
    return null;
  }
  const value = variableData.value;
  if (value.cmsAliasValue === undefined) {
    return null;
  }
  const alias = readRecord(value.cmsAliasValue, `${fieldLabel}.variableData.value.cmsAliasValue`);
  const reference: SiteCollectionFieldReference = {
    nodeId: readNodeId(node),
    nodeName: readNodeName(node),
    nodeType: readNodeType(node),
    source,
    variableField: readEnumName(entry.variableField, `${fieldLabel}.variableField`),
    dataType: readEnumName(variableData.dataType, `${fieldLabel}.variableData.dataType`),
    resolvedDataType: readEnumName(variableData.resolvedDataType, `${fieldLabel}.variableData.resolvedDataType`),
    text: readNodeText(node),
  };
  return {
    collectionId: readString(alias.collectionId, `${fieldLabel}.variableData.value.cmsAliasValue.collectionId`),
    fieldId: readString(alias.fieldId, `${fieldLabel}.variableData.value.cmsAliasValue.fieldId`),
    itemId: readString(alias.itemId, `${fieldLabel}.variableData.value.cmsAliasValue.itemId`),
    reference,
  };
}

function readAliasEntries(
  source: SiteCollectionAliasSource,
  node: Record<string, unknown>,
): readonly AliasRecord[] {
  const mapKey = `${source}ConsumptionMap`;
  const map = node[mapKey];
  if (map === undefined) {
    return [];
  }
  const mapRecord = readRecord(map, `node.${mapKey}`);
  if (mapRecord.entries === undefined) {
    return [];
  }
  const entries = readRecordArray(mapRecord.entries, `node.${mapKey}.entries`);
  return entries.flatMap((entry, index) => {
    const record = readAliasIfPresent(entry, source, node, `node.${mapKey}.entries[${index}]`);
    if (record === null) {
      return [];
    }
    return [record];
  });
}

// =============================================================================
// Aggregation
// =============================================================================

type CollectionAccumulator = {
  readonly fields: Map<string, SiteCollectionFieldReference[]>;
  readonly fieldOrder: string[];
  readonly itemReferences: Map<string, AliasRecord[]>;
  readonly itemOrder: string[];
  readonly selectors: SiteCollectionSelector[];
};

function ensureAccumulator(
  collections: Map<string, CollectionAccumulator>,
  collectionOrder: string[],
  collectionId: string,
): CollectionAccumulator {
  const existing = collections.get(collectionId);
  if (existing) {
    return existing;
  }
  const next: CollectionAccumulator = {
    fields: new Map(),
    fieldOrder: [],
    itemReferences: new Map(),
    itemOrder: [],
    selectors: [],
  };
  collections.set(collectionId, next);
  collectionOrder.push(collectionId);
  return next;
}

function appendAlias(accumulator: CollectionAccumulator, record: AliasRecord): void {
  const existingField = accumulator.fields.get(record.fieldId);
  if (existingField) {
    existingField.push(record.reference);
  } else {
    accumulator.fields.set(record.fieldId, [record.reference]);
    accumulator.fieldOrder.push(record.fieldId);
  }
  const existingItem = accumulator.itemReferences.get(record.itemId);
  if (existingItem) {
    existingItem.push(record);
  } else {
    accumulator.itemReferences.set(record.itemId, [record]);
    accumulator.itemOrder.push(record.itemId);
  }
}

function buildField(
  fieldId: string,
  references: readonly SiteCollectionFieldReference[],
): SiteCollectionField {
  const variableFields = [...new Set(references.map((reference) => reference.variableField))];
  const kind = classifySiteCollectionFieldKindFromAll(variableFields);
  return {
    id: fieldId,
    kind,
    variableFields,
    references: [...references],
  };
}

function buildItemValue(fieldId: string, records: readonly AliasRecord[]): SiteCollectionItemValue {
  const matching = records
    .filter((record) => record.fieldId === fieldId)
    .map((record) => record.reference);
  const sample = matching.find((reference) => reference.text !== null && reference.text.trim() !== "");
  return {
    fieldId,
    text: sample === undefined ? null : sample.text,
    references: matching,
  };
}

function buildItem(
  itemId: string,
  fields: readonly SiteCollectionField[],
  records: readonly AliasRecord[],
): SiteCollectionItem {
  return {
    id: itemId,
    values: fields.map((field) => buildItemValue(field.id, records)),
  };
}

function buildCollection(
  collectionId: string,
  accumulator: CollectionAccumulator,
): SiteCollection {
  const fields = accumulator.fieldOrder.map((fieldId) => {
    const references = accumulator.fields.get(fieldId);
    if (references === undefined) {
      throw new Error(`Field ${fieldId} missing while building collection ${collectionId}`);
    }
    return buildField(fieldId, references);
  });
  const items = accumulator.itemOrder.map((itemId) => {
    const records = accumulator.itemReferences.get(itemId);
    if (records === undefined) {
      throw new Error(`Item ${itemId} missing while building collection ${collectionId}`);
    }
    return buildItem(itemId, fields, records);
  });
  return {
    id: collectionId,
    fields,
    items,
    selectors: [...accumulator.selectors],
  };
}

/** Aggregate every cmsAliasValue / cmsSelector reference in the document into Collections. */
export function extractSiteCollections(document: SiteDocument): readonly SiteCollection[] {
  const collections = new Map<string, CollectionAccumulator>();
  const collectionOrder: string[] = [];

  document.canvas.nodeChanges.forEach((rawNode, nodeIndex) => {
    const node = readRecord(rawNode, `canvas.nodeChanges[${nodeIndex}]`);
    const selectorPresence = readSelectorIfPresent(node);
    if (selectorPresence) {
      const accumulator = ensureAccumulator(collections, collectionOrder, selectorPresence.collectionId);
      accumulator.selectors.push(selectorPresence.selector);
    }
    for (const source of ALIAS_SOURCES) {
      const aliasRecords = readAliasEntries(source, node);
      for (const record of aliasRecords) {
        const accumulator = ensureAccumulator(collections, collectionOrder, record.collectionId);
        appendAlias(accumulator, record);
      }
    }
  });

  return collectionOrder.map((collectionId) => {
    const accumulator = collections.get(collectionId);
    if (accumulator === undefined) {
      throw new Error(`Collection ${collectionId} missing during finalisation`);
    }
    return buildCollection(collectionId, accumulator);
  });
}

/** Resolve a collection by id or throw if missing. */
export function findSiteCollection(
  collections: readonly SiteCollection[],
  collectionId: string,
): SiteCollection {
  const collection = collections.find((entry) => entry.id === collectionId);
  if (!collection) {
    throw new Error(`Site collection ${collectionId} not found`);
  }
  return collection;
}

/** Resolve a collection field by id or throw if missing. */
export function findSiteCollectionField(
  collection: SiteCollection,
  fieldId: string,
): SiteCollectionField {
  const field = collection.fields.find((entry) => entry.id === fieldId);
  if (!field) {
    throw new Error(`Field ${fieldId} not found in collection ${collection.id}`);
  }
  return field;
}

/** Resolve a collection item by id or throw if missing. */
export function findSiteCollectionItem(
  collection: SiteCollection,
  itemId: string,
): SiteCollectionItem {
  const item = collection.items.find((entry) => entry.id === itemId);
  if (!item) {
    throw new Error(`Item ${itemId === "" ? "<context>" : itemId} not found in collection ${collection.id}`);
  }
  return item;
}

/** Resolve an item value by field id or throw if missing. Items must always carry a value entry per field. */
export function findSiteCollectionItemValue(
  item: SiteCollectionItem,
  fieldId: string,
): SiteCollectionItemValue {
  const value = item.values.find((entry) => entry.fieldId === fieldId);
  if (!value) {
    throw new Error(`Value for field ${fieldId} missing on item ${item.id === "" ? "<context>" : item.id}`);
  }
  return value;
}
