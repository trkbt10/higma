/**
 * @file Framework-agnostic render projection.
 *
 * Owns the SceneGraph pipeline and derives everything the renderer/overlays
 * consume from one place: the SceneGraph, its bounds, the active drag
 * translation, the canvas extents, and the viewport render region. This is the
 * SoT for "what the renderer is told to draw" — the editor store composes it
 * so React never re-derives the SceneGraph or pushes bounds back into the store.
 *
 * The derivation here was lifted verbatim from FigEditorCanvas so behaviour is
 * unchanged; the only difference is ownership (store/closure instead of React
 * hooks). View/measurement inputs that only the DOM can supply (font resolver,
 * measured viewport, canvas-size overrides) are injected by the embedding React
 * layer; document/edit inputs come from the store's own state.
 */
import {
  createKiwiSceneGraphPipeline,
  createNodeId,
  flattenSceneGraphNodeBounds,
  type KiwiSceneGraphPipeline,
  type SceneGraph,
  type SceneGraphNodeTranslation,
} from "@higma-document-renderers/fig/scene-graph";
import { createFigFamilyRenderOptions, type FigFamilyRenderOptions } from "@higma-figma-runtime/react-renderer";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";
import type { FigDocumentContext, FigDocumentResources } from "@higma-document-io/fig";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import { guidToString } from "@higma-document-models/fig/domain";
import {
  resolveViewportRenderRegion,
  type ViewportRenderContext,
  type ViewportRenderRegion,
} from "../canvas/layout/viewport-render-region";
import { computeCanvasBoundsFromSceneGraphNodeBounds } from "../canvas/layout/canvas-bounds";
import { filterNodeBoundsForViewport } from "../canvas/layout/viewport-node-visibility";
import type { LayoutBounds } from "../canvas/layout/layout-bounds";
import {
  collectExplicitKiwiSourceDocumentGuidKeys,
  filterRenderedNodeBoundsToPrimaryKiwiDocument,
} from "../canvas/interaction/rendered-node-bounds";
import { translateFigEditorSelectedNodeDragBoundsList } from "./fig-editor-selected-node-drag-bounds";

const UNMEASURED_SCENE_GRAPH_SURFACE_SIZE = 0;

type SceneGraphNodeBounds = ReturnType<typeof flattenSceneGraphNodeBounds>[number];
type CanvasExtents = ReturnType<typeof computeCanvasBoundsFromSceneGraphNodeBounds>;

/** A pending high-frequency drag of one selected node, before it is committed. */
export type FigRenderProjectionDragTransform = {
  readonly guid: FigGuid;
  readonly dx: number;
  readonly dy: number;
};

/** DOM-measured view inputs the store cannot read directly. */
export type FigRenderEnvironment = {
  readonly textFontResolver?: TextFontResolver;
  readonly canvasWidthOverride?: number;
  readonly canvasHeightOverride?: number;
  readonly showHiddenNodes: boolean;
};

export const DEFAULT_FIG_RENDER_ENVIRONMENT: FigRenderEnvironment = Object.freeze({
  showHiddenNodes: false,
});

export type FigRenderProjectionInput = {
  // Document / edit state (store-owned)
  readonly page: FigNode | null | undefined;
  readonly context: FigDocumentContext;
  readonly resources: FigDocumentResources;
  readonly kiwiDocumentMutation: Parameters<KiwiSceneGraphPipeline["resolve"]>[0]["kiwiDocumentMutation"];
  readonly selectedGuids: readonly FigGuid[];
  readonly selectedFigNodeDragTransform: FigRenderProjectionDragTransform | null;
  // View / measurement (React-injected)
  readonly environment: FigRenderEnvironment;
  readonly viewportMeasurement: ViewportRenderContext | null;
};

