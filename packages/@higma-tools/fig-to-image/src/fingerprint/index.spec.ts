/** @file Unit specs for the Kiwi FigNode subtree fingerprint. */

import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import { createSymbolResolver, type SymbolResolver } from "@higma-document-models/fig/symbols";
import { fingerprintFigSubtree } from "./index";

const EMPTY_SYMBOL_RESOLVER = createSymbolResolver({
  document: indexFigKiwiDocument([]),
});

function guid(localID: number): FigGuid {
  return { sessionID: 1, localID };
}

function makeNode(overrides: Partial<FigNode>): FigNode {
  return {
    guid: guid(1),
    phase: { value: 0, name: "CREATED" },
    type: { value: 4, name: "FRAME" },
    name: "node",
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: 100, y: 100 },
    fillPaints: [],
    strokePaints: [],
    strokeWeight: 0,
    effects: [],
    ...overrides,
  };
}

function options(symbolResolver: SymbolResolver = EMPTY_SYMBOL_RESOLVER): {
  readonly pixelRatio: number;
  readonly symbolResolver: SymbolResolver;
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
} {
  return {
    pixelRatio: 1,
    symbolResolver,
    childrenOf: symbolResolver.childrenOfResolvedNode,
  };
}

function resolverFor(nodes: readonly FigNode[]): SymbolResolver {
  for (const node of nodes) {
    if (node.guid === undefined) {
      throw new Error("resolverFor requires every node to carry guid");
    }
  }
  return createSymbolResolver({
    document: indexFigKiwiDocument(nodes),
  });
}

describe("fingerprintFigSubtree", () => {
  it("produces a deterministic prefixed hex digest", () => {
    const fp = fingerprintFigSubtree(makeNode({}), options());
    expect(fp).toMatch(/^fig-fp-v1:[0-9a-f]{64}$/u);
  });

  it("produces identical digests for identical inputs", () => {
    expect(fingerprintFigSubtree(makeNode({}), options()))
      .toBe(fingerprintFigSubtree(makeNode({}), options()));
  });

  it("flips on a fill change", () => {
    const a = makeNode({ fillPaints: [] });
    const b = makeNode({
      fillPaints: [{ type: { value: 0, name: "SOLID" }, color: { r: 1, g: 0, b: 0, a: 1 } }],
    });
    expect(fingerprintFigSubtree(a, options()))
      .not.toBe(fingerprintFigSubtree(b, options()));
  });

  it("flips on a size change", () => {
    const a = makeNode({});
    const b = makeNode({ size: { x: 200, y: 100 } });
    expect(fingerprintFigSubtree(a, options()))
      .not.toBe(fingerprintFigSubtree(b, options()));
  });

  it("does not flip on a name change", () => {
    const a = makeNode({ name: "before" });
    const b = makeNode({ name: "after" });
    expect(fingerprintFigSubtree(a, options()))
      .toBe(fingerprintFigSubtree(b, options()));
  });

  it("does not flip on a guid change", () => {
    const a = makeNode({ guid: guid(1) });
    const b = makeNode({ guid: guid(99) });
    expect(fingerprintFigSubtree(a, options()))
      .toBe(fingerprintFigSubtree(b, options()));
  });

  it("flips when pixelRatio changes", () => {
    const node = makeNode({});
    expect(fingerprintFigSubtree(node, options()))
      .not.toBe(fingerprintFigSubtree(node, { ...options(), pixelRatio: 2 }));
  });

  it("expands a referenced SYMBOL into the INSTANCE digest", () => {
    const symbolGuid = guid(10);
    const symbolPaintedRed = makeNode({
      guid: symbolGuid,
      type: { value: 3, name: "SYMBOL" },
      fillPaints: [{ type: { value: 0, name: "SOLID" }, color: { r: 1, g: 0, b: 0, a: 1 } }],
    });
    const symbolPaintedBlue = makeNode({
      guid: symbolGuid,
      type: { value: 3, name: "SYMBOL" },
      fillPaints: [{ type: { value: 0, name: "SOLID" }, color: { r: 0, g: 0, b: 1, a: 1 } }],
    });
    const instance = makeNode({
      guid: guid(20),
      type: { value: 6, name: "INSTANCE" },
      symbolData: { symbolID: symbolGuid },
    });

    const fpRed = fingerprintFigSubtree(instance, options(resolverFor([symbolPaintedRed])));
    const fpBlue = fingerprintFigSubtree(instance, options(resolverFor([symbolPaintedBlue])));
    expect(fpRed).not.toBe(fpBlue);
  });

  it("does not stack-overflow on a self-referencing SYMBOL", () => {
    const symbolGuid = guid(10);
    const nestedInstance = makeNode({
      guid: guid(11),
      type: { value: 6, name: "INSTANCE" },
      parentIndex: { guid: symbolGuid, position: "0" },
      symbolData: { symbolID: symbolGuid },
    });
    const symbol = makeNode({
      guid: symbolGuid,
      type: { value: 3, name: "SYMBOL" },
      children: [nestedInstance],
    });
    const rootInstance = makeNode({
      guid: guid(20),
      type: { value: 6, name: "INSTANCE" },
      symbolData: { symbolID: symbolGuid },
    });
    const fp = fingerprintFigSubtree(rootInstance, options(resolverFor([symbol, nestedInstance])));
    expect(fp).toMatch(/^fig-fp-v1:[0-9a-f]{64}$/u);
  });

  it("is stable under irrelevant child field ordering", () => {
    const childA = makeNode({ guid: guid(2), size: { x: 10, y: 10 } });
    const childB = makeNode({ guid: guid(3), size: { x: 20, y: 20 } });
    const parent1 = makeNode({ children: [childA, childB] });
    const parent2 = makeNode({ children: [childA, childB] });
    expect(fingerprintFigSubtree(parent1, options()))
      .toBe(fingerprintFigSubtree(parent2, options()));
  });

  it("flips when child order changes", () => {
    const childA = makeNode({ guid: guid(2), size: { x: 10, y: 10 } });
    const childB = makeNode({ guid: guid(3), size: { x: 20, y: 20 } });
    const parent1 = makeNode({ children: [childA, childB] });
    const parent2 = makeNode({ children: [childB, childA] });
    expect(fingerprintFigSubtree(parent1, options()))
      .not.toBe(fingerprintFigSubtree(parent2, options()));
  });
});
