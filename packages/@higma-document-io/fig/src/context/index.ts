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
  type FigDocumentContext,
  type CreateFigDocumentContextFromNodeChangesOptions,
  type AddFigDocumentBlobOptions,
  type AddFigDocumentImageOptions,
  type ReplaceFigDocumentContextNodeChangesOptions,
} from "./document-context";

export { findCanvas, findCanvases, findInternalCanvas, requireCanvas, requireInternalCanvas } from "./canvas-lookup";

export {
  figDocumentResources,
  type FigDocumentResources,
} from "./document-resources";
