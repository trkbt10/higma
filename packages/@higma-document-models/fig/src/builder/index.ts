/**
 * @file Model-layer construction primitives for `FigDesignDocument`.
 *
 * This module owns the **shape-level** pure-function mutations:
 * - `FigBuilderState` and ID counters (`nextNodeId` / `nextPageId`) —
 *   the canonical allocator carried alongside document construction.
 * - `addImage` / `addBlob` — registry-level mutations on the document
 *   shape that don't depend on io-layer concepts.
 *
 * The full **construction API** (`createEmptyFigDesignDocument`,
 * `addPage`, `addNode`, `updateNode`, `exportFig`, etc.) lives at the
 * io layer in `@higma-document-io/fig` because it needs the
 * io-specific `NodeSpec` discriminated union and the factory that
 * materialises specs into `FigDesignNode`s. There is intentionally
 * no parallel construction surface at the model layer; consumers
 * must go through the io entry point.
 */

export type {
  CreateFigBuilderStateFromDocumentOptions,
  CreateFigBuilderStateOptions,
  CreateIdCounterOptions,
  FigBuilderState,
  IdCounter,
} from "./id-counter";

export {
  createFigBuilderState,
  createFigBuilderStateFromDocument,
  createIdCounter,
  nextNodeId,
  nextPageId,
} from "./id-counter";

export {
  addBlob,
  addImage,
} from "./document-builder";
