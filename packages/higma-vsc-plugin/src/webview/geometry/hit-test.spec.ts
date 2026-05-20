/**
 * @file Unit specs for `findNodeAtPoint`.
 */

import { indexFigKiwiDocument, type FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { FIG_NODE_TYPE, type FigGuid, type FigNode, type FigNodeType, type KiwiEnumValue } from "@higma-document-models/fig/types";
import { computeNodeBounds } from "./node-bounds";
import { findNodeAtPoint } from "./hit-test";

type HitFixture = {
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

function node(args: {
  readonly localID: number;
  readonly name: string;
  readonly type: EncodedNodeType;
  readonly parentGuid: FigGuid;
  readonly position: number;
  readonly visible: boolean;
  readonly tx: number;
  readonly ty: number;
  readonly width: number;
  readonly height: number;
}): FigNode {
  return {
    guid: figGuid(args.localID),
    phase: PHASE,
    type: nodeType(args.type),
    name: args.name,
    visible: args.visible,
    opacity: 1,
    parentIndex: { guid: args.parentGuid, position: args.position.toString().padStart(6, "0") },
    transform: { m00: 1, m01: 0, m02: args.tx, m10: 0, m11: 1, m12: args.ty },
    size: { x: args.width, y: args.height },
    fillPaints: [],
    strokePaints: [],
    strokeWeight: 0,
    effects: [],
  };
}

function buildFixture(): HitFixture {
  const page: FigNode = {
    guid: figGuid(0),
    phase: PHASE,
    type: nodeType(FIG_NODE_TYPE.CANVAS),
    name: "Page 1",
    backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
  };
  const frameA = node({
    localID: 1,
    name: "frame-a",
    type: FIG_NODE_TYPE.FRAME,
    parentGuid: page.guid,
    position: 0,
    visible: true,
    tx: 0,
    ty: 0,
    width: 200,
    height: 200,
  });
  const inner = node({
    localID: 2,
    name: "inner",
    type: FIG_NODE_TYPE.RECTANGLE,
    parentGuid: frameA.guid,
    position: 0,
    visible: true,
    tx: 50,
    ty: 50,
    width: 80,
    height: 80,
  });
  const frameB = node({
    localID: 3,
    name: "frame-b",
    type: FIG_NODE_TYPE.FRAME,
    parentGuid: page.guid,
    position: 1,
    visible: true,
    tx: 300,
    ty: 0,
    width: 100,
    height: 100,
  });
  const hidden = node({
    localID: 4,
    name: "hidden",
    type: FIG_NODE_TYPE.FRAME,
    parentGuid: page.guid,
    position: 2,
    visible: false,
    tx: 0,
    ty: 0,
    width: 200,
    height: 200,
  });
  return { page, document: indexFigKiwiDocument([page, frameA, inner, frameB, hidden]) };
}

describe("findNodeAtPoint", () => {
  it("returns the topmost (deepest, latest-painted) hit", () => {
    const fixture = buildFixture();
    const bounds = computeNodeBounds(fixture.page, fixture.document.childrenOf);
    const hit = findNodeAtPoint(bounds, { x: 100, y: 100 });
    // `inner` is painted after `frame-a` and contains (100,100), so it wins.
    expect(hit?.name).toBe("inner");
  });

  it("returns the parent when the cursor is outside the child's AABB", () => {
    const fixture = buildFixture();
    const bounds = computeNodeBounds(fixture.page, fixture.document.childrenOf);
    const hit = findNodeAtPoint(bounds, { x: 10, y: 10 });
    expect(hit?.name).toBe("frame-a");
  });

  it("returns null when no node contains the point", () => {
    const fixture = buildFixture();
    const bounds = computeNodeBounds(fixture.page, fixture.document.childrenOf);
    const hit = findNodeAtPoint(bounds, { x: 1000, y: 1000 });
    expect(hit).toBeNull();
  });

  it("ignores invisible ancestors", () => {
    const fixture = buildFixture();
    const bounds = computeNodeBounds(fixture.page, fixture.document.childrenOf);
    // `hidden` covers (0,0)–(200,200). `frame-a` also covers that area,
    // but `hidden` is painted after frame-a → would win if visible.
    // Because hidden is not visible, frame-a wins.
    const hit = findNodeAtPoint(bounds, { x: 5, y: 5 });
    expect(hit?.name).toBe("frame-a");
  });
});
