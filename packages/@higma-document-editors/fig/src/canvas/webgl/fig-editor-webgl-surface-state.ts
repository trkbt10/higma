/** @file Runtime WebGL surface state exposed to the Fig editor operation surface. */
import type {
  WebGLFigmaRendererMetrics,
  WebGLViewportSceneViewport,
  WebGLViewportPreparationStatus,
} from "@higma-document-renderers/fig/webgl";

export type FigEditorWebGLSurfaceKind = "viewport" | "root";

export type FigEditorWebGLSurfaceIdentity = {
  readonly surfaceKey: string;
  readonly kind: FigEditorWebGLSurfaceKind;
  readonly label: string;
  readonly rootGuidKey?: string;
};

export type FigEditorWebGLSurfaceSnapshot = FigEditorWebGLSurfaceIdentity & {
  readonly ready: boolean;
  readonly status: WebGLViewportPreparationStatus;
  readonly pixelRatio: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly kiwiDocumentMutationRevision: number | undefined;
  readonly kiwiDocumentMutationChangedGuidKeys: readonly string[];
  readonly controllerInputRevision: number;
  readonly controllerInputSceneViewport: WebGLViewportSceneViewport | undefined;
  readonly controllerInputKiwiDocumentMutationRevision: number | undefined;
  readonly controllerInputKiwiDocumentMutationChangedGuidKeys: readonly string[];
  readonly renderRevision: number;
  readonly lastRenderedSceneViewport: WebGLViewportSceneViewport | undefined;
  readonly lastRenderedKiwiDocumentMutationRevision: number | undefined;
  readonly lastRenderedKiwiDocumentMutationChangedGuidKeys: readonly string[];
  readonly metricsRevision: number;
  readonly metrics: WebGLFigmaRendererMetrics | undefined;
};

export type FigEditorWebGLSurfaceState = FigEditorWebGLSurfaceSnapshot;
