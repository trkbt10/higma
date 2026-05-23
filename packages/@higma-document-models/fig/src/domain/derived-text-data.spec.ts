/** @file Specs for Kiwi derivedTextData visual invalidation. */

import { derivedTextDataHasVisualPayload, derivedTextDataWithoutVisualPayload } from "./derived-text-data";
import type { FigDerivedTextData } from "../types";

const METRIC_BASELINE = {
  position: { x: 4, y: 20 },
  width: 120,
  lineY: 0,
  lineHeight: 24,
  lineAscent: 18,
  firstCharacter: 0,
  endCharacter: 5,
} as const;

const FONT_META_DATA = {
  key: { family: "Poppins", style: "Regular" },
  fontLineHeight: 1.2,
  fontWeight: 400,
} as const;

describe("derivedTextDataWithoutVisualPayload", () => {
  it("keeps Kiwi font metrics while dropping stale visual payload after character edits", () => {
    const dtd: FigDerivedTextData = {
      layoutSize: { x: 120, y: 24 },
      baselines: [METRIC_BASELINE],
      fontMetaData: [FONT_META_DATA],
      glyphs: [{
        commandsBlob: 0,
        position: { x: 0, y: 18 },
        fontSize: 20,
        firstCharacter: 0,
        advance: 12,
      }],
      decorations: [{ rects: [{ x: 0, y: 20, w: 40, h: 1 }] }],
      derivedLines: [{ characters: "Hello", width: 40 }],
      truncationStartIndex: 3,
      truncatedHeight: 20,
    };

    const metricsOnly = derivedTextDataWithoutVisualPayload(dtd);

    expect(metricsOnly).toEqual({
      fontMetaData: [FONT_META_DATA],
    });
    expect(derivedTextDataHasVisualPayload(metricsOnly)).toBe(false);
  });

  it("returns undefined when visual payload has no reusable Kiwi font metrics", () => {
    const dtd: FigDerivedTextData = {
      glyphs: [{
        commandsBlob: 0,
        position: { x: 0, y: 18 },
        fontSize: 20,
        firstCharacter: 0,
        advance: 12,
      }],
    };

    expect(derivedTextDataWithoutVisualPayload(dtd)).toBeUndefined();
  });
});
