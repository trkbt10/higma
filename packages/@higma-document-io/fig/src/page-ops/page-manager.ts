/**
 * @file Page CRUD operations on FigDesignDocument
 *
 * All operations are pure functions that return new document instances.
 * Pages map to CANVAS nodes in the .fig format.
 */

import type { FigDesignDocument, FigDesignNode, FigPage, FigPageId } from "@higma-document-models/fig/domain";
import { DEFAULT_PAGE_BACKGROUND } from "@higma-document-models/fig/domain";
import { nextNodeId, nextPageId } from "../types/node-id";
import type { FigBuilderState } from "../types/node-id";

// =============================================================================
// Add Page
// =============================================================================

/**
 * AddPageOptions carries explicit builder state, document, and page name input.
 */
type AddPageOptions = {
  readonly state: FigBuilderState;
  readonly doc: FigDesignDocument;
  readonly name: string;
};

/**
 * Add a new empty page to the document.
 *
 * @returns Updated document and the new page's ID
 */
export function addPage(
  { state, doc, name }: AddPageOptions,
): { readonly doc: FigDesignDocument; readonly pageId: FigPageId } {
  assertBuilderState(state, "addPage");
  assertNonEmptyString(name, "addPage name");
  const pageId = nextPageId(state.pageIdCounter);

  const page: FigPage = {
    id: pageId,
    name,
    backgroundColor: DEFAULT_PAGE_BACKGROUND,
    children: [],
  };

  return {
    doc: { ...doc, pages: [...doc.pages, page] },
    pageId,
  };
}

// =============================================================================
// Remove Page
// =============================================================================

/**
 * Remove a page from the document.
 *
 * If the document has only one page, this is a no-op (documents must
 * have at least one page).
 */
export function removePage(
  doc: FigDesignDocument,
  pageId: FigPageId,
): FigDesignDocument {
  if (doc.pages.length <= 1) {
    return doc;
  }

  const pages = doc.pages.filter((p) => p.id !== pageId);
  return { ...doc, pages };
}

// =============================================================================
// Reorder Page
// =============================================================================

/**
 * Move a page to a new position within the document.
 *
 * @param newIndex - Target index (clamped to valid range)
 */
export function reorderPage(
  doc: FigDesignDocument,
  pageId: FigPageId,
  newIndex: number,
): FigDesignDocument {
  const currentIndex = doc.pages.findIndex((p) => p.id === pageId);
  if (currentIndex === -1) {
    return doc;
  }

  const clampedIndex = Math.max(0, Math.min(newIndex, doc.pages.length - 1));
  if (currentIndex === clampedIndex) {
    return doc;
  }

  const pages = [...doc.pages];
  const [page] = pages.splice(currentIndex, 1);
  pages.splice(clampedIndex, 0, page);

  return { ...doc, pages };
}

// =============================================================================
// Duplicate Page
// =============================================================================

/**
 * DuplicatePageOptions carries explicit builder state, document, source page identifier, and duplicate page name input.
 */
type DuplicatePageOptions = {
  readonly state: FigBuilderState;
  readonly doc: FigDesignDocument;
  readonly pageId: FigPageId;
  readonly name: string;
};

/**
 * Duplicate a page and all its contents.
 *
 * The duplicated page is inserted immediately after the original.
 * All node IDs in the duplicate are regenerated to ensure uniqueness.
 */
export function duplicatePage(
  { state, doc, pageId, name }: DuplicatePageOptions,
): { readonly doc: FigDesignDocument; readonly newPageId: FigPageId } {
  assertBuilderState(state, "duplicatePage");
  assertNonEmptyString(name, "duplicatePage name");
  const sourceIndex = doc.pages.findIndex((p) => p.id === pageId);
  if (sourceIndex === -1) {
    throw new Error(`duplicatePage failed: page ${pageId} was not found`);
  }

  const source = doc.pages[sourceIndex];
  const newPageId = nextPageId(state.pageIdCounter);

  // Deep clone children with new IDs
  const clonedChildren = deepCloneNodes(state, source.children);

  const newPage: FigPage = {
    id: newPageId,
    name,
    backgroundColor: source.backgroundColor,
    children: clonedChildren,
  };

  const pages = [...doc.pages];
  pages.splice(sourceIndex + 1, 0, newPage);

  return {
    doc: { ...doc, pages },
    newPageId,
  };
}

// =============================================================================
// Rename Page
// =============================================================================

/**
 * Rename a page.
 */
export function renamePage(
  doc: FigDesignDocument,
  pageId: FigPageId,
  name: string,
): FigDesignDocument {
  const pages = doc.pages.map((page) =>
    page.id === pageId ? { ...page, name } : page,
  );
  return { ...doc, pages };
}

// =============================================================================
// Deep Clone Helpers
// =============================================================================

/**
 * Deep clone a list of design nodes, regenerating all IDs.
 */
function deepCloneNodes(
  state: FigBuilderState,
  nodes: readonly FigDesignNode[],
): FigDesignNode[] {
  return nodes.map((node) => {
    const newId = nextNodeId(state.nodeIdCounter);
    return {
      ...node,
      id: newId,
      children: node.children ? deepCloneNodes(state, node.children) : undefined,
      _raw: undefined, // Clone loses raw data (different IDs)
    };
  });
}

/**
 * assertBuilderState rejects missing explicit builder state for page operations.
 */
function assertBuilderState(state: FigBuilderState, caller: string): void {
  if (!state) {
    throw new Error(`${caller} requires explicit builder state`);
  }
}

/**
 * assertNonEmptyString rejects missing required page name input.
 */
function assertNonEmptyString(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}
