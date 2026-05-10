/**
 * @file Case `text-decoration` — `text-decoration-line` propagates to
 * `textStyle.textDecoration` for both supported variants.
 */
import { asText, normalizeOne, singleChild } from "../_helpers";
import { textLeafWithDecoration } from "./fixture";

describe("case text-decoration", () => {
  it("encodes underline", () => {
    const text = asText(singleChild(normalizeOne(textLeafWithDecoration("underline"))));
    expect(text.textStyle.textDecoration).toBe("underline");
  });

  it("encodes line-through", () => {
    const text = asText(singleChild(normalizeOne(textLeafWithDecoration("line-through"))));
    expect(text.textStyle.textDecoration).toBe("line-through");
  });
});
