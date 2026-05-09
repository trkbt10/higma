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

export type FigDocumentTreeResources = {
  readonly blobs: LoadedFigFile["blobs"];
  readonly images: LoadedFigFile["images"];
  readonly metadata: LoadedFigFile["metadata"];
  readonly canvasVisibility: "user-visible" | "all";
};

type TreeToDocumentSource = LoadedFigFile | FigDocumentTreeResources;

/** Check whether tree resources preserve the complete roundtrip file state. */
function isLoadedFigFile(source: TreeToDocumentSource): source is LoadedFigFile {
  return "schema" in source && "compressedSchema" in source && "nodeChanges" in source;
}

function isUserVisibleCanvas(canvas: FigNode): boolean {
  return canvas.visible !== false && canvas.internalOnly !== true;
}

function shouldConvertCanvas(canvas: FigNode, source: TreeToDocumentSource): boolean {
  if (isLoadedFigFile(source)) {
    return isUserVisibleCanvas(canvas);
  }
  switch (source.canvasVisibility) {
    case "user-visible":
      return isUserVisibleCanvas(canvas);
    case "all":
      return true;
  }
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

function readDocumentColorProfile(tree: NodeTreeResult): FigNode["documentColorProfile"] {
  for (const root of tree.roots) {
    if (getNodeType(root) === "DOCUMENT") {
      return root.documentColorProfile;
    }
  }
  return undefined;
}

export type TreeToDocumentOptions = {
  /**
   * Pre-built style registry. When provided, `treeToDocument` skips
   * its own derivation. Production callers that already have a
   * `FigSymbolContext` should pass `ctx.styleRegistry` to avoid
   * re-walking the nodeMap. The registry must have been built from
   * the same `tree.nodeMap` — passing a registry derived from a
   * different document is undefined behaviour.
   */
  readonly styleRegistry?: FigStyleRegistry;
};

/** Convert a parsed raw node tree into the shared FigDesignDocument domain model. */
export function treeToDocument(
  tree: NodeTreeResult,
  source: TreeToDocumentSource,
  options: TreeToDocumentOptions = {},
): FigDesignDocument {
  const ctx = createFigResolveContext();
  const components = new Map<string, FigDesignNode>();
  const pages: FigPage[] = [];
  // SoT: `buildNodeTree` already returns the GUID → FigNode map under
  // `tree.nodeMap`. Re-walking the tree here would produce the same
  // content from the same source, so we consume the parser's output
  // directly.
  const nodeMap = tree.nodeMap;
  const styleRegistry = (() => {
    if (options.styleRegistry !== undefined) {
      return options.styleRegistry;
    }
    return nodeMap.size > 0 ? buildFigStyleRegistry(nodeMap) : EMPTY_FIG_STYLE_REGISTRY;
  })();
  const loaded = isLoadedFigFile(source) ? source : undefined;

  for (const root of tree.roots) {
    const rootType = getNodeType(root);

    if (rootType === "DOCUMENT") {
      for (const canvas of ctx.safeChildren(root)) {
        if (getNodeType(canvas) === "CANVAS" && shouldConvertCanvas(canvas, source)) {
          pages.push(convertCanvasToPage(ctx, canvas, components, styleRegistry, nodeMap, source.blobs));
        }
      }
    } else if (rootType === "CANVAS" && shouldConvertCanvas(root, source)) {
      pages.push(convertCanvasToPage(ctx, root, components, styleRegistry, nodeMap, source.blobs));
    }
  }

  const document: FigDesignDocument = {
    pages,
    documentColorProfile: readDocumentColorProfile(tree),
    components,
    images: source.images,
    blobs: source.blobs,
    metadata: source.metadata,
    styleRegistry,
  };
  if (!loaded) {
    return document;
  }
  return { ...document, _loaded: loaded };
}
