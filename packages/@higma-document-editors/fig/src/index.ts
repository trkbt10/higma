/**
 * @file Public exports for the Kiwi-backed Fig editor package.
 */
export { FigEditor, type FigEditorProps } from "./editor/FigEditor";
export {
  FigEditorProvider,
  useFigEditor,
  useFigEditorOptional,
  type FigEditorContextValue,
  type FigEditorProviderProps,
} from "./context/FigEditorContext";
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
