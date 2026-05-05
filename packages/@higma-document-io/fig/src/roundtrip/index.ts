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
  findNodeByName,
  findNodesByType,
  type FigImage,
  type FigMetadata,
  type LoadedFigFile,
  type SaveFigOptions,
} from "./fig-roundtrip";
