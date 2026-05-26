/** @file Fig editor operation surface contract over Kiwi GUIDs. */
import type { NodeSpec } from "@higma-document-io/fig/types";
import type { FigComponentPropertyTypeName } from "@higma-document-models/fig/domain";
import type { FigComponentPropValue, FigGuid, FigNode } from "@higma-document-models/fig/types";
import type { BooleanOperationType } from "@higma-primitives/path";
import type {
  FigCreationMode,
  FigEditorCanvasViewportSnapshot,
  FigEditorContextValue,
  FigEditorKiwiDocumentMutation,
  FigNodeMutationSource,
  SelectNodeOptions,
} from "../context/fig-editor-store";
import type {
  FigEditorImageAssetInput,
  FigEditorPaintImageAssetTarget,
} from "../editor-commands/fig-editor-image-paint-command";
import type { EditablePathCommand, EditableVectorPathOperation } from "../vector-path/commands";
import type { FigEditorWebGLSurfaceSnapshot } from "../canvas/webgl/fig-editor-webgl-surface-state";

export const FIG_EDITOR_OPERATION_SURFACE_VERSION = 1;
export const FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY = "higmaFigEditor";

export type FigEditorOperationSurfaceGuidInput = FigGuid | string;

export type FigEditorOperationSurfaceNodeQuery = {
  readonly name?: string;
  readonly type?: string;
  readonly parentGuid?: FigEditorOperationSurfaceGuidInput;
  readonly pageGuid?: FigEditorOperationSurfaceGuidInput;
};

export type FigEditorOperationSurfaceNodeSelector =
  | FigEditorOperationSurfaceGuidInput
  | { readonly guid: FigEditorOperationSurfaceGuidInput }
  | FigEditorOperationSurfaceNodeQuery;

export type FigEditorOperationSurfaceNodeSnapshot = {
  readonly guid: FigGuid;
  readonly guidKey: string;
  readonly name: string | undefined;
  readonly type: string;
  readonly parentGuid: FigGuid | undefined;
  readonly parentGuidKey: string | undefined;
  readonly childGuidKeys: readonly string[];
  readonly node: FigNode;
};

export type FigEditorOperationSurfaceDocumentSnapshot = {
  readonly kiwiDocumentRevision: number;
  readonly kiwiDocumentMutation: FigEditorKiwiDocumentMutation;
  readonly activePageGuidKey: string | undefined;
  readonly selectedGuidKeys: readonly string[];
  readonly pageGuidKeys: readonly string[];
  readonly nodeCount: number;
  readonly nodes: readonly FigEditorOperationSurfaceNodeSnapshot[];
};

export type FigEditorOperationSurfaceSymbolResolutionSnapshot = {
  readonly instanceGuidKey: string;
  readonly effectiveSymbolGuidKey: string | undefined;
  readonly effectiveSymbolName: string | undefined;
  readonly resolvedDescendantNames: readonly string[];
  readonly dependencyGuidKeys: readonly string[];
};

