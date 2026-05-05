/** @file Vector path editor-model domain tests. */

import type { FigDesignBlob, FigDesignDocument, FigDesignNode, FigNodeId } from "@higma-document-models/fig/domain";
import {
  addVectorPathPoint,
  canEnterVectorPathEdit,
  collectVectorPathHandles,
  resolveEditableVectorPaths,
  updateVectorPathEndpoint,
} from "./editor-model";

function f32(value: number): readonly number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return Array.from(bytes);
}

function encodeM(x: number, y: number): readonly number[] {
  return [0x01, ...f32(x), ...f32(y)];
}

function encodeL(x: number, y: number): readonly number[] {
  return [0x02, ...f32(x), ...f32(y)];
}

function encodeZ(): readonly number[] {
  return [0x06];
}

function makeNode(type: FigDesignNode["type"], overrides: Partial<FigDesignNode> = {}): FigDesignNode {
  return {
    id: `${type.toLowerCase()}:1` as FigNodeId,
    type,
    name: type,
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
    size: { x: 100, y: 80 },
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
    ...overrides,
  };
}

function createBlobBackedVectorFixture(): {
  readonly document: FigDesignDocument;
  readonly vector: FigDesignNode;
  readonly blobs: readonly FigDesignBlob[];
} {
  const vector = makeNode("VECTOR", {
    id: "0:2" as FigNodeId,
    vectorPaths: undefined,
    fillGeometry: [{ commandsBlob: 0, windingRule: { name: "NONZERO", value: 1 } }],
  });
  const document: FigDesignDocument = {
    pages: [{
      id: "0:1" as FigNodeId,
      name: "Page",
      backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
      children: [vector],
    }],
    components: new Map(),
    images: new Map(),
    blobs: [{ bytes: [...encodeM(0, 0), ...encodeL(100, 0), ...encodeL(100, 80), ...encodeZ()] }],
    metadata: null,
    styleRegistry: { fills: new Map(), strokes: new Map(), effects: new Map(), texts: new Map() },
  };
  return { document, vector, blobs: document.blobs };
}

