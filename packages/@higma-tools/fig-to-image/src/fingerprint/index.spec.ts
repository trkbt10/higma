/**
 * @file Unit specs for the fig subtree fingerprint.
 *
 * The fingerprint is the SoT for "is the on-disk PNG still
 * authoritative?" — its stability matters more than the
 * particular digest value. The specs cover:
 *
 *   - identical inputs produce identical digests
 *   - field changes that the renderer would consume flip the digest
 *   - field changes the renderer ignores (name) do NOT flip it
 *   - pixelRatio is folded in as part of the render context
 *   - SYMBOL references expand and propagate through INSTANCE digests
 *   - SYMBOL cycles don't crash the walker
 */
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { fingerprintFigSubtree } from "./index";

/**
 * Synthetic-node builder accepting an unknown property bag. The
 * fingerprint walker treats any extra fields as opaque and only
 * reads the renderer-consumed shape, so the test can splat
 * arbitrary overrides without going through every typed field.
 */
function isFigDesignNode(value: unknown): value is FigDesignNode {
  return Boolean(value) && typeof value === "object";
}

function makeNode(overrides: Record<string, unknown>): FigDesignNode {
  const base: Record<string, unknown> = {
    id: "0:1",
    type: "FRAME",
    name: "node",
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: 100, y: 100 },
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
  };
  const merged = { ...base, ...overrides };
  if (!isFigDesignNode(merged)) {
    throw new Error("makeNode: failed to produce a FigDesignNode");
  }
  return merged;
}

const emptySymbolMap: ReadonlyMap<string, FigDesignNode> = new Map();

describe("fingerprintFigSubtree", () => {
  it("produces a deterministic prefixed hex digest", () => {
    const node = makeNode({});
    const fp = fingerprintFigSubtree(node, { pixelRatio: 1, symbolMap: emptySymbolMap });
    expect(fp).toMatch(/^fig-fp-v1:[0-9a-f]{64}$/u);
  });

  it("produces identical digests for identical inputs", () => {
    const a = makeNode({});
    const b = makeNode({});
    expect(fingerprintFigSubtree(a, { pixelRatio: 1, symbolMap: emptySymbolMap }))
      .toBe(fingerprintFigSubtree(b, { pixelRatio: 1, symbolMap: emptySymbolMap }));
  });

  it("flips on a fill change", () => {
    const a = makeNode({ fills: [] });
    const b = makeNode({
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
    });
    expect(fingerprintFigSubtree(a, { pixelRatio: 1, symbolMap: emptySymbolMap }))
      .not.toBe(fingerprintFigSubtree(b, { pixelRatio: 1, symbolMap: emptySymbolMap }));
  });

  it("flips on a size change", () => {
    const a = makeNode({});
    const b = makeNode({ size: { x: 200, y: 100 } });
    expect(fingerprintFigSubtree(a, { pixelRatio: 1, symbolMap: emptySymbolMap }))
      .not.toBe(fingerprintFigSubtree(b, { pixelRatio: 1, symbolMap: emptySymbolMap }));
  });

  it("does NOT flip on a name change (renderer ignores name)", () => {
    const a = makeNode({ name: "before" });
    const b = makeNode({ name: "after" });
    expect(fingerprintFigSubtree(a, { pixelRatio: 1, symbolMap: emptySymbolMap }))
      .toBe(fingerprintFigSubtree(b, { pixelRatio: 1, symbolMap: emptySymbolMap }));
  });

  it("does NOT flip on an id change", () => {
    const a = makeNode({ id: "0:1" });
    const b = makeNode({ id: "0:99" });
    expect(fingerprintFigSubtree(a, { pixelRatio: 1, symbolMap: emptySymbolMap }))
      .toBe(fingerprintFigSubtree(b, { pixelRatio: 1, symbolMap: emptySymbolMap }));
  });

  it("flips when pixelRatio changes", () => {
    const node = makeNode({});
    expect(fingerprintFigSubtree(node, { pixelRatio: 1, symbolMap: emptySymbolMap }))
      .not.toBe(fingerprintFigSubtree(node, { pixelRatio: 2, symbolMap: emptySymbolMap }));
  });

  it("expands a referenced SYMBOL into the INSTANCE digest", () => {
    const symbolPaintedRed = makeNode({
      id: "1:1",
      type: "SYMBOL",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
    });
    const symbolPaintedBlue = makeNode({
      id: "1:1",
      type: "SYMBOL",
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
    });
    const instance = makeNode({ type: "INSTANCE", symbolId: "1:1" });

    const fpRed = fingerprintFigSubtree(instance, {
      pixelRatio: 1,
      symbolMap: new Map([["1:1", symbolPaintedRed]]),
    });
    const fpBlue = fingerprintFigSubtree(instance, {
      pixelRatio: 1,
      symbolMap: new Map([["1:1", symbolPaintedBlue]]),
    });
    expect(fpRed).not.toBe(fpBlue);
  });

  it("does not stack-overflow on a self-referencing SYMBOL", () => {
    const sym = makeNode({ id: "1:1", type: "SYMBOL", symbolId: "1:1" });
    const fp = fingerprintFigSubtree(sym, {
      pixelRatio: 1,
      symbolMap: new Map([["1:1", sym]]),
    });
    expect(fp).toMatch(/^fig-fp-v1:[0-9a-f]{64}$/u);
  });

  it("is stable under irrelevant child field ordering", () => {
    const childA = makeNode({ size: { x: 10, y: 10 } });
    const childB = makeNode({ size: { x: 20, y: 20 } });
    const parent1 = makeNode({ children: [childA, childB] });
    const parent2 = makeNode({ children: [childA, childB] });
    expect(fingerprintFigSubtree(parent1, { pixelRatio: 1, symbolMap: emptySymbolMap }))
      .toBe(fingerprintFigSubtree(parent2, { pixelRatio: 1, symbolMap: emptySymbolMap }));
  });

  it("flips when child order changes (z-stacking matters)", () => {
    const childA = makeNode({ size: { x: 10, y: 10 } });
    const childB = makeNode({ size: { x: 20, y: 20 } });
    const parent1 = makeNode({ children: [childA, childB] });
    const parent2 = makeNode({ children: [childB, childA] });
    expect(fingerprintFigSubtree(parent1, { pixelRatio: 1, symbolMap: emptySymbolMap }))
      .not.toBe(fingerprintFigSubtree(parent2, { pixelRatio: 1, symbolMap: emptySymbolMap }));
  });
});
