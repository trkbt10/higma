/**
 * @file Public exports for the Kiwi-backed Fig editor package.
 */
export { FigEditor, type FigEditorProps } from "./editor/FigEditor";
export {
  createFigEditorStore,
  useFigEditor,
  useFigEditorCanvasViewport,
  useFigEditorOptional,
  useFigEditorOperationSurface,
  useFigEditorSelector,
  useFigEditorSelectedFigNodeDragTransform,
  useFigEditorSnapshotReader,
  FigEditorStoreProvider,
  type FigEditorContextSelectionEquality,
  type FigEditorContextSelector,
  type FigEditorContextValue,
  type FigEditorStore,
  type FigEditorStoreProviderProps,
} from "./context/FigEditorContext";
export {
  createGlobalThisPublishedFigEditorStore,
  type GlobalThisPublishedFigEditorStore,
} from "./context/fig-editor-store-global-this-publication";
export {
  FigEditorCanvas,
  type FigEditorCanvasProps,
  type FigEditorViewport,
} from "./canvas/FigEditorCanvas";
export { useFigFileLoad, type UseFigFileLoadResult } from "./hooks/use-fig-file-load";
export { useExportFig, type UseExportFigResult } from "./hooks/use-export-fig";
export {
  useFigDocumentResources,
} from "./hooks/use-fig-document-resources";
export {
  FigInspectorProvider,
  useFigInspectorContextOptional,
  type FigInspectorContextValue,
  type FigInspectorProviderProps,
} from "./inspector";
export {
  publishFigEditorOperationSurfaceOnGlobalThis,
  readFigEditorOperationSurfaceFromGlobalThis,
  requireFigEditorOperationSurfaceFromGlobalThis,
} from "./operation-surface/fig-editor-global-this-operation-surface";
export {
  FIG_EDITOR_OPERATION_SURFACE_VERSION,
  FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY,
  type FigEditorOperationSurface,
  type FigEditorOperationSurfaceDocumentSnapshot,
  type FigEditorOperationSurfaceGlobalThis,
  type FigEditorOperationSurfaceGuidInput,
  type FigEditorOperationSurfaceNodeQuery,
  type FigEditorOperationSurfaceNodeSelector,
  type FigEditorOperationSurfaceNodeBoundsSnapshot,
  type FigEditorOperationSurfaceNodeViewportPoint,
  type FigEditorOperationSurfaceViewportDelta,
  type FigEditorOperationSurfaceViewportPoint,
  type FigEditorOperationSurfaceCanvasHitSnapshot,
  type FigEditorOperationSurfaceNodeSnapshot,
  type FigEditorOperationSurfaceSymbolResolutionSnapshot,
} from "./operation-surface/fig-editor-operation-surface-types";
export {
  type FigEditorWebGLSurfaceSnapshot,
} from "./canvas/webgl/fig-editor-webgl-surface-state";
