/**
 * @file Case `float-image-shadow` — verify two related contracts at
 * once:
 *
 *   1. A `float: left` child carries `sizing.mode: "absolute"` so the
 *      auto-layout inferer skips it (it's out of inline flow per CSS).
 *   2. The float's `box-shadow` survives onto the IR as a drop-shadow
 *      effect — float doesn't strip the captured CSS chrome.
 *
 * Without (1), the inferer would mix the float's rect with the
 * surrounding `<p>`'s and derive a noisy row/column; without (2) the
 * shadow would silently vanish on every floated thumbnail.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { floatedImageWithShadow } from "./fixture";

describe("case float-image-shadow", () => {
  const container = asFrame(singleChild(normalizeOne(floatedImageWithShadow())));

  it("container has two children (the floated div + the in-flow text host)", () => {
    expect(container.children).toHaveLength(2);
  });

  it("the floated child is marked `sizing.mode: absolute` so auto-layout inference skips it", () => {
    const floated = container.children.find((c) => c.id === "floated");
    if (!floated) {
      throw new Error("expected the floated child to survive");
    }
    expect(floated.sizing.mode).toBe("absolute");
  });

  it("the floated child preserves its `box-shadow` as a drop-shadow effect", () => {
    const floated = container.children.find((c) => c.id === "floated");
    if (!floated || floated.kind !== "frame") {
      throw new Error("expected the floated child as a frame");
    }
    expect(floated.style.effects.length).toBeGreaterThan(0);
    const drop = floated.style.effects.find((e) => e.kind === "drop-shadow");
    if (!drop || drop.kind !== "drop-shadow") {
      throw new Error("expected drop-shadow effect");
    }
    expect(drop.offsetX).toBe(2);
    expect(drop.offsetY).toBe(4);
    expect(drop.blurRadius).toBe(8);
  });
});
