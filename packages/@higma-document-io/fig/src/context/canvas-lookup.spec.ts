/**
 * @file Spec for the canvas-lookup helpers. Loading a real `.fig`
 * binary is exercised by the per-converter spec suites; here we only
 * lock in the canvas-name matching rule and the internal-only filter.
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import type { FigSymbolContext } from "./symbol-context";
import { findCanvas, findInternalCanvas } from "./canvas-lookup";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function canvas(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("CANVAS"),
    ...partial,
  } as FigNode;
}

function document(children: readonly FigNode[]): FigNode {
  return {
    guid: { sessionID: 1, localID: 0 },
    phase: enumName("CREATED"),
    type: enumName("DOCUMENT"),
    children,
  } as unknown as FigNode;
}

function ctxOf(roots: readonly FigNode[]): FigSymbolContext {
  return { tree: { roots } } as unknown as FigSymbolContext;
}

describe("findCanvas", () => {
  it("returns the user-visible canvas matching the requested name", () => {
    const design = canvas({ name: "Design" });
    const ctx = ctxOf([document([design])]);
    expect(findCanvas(ctx, "Design")).toBe(design);
  });

  it("ignores the Internal Only canvas even when its name matches", () => {
    const internal = canvas({ name: "Design", internalOnly: true });
    const ctx = ctxOf([document([internal])]);
    expect(findCanvas(ctx, "Design")).toBeUndefined();
  });

  it("returns undefined when no canvas matches", () => {
    const ctx = ctxOf([document([canvas({ name: "Other" })])]);
    expect(findCanvas(ctx, "Design")).toBeUndefined();
  });
});

describe("findInternalCanvas", () => {
  it("returns the (single) internal-only canvas", () => {
    const internal = canvas({ name: "Internal Only", internalOnly: true });
    const ctx = ctxOf([document([canvas({ name: "Design" }), internal])]);
    expect(findInternalCanvas(ctx)).toBe(internal);
  });

  it("returns undefined when there is no internal canvas", () => {
    const ctx = ctxOf([document([canvas({ name: "Design" })])]);
    expect(findInternalCanvas(ctx)).toBeUndefined();
  });
});
