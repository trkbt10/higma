/**
 * @file Spec for the BOOLEAN_OPERATION → Path composer.
 *
 * Locks in the contract `tryComposeBooleanLeaf` exposes:
 *   1. Returns `undefined` when blobs are missing — the caller's
 *      job is to fall back to a ZStack of children, not crash.
 *   2. Returns `undefined` when the children carry no decodable
 *      geometry — same reason.
 *   3. Successfully composes UNION / SUBTRACT / INTERSECT /
 *      EXCLUDE for two RECTANGLE children, emitting a single
 *      `Path { ... }` SwiftUI leaf with the BOOLEAN_OPERATION
 *      node's own fill paint applied.
 *
 * Children of type RECTANGLE without `fillGeometry` blobs hit the
 * `synthesisePrimitiveCommands` fallback inside the composer, so
 * tests don't need to encode raw blob bytes — they just configure
 * `size` and let the composer pull the contour from the
 * primitive-shape generator.
 */
import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import { serialize } from "../swift-tree";
import { tryComposeBooleanLeaf } from "./boolean-compose";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

/**
 * RECTANGLE child with an authored size and a translation
 * transform. No `fillGeometry` blob — the composer synthesises the
 * contour from the primitive parameters.
 */
function makeRectChild(
  options: {
    readonly localID: number;
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
  },
): FigNode {
  return {
    guid: { sessionID: 1, localID: options.localID },
    phase: enumName("CREATED"),
    type: enumName("RECTANGLE"),
    name: `rect-${options.localID}`,
    size: { x: options.width, y: options.height },
    transform: {
      m00: 1,
      m01: 0,
      m02: options.offsetX,
      m10: 0,
      m11: 1,
      m12: options.offsetY,
    },
  } as FigNode;
}

function makeBooleanFixture(
  op: "UNION" | "SUBTRACT" | "INTERSECT" | "EXCLUDE",
): { readonly node: FigNode; readonly blobs: readonly FigBlob[] } {
  const childA = makeRectChild({
    localID: 10,
    width: 60,
    height: 60,
    offsetX: 0,
    offsetY: 0,
  });
  const childB = makeRectChild({
    localID: 11,
    width: 60,
    height: 60,
    offsetX: 30,
    offsetY: 30,
  });
  const node = {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("BOOLEAN_OPERATION"),
    name: `bool-${op.toLowerCase()}`,
    size: { x: 90, y: 90 },
    booleanOperation: enumName(op),
    fillPaints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
    children: [childA, childB],
  } as FigNode;
  return { node, blobs: [] };
}

describe("tryComposeBooleanLeaf", () => {
  it("returns undefined when blobs are missing", () => {
    const { node } = makeBooleanFixture("UNION");
    expect(tryComposeBooleanLeaf(node, undefined)).toBeUndefined();
  });

  it("returns undefined when there are no children", () => {
    const node = {
      guid: { sessionID: 1, localID: 1 },
      phase: enumName("CREATED"),
      type: enumName("BOOLEAN_OPERATION"),
      name: "bool-empty",
      size: { x: 60, y: 60 },
      booleanOperation: enumName("UNION"),
      fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
      children: [],
    } as FigNode;
    expect(tryComposeBooleanLeaf(node, [])).toBeUndefined();
  });

  it("composes UNION into a Path leaf with the boolean's fill", () => {
    const { node, blobs } = makeBooleanFixture("UNION");
    const view = tryComposeBooleanLeaf(node, blobs);
    expect(view).toBeDefined();
    if (!view) {
      return;
    }
    const src = serialize(view);
    expect(src).toContain("Path(");
    expect(src).toContain(".fill(Color(red: 1, green: 0, blue: 0))");
    expect(src).toContain(".frame(width: 90, height: 90");
  });

  it("composes SUBTRACT", () => {
    const { node, blobs } = makeBooleanFixture("SUBTRACT");
    const view = tryComposeBooleanLeaf(node, blobs);
    expect(view).toBeDefined();
    if (!view) {
      return;
    }
    const src = serialize(view);
    expect(src).toContain("Path(");
  });

  it("composes INTERSECT", () => {
    const { node, blobs } = makeBooleanFixture("INTERSECT");
    const view = tryComposeBooleanLeaf(node, blobs);
    expect(view).toBeDefined();
  });

  it("composes EXCLUDE", () => {
    const { node, blobs } = makeBooleanFixture("EXCLUDE");
    const view = tryComposeBooleanLeaf(node, blobs);
    expect(view).toBeDefined();
  });
});
