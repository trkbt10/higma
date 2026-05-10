/**
 * @file Case `inferred-counter-stretch` — full-width vertical block
 * stack must produce `counterAlign: "stretch"`, not `"start"`. This
 * is what allows a downstream renderer to re-flow the children on a
 * resized INSTANCE.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import { withCounterStretchColumn } from "./fixture";

describe("case inferred-counter-stretch", () => {
  const ir = normalizeOne(withCounterStretchColumn(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("infers `direction: column` for a full-width vertical stack", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.direction).toBe("column");
  });

  it("infers `counterAlign: stretch` when children fill the parent width", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.counterAlign).toBe("stretch");
  });
});
