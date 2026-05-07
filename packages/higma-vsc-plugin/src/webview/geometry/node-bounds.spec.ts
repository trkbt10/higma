/**
 * @file Unit specs for `computeNodeBounds`.
 */

import type { FigDesignNode, FigPage } from "@higma-document-models/fig/domain";
import { toNodeId, toPageId } from "@higma-document-models/fig/domain";
import { computeNodeBounds, indexBoundsById } from "./node-bounds";

type FakeNodeSpec = {
  readonly id: string;
  readonly tx: number;
  readonly ty: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
  readonly visible?: boolean;
  readonly children?: readonly FakeNodeSpec[];
};

function fakeNode(spec: FakeNodeSpec): FigDesignNode {
  const cos = spec.rotation ? Math.cos(spec.rotation) : 1;
  const sin = spec.rotation ? Math.sin(spec.rotation) : 0;
  return {
    id: toNodeId(spec.id),
    type: "FRAME",
    name: spec.id,
    visible: spec.visible ?? true,
    opacity: 1,
    transform: { m00: cos, m01: -sin, m02: spec.tx, m10: sin, m11: cos, m12: spec.ty },
    size: { x: spec.width, y: spec.height },
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
    children: spec.children ? spec.children.map(fakeNode) : undefined,
  };
}

function fakePage(children: readonly FakeNodeSpec[]): FigPage {
  return {
    id: toPageId("0:0"),
    name: "Page 1",
    backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
    children: children.map(fakeNode),
  };
}

describe("computeNodeBounds", () => {
  it("emits one entry per node in DFS pre-order", () => {
    const bounds = computeNodeBounds(
      fakePage([
        {
          id: "0:1",
          tx: 0,
          ty: 0,
          width: 200,
          height: 200,
          children: [
            { id: "0:1:1", tx: 10, ty: 10, width: 50, height: 50 },
            { id: "0:1:2", tx: 80, ty: 10, width: 50, height: 50 },
          ],
        },
        { id: "0:2", tx: 300, ty: 0, width: 100, height: 100 },
      ]),
    );
    expect(bounds.map((b) => b.name)).toEqual(["0:1", "0:1:1", "0:1:2", "0:2"]);
    expect(bounds.map((b) => b.depth)).toEqual([0, 1, 1, 0]);
    expect(bounds.map((b) => b.paintOrder)).toEqual([0, 1, 2, 3]);
  });

  it("composes parent and child transforms into world coordinates", () => {
    const bounds = computeNodeBounds(
      fakePage([
        {
          id: "outer",
          tx: 100,
          ty: 200,
          width: 400,
          height: 400,
          children: [{ id: "inner", tx: 30, ty: 40, width: 50, height: 60 }],
        },
      ]),
    );
    const inner = bounds.find((b) => b.name === "inner");
    expect(inner).toBeDefined();
    expect(inner?.x).toBeCloseTo(130, 5);
    expect(inner?.y).toBeCloseTo(240, 5);
    expect(inner?.width).toBeCloseTo(50, 5);
    expect(inner?.height).toBeCloseTo(60, 5);
  });

  it("propagates visibility from ancestors", () => {
    const bounds = computeNodeBounds(
      fakePage([
        {
          id: "hidden-parent",
          tx: 0,
          ty: 0,
          width: 100,
          height: 100,
          visible: false,
          children: [{ id: "child-of-hidden", tx: 0, ty: 0, width: 10, height: 10 }],
        },
      ]),
    );
    const child = bounds.find((b) => b.name === "child-of-hidden");
    expect(child?.visible).toBe(false);
  });

  it("indexes by id for O(1) lookup", () => {
    const bounds = computeNodeBounds(fakePage([{ id: "0:1", tx: 0, ty: 0, width: 10, height: 10 }]));
    const map = indexBoundsById(bounds);
    expect(map.size).toBe(1);
    expect(map.get(toNodeId("0:1"))?.name).toBe("0:1");
  });
});
