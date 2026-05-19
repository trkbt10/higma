/** @file Spec for scratch Kiwi GUID allocation. */

import { indexFigKiwiDocument } from "../domain";
import type { FigNode } from "../types";
import {
  createFigBuilderState,
  createFigBuilderStateFromDocument,
  createGuidCounter,
  nextNodeGuid,
  nextPageGuid,
} from "./guid-counter";

function node(type: FigNode["type"]["name"], sessionID: number, localID: number): FigNode {
  return {
    guid: { sessionID, localID },
    phase: { value: 0, name: "CREATED" },
    type: { value: 0, name: type },
  };
}

describe("guid-counter", () => {
  it("requires explicit non-negative sessions and positive local IDs", () => {
    expect(() => createGuidCounter({ sessionID: -1, nextLocalID: 1 })).toThrow("sessionID");
    expect(() => createGuidCounter({ sessionID: 0, nextLocalID: 0 })).toThrow("nextLocalID");
  });

  it("allocates node and page GUIDs from caller-owned counters", () => {
    const state = createFigBuilderState({
      nodeGuidCounter: { sessionID: 2, nextLocalID: 10 },
      pageGuidCounter: { sessionID: 3, nextLocalID: 20 },
    });
    expect(nextNodeGuid(state.nodeGuidCounter)).toEqual({ sessionID: 2, localID: 10 });
    expect(nextNodeGuid(state.nodeGuidCounter)).toEqual({ sessionID: 2, localID: 11 });
    expect(nextPageGuid(state.pageGuidCounter)).toEqual({ sessionID: 3, localID: 20 });
  });

  it("derives next counters from the Kiwi document SoT", () => {
    const document = indexFigKiwiDocument([
      node("DOCUMENT", 0, 1),
      node("CANVAS", 0, 7),
      node("FRAME", 1, 12),
      node("TEXT", 1, 18),
      node("FRAME", 9, 100),
    ]);
    const state = createFigBuilderStateFromDocument({
      document,
      nodeSessionID: 1,
      pageSessionID: 0,
      minimumNodeLocalID: 3,
      minimumPageLocalID: 2,
    });
    expect(state.nodeGuidCounter).toEqual({ sessionID: 1, nextLocalID: 19 });
    expect(state.pageGuidCounter).toEqual({ sessionID: 0, nextLocalID: 8 });
  });
});
