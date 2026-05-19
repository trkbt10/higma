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
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { listFrameTargets, pickFrameByName } from "./targets";

const SESSION_ID = 1;

function kiwiGuid(localID: number): FigGuid {
  return { sessionID: SESSION_ID, localID };
}

function kiwiParentIndex(parent: { readonly localID: number; readonly position: number } | undefined) {
  if (parent === undefined) {
    return {};
  }
  return { parentIndex: { guid: kiwiGuid(parent.localID), position: `${parent.position}` } };
}

function kiwiNodeChange(
  typeName: string,
  name: string,
  localID: number,
  parent?: { readonly localID: number; readonly position: number },
): FigNode {
  return {
    guid: kiwiGuid(localID),
    phase: { value: 0, name: "CREATED" },
    type: { value: 0, name: typeName },
    name,
    ...kiwiParentIndex(parent),
  } as FigNode;
}

function canvas(localID: number): FigNode {
  return kiwiNodeChange("CANVAS", "Test Canvas", localID);
}

function indexedKiwiDocument(root: FigNode, nodeChanges: readonly FigNode[]) {
  return { document: indexFigKiwiDocument([root, ...nodeChanges]), root };
}

describe("listFrameTargets", () => {
  it("returns direct FRAME and SYMBOL children, skipping non-frame types", () => {
    const root = canvas(1);
    const kiwi = indexedKiwiDocument(root, [
      kiwiNodeChange("FRAME", "F1", 2, { localID: 1, position: 0 }),
      kiwiNodeChange("RECTANGLE", "R1", 3, { localID: 1, position: 1 }),
      kiwiNodeChange("SYMBOL", "S1", 4, { localID: 1, position: 2 }),
      kiwiNodeChange("TEXT", "T1", 5, { localID: 1, position: 3 }),
    ]);
    const out = listFrameTargets(kiwi.document, kiwi.root);
    expect(out.map((n) => n.name)).toEqual(["F1", "S1"]);
  });

  it("descends through a SECTION to surface its FRAME / SYMBOL children inline", () => {
    const root = canvas(1);
    const kiwi = indexedKiwiDocument(root, [
      kiwiNodeChange("FRAME", "Outer Frame", 2, { localID: 1, position: 0 }),
      kiwiNodeChange("SECTION", "Grouped", 3, { localID: 1, position: 1 }),
      kiwiNodeChange("SYMBOL", "Inner Symbol A", 4, { localID: 3, position: 0 }),
      kiwiNodeChange("FRAME", "Inner Frame B", 5, { localID: 3, position: 1 }),
      kiwiNodeChange("RECTANGLE", "Ignored", 6, { localID: 3, position: 2 }),
      kiwiNodeChange("SYMBOL", "Trailing Symbol", 7, { localID: 1, position: 2 }),
    ]);
    const out = listFrameTargets(kiwi.document, kiwi.root);
    expect(out.map((n) => n.name)).toEqual([
      "Outer Frame",
      "Inner Symbol A",
      "Inner Frame B",
      "Trailing Symbol",
    ]);
  });

  it("descends through nested SECTIONs (SECTION-inside-SECTION)", () => {
    const root = canvas(1);
    const kiwi = indexedKiwiDocument(root, [
      kiwiNodeChange("SECTION", "Outer Section", 2, { localID: 1, position: 0 }),
      kiwiNodeChange("SECTION", "Inner Section", 3, { localID: 2, position: 0 }),
      kiwiNodeChange("SYMBOL", "Deep Symbol", 4, { localID: 3, position: 0 }),
      kiwiNodeChange("FRAME", "Mid Frame", 5, { localID: 2, position: 1 }),
    ]);
    const out = listFrameTargets(kiwi.document, kiwi.root);
    expect(out.map((n) => n.name)).toEqual(["Deep Symbol", "Mid Frame"]);
  });

  it("does NOT descend into FRAME / SYMBOL — those are emit boundaries", () => {
    const root = canvas(1);
    const kiwi = indexedKiwiDocument(root, [
      kiwiNodeChange("FRAME", "Outer Frame", 2, { localID: 1, position: 0 }),
      kiwiNodeChange("FRAME", "Nested Frame", 3, { localID: 2, position: 0 }),
      kiwiNodeChange("SYMBOL", "Nested Symbol", 4, { localID: 2, position: 1 }),
    ]);
    const out = listFrameTargets(kiwi.document, kiwi.root);
    expect(out.map((n) => n.name)).toEqual(["Outer Frame"]);
  });

  it("preserves order across SECTION boundaries", () => {
    const root = canvas(1);
    const kiwi = indexedKiwiDocument(root, [
      kiwiNodeChange("FRAME", "A", 2, { localID: 1, position: 0 }),
      kiwiNodeChange("SECTION", "Group", 3, { localID: 1, position: 1 }),
      kiwiNodeChange("FRAME", "B", 4, { localID: 3, position: 0 }),
      kiwiNodeChange("FRAME", "C", 5, { localID: 3, position: 1 }),
      kiwiNodeChange("FRAME", "D", 6, { localID: 1, position: 2 }),
    ]);
    const out = listFrameTargets(kiwi.document, kiwi.root);
    expect(out.map((n) => n.name)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("pickFrameByName", () => {
  it("finds a frame surfaced via a SECTION descent", () => {
    const root = canvas(1);
    const kiwi = indexedKiwiDocument(root, [
      kiwiNodeChange("SECTION", "App Store symbols", 2, { localID: 1, position: 0 }),
      kiwiNodeChange("SYMBOL", "Search toolbar", 3, { localID: 2, position: 0 }),
      kiwiNodeChange("SYMBOL", "Event Details Card", 4, { localID: 2, position: 1 }),
    ]);
    const frames = listFrameTargets(kiwi.document, kiwi.root);
    const picked = pickFrameByName(frames, "Search toolbar");
    expect(picked.name).toBe("Search toolbar");
  });
});
