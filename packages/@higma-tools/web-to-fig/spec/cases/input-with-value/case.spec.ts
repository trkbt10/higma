/**
 * @file Case `input-with-value` — `<input>` with text value lifts to
 * a chrome FRAME holding the border + background, with an inner
 * TEXT carrying the value. The TEXT must request vertical centring
 * because UA `<input>` chrome paints the value baseline-centred,
 * regardless of the captured `display` value.
 */
import { asFrame, asText, normalizeOne, singleChild } from "../_helpers";
import { INPUT_VALUE, inputWithValue } from "./fixture";

describe("case input-with-value", () => {
  const frame = asFrame(singleChild(normalizeOne(inputWithValue())));

  it("promotes to a FRAME (chrome carries border + background)", () => {
    expect(frame.kind).toBe("frame");
    expect(frame.style.fills).toHaveLength(1);
    expect(frame.style.strokes).toHaveLength(1);
  });

  it("inner TEXT carries the input value verbatim", () => {
    expect(frame.children).toHaveLength(1);
    const text = asText(frame.children[0]!);
    expect(text.characters).toBe(INPUT_VALUE);
  });

  it("inner TEXT requests vertical centring (UA `<input>` chrome anchor)", () => {
    const text = asText(frame.children[0]!);
    expect(text.textStyle.textAlignVertical).toBe("center");
  });

  it("inner TEXT lives inside the chrome's content rect (excludes border + padding)", () => {
    const text = asText(frame.children[0]!);
    // 240×36 input with 1px border (×2) + 8px padding-left/right ⇒
    // content rect 222×34 starting at (1+8, 1+0) = (9, 1).
    expect(text.box.x).toBe(9);
    expect(text.box.y).toBe(1);
    expect(text.box.width).toBe(222);
    expect(text.box.height).toBe(34);
  });
});
