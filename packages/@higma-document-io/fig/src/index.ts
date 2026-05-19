/**
 * @file @higma-document-io/fig main entry point
 *
 * IO entry points operate on the decoded Kiwi document. The loaded
 * nodeChanges array remains the SoT; the context index and SymbolResolver
 * are lookup services over that document, not converted documents.
 */

// NodeSpec discriminated union — declarative shape consumed by
// `addNode` / `createNodeFromSpec`. Lives in this package because the
// factory that materialises it lives here.
export type { NodeSpec, BaseNodeSpec } from "./types";

// Context
export {
  createFigDocumentContext,
  createFigDocumentContextFromLoaded,
  createFigDocumentContextFromKiwiCanvas,
  createFigDocumentContextFromNodeChanges,
  replaceFigDocumentContextNodeChanges,
  type FigDocumentContext,
  type CreateFigDocumentContextFromNodeChangesOptions,
  type ReplaceFigDocumentContextNodeChangesOptions,
  figDocumentResources,
  type FigDocumentResources,
} from "./context";

// Page operations
export {
  createEmptyFigDocument,
  addPage,
} from "./page-ops";

// Node operations
export {
  addNode,
  createNodeFromSpec,
} from "./node-ops";

// Export
export {
  exportFig,
  type FigExportOptions,
  type FigExportResult,
} from "./export";
