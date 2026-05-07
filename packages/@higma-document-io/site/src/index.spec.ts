/**
 * @file Site IO roundtrip export tests.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSampleFigPayload } from "@higma-codecs/kiwi/test-helpers";
import { buildFigCanvasHeader } from "@higma-figma-containers/canvas";
import { loadFigFamilyFile, saveFigFamilyFile } from "@higma-figma-runtime/roundtrip";

import { exportEditedSiteDocument, loadSiteDocumentResult } from "./index";

const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const FIG_SAMPLE_FILE = join(SPEC_DIR, "../../fig/samples/sample-file.fig");

function buildSiteBytes(): Uint8Array {
  const sample = createSampleFigPayload();
  const header = buildFigCanvasHeader(sample.schemaChunkSize, "0", "fig-site");
  const file = new Uint8Array(header.length + sample.payload.length);
  file.set(header, 0);
  file.set(sample.payload, header.length);
  return file;
}

function readNodeNumber(node: Record<string, unknown>, fieldName: string): number {
  const value = node[fieldName];
  if (typeof value === "number") {
    return value;
  }
  throw new Error(`Expected node field ${fieldName} to be a number`);
}

function readGuid(node: Record<string, unknown>): string {
  const guid = node.guid as { readonly sessionID?: unknown; readonly localID?: unknown } | undefined;
  if (!guid) {
    throw new Error("Expected test node to have guid");
  }
  const sessionID = guid.sessionID;
  const localID = guid.localID;
  if (typeof sessionID !== "number" || typeof localID !== "number") {
    throw new Error("Expected test node guid fields to be numbers");
  }
  return `${sessionID}:${localID}`;
}

function readTransform(node: Record<string, unknown>): Record<string, unknown> {
  const transform = node.transform;
  if (transform && typeof transform === "object") {
    return transform as Record<string, unknown>;
  }
  throw new Error("Expected test node to have transform");
}

function findNamedNode(nodes: readonly Record<string, unknown>[], name: string): Record<string, unknown> {
  const node = nodes.find((item) => item.name === name);
  if (node) {
    return node;
  }
  throw new Error(`Expected fixture node ${name}`);
}

describe("site document roundtrip export", () => {
  it("decodes raw site canvas bytes into a product document and reusable facts", async () => {
    const result = await loadSiteDocumentResult(buildSiteBytes());

    expect(result.document.kind).toBe("site");
    expect(result.document.summary.totalNodes).toBe(5);
    expect(result.document.insights.schema.definitionCount).toBeGreaterThan(0);
    expect(result.facts.summary.totalNodes).toBe(5);
  });

  it("persists editor unit moves after save and reload", async () => {
    const sourceData = await readFile(FIG_SAMPLE_FILE);
    const sourceLoaded = await loadFigFamilyFile<Record<string, unknown>>(new Uint8Array(sourceData));
    const siteData = await saveFigFamilyFile(sourceLoaded, { canvasMagic: "fig-site" });
    const targetNode = findNamedNode(sourceLoaded.nodeChanges, "Membership");
    const targetId = readGuid(targetNode);
    const targetTransform = readTransform(targetNode);

    const editedData = await exportEditedSiteDocument(siteData, {
      unitMoves: [{ unitId: targetId, deltaX: 24, deltaY: 9 }],
      cmsFieldEdits: [],
    });
    const editedLoaded = await loadFigFamilyFile<Record<string, unknown>>(editedData);
    const editedNode = findNamedNode(editedLoaded.nodeChanges, "Membership");
    const editedTransform = readTransform(editedNode);

    expect(editedLoaded.canvasMagic).toBe("fig-site");
    expect(readNodeNumber(editedTransform, "m02")).toBe(readNodeNumber(targetTransform, "m02") + 24);
    expect(readNodeNumber(editedTransform, "m12")).toBe(readNodeNumber(targetTransform, "m12") + 9);
  });
});
