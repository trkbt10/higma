/**
 * @file Unit specs for `findNodeAtPoint`.
 */

import type { FigPage } from "@higma-document-models/fig/domain";
import { toPageId, toNodeId } from "@higma-document-models/fig/domain";
import { computeNodeBounds } from "./node-bounds";
import { findNodeAtPoint } from "./hit-test";

function buildPage(): FigPage {
  return {
    id: toPageId("0:0"),
    name: "Page 1",
    backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
    children: [
      {
        id: toNodeId("frame-a"),
        type: "FRAME",
        name: "frame-a",
        visible: true,
        opacity: 1,
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        size: { x: 200, y: 200 },
        fills: [],
        strokes: [],
        strokeWeight: 0,
        effects: [],
        children: [
          {
            id: toNodeId("inner"),
            type: "RECTANGLE",
            name: "inner",
            visible: true,
            opacity: 1,
            transform: { m00: 1, m01: 0, m02: 50, m10: 0, m11: 1, m12: 50 },
            size: { x: 80, y: 80 },
            fills: [],
            strokes: [],
            strokeWeight: 0,
            effects: [],
          },
        ],
      },
      {
        id: toNodeId("frame-b"),
        type: "FRAME",
        name: "frame-b",
        visible: true,
        opacity: 1,
        transform: { m00: 1, m01: 0, m02: 300, m10: 0, m11: 1, m12: 0 },
        size: { x: 100, y: 100 },
        fills: [],
        strokes: [],
        strokeWeight: 0,
        effects: [],
      },
      {
        id: toNodeId("hidden"),
        type: "FRAME",
        name: "hidden",
        visible: false,
        opacity: 1,
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        size: { x: 200, y: 200 },
        fills: [],
        strokes: [],
        strokeWeight: 0,
        effects: [],
      },
    ],
  };
}

describe("findNodeAtPoint", () => {
  it("returns the topmost (deepest, latest-painted) hit", () => {
    const bounds = computeNodeBounds(buildPage());
    const hit = findNodeAtPoint(bounds, { x: 100, y: 100 });
    // `inner` is painted after `frame-a` and contains (100,100), so it wins.
    expect(hit?.name).toBe("inner");
  });

  it("returns the parent when the cursor is outside the child's AABB", () => {
    const bounds = computeNodeBounds(buildPage());
    const hit = findNodeAtPoint(bounds, { x: 10, y: 10 });
    expect(hit?.name).toBe("frame-a");
  });

  it("returns null when no node contains the point", () => {
    const bounds = computeNodeBounds(buildPage());
    const hit = findNodeAtPoint(bounds, { x: 1000, y: 1000 });
    expect(hit).toBeNull();
  });

  it("ignores invisible ancestors", () => {
    const bounds = computeNodeBounds(buildPage());
    // `hidden` covers (0,0)–(200,200). `frame-a` also covers that area,
    // but `hidden` is painted after frame-a → would win if visible.
    // Because hidden is not visible, frame-a wins.
    const hit = findNodeAtPoint(bounds, { x: 5, y: 5 });
    expect(hit?.name).toBe("frame-a");
  });
});
