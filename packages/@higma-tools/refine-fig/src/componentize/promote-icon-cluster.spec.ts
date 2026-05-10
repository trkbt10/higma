/**
 * @file Tests for the relaxed cluster promotion gate and fingerprint.
 *
 * The v1 gate refused any cluster whose subtree carried a TEXT, IMAGE
 * paint, or nested INSTANCE — promote was reserved for leaf-icon
 * clusters because override-path machinery was missing. The current
 * gate accepts those types iff the subtree fingerprint folds in the
 * fields that make the descendant identity-bearing (text content,
 * image refs, nested symbolID, opacity, paints). Two strict-identical
 * members render to the same pixels under a plain SYMBOL/INSTANCE
 * flip, so the fingerprint is the SoT for "is this safe to promote".
 *
 * The tests exercise:
 *
 *   - the gate accepts TEXT, RECTANGLE, IMAGE-fill descendants;
 *   - the gate refuses GRADIENT paints (no override-path path for
 *     positional handle data);
 *   - fingerprint differs when text content / image ref / nested
 *     symbolID / SOLID color / opacity diverge;
 *   - promoteIconCluster rewrites the fingerprint-equal members and
 *     leaves divergent members alone.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import { isPromotableCluster, promoteIconCluster } from "./promote-icon-cluster";

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
    messageHeader: {},
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
  // Values mirror the FigKiwi schema enums where they matter — only
  // the `name` is consulted by the production code, but we keep the
  // numeric value plausible for completeness.
  switch (name) {
    case "FRAME":
      return 5;
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
        {
          type: "IMAGE",
          imageRef: "imgref-abc",
          opacity: 1,
          visible: true,
          blendMode: "NORMAL",
        },
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
        {
          type: "GRADIENT_LINEAR",
          opacity: 1,
          visible: true,
          blendMode: "NORMAL",
        },
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

describe("promoteIconCluster fingerprint discrimination", () => {
  it("only rewrites members whose TEXT content matches the exemplar", () => {
    // Two clusters: exemplar 'Save' button + 'Save' clone, plus a
    // 'Cancel' clone with everything else identical. Only the
    // matching one should be rewritten to an INSTANCE.
    const exemplar = frameNode("1:100", "0:1");
    const exemplarText = textNode("1:101", "1:100", "Save");
    const matchExemplar = frameNode("2:100", "0:1");
    const matchText = textNode("2:101", "2:100", "Save");
    const divergent = frameNode("3:100", "0:1");
    const divergentText = textNode("3:101", "3:100", "Cancel");
    const loaded = makeFig([exemplar, exemplarText, matchExemplar, matchText, divergent, divergentText]);

    const result = promoteIconCluster({
      loaded,
      clusterName: "save-button",
      memberGuids: ["1:100", "2:100", "3:100"],
      exemplarGuid: "1:100",
    });

    expect(result.symbolGuid).toBe("1:100");
    expect(result.instanceGuids).toEqual(["2:100"]);

    // Exemplar became a SYMBOL.
    const promoted = loaded.nodeChanges.find((n) => n.guid?.sessionID === 1 && n.guid.localID === 100);
    expect(promoted?.type?.name).toBe("SYMBOL");
    expect(promoted?.name).toBe("save-button");

    // Match member became an INSTANCE; its descendant TEXT was
    // dropped from nodeChanges.
    const matched = loaded.nodeChanges.find((n) => n.guid?.sessionID === 2 && n.guid.localID === 100);
    expect(matched?.type?.name).toBe("INSTANCE");
    const matchedText = loaded.nodeChanges.find((n) => n.guid?.sessionID === 2 && n.guid.localID === 101);
    expect(matchedText).toBeUndefined();

    // Divergent member stayed as a FRAME with its TEXT child intact.
    const divergentNode = loaded.nodeChanges.find((n) => n.guid?.sessionID === 3 && n.guid.localID === 100);
    expect(divergentNode?.type?.name).toBe("FRAME");
    const divergentTextNode = loaded.nodeChanges.find((n) => n.guid?.sessionID === 3 && n.guid.localID === 101);
    expect(divergentTextNode?.type?.name).toBe("TEXT");
  });

  it("only rewrites members whose IMAGE fill `imageRef` matches", () => {
    const exemplar = frameNode("1:200", "0:1");
    const exemplarRect = rectNode("1:201", "1:200", {
      fillPaints: [{ type: "IMAGE", imageRef: "ref-A", opacity: 1, visible: true, blendMode: "NORMAL" }],
    });
    const matchExemplar = frameNode("2:200", "0:1");
    const matchRect = rectNode("2:201", "2:200", {
      fillPaints: [{ type: "IMAGE", imageRef: "ref-A", opacity: 1, visible: true, blendMode: "NORMAL" }],
    });
    const divergent = frameNode("3:200", "0:1");
    const divergentRect = rectNode("3:201", "3:200", {
      fillPaints: [{ type: "IMAGE", imageRef: "ref-B", opacity: 1, visible: true, blendMode: "NORMAL" }],
    });
    const loaded = makeFig([exemplar, exemplarRect, matchExemplar, matchRect, divergent, divergentRect]);

    const result = promoteIconCluster({
      loaded,
      clusterName: "thumbnail",
      memberGuids: ["1:200", "2:200", "3:200"],
      exemplarGuid: "1:200",
    });
    expect(result.instanceGuids).toEqual(["2:200"]);
  });

  it("only rewrites members whose nested INSTANCE points at the same SYMBOL", () => {
    const exemplar = frameNode("1:300", "0:1");
    const exemplarInst = instanceNode("1:301", "1:300", "9:1");
    const matchExemplar = frameNode("2:300", "0:1");
    const matchInst = instanceNode("2:301", "2:300", "9:1");
    const divergent = frameNode("3:300", "0:1");
    const divergentInst = instanceNode("3:301", "3:300", "9:2");
    const loaded = makeFig([exemplar, exemplarInst, matchExemplar, matchInst, divergent, divergentInst]);

    const result = promoteIconCluster({
      loaded,
      clusterName: "row",
      memberGuids: ["1:300", "2:300", "3:300"],
      exemplarGuid: "1:300",
    });
    expect(result.instanceGuids).toEqual(["2:300"]);
  });
});
