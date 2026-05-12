/**
 * @file Spec for the canvas-lookup helpers. Loading a real `.fig`
 * binary is exercised by the per-converter spec suites; here we only
 * lock in the canvas-name matching rule and the internal-only filter.
 *
 * The helpers take `readonly FigNode[]` directly — the parsed roots —
 * so the spec builds real `FigNode` literals end-to-end. No casts
 * through `unknown` are needed because every field this spec exercises
 * (`type`, `internalOnly`, `name`, `children`) is a real `FigNode`
 * field.
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import { findCanvas, findInternalCanvas } from "./canvas-lookup";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name };
}

function canvas(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("CANVAS"),
    ...partial,
  };
}

function document(children: readonly FigNode[]): FigNode {
  return {
    guid: { sessionID: 1, localID: 0 },
    phase: enumName("CREATED"),
    type: enumName("DOCUMENT"),
    children,
  };
}

describe("findCanvas", () => {
  it("returns the user-visible canvas matching the requested name", () => {
    const design = canvas({ name: "Design" });
    const roots: readonly FigNode[] = [document([design])];
    expect(findCanvas(roots, "Design")).toBe(design);
  });

  it("ignores the Internal Only canvas even when its name matches", () => {
    const internal = canvas({ name: "Design", internalOnly: true });
    const roots: readonly FigNode[] = [document([internal])];
    expect(findCanvas(roots, "Design")).toBeUndefined();
  });

  it("returns undefined when no canvas matches", () => {
    const roots: readonly FigNode[] = [document([canvas({ name: "Other" })])];
    expect(findCanvas(roots, "Design")).toBeUndefined();
  });
});

describe("findInternalCanvas", () => {
  it("returns the (single) internal-only canvas", () => {
    const internal = canvas({ name: "Internal Only", internalOnly: true });
    const roots: readonly FigNode[] = [document([canvas({ name: "Design" }), internal])];
    expect(findInternalCanvas(roots)).toBe(internal);
  });

  it("returns undefined when there is no internal canvas", () => {
    const roots: readonly FigNode[] = [document([canvas({ name: "Design" })])];
    expect(findInternalCanvas(roots)).toBeUndefined();
  });
});
