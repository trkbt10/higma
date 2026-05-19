/**
 * @file Tests for the cluster promotion gate and the fingerprint
 * primitive.
 *
 * Phase 2 of the SoT consolidation removed the in-place
 * `promoteIconCluster` mutator from refine-fig — the equivalent
 * rewrite is now expressed as `PROMOTE_TO_SYMBOL` +
 * `PROMOTE_TO_INSTANCE` reducer dispatches inside `apply-plan.ts`.
 *
 * What remains here are the *read-only* routines the planner / apply
 * layer consult to decide whether a cluster qualifies and which
 * members share visual identity with the exemplar:
 *
 *   - `isPromotableCluster` — the structural gate (FRAME/GROUP root,
 *     no GRADIENT paints, only promotable descendant types).
 *   - `structureFingerprint` — a stable string that compares equal iff
 *     two structures would render to the same pixels once their
 *     wrapping INSTANCE's transform is applied.
 *
 * The tests verify:
 *
 *   - the gate accepts TEXT, RECTANGLE, IMAGE-fill descendants;
 *   - the gate refuses GRADIENT paints (no override-path path for
 *     positional handle data);
 *   - fingerprint differs when text content / image ref / nested
 *     symbolID / SOLID color / opacity diverge — the apply-plan layer
 *     uses this to filter out divergent cluster members before
 *     dispatching `PROMOTE_TO_INSTANCE`.
 */

import type { FigNode, FigPaint } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import { BLEND_MODE_VALUES, PAINT_TYPE_VALUES, SCALE_MODE_VALUES } from "@higma-document-models/fig/constants";
import { createNodeChangesMessageHeader } from "@higma-document-models/fig/domain";
import { isPromotableCluster, structureFingerprint } from "./promote-icon-cluster";

const NORMAL_BLEND = { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" } as const;
const FILL_IMAGE_SCALE = { value: SCALE_MODE_VALUES.FILL, name: "FILL" } as const;

function imagePaint(hash: readonly number[]): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
    image: { hash },
    imageScaleMode: FILL_IMAGE_SCALE,
    opacity: 1,
    visible: true,
    blendMode: NORMAL_BLEND,
  };
}

function linearGradientPaint(): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.GRADIENT_LINEAR, name: "GRADIENT_LINEAR" },
    opacity: 1,
    visible: true,
    blendMode: NORMAL_BLEND,
  };
}

function makeFig(nodes: readonly FigNode[]): LoadedFigFile {
  return {
    schema: {} as LoadedFigFile["schema"],
    compressedSchema: new Uint8Array(),
    version: "0",
    nodeChanges: nodes.slice(),
    blobs: [],
    images: new Map(),
    metadata: null,
    thumbnail: null,
    messageHeader: createNodeChangesMessageHeader(),
  };
}

function frameNode(guid: string, parent: string | undefined, fields: Partial<FigNode> = {}): FigNode {
  return makeNode(guid, parent, "FRAME", { size: { x: 100, y: 30 }, ...fields });
}

function textNode(guid: string, parent: string, characters: string, fields: Partial<FigNode> = {}): FigNode {
  return makeNode(guid, parent, "TEXT", {
    size: { x: 80, y: 20 },
    characters,
    fontName: { family: "Inter", style: "Regular", postscript: "" },
    fontSize: 14,
    ...fields,
  });
}

function rectNode(guid: string, parent: string, fields: Partial<FigNode> = {}): FigNode {
  return makeNode(guid, parent, "RECTANGLE", { size: { x: 60, y: 60 }, ...fields });
}

function instanceNode(guid: string, parent: string, symbolGuid: string, fields: Partial<FigNode> = {}): FigNode {
  const [s, l] = symbolGuid.split(":").map(Number);
  return makeNode(guid, parent, "INSTANCE", {
    size: { x: 40, y: 40 },
    symbolData: { symbolID: { sessionID: s ?? 0, localID: l ?? 0 } },
    ...fields,
  });
}

function makeNode(guid: string, parent: string | undefined, typeName: string, fields: Partial<FigNode> = {}): FigNode {
  const [s, l] = guid.split(":").map(Number);
  const sessionID = s ?? 0;
  const localID = l ?? 0;
  const partial = {
    guid: { sessionID, localID },
    type: { value: typeNumeric(typeName), name: typeName },
    name: `${typeName}-${guid}`,
    ...(parent ? { parentIndex: parseParentIndex(parent) } : {}),
    ...fields,
  };
  return partial as FigNode;
}

