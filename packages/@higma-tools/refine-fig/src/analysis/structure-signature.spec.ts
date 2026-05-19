/**
 * @file Unit tests for structure signature routines.
 */
import { roleHintFor, structuralSignature } from "./structure-signature";
import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { createSymbolResolver } from "@higma-document-models/fig/symbols";
import { fakeFigNode } from "./fig-node-test-fixtures";

const childrenOfFixtureNode = createSymbolResolver({
  document: indexFigKiwiDocument([]),
}).childrenOfResolvedNode;

describe("structure signature", () => {
  it("produces a depth-bounded structural signature", () => {
    const root = fakeFigNode({
      type: { value: 1, name: "FRAME" },
      guid: { sessionID: 1, localID: 1 },
      children: [
        fakeFigNode({ type: { value: 13, name: "TEXT" }, guid: { sessionID: 1, localID: 2 } }),
        fakeFigNode({ type: { value: 5, name: "VECTOR" }, guid: { sessionID: 1, localID: 3 } }),
      ],
    });
    expect(structuralSignature(root, childrenOfFixtureNode, 3)).toBe("FRAME(TEXT,VECTOR)");
  });

  it("classifies a 24×24 frame full of vectors as an icon", () => {
    const node = fakeFigNode({
      type: { value: 1, name: "FRAME" },
      guid: { sessionID: 1, localID: 1 },
      size: { x: 24, y: 24 },
      children: [
        fakeFigNode({ type: { value: 5, name: "VECTOR" }, guid: { sessionID: 1, localID: 2 } }),
        fakeFigNode({ type: { value: 5, name: "VECTOR" }, guid: { sessionID: 1, localID: 3 } }),
      ],
    });
    expect(roleHintFor(node, childrenOfFixtureNode)).toBe("icon");
  });

  it("classifies a button-sized rectangle as button-bg", () => {
    const node = fakeFigNode({
      type: { value: 12, name: "ROUNDED_RECTANGLE" },
      guid: { sessionID: 1, localID: 1 },
      size: { x: 160, y: 40 },
    });
    expect(roleHintFor(node, childrenOfFixtureNode)).toBe("button-bg");
  });
});
