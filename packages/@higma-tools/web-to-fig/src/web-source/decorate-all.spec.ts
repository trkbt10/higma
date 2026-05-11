/**
 * @file Unit specs for the fused `decorateAll` walk.
 *
 * The decorate stage used to be three separate full-tree rewrites
 * (`decorateMaskSvg` → `decorateImageNaturalSize` → `decorateMaskNaturalSize`).
 * They were fused into a single walk for memory + allocation savings
 * on large captures. This spec pins the contract that the fused
 * walk produces *exactly* what the three separate passes used to —
 * any deviation here is a regression that would silently corrupt
 * downstream normalisation.
 */
import { describe, expect, it } from "vitest";
import type { ElementJson } from "./in-page";
import type { RawAsset } from "./snapshot";
import type { ResponseCache } from "./playwright-shared";
import { decorateAll } from "./capture";

function makeEl(overrides: Partial<ElementJson> = {}): ElementJson {
  return {
    id: overrides.id ?? "0",
    tag: overrides.tag ?? "div",
    rect: overrides.rect ?? { x: 0, y: 0, width: 100, height: 100 },
    contentRect: overrides.contentRect ?? { x: 0, y: 0, width: 100, height: 100 },
    visible: overrides.visible ?? true,
    computedStyle: overrides.computedStyle ?? {},
    children: overrides.children ?? [],
    ...overrides,
  };
}

function fakeResponseCache(map: Record<string, Uint8Array>): ResponseCache {
  return {
    bodyForUrl: (url: string) => map[url],
    settle: () => Promise.resolve(),
    *entries() {
      for (const [url, bytes] of Object.entries(map)) {
        yield { url, bytes, mime: "image/png" };
      }
    },
  };
}

const PNG_8x8: Uint8Array = (() => {
  // Minimal 8x8 PNG (IHDR + IDAT + IEND), hand-crafted because we
  // need a buffer whose first 24 bytes resemble a real PNG header
  // for `sniffBytesNaturalSize`.
  const out = new Uint8Array(33);
  // signature
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR length (13)
  out.set([0x00, 0x00, 0x00, 0x0d], 8);
  // "IHDR"
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  // width = 8
  out.set([0x00, 0x00, 0x00, 0x08], 16);
  // height = 8
  out.set([0x00, 0x00, 0x00, 0x08], 20);
  return out;
})();

const SVG_BYTES = new TextEncoder().encode(
  "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\"><path d=\"M0 0 L24 0 L24 24 Z\" fill=\"red\"/></svg>",
);

describe("decorateAll", () => {
  it("returns the input verbatim when no element carries an image or mask", () => {
    const tree = makeEl({
      children: [makeEl({ id: "0/0" }), makeEl({ id: "0/1" })],
    });
    const out = decorateAll(tree, new Map(), fakeResponseCache({}), new Map());
    expect(out).toBe(tree);
    expect(out.children).toBe(tree.children);
  });

  it("stamps imageNaturalWidth/Height on elements carrying an imageId", () => {
    const tree = makeEl({
      imageId: "img-0",
    });
    const idToUrl = new Map([["img-0", "https://example.test/a.png"]]);
    const assets = new Map<string, RawAsset>([
      ["img-0", { id: "img-0", mime: "image/png", bytes: PNG_8x8 }],
    ]);
    const out = decorateAll(tree, idToUrl, fakeResponseCache({}), assets);
    expect(out).not.toBe(tree);
    expect(out.imageNaturalWidth).toBe(8);
    expect(out.imageNaturalHeight).toBe(8);
  });

  it("parses an SVG mask via the response cache and surfaces maskSvgContent", () => {
    const tree = makeEl({
      maskImageId: "mask-0",
    });
    const idToUrl = new Map([["mask-0", "https://example.test/mask.svg"]]);
    const responseCache = fakeResponseCache({
      "https://example.test/mask.svg": SVG_BYTES,
    });
    const out = decorateAll(tree, idToUrl, responseCache, new Map());
    expect(out.maskSvgContent).toBeDefined();
    expect(out.maskSvgContent!.paths).toHaveLength(1);
    expect(out.maskSvgContent!.paths[0]!.d).toBe("M0 0 L24 0 L24 24 Z");
  });

  it("derives maskNaturalWidth/Height from the same SVG bytes", () => {
    const tree = makeEl({ maskImageId: "mask-0" });
    const idToUrl = new Map([["mask-0", "https://example.test/mask.svg"]]);
    const responseCache = fakeResponseCache({
      "https://example.test/mask.svg": SVG_BYTES,
    });
    const out = decorateAll(tree, idToUrl, responseCache, new Map());
    expect(out.maskNaturalWidth).toBe(24);
    expect(out.maskNaturalHeight).toBe(24);
  });

  it("recurses into children and preserves structural sharing for unaffected branches", () => {
    const sharedLeaf = makeEl({ id: "0/0/0" });
    const sharedChild = makeEl({ id: "0/0", children: [sharedLeaf] });
    const stampedChild = makeEl({
      id: "0/1",
      imageId: "img-0",
    });
    const tree = makeEl({ id: "0", children: [sharedChild, stampedChild] });
    const idToUrl = new Map([["img-0", "https://example.test/a.png"]]);
    const assets = new Map<string, RawAsset>([
      ["img-0", { id: "img-0", mime: "image/png", bytes: PNG_8x8 }],
    ]);
    const out = decorateAll(tree, idToUrl, fakeResponseCache({}), assets);
    // The shared sibling and its descendants should round-trip
    // unchanged so a 10k-node capture doesn't pay an allocation per
    // node when only a leaf changed.
    expect(out.children[0]).toBe(sharedChild);
    expect(out.children[1].imageNaturalWidth).toBe(8);
  });

  it("applies all three annotations in one pass — image dim AND mask SVG AND mask dim", () => {
    const tree = makeEl({
      imageId: "img-0",
      maskImageId: "mask-0",
    });
    const idToUrl = new Map([
      ["img-0", "https://example.test/a.png"],
      ["mask-0", "https://example.test/mask.svg"],
    ]);
    const assets = new Map<string, RawAsset>([
      ["img-0", { id: "img-0", mime: "image/png", bytes: PNG_8x8 }],
    ]);
    const responseCache = fakeResponseCache({
      "https://example.test/mask.svg": SVG_BYTES,
    });
    const out = decorateAll(tree, idToUrl, responseCache, assets);
    expect(out.imageNaturalWidth).toBe(8);
    expect(out.imageNaturalHeight).toBe(8);
    expect(out.maskSvgContent).toBeDefined();
    expect(out.maskNaturalWidth).toBe(24);
    expect(out.maskNaturalHeight).toBe(24);
  });
});
