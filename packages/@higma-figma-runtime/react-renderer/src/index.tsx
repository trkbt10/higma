/** @file React renderer boundary for decoded fig-family Kiwi documents. */

import { useMemo, useRef } from "react";
import {
  createFigDocumentContextFromKiwiCanvas,
  figDocumentResources,
  type CreateFigDocumentContextOptions,
  type FigDocumentContext,
  type FigDocumentResources,
} from "@higma-document-io/fig";
import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import {
  createKiwiSceneGraphPipeline,
  type KiwiSceneGraphMutation,
  type KiwiSceneGraphPipeline,
} from "@higma-document-renderers/fig/scene-graph";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph/model";
import type { FigmaExportColorProfile } from "@higma-codecs/raster";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import { FigSceneSvgRenderer } from "@higma-document-renderers/fig/react";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";

/** Kiwi canvas input accepted by the fig family React renderer boundary. */
export type FigFamilyKiwiCanvas = Parameters<typeof createFigDocumentContextFromKiwiCanvas>[0];

/** Render options derived from the decoded fig document context. */
export type FigFamilyRenderOptions = Exclude<ReturnType<typeof createFigFamilyRenderOptions>, undefined>;

/** Decode a Kiwi canvas into the fig document context consumed by renderers. */
export function createFigFamilyDocumentContext(
  canvas: FigFamilyKiwiCanvas,
  options?: CreateFigDocumentContextOptions,
): FigDocumentContext {
  return createFigDocumentContextFromKiwiCanvas(canvas, options);
}

/** Fig document context produced by the fig family runtime boundary. */
export type FigFamilyDocumentContext = ReturnType<typeof createFigFamilyDocumentContext>;

/** Fig page node obtained from a fig family document context. */
export type FigFamilyPage = ReturnType<FigFamilyDocumentContext["document"]["childrenOf"]>[number];

/** Fig node exposed through the fig family runtime boundary. */
export type FigFamilyNode = ReturnType<FigFamilyDocumentContext["document"]["childrenOf"]>[number];

/** Read the Kiwi GUID key used by fig family render-plan references. */
export function readFigFamilyNodeGuidKey(node: FigFamilyNode): string {
  if (node.guid === undefined) {
    throw new Error(`Fig family node requires guid: ${node.name ?? "(unnamed)"}`);
  }
  return guidToString(node.guid);
}

/** Read the Kiwi node type used by fig family document traversal. */
export function readFigFamilyNodeType(node: FigFamilyNode): ReturnType<typeof getNodeType> {
  return getNodeType(node);
}

/** Build document resources consumed by the shared SceneGraph builder. */
export function createFigFamilyDocumentResources(ctx: FigFamilyDocumentContext): FigDocumentResources {
  return figDocumentResources(ctx);
}

function readDocumentColorProfile(ctx: FigFamilyDocumentContext): FigNode["documentColorProfile"] {
  for (const root of ctx.document.roots) {
    if (getNodeType(root) === "DOCUMENT") {
      return root.documentColorProfile;
    }
  }
  return undefined;
}

function mapDocumentColorProfile(profile: FigNode["documentColorProfile"]): FigmaExportColorProfile | undefined {
  if (!profile) {
    return undefined;
  }
  switch (profile.name) {
    case "SRGB":
      return "SRGB";
    case "DISPLAY_P3":
    case "DISPLAY_P3_V4":
    case "P3":
      throw new Error("Fig family Display P3 rendering requires explicit exportSettings.displayP3IccProfile");
    case "DOCUMENT":
      throw new Error("Fig family rendering requires a concrete documentColorProfile, got DOCUMENT");
    default:
      throw new Error(`Unsupported fig documentColorProfile ${profile.name}`);
  }
}

const SRGB_EXPORT_SETTINGS = Object.freeze({ colorProfile: "SRGB" as const });
const SRGB_RENDER_OPTIONS: SceneGraphRenderOptions = Object.freeze({
  exportSettings: SRGB_EXPORT_SETTINGS,
});

/** Resolve renderer options from Kiwi document-level rendering metadata. */
export function createFigFamilyRenderOptions(ctx: FigFamilyDocumentContext): SceneGraphRenderOptions | undefined {
  const colorProfile = mapDocumentColorProfile(readDocumentColorProfile(ctx));
  if (!colorProfile) {
    return undefined;
  }
  if (colorProfile === "SRGB") {
    return SRGB_RENDER_OPTIONS;
  }
  return { exportSettings: { colorProfile } };
}

/** Inputs required to build the shared renderer-neutral SceneGraph. */
export type UseFigSceneGraphParams = {
  readonly page: FigNode | null | undefined;
  readonly nodes?: readonly FigNode[];
  readonly kiwiDocumentMutation: KiwiSceneGraphMutation;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly viewportX: number;
  readonly viewportY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly showHiddenNodes: boolean;
  readonly resources: FigDocumentResources;
  readonly textFontResolver?: TextFontResolver;
};

/** Props for rendering one already-resolved fig-family SceneGraph. */
export type FigFamilyPageRendererProps = {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
};

/** Build the renderer-neutral SceneGraph consumed by React, SVG, and WebGL. */
export function useFigSceneGraph({
  page,
  nodes,
  kiwiDocumentMutation,
  canvasWidth,
  canvasHeight,
  viewportX,
  viewportY,
  viewportWidth,
  viewportHeight,
  showHiddenNodes,
  resources,
  textFontResolver,
}: UseFigSceneGraphParams): SceneGraph | null {
  const pipelineRef = useRef<KiwiSceneGraphPipeline | undefined>(undefined);
  if (pipelineRef.current === undefined) {
    pipelineRef.current = createKiwiSceneGraphPipeline();
  }
  const pipeline = pipelineRef.current;
  return useMemo(() => {
    return pipeline.resolve({
      page,
      nodes,
      kiwiDocumentMutation,
      canvasWidth,
      canvasHeight,
      viewportX,
      viewportY,
      viewportWidth,
      viewportHeight,
      showHiddenNodes,
      resources,
      textFontResolver,
    });
  }, [pipeline, page, nodes, kiwiDocumentMutation, resources, textFontResolver, canvasWidth, canvasHeight, viewportX, viewportY, viewportWidth, viewportHeight, showHiddenNodes]);
}

/** Render a fig-family page as React-owned SVG nodes. */
export function FigFamilyPageRenderer({
  sceneGraph,
  renderOptions,
}: FigFamilyPageRendererProps) {
  if (!sceneGraph) {
    return <g data-fig-family-page-renderer-empty="" />;
  }

  return (
    <FigSceneSvgRenderer
      sceneGraph={sceneGraph}
      renderOptions={renderOptions}
      rootProps={{
        "data-fig-family-page-renderer": "",
        pointerEvents: "none",
        "aria-hidden": true,
      }}
    />
  );
}