export type FigEditorRenderProjection = {
  readonly sceneGraph: SceneGraph | null;
  readonly sceneGraphNodeTranslation: SceneGraphNodeTranslation | undefined;
  readonly renderRegion: ViewportRenderRegion | null;
  readonly viewportScale: number;
  readonly renderOptions: FigFamilyRenderOptions | undefined;
  readonly extents: CanvasExtents;
  readonly baseWorldBounds: readonly SceneGraphNodeBounds[];
  readonly basePrimaryWorldBounds: readonly SceneGraphNodeBounds[];
  readonly worldBounds: readonly SceneGraphNodeBounds[];
  readonly primaryWorldBounds: readonly SceneGraphNodeBounds[];
  readonly baseVisibleNodeBounds: readonly SceneGraphNodeBounds[];
  readonly visibleNodeBounds: readonly SceneGraphNodeBounds[];
};

export type FigEditorRenderProjectionResolver = {
  readonly resolve: (input: FigRenderProjectionInput) => FigEditorRenderProjection;
};

function viewportBoundsFromRenderRegion(renderRegion: ViewportRenderRegion | null): LayoutBounds | null {
  if (renderRegion === null) {
    return null;
  }
  return { x: renderRegion.x, y: renderRegion.y, width: renderRegion.width, height: renderRegion.height };
}

function dragBoundsTranslation(
  selectedFigNodeDragTransform: FigRenderProjectionDragTransform | null,
): { readonly draggedGuidKey: string; readonly dx: number; readonly dy: number } | undefined {
  if (selectedFigNodeDragTransform === null) {
    return undefined;
  }
  return {
    draggedGuidKey: guidToString(selectedFigNodeDragTransform.guid),
    dx: selectedFigNodeDragTransform.dx,
    dy: selectedFigNodeDragTransform.dy,
  };
}

function sameViewportMeasurement(
  left: ViewportRenderContext | null,
  right: ViewportRenderContext | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.viewport.translateX === right.viewport.translateX &&
    left.viewport.translateY === right.viewport.translateY &&
    left.viewport.scale === right.viewport.scale &&
    left.viewportSize.width === right.viewportSize.width &&
    left.viewportSize.height === right.viewportSize.height &&
    left.rulerThickness === right.rulerThickness;
}

function sameProjectionInput(left: FigRenderProjectionInput, right: FigRenderProjectionInput): boolean {
  // Reference equality for document/edit inputs (stable across unrelated
  // commits), value equality for the viewport measurement (rebuilt each call,
  // and crucially independent of the canvasViewport bounds so a bounds-only
  // change does not invalidate the cached projection — this is what prevents a
  // re-render feedback loop when a consumer echoes projection bounds back into
  // the canvas viewport snapshot).
  return left.page === right.page &&
    left.context === right.context &&
    left.resources === right.resources &&
    left.kiwiDocumentMutation === right.kiwiDocumentMutation &&
    left.selectedGuids === right.selectedGuids &&
    left.selectedFigNodeDragTransform === right.selectedFigNodeDragTransform &&
    left.environment === right.environment &&
    sameViewportMeasurement(left.viewportMeasurement, right.viewportMeasurement);
}

function applyDragBoundsTranslation(
  bounds: readonly SceneGraphNodeBounds[],
  nodesByGuid: ReadonlyMap<string, FigNode>,
  translation: { readonly draggedGuidKey: string; readonly dx: number; readonly dy: number } | undefined,
): readonly SceneGraphNodeBounds[] {
  if (translation === undefined) {
    return bounds;
  }
  return translateFigEditorSelectedNodeDragBoundsList(nodesByGuid, bounds, translation);
}

function resolveSceneGraphNodeTranslation(
  dragTransform: FigRenderProjectionDragTransform | null,
): SceneGraphNodeTranslation | undefined {
  if (dragTransform === null) {
    return undefined;
  }
  return { nodeId: createNodeId(guidToString(dragTransform.guid)), dx: dragTransform.dx, dy: dragTransform.dy };
}

function resolveProjectionSceneGraph(
  pipeline: KiwiSceneGraphPipeline,
  input: FigRenderProjectionInput,
  renderRegion: ViewportRenderRegion | null,
  canvasWidth: number,
  canvasHeight: number,
): SceneGraph | null {
  const { page } = input;
  if (page === null || page === undefined) {
    return null;
  }
  return pipeline.resolve({
    page,
    nodes: input.resources.childrenOf(page),
    kiwiDocumentMutation: input.kiwiDocumentMutation,
    canvasWidth: renderRegion?.surfaceWidth ?? canvasWidth,
    canvasHeight: renderRegion?.surfaceHeight ?? canvasHeight,
    viewportX: renderRegion?.x ?? 0,
    viewportY: renderRegion?.y ?? 0,
    viewportWidth: renderRegion?.width ?? canvasWidth,
    viewportHeight: renderRegion?.height ?? canvasHeight,
    showHiddenNodes: input.environment.showHiddenNodes,
    resources: input.resources,
    textFontResolver: input.environment.textFontResolver,
  });
}

