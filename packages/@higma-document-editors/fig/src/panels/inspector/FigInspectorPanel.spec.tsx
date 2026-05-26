/** @file Inspector panel tests. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import { createFigEditorStore, FigEditorStoreProvider } from "../../context/FigEditorContext";
import { sectionDocument, sectionNode, sectionPage } from "../sections/section-specimen";
import { FigInspectorPanel } from "./FigInspectorPanel";

function renderFigInspectorPanelWithFigEditorStore(context: ReturnType<typeof createFigDocumentContextFromNodeChanges>): string {
  const store = createFigEditorStore({ context });
  try {
    return renderToStaticMarkup(createElement(FigEditorStoreProvider, {
      store,
      children: createElement(FigInspectorPanel),
    }));
  } finally {
    store.dispose();
  }
}

describe("FigInspectorPanel", () => {
  it("renders the Kiwi inspector tree and legend", () => {
    const page = sectionPage();
    if (page.guid === undefined) {
      throw new Error("FigInspectorPanel spec page is missing guid");
    }
    const frame = sectionNode("FRAME", {
      name: "Inspectable Frame",
      parentIndex: { guid: page.guid, position: "a" },
    });
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [sectionDocument(), page, frame],
      blobs: [],
      images: new Map(),
      metadata: null,
    });
    const html = renderFigInspectorPanelWithFigEditorStore(context);

    expect(html).toContain("Container");
    expect(html).toContain("Inspectable Frame");
    expect(html).toContain("FRAME");
  });
});
