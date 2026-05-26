/** @file Kiwi-backed SceneGraph pipeline for renderer input construction. */

import type { FigDocumentResources } from "@higma-document-io/fig";
import { getNodeType, guidToString, sameKiwiNodeExceptTransform } from "@higma-document-models/fig/domain";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import type { FigNode } from "@higma-document-models/fig/types";
import type { TextFontResolver } from "../text";
import {
  buildSceneGraphWithCache,
  type BuildSceneGraphOptions,
  type SceneGraphBuildCache,
} from "./builder";
import { createNodeId, type SceneGraph } from "./model";
import { findSceneGraphNode, replaceSceneGraphNodeTransform } from "./translate-scene-node";

export type KiwiSceneGraphMutationScope =
  | "initial-load"
  | "node-content"
  | "document-structure"
  | "resource-set"
  | "reference-data"
  | "history-context";

export type KiwiSceneGraphMutation = {
  readonly revision: number;
  readonly scope: KiwiSceneGraphMutationScope;
  readonly changedGuidKeys: readonly string[];
};

export type KiwiSceneGraphPipelineInput = {
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

export type KiwiSceneGraphPipeline = {
  readonly resolve: (input: KiwiSceneGraphPipelineInput) => SceneGraph | null;
};

type SceneGraphCacheRef = {
  readonly pageGuidKey: string;
  readonly textFontResolver: TextFontResolver | undefined;
  readonly showHiddenNodes: boolean;
  readonly sourceDocumentReference: object;
  readonly sourceRevision: number;
  readonly sceneGraph: SceneGraph;
  readonly cache: SceneGraphBuildCache;
  readonly nodeByGuid: ReadonlyMap<string, FigNode>;
};

type SceneGraphBuildGeometry = {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly viewportX: number;
  readonly viewportY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
};

function requirePipelinePageGuidKey(page: FigNode): string {
  if (page.guid === undefined) {
    throw new Error("KiwiSceneGraphPipeline requires a Kiwi guid on the active CANVAS page");
  }
  return guidToString(page.guid);
}

function canReuseSceneGraphCache({
  previous,
  pageGuidKey,
  textFontResolver,
  showHiddenNodes,
}: {
  readonly previous: SceneGraphCacheRef | undefined;
  readonly pageGuidKey: string;
  readonly textFontResolver: TextFontResolver | undefined;
  readonly showHiddenNodes: boolean;
}): boolean {
  return !!previous
    && previous.pageGuidKey === pageGuidKey
    && previous.textFontResolver === textFontResolver
    && previous.showHiddenNodes === showHiddenNodes;
}

function resolvePreviousSceneGraphCache({
  previous,
  pageGuidKey,
  textFontResolver,
  showHiddenNodes,
}: {
  readonly previous: SceneGraphCacheRef | undefined;
  readonly pageGuidKey: string;
  readonly textFontResolver: TextFontResolver | undefined;
  readonly showHiddenNodes: boolean;
}): SceneGraphBuildCache | undefined {
  if (previous === undefined) {
    return undefined;
  }
  if (!canReuseSceneGraphCache({ previous, pageGuidKey, textFontResolver, showHiddenNodes })) {
    return undefined;
  }
  return previous.cache;
}

function sceneGraphWithCurrentViewport(
  sceneGraph: SceneGraph,
  geometry: SceneGraphBuildGeometry,
  sourceRevision: number,
): SceneGraph {
  return {
    ...sceneGraph,
    width: geometry.canvasWidth,
    height: geometry.canvasHeight,
    version: sourceRevision,
    viewport: {
      x: geometry.viewportX,
      y: geometry.viewportY,
      width: geometry.viewportWidth,
      height: geometry.viewportHeight,
    },
  };
}

function reusableSceneGraphCacheRef({
  previous,
  pageGuidKey,
  textFontResolver,
  showHiddenNodes,
}: {
  readonly previous: SceneGraphCacheRef | undefined;
  readonly pageGuidKey: string;
  readonly textFontResolver: TextFontResolver | undefined;
  readonly showHiddenNodes: boolean;
}): SceneGraphCacheRef | undefined {
  if (!canReuseSceneGraphCache({ previous, pageGuidKey, textFontResolver, showHiddenNodes })) {
    return undefined;
  }
  return previous;
}

function addNodeAndAncestorsToInvalidationSet(
  node: FigNode,
  resources: FigDocumentResources,
  invalidated: WeakSet<FigNode>,
): boolean {
  invalidated.add(node);
  if (getNodeType(node) === "SYMBOL") {
    return true;
  }
  const parentGuid = node.parentIndex?.guid;
  if (parentGuid === undefined) {
    return false;
  }
  const parent = resources.document.nodesByGuid.get(guidToString(parentGuid));
  if (parent === undefined) {
    throw new Error(`KiwiSceneGraphPipeline mutation references missing parent ${guidToString(parentGuid)}`);
  }
  return addNodeAndAncestorsToInvalidationSet(parent, resources, invalidated);
}

function createNodeContentCacheInvalidationSet(
  mutation: KiwiSceneGraphMutation,
  resources: FigDocumentResources,
): WeakSet<FigNode> {
  const invalidated = new WeakSet<FigNode>();
  const symbolChanged = mutation.changedGuidKeys.some((guidKey) => {
    const node = resources.document.nodesByGuid.get(guidKey);
    if (node === undefined) {
      throw new Error(`KiwiSceneGraphPipeline mutation references missing Kiwi node ${guidKey}`);
    }
    return addNodeAndAncestorsToInvalidationSet(node, resources, invalidated);
  });
  if (!symbolChanged) {
    return invalidated;
  }
  for (const node of resources.document.nodeChanges) {
    if (getNodeType(node) !== "INSTANCE") {
      continue;
    }
    addNodeAndAncestorsToInvalidationSet(node, resources, invalidated);
  }
  return invalidated;
}

function sceneGraphCacheForMutation(
  previous: SceneGraphBuildCache | undefined,
  mutation: KiwiSceneGraphMutation,
): SceneGraphBuildCache | undefined {
  if (mutation.scope === "initial-load") {
    return previous;
  }
  if (mutation.scope === "node-content") {
    return previous;
  }
  return undefined;
}

function sceneGraphCacheInvalidationSetForMutation(
  mutation: KiwiSceneGraphMutation,
  resources: FigDocumentResources,
): WeakSet<FigNode> | undefined {
  if (mutation.scope === "initial-load") {
    return undefined;
  }
  if (mutation.scope !== "node-content") {
    return undefined;
  }
  return createNodeContentCacheInvalidationSet(mutation, resources);
}

function sceneGraphWithUpdatedNodeTransform(sceneGraph: SceneGraph, guidKey: string, node: FigNode): SceneGraph | undefined {
  const nodeId = createNodeId(guidKey);
  if (findSceneGraphNode(sceneGraph, nodeId) === undefined) {
    return undefined;
  }
  return replaceSceneGraphNodeTransform(sceneGraph, nodeId, readKiwiTransform(node.transform));
}

function transformOnlyMutationNodes({
  previous,
  mutation,
  resources,
}: {
  readonly previous: SceneGraphCacheRef;
  readonly mutation: KiwiSceneGraphMutation;
  readonly resources: FigDocumentResources;
}): readonly { readonly guidKey: string; readonly node: FigNode }[] | undefined {
  if (mutation.scope !== "node-content") {
    return undefined;
  }
  const nodes = mutation.changedGuidKeys.map((guidKey) => {
    const before = previous.nodeByGuid.get(guidKey);
    const after = resources.document.nodesByGuid.get(guidKey);
    if (before === undefined || after === undefined) {
      return undefined;
    }
    if (!sameKiwiNodeExceptTransform(before, after)) {
      return undefined;
    }
    return { guidKey, node: after };
  });
  if (nodes.some((node) => node === undefined)) {
    return undefined;
  }
  return nodes.filter((node): node is { readonly guidKey: string; readonly node: FigNode } => node !== undefined);
}

function transformOnlySceneGraphFromPrevious({
  previous,
  mutation,
  geometry,
  sourceRevision,
  resources,
}: {
  readonly previous: SceneGraphCacheRef | undefined;
  readonly mutation: KiwiSceneGraphMutation;
  readonly geometry: SceneGraphBuildGeometry;
  readonly sourceRevision: number;
  readonly resources: FigDocumentResources;
}): SceneGraph | undefined {
  if (previous === undefined) {
    return undefined;
  }
  const changedNodes = transformOnlyMutationNodes({ previous, mutation, resources });
  if (changedNodes === undefined) {
    return undefined;
  }
  const sceneWithViewport = sceneGraphWithCurrentViewport(previous.sceneGraph, geometry, sourceRevision);
  return changedNodes.reduce<SceneGraph | undefined>(
    (sceneGraph, { guidKey, node }) => {
      if (sceneGraph === undefined) {
        return undefined;
      }
      return sceneGraphWithUpdatedNodeTransform(sceneGraph, guidKey, node);
    },
    sceneWithViewport,
  );
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

/** Create a renderer-owned SceneGraph pipeline over explicit Kiwi document resources. */
export function createKiwiSceneGraphPipeline(): KiwiSceneGraphPipeline {
  const cacheRef = { value: undefined as SceneGraphCacheRef | undefined };

  return {
    resolve({
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
    }: KiwiSceneGraphPipelineInput): SceneGraph | null {
      const pageNodes = resolvePageNodes(page, nodes, resources);
      if (!page || pageNodes === undefined || pageNodes.length === 0) {
        return null;
      }

      const pageGuidKey = requirePipelinePageGuidKey(page);
      const sourceRevision = kiwiDocumentMutation.revision;
      const sourceDocumentReference = resources.document;
      const geometry: SceneGraphBuildGeometry = {
        canvasWidth,
        canvasHeight,
        viewportX,
        viewportY,
        viewportWidth,
        viewportHeight,
      };
      const previous = resolvePreviousSceneGraphCache({
        previous: cacheRef.value,
        pageGuidKey,
        textFontResolver,
        showHiddenNodes,
      });
      const previousForMutation = sceneGraphCacheForMutation(previous, kiwiDocumentMutation);
      const transformOnlySceneGraph = transformOnlySceneGraphFromPrevious({
        previous: reusableSceneGraphCacheRef({
          previous: cacheRef.value,
          pageGuidKey,
          textFontResolver,
          showHiddenNodes,
        }),
        mutation: kiwiDocumentMutation,
        geometry,
        sourceRevision,
        resources,
      });
      if (transformOnlySceneGraph !== undefined && previousForMutation !== undefined) {
        cacheRef.value = {
          pageGuidKey,
          textFontResolver,
          showHiddenNodes,
          sourceDocumentReference,
          sourceRevision,
          sceneGraph: transformOnlySceneGraph,
          cache: previousForMutation,
          nodeByGuid: resources.document.nodesByGuid,
        };
        return transformOnlySceneGraph;
      }

      const buildOptions: BuildSceneGraphOptions = {
        blobs: resources.blobs,
        images: resources.images,
        canvasSize: { width: geometry.canvasWidth, height: geometry.canvasHeight },
        viewport: { x: geometry.viewportX, y: geometry.viewportY, width: geometry.viewportWidth, height: geometry.viewportHeight },
        sourceDocumentReference,
        sourceRevision,
        symbolResolver: resources.symbolResolver,
        childrenOf: resources.childrenOf,
        styleRegistry: resources.styleRegistry,
        showHiddenNodes,
        warnings: [],
        textFontResolver,
        cacheInvalidatedSources: sceneGraphCacheInvalidationSetForMutation(kiwiDocumentMutation, resources),
      };
      const result = buildSceneGraphWithCache(pageNodes, buildOptions, previousForMutation);
      const sceneGraph = result.sceneGraph;
      cacheRef.value = {
        pageGuidKey,
        textFontResolver,
        showHiddenNodes,
        sourceDocumentReference,
        sourceRevision,
        sceneGraph,
        cache: result.cache,
        nodeByGuid: resources.document.nodesByGuid,
      };
      return sceneGraph;
    },
  };
}
