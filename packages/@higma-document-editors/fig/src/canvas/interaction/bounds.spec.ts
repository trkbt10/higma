/** @file Bounds computation tests over Kiwi FigNode values. */

import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigGuid, FigMatrix, FigNode } from "@higma-document-models/fig/types";
import {
  computeAbsoluteNodeBounds,
  computeAbsoluteTransform,
  containsPointInBounds,
  filterMarqueeSelectionByHierarchy,
  flattenAllNodeBounds,
} from "./bounds";

function guid(localID: number): FigGuid {
  return { sessionID: 70, localID };
}

function matrix(x: number, y: number, rotation = 0): FigMatrix {
  if (rotation === 0) {
    return { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y };
  }
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { m00: cos, m01: -sin, m02: x, m10: sin, m11: cos, m12: y };
}

function figNode(
  localID: number,
  options: {
    readonly type?: "FRAME" | "GROUP" | "RECTANGLE";
    readonly parent?: FigGuid;
    readonly position?: string;
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
    readonly rotation?: number;
    readonly visible?: boolean;
  } = {},
): FigNode {
  const type = options.type ?? "RECTANGLE";
  return {
    guid: guid(localID),
    phase: { value: 0, name: "PAINT" },
    type: { value: NODE_TYPE_VALUES[type], name: type },
    name: `${type}-${localID}`,
    parentIndex: options.parent === undefined ? undefined : { guid: options.parent, position: options.position ?? "a" },
    visible: options.visible ?? true,
    opacity: 1,
    transform: matrix(options.x ?? 0, options.y ?? 0, options.rotation),
    size: { x: options.width ?? 100, y: options.height ?? 50 },
  };
}

function documentOf(nodes: readonly FigNode[]) {
  return indexFigKiwiDocument(nodes);
}

describe("containsPointInBounds", () => {
  it("accepts points inside and on the edge", () => {
    const bounds = { x: 10, y: 20, width: 30, height: 40 };

    expect(containsPointInBounds(bounds, { x: 10, y: 20 })).toBe(true);
    expect(containsPointInBounds(bounds, { x: 25, y: 35 })).toBe(true);
    expect(containsPointInBounds(bounds, { x: 40, y: 60 })).toBe(true);
  });

  it("rejects points outside", () => {
    const bounds = { x: 10, y: 20, width: 30, height: 40 };

    expect(containsPointInBounds(bounds, { x: 9.9, y: 20 })).toBe(false);
    expect(containsPointInBounds(bounds, { x: 10, y: 60.1 })).toBe(false);
  });
});

describe("Kiwi node bounds", () => {
  it("flattens visible nodes in document order with absolute coordinates", () => {
    const frame = figNode(1, { type: "FRAME", x: 100, y: 50, width: 200, height: 100 });
    const child = figNode(2, { parent: frame.guid, x: 20, y: 30, width: 50, height: 25 });
    const hidden = figNode(3, { parent: frame.guid, position: "b", visible: false });
    const doc = documentOf([frame, child, hidden]);
    const bounds = flattenAllNodeBounds(doc, doc.roots);

    expect(bounds.map((item) => item.id)).toEqual(["70:1", "70:2"]);
    expect(bounds[0]).toMatchObject({ x: 100, y: 50, width: 200, height: 100 });
    expect(bounds[1]).toMatchObject({ x: 120, y: 80, width: 50, height: 25 });
  });

  it("composes nested transforms for absolute lookup", () => {
    const parent = figNode(1, { type: "FRAME", x: 100, y: 50 });
    const child = figNode(2, { type: "GROUP", parent: parent.guid, x: 20, y: 30 });
    const grandchild = figNode(3, { parent: child.guid, x: 5, y: 10, width: 10, height: 10 });
    const doc = documentOf([parent, child, grandchild]);
    const transform = computeAbsoluteTransform(doc, grandchild.guid, doc.roots);
    const bounds = computeAbsoluteNodeBounds(doc, grandchild.guid, doc.roots);

    expect(transform?.m02).toBe(125);
    expect(transform?.m12).toBe(90);
    expect(bounds).toMatchObject({ x: 125, y: 90, width: 10, height: 10 });
  });

  it("keeps flattened bounds and direct absolute bounds aligned for rotation", () => {
    const parent = figNode(1, { type: "FRAME", x: 200, y: 100 });
    const child = figNode(2, { parent: parent.guid, x: 10, y: 5, width: 20, height: 15, rotation: 30 });
    const doc = documentOf([parent, child]);
    const flattened = flattenAllNodeBounds(doc, doc.roots).find((item) => item.id === "70:2");
    const absolute = computeAbsoluteNodeBounds(doc, child.guid, doc.roots);

    expect(flattened?.x).toBeCloseTo(absolute?.x ?? 0, 10);
    expect(flattened?.y).toBeCloseTo(absolute?.y ?? 0, 10);
    expect(flattened?.rotation).toBeCloseTo(absolute?.rotation ?? 0, 10);
  });

  it("removes selected ancestors when a descendant is also selected", () => {
    const frame = figNode(1, { type: "FRAME" });
    const child = figNode(2, { parent: frame.guid });
    const doc = documentOf([frame, child]);

    expect(filterMarqueeSelectionByHierarchy(doc, ["70:1", "70:2"])).toEqual(["70:2"]);
    expect(filterMarqueeSelectionByHierarchy(doc, ["70:1"])).toEqual(["70:1"]);
  });
});
