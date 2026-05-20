/**
 * @file Unit specs for `computePageBounds`.
 */

import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { FIG_NODE_TYPE, type FigNode, type KiwiEnumValue } from "@higma-document-models/fig/types";
import { computePageBounds, type PageBounds } from "./page-bounds";

type Partial2D = {
  readonly localID: number;
  readonly tx: number;
  readonly ty: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
};

const PHASE: KiwiEnumValue = { value: 0, name: "CREATED" };

function fakeNode(spec: Partial2D): FigNode {
  const cos = spec.rotation ? Math.cos(spec.rotation) : 1;
  const sin = spec.rotation ? Math.sin(spec.rotation) : 0;
  return {
    guid: { sessionID: 0, localID: spec.localID },
    phase: PHASE,
    type: { value: NODE_TYPE_VALUES.FRAME, name: FIG_NODE_TYPE.FRAME },
    name: `node-${spec.localID}`,
    visible: true,
    opacity: 1,
    transform: { m00: cos, m01: -sin, m02: spec.tx, m10: sin, m11: cos, m12: spec.ty },
    size: { x: spec.width, y: spec.height },
    fillPaints: [],
    strokePaints: [],
    strokeWeight: 0,
    effects: [],
  };
}

function requirePageBounds(bounds: PageBounds | null): PageBounds {
  if (bounds === null) {
    throw new Error("test expected page bounds");
  }
  return bounds;
}

describe("computePageBounds", () => {
  it("returns null when the page has no children", () => {
    const bounds = computePageBounds([]);
    expect(bounds).toBeNull();
  });

  it("unions axis-aligned children into a single AABB", () => {
    const bounds = requirePageBounds(computePageBounds([
      fakeNode({ localID: 1, tx: 10, ty: 20, width: 100, height: 50 }),
      fakeNode({ localID: 2, tx: 200, ty: 300, width: 80, height: 40 }),
    ]));
    expect(bounds.x).toBe(10);
    expect(bounds.y).toBe(20);
    expect(bounds.width).toBe(280 - 10);
    expect(bounds.height).toBe(340 - 20);
  });

  it("accounts for rotation when computing the bounding box", () => {
    const bounds = requirePageBounds(computePageBounds([
      fakeNode({ localID: 1, tx: 100, ty: 100, width: 100, height: 50, rotation: Math.PI / 2 }),
    ]));
    // A 100×50 rectangle rotated 90° about its top-left corner spans the
    // rectangle (50, 0)–(100, 100) relative to that corner.
    expect(bounds.x).toBeCloseTo(50, 5);
    expect(bounds.y).toBeCloseTo(100, 5);
    expect(bounds.width).toBeCloseTo(50, 5);
    expect(bounds.height).toBeCloseTo(100, 5);
  });
});
