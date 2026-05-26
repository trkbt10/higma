/** @file Spec for page construction over Kiwi nodeChanges. */

import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import { createFigDocumentContextFromNodeChanges } from "../context";
import { addPage, createEmptyFigDocument } from "./page-manager";

const CUSTOM_DOCUMENT_GUID: FigGuid = { sessionID: 80, localID: 0 };
const CUSTOM_CANVAS_GUID: FigGuid = { sessionID: 80, localID: 1 };

function customNode(type: "DOCUMENT" | "CANVAS", guid: FigGuid, parentGuid?: FigGuid): FigNode {
  return {
    guid,
    parentIndex: parentGuid === undefined ? undefined : { guid: parentGuid, position: "a" },
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES[type], name: type },
    name: type,
  };
}

describe("page creation operations", () => {
  it("creates a DOCUMENT plus first CANVAS directly in nodeChanges", () => {
    const context = createEmptyFigDocument("Page");
    expect(context.document.nodeChanges.map((node) => getNodeType(node))).toEqual(["DOCUMENT", "CANVAS"]);
    const canvas = context.document.nodeChanges[1];
    expect(canvas?.name).toBe("Page");
    expect(canvas?.parentIndex?.guid).toEqual({ sessionID: 0, localID: 0 });
  });

  it("requires explicit state and page name when adding pages", () => {
    const state = createFigBuilderState({
      nodeGuidCounter: { sessionID: 1, nextLocalID: 1 },
      pageGuidCounter: { sessionID: 0, nextLocalID: 5 },
    });
    const base = createEmptyFigDocument("Page");
    const result = addPage({ state, context: base, name: "Explicit Page" });
    const pageKey = guidToString(result.pageGuid);
    expect(pageKey).toBe("0:5");
    expect(result.context.document.nodesByGuid.get(pageKey)?.name).toBe("Explicit Page");
  });

  it("parents new pages to the Kiwi DOCUMENT root carried by the context", () => {
    const state = createFigBuilderState({
      nodeGuidCounter: { sessionID: 1, nextLocalID: 1 },
      pageGuidCounter: { sessionID: 0, nextLocalID: 1 },
    });
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [
        customNode("DOCUMENT", CUSTOM_DOCUMENT_GUID),
        customNode("CANVAS", CUSTOM_CANVAS_GUID, CUSTOM_DOCUMENT_GUID),
      ],
      blobs: [],
      images: new Map(),
      metadata: null,
    });

    const result = addPage({ state, context, name: "Context-rooted Page" });
    const page = result.context.document.nodesByGuid.get(guidToString(result.pageGuid));

    expect(page?.parentIndex?.guid).toEqual(CUSTOM_DOCUMENT_GUID);
    expect(result.context.document.childrenOf(customNode("DOCUMENT", CUSTOM_DOCUMENT_GUID)).map((node) => node.name)).toEqual([
      "CANVAS",
      "Context-rooted Page",
    ]);
  });

  it("marks explicitly internal canvases through Kiwi fields", () => {
    const state = createFigBuilderState({
      nodeGuidCounter: { sessionID: 1, nextLocalID: 1 },
      pageGuidCounter: { sessionID: 0, nextLocalID: 5 },
    });
    const result = addPage({
      state,
      context: createEmptyFigDocument("Page"),
      name: "Internal",
      internalOnly: true,
    });
    const page = result.context.document.nodesByGuid.get(guidToString(result.pageGuid));
    expect(page?.internalOnly).toBe(true);
    expect(page?.parentIndex?.position).toBe("~");
  });
});