export type FigEditorOperationSurfaceNodeBoundsSnapshot = {
  readonly guidKey: string;
  readonly rootGuidKey: string;
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

export type FigEditorOperationSurfaceNodeRatio = {
  readonly x: number;
  readonly y: number;
};

export type FigEditorOperationSurfaceNodeViewportPoint = {
  readonly guidKey: string;
  readonly pageX: number;
  readonly pageY: number;
  readonly viewportX: number;
  readonly viewportY: number;
};

export type FigEditorOperationSurfaceViewportPoint = {
  readonly viewportX: number;
  readonly viewportY: number;
};

export type FigEditorOperationSurfaceViewportDelta = {
  readonly viewportDx: number;
  readonly viewportDy: number;
};

export type FigEditorOperationSurfaceCanvasHitSnapshot = {
  readonly point: {
    readonly pageX: number;
    readonly pageY: number;
    readonly viewportX: number;
    readonly viewportY: number;
  };
  readonly bounds: FigEditorOperationSurfaceNodeBoundsSnapshot;
  readonly node: FigEditorOperationSurfaceNodeSnapshot;
};

export type FigEditorOperationSurfaceNodePaintAssetInput = FigEditorImageAssetInput & FigEditorPaintImageAssetTarget;

export type FigEditorOperationSurfaceImageAssetSnapshot = {
  readonly ref: string;
  readonly mimeType: string;
  readonly byteLength: number;
};

export type FigEditorOperationSurfaceComponentPropertySnapshot = {
  readonly defGuidKey: string;
  readonly name: string;
  readonly type: FigComponentPropertyTypeName;
  readonly value: FigComponentPropValue;
  readonly isOverridden: boolean;
  readonly symbolGuidKey: string;
  readonly symbolName: string | undefined;
};

export type FigEditorOperationSurface = {
  readonly version: typeof FIG_EDITOR_OPERATION_SURFACE_VERSION;
  readonly guid: {
    readonly fromKey: (guidKey: string) => FigGuid;
    readonly toKey: (guid: FigGuid) => string;
  };
  readonly document: {
    readonly snapshot: () => FigEditorOperationSurfaceDocumentSnapshot;
    readonly nodes: (query?: FigEditorOperationSurfaceNodeQuery) => readonly FigEditorOperationSurfaceNodeSnapshot[];
    readonly requireNode: (selector: FigEditorOperationSurfaceNodeSelector) => FigEditorOperationSurfaceNodeSnapshot;
    readonly children: (selector: FigEditorOperationSurfaceNodeSelector) => readonly FigEditorOperationSurfaceNodeSnapshot[];
    readonly descendants: (selector: FigEditorOperationSurfaceNodeSelector) => readonly FigEditorOperationSurfaceNodeSnapshot[];
    readonly pages: () => readonly FigEditorOperationSurfaceNodeSnapshot[];
    readonly activePage: () => FigEditorOperationSurfaceNodeSnapshot;
    readonly selectedNodes: () => readonly FigEditorOperationSurfaceNodeSnapshot[];
    readonly symbolResolution: (selector: FigEditorOperationSurfaceNodeSelector) => FigEditorOperationSurfaceSymbolResolutionSnapshot;
  };
  readonly selection: {
    readonly set: (selectors: readonly FigEditorOperationSurfaceNodeSelector[]) => void;
    readonly select: (selector: FigEditorOperationSurfaceNodeSelector, options?: SelectNodeOptions) => void;
    readonly clear: () => void;
  };
  readonly creationMode: {
    readonly get: () => FigCreationMode;
    readonly set: (mode: FigCreationMode) => void;
  };
  readonly canvasInteraction: {
    readonly beginSelectedFigNodeDragTransform: () => void;
    readonly translateFigNodeDuringSelectedFigNodeDragTransform: (
      selector: FigEditorOperationSurfaceNodeSelector,
      delta: { readonly dx: number; readonly dy: number },
    ) => void;
    readonly translateFigNodeDuringSelectedFigNodeDragTransformByViewportDelta: (
      selector: FigEditorOperationSurfaceNodeSelector,
      delta: FigEditorOperationSurfaceViewportDelta,
    ) => void;
    readonly endSelectedFigNodeDragTransform: () => void;
  };
  readonly canvas: {
    readonly viewport: () => FigEditorCanvasViewportSnapshot;
    readonly visibleNodeBounds: (query?: FigEditorOperationSurfaceNodeQuery) => readonly FigEditorOperationSurfaceNodeBoundsSnapshot[];
    readonly nodeBounds: (selector: FigEditorOperationSurfaceNodeSelector) => FigEditorOperationSurfaceNodeBoundsSnapshot;
    readonly nodeViewportPoint: (
      selector: FigEditorOperationSurfaceNodeSelector,
      ratio: FigEditorOperationSurfaceNodeRatio,
    ) => FigEditorOperationSurfaceNodeViewportPoint;
    readonly hitTestViewportPoint: (
      point: FigEditorOperationSurfaceViewportPoint,
    ) => FigEditorOperationSurfaceCanvasHitSnapshot | undefined;
    readonly requireHitTestViewportPoint: (
      point: FigEditorOperationSurfaceViewportPoint,
    ) => FigEditorOperationSurfaceCanvasHitSnapshot;
    readonly selectNodeAtViewportPoint: (
      point: FigEditorOperationSurfaceViewportPoint,
      options?: SelectNodeOptions,
    ) => FigEditorOperationSurfaceCanvasHitSnapshot | undefined;
    readonly requireSelectNodeAtViewportPoint: (
      point: FigEditorOperationSurfaceViewportPoint,
      options?: SelectNodeOptions,
    ) => FigEditorOperationSurfaceCanvasHitSnapshot;
  };
  readonly page: {
    readonly setActive: (selector: FigEditorOperationSurfaceNodeSelector) => void;
    readonly add: (name: string) => FigEditorOperationSurfaceNodeSnapshot;
    readonly rename: (selector: FigEditorOperationSurfaceNodeSelector, name: string) => void;
    readonly move: (selector: FigEditorOperationSurfaceNodeSelector, toIndex: number) => void;
    readonly delete: (selector: FigEditorOperationSurfaceNodeSelector) => void;
  };
  readonly node: {
    readonly createOnActivePage: (spec: NodeSpec, parentGuid?: FigEditorOperationSurfaceGuidInput) => FigEditorOperationSurfaceNodeSnapshot;
    readonly replaceKiwiNode: (selector: FigEditorOperationSurfaceNodeSelector, replacement: FigNode) => void;
    readonly rename: (selector: FigEditorOperationSurfaceNodeSelector, name: string) => void;
    readonly setVisible: (selector: FigEditorOperationSurfaceNodeSelector, visible: boolean) => void;
    readonly setOpacity: (selector: FigEditorOperationSurfaceNodeSelector, opacity: number) => void;
    readonly setPosition: (selector: FigEditorOperationSurfaceNodeSelector, position: { readonly x: number; readonly y: number }) => void;
    readonly translate: (selector: FigEditorOperationSurfaceNodeSelector, delta: { readonly dx: number; readonly dy: number }) => void;
    readonly resize: (selector: FigEditorOperationSurfaceNodeSelector, size: { readonly width: number; readonly height: number }) => void;
    readonly moveWithinParent: (selector: FigEditorOperationSurfaceNodeSelector, toIndex: number) => void;
    readonly convertToSymbol: (selector: FigEditorOperationSurfaceNodeSelector) => void;
    readonly deleteSelected: () => void;
    readonly convertSelectionToBoolean: (operation: BooleanOperationType) => void;
  };
  readonly text: {
    readonly enterEdit: (selector: FigEditorOperationSurfaceNodeSelector) => void;
    readonly exitEdit: () => void;
    readonly readCharacters: (selector: FigEditorOperationSurfaceNodeSelector) => string;
    readonly setCharacters: (selector: FigEditorOperationSurfaceNodeSelector, characters: string) => void;
  };
  readonly vectorPath: {
    readonly setData: (selector: FigEditorOperationSurfaceNodeSelector, pathIndex: number, data: string) => void;
    readonly setCommands: (
      selector: FigEditorOperationSurfaceNodeSelector,
      pathIndex: number,
      commands: readonly EditablePathCommand[],
    ) => void;
    readonly applyOperation: (
      selector: FigEditorOperationSurfaceNodeSelector,
      pathIndex: number,
      operation: EditableVectorPathOperation,
    ) => void;
  };
  readonly component: {
    readonly properties: (selector: FigEditorOperationSurfaceNodeSelector) => readonly FigEditorOperationSurfaceComponentPropertySnapshot[];
    readonly setPropertyAssignment: (
      selector: FigEditorOperationSurfaceNodeSelector,
      defGuid: FigEditorOperationSurfaceGuidInput,
      value: FigComponentPropValue,
    ) => void;
  };
  readonly image: {
    readonly setNodePaintAsset: (
      selector: FigEditorOperationSurfaceNodeSelector,
      input: FigEditorOperationSurfaceNodePaintAssetInput,
    ) => FigEditorOperationSurfaceImageAssetSnapshot;
  };
  readonly renderer: {
    readonly webGLSurfaces: () => readonly FigEditorWebGLSurfaceSnapshot[];
    readonly requireWebGLSurface: (surfaceKey: string) => FigEditorWebGLSurfaceSnapshot;
  };
  readonly history: {
    readonly undo: () => void;
    readonly redo: () => void;
  };
};

export type FigEditorOperationSurfaceGlobalThis = typeof globalThis & {
  [FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY]?: FigEditorOperationSurface;
};

export type CreateFigEditorOperationSurfaceOptions = {
  readonly readEditor: () => FigEditorContextValue;
  readonly mutationSource: FigNodeMutationSource;
};
