/**
 * @file Context module exports
 */

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
} from "./document-context";

export { findCanvas, findCanvases, findInternalCanvas, requireCanvas, requireInternalCanvas } from "./canvas-lookup";

export {
  figDocumentResources,
  type FigDocumentResources,
} from "./document-resources";