/** Create a render-projection resolver that owns one SceneGraph pipeline instance. */
export function createFigEditorRenderProjection(): FigEditorRenderProjectionResolver {
  const pipeline = createKiwiSceneGraphPipeline();
  const memo = { value: null as { readonly input: FigRenderProjectionInput; readonly output: FigEditorRenderProjection } | null };

  function resolve(input: FigRenderProjectionInput): FigEditorRenderProjection {
    const cached = memo.value;
    if (cached !== null && sameProjectionInput(cached.input, input)) {
      return cached.output;
    }
    const output = computeProjection(input);
    memo.value = { input, output };
    return output;
  }

  function computeProjection(input: FigRenderProjectionInput): FigEditorRenderProjection {
    const {
      context,
      selectedGuids,
      selectedFigNodeDragTransform,
      environment,
      viewportMeasurement,
    } = input;

    const selectedGuidKeys = selectedGuids.map(guidToString);
    const renderRegion = resolveViewportRenderRegion({ context: viewportMeasurement });
    const canvasWidth = environment.canvasWidthOverride ?? UNMEASURED_SCENE_GRAPH_SURFACE_SIZE;
    const canvasHeight = environment.canvasHeightOverride ?? UNMEASURED_SCENE_GRAPH_SURFACE_SIZE;

    const sceneGraph = resolveProjectionSceneGraph(pipeline, input, renderRegion, canvasWidth, canvasHeight);

    const baseWorldBounds = sceneGraph === null ? [] : flattenSceneGraphNodeBounds(sceneGraph);
    const explicitSourceGuidKeys = collectExplicitKiwiSourceDocumentGuidKeys(context.kiwiSourceDocuments);
    const basePrimaryWorldBounds = filterRenderedNodeBoundsToPrimaryKiwiDocument({
      document: context.document,
      explicitSourceGuidKeys,
      bounds: baseWorldBounds,
      owner: "FigEditorRenderProjection",
    });

    const translation = dragBoundsTranslation(selectedFigNodeDragTransform);
    const worldBounds = applyDragBoundsTranslation(baseWorldBounds, context.document.nodesByGuid, translation);
    const primaryWorldBounds = applyDragBoundsTranslation(basePrimaryWorldBounds, context.document.nodesByGuid, translation);

    const computedExtents = computeCanvasBoundsFromSceneGraphNodeBounds(worldBounds);
    const extents: CanvasExtents = {
      ...computedExtents,
      width: environment.canvasWidthOverride ?? computedExtents.width,
      height: environment.canvasHeightOverride ?? computedExtents.height,
    };

    const viewportBounds = viewportBoundsFromRenderRegion(renderRegion);
    const baseVisibleNodeBounds = filterNodeBoundsForViewport({
      bounds: basePrimaryWorldBounds,
      viewport: viewportBounds,
      selectedNodeGuidKeys: selectedGuidKeys,
    });
    const visibleNodeBounds = filterNodeBoundsForViewport({
      bounds: primaryWorldBounds,
      viewport: viewportBounds,
      selectedNodeGuidKeys: selectedGuidKeys,
    });

    return {
      sceneGraph,
      sceneGraphNodeTranslation: resolveSceneGraphNodeTranslation(selectedFigNodeDragTransform),
      renderRegion,
      viewportScale: viewportMeasurement?.viewport.scale ?? 1,
      renderOptions: createFigFamilyRenderOptions(context),
      extents,
      baseWorldBounds,
      basePrimaryWorldBounds,
      worldBounds,
      primaryWorldBounds,
      baseVisibleNodeBounds,
      visibleNodeBounds,
    };
  }

  return { resolve };
}
