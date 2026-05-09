/**
 * @file Roundtrip module exports
 *
 * For loading, modifying, and saving .fig files while preserving
 * original schema compatibility.
 */

export {
  loadFigFile,
  saveFigFile,
  cloneFigFile,
  addNodeChange,
  patchNodeChange,
  createGuidAllocator,
  findNodeByName,
  findNodesByType,
  type SaveFigOptions,
  type GuidAllocator,
} from "./fig-roundtrip";
