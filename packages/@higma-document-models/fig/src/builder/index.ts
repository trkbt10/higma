/**
 * @file Model-layer construction primitives for Kiwi fig documents.
 *
 * This module owns the **shape-level** pure-function mutations:
 * - `FigBuilderState` and GUID counters (`nextNodeGuid` / `nextPageGuid`) —
 *   the canonical allocator carried alongside Kiwi document construction.
 * The full **construction API** (`createEmptyFigDocument`,
 * `addPage`, `addNode`, `updateNode`, `exportFig`, etc.) lives at the
 * io layer in `@higma-document-io/fig` because it needs the
 * io-specific `NodeSpec` discriminated union and the factory that
 * materialises specs into Kiwi `FigNode`s. There is intentionally
 * no parallel construction surface at the model layer; consumers
 * must go through the io entry point.
 */

export type {
  CreateFigBuilderStateFromDocumentOptions,
  CreateFigBuilderStateOptions,
  CreateGuidCounterOptions,
  FigBuilderState,
  GuidCounter,
} from "./guid-counter";

export {
  createFigBuilderState,
  createFigBuilderStateFromDocument,
  createGuidCounter,
  nextNodeGuid,
  nextPageGuid,
} from "./guid-counter";
