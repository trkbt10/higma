/**
 * @file Tests for explicit fig builder ID allocation state.
 */

import { toNodeId, toPageId } from "@higma-document-models/fig/domain";
import type { FigDesignDocument, FigDesignNode } from "@higma-document-models/fig/domain";
import {
  createFigBuilderState,
  createFigBuilderStateFromDocument,
  createIdCounter,
  nextNodeId,
  nextPageId,
} from "./node-id";

describe("explicit fig builder state", () => {
  it("allocates deterministic node and page ids from independent states", () => {
    const first = createFigBuilderState({
      nodeIdCounter: { sessionID: 1, nextLocalID: 10 },
      pageIdCounter: { sessionID: 0, nextLocalID: 3 },
    });
    const second = createFigBuilderState({
      nodeIdCounter: { sessionID: 1, nextLocalID: 10 },
      pageIdCounter: { sessionID: 0, nextLocalID: 3 },
    });

    expect(nextNodeId(first.nodeIdCounter)).toBe("1:10");
    expect(nextNodeId(first.nodeIdCounter)).toBe("1:11");
    expect(nextPageId(first.pageIdCounter)).toBe("0:3");
    expect(nextNodeId(second.nodeIdCounter)).toBe("1:10");
    expect(nextPageId(second.pageIdCounter)).toBe("0:3");
  });

  it("requires explicit counter construction values", () => {
    expect(() => createIdCounter({ sessionID: 1, nextLocalID: 0 })).toThrow(
      "nextLocalID must be a positive integer",
    );
  });

  it("derives next ids from an explicit document allocation strategy", () => {
    const child: FigDesignNode = {
      id: toNodeId("1:7"),
      type: "RECTANGLE",
      name: "Child",
      visible: true,
      opacity: 1,
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      size: { x: 10, y: 10 },
      fills: [],
      strokes: [],
      strokeWeight: 0,
      effects: [],
    };
    const document: FigDesignDocument = {
      name: "Document",
      pages: [{
        id: toPageId("0:4"),
        name: "Page",
        backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
        children: [child],
      }],
      components: new Map(),
      styles: new Map(),
      images: new Map(),
      blobs: new Map(),
      metadata: {},
    };

    const state = createFigBuilderStateFromDocument({
      document,
      nodeSessionID: 1,
      pageSessionID: 0,
      minimumNodeLocalID: 1,
      minimumPageLocalID: 1,
    });

    expect(nextNodeId(state.nodeIdCounter)).toBe("1:8");
    expect(nextPageId(state.pageIdCounter)).toBe("0:5");
  });
});