describe("vector path editor-model", () => {
  it("exposes basic shapes as editable paths without storing duplicate vector data", () => {
    for (const type of ["RECTANGLE", "ROUNDED_RECTANGLE", "ELLIPSE", "LINE", "REGULAR_POLYGON", "STAR"] as const) {
      const node = makeNode(type, type === "ROUNDED_RECTANGLE" ? { cornerRadius: 12 } : {});

      expect(canEnterVectorPathEdit(node)).toBe(true);
      expect(resolveEditableVectorPaths(node)?.length).toBe(1);
      expect(node.vectorPaths).toBeUndefined();
    }
  });

  it("materializes basic shape endpoints as vector path edits instead of bounding-box resizes", () => {
    for (const type of ["RECTANGLE", "ELLIPSE", "REGULAR_POLYGON"] as const) {
      const node = makeNode(type, {
        pointCount: type === "REGULAR_POLYGON" ? 6 : undefined,
      });
      const initialPaths = resolveEditableVectorPaths(node);
      const next = updateVectorPathEndpoint({
        node,
        pathIndex: 0,
        commandIndex: 1,
        valueIndex: 0,
        point: { x: 130, y: 90 },
        editableVectorPaths: initialPaths,
      });

      expect(next.type).toBe("VECTOR");
      expect(next.vectorPaths?.length).toBe(1);
      expect(next.vectorPaths?.[0]?.data).not.toBe(initialPaths?.[0]?.data);
      expect(next.size).toEqual(node.size);
      expect(next.pointCount).toBeUndefined();
      expect(next.cornerRadius).toBeUndefined();
      expect(next.rectangleCornerRadii).toBeUndefined();
    }
  });

  it("converts basic shapes to explicit vectors only when topology changes", () => {
    for (const type of ["RECTANGLE", "ROUNDED_RECTANGLE", "ELLIPSE", "LINE", "REGULAR_POLYGON", "STAR"] as const) {
      const node = makeNode(type, {
        cornerRadius: type === "ROUNDED_RECTANGLE" ? 12 : undefined,
        rectangleCornerRadii: type === "RECTANGLE" ? [1, 2, 3, 4] : undefined,
        pointCount: type === "REGULAR_POLYGON" || type === "STAR" ? 5 : undefined,
        starInnerScale: type === "STAR" ? 0.4 : undefined,
      });
      const next = addVectorPathPoint({ node, pathIndex: 0, point: { x: 40, y: 20 } });

      expect(next.type).toBe("VECTOR");
      expect(next.vectorPaths?.length).toBe(1);
      expect(next.cornerRadius).toBeUndefined();
      expect(next.rectangleCornerRadii).toBeUndefined();
      expect(next.pointCount).toBeUndefined();
      expect(next.starInnerRadius).toBeUndefined();
      expect(next.starInnerScale).toBeUndefined();
    }
  });

  it("keeps explicit vectors explicit through endpoint edits and point insertion", () => {
    const vector = makeNode("VECTOR", {
      vectorPaths: [{ windingRule: "NONZERO", data: "M 0 0 L 100 0 L 100 80 Z" }],
    });
    const moved = updateVectorPathEndpoint({
      node: vector,
      pathIndex: 0,
      commandIndex: 1,
      valueIndex: 0,
      point: { x: 120, y: 10 },
    });
    const inserted = addVectorPathPoint({ node: moved, pathIndex: 0, point: { x: 60, y: 4 } });

    expect(moved.type).toBe("VECTOR");
    expect(inserted.type).toBe("VECTOR");
    expect(inserted.vectorPaths?.[0]?.data).not.toBe(vector.vectorPaths?.[0]?.data);
    expect((inserted.vectorPaths?.[0]?.data ?? "").split(" L ")).toHaveLength(4);
  });

  it("does not make containers path-edit targets even when imported fig data carries vectorPaths", () => {
    const child = makeNode("VECTOR", {
      id: "child" as FigNodeId,
      transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 20 },
      vectorPaths: [{ windingRule: "NONZERO", data: "M 0 0 L 40 0 L 40 30 Z" }],
    });
    const frame = makeNode("FRAME", {
      id: "frame" as FigNodeId,
      size: { x: 100, y: 80 },
      vectorPaths: [{ windingRule: "NONZERO", data: "M 0 0 L 100 0 L 100 80 Z" }],
      children: [child],
    });

    expect(canEnterVectorPathEdit(frame)).toBe(false);
    expect(resolveEditableVectorPaths(frame)).toBeUndefined();
    expect(collectVectorPathHandles(frame, { children: [frame] })).toEqual([]);
    expect(canEnterVectorPathEdit(child)).toBe(true);
  });

  it("edits a parsed VECTOR backed by fillGeometry blobs", () => {
    const { vector, blobs } = createBlobBackedVectorFixture();

    expect(vector.vectorPaths).toBeUndefined();
    expect(vector.fillGeometry?.length ?? vector.strokeGeometry?.length ?? 0).toBeGreaterThan(0);
    expect(canEnterVectorPathEdit(vector)).toBe(true);

    const paths = resolveEditableVectorPaths(vector, blobs);
    expect(paths?.length).toBeGreaterThan(0);
    expect(paths?.[0]?.data).toMatch(/^M/);

    const edited = addVectorPathPoint({
      node: vector,
      pathIndex: 0,
      point: { x: vector.size.x / 2, y: vector.size.y / 2 },
      editableVectorPaths: paths,
    });

    expect(edited.type).toBe("VECTOR");
    expect(edited.vectorPaths?.length).toBeGreaterThan(0);
    expect(edited.vectorPaths?.[0]?.data).not.toBe(paths?.[0]?.data);
    expect(edited.fillGeometry).toBeUndefined();
    expect(edited.strokeGeometry).toBeUndefined();
  });
});