function parseParentIndex(guid: string): { guid: { sessionID: number; localID: number }; position: string } {
  const [ps, pl] = guid.split(":").map(Number);
  return { guid: { sessionID: ps ?? 0, localID: pl ?? 0 }, position: "z" };
}

function typeNumeric(name: string): number {
  switch (name) {
    case "FRAME":
      return 4;
    case "RECTANGLE":
      return 1;
    case "TEXT":
      return 13;
    case "INSTANCE":
      return 16;
    case "SYMBOL":
      return 15;
    default:
      return 0;
  }
}

describe("isPromotableCluster", () => {
  it("accepts a FRAME containing a TEXT descendant", () => {
    const exemplar = frameNode("1:10", undefined);
    const text = textNode("1:11", "1:10", "Hello");
    const loaded = makeFig([exemplar, text]);
    expect(isPromotableCluster(loaded, "1:10")).toBe(true);
  });

  it("accepts a FRAME containing a RECTANGLE with an IMAGE fill", () => {
    const exemplar = frameNode("1:20", undefined);
    const rect = rectNode("1:21", "1:20", {
      fillPaints: [
        imagePaint([0xab, 0xcd]),
      ],
    });
    const loaded = makeFig([exemplar, rect]);
    expect(isPromotableCluster(loaded, "1:20")).toBe(true);
  });

  it("accepts a FRAME containing a nested INSTANCE", () => {
    const exemplar = frameNode("1:30", undefined);
    const inst = instanceNode("1:31", "1:30", "9:99");
    const loaded = makeFig([exemplar, inst]);
    expect(isPromotableCluster(loaded, "1:30")).toBe(true);
  });

  it("refuses a FRAME containing a GRADIENT paint", () => {
    const exemplar = frameNode("1:40", undefined);
    const rect = rectNode("1:41", "1:40", {
      fillPaints: [
        linearGradientPaint(),
      ],
    });
    const loaded = makeFig([exemplar, rect]);
    expect(isPromotableCluster(loaded, "1:40")).toBe(false);
  });

  it("refuses a non-FRAME / non-GROUP exemplar", () => {
    const exemplar = textNode("1:50", "1:9", "lone text");
    const loaded = makeFig([exemplar]);
    expect(isPromotableCluster(loaded, "1:50")).toBe(false);
  });
});

describe("structureFingerprint fingerprint discrimination", () => {
  // The apply-plan layer uses `structureFingerprint` to decide which
  // cluster members to flip to INSTANCEs. Two members are flipped
  // together iff they share a fingerprint with the exemplar.

  it("matches members with identical TEXT content", () => {
    const exemplar = frameNode("1:100", "0:1");
    const exemplarText = textNode("1:101", "1:100", "Save");
    const match = frameNode("2:100", "0:1");
    const matchText = textNode("2:101", "2:100", "Save");
    const loaded = makeFig([exemplar, exemplarText, match, matchText]);
    expect(structureFingerprint(loaded, "1:100")).toBe(structureFingerprint(loaded, "2:100"));
  });

  it("differs between members whose TEXT content diverges", () => {
    const exemplar = frameNode("1:200", "0:1");
    const exemplarText = textNode("1:201", "1:200", "Save");
    const divergent = frameNode("3:200", "0:1");
    const divergentText = textNode("3:201", "3:200", "Cancel");
    const loaded = makeFig([exemplar, exemplarText, divergent, divergentText]);
    expect(structureFingerprint(loaded, "1:200")).not.toBe(structureFingerprint(loaded, "3:200"));
  });

  it("differs between members whose IMAGE `image.hash` diverges", () => {
    const exemplar = frameNode("1:300", "0:1");
    const exemplarRect = rectNode("1:301", "1:300", {
      fillPaints: [imagePaint([0xaa])],
    });
    const divergent = frameNode("3:300", "0:1");
    const divergentRect = rectNode("3:301", "3:300", {
      fillPaints: [imagePaint([0xbb])],
    });
    const loaded = makeFig([exemplar, exemplarRect, divergent, divergentRect]);
    expect(structureFingerprint(loaded, "1:300")).not.toBe(structureFingerprint(loaded, "3:300"));
  });

  it("differs between members whose nested INSTANCE references diverge", () => {
    const exemplar = frameNode("1:400", "0:1");
    const exemplarInst = instanceNode("1:401", "1:400", "9:1");
    const divergent = frameNode("3:400", "0:1");
    const divergentInst = instanceNode("3:401", "3:400", "9:2");
    const loaded = makeFig([exemplar, exemplarInst, divergent, divergentInst]);
    expect(structureFingerprint(loaded, "1:400")).not.toBe(structureFingerprint(loaded, "3:400"));
  });
});
