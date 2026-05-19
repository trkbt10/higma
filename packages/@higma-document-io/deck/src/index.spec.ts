/**
 * @file Deck document IO contract tests.
 */

import { createSampleFigPayload } from "@higma-codecs/kiwi/test-fixtures";
import { buildFigCanvasHeader } from "@higma-figma-containers/canvas";

import { loadDeckDocumentResult } from ".";

function buildDeckBytes(): Uint8Array {
  const sample = createSampleFigPayload();
  const header = buildFigCanvasHeader(sample.schemaChunkSize, "0", "fig-deck");
  const file = new Uint8Array(header.length + sample.payload.length);
  file.set(header, 0);
  file.set(sample.payload, header.length);
  return file;
}

describe("loadDeckDocumentResult", () => {
  it("decodes raw deck canvas bytes into a product document and reusable facts", async () => {
    const result = await loadDeckDocumentResult(buildDeckBytes());

    expect(result.document.kind).toBe("deck");
    expect(result.document.summary.totalNodes).toBe(5);
    expect(result.document.insights.schema.definitionCount).toBeGreaterThan(0);
    expect(result.facts.summary.totalNodes).toBe(5);
  });
});
