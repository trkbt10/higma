/**
 * @file Case `inferred-counter-center` — horizontally-symmetric block
 * stack.
 *
 * The inferer's contract here is intentionally CONSERVATIVE in the
 * multi-child case (different from the single-child `inferInset`
 * branch). Several children sharing the same left edge always
 * produce `counterAlign: "start"`, with the symmetric inset captured
 * verbatim as paddingLeft/paddingRight. Reasons:
 *
 *   - Geometry alone cannot distinguish `margin: 0 auto` on a
 *     wrapper from `padding: 0 40px` on the parent. Both produce
 *     identical child rects.
 *   - Picking `center` would re-centre the children on every resize
 *     (auto-layout's center semantics), which is wrong if the
 *     designer authored explicit parent padding.
 *   - Encoding as `start` + symmetric padding renders identically at
 *     the captured viewport and degrades gracefully on resize
 *     (children stay anchored to the left padding edge).
 *
 * If we ever invert this — say, by promoting symmetric inset to
 * `center` for some downstream re-centring use case — this case is
 * the canary that will break and force a deliberate decision.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import {
  CHILD_LEFT_INSET,
  withCounterCentredColumn,
} from "./fixture";

describe("case inferred-counter-center", () => {
  const ir = normalizeOne(withCounterCentredColumn(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("infers `direction: column` for a vertical stack", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.direction).toBe("column");
  });

  it("encodes the horizontal symmetry as `counterAlign: start` (conservative)", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.counterAlign).toBe("start");
  });

  it("recovers the symmetric horizontal inset as paddingLeft = paddingRight", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.paddingLeft).toBe(CHILD_LEFT_INSET);
    expect(frame.autoLayout.paddingRight).toBe(CHILD_LEFT_INSET);
  });
});
