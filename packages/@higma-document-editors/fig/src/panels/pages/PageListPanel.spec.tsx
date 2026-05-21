/** @file Page list panel tests. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import { FigEditorProvider } from "../../context/FigEditorContext";
import { sectionDocument, sectionPage } from "../sections/section-specimen";
import { PageListPanel } from "./PageListPanel";

describe("PageListPanel", () => {
  it("renders CANVAS rows and the add-page affordance from Kiwi nodeChanges", () => {
    const page = sectionPage();
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [sectionDocument(), page],
      blobs: [],
      images: new Map(),
      metadata: null,
    });
    const html = renderToStaticMarkup(createElement(FigEditorProvider, {
      context,
      children: createElement(PageListPanel),
    }));

    expect(html).toContain("Pages");
    expect(html).toContain("Page");
    expect(html).toContain("Add Page");
  });
});
