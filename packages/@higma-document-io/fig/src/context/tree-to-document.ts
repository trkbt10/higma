/**
 * @file Convert parsed FigNode trees to FigDesignDocument values
 *
 * Document IO owns the file/tree orchestration. Raw FigNode to
 * FigDesignNode conversion is owned by the fig document model so renderers
 * and IO share one lower-layer source of truth.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import {
  buildFigStyleRegistry,
  createFigResolveContext,
} from "@higma-document-models/fig/symbols";
import type { FigResolveContext } from "@higma-document-models/fig/symbols";
import type {
  FigDesignDocument,
  FigDesignNode,
  FigPage,
  FigStyleRegistry,
  LoadedFigFile,
  NodeTreeResult,
} from "@higma-document-models/fig/domain";
import {
  collectFigRawFields,
  convertFigNode,
  DEFAULT_PAGE_BACKGROUND,
  EMPTY_FIG_STYLE_REGISTRY,
  getNodeType,
  guidToPageId,
} from "@higma-document-models/fig/domain";
import { walkTree } from "@higma-primitives/tree";

function isUserVisibleCanvas(canvas: FigNode): boolean {
  return canvas.visible !== false && canvas.internalOnly !== true;
}

/**
 * Convert a CANVAS FigNode to a FigPage.
 */
function convertCanvasToPage(
  ctx: FigResolveContext,
  canvas: FigNode,
  components: Map<string, FigDesignNode>,
  styleRegistry: FigStyleRegistry,
  symbolMap: ReadonlyMap<string, FigNode>,
  blobs: LoadedFigFile["blobs"],
): FigPage {
  const id = guidToPageId(canvas.guid);
  const children = ctx.safeChildren(canvas);
  const convertedChildren = children.map((child) => convertFigNode(child, components, styleRegistry, symbolMap, blobs, ctx));

  collectComponentsRecursive(convertedChildren, components);

  return {
    id,
    name: canvas.name ?? "Page",
    backgroundColor: canvas.backgroundColor ?? DEFAULT_PAGE_BACKGROUND,
    children: convertedChildren,
    _raw: collectFigRawFields(canvas),
  };
}

function collectComponentsRecursive(
  nodes: readonly FigDesignNode[],
  components: Map<string, FigDesignNode>,
): void {
  walkTree(nodes, (node) => {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET" || node.type === "SYMBOL") {
      components.set(node.id, node);
    }
  }, { getChildren: (node) => node.children ?? [] });
}

/**
 * Collect all FigNodes in a tree into a flat Map keyed by GUID string.
 */
function collectNodeMap(ctx: FigResolveContext, roots: readonly FigNode[]): ReadonlyMap<string, FigNode> {
  const map = new Map<string, FigNode>();
  walkTree(roots, (node) => {
    if (node.guid) {
      map.set(ctx.guidString(node.guid), node);
    }
  }, { getChildren: ctx.safeChildren });
  return map;
}

export function treeToDocument(
  tree: NodeTreeResult,
  loaded: LoadedFigFile,
): FigDesignDocument {
  const ctx = createFigResolveContext();
  const components = new Map<string, FigDesignNode>();
  const pages: FigPage[] = [];
  const nodeMap = collectNodeMap(ctx, tree.roots);
  const styleRegistry = nodeMap.size > 0 ? buildFigStyleRegistry(nodeMap) : EMPTY_FIG_STYLE_REGISTRY;

  for (const root of tree.roots) {
    const rootType = getNodeType(root);

    if (rootType === "DOCUMENT") {
      for (const canvas of ctx.safeChildren(root)) {
        if (getNodeType(canvas) === "CANVAS" && isUserVisibleCanvas(canvas)) {
          pages.push(convertCanvasToPage(ctx, canvas, components, styleRegistry, nodeMap, loaded.blobs));
        }
      }
    } else if (rootType === "CANVAS" && isUserVisibleCanvas(root)) {
      pages.push(convertCanvasToPage(ctx, root, components, styleRegistry, nodeMap, loaded.blobs));
    }
  }

  return {
    pages,
    components,
    images: loaded.images,
    blobs: loaded.blobs,
    metadata: loaded.metadata,
    styleRegistry,
    _loaded: loaded,
  };
}
