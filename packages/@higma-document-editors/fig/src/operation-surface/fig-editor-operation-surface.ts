/** @file Fig editor operation surface construction over the live editor context. */
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import type { FigEditorContextValue } from "../context/fig-editor-store";
import {
  readFigEditorResolvedComponentProperties,
  writeFigEditorComponentPropertyAssignment,
} from "../editor-commands/fig-editor-component-property-command";
import { commitFigEditorNodePaintImageAsset } from "../editor-commands/fig-editor-image-paint-command";
import { readKiwiTextCharacters, writeKiwiTextCharacters } from "../text-edit/kiwi-text-characters";
import { updateVectorPathCommands, updateVectorPathWithOperation } from "../vector-path/editor-model";
import {
  requireFigEditorWebGLSurfaceSnapshot,
  snapshotFigEditorWebGLSurfaces,
} from "../canvas/webgl/fig-editor-webgl-surface-registry";
import {
  FIG_EDITOR_OPERATION_SURFACE_VERSION,
  type CreateFigEditorOperationSurfaceOptions,
  type FigEditorOperationSurface,
  type FigEditorOperationSurfaceCanvasHitSnapshot,
  type FigEditorOperationSurfaceComponentPropertySnapshot,
} from "./fig-editor-operation-surface-types";
import {
  figEditorOperationSurfaceCanvasHitTestViewportPoint,
  figEditorOperationSurfaceCanvasNodeBounds,
  figEditorOperationSurfaceCanvasNodeViewportPoint,
  figEditorOperationSurfaceCanvasPageDeltaFromViewportDelta,
  figEditorOperationSurfaceCanvasRequireHitTestViewportPoint,
  figEditorOperationSurfaceCanvasRequireSelectNodeAtViewportPoint,
  figEditorOperationSurfaceCanvasSelectNodeAtViewportPoint,
  figEditorOperationSurfaceCanvasViewport,
  figEditorOperationSurfaceCanvasVisibleNodeBounds,
} from "./fig-editor-operation-surface-canvas-access";
import {
  parseFigEditorOperationSurfaceGuidKey,
  requireFigEditorOperationSurfaceFiniteNonNegativeNumber,
  requireFigEditorOperationSurfaceFiniteNumber,
  requireFigEditorOperationSurfaceGuid,
  resolveFigEditorOperationSurfaceGuidInput,
} from "./fig-editor-operation-surface-guid";
import {
  figEditorOperationSurfaceDocumentSnapshot,
  figEditorOperationSurfaceFindNodesByQuery,
  figEditorOperationSurfaceNodeByGuid,
  figEditorOperationSurfaceNodeSnapshot,
  figEditorOperationSurfaceRequireActivePage,
  figEditorOperationSurfaceRequireSingleNode,
  figEditorOperationSurfaceResolveSelectorGuid,
  figEditorOperationSurfaceSymbolResolutionSnapshot,
} from "./fig-editor-operation-surface-node-access";
import {
  convertFigEditorOperationSurfaceNodeToSymbol,
  replaceFigEditorOperationSurfaceKiwiNode,
  resizeFigEditorOperationSurfaceNode,
  setFigEditorOperationSurfaceNodePosition,
  setFigEditorOperationSurfaceVectorPathData,
  translateFigEditorOperationSurfaceNode,
} from "./fig-editor-operation-surface-node-mutation";

function snapshotCreatedNode(editor: () => FigEditorContextValue, guid: FigGuid, owner: string) {
  return figEditorOperationSurfaceNodeSnapshot(editor(), figEditorOperationSurfaceNodeByGuid(editor(), guid, owner));
}

function requireFigEditorOperationSurfaceCanvasHitSnapshot(
  hit: FigEditorOperationSurfaceCanvasHitSnapshot | undefined,
  owner: string,
): FigEditorOperationSurfaceCanvasHitSnapshot {
  if (hit === undefined) {
    throw new Error(`${owner} did not produce a canvas hit`);
  }
  return hit;
}

function resolveCreateNodeParentGuid(
  parentGuid: FigGuid | string | undefined,
): FigGuid | null {
  if (parentGuid === undefined) {
    return null;
  }
  return resolveFigEditorOperationSurfaceGuidInput(parentGuid, "node.createOnActivePage parentGuid");
}

