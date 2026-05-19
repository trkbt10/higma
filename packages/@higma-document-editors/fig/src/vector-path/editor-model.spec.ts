/** @file Kiwi vector path editor-model tests. */

import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import {
  canEnterVectorPathEdit,
  collectVectorPathHandles,
  findNearestVectorHandle,
  resolveEditableVectorPaths,
  updateVectorPathEndpoint,
  worldToLocalPoint,
} from "./editor-model";

function guid(localID: number): FigGuid {
  return { sessionID: 73, localID };
}

function vectorNode(): FigNode {
  return {
    guid: guid(1),
    phase: { value: 0, name: "PAINT" },
    type: { value: NODE_TYPE_VALUES.VECTOR, name: "VECTOR" },
    name: "Vector",
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
    size: { x: 100, y: 80 },
    vectorPaths: [{ windingRule: "NONZERO", data: "M 0 0 L 100 0 L 100 80 Z" }],
  };
}

describe("vector path editor-model", () => {
  it("exposes Kiwi vector paths and editable basic shape outlines", () => {
    const vector = vectorNode();
    const frame: FigNode = {
      ...vector,
      guid: guid(2),
      type: { value: NODE_TYPE_VALUES.FRAME, name: "FRAME" },
      vectorPaths: undefined,
    };
    const rectangle: FigNode = {
      ...vector,
      guid: guid(3),
      type: { value: NODE_TYPE_VALUES.RECTANGLE, name: "RECTANGLE" },
    };

    expect(canEnterVectorPathEdit(vector)).toBe(true);
    expect(resolveEditableVectorPaths(vector)).toBe(vector.vectorPaths);
    expect(canEnterVectorPathEdit(rectangle)).toBe(true);
    expect(canEnterVectorPathEdit(frame)).toBe(false);
  });

  it("collects command handles from committed vector paths", () => {
    const vector = vectorNode();
    const handles = collectVectorPathHandles(vector, undefined, resolveEditableVectorPaths(vector));

    expect(handles.map((handle) => handle.role)).toEqual(["anchor", "anchor", "anchor"]);
    expect(handles[0]).toMatchObject({ key: "0:0:0", nodeGuid: vector.guid, x: 0, y: 0 });
  });

  it("updates a command endpoint without creating a second node representation", () => {
    const vector = vectorNode();
    const next = updateVectorPathEndpoint({
      node: vector,
      pathIndex: 0,
      commandIndex: 1,
      point: { x: 120, y: 10 },
    });

    expect(next.type).toEqual(vector.type);
    expect(next.vectorPaths?.[0].data).toBe("M 0 0 L 120 10 L 100 80 Z");
  });

  it("finds the nearest handle and converts page coordinates to local coordinates", () => {
    const vector = vectorNode();
    const handles = collectVectorPathHandles(vector, undefined, resolveEditableVectorPaths(vector));
    const nearest = findNearestVectorHandle(handles, { x: 96, y: 5 });
    const local = worldToLocalPoint({ m00: 2, m01: 0, m02: 10, m10: 0, m11: 2, m12: 20 }, { x: 30, y: 60 });

    expect(nearest?.x).toBe(100);
    expect(local).toEqual({ x: 10, y: 20 });
  });

  it("throws for non-invertible transforms", () => {
    expect(() => worldToLocalPoint({ m00: 0, m01: 0, m02: 0, m10: 0, m11: 0, m12: 0 }, { x: 1, y: 1 })).toThrow(
      "worldToLocalPoint requires an invertible transform",
    );
  });
});
