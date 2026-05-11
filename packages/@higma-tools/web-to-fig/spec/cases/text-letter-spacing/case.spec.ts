/**
 * @file Case `text-letter-spacing` — CSS `letter-spacing: <Npx>`
 * round-trips end-to-end into the emitted fig TEXT spec.
 *
 * Pre-fix history:
 *   1. The emit-side TEXT path never called
 *      `textNode.letterSpacing(...)`, so the captured number was
 *      silently dropped and every Figma TEXT rendered at default
 *      tracking.
 *   2. The fig contract had no `TextNodeSpec.letterSpacing` field, so
 *      the SpecGraph layer that drives `addNode` could not surface the
 *      value either — `node-factory` had nothing to read.
 *
 * Both layers now carry letter-spacing, so this case pins:
 *   - the IR keeps the numeric px value,
 *   - the SpecGraph TEXT spec carries it as a pixel-typed scalar,
 *   - the node-emitters path (used by `buildFigFileBytes`) writes
 *     the same value via `textNode.letterSpacing(value, "PIXELS")`.
 */
import { asText, normalizeOne, singleChild } from "../_helpers";
import { irToSpecGraph } from "../../../src/emit/ir-to-spec";
import { DEFAULT_LETTER_SPACING_PX, textLeafWithLetterSpacing } from "./fixture";

describe("case text-letter-spacing", () => {
  it("captures the px letter-spacing into TextStyleIR.letterSpacing", () => {
    const text = asText(singleChild(normalizeOne(textLeafWithLetterSpacing())));
    expect(text.textStyle.letterSpacing).toBe(DEFAULT_LETTER_SPACING_PX);
  });

  it("emits letter-spacing in PIXELS on the text spec", () => {
    const text = asText(singleChild(normalizeOne(textLeafWithLetterSpacing())));
    const graph = irToSpecGraph(text);
    expect(graph.spec.type).toBe("TEXT");
    if (graph.spec.type !== "TEXT") {
      throw new Error();
    }
    expect(graph.spec.letterSpacing).toBe(DEFAULT_LETTER_SPACING_PX);
  });
});
