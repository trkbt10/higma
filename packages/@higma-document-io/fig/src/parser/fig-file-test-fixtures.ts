/**
 * @file Fig-family raw canvas file fixtures.
 */

import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import {
  buildTestFigPayload,
  createSampleFigPayload,
} from "@higma-codecs/kiwi/test-fixtures";
import { buildFigCanvasFile } from "@higma-figma-containers/canvas";

/** Build a raw fig-family canvas file from Kiwi test data. */
export function buildTestFigFile(
  schema: KiwiSchema,
  messageData: Uint8Array,
): Uint8Array {
  const { payload, schemaChunkSize } = buildTestFigPayload(schema, messageData);
  return buildFigCanvasFile(payload, "0", "fig-kiwi").map((byte, index) => {
    if (index < 12 || index > 15) {
      return byte;
    }
    const shift = (index - 12) * 8;
    return (schemaChunkSize >> shift) & 0xff;
  });
}

/** Create a sample raw fig-family canvas file for parser tests. */
export function createSampleFigFile(): {
  readonly file: Uint8Array;
  readonly schema: KiwiSchema;
  readonly expectedNodes: readonly { readonly name: string; readonly type: string }[];
} {
  const sample = createSampleFigPayload();
  return {
    file: buildFigCanvasFile(sample.payload, "0", "fig-kiwi").map((byte, index) => {
      if (index < 12 || index > 15) {
        return byte;
      }
      const shift = (index - 12) * 8;
      return (sample.schemaChunkSize >> shift) & 0xff;
    }),
    schema: sample.schema,
    expectedNodes: sample.expectedNodes,
  };
}
