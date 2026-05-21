/** @file Inspector overlay tests. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import { FigEditorProvider } from "../context/FigEditorContext";
import { sectionDocument, sectionNode, sectionPage } from "../panels/sections/section-specimen";
import { FigInspectorOverlay } from "./FigInspectorOverlay";

describe("FigInspectorOverlay", () => {
  it("renders overlay boxes from Kiwi node bounds", () => {
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
    const html = renderToStaticMarkup(createElement(FigEditorProvider, {
      context,
      children: createElement(FigInspectorOverlay),
    }));

    expect(html).toContain('data-inspector-overlay="true"');
    expect(html).toContain("<rect");
  });
});
