/** @file SceneGraph construction hook for fig editor canvas renderers. */

import { useMemo, useRef } from "react";
import type { FigPage, FigDesignNode, FigStyleRegistry } from "@higma-document-models/fig/domain";
import type { FigImage } from "@higma-document-models/fig/domain";
import {
  buildSceneGraphWithCache,
  type BuildSceneGraphOptions,
  type SceneGraphBuildCache,
} from "@higma-document-renderers/fig/scene-graph";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";

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

type SceneGraphCacheRef = {
  readonly images: ReadonlyMap<string, FigImage>;
  readonly blobs: BuildSceneGraphOptions["blobs"];
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly textFontResolver: TextFontResolver | undefined;
  readonly cache: SceneGraphBuildCache;
};

function canReuseSceneGraphCache({
  previous,
  images,
  blobs,
  symbolMap,
  styleRegistry,
  textFontResolver,
}: {
  readonly previous: SceneGraphCacheRef | undefined;
  readonly images: ReadonlyMap<string, FigImage>;
  readonly blobs: BuildSceneGraphOptions["blobs"];
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly textFontResolver: TextFontResolver | undefined;
}): boolean {
  return !!previous
    && previous.images === images
    && previous.blobs === blobs
    && previous.symbolMap === symbolMap
    && previous.styleRegistry === styleRegistry
    && previous.textFontResolver === textFontResolver;
}

function resolvePreviousSceneGraphCache({
  previous,
  images,
  blobs,
  symbolMap,
  styleRegistry,
  textFontResolver,
}: {
  readonly previous: SceneGraphCacheRef | undefined;
  readonly images: ReadonlyMap<string, FigImage>;
  readonly blobs: BuildSceneGraphOptions["blobs"];
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly textFontResolver: TextFontResolver | undefined;
}): SceneGraphBuildCache | undefined {
  if (!previous) {
    return undefined;
  }
  if (!canReuseSceneGraphCache({ previous, images, blobs, symbolMap, styleRegistry, textFontResolver })) {
    return undefined;
  }
  return previous.cache;
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
}: UseFigSceneGraphParams) {
  const cacheRef = useRef<SceneGraphCacheRef | undefined>(undefined);
  const contentSceneGraph = useMemo(() => {
    if (!page || page.children.length === 0) {
      return null;
    }

    const previous = resolvePreviousSceneGraphCache({
      previous: cacheRef.current,
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
