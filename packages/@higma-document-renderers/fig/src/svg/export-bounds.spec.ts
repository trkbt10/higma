/**
 * @file Unit spec for `computeFigExportBounds`.
 *
 * Each case is calibrated against fixtures observable in Figma's own
 * SVG export — the App Store Template (Community) file has been the
 * primary reference. The point of these tests is to keep the function
 * faithful to Figma's exporter even as later changes refactor the
 * underlying tree-walk.
 */

import { describe, it, expect } from "vitest";
import type { FigNode } from "@higma-document-models/fig/types";
import { encodeSvgPathBlob } from "@higma-document-models/fig/node-factory";
import {
  computeFigExportBounds,
  computeFigExportViewport,
  type ComputeFigExportBoundsOptions,
  type FigExportBox,
} from "./export-bounds";

function makeFrame(
  overrides: Partial<FigNode> & { readonly size: { readonly x: number; readonly y: number } },
): FigNode {
  return overrides as unknown as FigNode;
}

function fixtureChildrenOf(node: FigNode): readonly FigNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

function fixtureBounds(
  node: FigNode,
  options?: Partial<Omit<ComputeFigExportBoundsOptions, "childrenOf">>,
): FigExportBox {
  return computeFigExportBounds(node, { childrenOf: fixtureChildrenOf, blobs: [], ...options });
}

