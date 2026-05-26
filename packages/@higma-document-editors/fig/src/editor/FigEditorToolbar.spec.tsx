/** @file Fig editor toolbar tests. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import { createFigEditorStore, FigEditorStoreProvider } from "../context/FigEditorContext";
import { sectionDocument, sectionPage } from "../panels/sections/section-specimen";
import { FigEditorToolbar } from "./FigEditorToolbar";

function renderToolbar(): string {
  const context = createFigDocumentContextFromNodeChanges({
    nodeChanges: [sectionDocument(), sectionPage()],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  const store = createFigEditorStore({ context });
  try {
    return renderToStaticMarkup(
      createElement(FigEditorStoreProvider, { store, children: createElement(FigEditorToolbar) }),
    );
  } finally {
    store.dispose();
  }
}

describe("FigEditorToolbar", () => {
  it("keeps the Kiwi-backed editor tool surface visible", () => {
    const html = renderToolbar();

    expect(html).toContain('title="Select (V)"');
    expect(html).toContain('title="Frame"');
    expect(html).toContain('title="Rectangle"');
    expect(html).toContain('title="Ellipse"');
    expect(html).toContain('title="Line"');
    expect(html).toContain('title="Star"');
    expect(html).toContain('title="Polygon"');
    expect(html).toContain('title="Text"');
    expect(html).toContain('title="Vector Edit (P)"');
    expect(html).toContain('title="Undo"');
    expect(html).toContain('title="Redo"');
    expect(html).toContain('title="Delete"');
    expect(html).toContain('title="Export .fig"');
  });
});
