/**
 * @file Case `ordered-list-with-markers` — `<ol>` with three `<li>`
 * children. Each `<li>` collapses to a TEXT carrying its prose; the
 * UA `::marker` pseudo is intentionally NOT spliced into the
 * characters (Figma TEXT has no list-marker affordance).
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { ITEM_COUNT, ITEM_TEXTS, orderedListWithMarkers } from "./fixture";

describe("case ordered-list-with-markers", () => {
  const ir = normalizeOne(orderedListWithMarkers());
  const olRoot = asFrame(singleChild(ir));

  it("preserves all `<li>` siblings", () => {
    expect(olRoot.children).toHaveLength(ITEM_COUNT);
  });

  it("collapses each leaf-text `<li>` to a TEXT IR carrying its prose verbatim", () => {
    for (let i = 0; i < ITEM_COUNT; i += 1) {
      const li = olRoot.children[i];
      if (!li || li.kind !== "text") {
        throw new Error(`expected <li> #${i} to be a text`);
      }
      expect(li.characters).toBe(ITEM_TEXTS[i]);
    }
  });
});
