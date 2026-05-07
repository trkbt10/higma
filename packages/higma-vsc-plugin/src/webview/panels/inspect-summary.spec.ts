/**
 * @file Unit specs for the Mixed inspector aggregator.
 */

import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { toNodeId } from "@higma-document-models/fig/domain";
import type { NodeBounds } from "../geometry/node-bounds";
import { summarizeMixedSelection } from "./inspect-summary";

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as const;

function solidFill(color: { r: number; g: number; b: number; a: number }) {
  return {
    type: "SOLID" as const,
    visible: true,
    opacity: 1,
    blendMode: "NORMAL" as const,
    color,
  };
}

function rectNode(spec: {
  readonly id: string;
  readonly type?: FigDesignNode["type"];
  readonly w: number;
  readonly h: number;
  readonly fill?: { r: number; g: number; b: number; a: number };
  readonly opacity?: number;
  readonly visible?: boolean;
}): FigDesignNode {
  const fills = spec.fill ? [solidFill(spec.fill)] : [];
  return {
    id: toNodeId(spec.id),
    type: spec.type ?? "RECTANGLE",
    name: spec.id,
    visible: spec.visible ?? true,
    opacity: spec.opacity ?? 1,
    transform: IDENTITY,
    size: { x: spec.w, y: spec.h },
    fills,
    strokes: [],
    strokeWeight: 0,
    effects: [],
  };
}

function rectBounds(spec: {
  readonly id: string;
  readonly type?: FigDesignNode["type"];
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}): NodeBounds {
  return {
    id: toNodeId(spec.id),
    name: spec.id,
    type: spec.type ?? "RECTANGLE",
    x: spec.x,
    y: spec.y,
    width: spec.w,
    height: spec.h,
    localWidth: spec.w,
    localHeight: spec.h,
    worldTransform: IDENTITY,
    depth: 0,
    parentId: null,
    paintOrder: 0,
    visible: true,
  };
}

describe("summarizeMixedSelection", () => {
  it("counts nodes and reports a uniform width when every node agrees", () => {
    const nodes = [
      rectNode({ id: "a", w: 100, h: 50 }),
      rectNode({ id: "b", w: 100, h: 80 }),
    ];
    const bounds = [
      rectBounds({ id: "a", x: 0, y: 0, w: 100, h: 50 }),
      rectBounds({ id: "b", x: 200, y: 200, w: 100, h: 80 }),
    ];
    const summary = summarizeMixedSelection(nodes, bounds);
    expect(summary.count).toBe(2);
    expect(summary.width).toEqual({ kind: "uniform", value: 100 });
    expect(summary.height.kind).toBe("mixed");
    if (summary.height.kind === "mixed") {
      expect(summary.height.min).toBe(50);
      expect(summary.height.max).toBe(80);
    }
  });

  it("computes the union AABB across selected bounds", () => {
    const nodes = [
      rectNode({ id: "a", w: 100, h: 50 }),
      rectNode({ id: "b", w: 100, h: 50 }),
    ];
    const bounds = [
      rectBounds({ id: "a", x: 10, y: 20, w: 100, h: 50 }),
      rectBounds({ id: "b", x: 200, y: 100, w: 100, h: 50 }),
    ];
    const summary = summarizeMixedSelection(nodes, bounds);
    expect(summary.union).toEqual({ x: 10, y: 20, width: 290, height: 130 });
  });

  it("groups solid fills by hex+alpha and counts duplicates", () => {
    const red = { r: 1, g: 0, b: 0, a: 1 };
    const blue = { r: 0, g: 0, b: 1, a: 1 };
    const nodes = [
      rectNode({ id: "a", w: 10, h: 10, fill: red }),
      rectNode({ id: "b", w: 10, h: 10, fill: red }),
      rectNode({ id: "c", w: 10, h: 10, fill: blue }),
    ];
    const bounds = nodes.map((n, i) =>
      rectBounds({ id: `b${i}`, x: 0, y: 0, w: 10, h: 10 }),
    );
    const summary = summarizeMixedSelection(nodes, bounds);
    expect(summary.solidFills).toHaveLength(2);
    expect(summary.solidFills[0]?.hex).toBe("#FF0000");
    expect(summary.solidFills[0]?.count).toBe(2);
    expect(summary.solidFills[1]?.hex).toBe("#0000FF");
    expect(summary.solidFills[1]?.count).toBe(1);
  });

  it("orders the type histogram by descending count then alphabetically", () => {
    const nodes: FigDesignNode[] = [
      rectNode({ id: "a", type: "TEXT", w: 1, h: 1 }),
      rectNode({ id: "b", type: "FRAME", w: 1, h: 1 }),
      rectNode({ id: "c", type: "FRAME", w: 1, h: 1 }),
      rectNode({ id: "d", type: "TEXT", w: 1, h: 1 }),
      rectNode({ id: "e", type: "TEXT", w: 1, h: 1 }),
    ];
    const bounds = nodes.map((n, i) =>
      rectBounds({ id: `b${i}`, type: n.type, x: 0, y: 0, w: 1, h: 1 }),
    );
    const summary = summarizeMixedSelection(nodes, bounds);
    expect(summary.typeCounts.map((t) => t.type)).toEqual(["TEXT", "FRAME"]);
  });

  it("treats sub-pixel size jitter as uniform", () => {
    const nodes = [
      rectNode({ id: "a", w: 100, h: 50 }),
      rectNode({ id: "b", w: 100.0005, h: 50.0001 }),
    ];
    const bounds = nodes.map((n, i) =>
      rectBounds({ id: `b${i}`, x: 0, y: 0, w: n.size.x, h: n.size.y }),
    );
    const summary = summarizeMixedSelection(nodes, bounds);
    expect(summary.width.kind).toBe("uniform");
    expect(summary.height.kind).toBe("uniform");
  });

  it("flags presence of gradient and image fills", () => {
    const node: FigDesignNode = {
      ...rectNode({ id: "a", w: 10, h: 10 }),
      fills: [
        {
          type: "GRADIENT_LINEAR",
          visible: true,
          opacity: 1,
          blendMode: "NORMAL",
          stops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
          gradientHandlePositions: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
        },
        {
          type: "IMAGE",
          visible: true,
          opacity: 1,
          blendMode: "NORMAL",
          imageRef: "img",
          scaleMode: "FILL",
        },
      ],
    };
    const summary = summarizeMixedSelection(
      [node],
      [rectBounds({ id: "a", x: 0, y: 0, w: 10, h: 10 })],
    );
    expect(summary.hasGradientFill).toBe(true);
    expect(summary.hasImageFill).toBe(true);
    expect(summary.solidFills).toHaveLength(0);
  });
});
