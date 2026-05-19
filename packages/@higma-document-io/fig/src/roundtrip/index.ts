/**
 * @file Roundtrip module exports
 *
 * Public entry point for loading and saving `.fig` files while
 * preserving the original Kiwi schema. The roundtrip layer exposes
 * load/save only; document mutation belongs to the Kiwi document context
 * construction APIs.
 */

export {
  loadFigFile,
  saveFigFile,
  type SaveFigOptions,
} from "./fig-roundtrip";
