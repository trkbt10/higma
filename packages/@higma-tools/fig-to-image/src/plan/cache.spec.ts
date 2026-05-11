/**
 * @file Unit specs for the cache probe + plan builder.
 *
 * These specs run without spinning up the harness — `readFile`
 * and `joinPath` are injected so we can exercise the plan
 * builder against a synthetic FigDesignNode tree.
 */
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { fingerprintFigSubtree } from "../fingerprint";
import { setTextMetadata } from "../png-meta";
import { FINGERPRINT_PNG_KEY, isCacheHit, planTargets, type ReadFileFn } from "./cache";
import type { FigFrameTarget } from "../types";

/**
 * Smallest valid PNG: 1×1 white pixel, RGBA, zlib-deflated.
 * Mirrors the literal used in `png-meta/index.spec.ts` so both
 * tests exercise the codec against an identical byte stream.
 */
const MIN_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x01, 0x63, 0xf8, 0xff, 0xff, 0xff,
  0x7f, 0x00, 0x09, 0xfb, 0x03, 0xfd, 0xd8, 0xf6,
  0x60, 0x78, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

/**
 * Build a minimum `FigDesignNode` for tests. The synthetic
 * node carries every field the renderer's fingerprint walker
 * consumes; we mark it via a guard so the test stays free of
 * raw `as unknown` casts that `custom/no-as-outside-guard`
 * forbids.
 */
function isFigDesignNode(value: unknown): value is FigDesignNode {
  return Boolean(value) && typeof value === "object";
}

function makeNode(overrides: Record<string, unknown>): FigDesignNode {
  const base: Record<string, unknown> = {
    id: "0:1",
    type: "FRAME",
    name: "test-frame",
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: 100, y: 100 },
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
  };
  const merged = { ...base, ...overrides };
  if (!isFigDesignNode(merged)) {
    throw new Error("makeNode: failed to produce a FigDesignNode");
  }
  return merged;
}

function makeTarget(node: FigDesignNode, frame: string): FigFrameTarget {
  return {
    page: "Test",
    frame,
    type: node.type,
    node,
    width: 100,
    height: 100,
  };
}

const noopJoinPath = (dir: string, file: string): string => `${dir}/${file}`;

describe("isCacheHit", () => {
  it("returns false when the file does not exist", async () => {
    const readFile: ReadFileFn = async () => undefined;
    expect(await isCacheHit("/tmp/missing.png", "fp-x", readFile)).toBe(false);
  });

  it("returns false when the PNG has no fingerprint metadata", async () => {
    const readFile: ReadFileFn = async () => MIN_PNG;
    expect(await isCacheHit("/tmp/clean.png", "fp-x", readFile)).toBe(false);
  });

  it("returns true when the fingerprint matches", async () => {
    const tagged = setTextMetadata(MIN_PNG, FINGERPRINT_PNG_KEY, "fp-abc");
    const readFile: ReadFileFn = async () => tagged;
    expect(await isCacheHit("/tmp/tagged.png", "fp-abc", readFile)).toBe(true);
  });

  it("returns false on a fingerprint mismatch", async () => {
    const tagged = setTextMetadata(MIN_PNG, FINGERPRINT_PNG_KEY, "fp-old");
    const readFile: ReadFileFn = async () => tagged;
    expect(await isCacheHit("/tmp/tagged.png", "fp-new", readFile)).toBe(false);
  });

  it("returns false when the file is not a valid PNG", async () => {
    const readFile: ReadFileFn = async () => Uint8Array.from([1, 2, 3]);
    expect(await isCacheHit("/tmp/garbage.bin", "fp-x", readFile)).toBe(false);
  });
});

describe("planTargets", () => {
  it("marks every target as skip when matching PNGs are present", async () => {
    const node = makeNode({});
    const target = makeTarget(node, "test-frame");
    const fingerprint = fingerprintFigSubtree(node, {
      pixelRatio: 2,
      symbolMap: new Map(),
    });
    const tagged = setTextMetadata(MIN_PNG, FINGERPRINT_PNG_KEY, fingerprint);
    const readFile: ReadFileFn = async () => tagged;
    const plans = await planTargets([target], {
      outDir: "/out",
      filename: "{name}.png",
      scale: 2,
      force: false,
      symbolMap: new Map(),
      readFile,
      joinPath: noopJoinPath,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.skip).toBe(true);
    expect(plans[0]?.filename).toBe("test-frame.png");
    expect(plans[0]?.outPath).toBe("/out/test-frame.png");
    expect(plans[0]?.fingerprint).toBe(fingerprint);
  });

  it("marks targets as not-skip when --force is set, even on a cache hit", async () => {
    const node = makeNode({});
    const target = makeTarget(node, "test-frame");
    const fingerprint = fingerprintFigSubtree(node, {
      pixelRatio: 2,
      symbolMap: new Map(),
    });
    const tagged = setTextMetadata(MIN_PNG, FINGERPRINT_PNG_KEY, fingerprint);
    const readFile: ReadFileFn = async () => tagged;
    const plans = await planTargets([target], {
      outDir: "/out",
      filename: "{name}.png",
      scale: 2,
      force: true,
      symbolMap: new Map(),
      readFile,
      joinPath: noopJoinPath,
    });
    expect(plans[0]?.skip).toBe(false);
  });

  it("computes different fingerprints for different scales", async () => {
    const node = makeNode({});
    const target = makeTarget(node, "test-frame");
    const symbolMap = new Map<string, FigDesignNode>();
    const fpA = fingerprintFigSubtree(node, { pixelRatio: 1, symbolMap });
    const fpB = fingerprintFigSubtree(node, { pixelRatio: 2, symbolMap });
    expect(fpA).not.toBe(fpB);

    const readFile: ReadFileFn = async () => undefined;
    const plansA = await planTargets([target], {
      outDir: "/out",
      filename: "{name}.png",
      scale: 1,
      force: false,
      symbolMap,
      readFile,
      joinPath: noopJoinPath,
    });
    const plansB = await planTargets([target], {
      outDir: "/out",
      filename: "{name}.png",
      scale: 2,
      force: false,
      symbolMap,
      readFile,
      joinPath: noopJoinPath,
    });
    expect(plansA[0]?.fingerprint).toBe(fpA);
    expect(plansB[0]?.fingerprint).toBe(fpB);
    expect(plansA[0]?.fingerprint).not.toBe(plansB[0]?.fingerprint);
  });
});
