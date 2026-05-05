/**
 * @file Buzz document IO contract tests.
 */

import { createSampleFigPayload } from "@higma-codecs/kiwi/test-helpers";
import { buildFigCanvasHeader } from "@higma-figma-containers/canvas";

import { loadBuzzDocumentResult } from ".";

function buildBuzzBytes(): Uint8Array {
  const sample = createSampleFigPayload();
  const header = buildFigCanvasHeader(sample.schemaChunkSize, "0", "fig-buzz");
  const file = new Uint8Array(header.length + sample.payload.length);
  file.set(header, 0);
  file.set(sample.payload, header.length);
  return file;
}

describe("loadBuzzDocumentResult", () => {
  it("decodes raw buzz canvas bytes into a product document and reusable facts", async () => {
    const result = await loadBuzzDocumentResult(buildBuzzBytes());

    expect(result.document.kind).toBe("buzz");
    expect(result.document.summary.totalNodes).toBe(5);
    expect(result.document.insights.schema.definitionCount).toBeGreaterThan(0);
    expect(result.facts.summary.totalNodes).toBe(5);
  });
});
