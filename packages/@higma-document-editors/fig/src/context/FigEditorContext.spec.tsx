/**
 * @file FigEditorStoreProvider history tests for Kiwi document mutations.
 */
// @vitest-environment jsdom

import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import type { FigGuid } from "@higma-document-models/fig/types";
import { guidToString } from "@higma-document-models/fig/domain";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import {
  FIG_NODE_MUTATION_SOURCE,
  createFigEditorStore,
  FigEditorStoreProvider,
  useFigEditor,
  useFigEditorCanvasViewport,
  useFigEditorSelector,
  useFigEditorSelectedFigNodeDragTransform,
  type FigEditorCanvasViewportSnapshot,
  type FigEditorContextValue,
  type FigEditorSelectedFigNodeDragTransform,
} from "./FigEditorContext";
import {
  sectionDocument,
  sectionGuid,
  sectionNode,
  sectionPage,
} from "../panels/sections/section-specimen";

type FigEditorContextCapture = {
  current: FigEditorContextValue | null;
  currentSelectedFigNodeDragTransform: FigEditorSelectedFigNodeDragTransform | null;
  currentCanvasViewport?: FigEditorCanvasViewportSnapshot | undefined;
  editorSnapshotRenderCount?: number;
  canvasViewportRenderCount?: number;
  canUndoSelectionRenderCount?: number;
  currentCanUndoSelection?: boolean;
};

const mountedRoots: Root[] = [];
const mountedStores: ReturnType<typeof createFigEditorStore>[] = [];
const PAGE_GUID = sectionGuid(1);
const RECTANGLE_GUID = sectionGuid(2);
const ELLIPSE_GUID = sectionGuid(3);

function rectangleHorizontalTranslation(editor: FigEditorContextValue, guid: FigGuid): number {
  const node = editor.context.document.nodesByGuid.get(guidToString(guid));
  if (node === undefined) {
    throw new Error(`rectangleHorizontalTranslation requires node ${guidToString(guid)}`);
  }
  if (node.transform === undefined) {
    throw new Error(`rectangleHorizontalTranslation requires transform for node ${guidToString(guid)}`);
  }
  return readKiwiTransform(node.transform).m02;
}

function capturedEditor(capture: FigEditorContextCapture): FigEditorContextValue {
  if (capture.current === null) {
    throw new Error("FigEditorContextCapture did not receive FigEditorContextValue");
  }
  return capture.current;
}

function FigEditorContextCaptureView({ capture }: { readonly capture: FigEditorContextCapture }) {
  capture.editorSnapshotRenderCount = (capture.editorSnapshotRenderCount ?? 0) + 1;
  capture.current = useFigEditor();
  capture.currentSelectedFigNodeDragTransform = useFigEditorSelectedFigNodeDragTransform();
  return null;
}

function FigEditorCanvasViewportCaptureView({ capture }: { readonly capture: FigEditorContextCapture }) {
  capture.canvasViewportRenderCount = (capture.canvasViewportRenderCount ?? 0) + 1;
  capture.currentCanvasViewport = useFigEditorCanvasViewport();
  return null;
}

function selectCanUndo(editor: FigEditorContextValue): boolean {
  return editor.canUndo;
}

function FigEditorCanUndoSelectionCaptureView({ capture }: { readonly capture: FigEditorContextCapture }) {
  capture.canUndoSelectionRenderCount = (capture.canUndoSelectionRenderCount ?? 0) + 1;
  capture.currentCanUndoSelection = useFigEditorSelector(selectCanUndo);
  return null;
}

