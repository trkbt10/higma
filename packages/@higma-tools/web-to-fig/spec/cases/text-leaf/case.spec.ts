/**
 * @file Case `text-leaf` — leaf text with explicit font family / size /
 * weight / colour produces a TextNodeIR with the requested base style
 * and the colour landing on `style.fills` as a SOLID paint.
 */
import { asText, normalizeOne, singleChild } from "../_helpers";
import { recordingFontResolver, staticFontResolver } from "../../test-font-resolver";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE_PX,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_TEXT,
  textLeaf,
} from "./fixture";

describe("case text-leaf", () => {
  // A resolver that returns the literal authored family name lets the
  // first three tests inspect the unrelated `textStyle` fields (size,
  // weight, colour) without coupling them to font-resolver semantics.
  const passthrough = staticFontResolver(DEFAULT_FONT_FAMILY);
  const text = asText(singleChild(normalizeOne(textLeaf(), { fontResolver: passthrough })));

  it("emits a TEXT node carrying the literal characters", () => {
    expect(text.kind).toBe("text");
    expect(text.characters).toBe(DEFAULT_TEXT);
  });

  it("carries the authored font family / size / weight on textStyle", () => {
    expect(text.textStyle.fontFamily).toBe(DEFAULT_FONT_FAMILY);
    expect(text.textStyle.fontSize).toBe(DEFAULT_FONT_SIZE_PX);
    expect(text.textStyle.fontWeight).toBe(DEFAULT_FONT_WEIGHT);
  });

  it("text colour lands on `style.fills` as a SOLID paint", () => {
    expect(text.style.fills).toHaveLength(1);
    const fill = text.style.fills[0]!;
    if (fill.kind !== "solid") {
      throw new Error("expected SOLID text fill");
    }
    // DEFAULT_TEXT_COLOR is rgb(20, 30, 40).
    expect(fill.color.r).toBeCloseTo(20 / 255, 3);
    expect(fill.color.g).toBeCloseTo(30 / 255, 3);
    expect(fill.color.b).toBeCloseTo(40 / 255, 3);
  });

  it("passes the parsed font-family stack through the FontResolver in source order", () => {
    const recorder = recordingFontResolver("Inter Resolved");
    const text = asText(
      singleChild(
        normalizeOne(textLeaf({ fontFamily: '"Inter", "Helvetica", sans-serif' }), {
          fontResolver: recorder.resolver,
        }),
      ),
    );
    expect(text.textStyle.fontFamily).toBe("Inter Resolved");
    // The resolver must have received the full parsed stack — *not*
    // a pre-truncated first-name shortcut. Otherwise the caller would
    // never get to see `"Helvetica"` or the trailing generic family.
    expect(recorder.calls.length).toBeGreaterThan(0);
    const lastCall = recorder.calls[recorder.calls.length - 1]!;
    expect(lastCall).toEqual([
      { kind: "name", value: "Inter" },
      { kind: "name", value: "Helvetica" },
      { kind: "generic", value: "sans-serif" },
    ]);
  });
});
