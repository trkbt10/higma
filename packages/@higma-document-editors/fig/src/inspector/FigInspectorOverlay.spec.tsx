/** @file Inspector overlay tests. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import { createFigEditorStore, FigEditorStoreProvider } from "../context/FigEditorContext";
import { sectionDocument, sectionNode, sectionPage } from "../panels/sections/section-specimen";
import { FigInspectorOverlay } from "./FigInspectorOverlay";

function renderFigInspectorOverlayWithFigEditorStore(context: ReturnType<typeof createFigDocumentContextFromNodeChanges>): string {
  const store = createFigEditorStore({ context });
  try {
    return renderToStaticMarkup(createElement(FigEditorStoreProvider, {
      store,
      children: createElement(FigInspectorOverlay),
    }));
  } finally {
    store.dispose();
  }
}

describe("FigInspectorOverlay", () => {
  it("waits for renderer-derived node bounds before rendering overlay boxes", () => {
    const page = sectionPage();
    if (page.guid === undefined) {
      throw new Error("FigInspectorOverlay spec page is missing guid");
    }
    const rect = sectionNode("ROUNDED_RECTANGLE", {
      name: "Overlay Rect",
      parentIndex: { guid: page.guid, position: "a" },
    });
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [sectionDocument(), page, rect],
      blobs: [],
      images: new Map(),
      metadata: null,
    });
    const html = renderFigInspectorOverlayWithFigEditorStore(context);

    expect(html).toContain('data-inspector-overlay="true"');
    expect(html).not.toContain("<rect");
  });
});
