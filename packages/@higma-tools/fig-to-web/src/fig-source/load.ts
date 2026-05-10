/**
 * @file Decode a `.fig` buffer into a symbol-resolved context.
 *
 * `loadFigSource` is the converter-friendly name for the underlying
 * `createFigSymbolContext` from `@higma-document-io/fig/context`. The
 * alias used to live in a shared `@higma-tools/fig-source` package
 * shared across `fig-to-web`, `fig-to-swiftui`, and `fig-to-godot`,
 * but the same-scope sibling-import boundary rule forbids that. The
 * three converters now each keep this 3-line wrapper locally — the
 * underlying canvas-lookup helpers (`findCanvas`,
 * `findInternalCanvas`) live in `@higma-document-io/fig/context`
 * where they always operated, so `loadFigSource` is the only piece
 * each converter still owns.
 */
import { createFigSymbolContext, type FigSymbolContext } from "@higma-document-io/fig/context";

export async function loadFigSource(buffer: Uint8Array): Promise<FigSymbolContext> {
  return createFigSymbolContext(buffer);
}
