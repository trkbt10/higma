/**
 * @file React state boundary for the Kiwi-backed Fig editor.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  addNode,
  addPage,
  createFigDocumentContextFromLoaded,
  createFigDocumentContextFromNodeChanges,
  figDocumentResources,
  findCanvases,
  replaceFigDocumentContextNodeChanges,
  type FigDocumentContext,
  type FigDocumentResources,
} from "@higma-document-io/fig";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { NodeSpec } from "@higma-document-io/fig/types";
import type { BooleanOperationType } from "@higma-primitives/path";
import {
  createFigBuilderStateFromDocument,
  type FigBuilderState,
} from "@higma-document-models/fig/builder";
import { createBooleanOperationEnum } from "@higma-document-models/fig/boolean-operation";
import {
  getNodeType,
  guidToString,
} from "@higma-document-models/fig/domain";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import { translateTransform } from "./fig-editor/matrix";

export type FigCreationMode =
  | "select"
  | "frame"
  | "rectangle"
  | "ellipse"
  | "line"
  | "star"
  | "polygon"
  | "text"
  | "pen";

export const FIG_NODE_MUTATION_SOURCE = {
  editorCanvasVectorPathCommit: "editor-canvas-vector-path-commit",
  editorCanvasSelectionDelete: "editor-canvas-selection-delete",
  editorCanvasVectorPathContextMenu: "editor-canvas-vector-path-context-menu",
  editorCanvasBooleanContextMenu: "editor-canvas-boolean-context-menu",
  editorCanvasVectorPathHandleDrag: "editor-canvas-vector-path-handle-drag",
  editorCanvasVectorPathPointInsert: "editor-canvas-vector-path-point-insert",
  editorCanvasSelectedFigNodeDrag: "editor-canvas-selected-fig-node-drag",
  editorCanvasCreationDrag: "editor-canvas-creation-drag",
  editorCanvasCreationMarquee: "editor-canvas-creation-marquee",
  propertyPanel: "property-panel",
  layerPanel: "layer-panel",
  pagePanel: "page-panel",
  toolbar: "toolbar",
  textEdit: "text-edit",
} as const satisfies Readonly<Record<string, string>>;

export type FigNodeMutationSource =
  typeof FIG_NODE_MUTATION_SOURCE[keyof typeof FIG_NODE_MUTATION_SOURCE];

export type FigTextEditState =
  | { readonly type: "inactive" }
  | { readonly type: "active"; readonly guid: FigGuid };

export type FigEditorContextValue = {
  readonly context: FigDocumentContext;
  readonly resources: FigDocumentResources;
  readonly pages: readonly FigNode[];
  readonly activePage: FigNode | undefined;
  readonly activePageGuid: FigGuid | undefined;
  readonly selectedGuids: readonly FigGuid[];
  readonly selectedNodes: readonly FigNode[];
  readonly primaryNode: FigNode | undefined;
  readonly creationMode: FigCreationMode;
  readonly textEdit: FigTextEditState;
  readonly selectedFigNodeDragTransformActive: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly setActivePageGuid: (guid: FigGuid) => void;
  readonly setSelectedGuids: (guids: readonly FigGuid[]) => void;
  readonly selectNodeGuid: (guid: FigGuid, options?: SelectNodeOptions) => void;
  readonly clearSelection: () => void;
  readonly setCreationMode: (mode: FigCreationMode) => void;
  readonly enterTextEdit: (guid: FigGuid) => void;
  readonly exitTextEdit: () => void;
  readonly beginSelectedFigNodeDragTransform: () => void;
  readonly endSelectedFigNodeDragTransform: () => void;
  readonly updateNode: (guid: FigGuid, updater: (node: FigNode) => FigNode, source: FigNodeMutationSource) => void;
  readonly updateSelectedNodes: (updater: (node: FigNode) => FigNode, source: FigNodeMutationSource) => void;
  readonly updateSelectedNodesWithImages: (
    images: readonly FigPackageImage[],
    updater: (node: FigNode) => FigNode,
    source: FigNodeMutationSource,
  ) => void;
  readonly addNodeToActivePage: (spec: NodeSpec, parentGuid: FigGuid | null, source: FigNodeMutationSource) => FigGuid;
  readonly createBooleanOperationFromSelection: (operation: BooleanOperationType, source: FigNodeMutationSource) => void;
  readonly deleteSelectedNodes: (source: FigNodeMutationSource) => void;
  readonly addPage: (name: string, source: FigNodeMutationSource) => FigGuid;
  readonly renamePage: (guid: FigGuid, name: string, source: FigNodeMutationSource) => void;
  readonly deletePage: (guid: FigGuid, source: FigNodeMutationSource) => void;
  readonly movePage: (guid: FigGuid, toIndex: number, source: FigNodeMutationSource) => void;
  readonly undo: () => void;
  readonly redo: () => void;
};

export type FigEditorProviderProps = {
  readonly context: FigDocumentContext;
  readonly children: ReactNode;
  readonly onContextChange?: (context: FigDocumentContext) => void;
  readonly initialActivePageGuid?: FigGuid;
  readonly initialSelectedGuids?: readonly FigGuid[];
};

export type SelectNodeOptions = {
  readonly additive?: boolean;
  readonly toggle?: boolean;
};

function createFigContextWithImages(
  currentContext: FigDocumentContext,
  nodeChanges: readonly FigNode[],
  images: Map<string, FigPackageImage>,
): FigDocumentContext {
  if (currentContext.loaded) {
    return createFigDocumentContextFromLoaded(
      { ...currentContext.loaded, nodeChanges, images },
      { kiwiSourceDocuments: currentContext.kiwiSourceDocuments },
    );
  }
  return createFigDocumentContextFromNodeChanges({
    nodeChanges,
    blobs: currentContext.blobs,
    images,
    metadata: currentContext.metadata,
    kiwiSourceDocuments: currentContext.kiwiSourceDocuments,
  });
}

type FigContextHistory = {
  readonly past: readonly FigDocumentContext[];
  readonly future: readonly FigDocumentContext[];
};

type FigContextPublishOptions = {
  readonly source: FigNodeMutationSource;
};

const EDITOR_AUTHORED_NODE_SESSION_ID = 1;
const EDITOR_AUTHORED_PAGE_SESSION_ID = 0;
const FIRST_AUTHORED_LOCAL_ID = 1;
const POSITION_FIRST_CHAR = 0x21;
const FigEditorContext = createContext<FigEditorContextValue | null>(null);
const INACTIVE_TEXT_EDIT_STATE: FigTextEditState = { type: "inactive" };

function guidEquals(left: FigGuid, right: FigGuid): boolean {
  return left.sessionID === right.sessionID && left.localID === right.localID;
}

function guidKey(guid: FigGuid): string {
  return guidToString(guid);
}

function guidListEquals(left: readonly FigGuid[], right: readonly FigGuid[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((guid, index) => {
    const candidate = right[index];
    if (candidate === undefined) {
      return false;
    }
    return guidEquals(guid, candidate);
  });
}

function positionString(index: number): string {
  return String.fromCharCode(POSITION_FIRST_CHAR + index);
}

function requireNodeGuid(node: FigNode, owner: string): FigGuid {
  if (node.guid === undefined) {
    throw new Error(`${owner}: Kiwi node "${node.name ?? "(unnamed)"}" is missing guid`);
  }
  return node.guid;
}

function requireNodeParentGuid(node: FigNode, owner: string): FigGuid {
  const guid = node.parentIndex?.guid;
  if (guid === undefined) {
    const nodeGuid = requireNodeGuid(node, owner);
    throw new Error(`${owner}: Kiwi node ${guidKey(nodeGuid)} is missing parentIndex.guid`);
  }
  return guid;
}

function requireNodeSize(node: FigNode, owner: string): NonNullable<FigNode["size"]> {
  if (node.size === undefined) {
    const nodeGuid = requireNodeGuid(node, owner);
    throw new Error(`${owner}: Kiwi node ${guidKey(nodeGuid)} is missing size`);
  }
  return node.size;
}

function requireSameParentGuid(nodes: readonly FigNode[], owner: string): FigGuid {
  const first = nodes[0];
  if (first === undefined) {
    throw new Error(`${owner} requires at least one Kiwi node`);
  }
  const parentGuid = requireNodeParentGuid(first, owner);
  const parentKey = guidKey(parentGuid);
  const mismatch = nodes.find((node) => guidKey(requireNodeParentGuid(node, owner)) !== parentKey);
  if (mismatch !== undefined) {
    const mismatchGuid = requireNodeGuid(mismatch, owner);
    throw new Error(`${owner}: selected Kiwi node ${guidKey(mismatchGuid)} has a different parent`);
  }
  return parentGuid;
}

type NodeFrame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

function nodeFrame(node: FigNode, owner: string): NodeFrame {
  const transform = readKiwiTransform(node.transform);
  const size = requireNodeSize(node, owner);
  return {
    x: transform.m02,
    y: transform.m12,
    width: size.x,
    height: size.y,
  };
}

function appendUndoPastContext(
  history: FigContextHistory,
  context: FigDocumentContext,
): FigContextHistory {
  return {
    past: [...history.past, context],
    future: [],
  };
}

function booleanOperationFrame(nodes: readonly FigNode[], owner: string): NodeFrame {
  const frames = nodes.map((node) => nodeFrame(node, owner));
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function firstPageGuid(pages: readonly FigNode[]): FigGuid | undefined {
  const first = pages[0];
  if (first === undefined) {
    return undefined;
  }
  return requireNodeGuid(first, "FigEditorProvider");
}

function initialActivePageGuid(
  pages: readonly FigNode[],
  guid: FigGuid | undefined,
): FigGuid | undefined {
  if (guid === undefined) {
    return firstPageGuid(pages);
  }
  requireCanvasPage(pages, guid);
  return guid;
}

function pageByGuid(pages: readonly FigNode[], guid: FigGuid): FigNode | undefined {
  return pages.find((page) => {
    const pageGuid = requireNodeGuid(page, "FigEditorProvider page lookup");
    return guidEquals(pageGuid, guid);
  });
}

function requireCanvasPage(pages: readonly FigNode[], guid: FigGuid): FigNode {
  const page = pageByGuid(pages, guid);
  if (page === undefined) {
    throw new Error(`FigEditorProvider: CANVAS ${guidKey(guid)} is not present in the Kiwi document`);
  }
  if (getNodeType(page) !== "CANVAS") {
    throw new Error(`FigEditorProvider: ${guidKey(guid)} is not a CANVAS node`);
  }
  return page;
}

function nodeByGuid(context: FigDocumentContext, guid: FigGuid): FigNode {
  const key = guidKey(guid);
  const node = context.document.nodesByGuid.get(key);
  if (node === undefined) {
    throw new Error(`FigEditorProvider: node ${key} is not present in the Kiwi document`);
  }
  return node;
}

function validateSelection(context: FigDocumentContext, guids: readonly FigGuid[]): readonly FigNode[] {
  return guids.map((guid) => nodeByGuid(context, guid));
}

function initialSelectedGuids(
  context: FigDocumentContext,
  guids: readonly FigGuid[] | undefined,
): readonly FigGuid[] {
  if (guids === undefined) {
    return [];
  }
  validateSelection(context, guids);
  return [...guids];
}

function createBuilderState(context: FigDocumentContext): FigBuilderState {
  return createFigBuilderStateFromDocument({
    document: context.document,
    nodeSessionID: EDITOR_AUTHORED_NODE_SESSION_ID,
    pageSessionID: EDITOR_AUTHORED_PAGE_SESSION_ID,
    minimumNodeLocalID: FIRST_AUTHORED_LOCAL_ID,
    minimumPageLocalID: FIRST_AUTHORED_LOCAL_ID,
  });
}

function removeDescendants(
  context: FigDocumentContext,
  selected: ReadonlySet<string>,
): readonly FigNode[] {
  const shouldRemove = (node: FigNode): boolean => {
    const guid = requireNodeGuid(node, "deleteSelectedNodes");
    if (selected.has(guidKey(guid))) {
      return true;
    }
    const parent = node.parentIndex?.guid;
    if (parent === undefined) {
      return false;
    }
    return selected.has(guidKey(parent));
  };

  const retained: FigNode[] = [];
  const removed = new Set(selected);
  for (const node of context.document.nodeChanges) {
    const parent = node.parentIndex?.guid;
    if (parent !== undefined && removed.has(guidKey(parent))) {
      const guid = requireNodeGuid(node, "deleteSelectedNodes descendant");
      removed.add(guidKey(guid));
      continue;
    }
    if (shouldRemove(node)) {
      const guid = requireNodeGuid(node, "deleteSelectedNodes target");
      removed.add(guidKey(guid));
      continue;
    }
    retained.push(node);
  }
  return retained;
}

/**
 * Provide Kiwi document state and editor-only selection/tool state.
 */
