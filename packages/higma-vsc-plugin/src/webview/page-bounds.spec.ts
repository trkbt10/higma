/**
 * @file Unit specs for `computePageBounds`.
 */

import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { toNodeId } from "@higma-document-models/fig/domain";
import { computePageBounds } from "./page-bounds";

type Partial2D = {
  readonly id: string;
  readonly tx: number;
  readonly ty: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
};

function fakeNode(spec: Partial2D): FigDesignNode {
  const cos = spec.rotation ? Math.cos(spec.rotation) : 1;
  const sin = spec.rotation ? Math.sin(spec.rotation) : 0;
  return {
    id: toNodeId(spec.id),
    type: "FRAME",
    name: spec.id,
    visible: true,
    opacity: 1,
    transform: { m00: cos, m01: -sin, m02: spec.tx, m10: sin, m11: cos, m12: spec.ty },
    size: { x: spec.width, y: spec.height },
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
  };
}

describe("computePageBounds", () => {
  it("returns a fallback rectangle when the page has no children", () => {
    const bounds = computePageBounds([]);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
  });

  it("unions axis-aligned children into a single AABB", () => {
    const bounds = computePageBounds([
      fakeNode({ id: "0:1", tx: 10, ty: 20, width: 100, height: 50 }),
      fakeNode({ id: "0:2", tx: 200, ty: 300, width: 80, height: 40 }),
    ]);
    expect(bounds.x).toBe(10);
    expect(bounds.y).toBe(20);
    expect(bounds.width).toBe(280 - 10);
    expect(bounds.height).toBe(340 - 20);
  });

  it("accounts for rotation when computing the bounding box", () => {
    const bounds = computePageBounds([
      fakeNode({ id: "0:1", tx: 100, ty: 100, width: 100, height: 50, rotation: Math.PI / 2 }),
    ]);
    // A 100×50 rectangle rotated 90° about its top-left corner spans the
    // rectangle (50, 0)–(100, 100) relative to that corner.
    expect(bounds.x).toBeCloseTo(50, 5);
    expect(bounds.y).toBeCloseTo(100, 5);
    expect(bounds.width).toBeCloseTo(50, 5);
    expect(bounds.height).toBeCloseTo(100, 5);
  });
});
