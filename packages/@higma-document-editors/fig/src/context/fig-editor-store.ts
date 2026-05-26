/**
 * @file React-independent state store for the Kiwi-backed Fig editor.
 */
import {
  addNode,
  addPage,
  createFigDocumentContextFromLoaded,
  createFigDocumentContextFromNodeChanges,
  figDocumentResources,
  findCanvases,
  replaceFigDocumentContextNodeChanges,
  replaceFigDocumentContextNodeChangesAfterTransformOnlyEdit,
  type FigDocumentContext,
  type FigDocumentResources,
  type FigDocumentContextNodeContentEdit,
} from "@higma-document-io/fig";
import type { NodeSpec } from "@higma-document-io/fig/types";
import type { FigPackageImage } from "@higma-figma-containers/package";
import {
  createFigBuilderStateFromDocument,
  type FigBuilderState,
} from "@higma-document-models/fig/builder";
import { createBooleanOperationEnum } from "@higma-document-models/fig/boolean-operation";
import {
  getNodeType,
  guidToString,
  sameKiwiNodeExceptTransform,
} from "@higma-document-models/fig/domain";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import type { BooleanOperationType } from "@higma-primitives/path";
import { translateTransform } from "./fig-editor/matrix";
import { createFigEditorOperationSurface } from "../operation-surface/fig-editor-operation-surface";
import type { FigEditorOperationSurface } from "../operation-surface/fig-editor-operation-surface-types";

export type FigEditorCanvasNodeBoundsSnapshot = {
  readonly id: string;
  readonly rootId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly aabb: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};

export type FigEditorCanvasViewportSnapshot = {
  readonly viewport: {
    readonly translateX: number;
    readonly translateY: number;
    readonly scale: number;
  };
  readonly viewportSize: {
    readonly width: number;
    readonly height: number;
  };
  readonly rulerThickness: number;
  readonly visibleNodeBounds: readonly FigEditorCanvasNodeBoundsSnapshot[];
  readonly renderedNodeBounds: readonly FigEditorCanvasNodeBoundsSnapshot[];
};

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
  operationSurface: "operation-surface",
} as const satisfies Readonly<Record<string, string>>;

export type FigNodeMutationSource =
  typeof FIG_NODE_MUTATION_SOURCE[keyof typeof FIG_NODE_MUTATION_SOURCE];

export type FigTextEditState =
  | { readonly type: "inactive" }
  | { readonly type: "active"; readonly guid: FigGuid };

export type FigEditorSelectedFigNodeDragTransform = {
  readonly guid: FigGuid;
  readonly dx: number;
  readonly dy: number;
  readonly revision: number;
};

export type FigEditorKiwiDocumentMutationScope =
  | "initial-load"
  | "node-content"
  | "document-structure"
  | "resource-set"
  | "reference-data"
  | "history-context";

export type FigEditorKiwiDocumentMutationSource = FigNodeMutationSource | "initial-load";

export type FigEditorKiwiDocumentMutation = {
  readonly revision: number;
  readonly source: FigEditorKiwiDocumentMutationSource;
  readonly scope: FigEditorKiwiDocumentMutationScope;
  readonly changedGuidKeys: readonly string[];
};

export type SelectNodeOptions = {
  readonly additive?: boolean;
  readonly toggle?: boolean;
};

export type FigEditorContextValue = {
  readonly context: FigDocumentContext;
  readonly kiwiDocumentRevision: number;
  readonly kiwiDocumentMutation: FigEditorKiwiDocumentMutation;
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
  readonly selectedFigNodeDragTransform: FigEditorSelectedFigNodeDragTransform | null;
  readonly canvasViewport: FigEditorCanvasViewportSnapshot | undefined;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly setActivePageGuid: (guid: FigGuid) => void;
  readonly setSelectedGuids: (guids: readonly FigGuid[]) => void;
  readonly selectNodeGuid: (guid: FigGuid, options?: SelectNodeOptions) => void;
  readonly clearSelection: () => void;
  readonly setCreationMode: (mode: FigCreationMode) => void;
  readonly enterTextEdit: (guid: FigGuid) => void;
  readonly exitTextEdit: () => void;
  readonly setCanvasViewport: (snapshot: FigEditorCanvasViewportSnapshot | undefined) => void;
  readonly beginSelectedFigNodeDragTransform: () => void;
  readonly translateSelectedFigNodeDragTransform: (guid: FigGuid, dx: number, dy: number) => void;
  readonly endSelectedFigNodeDragTransform: () => void;
  readonly updateNode: (guid: FigGuid, updater: (node: FigNode) => FigNode, source: FigNodeMutationSource) => void;
  readonly updateNodeWithImages: (
    guid: FigGuid,
    images: readonly FigPackageImage[],
    updater: (node: FigNode) => FigNode,
    source: FigNodeMutationSource,
  ) => void;
  readonly updateSelectedNodes: (updater: (node: FigNode) => FigNode, source: FigNodeMutationSource) => void;
  readonly updateSelectedNodesWithImages: (
    images: readonly FigPackageImage[],
    updater: (node: FigNode) => FigNode,
    source: FigNodeMutationSource,
  ) => void;
  readonly addNodeToActivePage: (spec: NodeSpec, parentGuid: FigGuid | null, source: FigNodeMutationSource) => FigGuid;
  readonly createBooleanOperationFromSelection: (operation: BooleanOperationType, source: FigNodeMutationSource) => void;
  readonly deleteSelectedNodes: (source: FigNodeMutationSource) => void;
  readonly moveNodeWithinParent: (guid: FigGuid, toIndex: number, source: FigNodeMutationSource) => void;
  readonly addPage: (name: string, source: FigNodeMutationSource) => FigGuid;
  readonly renamePage: (guid: FigGuid, name: string, source: FigNodeMutationSource) => void;
  readonly deletePage: (guid: FigGuid, source: FigNodeMutationSource) => void;
  readonly movePage: (guid: FigGuid, toIndex: number, source: FigNodeMutationSource) => void;
  readonly undo: () => void;
  readonly redo: () => void;
};

export type FigEditorStoreOptions = {
  readonly context: FigDocumentContext;
  readonly onContextChange?: (context: FigDocumentContext) => void;
  readonly initialActivePageGuid?: FigGuid;
  readonly initialSelectedGuids?: readonly FigGuid[];
};

