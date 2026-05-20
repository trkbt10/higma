/**
 * @file Spec for the canvas-lookup functions. Loading a real `.fig`
 * binary is exercised by the per-converter spec suites; here we only
 * lock in the canvas-name matching rule and the internal-only filter.
 *
 * The functions take the Kiwi document index, so the spec builds
 * nodeChanges with explicit parentIndex links.
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { findCanvas, findCanvases, findInternalCanvas, requireCanvas, requireInternalCanvas } from "./canvas-lookup";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name };
}

function canvas(localID: number, partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID },
    parentIndex: { guid: { sessionID: 1, localID: 0 }, position: `${localID}` },
    phase: enumName("CREATED"),
    type: enumName("CANVAS"),
    ...partial,
  };
}

function documentRoot(): FigNode {
  return {
    guid: { sessionID: 1, localID: 0 },
    phase: enumName("CREATED"),
    type: enumName("DOCUMENT"),
  };
}

function kiwiDocument(canvases: readonly FigNode[]) {
  return indexFigKiwiDocument([documentRoot(), ...canvases]);
}

describe("findCanvas", () => {
  it("returns the user-visible canvas matching the requested name", () => {
    const design = canvas(1, { name: "Design" });
    expect(findCanvas(kiwiDocument([design]), "Design")).toBe(design);
  });

  it("ignores the Internal Only canvas even when its name matches", () => {
    const internal = canvas(1, { name: "Design", internalOnly: true });
    expect(findCanvas(kiwiDocument([internal]), "Design")).toBeUndefined();
  });

  it("returns undefined when no canvas matches", () => {
    expect(findCanvas(kiwiDocument([canvas(1, { name: "Other" })]), "Design")).toBeUndefined();
  });
});

describe("findCanvases", () => {
  it("returns only user-visible document CANVAS nodes in Kiwi order", () => {
    const design = canvas(1, { name: "Design" });
    const internal = canvas(2, { name: "Internal Only", internalOnly: true });
    const prototype = canvas(3, { name: "Prototype" });
    const hidden = canvas(4, { name: "Hidden", visible: false });

    expect(findCanvases(kiwiDocument([design, internal, prototype, hidden]))).toEqual([design, prototype]);
  });
});

describe("findInternalCanvas", () => {
  it("returns the (single) internal-only canvas", () => {
    const internal = canvas(2, { name: "Internal Only", internalOnly: true });
    expect(findInternalCanvas(kiwiDocument([canvas(1, { name: "Design" }), internal]))).toBe(internal);
  });

  it("returns undefined when there is no internal canvas", () => {
    expect(findInternalCanvas(kiwiDocument([canvas(1, { name: "Design" })]))).toBeUndefined();
  });
});

describe("required canvas lookup", () => {
  it("returns the user-visible canvas matching the requested name", () => {
    const design = canvas(1, { name: "Design" });
    expect(requireCanvas(kiwiDocument([design]), "Design")).toBe(design);
  });

  it("fails when no canvas matches", () => {
    expect(() => requireCanvas(kiwiDocument([]), "Design")).toThrow(
      'requireCanvas: CANVAS "Design" does not exist',
    );
  });

  it("fails when there is no internal canvas", () => {
    expect(() => requireInternalCanvas(kiwiDocument([]))).toThrow(
      "requireInternalCanvas: internal CANVAS does not exist",
    );
  });
});
