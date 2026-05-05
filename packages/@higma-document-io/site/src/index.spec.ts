/**
 * @file Site document IO contract tests.
 */

import { createSampleFigPayload } from "@higma-codecs/kiwi/test-helpers";
import { buildFigCanvasHeader } from "@higma-figma-containers/canvas";

import { loadSiteDocumentResult } from ".";

function buildSiteBytes(): Uint8Array {
  const sample = createSampleFigPayload();
  const header = buildFigCanvasHeader(sample.schemaChunkSize, "0", "fig-site");
  const file = new Uint8Array(header.length + sample.payload.length);
  file.set(header, 0);
  file.set(sample.payload, header.length);
  return file;
}

describe("loadSiteDocumentResult", () => {
  it("decodes raw site canvas bytes into a product document and reusable facts", async () => {
    const result = await loadSiteDocumentResult(buildSiteBytes());

    expect(result.document.kind).toBe("site");
    expect(result.document.summary.totalNodes).toBe(5);
    expect(result.document.insights.schema.definitionCount).toBeGreaterThan(0);
    expect(result.facts.summary.totalNodes).toBe(5);
  });
});
