/** @file Spec for Kiwi node construction and mutation. */

import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { guidToString } from "@higma-document-models/fig/domain";
import { addNode, updateNode } from "./node-manager";
import { createEmptyFigDocument } from "../page-ops";

describe("node operations", () => {
  it("updates one Kiwi node by GUID and keeps the document indexed", () => {
    const state = createFigBuilderState({
      nodeGuidCounter: { sessionID: 1, nextLocalID: 10 },
      pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
    });
    const pageGuid = { sessionID: 0, localID: 1 };
    const added = addNode({
      state,
      context: createEmptyFigDocument("Page"),
      pageGuid,
      parentGuid: null,
      spec: {
        type: "RECTANGLE",
        name: "Before",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
    });

    const context = updateNode({
      context: added.context,
      nodeGuid: added.nodeGuid,
      update: (node) => ({ ...node, name: "After" }),
    });

    expect(context.document.nodesByGuid.get(guidToString(added.nodeGuid))?.name).toBe("After");
  });

  it("fails when an update would move identity away from the Kiwi GUID SoT", () => {
    const state = createFigBuilderState({
      nodeGuidCounter: { sessionID: 1, nextLocalID: 10 },
      pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
    });
    const added = addNode({
      state,
      context: createEmptyFigDocument("Page"),
      pageGuid: { sessionID: 0, localID: 1 },
      parentGuid: null,
      spec: {
        type: "RECTANGLE",
        name: "Before",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
    });

    expect(() => updateNode({
      context: added.context,
      nodeGuid: added.nodeGuid,
      update: (node) => ({ ...node, guid: { sessionID: 9, localID: 9 } }),
    })).toThrow("updateNode: update changed node guid 1:10 to 9:9");
  });
});
