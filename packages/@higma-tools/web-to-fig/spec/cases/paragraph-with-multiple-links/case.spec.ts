/**
 * @file Case `paragraph-with-multiple-links` — Wikipedia-style
 * paragraph prose. Asserts:
 *
 *   - The `<p>` collapses to a single TEXT IR.
 *   - Characters interleave prose and link labels in document order.
 *   - The two anchor runs survive as SEPARATE TextRunIR entries
 *     (they're the same blue colour but separated by unstyled prose,
 *     so coalescing them would re-colour the gap text).
 */
import { asText, normalizeOne, singleChild } from "../_helpers";
import {
  FIRST_LINK,
  MIDDLE,
  PREFIX,
  SECOND_LINK,
  SUFFIX,
  paragraphWithMultipleLinks,
} from "./fixture";

describe("case paragraph-with-multiple-links", () => {
  const ir = normalizeOne(paragraphWithMultipleLinks());
  const text = asText(singleChild(ir));

  it("interleaves prose and link labels in document order", () => {
    expect(text.characters).toBe(`${PREFIX}${FIRST_LINK}${MIDDLE}${SECOND_LINK}${SUFFIX}`);
  });

  it("emits exactly one run per `<a>` (no coalescing across the prose gap)", () => {
    const runs = text.runs ?? [];
    expect(runs).toHaveLength(2);
  });

  it("anchors both runs to the link character ranges", () => {
    const runs = text.runs ?? [];
    if (runs.length < 2) {
      throw new Error("expected two link runs");
    }
    const firstStart = PREFIX.length;
    const firstEnd = firstStart + FIRST_LINK.length;
    const secondStart = firstEnd + MIDDLE.length;
    const secondEnd = secondStart + SECOND_LINK.length;
    expect(runs[0]!.start).toBe(firstStart);
    expect(runs[0]!.end).toBe(firstEnd);
    expect(runs[1]!.start).toBe(secondStart);
    expect(runs[1]!.end).toBe(secondEnd);
  });
});
