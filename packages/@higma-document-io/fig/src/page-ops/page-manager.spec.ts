/** @file Spec for page construction over Kiwi nodeChanges. */

import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import { addPage, createEmptyFigDocument } from "./page-manager";

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
