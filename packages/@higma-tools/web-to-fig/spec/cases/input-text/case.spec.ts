/**
 * @file Case `input-text` — `<input>` becomes a FRAME with the
 * authored chrome (background + border).
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { INPUT_RECT, textInput } from "./fixture";

describe("case input-text", () => {
  const frame = asFrame(singleChild(normalizeOne(textInput())));

  it("becomes a FRAME at the input's bbox", () => {
    expect(frame.kind).toBe("frame");
    expect(frame.box).toEqual(INPUT_RECT);
  });

  it("carries the white background and grey border", () => {
    expect(frame.style.fills).toHaveLength(1);
    expect(frame.style.strokes).toHaveLength(1);
    expect(frame.style.strokes[0]!.weight).toBe(1);
  });
});
