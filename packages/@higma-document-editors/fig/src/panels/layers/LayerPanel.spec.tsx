/** @file Layer panel tests. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import { createFigEditorStore, FigEditorStoreProvider } from "../../context/FigEditorContext";
import { sectionDocument, sectionNode, sectionPage } from "../sections/section-specimen";
import { LayerPanel } from "./LayerPanel";

function renderLayerPanelWithFigEditorStore(context: ReturnType<typeof createFigDocumentContextFromNodeChanges>): string {
  const store = createFigEditorStore({ context });
  try {
    return renderToStaticMarkup(createElement(FigEditorStoreProvider, {
      store,
      children: createElement(LayerPanel),
    }));
  } finally {
    store.dispose();
  }
}

describe("LayerPanel", () => {
  it("renders Kiwi child nodes through the layer row surface", () => {
    const page = sectionPage();
    if (page.guid === undefined) {
      throw new Error("LayerPanel spec page is missing guid");
    }
    const frame = sectionNode("FRAME", {
      name: "Frame A",
      parentIndex: { guid: page.guid, position: "a" },
    });
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [sectionDocument(), page, frame],
      blobs: [],
      images: new Map(),
      metadata: null,
    });
    const html = renderLayerPanelWithFigEditorStore(context);

    expect(html).toContain("Layers");
    expect(html).toContain("Frame A");
    expect(html).toContain("FRAME");
  });
});
