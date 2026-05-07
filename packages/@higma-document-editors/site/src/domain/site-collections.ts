/**
 * @file CMS Collection domain extracted strictly from site render bindings.
 */

import type {
  SiteCmsAliasBinding,
  SiteCmsBinding,
  SiteCmsRichTextBinding,
  SiteCmsSelectorBinding,
  SiteCmsSelectorFilter,
  SiteRenderRole,
} from "@higma-document-renderers/site";

export type SiteCollectionFieldUsage = {
  readonly source: SiteCmsAliasBinding["source"];
  readonly variableField: string;
  readonly dataType: string;
  readonly resolvedDataType: string;
  readonly itemId: string;
  readonly unitId: string;
  readonly unitLabel: string;
  readonly unitRole: SiteRenderRole;
};

export type SiteCollectionField = {
  readonly id: string;
  readonly usages: readonly SiteCollectionFieldUsage[];
};

export type SiteCollectionItemBinding = {
  readonly fieldId: string;
  readonly source: SiteCmsAliasBinding["source"];
  readonly variableField: string;
  readonly dataType: string;
  readonly resolvedDataType: string;
  readonly unitId: string;
  readonly unitLabel: string;
  readonly unitRole: SiteRenderRole;
};

export type SiteCollectionItem = {
  readonly id: string;
  readonly bindings: readonly SiteCollectionItemBinding[];
};

export type SiteCollectionSelector = {
  readonly unitId: string;
  readonly unitLabel: string;
  readonly unitRole: SiteRenderRole;
  readonly matchType: string;
  readonly filters: readonly SiteCmsSelectorFilter[];
  readonly sortCount: number;
  readonly limit: number;
};

export type SiteCollection = {
  readonly id: string;
  readonly fields: readonly SiteCollectionField[];
  readonly items: readonly SiteCollectionItem[];
  readonly selectors: readonly SiteCollectionSelector[];
};

type CollectionAccumulator = {
  readonly fields: Map<string, SiteCollectionFieldUsage[]>;
  readonly items: Map<string, SiteCollectionItemBinding[]>;
  readonly selectors: SiteCollectionSelector[];
};

function ensureAccumulator(
  collections: Map<string, CollectionAccumulator>,
  collectionId: string,
): CollectionAccumulator {
  const existing = collections.get(collectionId);
  if (existing) {
    return existing;
  }
  const next: CollectionAccumulator = {
    fields: new Map(),
    items: new Map(),
    selectors: [],
  };
  collections.set(collectionId, next);
  return next;
}

function pushFieldUsage(
  accumulator: CollectionAccumulator,
  fieldId: string,
  usage: SiteCollectionFieldUsage,
): void {
  const list = accumulator.fields.get(fieldId);
  if (list) {
    list.push(usage);
    return;
  }
  accumulator.fields.set(fieldId, [usage]);
}

function pushItemBinding(
  accumulator: CollectionAccumulator,
  itemId: string,
  binding: SiteCollectionItemBinding,
): void {
  const list = accumulator.items.get(itemId);
  if (list) {
    list.push(binding);
    return;
  }
  accumulator.items.set(itemId, [binding]);
}

function applySelectorBinding(
  collections: Map<string, CollectionAccumulator>,
  binding: SiteCmsSelectorBinding,
): void {
  const accumulator = ensureAccumulator(collections, binding.collectionId);
  accumulator.selectors.push({
    unitId: binding.unitId,
    unitLabel: binding.unitLabel,
    unitRole: binding.unitRole,
    matchType: binding.matchType,
    filters: binding.filters,
    sortCount: binding.sortCount,
    limit: binding.limit,
  });
}

function applyRichTextBinding(
  collections: Map<string, CollectionAccumulator>,
  binding: SiteCmsRichTextBinding,
): void {
  for (const alias of binding.aliases) {
    const accumulator = ensureAccumulator(collections, alias.collectionId);
    pushFieldUsage(accumulator, alias.fieldId, {
      source: alias.source,
      variableField: alias.variableField,
      dataType: alias.dataType,
      resolvedDataType: alias.resolvedDataType,
      itemId: alias.itemId,
      unitId: binding.unitId,
      unitLabel: binding.unitLabel,
      unitRole: binding.unitRole,
    });
    pushItemBinding(accumulator, alias.itemId, {
      fieldId: alias.fieldId,
      source: alias.source,
      variableField: alias.variableField,
      dataType: alias.dataType,
      resolvedDataType: alias.resolvedDataType,
      unitId: binding.unitId,
      unitLabel: binding.unitLabel,
      unitRole: binding.unitRole,
    });
  }
}

function compareString(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function freezeFields(map: ReadonlyMap<string, readonly SiteCollectionFieldUsage[]>): readonly SiteCollectionField[] {
  const entries = [...map.entries()].sort((left, right) => compareString(left[0], right[0]));
  return entries.map(([id, usages]) => ({ id, usages }));
}

function freezeItems(map: ReadonlyMap<string, readonly SiteCollectionItemBinding[]>): readonly SiteCollectionItem[] {
  const entries = [...map.entries()].sort((left, right) => compareString(left[0], right[0]));
  return entries.map(([id, bindings]) => ({ id, bindings }));
}

function freezeSelectors(selectors: readonly SiteCollectionSelector[]): readonly SiteCollectionSelector[] {
  return [...selectors].sort((left, right) => compareString(left.unitId, right.unitId));
}

/** Aggregate CMS bindings into the editor-facing Collection domain. */
export function extractSiteCollections(
  source: { readonly cmsBindings: readonly SiteCmsBinding[] },
): readonly SiteCollection[] {
  const accumulators = new Map<string, CollectionAccumulator>();
  for (const binding of source.cmsBindings) {
    if (binding.kind === "site-cms-selector-binding") {
      applySelectorBinding(accumulators, binding);
      continue;
    }
    applyRichTextBinding(accumulators, binding);
  }
  return [...accumulators.entries()]
    .sort((left, right) => compareString(left[0], right[0]))
    .map(([id, accumulator]) => ({
      id,
      fields: freezeFields(accumulator.fields),
      items: freezeItems(accumulator.items),
      selectors: freezeSelectors(accumulator.selectors),
    }));
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
