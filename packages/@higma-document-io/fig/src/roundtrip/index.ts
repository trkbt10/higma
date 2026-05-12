/**
 * @file Roundtrip module exports
 *
 * Public entry point for loading and saving `.fig` files while
 * preserving the original Kiwi schema. The legacy primitives
 * (`addNodeChange`, `patchNodeChange`, `addBlob`, `cloneFigFile`,
 * `createGuidAllocator`, `findNodeByName`, `findNodesByType`) were
 * intentionally de-exported in Phase 3-B of the SoT consolidation —
 * the canonical document construction surface is now
 * `createEmptyFigDesignDocument` + `addNode` + `exportFig` (see
 * the package README). Use the document API for mutations; the
 * roundtrip layer is read-only at the public boundary.
 */

export {
  loadFigFile,
  saveFigFile,
  type SaveFigOptions,
} from "./fig-roundtrip";
