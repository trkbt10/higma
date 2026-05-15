/**
 * @file Pin SECTION-descent behaviour for `listFrameTargets`.
 *
 * Pre-fix: the walker was a single-level `.filter(isFrameLike)` over
 * the canvas's direct children, which silently skipped every FRAME /
 * SYMBOL grouped under a SECTION in the Figma Layers panel. That
 * omission cascaded into INSTANCE override resolution failures
 * (the INSTANCE pointed at a SYMBOL that lived inside a skipped
 * SECTION). Post-fix: SECTIONs flatten transparently, contributing
 * their FRAME / SYMBOL children in document order at the SECTION's
 * position.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { listFrameTargets, pickFrameByName } from "./targets";

/**
 * Minimal FigNode factory — the walker reads only `type.name`, `name`,
 * and `children`, so the rest of the FigNode fields are filled with
 * placeholder values just to satisfy the structural type. Using `as
 * FigNode` keeps the test fixture readable without a brittle full
 * NodeChange shape; the discriminating fields the SUT actually uses
 * are real.
 */
function makeNode(typeName: string, name: string, children?: readonly FigNode[]): FigNode {
  return {
    guid: { sessionID: 0, localID: 0 },
    phase: { value: 0, name: "CREATED" },
    type: { value: 0, name: typeName },
    name,
    children,
  } as FigNode;
}

function canvas(children: readonly FigNode[]): FigNode {
  return makeNode("CANVAS", "Test Canvas", children);
}

describe("listFrameTargets", () => {
  it("returns direct FRAME and SYMBOL children, skipping non-frame types", () => {
    const root = canvas([
      makeNode("FRAME", "F1"),
      makeNode("RECTANGLE", "R1"),
      makeNode("SYMBOL", "S1"),
      makeNode("TEXT", "T1"),
    ]);
    const out = listFrameTargets(root);
    expect(out.map((n) => n.name)).toEqual(["F1", "S1"]);
  });

  it("descends through a SECTION to surface its FRAME / SYMBOL children inline", () => {
    const root = canvas([
      makeNode("FRAME", "Outer Frame"),
      makeNode("SECTION", "Grouped", [
        makeNode("SYMBOL", "Inner Symbol A"),
        makeNode("FRAME", "Inner Frame B"),
        makeNode("RECTANGLE", "Ignored"),
      ]),
      makeNode("SYMBOL", "Trailing Symbol"),
    ]);
    const out = listFrameTargets(root);
    expect(out.map((n) => n.name)).toEqual([
      "Outer Frame",
      "Inner Symbol A",
      "Inner Frame B",
      "Trailing Symbol",
    ]);
  });

  it("descends through nested SECTIONs (SECTION-inside-SECTION)", () => {
    const root = canvas([
      makeNode("SECTION", "Outer Section", [
        makeNode("SECTION", "Inner Section", [
          makeNode("SYMBOL", "Deep Symbol"),
        ]),
        makeNode("FRAME", "Mid Frame"),
      ]),
    ]);
    const out = listFrameTargets(root);
    expect(out.map((n) => n.name)).toEqual(["Deep Symbol", "Mid Frame"]);
  });

  it("does NOT descend into FRAME / SYMBOL — those are emit boundaries", () => {
    const root = canvas([
      makeNode("FRAME", "Outer Frame", [
        makeNode("FRAME", "Nested Frame"),
        makeNode("SYMBOL", "Nested Symbol"),
      ]),
    ]);
    const out = listFrameTargets(root);
    expect(out.map((n) => n.name)).toEqual(["Outer Frame"]);
  });

  it("preserves order across SECTION boundaries", () => {
    const root = canvas([
      makeNode("FRAME", "A"),
      makeNode("SECTION", "Group", [makeNode("FRAME", "B"), makeNode("FRAME", "C")]),
      makeNode("FRAME", "D"),
    ]);
    const out = listFrameTargets(root);
    expect(out.map((n) => n.name)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("pickFrameByName", () => {
  it("finds a frame surfaced via a SECTION descent", () => {
    const root = canvas([
      makeNode("SECTION", "App Store symbols", [
        makeNode("SYMBOL", "Search toolbar"),
        makeNode("SYMBOL", "Event Details Card"),
      ]),
    ]);
    const frames = listFrameTargets(root);
    const picked = pickFrameByName(frames, "Search toolbar");
    expect(picked.name).toBe("Search toolbar");
  });
});
