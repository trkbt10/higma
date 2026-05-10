/**
 * @file Context module exports
 */

export {
  createFigDesignDocument,
  createFigDesignDocumentFromLoaded,
  createFigDesignDocumentFromKiwiCanvas,
  createEmptyFigDesignDocument,
} from "./fig-context";

export { createDemoFigDesignDocument } from "./demo-document";

export { treeToDocument } from "./tree-to-document";

export { documentToTree, type DocumentToTreeResult } from "./document-to-tree";

export {
  createFigSymbolContext,
  createFigSymbolContextFromLoaded,
  type FigSymbolContext,
} from "./symbol-context";

export { findCanvas, findInternalCanvas } from "./canvas-lookup";

export {
  figDocumentResources,
  figRawResources,
  type FigDocumentResources,
  type FigRawResources,
} from "./document-resources";