export function FigEditorProvider({
  context,
  children,
  onContextChange,
  initialActivePageGuid: initialActivePageGuidProp,
  initialSelectedGuids: initialSelectedGuidsProp,
}: FigEditorProviderProps) {
  const builderStateRef = useRef(createBuilderState(context));
  const [currentContext, setCurrentContext] = useState(context);
  const [contextHistory, setContextHistory] = useState<FigContextHistory>({ past: [], future: [] });
  const selectedFigNodeDragUndoBaseContextRef = useRef<FigDocumentContext | null>(null);
  const selectedFigNodeDragPublishedContextChangeRef = useRef(false);
  const pages = useMemo(() => findCanvases(currentContext.document), [currentContext]);
  const resources = useMemo(() => figDocumentResources(currentContext), [currentContext]);
  const [activePageGuid, setActivePageGuidState] = useState<FigGuid | undefined>(
    () => initialActivePageGuid(pages, initialActivePageGuidProp),
  );
  const [selectedGuids, setSelectedGuidsState] = useState<readonly FigGuid[]>(
    () => initialSelectedGuids(context, initialSelectedGuidsProp),
  );
  const [creationMode, setCreationMode] = useState<FigCreationMode>("select");
  const [textEdit, setTextEdit] = useState<FigTextEditState>(INACTIVE_TEXT_EDIT_STATE);
  const [selectedFigNodeDragTransformActive, setSelectedFigNodeDragTransformActive] = useState(false);

  const publishContext = useCallback((next: FigDocumentContext, options: FigContextPublishOptions): void => {
    const selectedFigNodeDragUndoBaseContext = selectedFigNodeDragUndoBaseContextRef.current;
    if (
      selectedFigNodeDragUndoBaseContext !== null
      && options.source !== FIG_NODE_MUTATION_SOURCE.editorCanvasSelectedFigNodeDrag
    ) {
      throw new Error(
        `FigEditorProvider: ${options.source} mutation cannot publish during active selected FigNode drag transform`,
      );
    }
    if (selectedFigNodeDragUndoBaseContext !== null) {
      selectedFigNodeDragPublishedContextChangeRef.current = true;
      setCurrentContext(next);
      onContextChange?.(next);
      return;
    }
    setContextHistory((previous) => appendUndoPastContext(previous, currentContext));
    setCurrentContext(next);
    onContextChange?.(next);
  }, [currentContext, onContextChange]);

  const restoreContext = useCallback((next: FigDocumentContext): void => {
    selectedFigNodeDragUndoBaseContextRef.current = null;
    selectedFigNodeDragPublishedContextChangeRef.current = false;
    setCurrentContext(next);
    setSelectedGuidsState([]);
    setTextEdit(INACTIVE_TEXT_EDIT_STATE);
    setSelectedFigNodeDragTransformActive(false);
    onContextChange?.(next);
  }, [onContextChange]);

  const activePage = useMemo(() => {
    if (activePageGuid === undefined) {
      return undefined;
    }
    return requireCanvasPage(pages, activePageGuid);
  }, [activePageGuid, pages]);

  const selectedNodes = useMemo(
    () => validateSelection(currentContext, selectedGuids),
    [currentContext, selectedGuids],
  );

  const setActivePageGuid = useCallback((guid: FigGuid): void => {
    requireCanvasPage(pages, guid);
    setActivePageGuidState(guid);
    setSelectedGuidsState([]);
    setTextEdit(INACTIVE_TEXT_EDIT_STATE);
    selectedFigNodeDragUndoBaseContextRef.current = null;
    selectedFigNodeDragPublishedContextChangeRef.current = false;
    setSelectedFigNodeDragTransformActive(false);
  }, [pages]);

  const setSelectedGuids = useCallback((guids: readonly FigGuid[]): void => {
    validateSelection(currentContext, guids);
    setSelectedGuidsState((previous) => {
      if (guidListEquals(previous, guids)) {
        return previous;
      }
      return [...guids];
    });
  }, [currentContext]);

  const selectNodeGuid = useCallback((guid: FigGuid, options?: SelectNodeOptions): void => {
    nodeByGuid(currentContext, guid);
    setSelectedGuidsState((previous) => {
      const alreadySelected = previous.some((selected) => guidEquals(selected, guid));
      if (options?.toggle === true && alreadySelected) {
        return previous.filter((selected) => !guidEquals(selected, guid));
      }
      if (options?.additive === true && !alreadySelected) {
        return [...previous, guid];
      }
      if (options?.additive === true && alreadySelected) {
        return previous;
      }
      if (previous.length === 1 && alreadySelected) {
        return previous;
      }
      return [guid];
    });
  }, [currentContext]);

  const clearSelection = useCallback((): void => {
    setSelectedGuidsState((previous) => {
      if (previous.length === 0) {
        return previous;
      }
      return [];
    });
  }, []);

  const enterTextEdit = useCallback((guid: FigGuid): void => {
    const node = nodeByGuid(currentContext, guid);
    if (getNodeType(node) !== "TEXT") {
      throw new Error(`enterTextEdit requires a TEXT node, received ${getNodeType(node)}`);
    }
    setSelectedGuidsState([guid]);
    setCreationMode("select");
    setTextEdit({ type: "active", guid });
  }, [currentContext]);

  const exitTextEdit = useCallback((): void => {
    setTextEdit(INACTIVE_TEXT_EDIT_STATE);
  }, []);

  const beginSelectedFigNodeDragTransform = useCallback((): void => {
    if (selectedFigNodeDragUndoBaseContextRef.current === null) {
      selectedFigNodeDragUndoBaseContextRef.current = currentContext;
      selectedFigNodeDragPublishedContextChangeRef.current = false;
    }
    setSelectedFigNodeDragTransformActive((previous) => {
      if (previous) {
        return previous;
      }
      return true;
    });
  }, [currentContext]);

  const endSelectedFigNodeDragTransform = useCallback((): void => {
    const selectedFigNodeDragUndoBaseContext = selectedFigNodeDragUndoBaseContextRef.current;
    const selectedFigNodeDragPublishedContextChange = selectedFigNodeDragPublishedContextChangeRef.current;
    if (selectedFigNodeDragUndoBaseContext === null) {
      setSelectedFigNodeDragTransformActive((previous) => {
        if (!previous) {
          return previous;
        }
        return false;
      });
      return;
    }
    selectedFigNodeDragUndoBaseContextRef.current = null;
    selectedFigNodeDragPublishedContextChangeRef.current = false;
    if (selectedFigNodeDragPublishedContextChange) {
      setContextHistory((previous) => appendUndoPastContext(previous, selectedFigNodeDragUndoBaseContext));
    }
    setSelectedFigNodeDragTransformActive((previous) => {
      if (!previous) {
        return previous;
      }
      return false;
    });
  }, []);

  const updateNode = useCallback((
    guid: FigGuid,
    updater: (node: FigNode) => FigNode,
    source: FigNodeMutationSource,
  ): void => {
    const key = guidKey(guid);
    const found = currentContext.document.nodeChanges.some((node) => guidKey(requireNodeGuid(node, "updateNode")) === key);
    if (!found) {
      throw new Error(`updateNode: node ${key} is not present in the Kiwi document`);
    }
    const nodeChanges = currentContext.document.nodeChanges.map((node) => {
      const nodeGuid = requireNodeGuid(node, "updateNode");
      if (guidKey(nodeGuid) !== key) {
        return node;
      }
      const next = updater(node);
      const nextGuid = requireNodeGuid(next, "updateNode result");
      if (guidKey(nextGuid) !== key) {
        throw new Error("updateNode must not change Kiwi node guid");
      }
      return next;
    });
    publishContext(
      replaceFigDocumentContextNodeChanges({ context: currentContext, nodeChanges }),
      { source },
    );
  }, [currentContext, publishContext]);

  const updateSelectedNodes = useCallback((
    updater: (node: FigNode) => FigNode,
    source: FigNodeMutationSource,
  ): void => {
    if (selectedGuids.length === 0) {
      throw new Error("updateSelectedNodes requires at least one selected Kiwi node");
    }
    const selected = new Set(selectedGuids.map(guidKey));
    const nodeChanges = currentContext.document.nodeChanges.map((node) => {
      const nodeGuid = requireNodeGuid(node, "updateSelectedNodes");
      const key = guidKey(nodeGuid);
      if (!selected.has(key)) {
        return node;
      }
      const next = updater(node);
      const nextGuid = requireNodeGuid(next, "updateSelectedNodes result");
      if (guidKey(nextGuid) !== key) {
        throw new Error("updateSelectedNodes must not change Kiwi node guid");
      }
      return next;
    });
    publishContext(
      replaceFigDocumentContextNodeChanges({ context: currentContext, nodeChanges }),
      { source },
    );
  }, [currentContext, publishContext, selectedGuids]);

  const updateSelectedNodesWithImages = useCallback((
    images: readonly FigPackageImage[],
    updater: (node: FigNode) => FigNode,
    source: FigNodeMutationSource,
  ): void => {
    if (images.length === 0) {
      throw new Error("updateSelectedNodesWithImages requires at least one image asset");
    }
    if (selectedGuids.length === 0) {
      throw new Error("updateSelectedNodesWithImages requires at least one selected Kiwi node");
    }
    const imageMap = new Map(currentContext.images);
    for (const image of images) {
      imageMap.set(image.ref, image);
    }
    const selected = new Set(selectedGuids.map(guidKey));
    const nodeChanges = currentContext.document.nodeChanges.map((node) => {
      const nodeGuid = requireNodeGuid(node, "updateSelectedNodesWithImages");
      const key = guidKey(nodeGuid);
      if (!selected.has(key)) {
        return node;
      }
      const nextNode = updater(node);
      const nextGuid = requireNodeGuid(nextNode, "updateSelectedNodesWithImages result");
      if (guidKey(nextGuid) !== key) {
        throw new Error("updateSelectedNodesWithImages must not change Kiwi node guid");
      }
      return nextNode;
    });
    const next = createFigContextWithImages(currentContext, nodeChanges, imageMap);
    publishContext(next, { source });
  }, [currentContext, publishContext, selectedGuids]);

  const createBooleanOperationFromSelection = useCallback((
    operation: BooleanOperationType,
    source: FigNodeMutationSource,
  ): void => {
    if (activePageGuid === undefined) {
      throw new Error("createBooleanOperationFromSelection requires an active CANVAS");
    }
    if (selectedGuids.length < 2) {
      throw new Error("createBooleanOperationFromSelection requires at least two selected Kiwi nodes");
    }
    const selectedNodesForOperation = validateSelection(currentContext, selectedGuids);
    const parentGuid = requireSameParentGuid(selectedNodesForOperation, "createBooleanOperationFromSelection");
    if (!guidEquals(parentGuid, activePageGuid)) {
      throw new Error("createBooleanOperationFromSelection currently requires selected Kiwi nodes under the active CANVAS");
    }
    const frame = booleanOperationFrame(selectedNodesForOperation, "createBooleanOperationFromSelection");
    const result = addNode({
      state: builderStateRef.current,
      context: currentContext,
      pageGuid: activePageGuid,
      parentGuid: null,
      spec: {
        type: "BOOLEAN_OPERATION",
        name: `${operation} Selection`,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        booleanOperation: createBooleanOperationEnum(operation),
      },
    });
    const selectedKeys = selectedGuids.map(guidKey);
    const selectedKeySet = new Set(selectedKeys);
    const childPositions = new Map(selectedKeys.map((key, index) => [key, positionString(index)]));
    const nodeChanges = result.context.document.nodeChanges.map((node) => {
      const nodeGuid = requireNodeGuid(node, "createBooleanOperationFromSelection");
      const key = guidKey(nodeGuid);
      if (!selectedKeySet.has(key)) {
        return node;
      }
      const position = childPositions.get(key);
      if (position === undefined) {
        throw new Error(`createBooleanOperationFromSelection: missing child position for ${key}`);
      }
      return {
        ...node,
        parentIndex: { guid: result.nodeGuid, position },
        transform: translateTransform(node.transform, -frame.x, -frame.y),
      };
    });
    const nextContext = replaceFigDocumentContextNodeChanges({ context: result.context, nodeChanges });
    publishContext(nextContext, { source });
    setSelectedGuidsState([result.nodeGuid]);
    setTextEdit(INACTIVE_TEXT_EDIT_STATE);
  }, [activePageGuid, currentContext, publishContext, selectedGuids]);

  const addNodeToActivePage = useCallback((
    spec: NodeSpec,
    parentGuid: FigGuid | null,
    source: FigNodeMutationSource,
  ): FigGuid => {
    if (activePageGuid === undefined) {
      throw new Error("addNodeToActivePage requires an active CANVAS");
    }
    const result = addNode({
      state: builderStateRef.current,
      context: currentContext,
      pageGuid: activePageGuid,
      parentGuid,
      spec,
    });
    publishContext(result.context, { source });
    setSelectedGuidsState([result.nodeGuid]);
    setCreationMode("select");
    if (spec.type === "TEXT") {
      setTextEdit({ type: "active", guid: result.nodeGuid });
      return result.nodeGuid;
    }
    setTextEdit(INACTIVE_TEXT_EDIT_STATE);
    return result.nodeGuid;
  }, [activePageGuid, currentContext, publishContext]);

  const deleteSelectedNodes = useCallback((source: FigNodeMutationSource): void => {
    if (selectedGuids.length === 0) {
      return;
    }
    const selected = new Set(selectedGuids.map(guidKey));
    const nodeChanges = removeDescendants(currentContext, selected);
    publishContext(
      replaceFigDocumentContextNodeChanges({ context: currentContext, nodeChanges }),
      { source },
    );
    setSelectedGuidsState([]);
    setTextEdit(INACTIVE_TEXT_EDIT_STATE);
  }, [currentContext, publishContext, selectedGuids]);

  const addCanvasPage = useCallback((name: string, source: FigNodeMutationSource): FigGuid => {
    const result = addPage({
      state: builderStateRef.current,
      context: currentContext,
      name,
    });
    publishContext(result.context, { source });
    setActivePageGuidState(result.pageGuid);
    setSelectedGuidsState([]);
    setTextEdit(INACTIVE_TEXT_EDIT_STATE);
    return result.pageGuid;
  }, [currentContext, publishContext]);

  const renamePage = useCallback((guid: FigGuid, name: string, source: FigNodeMutationSource): void => {
    const key = guidKey(guid);
    const page = requireCanvasPage(pages, guid);
    const nodeChanges = currentContext.document.nodeChanges.map((node) => {
      const nodeGuid = requireNodeGuid(node, "renamePage");
      if (guidKey(nodeGuid) !== key) {
        return node;
      }
      if (getNodeType(node) !== "CANVAS") {
        throw new Error(`renamePage: node ${key} is not a CANVAS`);
      }
      return { ...node, name };
    });
    requireNodeGuid(page, "renamePage target");
    publishContext(
      replaceFigDocumentContextNodeChanges({ context: currentContext, nodeChanges }),
      { source },
    );
  }, [currentContext, pages, publishContext]);

  const deletePage = useCallback((guid: FigGuid, source: FigNodeMutationSource): void => {
    const key = guidKey(guid);
    requireCanvasPage(pages, guid);
    if (pages.length <= 1) {
      throw new Error("deletePage requires at least one remaining CANVAS");
    }
    const nodeChanges = removeDescendants(currentContext, new Set([key]));
    const next = replaceFigDocumentContextNodeChanges({ context: currentContext, nodeChanges });
    const remainingPages = findCanvases(next.document);
    const nextActivePage = remainingPages[0];
    if (nextActivePage === undefined) {
      throw new Error("deletePage removed every CANVAS from the Kiwi document");
    }
    publishContext(next, { source });
    setActivePageGuidState(requireNodeGuid(nextActivePage, "deletePage next active page"));
    setSelectedGuidsState([]);
    setTextEdit(INACTIVE_TEXT_EDIT_STATE);
  }, [currentContext, pages, publishContext]);

  const movePage = useCallback((guid: FigGuid, toIndex: number, source: FigNodeMutationSource): void => {
    const key = guidKey(guid);
    requireCanvasPage(pages, guid);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= pages.length) {
      throw new Error(`movePage target index ${toIndex} is outside the CANVAS list`);
    }
    const fromIndex = pages.findIndex((page) => guidKey(requireNodeGuid(page, "movePage page")) === key);
    if (fromIndex === -1) {
      throw new Error(`movePage: CANVAS ${key} is not present`);
    }
    const movingPage = pages[fromIndex];
    if (movingPage === undefined) {
      throw new Error(`movePage: CANVAS ${key} cannot be read`);
    }
    const without = pages.filter((page) => guidKey(requireNodeGuid(page, "movePage filter")) !== key);
    const orderedPages = [
      ...without.slice(0, toIndex),
      movingPage,
      ...without.slice(toIndex),
    ];
    const pagePositionByGuid = new Map(orderedPages.map((page, index) => [
      guidKey(requireNodeGuid(page, "movePage ordered page")),
      positionString(index),
    ]));
    const nodeChanges = currentContext.document.nodeChanges.map((node) => {
      const nodeGuid = requireNodeGuid(node, "movePage");
      const position = pagePositionByGuid.get(guidKey(nodeGuid));
      if (position === undefined) {
        return node;
      }
      const parentIndex = node.parentIndex;
      if (parentIndex === undefined) {
        throw new Error(`movePage: CANVAS ${guidKey(nodeGuid)} is missing parentIndex.guid`);
      }
      return { ...node, parentIndex: { ...parentIndex, position } };
    });
    publishContext(
      replaceFigDocumentContextNodeChanges({ context: currentContext, nodeChanges }),
      { source },
    );
  }, [currentContext, pages, publishContext]);

  const undo = useCallback((): void => {
    if (selectedFigNodeDragUndoBaseContextRef.current !== null) {
      throw new Error("FigEditorProvider: undo cannot run while a selected FigNode drag transform is active");
    }
    const previousContext = contextHistory.past[contextHistory.past.length - 1];
    if (previousContext === undefined) {
      throw new Error("FigEditorProvider: undo requires a previous Kiwi document context");
    }
    setContextHistory({
      past: contextHistory.past.slice(0, -1),
      future: [currentContext, ...contextHistory.future],
    });
    restoreContext(previousContext);
  }, [contextHistory.future, contextHistory.past, currentContext, restoreContext]);

  const redo = useCallback((): void => {
    if (selectedFigNodeDragUndoBaseContextRef.current !== null) {
      throw new Error("FigEditorProvider: redo cannot run while a selected FigNode drag transform is active");
    }
    const nextContext = contextHistory.future[0];
    if (nextContext === undefined) {
      throw new Error("FigEditorProvider: redo requires a future Kiwi document context");
    }
    setContextHistory({
      past: [...contextHistory.past, currentContext],
      future: contextHistory.future.slice(1),
    });
    restoreContext(nextContext);
  }, [contextHistory.future, contextHistory.past, currentContext, restoreContext]);

  const value = useMemo<FigEditorContextValue>(() => ({
    context: currentContext,
    resources,
    pages,
    activePage,
    activePageGuid,
    selectedGuids,
    selectedNodes,
    primaryNode: selectedNodes[0],
    creationMode,
    textEdit,
    selectedFigNodeDragTransformActive,
    canUndo: contextHistory.past.length > 0,
    canRedo: contextHistory.future.length > 0,
    setActivePageGuid,
    setSelectedGuids,
    selectNodeGuid,
    clearSelection,
    setCreationMode,
    enterTextEdit,
    exitTextEdit,
    beginSelectedFigNodeDragTransform,
    endSelectedFigNodeDragTransform,
    updateNode,
    updateSelectedNodes,
    updateSelectedNodesWithImages,
    addNodeToActivePage,
    createBooleanOperationFromSelection,
    deleteSelectedNodes,
    addPage: addCanvasPage,
    renamePage,
    deletePage,
    movePage,
    undo,
    redo,
  }), [
    currentContext,
    contextHistory.future.length,
    contextHistory.past.length,
    resources,
    pages,
    activePage,
    activePageGuid,
    selectedGuids,
    selectedNodes,
    creationMode,
    textEdit,
    selectedFigNodeDragTransformActive,
    setActivePageGuid,
    setSelectedGuids,
    selectNodeGuid,
    clearSelection,
    setCreationMode,
    enterTextEdit,
    exitTextEdit,
    beginSelectedFigNodeDragTransform,
    endSelectedFigNodeDragTransform,
    updateNode,
    updateSelectedNodes,
    updateSelectedNodesWithImages,
    addNodeToActivePage,
    createBooleanOperationFromSelection,
    deleteSelectedNodes,
    addCanvasPage,
    renamePage,
    deletePage,
    movePage,
    undo,
    redo,
  ]);

  return <FigEditorContext.Provider value={value}>{children}</FigEditorContext.Provider>;
}

/**
 * Read the required Fig editor context.
 */
export function useFigEditor(): FigEditorContextValue {
  const value = useContext(FigEditorContext);
  if (value === null) {
    throw new Error("useFigEditor must be used within FigEditorProvider");
  }
  return value;
}

/**
 * Read the Fig editor context when the caller may be outside the provider.
 */
export function useFigEditorOptional(): FigEditorContextValue | null {
  return useContext(FigEditorContext);
}
