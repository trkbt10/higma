/**
 * @file Document fact loading contract tests.
 */

import type { FigSchemaProfile } from "@higma-figma-schema/profiles";
import type { FigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";

import { createFigmaDocumentFacts } from ".";

const profile: FigSchemaProfile = {
  name: "deck",
  magic: "fig-deck",
  extension: ".deck",
  domain: "presentation",
};

describe("loadFigmaDocumentFacts", () => {
  it("rejects a raw canvas with the wrong product magic before product model creation", async () => {
    const canvas: FigmaKiwiCanvas = {
      header: { magic: "fig-buzz", version: "0", payloadSize: 0 },
      schema: { definitions: [] },
      message: {},
      nodeChanges: [],
      blobs: [],
      images: new Map(),
      metadata: null,
      thumbnail: null,
    };

    expect(() => createFigmaDocumentFacts(canvas, profile)).toThrow("Expected deck canvas magic fig-deck");
  });
});
