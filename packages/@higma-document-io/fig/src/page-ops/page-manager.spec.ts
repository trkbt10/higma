/**
 * @file Tests for explicit state page construction.
 */

import { toPageId } from "@higma-document-models/fig/domain";
import type { FigDesignDocument } from "@higma-document-models/fig/domain";
import { createFigBuilderState } from "../types";
import { addPage, duplicatePage } from "./page-manager";

function createDocument(): FigDesignDocument {
  return {
    name: "Document",
    pages: [{
      id: toPageId("0:1"),
      name: "Page",
      backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
      children: [],
    }],
    components: new Map(),
    styles: new Map(),
    images: new Map(),
    blobs: new Map(),
    metadata: {},
  };
}

describe("page creation operations", () => {
  it("requires explicit state and page name when adding pages", () => {
    const state = createFigBuilderState({
      nodeIdCounter: { sessionID: 1, nextLocalID: 1 },
      pageIdCounter: { sessionID: 0, nextLocalID: 5 },
    });

    const result = addPage({ state, doc: createDocument(), name: "Explicit Page" });

    expect(result.pageId).toBe("0:5");
    expect(result.doc.pages[1]?.name).toBe("Explicit Page");
  });

  it("fails when duplicate page cannot find the source page", () => {
    const state = createFigBuilderState({
      nodeIdCounter: { sessionID: 1, nextLocalID: 1 },
      pageIdCounter: { sessionID: 0, nextLocalID: 5 },
    });

    expect(() => duplicatePage({
      state,
      doc: createDocument(),
      pageId: toPageId("0:99"),
      name: "Duplicate",
    })).toThrow("duplicatePage failed: page 0:99 was not found");
  });
});
