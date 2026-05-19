/**
 * @file Case `shadow-drop` — `box-shadow` becomes a `drop-shadow`
 * EffectIR with offsetX / offsetY / blurRadius / spread propagated
 * verbatim and the colour parsed.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { withDropShadow } from "./fixture";

describe("case shadow-drop", () => {
  const frame = asFrame(singleChild(normalizeOne(withDropShadow(baseDiv()))));

  it("emits one `drop-shadow` effect", () => {
    expect(frame.style.effects).toHaveLength(1);
    expect(frame.style.effects[0]!.kind).toBe("drop-shadow");
  });

  it("preserves offset, blur, and spread", () => {
    const e = frame.style.effects[0]!;
    if (e.kind !== "drop-shadow") {
      throw new Error("expected drop-shadow");
    }
    expect(e.offsetX).toBe(2);
    expect(e.offsetY).toBe(4);
    expect(e.blurRadius).toBe(8);
    expect(e.spread).toBe(1);
  });

  it("parses the leading rgba colour", () => {
    const e = frame.style.effects[0]!;
    if (e.kind !== "drop-shadow") {
      throw new Error("expected drop-shadow");
    }
    expect(e.color).toEqual({ r: 0, g: 0, b: 0, a: 0.4 });
  });

  it("emits no effect when `box-shadow: none`", () => {
    const f = asFrame(singleChild(normalizeOne(withDropShadow(baseDiv(), "none"))));
    expect(f.style.effects).toEqual([]);
  });
});
