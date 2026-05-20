/**
 * @file Spec for the complexity-threshold rasterisation planner.
 *
 * Locks in `planRasterization`'s contract:
 *   1. Nodes whose subtree complexity score < threshold pass
 *      through unchanged — the emitter renders them as ordinary
 *      SwiftUI views.
 *   2. Nodes whose score crosses the threshold are flagged and
 *      the planner stops recursing into their descendants — the
 *      whole subtree becomes one PNG.
 *   3. Nodes without authored size are skipped (the WebGL harness
 *      can't render an intrinsic-size box).
 *   4. Resource slugs are unique even when two nodes share a name.
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import { complexityScore } from "@higma-document-renderers/fig/asset-plan";
import { createSymbolResolver } from "@higma-document-models/fig/symbols";
import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { planRasterization } from "./rasterize";

const FIXTURE_SYMBOL_RESOLVER = createSymbolResolver({
  document: indexFigKiwiDocument([]),
});
const childrenOfFixtureNode = FIXTURE_SYMBOL_RESOLVER.childrenOfResolvedNode;

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function frame(overrides: Partial<FigNode> & { readonly localID: number }): FigNode {
  const { localID, ...partial } = overrides;
  return {
    guid: { sessionID: 1, localID },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    ...partial,
  } as FigNode;
}

describe("complexityScore", () => {
  it("returns 1 for a sized leaf with no geometry", () => {
    const node = frame({ localID: 1, size: { x: 10, y: 10 } });
    expect(complexityScore(node, { childrenOf: childrenOfFixtureNode })).toBe(1);
  });

  it("counts each visible descendant as 1", () => {
    const child1 = frame({ localID: 2, size: { x: 5, y: 5 } });
    const child2 = frame({ localID: 3, size: { x: 5, y: 5 } });
    const parent = frame({
      localID: 1,
      size: { x: 10, y: 10 },
      children: [child1, child2],
    });
    // 1 (parent) + 1 (child1) + 1 (child2) = 3
    expect(complexityScore(parent, { childrenOf: childrenOfFixtureNode })).toBe(3);
  });
});

describe("planRasterization", () => {
  it("returns no entries when nothing crosses the threshold", () => {
    const node = frame({ localID: 1, size: { x: 100, y: 100 } });
    const plan = planRasterization([node], { threshold: 100, childrenOf: childrenOfFixtureNode });
    expect(plan).toHaveLength(0);
  });

  it("flags a node when its subtree score >= threshold", () => {
    const grandchild1 = frame({ localID: 3, size: { x: 5, y: 5 } });
    const grandchild2 = frame({ localID: 4, size: { x: 5, y: 5 } });
    const grandchild3 = frame({ localID: 5, size: { x: 5, y: 5 } });
    const child = frame({
      localID: 2,
      size: { x: 50, y: 50 },
      children: [grandchild1, grandchild2, grandchild3],
    });
    const root = frame({
      localID: 1,
      size: { x: 100, y: 100 },
      children: [child],
    });
    // root subtree score: 1+1+1+1+1 = 5. With threshold=5 the
    // root crosses and is flagged; the planner stops there and
    // does not flag the inner child.
    const plan = planRasterization([root], { threshold: 5, childrenOf: childrenOfFixtureNode });
    expect(plan).toHaveLength(1);
    expect(plan[0]?.key).toBe("1:1");
    expect(plan[0]?.width).toBe(100);
    expect(plan[0]?.height).toBe(100);
  });

  it("stops recursing once a parent is flagged (no double-rasterisation)", () => {
    const child = frame({ localID: 2, size: { x: 50, y: 50 } });
    const root = frame({
      localID: 1,
      size: { x: 100, y: 100 },
      children: [child],
    });
    const plan = planRasterization([root], { threshold: 1, childrenOf: childrenOfFixtureNode });
    // Both root and child cross threshold=1, but the planner
    // returns just the root — children inherit the bitmap.
    expect(plan).toHaveLength(1);
    expect(plan[0]?.key).toBe("1:1");
  });

  it("skips nodes without authored size and recurses into their children", () => {
    const sizedChild = frame({ localID: 2, size: { x: 50, y: 50 } });
    const unsizedRoot = frame({
      localID: 1,
      // No `size` — can't be rendered as a standalone PNG.
      children: [sizedChild],
    });
    const plan = planRasterization([unsizedRoot], { threshold: 1, childrenOf: childrenOfFixtureNode });
    // The planner recurses past the unsized root and flags the
    // sized child instead.
    expect(plan).toHaveLength(1);
    expect(plan[0]?.key).toBe("1:2");
  });

  it("assigns unique slugs when two nodes share a name", () => {
    const a = frame({ localID: 1, name: "card", size: { x: 50, y: 50 } });
    const b = frame({ localID: 2, name: "card", size: { x: 50, y: 50 } });
    const plan = planRasterization([a, b], { threshold: 1, childrenOf: childrenOfFixtureNode });
    expect(plan).toHaveLength(2);
    expect(plan[0]?.resourceSlug).toBe("card");
    // `uniqueId` from @higma-primitives/identifier appends "-N"
    // for collisions (CSS-slug-safe).
    expect(plan[1]?.resourceSlug).toBe("card-2");
  });

  it("derives slug from the node's name (CSS-safe)", () => {
    const node = frame({
      localID: 7,
      name: "Card 03 — Hearts",
      size: { x: 50, y: 50 },
    });
    const plan = planRasterization([node], { threshold: 1, childrenOf: childrenOfFixtureNode });
    expect(plan[0]?.resourceSlug).toMatch(/^card-03/);
  });
});
