/**
 * @file Case `select-element` — `<select>` becomes a FRAME at its
 * bbox; invisible `<option>` children are filtered out of the IR.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { SELECT_RECT, selectWithOptions } from "./fixture";

describe("case select-element", () => {
  const frame = asFrame(singleChild(normalizeOne(selectWithOptions())));

  it("becomes a FRAME at the select's bbox", () => {
    expect(frame.box).toEqual(SELECT_RECT);
  });

  it("filters out invisible <option> children", () => {
    expect(frame.children).toHaveLength(0);
  });

  it("carries the select chrome (background + border)", () => {
    expect(frame.style.fills).toHaveLength(1);
    expect(frame.style.strokes).toHaveLength(1);
  });
});
