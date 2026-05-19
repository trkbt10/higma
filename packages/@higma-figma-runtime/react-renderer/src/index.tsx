/** @file React renderer boundary for decoded fig-family Kiwi documents. */

import { useMemo, useRef } from "react";
import {
  createFigDocumentContextFromKiwiCanvas,
  figDocumentResources,
  type FigDocumentContext,
  type FigDocumentResources,
} from "@higma-document-io/fig";
import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType } from "@higma-document-models/fig/domain";
import {
  buildSceneGraphWithCache,
  type BuildSceneGraphOptions,
  type SceneGraphBuildCache,
} from "@higma-document-renderers/fig/scene-graph";
import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph/model";
import type { FigmaExportColorProfile } from "@higma-codecs/raster";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import { FigSceneRenderer } from "@higma-document-renderers/fig/react";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";

export type FigFamilyKiwiCanvas = Parameters<typeof createFigDocumentContextFromKiwiCanvas>[0];
export type FigFamilyDocumentContext = FigDocumentContext;
export type FigFamilyPage = FigNode;
export type FigFamilyRenderOptions = Exclude<ReturnType<typeof createFigFamilyRenderOptions>, undefined>;

export function createFigFamilyDocumentContext(canvas: FigFamilyKiwiCanvas): FigFamilyDocumentContext {
  return createFigDocumentContextFromKiwiCanvas(canvas);
}

function readDocumentColorProfile(ctx: FigDocumentContext): FigNode["documentColorProfile"] {
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

export function createFigFamilyRenderOptions(ctx: FigDocumentContext): SceneGraphRenderOptions | undefined {
  const colorProfile = mapDocumentColorProfile(readDocumentColorProfile(ctx));
  if (!colorProfile) {
    return undefined;
  }
  return { exportSettings: { colorProfile } };
}

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

function resolveViewBox(sceneGraph: SceneGraph): string {
  const viewport = sceneGraph.viewport ?? {
    x: 0,
    y: 0,
    width: sceneGraph.width,
    height: sceneGraph.height,
  };
  return `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`;
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
  const contentSceneGraph = useMemo(() => {
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
      canvasSize: { width: 0, height: 0 },
      viewport: { x: 0, y: 0, width: 0, height: 0 },
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
    return result.sceneGraph;
  }, [page, pageNodes, resources, textFontResolver]);

  return useMemo(() => {
    if (!contentSceneGraph) {
      return null;
    }

    return {
      ...contentSceneGraph,
      width: canvasWidth,
      height: canvasHeight,
      viewport: { x: viewportX, y: viewportY, width: viewportWidth, height: viewportHeight },
    };
  }, [contentSceneGraph, canvasWidth, canvasHeight, viewportX, viewportY, viewportWidth, viewportHeight]);
}

export type FigFamilyPageRendererFromResourcesProps = FigFamilyPageRendererProps;

/** Render a fig-family page as React-owned SVG nodes. */
export function FigFamilyPageRenderer({
  sceneGraph: sceneGraphProp,
  renderOptions,
  ...params
}: FigFamilyPageRendererProps) {
  const builtSceneGraph = useFigSceneGraph(params);
  const sceneGraph = sceneGraphProp ?? builtSceneGraph;

  if (!sceneGraph) {
    return <g data-fig-family-page-renderer-empty="" />;
  }

  return (
    <svg
      data-fig-family-page-renderer=""
      viewBox={resolveViewBox(sceneGraph)}
      preserveAspectRatio="none"
      width={sceneGraph.width}
      height={sceneGraph.height}
      overflow="visible"
      pointerEvents="none"
      aria-hidden="true"
    >
      <FigSceneRenderer sceneGraph={sceneGraph} renderOptions={renderOptions} />
    </svg>
  );
}

export function FigFamilyPageRendererFromResources(props: FigFamilyPageRendererFromResourcesProps) {
  return <FigFamilyPageRenderer {...props} />;
}

export { figDocumentResources };
