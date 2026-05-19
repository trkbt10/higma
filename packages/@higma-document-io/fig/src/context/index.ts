/**
 * @file Context module exports
 */

export {
  createFigDocumentContext,
  createFigDocumentContextFromLoaded,
  createFigDocumentContextFromKiwiCanvas,
  createFigDocumentContextFromNodeChanges,
  replaceFigDocumentContextNodeChanges,
  type FigDocumentContext,
  type CreateFigDocumentContextFromNodeChangesOptions,
  type ReplaceFigDocumentContextNodeChangesOptions,
} from "./document-context";

export { findCanvas, findInternalCanvas } from "./canvas-lookup";

export {
  figDocumentResources,
  type FigDocumentResources,
} from "./document-resources";
