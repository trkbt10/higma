/** @file Store-owned Fig editor operation surface published on globalThis tests. */
// @vitest-environment jsdom

import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import { PAINT_TYPE_VALUES, SCALE_MODE_VALUES } from "@higma-document-models/fig/constants";
import type { FigComponentPropValue, FigNode } from "@higma-document-models/fig/types";
import { figImageHashHexToBytes, guidToString } from "@higma-document-models/fig/domain";
import {
  createFigEditorStore,
  FigEditorStoreProvider,
  useFigEditor,
} from "../context/FigEditorContext";
import {
  sectionDocument,
  sectionGuid,
  sectionNode,
  sectionPage,
  sectionTextData,
} from "../panels/sections/section-specimen";
import type {
  FigEditorOperationSurface,
  FigEditorOperationSurfaceCanvasHitSnapshot,
  FigEditorOperationSurfaceNodeSnapshot,
} from "./fig-editor-operation-surface-types";
import {
  FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY,
  type FigEditorOperationSurfaceGlobalThis,
} from "./fig-editor-operation-surface-types";
import {
  publishFigEditorOperationSurfaceOnGlobalThis,
  readFigEditorOperationSurfaceFromGlobalThis,
  requireFigEditorOperationSurfaceFromGlobalThis,
} from "./fig-editor-global-this-operation-surface";

const mountedRoots: Root[] = [];
const mountedOperationSurfaceCleanups: (() => void)[] = [];
const PAGE_GUID = sectionGuid(1);
const RECTANGLE_GUID = sectionGuid(2);
const TEXT_GUID = sectionGuid(3);
const VECTOR_GUID = sectionGuid(4);
const SYMBOL_GUID = sectionGuid(5);
const INSTANCE_GUID = sectionGuid(6);
const COMPONENT_TEXT_DEF_GUID = sectionGuid(7);

function globalThisOperationSurfaceImagePaint(hashHex: string) {
  return {
    type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
    imageScaleMode: { value: SCALE_MODE_VALUES.FILL, name: "FILL" },
    image: { hash: figImageHashHexToBytes(hashHex) },
    opacity: 1,
    visible: true,
  };
}

function automationNodes(): readonly FigNode[] {
  const rectangle = sectionNode("RECTANGLE", {
    guid: RECTANGLE_GUID,
    parentIndex: { guid: PAGE_GUID, position: "a" },
    name: "Card",
    fillPaints: [globalThisOperationSurfaceImagePaint("01020304")],
  });
  const text = sectionNode("TEXT", {
    guid: TEXT_GUID,
    parentIndex: { guid: PAGE_GUID, position: "b" },
    name: "Label",
    textData: sectionTextData("Before"),
  });
  const vector = sectionNode("VECTOR", {
    guid: VECTOR_GUID,
    parentIndex: { guid: PAGE_GUID, position: "c" },
    name: "Path",
    vectorPaths: [{ windingRule: "NONZERO", data: "M 0 0 L 10 0 L 10 10 Z" }],
  });
  const symbol = sectionNode("SYMBOL", {
    guid: SYMBOL_GUID,
    name: "Button Symbol",
    componentPropDefs: [{
      id: COMPONENT_TEXT_DEF_GUID,
      name: "Label",
      type: { value: 1, name: "TEXT" },
      initialValue: { textValue: { characters: "Default" } },
    }],
  });
  const instance = sectionNode("INSTANCE", {
    guid: INSTANCE_GUID,
    parentIndex: { guid: PAGE_GUID, position: "d" },
    name: "Button Instance",
    symbolData: { symbolID: SYMBOL_GUID },
  });
  return [sectionDocument(), sectionPage(), rectangle, text, vector, symbol, instance];
}

function automationRenderedNodeBounds() {
  return [
    {
      id: guidToString(RECTANGLE_GUID),
      rootId: guidToString(RECTANGLE_GUID),
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      aabb: { x: 0, y: 0, width: 100, height: 50 },
    },
    {
      id: guidToString(TEXT_GUID),
      rootId: guidToString(TEXT_GUID),
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      aabb: { x: 0, y: 0, width: 100, height: 50 },
    },
    {
      id: guidToString(VECTOR_GUID),
      rootId: guidToString(VECTOR_GUID),
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      aabb: { x: 0, y: 0, width: 100, height: 50 },
    },
    {
      id: guidToString(INSTANCE_GUID),
      rootId: guidToString(INSTANCE_GUID),
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      aabb: { x: 0, y: 0, width: 100, height: 50 },
    },
  ];
}

