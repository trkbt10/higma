/** @file Unit specs for marquee rect math and intersection. */

import type { NodeBounds } from "./node-bounds";
import { buildMarqueeRect, findTopLevelIdsInRect } from "./marquee";

function bounds(args: {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth?: number;
  readonly visible?: boolean;
}): NodeBounds {
  return {
    id: args.id,
    name: args.id,
    type: "RECTANGLE",
    x: args.x,
    y: args.y,
    width: args.width,
    height: args.height,
    localWidth: args.width,
    localHeight: args.height,
    worldTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    depth: args.depth ?? 0,
    parentId: null,
    paintOrder: 0,
    visible: args.visible ?? true,
  };
}

describe("buildMarqueeRect", () => {
  it("normalises a top-left → bottom-right drag", () => {
    expect(buildMarqueeRect({ x: 10, y: 20 }, { x: 50, y: 80 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it("normalises a reversed-corner drag", () => {
    expect(buildMarqueeRect({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it("normalises a mixed-axis drag", () => {
    expect(buildMarqueeRect({ x: 50, y: 20 }, { x: 10, y: 80 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it("produces a zero-extent rect for identical points", () => {
    expect(buildMarqueeRect({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe("findTopLevelIdsInRect", () => {
  it("returns ids whose AABB is fully contained", () => {
    const result = findTopLevelIdsInRect(
      [bounds({ id: "a", x: 10, y: 10, width: 20, height: 20 })],
      { x: 0, y: 0, width: 100, height: 100 },
    );
    expect(result).toEqual(["a"]);
  });

  it("returns ids whose AABB partially overlaps the rect", () => {
    const result = findTopLevelIdsInRect(
      [bounds({ id: "a", x: 80, y: 80, width: 40, height: 40 })],
      { x: 0, y: 0, width: 100, height: 100 },
    );
    expect(result).toEqual(["a"]);
  });

  it("includes ids whose edge merely touches the rect", () => {
    const result = findTopLevelIdsInRect(
      [bounds({ id: "a", x: 100, y: 0, width: 50, height: 50 })],
      { x: 0, y: 0, width: 100, height: 100 },
    );
    expect(result).toEqual(["a"]);
  });

  it("skips ids whose AABB is fully outside", () => {
    const result = findTopLevelIdsInRect(
      [bounds({ id: "a", x: 200, y: 200, width: 10, height: 10 })],
      { x: 0, y: 0, width: 100, height: 100 },
    );
    expect(result).toEqual([]);
  });

  it("filters out hidden bounds", () => {
    const result = findTopLevelIdsInRect(
      [bounds({ id: "a", x: 10, y: 10, width: 20, height: 20, visible: false })],
      { x: 0, y: 0, width: 100, height: 100 },
    );
    expect(result).toEqual([]);
  });

  it("filters out non-top-level (depth > 0) bounds", () => {
    const result = findTopLevelIdsInRect(
      [
        bounds({ id: "a", x: 10, y: 10, width: 20, height: 20, depth: 0 }),
        bounds({ id: "b-child", x: 12, y: 12, width: 4, height: 4, depth: 1 }),
      ],
      { x: 0, y: 0, width: 100, height: 100 },
    );
    expect(result).toEqual(["a"]);
  });

  it("preserves painter order so the trailing id can drive primary selection", () => {
    const result = findTopLevelIdsInRect(
      [
        bounds({ id: "first", x: 0, y: 0, width: 10, height: 10 }),
        bounds({ id: "second", x: 5, y: 5, width: 10, height: 10 }),
        bounds({ id: "third", x: 8, y: 8, width: 10, height: 10 }),
      ],
      { x: 0, y: 0, width: 100, height: 100 },
    );
    expect(result).toEqual(["first", "second", "third"]);
  });
});