export type FigEditorStore = {
  readonly operationSurface: FigEditorOperationSurface;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => FigEditorContextValue;
  readonly subscribeSelectedFigNodeDragTransform: (listener: () => void) => () => void;
  readonly getSelectedFigNodeDragTransformSnapshot: () => FigEditorSelectedFigNodeDragTransform | null;
  readonly subscribeCanvasViewport: (listener: () => void) => () => void;
  readonly getCanvasViewportSnapshot: () => FigEditorCanvasViewportSnapshot | undefined;
  readonly dispose: () => void;
};

type FigContextHistory = {
  readonly past: readonly FigDocumentContext[];
  readonly future: readonly FigDocumentContext[];
};

type FigContextPublishOptions = {
  readonly source: FigNodeMutationSource;
  readonly scope: FigEditorKiwiDocumentMutationScope;
  readonly changedGuidKeys: readonly string[];
  readonly editorSnapshotDelivery?: FigEditorSnapshotDelivery;
};

type FigEditorSnapshotDelivery = "sync" | "message-channel";

type FigEditorSnapshotDeliveryState = {
  readonly scheduled: boolean;
  readonly generation: number;
};

type CommitStateOptions = {
  readonly editorSnapshotDelivery?: FigEditorSnapshotDelivery;
};

type FigEditorStoreState = {
  readonly currentContext: FigDocumentContext;
  readonly kiwiDocumentRevision: number;
  readonly kiwiDocumentMutation: FigEditorKiwiDocumentMutation;
  readonly contextHistory: FigContextHistory;
  readonly activePageGuid: FigGuid | undefined;
  readonly selectedGuids: readonly FigGuid[];
  readonly creationMode: FigCreationMode;
  readonly textEdit: FigTextEditState;
  readonly selectedFigNodeDragTransformActive: boolean;
  readonly selectedFigNodeDragTransform: FigEditorSelectedFigNodeDragTransform | null;
  readonly canvasViewport: FigEditorCanvasViewportSnapshot | undefined;
  readonly selectedFigNodeDragUndoBaseContext: FigDocumentContext | null;
  readonly selectedFigNodeDragPublishedContextChange: boolean;
};

type FigDocumentDerivedState = {
  readonly context: FigDocumentContext;
  readonly pages: readonly FigNode[];
  readonly resources: FigDocumentResources;
};

type NodeFrame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const EDITOR_AUTHORED_NODE_SESSION_ID = 1;
const EDITOR_AUTHORED_PAGE_SESSION_ID = 0;
const FIRST_AUTHORED_LOCAL_ID = 1;
const POSITION_FIRST_CHAR = 0x21;
const INACTIVE_TEXT_EDIT_STATE: FigTextEditState = { type: "inactive" };

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
  return requireNodeGuid(first, "FigEditorStore");
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
    const pageGuid = requireNodeGuid(page, "FigEditorStore page lookup");
    return guidEquals(pageGuid, guid);
  });
}

function requireCanvasPage(pages: readonly FigNode[], guid: FigGuid): FigNode {
  const page = pageByGuid(pages, guid);
  if (page === undefined) {
    throw new Error(`FigEditorStore: CANVAS ${guidKey(guid)} is not present in the Kiwi document`);
  }
  if (getNodeType(page) !== "CANVAS") {
    throw new Error(`FigEditorStore: ${guidKey(guid)} is not a CANVAS node`);
  }
  return page;
}

function nodeByGuid(context: FigDocumentContext, guid: FigGuid): FigNode {
  const key = guidKey(guid);
  const node = context.document.nodesByGuid.get(key);
  if (node === undefined) {
    throw new Error(`FigEditorStore: node ${key} is not present in the Kiwi document`);
  }
  return node;
}

function nodeChangeIndexByGuid(context: FigDocumentContext, guid: FigGuid, owner: string): number {
  const key = guidKey(guid);
  const index = context.document.nodeIndexByGuid.get(key);
  if (index === undefined) {
    throw new Error(`${owner}: node ${key} is not present in the Kiwi document`);
  }
  return index;
}

function replaceNodeChangeAtIndex(
  nodeChanges: readonly FigNode[],
  index: number,
  nextNode: FigNode,
): readonly FigNode[] {
  return [
    ...nodeChanges.slice(0, index),
    nextNode,
    ...nodeChanges.slice(index + 1),
  ];
}

function figDocumentContextAfterNodeContentEdits(
  context: FigDocumentContext,
  nodeChanges: readonly FigNode[],
  changes: readonly FigDocumentContextNodeContentEdit[],
): FigDocumentContext {
  if (changes.every(({ before, after }) => sameKiwiNodeExceptTransform(before, after))) {
    return replaceFigDocumentContextNodeChangesAfterTransformOnlyEdit({ context, nodeChanges, changes });
  }
  return replaceFigDocumentContextNodeChanges({ context, nodeChanges });
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

  const remainingNodes: FigNode[] = [];
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
    remainingNodes.push(node);
  }
  return remainingNodes;
}

function createDocumentDerivedState(context: FigDocumentContext): FigDocumentDerivedState {
  return {
    context,
    pages: findCanvases(context.document),
    resources: figDocumentResources(context),
  };
}

function createFigEditorKiwiDocumentMutation({
  revision,
  source,
  scope,
  changedGuidKeys,
}: FigEditorKiwiDocumentMutation): FigEditorKiwiDocumentMutation {
  return {
    revision,
    source,
    scope,
    changedGuidKeys: [...changedGuidKeys],
  };
}

function initialKiwiDocumentMutation(): FigEditorKiwiDocumentMutation {
  return createFigEditorKiwiDocumentMutation({
    revision: 0,
    source: "initial-load",
    scope: "initial-load",
    changedGuidKeys: [],
  });
}

function sameParentIndex(left: FigNode["parentIndex"], right: FigNode["parentIndex"]): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return guidKey(left.guid) === guidKey(right.guid) && left.position === right.position;
}

function sameCanvasViewportSnapshot(
  left: FigEditorCanvasViewportSnapshot | undefined,
  right: FigEditorCanvasViewportSnapshot | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.viewport.translateX === right.viewport.translateX &&
    left.viewport.translateY === right.viewport.translateY &&
    left.viewport.scale === right.viewport.scale &&
    left.viewportSize.width === right.viewportSize.width &&
    left.viewportSize.height === right.viewportSize.height &&
    left.rulerThickness === right.rulerThickness &&
    left.visibleNodeBounds === right.visibleNodeBounds &&
    left.renderedNodeBounds === right.renderedNodeBounds;
}

function changesReferenceData(before: FigNode, after: FigNode): boolean {
  const beforeType = getNodeType(before);
  const afterType = getNodeType(after);
  if (beforeType !== afterType) {
    return true;
  }
  return beforeType === "SYMBOL" ||
    beforeType === "VARIABLE" ||
    beforeType === "VARIABLE_SET";
}

