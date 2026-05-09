/**
 * @file Unit tests for subtree signature helpers.
 */
import { roleHintFor, structuralSignature } from "./subtree-signature";
import { fakeFigNode } from "./test-helpers";

describe("subtree signature", () => {
  it("produces a depth-bounded structural signature", () => {
    const root = fakeFigNode({
      type: { value: 1, name: "FRAME" },
      guid: { sessionID: 1, localID: 1 },
      children: [
        fakeFigNode({ type: { value: 13, name: "TEXT" }, guid: { sessionID: 1, localID: 2 } }),
        fakeFigNode({ type: { value: 5, name: "VECTOR" }, guid: { sessionID: 1, localID: 3 } }),
      ],
    });
    expect(structuralSignature(root, 3)).toBe("FRAME(TEXT,VECTOR)");
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
    expect(roleHintFor(node)).toBe("icon");
  });

  it("classifies a button-sized rectangle as button-bg", () => {
    const node = fakeFigNode({
      type: { value: 12, name: "ROUNDED_RECTANGLE" },
      guid: { sessionID: 1, localID: 1 },
      size: { x: 160, y: 40 },
    });
    expect(roleHintFor(node)).toBe("button-bg");
  });
});
