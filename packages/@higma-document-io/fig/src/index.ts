/**
 * @file @higma-document-io/fig main entry point
 *
 * High-level builder for .fig design files.
 * Provides FigDesignDocument model, CRUD operations, and export pipeline.
 */

// Builder-specific types
export type {
  NodeSpec,
  BaseNodeSpec,
  FigBuilderState,
} from "./types";

export {
  createFigBuilderState,
  createFigBuilderStateFromDocument,
} from "./types";

// Context
export {
  createFigDesignDocument,
  createFigDesignDocumentFromLoaded,
  createFigDesignDocumentFromKiwiCanvas,
  createEmptyFigDesignDocument,
  createFigSymbolContext,
  createFigSymbolContextFromLoaded,
  type FigSymbolContext,
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
  exportFigRoundtrip,
  type FigExportOptions,
  type FigExportResult,
} from "./export";

// Low-level fig file construction
export {
  createFigFile,
  frameNode,
  textNode,
  rectNode,
  roundedRectNode,
  ellipseNode,
  symbolNode,
  instanceNode,
} from "./fig-file";
