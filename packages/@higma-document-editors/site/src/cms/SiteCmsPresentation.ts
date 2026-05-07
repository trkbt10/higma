/**
 * @file UI display-name helpers for CMS domain entities.
 *
 * The site document SoT does not store human-friendly names for collections,
 * fields, or items — those live in the CMS backend that built the .site file.
 * This module is the single, explicit place where the UI synthesises a
 * presentable label, so that no fallback / heuristic leaks into the domain.
 */

import { getSiteCollectionFieldKindLabel } from "../domain/site-collection-field-kind";
import type {
  SiteCollection,
  SiteCollectionField,
  SiteCollectionItem,
} from "../domain/site-collections";

const ITEM_DISPLAY_TRIM = 60;
const COLLECTION_PLACEHOLDER = "Untitled collection";
const ITEM_CONTEXT_PLACEHOLDER = "Untitled item";

function trimDisplayText(text: string): string {
  if (text.length > ITEM_DISPLAY_TRIM) {
    return `${text.slice(0, ITEM_DISPLAY_TRIM)}…`;
  }
  return text;
}

/** Pick a UI label for a collection from its selectors, or fall back to a positional placeholder. */
export function getSiteCollectionDisplayName(collection: SiteCollection, indexInWorkspace: number): string {
  const namedSelector = collection.selectors.find((selector) => selector.nodeName.trim() !== "");
  if (namedSelector) {
    return namedSelector.nodeName;
  }
  if (collection.id.length <= 32) {
    return collection.id;
  }
  if (indexInWorkspace >= 0) {
    return `${COLLECTION_PLACEHOLDER} ${indexInWorkspace + 1}`;
  }
  return COLLECTION_PLACEHOLDER;
}

/** Build a UI label for a field from its kind and ordinal position in the collection. */
export function getSiteCollectionFieldDisplayName(
  field: SiteCollectionField,
  indexInCollection: number,
): string {
  return `${getSiteCollectionFieldKindLabel(field.kind)} ${indexInCollection + 1}`;
}

/** Pick a UI label for an item from its first non-empty text value, or fall back. */
export function getSiteCollectionItemDisplayName(item: SiteCollectionItem): string {
  const firstWithText = item.values.find((value) => value.text !== null && value.text.trim() !== "");
  if (firstWithText && firstWithText.text !== null) {
    return trimDisplayText(firstWithText.text.trim());
  }
  if (item.id !== "") {
    return item.id;
  }
  return ITEM_CONTEXT_PLACEHOLDER;
}
