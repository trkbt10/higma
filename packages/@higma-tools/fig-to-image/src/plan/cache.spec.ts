/** @file Unit specs for cache probing and render planning. */

import type { FigNode } from "@higma-document-models/fig/types";
import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { createSymbolResolver } from "@higma-document-models/fig/symbols";
import { fingerprintFigSubtree } from "../fingerprint";
import { setTextMetadata } from "../png-meta";
import { FINGERPRINT_PNG_KEY, isCacheHit, planTargets, type ReadFileFn } from "./cache";
import type { FigFrameTarget } from "../types";

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

const EMPTY_SYMBOL_RESOLVER = createSymbolResolver({ document: indexFigKiwiDocument([]) });

function makeNode(overrides: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: { value: 0, name: "CREATED" },
    type: { value: 4, name: "FRAME" },
    name: "test-frame",
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: 100, y: 100 },
    fillPaints: [],
    strokePaints: [],
    strokeWeight: 0,
    effects: [],
    ...overrides,
  };
}

function makeTarget(node: FigNode, frame: string): FigFrameTarget {
  return {
    page: "Test",
    frame,
    type: node.type.name,
    node,
    width: 100,
    height: 100,
  };
}

const noopJoinPath = (dir: string, file: string): string => `${dir}/${file}`;

function planOptions(
  readFile: ReadFileFn,
  scale: number,
  force: boolean,
) {
  return {
    outDir: "/out",
    filename: "{name}.png",
    scale,
    force,
    symbolResolver: EMPTY_SYMBOL_RESOLVER,
    childrenOf: EMPTY_SYMBOL_RESOLVER.childrenOfResolvedNode,
    readFile,
    joinPath: noopJoinPath,
  };
}

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

  it("throws when the file is not a valid PNG", async () => {
    const readFile: ReadFileFn = async () => Uint8Array.from([1, 2, 3]);
    await expect(isCacheHit("/tmp/garbage.bin", "fp-x", readFile)).rejects.toThrow();
  });
});

describe("planTargets", () => {
  it("marks every target as skip when matching PNGs are present", async () => {
    const node = makeNode({});
    const target = makeTarget(node, "test-frame");
    const fingerprint = fingerprintFigSubtree(node, {
      pixelRatio: 2,
      symbolResolver: EMPTY_SYMBOL_RESOLVER,
      childrenOf: EMPTY_SYMBOL_RESOLVER.childrenOfResolvedNode,
    });
    const tagged = setTextMetadata(MIN_PNG, FINGERPRINT_PNG_KEY, fingerprint);
    const readFile: ReadFileFn = async () => tagged;
    const plans = await planTargets([target], planOptions(readFile, 2, false));
    expect(plans).toHaveLength(1);
    expect(plans[0]?.skip).toBe(true);
    expect(plans[0]?.filename).toBe("test-frame.png");
    expect(plans[0]?.outPath).toBe("/out/test-frame.png");
    expect(plans[0]?.fingerprint).toBe(fingerprint);
  });

  it("marks targets as not-skip when force is set, even on a cache hit", async () => {
    const node = makeNode({});
    const target = makeTarget(node, "test-frame");
    const fingerprint = fingerprintFigSubtree(node, {
      pixelRatio: 2,
      symbolResolver: EMPTY_SYMBOL_RESOLVER,
      childrenOf: EMPTY_SYMBOL_RESOLVER.childrenOfResolvedNode,
    });
    const tagged = setTextMetadata(MIN_PNG, FINGERPRINT_PNG_KEY, fingerprint);
    const readFile: ReadFileFn = async () => tagged;
    const plans = await planTargets([target], planOptions(readFile, 2, true));
    expect(plans[0]?.skip).toBe(false);
  });

  it("computes different fingerprints for different scales", async () => {
    const node = makeNode({});
    const target = makeTarget(node, "test-frame");
    const fpA = fingerprintFigSubtree(node, {
      pixelRatio: 1,
      symbolResolver: EMPTY_SYMBOL_RESOLVER,
      childrenOf: EMPTY_SYMBOL_RESOLVER.childrenOfResolvedNode,
    });
    const fpB = fingerprintFigSubtree(node, {
      pixelRatio: 2,
      symbolResolver: EMPTY_SYMBOL_RESOLVER,
      childrenOf: EMPTY_SYMBOL_RESOLVER.childrenOfResolvedNode,
    });
    expect(fpA).not.toBe(fpB);

    const readFile: ReadFileFn = async () => undefined;
    const plansA = await planTargets([target], planOptions(readFile, 1, false));
    const plansB = await planTargets([target], planOptions(readFile, 2, false));
    expect(plansA[0]?.fingerprint).toBe(fpA);
    expect(plansB[0]?.fingerprint).toBe(fpB);
    expect(plansA[0]?.fingerprint).not.toBe(plansB[0]?.fingerprint);
  });
});
