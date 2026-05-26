/**
 * @file Spec for explicit-host canvas text measurement.
 */

import { createCanvasMeasurementProvider, type CanvasTextMeasureContext } from "./provider";
import type { FontSpec } from "./types";

const INTER_REGULAR_16: FontSpec = {
  font: {
    family: "Inter",
    weight: 400,
    style: "normal",
  },
  fontSize: 16,
};

type MeasureCall = {
  readonly text: string;
  readonly font: string;
};

function createRecordingCanvasTextMeasureContext(calls: MeasureCall[]): CanvasTextMeasureContext {
  return {
    font: "",
    measureText(text: string) {
      calls.push({ text, font: this.font });
      return {
        width: text.length * 8,
        fontBoundingBoxAscent: 12,
        fontBoundingBoxDescent: 4,
        actualBoundingBoxAscent: 10,
      };
    },
  };
}

describe("createCanvasMeasurementProvider", () => {
  it("measures text through the explicit canvas context", () => {
    const calls: MeasureCall[] = [];
    const provider = createCanvasMeasurementProvider({
      context: createRecordingCanvasTextMeasureContext(calls),
    });

    expect(provider.measureText("Hi", INTER_REGULAR_16)).toEqual({
      width: 16,
      height: 16,
      ascent: 12,
      descent: 4,
    });
    expect(calls).toEqual([
      { text: "Hi", font: "400 16px Inter" },
    ]);
  });

  it("adds letter spacing to every non-final source character width", () => {
    const calls: MeasureCall[] = [];
    const provider = createCanvasMeasurementProvider({
      context: createRecordingCanvasTextMeasureContext(calls),
    });

    expect(provider.measureCharWidths).toBeDefined();
    expect(provider.measureCharWidths?.("abc", {
      ...INTER_REGULAR_16,
      letterSpacing: 2,
    })).toEqual([10, 10, 8]);
    expect(calls.map((call) => call.text)).toEqual(["a", "b", "c"]);
  });

  it("derives font metrics from required canvas metrics", () => {
    const provider = createCanvasMeasurementProvider({
      context: createRecordingCanvasTextMeasureContext([]),
    });

    expect(provider.getFontMetrics(INTER_REGULAR_16)).toEqual({
      unitsPerEm: 1000,
      ascender: 750,
      descender: -250,
      lineGap: 0,
      capHeight: 625,
    });
  });

  it("throws when canvas ascent metrics are missing", () => {
    const provider = createCanvasMeasurementProvider({
      context: {
        font: "",
        measureText() {
          return {
            width: 8,
            fontBoundingBoxDescent: 4,
          };
        },
      },
    });

    expect(() => provider.measureText("A", INTER_REGULAR_16))
      .toThrow("Canvas text measurement requires ascent metrics for font \"Inter\"");
  });
});
