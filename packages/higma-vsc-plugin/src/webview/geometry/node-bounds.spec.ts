/**
 * @file Unit specs for `computeNodeBounds`.
 */

import { guidToString, indexFigKiwiDocument, type FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { FIG_NODE_TYPE, type FigGuid, type FigNode, type FigNodeType, type KiwiEnumValue } from "@higma-document-models/fig/types";
import { computeNodeBounds, indexBoundsById } from "./node-bounds";

type FakeNodeSpec = {
  readonly localID: number;
  readonly name: string;
  readonly tx: number;
  readonly ty: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
  readonly visible?: boolean;
  readonly children?: readonly FakeNodeSpec[];
};

type FakeDocument = {
  readonly page: FigNode;
  readonly document: FigKiwiDocumentIndex;
};

const PHASE: KiwiEnumValue = { value: 0, name: "CREATED" };
type EncodedNodeType = Extract<FigNodeType, keyof typeof NODE_TYPE_VALUES>;

function figGuid(localID: number): FigGuid {
  return { sessionID: 0, localID };
}

function nodeType<T extends EncodedNodeType>(name: T): KiwiEnumValue<T> {
  return { value: NODE_TYPE_VALUES[name], name };
}

function fakeNodeChanges(spec: FakeNodeSpec, parentGuid: FigGuid, position: number): readonly FigNode[] {
  const cos = spec.rotation ? Math.cos(spec.rotation) : 1;
  const sin = spec.rotation ? Math.sin(spec.rotation) : 0;
  const guid = figGuid(spec.localID);
  const node: FigNode = {
    guid,
    phase: PHASE,
    type: nodeType(FIG_NODE_TYPE.FRAME),
    name: spec.name,
    visible: spec.visible ?? true,
    opacity: 1,
    parentIndex: { guid: parentGuid, position: position.toString().padStart(6, "0") },
    transform: { m00: cos, m01: -sin, m02: spec.tx, m10: sin, m11: cos, m12: spec.ty },
    size: { x: spec.width, y: spec.height },
    fillPaints: [],
    strokePaints: [],
    strokeWeight: 0,
    effects: [],
  };
  const descendants = (spec.children ?? []).flatMap((child, index) => fakeNodeChanges(child, guid, index));
  return [node, ...descendants];
}

function fakeDocument(children: readonly FakeNodeSpec[]): FakeDocument {
  const page: FigNode = {
    guid: figGuid(0),
    phase: PHASE,
    type: nodeType(FIG_NODE_TYPE.CANVAS),
    name: "Page 1",
    backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
  };
  const nodeChanges = [
    page,
    ...children.flatMap((child, index) => fakeNodeChanges(child, page.guid, index)),
  ];
  return { page, document: indexFigKiwiDocument(nodeChanges) };
}

describe("computeNodeBounds", () => {
  it("emits one entry per node in DFS pre-order", () => {
    const fixture = fakeDocument([
        {
          localID: 1,
          name: "0:1",
          tx: 0,
          ty: 0,
          width: 200,
          height: 200,
          children: [
            { localID: 11, name: "0:1:1", tx: 10, ty: 10, width: 50, height: 50 },
            { localID: 12, name: "0:1:2", tx: 80, ty: 10, width: 50, height: 50 },
          ],
        },
        { localID: 2, name: "0:2", tx: 300, ty: 0, width: 100, height: 100 },
      ]);
    const bounds = computeNodeBounds(fixture.page, fixture.document.childrenOf);
    expect(bounds.map((b) => b.name)).toEqual(["0:1", "0:1:1", "0:1:2", "0:2"]);
    expect(bounds.map((b) => b.depth)).toEqual([0, 1, 1, 0]);
    expect(bounds.map((b) => b.paintOrder)).toEqual([0, 1, 2, 3]);
  });

  it("composes parent and child transforms into world coordinates", () => {
    const fixture = fakeDocument([
        {
          localID: 1,
          name: "outer",
          tx: 100,
          ty: 200,
          width: 400,
          height: 400,
          children: [{ localID: 2, name: "inner", tx: 30, ty: 40, width: 50, height: 60 }],
        },
      ]);
    const bounds = computeNodeBounds(fixture.page, fixture.document.childrenOf);
    const inner = bounds.find((b) => b.name === "inner");
    expect(inner).toBeDefined();
    expect(inner?.x).toBeCloseTo(130, 5);
    expect(inner?.y).toBeCloseTo(240, 5);
    expect(inner?.width).toBeCloseTo(50, 5);
    expect(inner?.height).toBeCloseTo(60, 5);
  });

  it("propagates visibility from ancestors", () => {
    const fixture = fakeDocument([
        {
          localID: 1,
          name: "hidden-parent",
          tx: 0,
          ty: 0,
          width: 100,
          height: 100,
          visible: false,
          children: [{ localID: 2, name: "child-of-hidden", tx: 0, ty: 0, width: 10, height: 10 }],
        },
      ]);
    const bounds = computeNodeBounds(fixture.page, fixture.document.childrenOf);
    const child = bounds.find((b) => b.name === "child-of-hidden");
    expect(child?.visible).toBe(false);
  });

  it("indexes by id for O(1) lookup", () => {
    const fixture = fakeDocument([{ localID: 1, name: "0:1", tx: 0, ty: 0, width: 10, height: 10 }]);
    const bounds = computeNodeBounds(fixture.page, fixture.document.childrenOf);
    const map = indexBoundsById(bounds);
    expect(map.size).toBe(1);
    expect(map.get(guidToString(figGuid(1)))?.name).toBe("0:1");
  });
});
