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
export type {
  NodeSpec,
  BaseNodeSpec,
  KiwiStackLayoutFields,
  KiwiChildLayoutFields,
  PaintSpec,
  SolidPaintSpec,
  GradientPaintSpec,
  ImagePaintSpec,
  EffectSpec,
  RequiredNodeDisplayField,
} from "./types";

// Paint / effect spec helpers. `asFigPaint` lifts a spec-form entry
// in `NodeSpec.fills` / `NodeSpec.strokes` to the wire-format
// `FigPaint` (callers that want to use the paint accessors in
// `@higma-document-models/fig/color`).
export { asFigPaint, isPaintSpec, paintSpecToFig } from "./node-ops/paint-spec";
export { isEffectSpec, effectSpecToFig } from "./node-ops/effect-spec";

// SoT for "every non-DOCUMENT FigNode carries these display fields";
// spec types and lint rules both reference these names so the contract
// stays in lockstep.
export {
  REQUIRED_NODE_DISPLAY_FIELDS,
  DEFAULT_DISPLAY_FIELDS,
  nodeRequiresDisplayFields,
} from "./types";

// Context
export {
  createFigDocumentContext,
  createFigDocumentContextFromLoaded,
  createFigDocumentContextFromKiwiCanvas,
  createFigDocumentContextFromNodeChanges,
  addBlobToFigDocumentContext,
  addImageToFigDocumentContext,
  replaceFigDocumentContextNodeChanges,
  replaceFigDocumentContextNodeChangesAfterTransformOnlyEdit,
  type FigDocumentContext,
  type FigDocumentContextKiwiSourceDocument,
  type FigDocumentContextNodeContentEdit,
  type CreateFigDocumentContextOptions,
  type CreateFigDocumentContextFromNodeChangesOptions,
  type AddFigDocumentBlobOptions,
  type AddFigDocumentImageOptions,
  type ReplaceFigDocumentContextNodeChangesOptions,
  type ReplaceFigDocumentContextTransformOnlyNodeChangesOptions,
  findCanvas,
  findCanvases,
  requireCanvas,
  requireInternalCanvas,
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
  updateNode,
  createNodeFromSpec,
} from "./node-ops";

// Export
export {
  exportFig,
  type FigExportOptions,
  type FigExportResult,
} from "./export";
