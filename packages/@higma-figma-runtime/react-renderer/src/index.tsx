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
import { getNodeType } from "@higma-document-models/fig/domain";
import {
  buildSceneGraphWithCache,
  pruneSceneGraphToViewport,
  type BuildSceneGraphOptions,
  type SceneGraphBuildCache,
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

/** Resolve renderer options from Kiwi document-level rendering metadata. */
export function createFigFamilyRenderOptions(ctx: FigFamilyDocumentContext): SceneGraphRenderOptions | undefined {
  const colorProfile = mapDocumentColorProfile(readDocumentColorProfile(ctx));
  if (!colorProfile) {
    return undefined;
  }
  return { exportSettings: { colorProfile } };
}

/** Inputs required to build the shared renderer-neutral SceneGraph. */
export type UseFigSceneGraphParams = {
  readonly page: FigNode | null | undefined;
  readonly nodes?: readonly FigNode[];
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly viewportX?: number;
  readonly viewportY?: number;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly resources: FigDocumentResources;
  readonly textFontResolver?: TextFontResolver;
};

/** Props for rendering a fig page from Kiwi resources or a prebuilt SceneGraph. */
export type FigFamilyPageRendererProps = UseFigSceneGraphParams & {
  readonly sceneGraph?: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
};

type SceneGraphCacheRef = {
  readonly page: FigNode;
  readonly nodes: readonly FigNode[];
  readonly resources: FigDocumentResources;
  readonly textFontResolver: TextFontResolver | undefined;
  readonly cache: SceneGraphBuildCache;
};

function canReuseSceneGraphCache({
  previous,
  page,
  nodes,
  resources,
  textFontResolver,
}: {
  readonly previous: SceneGraphCacheRef | undefined;
  readonly page: FigNode;
  readonly nodes: readonly FigNode[];
  readonly resources: FigDocumentResources;
  readonly textFontResolver: TextFontResolver | undefined;
}): boolean {
  return !!previous
    && previous.page === page
    && previous.nodes === nodes
    && previous.resources === resources
    && previous.textFontResolver === textFontResolver;
}

function resolvePreviousSceneGraphCache({
  previous,
  page,
  nodes,
  resources,
  textFontResolver,
}: {
  readonly previous: SceneGraphCacheRef | undefined;
  readonly page: FigNode;
  readonly nodes: readonly FigNode[];
  readonly resources: FigDocumentResources;
  readonly textFontResolver: TextFontResolver | undefined;
}): SceneGraphBuildCache | undefined {
  if (!previous) {
    return undefined;
  }
  if (!canReuseSceneGraphCache({ previous, page, nodes, resources, textFontResolver })) {
    return undefined;
  }
  return previous.cache;
}

function resolvePageNodes(
  page: FigNode | null | undefined,
  nodes: readonly FigNode[] | undefined,
  resources: FigDocumentResources,
): readonly FigNode[] | undefined {
  if (nodes !== undefined) {
    return nodes;
  }
  if (!page) {
    return undefined;
  }
  return resources.childrenOf(page);
}

/** Build the renderer-neutral SceneGraph consumed by React, SVG, and WebGL. */
export function useFigSceneGraph({
  page,
  nodes,
  canvasWidth,
  canvasHeight,
  viewportX = 0,
  viewportY = 0,
  viewportWidth = canvasWidth,
  viewportHeight = canvasHeight,
  resources,
  textFontResolver,
}: UseFigSceneGraphParams): SceneGraph | null {
  const cacheRef = useRef<SceneGraphCacheRef | undefined>(undefined);
  const pageNodes = resolvePageNodes(page, nodes, resources);
  return useMemo(() => {
    if (!page || pageNodes === undefined || pageNodes.length === 0) {
      return null;
    }

    const previous = resolvePreviousSceneGraphCache({
      previous: cacheRef.current,
      page,
      nodes: pageNodes,
      resources,
      textFontResolver,
    });

    const buildOptions: BuildSceneGraphOptions = {
      blobs: resources.blobs,
      images: resources.images,
      canvasSize: { width: canvasWidth, height: canvasHeight },
      viewport: { x: viewportX, y: viewportY, width: viewportWidth, height: viewportHeight },
      symbolResolver: resources.symbolResolver,
      childrenOf: resources.childrenOf,
      styleRegistry: resources.styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver,
    };
    const result = buildSceneGraphWithCache(pageNodes, buildOptions, previous);
    cacheRef.current = {
      page,
      nodes: pageNodes,
      resources,
      textFontResolver,
      cache: result.cache,
    };
    return pruneSceneGraphToViewport(result.sceneGraph);
  }, [page, pageNodes, resources, textFontResolver, canvasWidth, canvasHeight, viewportX, viewportY, viewportWidth, viewportHeight]);
}

/** Props for the resource-backed page renderer. */
export type FigFamilyPageRendererFromResourcesProps = FigFamilyPageRendererProps;

/** Render a fig-family page as React-owned SVG nodes. */
export function FigFamilyPageRenderer({
  sceneGraph: sceneGraphProp,
  renderOptions,
  ...params
}: FigFamilyPageRendererProps) {
  if (sceneGraphProp !== undefined && sceneGraphProp !== null) {
    return <FigFamilyResolvedPageRenderer sceneGraph={sceneGraphProp} renderOptions={renderOptions} />;
  }
  return <FigFamilyPageRendererFromKiwi {...params} renderOptions={renderOptions} />;
}

function FigFamilyPageRendererFromKiwi({
  renderOptions,
  ...params
}: UseFigSceneGraphParams & {
  readonly renderOptions?: SceneGraphRenderOptions;
}) {
  const sceneGraph = useFigSceneGraph(params);
  return <FigFamilyResolvedPageRenderer sceneGraph={sceneGraph} renderOptions={renderOptions} />;
}

function FigFamilyResolvedPageRenderer({
  sceneGraph,
  renderOptions,
}: {
  readonly sceneGraph: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
}) {
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

/** Render a fig page from caller-supplied document resources. */
export function FigFamilyPageRendererFromResources(props: FigFamilyPageRendererFromResourcesProps) {
  return <FigFamilyPageRenderer {...props} />;
}
