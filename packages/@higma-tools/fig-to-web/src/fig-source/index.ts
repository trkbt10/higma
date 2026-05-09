/**
 * @file Public entry for fig-source — raw FigNode loading.
 *
 * The "loaded fig + derived maps" shape is owned by
 * `@higma-document-io/fig/context` (`FigSymbolContext`). Consumers that need
 * the type must import it directly from there — this entry deliberately
 * does not re-publish it.
 */
export { loadFigSource, findCanvas, findInternalCanvas } from "./load";