function mutationScopeForNodeUpdates(
  changes: readonly { readonly before: FigNode; readonly after: FigNode }[],
): FigEditorKiwiDocumentMutationScope {
  if (changes.some(({ before, after }) => !sameParentIndex(before.parentIndex, after.parentIndex))) {
    return "document-structure";
  }
  if (changes.some(({ before, after }) => changesReferenceData(before, after))) {
    return "reference-data";
  }
  return "node-content";
}

function editorSnapshotDeliveryForNodeUpdates(
  changes: readonly { readonly before: FigNode; readonly after: FigNode }[],
): FigEditorSnapshotDelivery {
  if (changes.every(({ before, after }) => sameKiwiNodeExceptTransform(before, after))) {
    return "message-channel";
  }
  return "sync";
}

function stateAfterPublishedContext(
  state: FigEditorStoreState,
  nextContext: FigDocumentContext,
  options: FigContextPublishOptions,
): FigEditorStoreState {
  const nextRevision = state.kiwiDocumentRevision + 1;
  const nextMutation = createFigEditorKiwiDocumentMutation({
    revision: nextRevision,
    source: options.source,
    scope: options.scope,
    changedGuidKeys: options.changedGuidKeys,
  });
  if (
    state.selectedFigNodeDragUndoBaseContext !== null
    && options.source !== FIG_NODE_MUTATION_SOURCE.editorCanvasSelectedFigNodeDrag
  ) {
    throw new Error(
      `FigEditorStore: ${options.source} mutation cannot publish during active selected FigNode drag transform`,
    );
  }
  if (
    state.selectedFigNodeDragUndoBaseContext !== null
    && options.source === FIG_NODE_MUTATION_SOURCE.editorCanvasSelectedFigNodeDrag
  ) {
    requireSelectedFigNodeDragMutationTargets(state, options.changedGuidKeys);
  }
  if (state.selectedFigNodeDragUndoBaseContext !== null) {
    return {
      ...state,
      currentContext: nextContext,
      kiwiDocumentRevision: nextRevision,
      kiwiDocumentMutation: nextMutation,
      selectedFigNodeDragPublishedContextChange: true,
    };
  }
  return {
    ...state,
    currentContext: nextContext,
    kiwiDocumentRevision: nextRevision,
    kiwiDocumentMutation: nextMutation,
    contextHistory: appendUndoPastContext(state.contextHistory, state.currentContext),
  };
}

function requireSelectedFigNodeDragMutationTargets(
  state: FigEditorStoreState,
  changedGuidKeys: readonly string[],
): void {
  const selectedKeys = new Set(state.selectedGuids.map(guidKey));
  const nonSelectedKey = changedGuidKeys.find((key) => !selectedKeys.has(key));
  if (nonSelectedKey === undefined) {
    return;
  }
  throw new Error(
    `FigEditorStore: selected FigNode drag transform cannot mutate non-selected Kiwi node ${nonSelectedKey}`,
  );
}

