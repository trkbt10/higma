/**
 * @file Case `position-absolute-in-relative` — absolute child stays
 * in the parent's children list (not lifted to viewportLayer) but
 * carries `sizing: { mode: "absolute" }` so the parent's autoLayout
 * inferer treats it as out-of-flow.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { relativeWithAbsoluteBadge } from "./fixture";

describe("case position-absolute-in-relative", () => {
  const ir = normalizeOne(relativeWithAbsoluteBadge());
  const parent = asFrame(singleChild(ir));

  it("absolute child remains in the parent's children list (not lifted)", () => {
    expect(parent.children).toHaveLength(1);
    expect(ir.viewportLayer).toHaveLength(0);
  });

  it("absolute child carries `sizing: { mode: absolute }`", () => {
    const child = parent.children[0]!;
    expect(child.sizing.mode).toBe("absolute");
  });

  it("parent does not infer auto-layout from the lone out-of-flow child", () => {
    expect(parent.autoLayout.direction).toBe("none");
  });
});