function figEditorOperationSurfaceComponentPropertySnapshots(
  editor: FigEditorContextValue,
  selector: Parameters<FigEditorOperationSurface["component"]["properties"]>[0],
): readonly FigEditorOperationSurfaceComponentPropertySnapshot[] {
  const instance = figEditorOperationSurfaceRequireSingleNode(editor, selector, "component.properties");
  const resolved = readFigEditorResolvedComponentProperties(editor, instance);
  if (resolved === undefined) {
    const instanceGuid = requireFigEditorOperationSurfaceGuid(instance.guid, "component.properties instance");
    throw new Error(`component.properties: INSTANCE ${guidToString(instanceGuid)} does not resolve to a SYMBOL`);
  }
  const symbolGuidKey = guidToString(resolved.symbol.guid);
  return resolved.properties.map((property) => ({
    defGuidKey: guidToString(property.resolvedDef.id),
    name: property.resolvedDef.name,
    type: property.resolvedDef.type,
    value: structuredClone(property.value),
    isOverridden: property.isOverridden,
    symbolGuidKey,
    symbolName: resolved.symbol.node.name,
  }));
}

/** Create the stable Fig editor operation surface for ESM or globalThis consumers. */
export function createFigEditorOperationSurface({
  readEditor,
  mutationSource,
}: CreateFigEditorOperationSurfaceOptions): FigEditorOperationSurface {
  const editor = (): FigEditorContextValue => readEditor();
  return {
    version: FIG_EDITOR_OPERATION_SURFACE_VERSION,
    guid: {
      fromKey: parseFigEditorOperationSurfaceGuidKey,
      toKey: guidToString,
    },
    document: {
      snapshot: () => figEditorOperationSurfaceDocumentSnapshot(editor()),
      nodes: (query) => figEditorOperationSurfaceFindNodesByQuery(editor(), query).map((node) => figEditorOperationSurfaceNodeSnapshot(editor(), node)),
      requireNode: (selector) => figEditorOperationSurfaceNodeSnapshot(editor(), figEditorOperationSurfaceRequireSingleNode(editor(), selector, "requireNode")),
      children: (selector) => {
        const currentEditor = editor();
        return currentEditor.context.document.childrenOf(
          figEditorOperationSurfaceRequireSingleNode(currentEditor, selector, "children"),
        ).map((node) => figEditorOperationSurfaceNodeSnapshot(currentEditor, node));
      },
      descendants: (selector) => {
        const currentEditor = editor();
        const collect = (node: FigNode): readonly FigNode[] => (
          currentEditor.context.document.childrenOf(node).flatMap((child) => [child, ...collect(child)])
        );
        return collect(figEditorOperationSurfaceRequireSingleNode(currentEditor, selector, "descendants"))
          .map((node) => figEditorOperationSurfaceNodeSnapshot(currentEditor, node));
      },
      pages: () => editor().pages.map((page) => figEditorOperationSurfaceNodeSnapshot(editor(), page)),
      activePage: () => figEditorOperationSurfaceNodeSnapshot(editor(), figEditorOperationSurfaceRequireActivePage(editor())),
      selectedNodes: () => editor().selectedNodes.map((node) => figEditorOperationSurfaceNodeSnapshot(editor(), node)),
      symbolResolution: (selector) => figEditorOperationSurfaceSymbolResolutionSnapshot(editor(), selector),
    },
    selection: {
      set: (selectors) => {
        const currentEditor = editor();
        currentEditor.setSelectedGuids(selectors.map((selector) => figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "selection.set")));
      },
      select: (selector, options) => {
        const currentEditor = editor();
        currentEditor.selectNodeGuid(figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "selection.select"), options);
      },
      clear: () => editor().clearSelection(),
    },
    creationMode: {
      get: () => editor().creationMode,
      set: (mode) => editor().setCreationMode(mode),
    },
    canvasInteraction: {
      beginSelectedFigNodeDragTransform: () => editor().beginSelectedFigNodeDragTransform(),
      translateFigNodeDuringSelectedFigNodeDragTransform: (selector, delta) => {
        const dx = requireFigEditorOperationSurfaceFiniteNumber(delta.dx, "canvasInteraction.translateFigNodeDuringSelectedFigNodeDragTransform dx");
        const dy = requireFigEditorOperationSurfaceFiniteNumber(delta.dy, "canvasInteraction.translateFigNodeDuringSelectedFigNodeDragTransform dy");
        const currentEditor = editor();
        currentEditor.translateSelectedFigNodeDragTransform(
          figEditorOperationSurfaceResolveSelectorGuid(
            currentEditor,
            selector,
            "canvasInteraction.translateFigNodeDuringSelectedFigNodeDragTransform",
          ),
          dx,
          dy,
        );
      },
      translateFigNodeDuringSelectedFigNodeDragTransformByViewportDelta: (selector, delta) => {
        const currentEditor = editor();
        const pageDelta = figEditorOperationSurfaceCanvasPageDeltaFromViewportDelta(
          currentEditor,
          delta,
          "canvasInteraction.translateFigNodeDuringSelectedFigNodeDragTransformByViewportDelta",
        );
        currentEditor.translateSelectedFigNodeDragTransform(
          figEditorOperationSurfaceResolveSelectorGuid(
            currentEditor,
            selector,
            "canvasInteraction.translateFigNodeDuringSelectedFigNodeDragTransformByViewportDelta",
          ),
          pageDelta.dx,
          pageDelta.dy,
        );
      },
      endSelectedFigNodeDragTransform: () => editor().endSelectedFigNodeDragTransform(),
    },
    canvas: {
      viewport: () => figEditorOperationSurfaceCanvasViewport(editor()),
      visibleNodeBounds: (query) => figEditorOperationSurfaceCanvasVisibleNodeBounds(editor(), query),
      nodeBounds: (selector) => figEditorOperationSurfaceCanvasNodeBounds(editor(), selector),
      nodeViewportPoint: (selector, ratio) => figEditorOperationSurfaceCanvasNodeViewportPoint(editor(), selector, ratio),
      hitTestViewportPoint: (point) => figEditorOperationSurfaceCanvasHitTestViewportPoint(editor(), point),
      requireHitTestViewportPoint: (point) => figEditorOperationSurfaceCanvasRequireHitTestViewportPoint(editor(), point),
      selectNodeAtViewportPoint: (point, options) => {
        return figEditorOperationSurfaceCanvasSelectNodeAtViewportPoint(editor(), point, options);
      },
      requireSelectNodeAtViewportPoint: (point, options) => {
        return requireFigEditorOperationSurfaceCanvasHitSnapshot(
          figEditorOperationSurfaceCanvasRequireSelectNodeAtViewportPoint(editor(), point, options),
          "canvas.requireSelectNodeAtViewportPoint result",
        );
      },
    },
    page: {
      setActive: (selector) => {
        const currentEditor = editor();
        currentEditor.setActivePageGuid(figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "page.setActive"));
      },
      add: (name) => {
        const guid = editor().addPage(name, mutationSource);
        return snapshotCreatedNode(editor, requireFigEditorOperationSurfaceGuid(guid, "page.add result"), "page.add");
      },
      rename: (selector, name) => {
        const currentEditor = editor();
        currentEditor.renamePage(figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "page.rename"), name, mutationSource);
      },
      move: (selector, toIndex) => {
        const currentEditor = editor();
        currentEditor.movePage(figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "page.move"), toIndex, mutationSource);
      },
      delete: (selector) => {
        const currentEditor = editor();
        currentEditor.deletePage(figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "page.delete"), mutationSource);
      },
    },
    node: {
      createOnActivePage: (spec, parentGuid) => {
        const currentEditor = editor();
        const parent = resolveCreateNodeParentGuid(parentGuid);
        const guid = currentEditor.addNodeToActivePage(spec, parent, mutationSource);
        return snapshotCreatedNode(editor, requireFigEditorOperationSurfaceGuid(guid, "node.createOnActivePage result"), "node.createOnActivePage");
      },
      replaceKiwiNode: (selector, replacement) => {
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "node.replaceKiwiNode"),
          (node) => replaceFigEditorOperationSurfaceKiwiNode(node, replacement, currentEditor),
          mutationSource,
        );
      },
      rename: (selector, name) => {
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "node.rename"),
          (node) => ({ ...node, name }),
          mutationSource,
        );
      },
      setVisible: (selector, visible) => {
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "node.setVisible"),
          (node) => ({ ...node, visible }),
          mutationSource,
        );
      },
      setOpacity: (selector, opacity) => {
        requireFigEditorOperationSurfaceFiniteNumber(opacity, "node.setOpacity opacity");
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "node.setOpacity"),
          (node) => ({ ...node, opacity }),
          mutationSource,
        );
      },
      setPosition: (selector, position) => {
        const x = requireFigEditorOperationSurfaceFiniteNumber(position.x, "node.setPosition x");
        const y = requireFigEditorOperationSurfaceFiniteNumber(position.y, "node.setPosition y");
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "node.setPosition"),
          (node) => setFigEditorOperationSurfaceNodePosition(node, x, y),
          mutationSource,
        );
      },
      translate: (selector, delta) => {
        const dx = requireFigEditorOperationSurfaceFiniteNumber(delta.dx, "node.translate dx");
        const dy = requireFigEditorOperationSurfaceFiniteNumber(delta.dy, "node.translate dy");
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "node.translate"),
          (node) => translateFigEditorOperationSurfaceNode(node, dx, dy),
          mutationSource,
        );
      },
      resize: (selector, size) => {
        const width = requireFigEditorOperationSurfaceFiniteNonNegativeNumber(size.width, "node.resize width");
        const height = requireFigEditorOperationSurfaceFiniteNonNegativeNumber(size.height, "node.resize height");
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "node.resize"),
          (node) => resizeFigEditorOperationSurfaceNode(node, width, height),
          mutationSource,
        );
      },
      moveWithinParent: (selector, toIndex) => {
        const currentEditor = editor();
        currentEditor.moveNodeWithinParent(figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "node.moveWithinParent"), toIndex, mutationSource);
      },
      convertToSymbol: (selector) => {
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "node.convertToSymbol"),
          convertFigEditorOperationSurfaceNodeToSymbol,
          mutationSource,
        );
      },
      deleteSelected: () => editor().deleteSelectedNodes(mutationSource),
      convertSelectionToBoolean: (operation) => editor().createBooleanOperationFromSelection(operation, mutationSource),
    },
    text: {
      enterEdit: (selector) => {
        const currentEditor = editor();
        currentEditor.enterTextEdit(figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "text.enterEdit"));
      },
      exitEdit: () => editor().exitTextEdit(),
      readCharacters: (selector) => readKiwiTextCharacters(figEditorOperationSurfaceRequireSingleNode(editor(), selector, "text.readCharacters")),
      setCharacters: (selector, characters) => {
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "text.setCharacters"),
          (node) => writeKiwiTextCharacters(node, characters),
          mutationSource,
        );
      },
    },
    vectorPath: {
      setData: (selector, pathIndex, data) => {
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "vectorPath.setData"),
          (node) => setFigEditorOperationSurfaceVectorPathData(node, pathIndex, data),
          mutationSource,
        );
      },
      setCommands: (selector, pathIndex, commands) => {
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "vectorPath.setCommands"),
          (node) => updateVectorPathCommands({ node, pathIndex, commands }),
          mutationSource,
        );
      },
      applyOperation: (selector, pathIndex, operation) => {
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "vectorPath.applyOperation"),
          (node) => updateVectorPathWithOperation({ node, pathIndex, operation }),
          mutationSource,
        );
      },
    },
    component: {
      properties: (selector) => figEditorOperationSurfaceComponentPropertySnapshots(editor(), selector),
      setPropertyAssignment: (selector, defGuid, value) => {
        const currentEditor = editor();
        currentEditor.updateNode(
          figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "component.setPropertyAssignment"),
          (node) => writeFigEditorComponentPropertyAssignment(node, resolveFigEditorOperationSurfaceGuidInput(defGuid, "component.setPropertyAssignment defGuid"), value),
          mutationSource,
        );
      },
    },
    image: {
      setNodePaintAsset: (selector, input) => {
        const currentEditor = editor();
        return commitFigEditorNodePaintImageAsset({
          editor: currentEditor,
          guid: figEditorOperationSurfaceResolveSelectorGuid(currentEditor, selector, "image.setNodePaintAsset"),
          input,
          target: input,
          source: mutationSource,
        });
      },
    },
    renderer: {
      webGLSurfaces: snapshotFigEditorWebGLSurfaces,
      requireWebGLSurface: requireFigEditorWebGLSurfaceSnapshot,
    },
    history: {
      undo: () => editor().undo(),
      redo: () => editor().redo(),
    },
  };
}
