/**
 * @file Shared React renderer boundary for decoded fig-family documents.
 */

import { useMemo, useRef } from "react";
import { createFigDesignDocumentFromKiwiCanvas } from "@higma-document-io/fig";
import type { FigDocumentResources } from "@higma-document-io/fig/context";
import type { FigDesignDocument, FigDesignNode, FigPage, FigStyleRegistry, FigImage } from "@higma-document-models/fig/domain";
import {
  buildSceneGraphWithCache,
  type BuildSceneGraphOptions,
  type SceneGraph,
  type SceneGraphBuildCache,
} from "@higma-document-renderers/fig/scene-graph";
import type {
  FigmaExportColorProfile,
  SceneGraphRenderOptions,
} from "@higma-document-renderers/fig/scene-graph/render";
import { FigSceneRenderer } from "@higma-document-renderers/fig/react";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";

export type FigFamilyDesignDocument = FigDesignDocument;
export type FigFamilyPage = FigPage;

/**
 * Renderer-facing resource bundle.
 *
 * `FigDocumentResources` (from `@higma-document-io/fig/context`) is the
 * canonical SoT shape; runtime exposes the same shape under
 * `FigFamilyDocumentResources` so peer-product packages
 * (`@higma-document-editors/site` / `deck` / `buzz`, `higma-vsc-plugin`)
 * obtain it through this layer instead of importing across the
 * `enforce-package-boundaries` line into `@higma-document-io/fig`.
 *
 * The structural alias keeps both names interchangeable at the type level
 * — code coming from the IO context and code coming from runtime see the
 * exact same shape, so there is no "two resource types in flight" problem.
 */
export type FigFamilyDocumentResources = FigDocumentResources;

/**
 * Build the renderer-facing resource bundle from a fig-family document.
 *
 * Independent re-implementation (not a re-export of
 * `figDocumentResources`) so runtime stays free of the
 * `no-cross-package-reexport` lint, while peer-product editor packages
 * still have a single, stable accessor for the four maps.
 *
 * The contract is byte-identical to
 * `@higma-document-io/fig/context::figDocumentResources`: the bundle
 * aliases `document.components` to `symbolMap` because the scene-graph
 * builder, the React renderer, and the WebGL backend all expect the
 * renderer's `symbolMap` vocabulary, while the document model owns the
 * "components" name. A single accessor stops every consumer from
 * destructuring four fields by hand and renaming `components` inline.
 */
export function figFamilyDocumentResources(document: FigDesignDocument): FigFamilyDocumentResources {
  return {
    symbolMap: document.components,
    styleRegistry: document.styleRegistry,
    blobs: document.blobs,
    images: document.images,
  };
}
export type FigFamilyKiwiCanvas = Parameters<typeof createFigDesignDocumentFromKiwiCanvas>[0];
export type FigFamilyDesignDocumentOptions = Parameters<typeof createFigDesignDocumentFromKiwiCanvas>[1];
export type FigFamilyRenderOptions = SceneGraphRenderOptions;

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
  readonly renderOptions?: SceneGraphRenderOptions;
};

/**
 * Bundle-shaped variant of `UseFigSceneGraphParams`.
 *
 * Consumers that already hold a `FigDocumentResources` (the SoT bundle from
 * `@higma-document-io/fig/context`) pass it as a single prop instead of
 * destructuring the four fields by hand at every call site. Internally this
 * delegates to the four-field hook so the cache invariants stay identical.
 */
export type UseFigSceneGraphFromResourcesParams = {
  readonly page: FigPage | null | undefined;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly viewportX?: number;
  readonly viewportY?: number;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly resources: FigDocumentResources;
  readonly textFontResolver?: TextFontResolver;
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

function mapDocumentColorProfile(profile: FigDesignDocument["documentColorProfile"]): FigmaExportColorProfile | undefined {
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

/** Create explicit fig render options from the decoded document color profile. */
export function createFigFamilyRenderOptions(document: FigDesignDocument): SceneGraphRenderOptions | undefined {
  const colorProfile = mapDocumentColorProfile(document.documentColorProfile);
  if (!colorProfile) {
    return undefined;
  }
  return { exportSettings: { colorProfile } };
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

/**
 * Bundle-shaped variant: identical contract to `useFigSceneGraph` but accepts
 * a `FigDocumentResources` (`@higma-document-io/fig/context`'s SoT) instead
 * of four separate props.
 *
 * Implemented by destructuring `resources` once and forwarding to the
 * four-prop hook so the cache invariants — including the per-field reference
 * checks in `canReuseSceneGraphCache` — stay identical for both entry points.
 * Callers that hold a stable `resources` reference (the editor's
 * `useFigDocumentResources` hook) get cache hits across renders that don't
 * change the document.
 */
export function useFigSceneGraphFromResources({
  page,
  canvasWidth,
  canvasHeight,
  viewportX,
  viewportY,
  viewportWidth,
  viewportHeight,
  resources,
  textFontResolver,
}: UseFigSceneGraphFromResourcesParams): SceneGraph | null {
  return useFigSceneGraph({
    page,
    canvasWidth,
    canvasHeight,
    viewportX,
    viewportY,
    viewportWidth,
    viewportHeight,
    images: resources.images,
    blobs: resources.blobs,
    symbolMap: resources.symbolMap,
    styleRegistry: resources.styleRegistry,
    textFontResolver,
  });
}

/**
 * Bundle-shaped variant of `FigFamilyPageRendererProps`.
 *
 * Same contract as `FigFamilyPageRendererProps` but accepts a
 * `FigDocumentResources` (the SoT bundle exposed by
 * `@higma-document-io/fig/context`) instead of the four loose props.
 * Site / deck / buzz canvases hold `figSurface.resources` once and pass it
 * down — see `figDocumentResources(figSurface.document)` for the
 * conversion when the surface still carries a raw `FigDesignDocument`.
 */
export type FigFamilyPageRendererFromResourcesProps = UseFigSceneGraphFromResourcesParams & {
  readonly sceneGraph?: SceneGraph | null;
  readonly renderOptions?: SceneGraphRenderOptions;
};

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

/**
 * Resource-bundle variant of `FigFamilyPageRenderer`.
 *
 * Forwards the bundle through `useFigSceneGraphFromResources` (which itself
 * delegates to `useFigSceneGraph`) so site / deck / buzz canvases consume a
 * single `resources` prop instead of destructuring `images / blobs /
 * symbolMap / styleRegistry` at every call site.
 */
export function FigFamilyPageRendererFromResources({
  sceneGraph: sceneGraphProp,
  renderOptions,
  ...params
}: FigFamilyPageRendererFromResourcesProps) {
  const builtSceneGraph = useFigSceneGraphFromResources(params);
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