function automationVisibleNodeBounds() {
  return automationRenderedNodeBounds().filter((bounds) => bounds.id !== guidToString(VECTOR_GUID));
}

function CanvasViewportPublisher(): null {
  const { setCanvasViewport } = useFigEditor();
  useEffect(() => {
    setCanvasViewport({
      viewport: { translateX: 10, translateY: 20, scale: 2 },
      viewportSize: { width: 300, height: 200 },
      rulerThickness: 16,
      visibleNodeBounds: automationVisibleNodeBounds(),
      renderedNodeBounds: automationRenderedNodeBounds(),
    });
    return () => {
      setCanvasViewport(undefined);
    };
  }, [setCanvasViewport]);
  return null;
}

function mountProvider(children: ReactNode = null): void {
  const context = createFigDocumentContextFromNodeChanges({
    nodeChanges: automationNodes(),
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createFigEditorStore({ context });
  const unpublish = publishFigEditorOperationSurfaceOnGlobalThis(store.operationSurface);
  mountedOperationSurfaceCleanups.push(() => {
    unpublish();
    store.dispose();
  });
  mountedRoots.push(root);
  act(() => {
    root.render(createElement(FigEditorStoreProvider, { store, children }));
  });
}

function requireOperationSurface(): FigEditorOperationSurface {
  return requireFigEditorOperationSurfaceFromGlobalThis();
}

function cleanupMountedOperationSurfaces(): void {
  mountedOperationSurfaceCleanups.forEach((cleanup) => cleanup());
  mountedOperationSurfaceCleanups.splice(0, mountedOperationSurfaceCleanups.length);
}

function requireOperationSurfaceNodeSnapshot(
  snapshot: FigEditorOperationSurfaceNodeSnapshot | undefined,
  owner: string,
): FigEditorOperationSurfaceNodeSnapshot {
  if (snapshot === undefined) {
    throw new Error(`${owner} did not receive a FigEditorOperationSurfaceNodeSnapshot`);
  }
  return snapshot;
}

describe("FigEditor operation surface globalThis publication", () => {
  afterEach(() => {
    act(() => {
      mountedRoots.forEach((root) => root.unmount());
    });
    cleanupMountedOperationSurfaces();
    mountedRoots.splice(0, mountedRoots.length);
    (globalThis as FigEditorOperationSurfaceGlobalThis)[FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY] = undefined;
  });

  it("publishes Kiwi document selectors and selection operations on globalThis", () => {
    mountProvider();
    const api = requireOperationSurface();

    act(() => {
      api.selection.select(guidToString(RECTANGLE_GUID));
    });

    expect(api.document.selectedNodes().map((node) => node.guidKey)).toEqual([guidToString(RECTANGLE_GUID)]);
    expect(api.document.requireNode({ name: "Card", type: "RECTANGLE" }).guidKey).toBe(guidToString(RECTANGLE_GUID));
  });

  it("clears the published operation surface when the globalThis publication is disposed", () => {
    mountProvider();
    expect(readFigEditorOperationSurfaceFromGlobalThis()).not.toBeUndefined();

    act(() => {
      mountedRoots.forEach((root) => root.unmount());
    });
    cleanupMountedOperationSurfaces();
    mountedRoots.splice(0, mountedRoots.length);

    expect(readFigEditorOperationSurfaceFromGlobalThis()).toBeUndefined();
  });

  it("throws when another Fig editor operation surface is already published", () => {
    mountProvider();
    const store = createFigEditorStore({
      context: createFigDocumentContextFromNodeChanges({
        nodeChanges: automationNodes(),
        blobs: [],
        images: new Map(),
        metadata: null,
      }),
    });
    try {
      expect(() => publishFigEditorOperationSurfaceOnGlobalThis(store.operationSurface)).toThrow(
        "globalThis.higmaFigEditor is already published",
      );
    } finally {
      store.dispose();
    }
  });

  it("edits node order, text, vector paths, and component assignments through Kiwi GUIDs", () => {
    mountProvider();
    const api = requireOperationSurface();
    const componentValue: FigComponentPropValue = { textValue: { characters: "Assigned" } };
    expect(api.component.properties(guidToString(INSTANCE_GUID))).toEqual([{
      defGuidKey: guidToString(COMPONENT_TEXT_DEF_GUID),
      name: "Label",
      type: "TEXT",
      value: { textValue: { characters: "Default" } },
      isOverridden: false,
      symbolGuidKey: guidToString(SYMBOL_GUID),
      symbolName: "Button Symbol",
    }]);

    act(() => {
      api.node.moveWithinParent(guidToString(RECTANGLE_GUID), 3);
      const rectangle = api.document.requireNode(guidToString(RECTANGLE_GUID)).node;
      api.node.replaceKiwiNode(guidToString(RECTANGLE_GUID), { ...rectangle, opacity: 0.42 });
      api.text.setCharacters(guidToString(TEXT_GUID), "After");
      api.vectorPath.setData(guidToString(VECTOR_GUID), 0, "M 0 0 L 12 0 L 12 12 Z");
      api.component.setPropertyAssignment(guidToString(INSTANCE_GUID), COMPONENT_TEXT_DEF_GUID, componentValue);
    });

    const pageChildren = api.document.children(guidToString(PAGE_GUID));
    expect(pageChildren.map((node) => node.guidKey)).toEqual([
      guidToString(TEXT_GUID),
      guidToString(VECTOR_GUID),
      guidToString(INSTANCE_GUID),
      guidToString(RECTANGLE_GUID),
    ]);
    expect(api.document.requireNode(guidToString(RECTANGLE_GUID)).node.opacity).toBe(0.42);
    expect(api.text.readCharacters(guidToString(TEXT_GUID))).toBe("After");
    expect(api.document.requireNode(guidToString(VECTOR_GUID)).node.vectorPaths?.[0]?.data).toBe("M 0 0 L 12 0 L 12 12 Z");
    expect(api.document.requireNode(guidToString(INSTANCE_GUID)).node.componentPropAssignments).toEqual([
      { defID: COMPONENT_TEXT_DEF_GUID, value: componentValue },
    ]);
    expect(api.component.properties(guidToString(INSTANCE_GUID))).toEqual([{
      defGuidKey: guidToString(COMPONENT_TEXT_DEF_GUID),
      name: "Label",
      type: "TEXT",
      value: componentValue,
      isOverridden: true,
      symbolGuidKey: guidToString(SYMBOL_GUID),
      symbolName: "Button Symbol",
    }]);
  });

  it("sets a Kiwi image asset on one node paint without depending on selection", () => {
    mountProvider();
    const api = requireOperationSurface();

    const image = api.image.setNodePaintAsset(guidToString(RECTANGLE_GUID), {
      paintListKind: "fill",
      paintIndex: 0,
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
      fileName: "global-this-operation-surface-image.png",
    });

    expect(api.document.selectedNodes()).toEqual([]);
    expect(api.document.snapshot().kiwiDocumentMutation).toMatchObject({
      scope: "resource-set",
      changedGuidKeys: [guidToString(RECTANGLE_GUID)],
    });
    expect(api.document.requireNode(guidToString(RECTANGLE_GUID)).node.fillPaints?.[0]).toMatchObject({
      image: { hash: figImageHashHexToBytes(image.ref) },
    });
  });

  it("manages CANVAS pages through the operation surface", () => {
    mountProvider();
    const api = requireOperationSurface();
    const addedPages: {
      second: FigEditorOperationSurfaceNodeSnapshot | undefined;
      third: FigEditorOperationSurfaceNodeSnapshot | undefined;
    } = { second: undefined, third: undefined };

    act(() => {
      addedPages.second = api.page.add("Second Page");
      addedPages.third = api.page.add("Third Page");
    });

    const secondPage = requireOperationSurfaceNodeSnapshot(addedPages.second, "second page");
    const thirdPage = requireOperationSurfaceNodeSnapshot(addedPages.third, "third page");

    act(() => {
      api.page.rename(secondPage.guidKey, "Renamed Second Page");
      api.page.move(thirdPage.guidKey, 0);
      api.page.setActive(secondPage.guidKey);
    });

    expect(api.document.pages().map((page) => page.guidKey)).toEqual([
      thirdPage.guidKey,
      guidToString(PAGE_GUID),
      secondPage.guidKey,
    ]);
    expect(api.document.activePage().guidKey).toBe(secondPage.guidKey);
    expect(api.document.requireNode(secondPage.guidKey).name).toBe("Renamed Second Page");

    act(() => {
      api.page.delete(thirdPage.guidKey);
    });

    expect(api.document.pages().map((page) => page.guidKey)).toEqual([
      guidToString(PAGE_GUID),
      secondPage.guidKey,
    ]);
  });

  it("creates and edits Kiwi nodes through the operation surface", () => {
    mountProvider();
    const api = requireOperationSurface();
    const createdNodes: {
      rectangle: FigEditorOperationSurfaceNodeSnapshot | undefined;
    } = { rectangle: undefined };

    act(() => {
      createdNodes.rectangle = api.node.createOnActivePage({
        type: "RECTANGLE",
        name: "Created Rect",
        x: 12,
        y: 16,
        width: 24,
        height: 18,
      });
    });
    const createdRectangle = requireOperationSurfaceNodeSnapshot(createdNodes.rectangle, "created rectangle");

    act(() => {
      api.node.rename(createdRectangle.guidKey, "Renamed Rect");
      api.node.setPosition(createdRectangle.guidKey, { x: 20, y: 30 });
      api.node.resize(createdRectangle.guidKey, { width: 40, height: 22 });
      api.node.setVisible(createdRectangle.guidKey, false);
      api.node.convertToSymbol(createdRectangle.guidKey);
    });

    const symbol = api.document.requireNode(createdRectangle.guidKey);
    expect(symbol.name).toBe("Renamed Rect");
    expect(symbol.type).toBe("SYMBOL");
    expect(symbol.node.visible).toBe(false);
    expect(symbol.node.transform?.m02).toBe(20);
    expect(symbol.node.transform?.m12).toBe(30);
    expect(symbol.node.size).toEqual({ x: 40, y: 22 });
  });

  it("converts selected Kiwi nodes to a boolean operation and keeps history reachable", () => {
    mountProvider();
    const api = requireOperationSurface();
    const createdNodes: {
      first: FigEditorOperationSurfaceNodeSnapshot | undefined;
      second: FigEditorOperationSurfaceNodeSnapshot | undefined;
    } = { first: undefined, second: undefined };
    const convertedNodes: {
      booleanGuidKey: string | undefined;
    } = { booleanGuidKey: undefined };

    act(() => {
      createdNodes.first = api.node.createOnActivePage({
        type: "RECTANGLE",
        name: "Boolean First",
        x: 10,
        y: 10,
        width: 30,
        height: 20,
      });
      createdNodes.second = api.node.createOnActivePage({
        type: "ELLIPSE",
        name: "Boolean Second",
        x: 20,
        y: 18,
        width: 22,
        height: 16,
      });
    });
    const first = requireOperationSurfaceNodeSnapshot(createdNodes.first, "first boolean source");
    const second = requireOperationSurfaceNodeSnapshot(createdNodes.second, "second boolean source");

    act(() => {
      api.selection.set([first.guidKey, second.guidKey]);
      api.node.convertSelectionToBoolean("UNION");
      convertedNodes.booleanGuidKey = api.document.selectedNodes()[0]?.guidKey;
    });

    const booleanGuidKey = convertedNodes.booleanGuidKey;
    if (booleanGuidKey === undefined) {
      throw new Error("convertSelectionToBoolean did not select the created boolean operation");
    }
    expect(api.document.requireNode(booleanGuidKey).type).toBe("BOOLEAN_OPERATION");

    act(() => {
      api.history.undo();
    });

    expect(api.document.requireNode(first.guidKey).type).toBe("RECTANGLE");
    expect(api.document.requireNode(second.guidKey).type).toBe("ELLIPSE");

    act(() => {
      api.history.redo();
    });

    expect(api.document.requireNode(booleanGuidKey).type).toBe("BOOLEAN_OPERATION");
  });

  it("reports symbol resolution through the editor SymbolResolver", () => {
    mountProvider();
    const api = requireOperationSurface();

    expect(api.document.symbolResolution(guidToString(INSTANCE_GUID))).toEqual({
      instanceGuidKey: guidToString(INSTANCE_GUID),
      effectiveSymbolGuidKey: guidToString(SYMBOL_GUID),
      effectiveSymbolName: "Button Symbol",
      resolvedDescendantNames: ["Button Instance"],
      dependencyGuidKeys: [guidToString(SYMBOL_GUID)],
    });
  });

  it("projects renderer-derived node bounds through the published editor canvas viewport", () => {
    mountProvider(createElement(CanvasViewportPublisher));
    const api = requireOperationSurface();

    expect(api.canvas.viewport()).toEqual({
      viewport: { translateX: 10, translateY: 20, scale: 2 },
      viewportSize: { width: 300, height: 200 },
      rulerThickness: 16,
      visibleNodeBounds: automationVisibleNodeBounds(),
      renderedNodeBounds: automationRenderedNodeBounds(),
    });
    expect(api.canvas.nodeBounds(guidToString(RECTANGLE_GUID))).toMatchObject({
      guidKey: guidToString(RECTANGLE_GUID),
      rootGuidKey: guidToString(RECTANGLE_GUID),
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
    });
    expect(api.canvas.nodeBounds(guidToString(VECTOR_GUID)).guidKey).toBe(guidToString(VECTOR_GUID));
    expect(api.canvas.nodeViewportPoint(guidToString(RECTANGLE_GUID), { x: 0.5, y: 0.5 })).toEqual({
      guidKey: guidToString(RECTANGLE_GUID),
      pageX: 50,
      pageY: 25,
      viewportX: 110,
      viewportY: 70,
    });
    expect(api.canvas.visibleNodeBounds().map((bounds) => bounds.guidKey)).toContain(guidToString(RECTANGLE_GUID));
    expect(api.canvas.visibleNodeBounds().map((bounds) => bounds.guidKey)).not.toContain(guidToString(VECTOR_GUID));
    expect(api.canvas.visibleNodeBounds({ type: "TEXT" })).toHaveLength(1);
    expect(api.canvas.visibleNodeBounds({ type: "TEXT" })[0]?.guidKey).toBe(guidToString(TEXT_GUID));
    expect(api.canvas.hitTestViewportPoint({ viewportX: 110, viewportY: 70 })?.node.guidKey)
      .toBe(guidToString(INSTANCE_GUID));
    expect(api.canvas.requireHitTestViewportPoint({ viewportX: 110, viewportY: 70 }).bounds.guidKey)
      .toBe(guidToString(INSTANCE_GUID));
    expect(api.canvas.hitTestViewportPoint({ viewportX: -1000, viewportY: -1000 })).toBeUndefined();
  });

  it("drives creation mode and selected FigNode drag transform through the operation surface", () => {
    mountProvider();
    const api = requireOperationSurface();

    act(() => {
      api.selection.select(guidToString(RECTANGLE_GUID));
    });
    act(() => {
      api.creationMode.set("pen");
    });

    expect(api.creationMode.get()).toBe("pen");

    act(() => {
      api.canvasInteraction.beginSelectedFigNodeDragTransform();
    });
    act(() => {
      api.canvasInteraction.translateFigNodeDuringSelectedFigNodeDragTransform(
        guidToString(RECTANGLE_GUID),
        { dx: 9, dy: 5 },
      );
    });
    act(() => {
      api.canvasInteraction.endSelectedFigNodeDragTransform();
    });

    const rectangle = api.document.requireNode(guidToString(RECTANGLE_GUID)).node;
    expect(rectangle.transform?.m02).toBe(9);
    expect(rectangle.transform?.m12).toBe(5);
  });

  it("selects and moves Kiwi nodes through viewport canvas coordinates", () => {
    mountProvider(createElement(CanvasViewportPublisher));
    const api = requireOperationSurface();
    const selected: { hit?: FigEditorOperationSurfaceCanvasHitSnapshot } = {};

    act(() => {
      selected.hit = api.canvas.requireSelectNodeAtViewportPoint({ viewportX: 110, viewportY: 70 });
    });

    expect(selected.hit?.node.guidKey).toBe(guidToString(INSTANCE_GUID));
    expect(api.document.selectedNodes().map((node) => node.guidKey)).toEqual([guidToString(INSTANCE_GUID)]);

    act(() => {
      api.selection.select(guidToString(RECTANGLE_GUID));
      api.canvasInteraction.beginSelectedFigNodeDragTransform();
      api.canvasInteraction.translateFigNodeDuringSelectedFigNodeDragTransformByViewportDelta(
        guidToString(RECTANGLE_GUID),
        { viewportDx: 20, viewportDy: 10 },
      );
      api.canvasInteraction.endSelectedFigNodeDragTransform();
    });

    const rectangle = api.document.requireNode(guidToString(RECTANGLE_GUID)).node;
    expect(rectangle.transform?.m02).toBe(10);
    expect(rectangle.transform?.m12).toBe(5);
  });

  it("rejects replacing a Kiwi node with a different GUID", () => {
    mountProvider();
    const api = requireOperationSurface();
    const rectangle = api.document.requireNode(guidToString(RECTANGLE_GUID)).node;

    expect(() => {
      act(() => {
        api.node.replaceKiwiNode(guidToString(RECTANGLE_GUID), { ...rectangle, guid: TEXT_GUID });
      });
    }).toThrow("replaceFigEditorOperationSurfaceKiwiNode must not change Kiwi node guid");
  });
});