/** Create the UI-library-independent Fig editor store. */
export function createFigEditorStore({
  context,
  onContextChange,
  initialActivePageGuid: initialActivePageGuidProp,
  initialSelectedGuids: initialSelectedGuidsProp,
}: FigEditorStoreOptions): FigEditorStore {
  const initialDerived = createDocumentDerivedState(context);
  const builderStateRef = { value: createBuilderState(context) };
  const stateRef: { value: FigEditorStoreState } = {
    value: {
      currentContext: context,
      kiwiDocumentRevision: 0,
      kiwiDocumentMutation: initialKiwiDocumentMutation(),
      contextHistory: { past: [], future: [] },
      activePageGuid: initialActivePageGuid(initialDerived.pages, initialActivePageGuidProp),
      selectedGuids: initialSelectedGuids(context, initialSelectedGuidsProp),
      creationMode: "select",
      textEdit: INACTIVE_TEXT_EDIT_STATE,
      selectedFigNodeDragTransformActive: false,
      selectedFigNodeDragTransform: null,
      canvasViewport: undefined,
      selectedFigNodeDragUndoBaseContext: null,
      selectedFigNodeDragPublishedContextChange: false,
    },
  };
  const listeners = new Set<() => void>();
  const selectedFigNodeDragTransformListeners = new Set<() => void>();
  const canvasViewportListeners = new Set<() => void>();
  const documentDerivedStateRef = { value: initialDerived };
  const editorSnapshotDeliveryRef: { value: FigEditorSnapshotDeliveryState } = {
    value: { scheduled: false, generation: 0 },
  };
  const disposedRef = { value: false };

  function documentDerivedState(contextForSnapshot: FigDocumentContext): FigDocumentDerivedState {
    const current = documentDerivedStateRef.value;
    if (current.context === contextForSnapshot) {
      return current;
    }
    const next = createDocumentDerivedState(contextForSnapshot);
    documentDerivedStateRef.value = next;
    return next;
  }

  function activePageForSnapshot(
    derived: FigDocumentDerivedState,
    activePageGuid: FigGuid | undefined,
  ): FigNode | undefined {
    if (activePageGuid === undefined) {
      return undefined;
    }
    return requireCanvasPage(derived.pages, activePageGuid);
  }

  function selectedFigNodeDragPublishedContextChangeAfterBegin(state: FigEditorStoreState): boolean {
    if (state.selectedFigNodeDragUndoBaseContext === null) {
      return false;
    }
    return state.selectedFigNodeDragPublishedContextChange;
  }

  function contextHistoryAfterSelectedFigNodeDragEnd(
    state: FigEditorStoreState,
    baseContext: FigDocumentContext,
  ): FigEditorStoreState["contextHistory"] {
    if (!state.selectedFigNodeDragPublishedContextChange) {
      return state.contextHistory;
    }
    return appendUndoPastContext(state.contextHistory, baseContext);
  }

  function commitEndSelectedFigNodeDragWithoutUndoBase(state: FigEditorStoreState): void {
    if (!state.selectedFigNodeDragTransformActive) {
      return;
    }
    commitState({ ...state, selectedFigNodeDragTransformActive: false, selectedFigNodeDragTransform: null });
  }

  function accumulatedSelectedFigNodeDragTransform(
    current: FigEditorSelectedFigNodeDragTransform | null,
    guid: FigGuid,
    dx: number,
    dy: number,
  ): FigEditorSelectedFigNodeDragTransform {
    if (current === null) {
      return { guid, dx, dy, revision: 1 };
    }
    if (!guidEquals(current.guid, guid)) {
      throw new Error(
        `FigEditorStore: selected FigNode drag transform cannot switch from ${guidKey(current.guid)} to ${guidKey(guid)}`,
      );
    }
    return {
      guid: current.guid,
      dx: current.dx + dx,
      dy: current.dy + dy,
      revision: current.revision + 1,
    };
  }

  function contextAfterCommittedSelectedFigNodeDragTransform(
    state: FigEditorStoreState,
    transform: FigEditorSelectedFigNodeDragTransform,
  ): {
    readonly context: FigDocumentContext;
    readonly before: FigNode;
    readonly after: FigNode;
  } {
    const key = guidKey(transform.guid);
    const index = nodeChangeIndexByGuid(
      state.currentContext,
      transform.guid,
      "endSelectedFigNodeDragTransform",
    );
    const before = state.currentContext.document.nodeChanges[index];
    if (before === undefined) {
      throw new Error(`endSelectedFigNodeDragTransform: nodeChanges index ${index} for ${key} is not present`);
    }
    const after = {
      ...before,
      transform: translateTransform(before.transform, transform.dx, transform.dy),
    };
    const nodeChanges = replaceNodeChangeAtIndex(state.currentContext.document.nodeChanges, index, after);
    return {
      context: figDocumentContextAfterNodeContentEdits(
        state.currentContext,
        nodeChanges,
        [{ before, after }],
      ),
      before,
      after,
    };
  }

  function commitSelectedFigNodeDragTransformDraft(
    state: FigEditorStoreState,
    baseContext: FigDocumentContext,
    transform: FigEditorSelectedFigNodeDragTransform,
  ): void {
    const committed = contextAfterCommittedSelectedFigNodeDragTransform(state, transform);
    commitPublishedContext(
      committed.context,
      {
        source: FIG_NODE_MUTATION_SOURCE.editorCanvasSelectedFigNodeDrag,
        scope: mutationScopeForNodeUpdates([{ before: committed.before, after: committed.after }]),
        changedGuidKeys: [guidKey(transform.guid)],
        editorSnapshotDelivery: editorSnapshotDeliveryForNodeUpdates([{ before: committed.before, after: committed.after }]),
      },
      (nextState) => ({
        ...nextState,
        contextHistory: appendUndoPastContext(nextState.contextHistory, baseContext),
        selectedFigNodeDragTransformActive: false,
        selectedFigNodeDragTransform: null,
        selectedFigNodeDragUndoBaseContext: null,
        selectedFigNodeDragPublishedContextChange: false,
      }),
    );
  }

  function createSnapshot(): FigEditorContextValue {
    const state = stateRef.value;
    const derived = documentDerivedState(state.currentContext);
    const activePage = activePageForSnapshot(derived, state.activePageGuid);
    const selectedNodes = validateSelection(state.currentContext, state.selectedGuids);
    return {
      context: state.currentContext,
      kiwiDocumentRevision: state.kiwiDocumentRevision,
      kiwiDocumentMutation: state.kiwiDocumentMutation,
      resources: derived.resources,
      pages: derived.pages,
      activePage,
      activePageGuid: state.activePageGuid,
      selectedGuids: state.selectedGuids,
      selectedNodes,
      primaryNode: selectedNodes[0],
      creationMode: state.creationMode,
      textEdit: state.textEdit,
      selectedFigNodeDragTransformActive: state.selectedFigNodeDragTransformActive,
      selectedFigNodeDragTransform: state.selectedFigNodeDragTransform,
      canvasViewport: state.canvasViewport,
      canUndo: state.contextHistory.past.length > 0,
      canRedo: state.contextHistory.future.length > 0,
      setActivePageGuid,
      setSelectedGuids,
      selectNodeGuid,
      clearSelection,
      setCreationMode,
      enterTextEdit,
      exitTextEdit,
      setCanvasViewport,
      beginSelectedFigNodeDragTransform,
      translateSelectedFigNodeDragTransform,
      endSelectedFigNodeDragTransform,
      updateNode,
      updateNodeWithImages,
      updateSelectedNodes,
      updateSelectedNodesWithImages,
      addNodeToActivePage,
      createBooleanOperationFromSelection,
      deleteSelectedNodes,
      moveNodeWithinParent,
      addPage: addCanvasPage,
      renamePage,
      deletePage,
      movePage,
      undo,
      redo,
    };
  }

  const snapshotRef = { value: null as FigEditorContextValue | null };

  function requireSnapshot(): FigEditorContextValue {
    const snapshot = snapshotRef.value;
    if (snapshot === null) {
      throw new Error("FigEditorStore snapshot has not been initialized");
    }
    return snapshot;
  }

  function snapshotWithSelectedFigNodeDragTransform(
    previous: FigEditorContextValue,
    state: FigEditorStoreState,
  ): FigEditorContextValue {
    return {
      ...previous,
      selectedFigNodeDragTransformActive: state.selectedFigNodeDragTransformActive,
      selectedFigNodeDragTransform: state.selectedFigNodeDragTransform,
    };
  }

  function snapshotWithCanvasViewport(
    previous: FigEditorContextValue,
    state: FigEditorStoreState,
  ): FigEditorContextValue {
    return {
      ...previous,
      canvasViewport: state.canvasViewport,
    };
  }

  function notifyListeners(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function requireGlobalThisMessageChannel(): typeof MessageChannel {
    const channelConstructor = globalThis.MessageChannel;
    if (typeof channelConstructor !== "function") {
      throw new Error("FigEditorStore requires globalThis.MessageChannel for deferred editor snapshot delivery");
    }
    return channelConstructor;
  }

  function notifyEditorSnapshotListenersSync(): void {
    editorSnapshotDeliveryRef.value = {
      scheduled: false,
      generation: editorSnapshotDeliveryRef.value.generation + 1,
    };
    notifyListeners();
  }

  function notifyEditorSnapshotListenersByMessageChannel(): void {
    const current = editorSnapshotDeliveryRef.value;
    if (current.scheduled) {
      return;
    }
    const generation = current.generation;
    editorSnapshotDeliveryRef.value = { scheduled: true, generation };
    const Channel = requireGlobalThisMessageChannel();
    const channel = new Channel();
    channel.port1.onmessage = (): void => {
      channel.port1.close();
      channel.port2.close();
      const latest = editorSnapshotDeliveryRef.value;
      if (disposedRef.value || !latest.scheduled || latest.generation !== generation) {
        return;
      }
      editorSnapshotDeliveryRef.value = {
        scheduled: false,
        generation: generation + 1,
      };
      notifyListeners();
    };
    channel.port2.postMessage(undefined);
  }

  function notifyEditorSnapshotListeners(delivery: FigEditorSnapshotDelivery): void {
    if (delivery === "sync") {
      notifyEditorSnapshotListenersSync();
      return;
    }
    notifyEditorSnapshotListenersByMessageChannel();
  }

  function notifySelectedFigNodeDragTransformListeners(): void {
    for (const listener of selectedFigNodeDragTransformListeners) {
      listener();
    }
  }

  function notifyCanvasViewportListeners(): void {
    for (const listener of canvasViewportListeners) {
      listener();
    }
  }

  function commitState(next: FigEditorStoreState, options?: CommitStateOptions): void {
    if (disposedRef.value) {
      throw new Error("FigEditorStore cannot be mutated after dispose");
    }
    const delivery = options?.editorSnapshotDelivery ?? "sync";
    const previousSelectedFigNodeDragTransform = stateRef.value.selectedFigNodeDragTransform;
    const previousCanvasViewport = stateRef.value.canvasViewport;
    stateRef.value = next;
    snapshotRef.value = createSnapshot();
    notifyEditorSnapshotListeners(delivery);
    if (previousSelectedFigNodeDragTransform !== next.selectedFigNodeDragTransform) {
      notifySelectedFigNodeDragTransformListeners();
    }
    if (!sameCanvasViewportSnapshot(previousCanvasViewport, next.canvasViewport)) {
      notifyCanvasViewportListeners();
    }
  }

  function commitSelectedFigNodeDragTransformState(next: FigEditorStoreState): void {
    if (disposedRef.value) {
      throw new Error("FigEditorStore cannot be mutated after dispose");
    }
    const previousSelectedFigNodeDragTransform = stateRef.value.selectedFigNodeDragTransform;
    stateRef.value = next;
    snapshotRef.value = snapshotWithSelectedFigNodeDragTransform(requireSnapshot(), next);
    if (previousSelectedFigNodeDragTransform !== next.selectedFigNodeDragTransform) {
      notifySelectedFigNodeDragTransformListeners();
    }
  }

  function commitCanvasViewportState(next: FigEditorStoreState): void {
    if (disposedRef.value) {
      throw new Error("FigEditorStore cannot be mutated after dispose");
    }
    const previousCanvasViewport = stateRef.value.canvasViewport;
    stateRef.value = next;
    snapshotRef.value = snapshotWithCanvasViewport(requireSnapshot(), next);
    if (!sameCanvasViewportSnapshot(previousCanvasViewport, next.canvasViewport)) {
      notifyCanvasViewportListeners();
    }
  }

  function commitPublishedContext(
    nextContext: FigDocumentContext,
    options: FigContextPublishOptions,
    amendState?: (state: FigEditorStoreState) => FigEditorStoreState,
  ): void {
    const nextState = stateAfterPublishedContext(stateRef.value, nextContext, options);
    commitState(
      amendState === undefined ? nextState : amendState(nextState),
      { editorSnapshotDelivery: options.editorSnapshotDelivery },
    );
    onContextChange?.(nextContext);
  }

  function setActivePageGuid(guid: FigGuid): void {
    const state = stateRef.value;
    const derived = documentDerivedState(state.currentContext);
    requireCanvasPage(derived.pages, guid);
    commitState({
      ...state,
      activePageGuid: guid,
      selectedGuids: [],
      textEdit: INACTIVE_TEXT_EDIT_STATE,
      selectedFigNodeDragUndoBaseContext: null,
      selectedFigNodeDragPublishedContextChange: false,
      selectedFigNodeDragTransformActive: false,
      selectedFigNodeDragTransform: null,
    });
  }

  function setSelectedGuids(guids: readonly FigGuid[]): void {
    const state = stateRef.value;
    validateSelection(state.currentContext, guids);
    if (guidListEquals(state.selectedGuids, guids)) {
      return;
    }
    commitState({ ...state, selectedGuids: [...guids] });
  }

  function selectNodeGuid(guid: FigGuid, options?: SelectNodeOptions): void {
    const state = stateRef.value;
    nodeByGuid(state.currentContext, guid);
    const alreadySelected = state.selectedGuids.some((selected) => guidEquals(selected, guid));
    if (options?.toggle === true && alreadySelected) {
      commitState({
        ...state,
        selectedGuids: state.selectedGuids.filter((selected) => !guidEquals(selected, guid)),
      });
      return;
    }
    if (options?.additive === true && !alreadySelected) {
      commitState({ ...state, selectedGuids: [...state.selectedGuids, guid] });
      return;
    }
    if (options?.additive === true && alreadySelected) {
      return;
    }
    if (state.selectedGuids.length === 1 && alreadySelected) {
      return;
    }
    commitState({ ...state, selectedGuids: [guid] });
  }

  function clearSelection(): void {
    const state = stateRef.value;
    if (state.selectedGuids.length === 0) {
      return;
    }
    commitState({ ...state, selectedGuids: [] });
  }

  function setCreationMode(mode: FigCreationMode): void {
    const state = stateRef.value;
    if (state.creationMode === mode) {
      return;
    }
    commitState({ ...state, creationMode: mode });
  }

  function enterTextEdit(guid: FigGuid): void {
    const state = stateRef.value;
    const node = nodeByGuid(state.currentContext, guid);
    if (getNodeType(node) !== "TEXT") {
      throw new Error(`enterTextEdit requires a TEXT node, received ${getNodeType(node)}`);
    }
    commitState({
      ...state,
      selectedGuids: [guid],
      creationMode: "select",
      textEdit: { type: "active", guid },
    });
  }

  function exitTextEdit(): void {
    const state = stateRef.value;
    if (state.textEdit.type === "inactive") {
      return;
    }
    commitState({ ...state, textEdit: INACTIVE_TEXT_EDIT_STATE });
  }

  function setCanvasViewport(snapshot: FigEditorCanvasViewportSnapshot | undefined): void {
    const state = stateRef.value;
    if (sameCanvasViewportSnapshot(state.canvasViewport, snapshot)) {
      return;
    }
    commitCanvasViewportState({ ...state, canvasViewport: snapshot });
  }

  function beginSelectedFigNodeDragTransform(): void {
    const state = stateRef.value;
    if (state.selectedFigNodeDragUndoBaseContext !== null && state.selectedFigNodeDragTransformActive) {
      return;
    }
    commitState({
      ...state,
      selectedFigNodeDragUndoBaseContext: state.selectedFigNodeDragUndoBaseContext ?? state.currentContext,
      selectedFigNodeDragPublishedContextChange: selectedFigNodeDragPublishedContextChangeAfterBegin(state),
      selectedFigNodeDragTransformActive: true,
    });
  }

  function translateSelectedFigNodeDragTransform(guid: FigGuid, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) {
      return;
    }
    const state = stateRef.value;
    if (!state.selectedFigNodeDragTransformActive || state.selectedFigNodeDragUndoBaseContext === null) {
      throw new Error("FigEditorStore: translateSelectedFigNodeDragTransform requires an active selected FigNode drag transform");
    }
    nodeByGuid(state.currentContext, guid);
    if (!state.selectedGuids.some((selected) => guidEquals(selected, guid))) {
      throw new Error(
        `FigEditorStore: selected FigNode drag transform cannot translate non-selected Kiwi node ${guidKey(guid)}`,
      );
    }
    commitSelectedFigNodeDragTransformState({
      ...state,
      selectedFigNodeDragTransform: accumulatedSelectedFigNodeDragTransform(
        state.selectedFigNodeDragTransform,
        guid,
        dx,
        dy,
      ),
    });
  }

  function endSelectedFigNodeDragTransform(): void {
    const state = stateRef.value;
    const baseContext = state.selectedFigNodeDragUndoBaseContext;
    if (baseContext === null) {
      commitEndSelectedFigNodeDragWithoutUndoBase(state);
      return;
    }
    if (state.selectedFigNodeDragTransform !== null) {
      commitSelectedFigNodeDragTransformDraft(state, baseContext, state.selectedFigNodeDragTransform);
      return;
    }
    commitState({
      ...state,
      contextHistory: contextHistoryAfterSelectedFigNodeDragEnd(state, baseContext),
      selectedFigNodeDragUndoBaseContext: null,
      selectedFigNodeDragPublishedContextChange: false,
      selectedFigNodeDragTransformActive: false,
      selectedFigNodeDragTransform: null,
    });
  }

  function updateNode(
    guid: FigGuid,
    updater: (node: FigNode) => FigNode,
    source: FigNodeMutationSource,
  ): void {
    const state = stateRef.value;
    const key = guidKey(guid);
    const index = nodeChangeIndexByGuid(state.currentContext, guid, "updateNode");
    const before = state.currentContext.document.nodeChanges[index];
    if (before === undefined) {
      throw new Error(`updateNode: nodeChanges index ${index} for ${key} is not present`);
    }
    const next = updater(before);
    const nextGuid = requireNodeGuid(next, "updateNode result");
    if (guidKey(nextGuid) !== key) {
      throw new Error("updateNode must not change Kiwi node guid");
    }
    const nodeChanges = replaceNodeChangeAtIndex(state.currentContext.document.nodeChanges, index, next);
    commitPublishedContext(
      figDocumentContextAfterNodeContentEdits(
        state.currentContext,
        nodeChanges,
        [{ before, after: next }],
      ),
      {
        source,
        scope: mutationScopeForNodeUpdates([{ before, after: next }]),
        changedGuidKeys: [key],
        editorSnapshotDelivery: editorSnapshotDeliveryForNodeUpdates([{ before, after: next }]),
      },
    );
  }

  function updateNodeWithImages(
    guid: FigGuid,
    images: readonly FigPackageImage[],
    updater: (node: FigNode) => FigNode,
    source: FigNodeMutationSource,
  ): void {
    const state = stateRef.value;
    if (images.length === 0) {
      throw new Error("updateNodeWithImages requires at least one image asset");
    }
    const key = guidKey(guid);
    const imageMap = new Map(state.currentContext.images);
    for (const image of images) {
      imageMap.set(image.ref, image);
    }
    const index = nodeChangeIndexByGuid(state.currentContext, guid, "updateNodeWithImages");
    const before = state.currentContext.document.nodeChanges[index];
    if (before === undefined) {
      throw new Error(`updateNodeWithImages: nodeChanges index ${index} for ${key} is not present`);
    }
    const next = updater(before);
    const nextGuid = requireNodeGuid(next, "updateNodeWithImages result");
    if (guidKey(nextGuid) !== key) {
      throw new Error("updateNodeWithImages must not change Kiwi node guid");
    }
    const nodeChanges = replaceNodeChangeAtIndex(state.currentContext.document.nodeChanges, index, next);
    commitPublishedContext(
      createFigContextWithImages(state.currentContext, nodeChanges, imageMap),
      { source, scope: "resource-set", changedGuidKeys: [key] },
    );
  }

  function updateSelectedNodes(
    updater: (node: FigNode) => FigNode,
    source: FigNodeMutationSource,
  ): void {
    const state = stateRef.value;
    if (state.selectedGuids.length === 0) {
      throw new Error("updateSelectedNodes requires at least one selected Kiwi node");
    }
    const selected = new Set(state.selectedGuids.map(guidKey));
    const changes: { before: FigNode; after: FigNode }[] = [];
    const nodeChanges = state.currentContext.document.nodeChanges.map((node) => {
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
      changes.push({ before: node, after: next });
      return next;
    });
    commitPublishedContext(
      figDocumentContextAfterNodeContentEdits(state.currentContext, nodeChanges, changes),
      {
        source,
        scope: mutationScopeForNodeUpdates(changes),
        changedGuidKeys: state.selectedGuids.map(guidKey),
        editorSnapshotDelivery: editorSnapshotDeliveryForNodeUpdates(changes),
      },
    );
  }

  function updateSelectedNodesWithImages(
    images: readonly FigPackageImage[],
    updater: (node: FigNode) => FigNode,
    source: FigNodeMutationSource,
  ): void {
    const state = stateRef.value;
    if (images.length === 0) {
      throw new Error("updateSelectedNodesWithImages requires at least one image asset");
    }
    if (state.selectedGuids.length === 0) {
      throw new Error("updateSelectedNodesWithImages requires at least one selected Kiwi node");
    }
    const imageMap = new Map(state.currentContext.images);
    for (const image of images) {
      imageMap.set(image.ref, image);
    }
    const selected = new Set(state.selectedGuids.map(guidKey));
    const nodeChanges = state.currentContext.document.nodeChanges.map((node) => {
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
    commitPublishedContext(
      createFigContextWithImages(state.currentContext, nodeChanges, imageMap),
      { source, scope: "resource-set", changedGuidKeys: state.selectedGuids.map(guidKey) },
    );
  }

  function createBooleanOperationFromSelection(
    operation: BooleanOperationType,
    source: FigNodeMutationSource,
  ): void {
    const state = stateRef.value;
    if (state.activePageGuid === undefined) {
      throw new Error("createBooleanOperationFromSelection requires an active CANVAS");
    }
    if (state.selectedGuids.length < 2) {
      throw new Error("createBooleanOperationFromSelection requires at least two selected Kiwi nodes");
    }
    const selectedNodesForOperation = validateSelection(state.currentContext, state.selectedGuids);
    const parentGuid = requireSameParentGuid(selectedNodesForOperation, "createBooleanOperationFromSelection");
    if (!guidEquals(parentGuid, state.activePageGuid)) {
      throw new Error("createBooleanOperationFromSelection currently requires selected Kiwi nodes under the active CANVAS");
    }
    const frame = booleanOperationFrame(selectedNodesForOperation, "createBooleanOperationFromSelection");
    const result = addNode({
      state: builderStateRef.value,
      context: state.currentContext,
      pageGuid: state.activePageGuid,
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
    const selectedKeys = state.selectedGuids.map(guidKey);
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
    commitPublishedContext(nextContext, {
      source,
      scope: "document-structure",
      changedGuidKeys: [result.nodeGuid, ...state.selectedGuids].map(guidKey),
    }, (nextState) => ({
      ...nextState,
      selectedGuids: [result.nodeGuid],
      textEdit: INACTIVE_TEXT_EDIT_STATE,
    }));
  }

  function addNodeToActivePage(
    spec: NodeSpec,
    parentGuid: FigGuid | null,
    source: FigNodeMutationSource,
  ): FigGuid {
    const state = stateRef.value;
    if (state.activePageGuid === undefined) {
      throw new Error("addNodeToActivePage requires an active CANVAS");
    }
    const result = addNode({
      state: builderStateRef.value,
      context: state.currentContext,
      pageGuid: state.activePageGuid,
      parentGuid,
      spec,
    });
    commitPublishedContext(result.context, {
      source,
      scope: "document-structure",
      changedGuidKeys: [result.nodeGuid].map(guidKey),
    }, (nextState) => ({
      ...nextState,
      selectedGuids: [result.nodeGuid],
      creationMode: "select",
      textEdit: spec.type === "TEXT" ? { type: "active", guid: result.nodeGuid } : INACTIVE_TEXT_EDIT_STATE,
    }));
    return result.nodeGuid;
  }

  function deleteSelectedNodes(source: FigNodeMutationSource): void {
    const state = stateRef.value;
    if (state.selectedGuids.length === 0) {
      return;
    }
    const selected = new Set(state.selectedGuids.map(guidKey));
    const nodeChanges = removeDescendants(state.currentContext, selected);
    commitPublishedContext(
      replaceFigDocumentContextNodeChanges({ context: state.currentContext, nodeChanges }),
      { source, scope: "document-structure", changedGuidKeys: state.selectedGuids.map(guidKey) },
      (nextState) => ({
        ...nextState,
        selectedGuids: [],
        textEdit: INACTIVE_TEXT_EDIT_STATE,
      }),
    );
  }

  function moveNodeWithinParent(guid: FigGuid, toIndex: number, source: FigNodeMutationSource): void {
    const state = stateRef.value;
    const key = guidKey(guid);
    const node = nodeByGuid(state.currentContext, guid);
    if (getNodeType(node) === "CANVAS") {
      throw new Error("moveNodeWithinParent cannot move CANVAS nodes; use movePage");
    }
    const parentGuid = requireNodeParentGuid(node, "moveNodeWithinParent");
    const parent = nodeByGuid(state.currentContext, parentGuid);
    const siblings = state.currentContext.document.childrenOf(parent);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= siblings.length) {
      throw new Error(`moveNodeWithinParent target index ${toIndex} is outside the sibling list`);
    }
    const movingNode = siblings.find((sibling) => guidKey(requireNodeGuid(sibling, "moveNodeWithinParent sibling")) === key);
    if (movingNode === undefined) {
      throw new Error(`moveNodeWithinParent: node ${key} is not a child of its parent`);
    }
    const withoutMovingNode = siblings.filter((sibling) => guidKey(requireNodeGuid(sibling, "moveNodeWithinParent filter")) !== key);
    const orderedSiblings = [
      ...withoutMovingNode.slice(0, toIndex),
      movingNode,
      ...withoutMovingNode.slice(toIndex),
    ];
    const positionByGuid = new Map(orderedSiblings.map((sibling, index) => [
      guidKey(requireNodeGuid(sibling, "moveNodeWithinParent ordered sibling")),
      positionString(index),
    ]));
    const nodeChanges = state.currentContext.document.nodeChanges.map((current) => {
      const currentGuid = requireNodeGuid(current, "moveNodeWithinParent");
      const position = positionByGuid.get(guidKey(currentGuid));
      if (position === undefined) {
        return current;
      }
      const parentIndex = current.parentIndex;
      if (parentIndex?.guid === undefined) {
        throw new Error(`moveNodeWithinParent: sibling ${guidKey(currentGuid)} is missing parentIndex.guid`);
      }
      return { ...current, parentIndex: { ...parentIndex, position } };
    });
    commitPublishedContext(
      replaceFigDocumentContextNodeChanges({ context: state.currentContext, nodeChanges }),
      { source, scope: "document-structure", changedGuidKeys: [key] },
    );
  }

  function addCanvasPage(name: string, source: FigNodeMutationSource): FigGuid {
    const state = stateRef.value;
    const result = addPage({
      state: builderStateRef.value,
      context: state.currentContext,
      name,
    });
    commitPublishedContext(result.context, {
      source,
      scope: "document-structure",
      changedGuidKeys: [result.pageGuid].map(guidKey),
    }, (nextState) => ({
      ...nextState,
      activePageGuid: result.pageGuid,
      selectedGuids: [],
      textEdit: INACTIVE_TEXT_EDIT_STATE,
    }));
    return result.pageGuid;
  }

  function renamePage(guid: FigGuid, name: string, source: FigNodeMutationSource): void {
    const state = stateRef.value;
    const key = guidKey(guid);
    const derived = documentDerivedState(state.currentContext);
    const page = requireCanvasPage(derived.pages, guid);
    const nodeChanges = state.currentContext.document.nodeChanges.map((node) => {
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
    commitPublishedContext(
      replaceFigDocumentContextNodeChanges({ context: state.currentContext, nodeChanges }),
      { source, scope: "node-content", changedGuidKeys: [key] },
    );
  }

  function deletePage(guid: FigGuid, source: FigNodeMutationSource): void {
    const state = stateRef.value;
    const key = guidKey(guid);
    const derived = documentDerivedState(state.currentContext);
    requireCanvasPage(derived.pages, guid);
    if (derived.pages.length <= 1) {
      throw new Error("deletePage requires at least one remaining CANVAS");
    }
    const nodeChanges = removeDescendants(state.currentContext, new Set([key]));
    const next = replaceFigDocumentContextNodeChanges({ context: state.currentContext, nodeChanges });
    const remainingPages = findCanvases(next.document);
    const nextActivePage = remainingPages[0];
    if (nextActivePage === undefined) {
      throw new Error("deletePage removed every CANVAS from the Kiwi document");
    }
    commitPublishedContext(next, { source, scope: "document-structure", changedGuidKeys: [key] }, (nextState) => ({
      ...nextState,
      activePageGuid: requireNodeGuid(nextActivePage, "deletePage next active page"),
      selectedGuids: [],
      textEdit: INACTIVE_TEXT_EDIT_STATE,
    }));
  }

  function movePage(guid: FigGuid, toIndex: number, source: FigNodeMutationSource): void {
    const state = stateRef.value;
    const key = guidKey(guid);
    const derived = documentDerivedState(state.currentContext);
    requireCanvasPage(derived.pages, guid);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= derived.pages.length) {
      throw new Error(`movePage target index ${toIndex} is outside the CANVAS list`);
    }
    const fromIndex = derived.pages.findIndex((page) => guidKey(requireNodeGuid(page, "movePage page")) === key);
    if (fromIndex === -1) {
      throw new Error(`movePage: CANVAS ${key} is not present`);
    }
    const movingPage = derived.pages[fromIndex];
    if (movingPage === undefined) {
      throw new Error(`movePage: CANVAS ${key} cannot be read`);
    }
    const without = derived.pages.filter((page) => guidKey(requireNodeGuid(page, "movePage filter")) !== key);
    const orderedPages = [
      ...without.slice(0, toIndex),
      movingPage,
      ...without.slice(toIndex),
    ];
    const pagePositionByGuid = new Map(orderedPages.map((page, index) => [
      guidKey(requireNodeGuid(page, "movePage ordered page")),
      positionString(index),
    ]));
    const nodeChanges = state.currentContext.document.nodeChanges.map((node) => {
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
    commitPublishedContext(
      replaceFigDocumentContextNodeChanges({ context: state.currentContext, nodeChanges }),
      { source, scope: "document-structure", changedGuidKeys: [key] },
    );
  }

  function undo(): void {
    const state = stateRef.value;
    if (state.selectedFigNodeDragUndoBaseContext !== null) {
      throw new Error("FigEditorStore: undo cannot run while a selected FigNode drag transform is active");
    }
    const previousContext = state.contextHistory.past[state.contextHistory.past.length - 1];
    if (previousContext === undefined) {
      throw new Error("FigEditorStore: undo requires a previous Kiwi document context");
    }
    const nextRevision = state.kiwiDocumentRevision + 1;
    commitState({
      ...state,
      contextHistory: {
        past: state.contextHistory.past.slice(0, -1),
        future: [state.currentContext, ...state.contextHistory.future],
      },
      currentContext: previousContext,
      kiwiDocumentRevision: nextRevision,
      kiwiDocumentMutation: createFigEditorKiwiDocumentMutation({
        revision: nextRevision,
        source: FIG_NODE_MUTATION_SOURCE.operationSurface,
        scope: "history-context",
        changedGuidKeys: [],
      }),
      selectedGuids: [],
      textEdit: INACTIVE_TEXT_EDIT_STATE,
      selectedFigNodeDragTransformActive: false,
      selectedFigNodeDragTransform: null,
      selectedFigNodeDragUndoBaseContext: null,
      selectedFigNodeDragPublishedContextChange: false,
    });
    onContextChange?.(previousContext);
  }

  function redo(): void {
    const state = stateRef.value;
    if (state.selectedFigNodeDragUndoBaseContext !== null) {
      throw new Error("FigEditorStore: redo cannot run while a selected FigNode drag transform is active");
    }
    const nextContext = state.contextHistory.future[0];
    if (nextContext === undefined) {
      throw new Error("FigEditorStore: redo requires a future Kiwi document context");
    }
    const nextRevision = state.kiwiDocumentRevision + 1;
    commitState({
      ...state,
      contextHistory: {
        past: [...state.contextHistory.past, state.currentContext],
        future: state.contextHistory.future.slice(1),
      },
      currentContext: nextContext,
      kiwiDocumentRevision: nextRevision,
      kiwiDocumentMutation: createFigEditorKiwiDocumentMutation({
        revision: nextRevision,
        source: FIG_NODE_MUTATION_SOURCE.operationSurface,
        scope: "history-context",
        changedGuidKeys: [],
      }),
      selectedGuids: [],
      textEdit: INACTIVE_TEXT_EDIT_STATE,
      selectedFigNodeDragTransformActive: false,
      selectedFigNodeDragTransform: null,
      selectedFigNodeDragUndoBaseContext: null,
      selectedFigNodeDragPublishedContextChange: false,
    });
    onContextChange?.(nextContext);
  }

  snapshotRef.value = createSnapshot();
  const operationSurface = createFigEditorOperationSurface({
    readEditor: requireSnapshot,
    mutationSource: FIG_NODE_MUTATION_SOURCE.operationSurface,
  });

  return {
    operationSurface,

    subscribe(listener): () => void {
      if (disposedRef.value) {
        throw new Error("FigEditorStore cannot be subscribed after dispose");
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): FigEditorContextValue {
      return requireSnapshot();
    },

    subscribeSelectedFigNodeDragTransform(listener): () => void {
      if (disposedRef.value) {
        throw new Error("FigEditorStore selected FigNode drag transform cannot be subscribed after dispose");
      }
      selectedFigNodeDragTransformListeners.add(listener);
      return () => {
        selectedFigNodeDragTransformListeners.delete(listener);
      };
    },

    getSelectedFigNodeDragTransformSnapshot(): FigEditorSelectedFigNodeDragTransform | null {
      return stateRef.value.selectedFigNodeDragTransform;
    },

    subscribeCanvasViewport(listener): () => void {
      if (disposedRef.value) {
        throw new Error("FigEditorStore canvas viewport cannot be subscribed after dispose");
      }
      canvasViewportListeners.add(listener);
      return () => {
        canvasViewportListeners.delete(listener);
      };
    },

    getCanvasViewportSnapshot(): FigEditorCanvasViewportSnapshot | undefined {
      return stateRef.value.canvasViewport;
    },

    dispose(): void {
      disposedRef.value = true;
      listeners.clear();
      selectedFigNodeDragTransformListeners.clear();
      canvasViewportListeners.clear();
      snapshotRef.value = null;
    },
  };
}
