/**
 * @file Unit tests for proposeRenames.
 */
import { proposeRenames } from "./naming";
import { fakeFigNode } from "./test-helpers";

describe("proposeRenames", () => {
  it("renames placeholder TEXT nodes from their content", () => {
    const text = fakeFigNode({
      type: { value: 13, name: "TEXT" },
      guid: { sessionID: 1, localID: 100 },
      name: "Text",
      characters: "Sign in to continue",
    });
    const root = fakeFigNode({
      type: { value: 1, name: "FRAME" },
      guid: { sessionID: 1, localID: 1 },
      name: "Auth Screen",
      children: [text],
    });
    const out = proposeRenames([root]);
    const proposal = out.find((p) => p.nodeGuid === "1:100");
    expect(proposal).toBeDefined();
    expect(proposal?.suggestedName).toBe("sign-in-to-continue");
  });

  it("does not rename nodes with authored names", () => {
    const text = fakeFigNode({
      type: { value: 13, name: "TEXT" },
      guid: { sessionID: 1, localID: 100 },
      name: "Heading/Hero",
      characters: "Sign in",
    });
    const root = fakeFigNode({
      type: { value: 1, name: "FRAME" },
      guid: { sessionID: 1, localID: 1 },
      name: "Auth Screen",
      children: [text],
    });
    expect(proposeRenames([root])).toHaveLength(0);
  });

  it("refuses to rename an icon-shaped container with no discriminator", () => {
    // A 24x24 frame holding a single VECTOR is icon-shaped, but
    // without a dominant TEXT or a borrowed INSTANCE name there is
    // nothing to call it but a generic "icon", which would just
    // re-introduce a placeholder. The contract is: no signifier, no
    // rename.
    const vector = fakeFigNode({ type: { value: 5, name: "VECTOR" }, guid: { sessionID: 1, localID: 3 } });
    const placeholder = fakeFigNode({
      type: { value: 1, name: "FRAME" },
      guid: { sessionID: 1, localID: 2 },
      name: "Frame 12",
      size: { x: 24, y: 24 },
      children: [vector],
    });
    const root = fakeFigNode({
      type: { value: 1, name: "FRAME" },
      guid: { sessionID: 1, localID: 1 },
      name: "Header",
      children: [placeholder],
    });
    const out = proposeRenames([root]);
    expect(out.find((p) => p.nodeGuid === "1:2")).toBeUndefined();
  });

  it("uses an authored INSTANCE child name as a discriminator", () => {
    // When a placeholder container holds a single INSTANCE whose own
    // name is meaningful (not "Frame N", not "Component"), borrow that
    // name as the discriminator: "search-icon-tile" instead of "icon".
    const instance = fakeFigNode({
      type: { value: 9, name: "INSTANCE" },
      guid: { sessionID: 1, localID: 3 },
      name: "search",
    });
    const tile = fakeFigNode({
      type: { value: 1, name: "FRAME" },
      guid: { sessionID: 1, localID: 2 },
      name: "Frame 12",
      size: { x: 24, y: 24 },
      children: [instance],
    });
    const root = fakeFigNode({
      type: { value: 1, name: "FRAME" },
      guid: { sessionID: 1, localID: 1 },
      name: "Header",
      children: [tile],
    });
    const out = proposeRenames([root]);
    const proposal = out.find((p) => p.nodeGuid === "1:2");
    expect(proposal).toBeDefined();
    // The borrowed INSTANCE name `search` is itself the signifier;
    // we do not append a generic role suffix when the wrapper frame
    // is a plain container holding the named instance.
    expect(proposal?.suggestedName).toBe("search");
  });

  it("rejects a placeholder-y TEXT slug as a discriminator", () => {
    // The TEXT inside the container literally says "Component 12".
    // That is a placeholder propagated forward as design content; it
    // must not be borrowed as a discriminator, because the resulting
    // name ("component-12-row") is no more identifying than "row".
    const text = fakeFigNode({
      type: { value: 13, name: "TEXT" },
      guid: { sessionID: 1, localID: 3 },
      name: "Text",
      characters: "Component 12",
    });
    const row = fakeFigNode({
      type: { value: 1, name: "FRAME" },
      guid: { sessionID: 1, localID: 2 },
      name: "Frame 10",
      children: [text],
    });
    const root = fakeFigNode({
      type: { value: 1, name: "FRAME" },
      guid: { sessionID: 1, localID: 1 },
      name: "Page",
      children: [row],
    });
    const out = proposeRenames([root]);
    expect(out.find((p) => p.nodeGuid === "1:2")).toBeUndefined();
    // The TEXT itself is also not renamed, because its slug is
    // placeholder-y.
    expect(out.find((p) => p.nodeGuid === "1:3")).toBeUndefined();
  });
});
