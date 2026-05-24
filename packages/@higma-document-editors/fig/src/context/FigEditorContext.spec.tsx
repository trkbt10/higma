/**
 * @file FigEditorProvider history tests for Kiwi document mutations.
 */
// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import type { FigGuid } from "@higma-document-models/fig/types";
import { guidToString } from "@higma-document-models/fig/domain";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import {
  FIG_NODE_MUTATION_SOURCE,
  FigEditorProvider,
  useFigEditor,
  type FigEditorContextValue,
} from "./FigEditorContext";
import {
  sectionDocument,
  sectionGuid,
  sectionNode,
  sectionPage,
} from "../panels/sections/section-specimen";

type FigEditorContextCapture = {
  current: FigEditorContextValue | null;
};

const mountedRoots: Root[] = [];
const PAGE_GUID = sectionGuid(1);
const RECTANGLE_GUID = sectionGuid(2);

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
  capture.current = useFigEditor();
  return null;
}

function mountProvider(capture: FigEditorContextCapture): void {
  const rectangle = sectionNode("RECTANGLE", {
    guid: RECTANGLE_GUID,
    parentIndex: { guid: PAGE_GUID, position: "a" },
    width: 100,
    height: 50,
  });
  const context = createFigDocumentContextFromNodeChanges({
    nodeChanges: [sectionDocument(), sectionPage(), rectangle],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => {
    root.render(createElement(FigEditorProvider, {
      context,
      children: createElement(FigEditorContextCaptureView, { capture }),
    }));
  });
}

describe("FigEditorProvider selected FigNode drag transform history", () => {
  afterEach(() => {
    act(() => {
      mountedRoots.forEach((root) => root.unmount());
    });
    mountedRoots.splice(0, mountedRoots.length);
  });

  it("records one undo history entry for multiple selected FigNode drag document updates", () => {
    const capture: FigEditorContextCapture = { current: null };
    mountProvider(capture);

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

  it("does not record undo history for a selected FigNode drag transform without a Kiwi document update", () => {
    const capture: FigEditorContextCapture = { current: null };
    mountProvider(capture);

    act(() => {
      capturedEditor(capture).beginSelectedFigNodeDragTransform();
    });
    act(() => {
      capturedEditor(capture).endSelectedFigNodeDragTransform();
    });

    expect(capturedEditor(capture).canUndo).toBe(false);
  });

  it("rejects non-selected FigNode drag Kiwi document mutation while selected FigNode drag transform is active", () => {
    const capture: FigEditorContextCapture = { current: null };
    mountProvider(capture);

    act(() => {
      capturedEditor(capture).beginSelectedFigNodeDragTransform();
    });

    expect(() => {
      act(() => {
        capturedEditor(capture).addPage("Second Page", FIG_NODE_MUTATION_SOURCE.pagePanel);
      });
    }).toThrow("page-panel mutation cannot publish during active selected FigNode drag transform");
  });
});