describe("computeFigExportBounds", () => {
  it("integer-sized leaf with no effects: width/height unchanged", () => {
    // `Icon/Today` (19×24) exports as viewBox="0 0 19 24"
    const node = makeFrame({ size: { x: 19, y: 24 } });
    expect(fixtureBounds(node)).toEqual({ x: 0, y: 0, width: 19, height: 24 });
  });

  it("fractional-sized leaf: ceil to next integer on width and height", () => {
    // `Icons/Arcade` (26.26×24.03) exports as viewBox="0 0 27 25"
    const node = makeFrame({ size: { x: 26.26044273376465, y: 24.02845001220703 } });
    expect(fixtureBounds(node)).toEqual({ x: 0, y: 0, width: 27, height: 25 });
  });

  it("ceilIntegers=false preserves sub-pixel width/height", () => {
    const node = makeFrame({ size: { x: 26.26044273376465, y: 24.02845001220703 } });
    expect(fixtureBounds(node, { ceilIntegers: false })).toEqual({
      x: 0,
      y: 0,
      width: 26.26044273376465,
      height: 24.02845001220703,
    });
  });

  it("DROP_SHADOW expands the box outward and the result is then ceiled", () => {
    // `Event Card` SYMBOL (362×296) with DROP_SHADOW radius=12 offset=(0,4)
    // exports as viewBox="0 0 386 320" with the card BG positioned at
    // (12, 8). Effect halo: left=12 right=12 top=8 bottom=16.
    const node = makeFrame({
      size: { x: 362, y: 296 },
      effects: [
        { type: "DROP_SHADOW", radius: 12, offset: { x: 0, y: 4 }, visible: true },
      ] as unknown as FigNode["effects"],
    });
    expect(fixtureBounds(node)).toEqual({ x: -12, y: -8, width: 386, height: 320 });
  });

  it("clipsContent=true (frameMaskDisabled=false) ignores overflowing children", () => {
    const node = makeFrame({
      size: { x: 100, y: 100 },
      frameMaskDisabled: false,
      children: [
        makeFrame({
          size: { x: 500, y: 50 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as FigNode["transform"],
        }),
      ] as unknown as FigNode["children"],
    });
    expect(fixtureBounds(node)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("clipsContent=false (frameMaskDisabled=true) unions overflowing children into the box", () => {
    // `Apps` SYMBOL (402×306) with `frameMaskDisabled: true` and a
    // 772×230 child placed at (0, 56) exports as viewBox="0 0 772 306".
    const node = makeFrame({
      size: { x: 402, y: 306 },
      frameMaskDisabled: true,
      children: [
        makeFrame({
          size: { x: 402, y: 28 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 20 } as FigNode["transform"],
        }),
        makeFrame({
          size: { x: 772, y: 230 },
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 56 } as FigNode["transform"],
        }),
      ] as unknown as FigNode["children"],
    });
    expect(fixtureBounds(node)).toEqual({ x: 0, y: 0, width: 772, height: 306 });
  });

  it("invisible children are excluded from the union", () => {
    const node = makeFrame({
      size: { x: 100, y: 100 },
      frameMaskDisabled: true,
      children: [
        makeFrame({
          size: { x: 1000, y: 1000 },
          visible: false,
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as FigNode["transform"],
        }),
      ] as unknown as FigNode["children"],
    });
    expect(fixtureBounds(node)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("recursively unions descendants when nested frames are also unclipped", () => {
    //   root (frameMaskDisabled=true, 100×100)
    //     ↳ inner (frameMaskDisabled=true, 50×50 @ +0,+0)
    //         ↳ leaf (200×200 @ +0,+0)  ← overflows
    // The exporter should reach `leaf` through `inner` because both
    // ancestors are unclipped. Expected: union covers (0..200, 0..200).
    const leaf = makeFrame({
      size: { x: 200, y: 200 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as FigNode["transform"],
    });
    const inner = makeFrame({
      size: { x: 50, y: 50 },
      frameMaskDisabled: true,
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as FigNode["transform"],
      children: [leaf] as unknown as FigNode["children"],
    });
    const root = makeFrame({
      size: { x: 100, y: 100 },
      frameMaskDisabled: true,
      children: [inner] as unknown as FigNode["children"],
    });
    expect(fixtureBounds(root)).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });

  it("recursion STOPS at a clipsContent=true ancestor: deep overflow inside a clipped frame is hidden", () => {
    // Same shape as the previous test but `inner` clips its content
    // (frameMaskDisabled=false). The leaf overflow must not bubble up.
    const leaf = makeFrame({
      size: { x: 200, y: 200 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as FigNode["transform"],
    });
    const inner = makeFrame({
      size: { x: 50, y: 50 },
      frameMaskDisabled: false,
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as FigNode["transform"],
      children: [leaf] as unknown as FigNode["children"],
    });
    const root = makeFrame({
      size: { x: 100, y: 100 },
      frameMaskDisabled: true,
      children: [inner] as unknown as FigNode["children"],
    });
    expect(fixtureBounds(root)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("child translation pushes the union outward in both directions", () => {
    // Child placed at relative (-10, -20) with size 30×40 — extends past
    // the parent's top-left. Union should grow on the top-left, not
    // shift the parent's intrinsic box.
    const node = makeFrame({
      size: { x: 100, y: 100 },
      frameMaskDisabled: true,
      children: [
        makeFrame({
          size: { x: 30, y: 40 },
          transform: { m00: 1, m01: 0, m02: -10, m10: 0, m11: 1, m12: -20 } as FigNode["transform"],
        }),
      ] as unknown as FigNode["children"],
    });
    expect(fixtureBounds(node)).toEqual({ x: -10, y: -20, width: 110, height: 120 });
  });

  it("unclipped descendant stroke geometry expands the export bounds", () => {
    const strokeBlob = encodeSvgPathBlob("M -0.265165 0 L 512.265137 0 L 512.265137 512.265137 L -0.265165 512.265137 Z");
    const strokeChild = makeFrame({
      size: { x: 512, y: 512 },
      strokeGeometry: [{ commandsBlob: 0, styleID: 0 }],
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as FigNode["transform"],
    });
    const node = makeFrame({
      size: { x: 512, y: 512 },
      frameMaskDisabled: true,
      children: [strokeChild] as unknown as FigNode["children"],
    });

    const bounds = fixtureBounds(node, { blobs: [{ bytes: strokeBlob.bytes }] });

    expect(bounds.x).toBeCloseTo(-0.265165, 6);
    expect(bounds).toMatchObject({
      y: 0,
      width: 513,
      height: 513,
    });
  });

  it("unclipped descendant fill geometry stays clipped to the node surface", () => {
    const fillBlob = encodeSvgPathBlob("M -0.31371 -0.12855 L 24.78977 -0.12855 L 24.78977 23.73952 L -0.31371 23.73952 Z");
    const fillChild = makeFrame({
      size: { x: 24.789762496948242, y: 23.739519119262695 },
      fillGeometry: [{ commandsBlob: 0, styleID: 0 }],
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as FigNode["transform"],
    });
    const node = makeFrame({
      size: { x: 24.789762496948242, y: 23.739519119262695 },
      frameMaskDisabled: true,
      children: [fillChild] as unknown as FigNode["children"],
    });

    expect(fixtureBounds(node, { blobs: [{ bytes: fillBlob.bytes }] })).toEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 24,
    });
  });

  it("root-authored geometry does not replace the exported surface bounds", () => {
    const strokeBlob = encodeSvgPathBlob("M -1 -1 L 101 -1 L 101 101 L -1 101 Z");
    const node = makeFrame({
      size: { x: 100, y: 100 },
      frameMaskDisabled: false,
      strokeGeometry: [{ commandsBlob: 0, styleID: 0 }],
    });

    expect(fixtureBounds(node, { blobs: [{ bytes: strokeBlob.bytes }] })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  it("world viewport applies the root Kiwi translation exactly once", () => {
    const node = makeFrame({
      size: { x: 100, y: 100 },
      transform: { m00: 1, m01: 0, m02: 300, m10: 0, m11: 1, m12: 40 } as FigNode["transform"],
      effects: [
        { type: "DROP_SHADOW", radius: 10, offset: { x: 0, y: 4 }, visible: true },
      ] as unknown as FigNode["effects"],
    });
    expect(computeFigExportViewport(node, { childrenOf: fixtureChildrenOf, blobs: [] })).toEqual({
      x: 290,
      y: 34,
      width: 120,
      height: 120,
    });
  });
});
