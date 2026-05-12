/**
 * @file @higma-document-io/fig main entry point
 *
 * High-level builder for .fig design files. Provides `FigDesignDocument`
 * CRUD operations and the export pipeline. Builder ID utilities
 * (`FigBuilderState`, `createFigBuilderState`, `nextNodeId`,
 * `nextPageId`) live in `@higma-document-models/fig/builder` —
 * consumers must import them directly from there (the cross-package
 * re-export ban prevents publishing them through a second name).
 *
 * Domain types (`FigDesignDocument`, `FigDesignNode`, `FigPage`,
 * `FigNodeId`, `FigPageId`) live in `@higma-document-models/fig/domain`.
 */

// NodeSpec discriminated union — declarative shape consumed by
// `addNode` / `createNodeFromSpec`. Lives in this package because the
// factory that materialises it lives here.
export type { NodeSpec, BaseNodeSpec } from "./types";

// Context
export {
  createFigDesignDocument,
  createFigDesignDocumentFromLoaded,
  createFigDesignDocumentFromKiwiCanvas,
  createEmptyFigDesignDocument,
  createFigSymbolContext,
  createFigSymbolContextFromLoaded,
  type FigSymbolContext,
  figDocumentResources,
  figRawResources,
  type FigDocumentResources,
  type FigRawResources,
} from "./context";

// Page operations
export {
  addPage,
  removePage,
  reorderPage,
  duplicatePage,
  renamePage,
} from "./page-ops";

// Node operations
export {
  addNode,
  removeNode,
  updateNode,
  reorderNode,
  moveNodeToPage,
  createNodeFromSpec,
} from "./node-ops";

// Export
export {
  exportFig,
  type FigExportOptions,
  type FigExportResult,
} from "./export";