function mountFigEditorStoreProvider(capture: FigEditorContextCapture): void {
  const rectangle = sectionNode("RECTANGLE", {
    guid: RECTANGLE_GUID,
    parentIndex: { guid: PAGE_GUID, position: "a" },
    width: 100,
    height: 50,
  });
  const ellipse = sectionNode("ELLIPSE", {
    guid: ELLIPSE_GUID,
    parentIndex: { guid: PAGE_GUID, position: "b" },
    width: 100,
    height: 50,
  });
  const context = createFigDocumentContextFromNodeChanges({
    nodeChanges: [sectionDocument(), sectionPage(), rectangle, ellipse],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createFigEditorStore({ context });
  mountedRoots.push(root);
  mountedStores.push(store);
  act(() => {
    root.render(createElement(FigEditorStoreProvider, {
      store,
      children: createElement(Fragment, null,
        createElement(FigEditorContextCaptureView, { capture }),
        createElement(FigEditorCanvasViewportCaptureView, { capture }),
        createElement(FigEditorCanUndoSelectionCaptureView, { capture }),
      ),
    }));
  });
}

describe("FigEditorStoreProvider selected FigNode drag transform history", () => {
  afterEach(() => {
    act(() => {
      mountedRoots.forEach((root) => root.unmount());
    });
    mountedStores.forEach((store) => store.dispose());
    mountedRoots.splice(0, mountedRoots.length);
    mountedStores.splice(0, mountedStores.length);
  });

  it("publishes canvas viewport changes without notifying full editor snapshot subscribers", () => {
    const capture: FigEditorContextCapture = { current: null, currentSelectedFigNodeDragTransform: null };
    mountFigEditorStoreProvider(capture);
    const bounds: FigEditorCanvasViewportSnapshot["renderedNodeBounds"] = [];
    const snapshot: FigEditorCanvasViewportSnapshot = {
      viewport: { translateX: 10, translateY: 20, scale: 2 },
      viewportSize: { width: 300, height: 200 },
      rulerThickness: 16,
      visibleNodeBounds: bounds,
      renderedNodeBounds: bounds,
    };

    expect(capture.editorSnapshotRenderCount).toBe(1);
    expect(capture.canvasViewportRenderCount).toBe(1);
    expect(capture.canUndoSelectionRenderCount).toBe(1);

    act(() => {
      capturedEditor(capture).setCanvasViewport(snapshot);
    });

    expect(capture.editorSnapshotRenderCount).toBe(1);
    expect(capture.canvasViewportRenderCount).toBe(2);
    expect(capture.canUndoSelectionRenderCount).toBe(1);
    expect(capture.currentCanvasViewport).toBe(snapshot);

    act(() => {
      capturedEditor(capture).setCanvasViewport({
        viewport: { translateX: 10, translateY: 20, scale: 2 },
        viewportSize: { width: 300, height: 200 },
        rulerThickness: 16,
        visibleNodeBounds: bounds,
        renderedNodeBounds: bounds,
      });
    });

    expect(capture.editorSnapshotRenderCount).toBe(1);
    expect(capture.canvasViewportRenderCount).toBe(2);
    expect(capture.canUndoSelectionRenderCount).toBe(1);
  });

  it("does not render selector subscribers when the selected value is unchanged", () => {
    const capture: FigEditorContextCapture = { current: null, currentSelectedFigNodeDragTransform: null };
    mountFigEditorStoreProvider(capture);

    expect(capture.currentCanUndoSelection).toBe(false);
    expect(capture.canUndoSelectionRenderCount).toBe(1);

    act(() => {
      capturedEditor(capture).selectNodeGuid(RECTANGLE_GUID);
    });
    act(() => {
      capturedEditor(capture).beginSelectedFigNodeDragTransform();
    });

    expect(capture.currentCanUndoSelection).toBe(false);
    expect(capture.canUndoSelectionRenderCount).toBe(1);

    act(() => {
      capturedEditor(capture).endSelectedFigNodeDragTransform();
    });

    expect(capture.currentCanUndoSelection).toBe(false);
    expect(capture.canUndoSelectionRenderCount).toBe(1);
  });

  it("records one undo history entry for multiple selected FigNode drag document updates", () => {
    const capture: FigEditorContextCapture = { current: null, currentSelectedFigNodeDragTransform: null };
    mountFigEditorStoreProvider(capture);

    act(() => {
      capturedEditor(capture).selectNodeGuid(RECTANGLE_GUID);
    });
    act(() => {
      capturedEditor(capture).beginSelectedFigNodeDragTransform();
    });
    act(() => {
      capturedEditor(capture).updateNode(RECTANGLE_GUID, (node) => ({
        ...node,
        transform: { ...readKiwiTransform(node.transform), m02: 10 },
      }), FIG_NODE_MUTATION_SOURCE.editorCanvasSelectedFigNodeDrag);
    });
    act(() => {
      capturedEditor(capture).updateNode(RECTANGLE_GUID, (node) => ({
        ...node,
        transform: { ...readKiwiTransform(node.transform), m02: 30 },
      }), FIG_NODE_MUTATION_SOURCE.editorCanvasSelectedFigNodeDrag);
    });
    act(() => {
      capturedEditor(capture).endSelectedFigNodeDragTransform();
    });

    expect(rectangleHorizontalTranslation(capturedEditor(capture), RECTANGLE_GUID)).toBe(30);
    expect(capturedEditor(capture).canUndo).toBe(true);

    act(() => {
      capturedEditor(capture).undo();
    });

    expect(rectangleHorizontalTranslation(capturedEditor(capture), RECTANGLE_GUID)).toBe(0);
    expect(capturedEditor(capture).canUndo).toBe(false);
  });

  it("publishes selected FigNode drag transform draft without mutating the Kiwi document until drag end", () => {
    const capture: FigEditorContextCapture = { current: null, currentSelectedFigNodeDragTransform: null };
    mountFigEditorStoreProvider(capture);

    act(() => {
      capturedEditor(capture).selectNodeGuid(RECTANGLE_GUID);
    });
    act(() => {
      capturedEditor(capture).beginSelectedFigNodeDragTransform();
    });
    act(() => {
      capturedEditor(capture).translateSelectedFigNodeDragTransform(RECTANGLE_GUID, 8, 3);
    });
    act(() => {
      capturedEditor(capture).translateSelectedFigNodeDragTransform(RECTANGLE_GUID, 4, 2);
    });

    expect(rectangleHorizontalTranslation(capturedEditor(capture), RECTANGLE_GUID)).toBe(0);
    expect(capture.currentSelectedFigNodeDragTransform).toMatchObject({
      guid: RECTANGLE_GUID,
      dx: 12,
      dy: 5,
      revision: 2,
    });
    expect(capturedEditor(capture).canUndo).toBe(false);

    act(() => {
      capturedEditor(capture).endSelectedFigNodeDragTransform();
    });

    expect(rectangleHorizontalTranslation(capturedEditor(capture), RECTANGLE_GUID)).toBe(12);
    expect(capture.currentSelectedFigNodeDragTransform).toBeNull();
    expect(capturedEditor(capture).canUndo).toBe(true);

    act(() => {
      capturedEditor(capture).undo();
    });

    expect(rectangleHorizontalTranslation(capturedEditor(capture), RECTANGLE_GUID)).toBe(0);
  });

  it("does not record undo history for a selected FigNode drag transform without a Kiwi document update", () => {
    const capture: FigEditorContextCapture = { current: null, currentSelectedFigNodeDragTransform: null };
    mountFigEditorStoreProvider(capture);

    act(() => {
      capturedEditor(capture).selectNodeGuid(RECTANGLE_GUID);
    });
    act(() => {
      capturedEditor(capture).beginSelectedFigNodeDragTransform();
    });
    act(() => {
      capturedEditor(capture).endSelectedFigNodeDragTransform();
    });

    expect(capturedEditor(capture).canUndo).toBe(false);
  });

  it("rejects non-selected FigNode drag Kiwi document mutation while selected FigNode drag transform is active", () => {
    const capture: FigEditorContextCapture = { current: null, currentSelectedFigNodeDragTransform: null };
    mountFigEditorStoreProvider(capture);

    act(() => {
      capturedEditor(capture).selectNodeGuid(RECTANGLE_GUID);
    });
    act(() => {
      capturedEditor(capture).beginSelectedFigNodeDragTransform();
    });

    expect(() => {
      act(() => {
        capturedEditor(capture).addPage("Second Page", FIG_NODE_MUTATION_SOURCE.pagePanel);
      });
    }).toThrow("page-panel mutation cannot publish during active selected FigNode drag transform");
  });

  it("rejects selected FigNode drag transform updates for non-selected Kiwi nodes", () => {
    const capture: FigEditorContextCapture = { current: null, currentSelectedFigNodeDragTransform: null };
    mountFigEditorStoreProvider(capture);

    act(() => {
      capturedEditor(capture).selectNodeGuid(RECTANGLE_GUID);
    });
    act(() => {
      capturedEditor(capture).beginSelectedFigNodeDragTransform();
    });

    expect(() => {
      act(() => {
        capturedEditor(capture).translateSelectedFigNodeDragTransform(ELLIPSE_GUID, 1, 1);
      });
    }).toThrow("selected FigNode drag transform cannot translate non-selected Kiwi node");

    expect(() => {
      act(() => {
        capturedEditor(capture).updateNode(ELLIPSE_GUID, (node) => ({
          ...node,
          transform: { ...readKiwiTransform(node.transform), m02: 7 },
        }), FIG_NODE_MUTATION_SOURCE.editorCanvasSelectedFigNodeDrag);
      });
    }).toThrow("selected FigNode drag transform cannot mutate non-selected Kiwi node");
  });

  it("reorders a Kiwi node within its current parent", () => {
    const capture: FigEditorContextCapture = { current: null, currentSelectedFigNodeDragTransform: null };
    mountFigEditorStoreProvider(capture);

    act(() => {
      capturedEditor(capture).moveNodeWithinParent(
        RECTANGLE_GUID,
        1,
        FIG_NODE_MUTATION_SOURCE.layerPanel,
      );
    });

    const editor = capturedEditor(capture);
    const activePage = editor.activePage;
    if (activePage === undefined) {
      throw new Error("Expected active CANVAS after mounting FigEditorStoreProvider");
    }
    const childKeys = editor.context.document.childrenOf(activePage).map((node) => {
      if (node.guid === undefined) {
        throw new Error("Expected reordered child to carry a Kiwi guid");
      }
      return guidToString(node.guid);
    });
    expect(childKeys).toEqual([guidToString(ELLIPSE_GUID), guidToString(RECTANGLE_GUID)]);
    expect(editor.canUndo).toBe(true);
  });
});
