/**
 * @file Unit specs for the Mixed inspector aggregator.
 */

import { NODE_TYPE_VALUES, PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { FIG_NODE_TYPE, type FigNode, type FigNodeType, type FigPaint, type FigSolidPaint, type KiwiEnumValue } from "@higma-document-models/fig/types";
import type { NodeBounds } from "../geometry/node-bounds";
import { summarizeMixedSelection } from "./inspect-summary";

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as const;
const PHASE: KiwiEnumValue = { value: 0, name: "CREATED" };
type EncodedNodeType = Extract<FigNodeType, keyof typeof NODE_TYPE_VALUES>;

function nodeType<T extends EncodedNodeType>(name: T): KiwiEnumValue<T> {
  return { value: NODE_TYPE_VALUES[name], name };
}

function solidFill(color: { r: number; g: number; b: number; a: number }): FigSolidPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    visible: true,
    opacity: 1,
    color,
  };
}

function rectNode(spec: {
  readonly id: string;
  readonly localID: number;
  readonly type?: EncodedNodeType;
  readonly w: number;
  readonly h: number;
  readonly fill?: { r: number; g: number; b: number; a: number };
  readonly opacity?: number;
  readonly visible?: boolean;
}): FigNode {
  const fills = spec.fill ? [solidFill(spec.fill)] : [];
  return {
    guid: { sessionID: 0, localID: spec.localID },
    phase: PHASE,
    type: nodeType(spec.type ?? FIG_NODE_TYPE.RECTANGLE),
    name: spec.id,
    visible: spec.visible ?? true,
    opacity: spec.opacity ?? 1,
    transform: IDENTITY,
    size: { x: spec.w, y: spec.h },
    fillPaints: fills,
    strokePaints: [],
    strokeWeight: 0,
    effects: [],
  };
}

function rectBounds(spec: {
  readonly id: string;
  readonly type?: FigNodeType;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}): NodeBounds {
  return {
    id: spec.id,
    name: spec.id,
    type: spec.type ?? FIG_NODE_TYPE.RECTANGLE,
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
      rectNode({ id: "a", localID: 1, w: 100, h: 50 }),
      rectNode({ id: "b", localID: 2, w: 100, h: 80 }),
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
      rectNode({ id: "a", localID: 1, w: 100, h: 50 }),
      rectNode({ id: "b", localID: 2, w: 100, h: 50 }),
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
      rectNode({ id: "a", localID: 1, w: 10, h: 10, fill: red }),
      rectNode({ id: "b", localID: 2, w: 10, h: 10, fill: red }),
      rectNode({ id: "c", localID: 3, w: 10, h: 10, fill: blue }),
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
    const nodes: FigNode[] = [
      rectNode({ id: "a", localID: 1, type: FIG_NODE_TYPE.TEXT, w: 1, h: 1 }),
      rectNode({ id: "b", localID: 2, type: FIG_NODE_TYPE.FRAME, w: 1, h: 1 }),
      rectNode({ id: "c", localID: 3, type: FIG_NODE_TYPE.FRAME, w: 1, h: 1 }),
      rectNode({ id: "d", localID: 4, type: FIG_NODE_TYPE.TEXT, w: 1, h: 1 }),
      rectNode({ id: "e", localID: 5, type: FIG_NODE_TYPE.TEXT, w: 1, h: 1 }),
    ];
    const bounds = nodes.map((n, i) =>
      rectBounds({ id: `b${i}`, type: n.type.name, x: 0, y: 0, w: 1, h: 1 }),
    );
    const summary = summarizeMixedSelection(nodes, bounds);
    expect(summary.typeCounts.map((t) => t.type)).toEqual(["TEXT", "FRAME"]);
  });

  it("treats sub-pixel size jitter as uniform", () => {
    const nodes = [
      rectNode({ id: "a", localID: 1, w: 100, h: 50 }),
      rectNode({ id: "b", localID: 2, w: 100.0005, h: 50.0001 }),
    ];
    const bounds = nodes.map((n, i) => {
      if (n.size === undefined) {
        throw new Error(`test node ${n.name ?? i} is missing size`);
      }
      return rectBounds({ id: `b${i}`, x: 0, y: 0, w: n.size.x, h: n.size.y });
    });
    const summary = summarizeMixedSelection(nodes, bounds);
    expect(summary.width.kind).toBe("uniform");
    expect(summary.height.kind).toBe("uniform");
  });

  it("flags presence of gradient and image fills", () => {
    const node: FigNode = {
      ...rectNode({ id: "a", localID: 1, w: 10, h: 10 }),
      fillPaints: [
        {
          type: { value: PAINT_TYPE_VALUES.GRADIENT_LINEAR, name: "GRADIENT_LINEAR" },
          visible: true,
          opacity: 1,
          stops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
        },
        {
          type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
          visible: true,
          opacity: 1,
          imageScaleMode: { value: 0, name: "FILL" },
        },
      ] satisfies readonly FigPaint[],
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
