/** @file ESM API for publishing the Fig editor operation surface on globalThis. */
import {
  FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY,
  type FigEditorOperationSurfaceGlobalThis,
  type FigEditorOperationSurface,
} from "./fig-editor-operation-surface-types";

/** Read the Fig editor operation surface from globalThis. */
export function readFigEditorOperationSurfaceFromGlobalThis(): FigEditorOperationSurface | undefined {
  return (globalThis as FigEditorOperationSurfaceGlobalThis)[FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY];
}

/** Require the Fig editor operation surface from globalThis. */
export function requireFigEditorOperationSurfaceFromGlobalThis(): FigEditorOperationSurface {
  const surface = readFigEditorOperationSurfaceFromGlobalThis();
  if (surface === undefined) {
    throw new Error(`globalThis.${FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY} is not published`);
  }
  return surface;
}

/** Publish one Fig editor operation surface on globalThis. */
export function publishFigEditorOperationSurfaceOnGlobalThis(
  surface: FigEditorOperationSurface,
): () => void {
  const operationSurfaceGlobalThis = globalThis as FigEditorOperationSurfaceGlobalThis;
  const publishedSurface = operationSurfaceGlobalThis[FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY];
  if (publishedSurface !== undefined) {
    throw new Error(`globalThis.${FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY} is already published`);
  }
  operationSurfaceGlobalThis[FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY] = surface;
  return () => {
    if (operationSurfaceGlobalThis[FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY] !== surface) {
      throw new Error(`globalThis.${FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY} is not the published Fig editor operation surface`);
    }
    operationSurfaceGlobalThis[FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY] = undefined;
  };
}
