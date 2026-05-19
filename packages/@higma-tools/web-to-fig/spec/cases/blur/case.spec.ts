/**
 * @file Case `blur` — `filter: blur(Npx)` becomes a `layer-blur`
 * EffectIR with the px value as `radius`.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_BLUR_PX, withBlur } from "./fixture";

describe("case blur", () => {
  const frame = asFrame(singleChild(normalizeOne(withBlur(baseDiv()))));

  it("emits exactly one effect", () => {
    expect(frame.style.effects).toHaveLength(1);
  });

  it("the effect is `layer-blur` with the authored px radius", () => {
    const effect = frame.style.effects[0]!;
    if (effect.kind !== "layer-blur") {
      throw new Error("expected layer-blur");
    }
    expect(effect.radius).toBe(DEFAULT_BLUR_PX);
  });
});
