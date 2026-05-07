/**
 * @file Shared React renderer boundary for decoded fig-family documents.
 */

import { useMemo, useRef } from "react";
import { createFigDesignDocumentFromKiwiCanvas } from "@higma-document-io/fig";
import type { FigDesignDocument, FigDesignNode, FigPage, FigStyleRegistry, FigImage } from "@higma-document-models/fig/domain";
import {
  buildSceneGraphWithCache,
  type BuildSceneGraphOptions,
  type SceneGraph,
  type SceneGraphBuildCache,
} from "@higma-document-renderers/fig/scene-graph";
import { FigSceneRenderer } from "@higma-document-renderers/fig/react";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";

export type FigFamilyDesignDocument = FigDesignDocument;
export type FigFamilyPage = FigPage;
export type FigFamilyKiwiCanvas = Parameters<typeof createFigDesignDocumentFromKiwiCanvas>[0];
export type FigFamilyDesignDocumentOptions = Parameters<typeof createFigDesignDocumentFromKiwiCanvas>[1];

/** Convert a decoded fig-family canvas into the shared fig renderer domain model. */
export function createFigFamilyDesignDocument(
  canvas: FigFamilyKiwiCanvas,
  options: FigFamilyDesignDocumentOptions,
): FigDesignDocument {
  return createFigDesignDocumentFromKiwiCanvas(canvas, options);
}

export type UseFigSceneGraphParams = {
  readonly page: FigPage | null | undefined;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly viewportX?: number;
  readonly viewportY?: number;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly images: ReadonlyMap<string, FigImage>;
  readonly blobs: BuildSceneGraphOptions["blobs"];
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly textFontResolver?: TextFontResolver;
};

export type FigFamilyPageRendererProps = UseFigSceneGraphParams & {
  readonly sceneGraph?: SceneGraph | null;
};

type SceneGraphCacheRef = {
  readonly page: FigPage;
  readonly images: ReadonlyMap<string, FigImage>;
  readonly blobs: BuildSceneGraphOptions["blobs"];
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly textFontResolver: TextFontResolver | undefined;
  readonly cache: SceneGraphBuildCache;
};

function canReuseSceneGraphCache({
  previous,
  page,
  images,
  blobs,
  symbolMap,
  styleRegistry,
  textFontResolver,
}: {
  readonly previous: SceneGraphCacheRef | undefined;
  readonly page: FigPage;
  readonly images: ReadonlyMap<string, FigImage>;
  readonly blobs: BuildSceneGraphOptions["blobs"];
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly textFontResolver: TextFontResolver | undefined;
}): boolean {
  return !!previous
    && previous.page === page
    && previous.images === images
    && previous.blobs === blobs
    && previous.symbolMap === symbolMap
    && previous.styleRegistry === styleRegistry
    && previous.textFontResolver === textFontResolver;
}

function resolvePreviousSceneGraphCache({
  previous,
  page,
  images,
  blobs,
  symbolMap,
  styleRegistry,
  textFontResolver,
}: {
  readonly previous: SceneGraphCacheRef | undefined;
  readonly page: FigPage;
  readonly images: ReadonlyMap<string, FigImage>;
  readonly blobs: BuildSceneGraphOptions["blobs"];
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly textFontResolver: TextFontResolver | undefined;
}): SceneGraphBuildCache | undefined {
  if (!previous) {
    return undefined;
  }
  if (!canReuseSceneGraphCache({ previous, page, images, blobs, symbolMap, styleRegistry, textFontResolver })) {
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

/** Build the renderer-neutral SceneGraph consumed by React, SVG, and WebGL. */
export function useFigSceneGraph({
  page,
  canvasWidth,
  canvasHeight,
  viewportX = 0,
  viewportY = 0,
  viewportWidth = canvasWidth,
  viewportHeight = canvasHeight,
  images,
  blobs,
  symbolMap,
  styleRegistry,
  textFontResolver,
}: UseFigSceneGraphParams): SceneGraph | null {
  const cacheRef = useRef<SceneGraphCacheRef | undefined>(undefined);
  const contentSceneGraph = useMemo(() => {
    if (!page || page.children.length === 0) {
      return null;
    }

    const previous = resolvePreviousSceneGraphCache({
      previous: cacheRef.current,
      page,
      images,
      blobs,
      symbolMap,
      styleRegistry,
      textFontResolver,
    });

    const result = buildSceneGraphWithCache(page.children, {
      blobs,
      images,
      canvasSize: { width: 0, height: 0 },
      viewport: { x: 0, y: 0, width: 0, height: 0 },
      symbolMap,
      styleRegistry,
      showHiddenNodes: false,
      warnings: [],
      textFontResolver,
    }, previous);
    cacheRef.current = {
      page,
      images,
      blobs,
      symbolMap,
      styleRegistry,
      textFontResolver,
      cache: result.cache,
    };
    return result.sceneGraph;
  }, [page, images, blobs, symbolMap, styleRegistry, textFontResolver]);

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

/** Render a fig-family page as React-owned SVG nodes. */
export function FigFamilyPageRenderer({
  sceneGraph: sceneGraphProp,
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
      <FigSceneRenderer sceneGraph={sceneGraph} />
    </svg>
  );
}
