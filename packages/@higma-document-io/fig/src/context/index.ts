/**
 * @file Context module exports
 */

export {
  createFigDocumentContext,
  createFigDocumentContextFromLoaded,
  createFigDocumentContextFromKiwiCanvas,
  createFigDocumentContextFromNodeChanges,
  type FigDocumentContext,
  type CreateFigDocumentContextFromNodeChangesOptions,
} from "./document-context";

export { findCanvas, findInternalCanvas } from "./canvas-lookup";

export {
  figDocumentResources,
  type FigDocumentResources,
} from "./document-resources";
