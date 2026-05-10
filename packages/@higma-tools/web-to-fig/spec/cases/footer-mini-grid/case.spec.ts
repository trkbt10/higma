/**
 * @file Case `footer-mini-grid` — `<footer>` row of three column
 * wrappers. Asserts row direction on the footer (explicit flex) and
 * column direction inferred on each wrapper (no explicit flex).
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import {
  COLUMN_GAP,
  COLUMN_HEADINGS,
  LINKS_PER_COLUMN,
  footerMiniGrid,
} from "./fixture";

describe("case footer-mini-grid", () => {
  const ir = normalizeOne(footerMiniGrid());
  const footer = asFrame(singleChild(ir));

  it("preserves all three columns", () => {
    expect(footer.children).toHaveLength(COLUMN_HEADINGS.length);
  });

  it("recovers row autoLayout on the footer (explicit flex)", () => {
    if (footer.autoLayout.direction === "none") {
      throw new Error("expected footer row autoLayout");
    }
    expect(footer.autoLayout.direction).toBe("row");
    expect(footer.autoLayout.gap).toBe(COLUMN_GAP);
  });

  it("infers column autoLayout on each column wrapper (no explicit flex)", () => {
    for (const column of footer.children) {
      if (column.kind !== "frame") {
        throw new Error("expected column to be a frame");
      }
      if (column.autoLayout.direction === "none") {
        throw new Error("expected column autoLayout");
      }
      expect(column.autoLayout.direction).toBe("column");
    }
  });

  it("preserves the link list inside each column", () => {
    for (const column of footer.children) {
      if (column.kind !== "frame") {
        throw new Error("expected column to be a frame");
      }
      const ul = column.children[column.children.length - 1];
      if (!ul || ul.kind !== "frame") {
        throw new Error("expected ul frame in column");
      }
      expect(ul.children).toHaveLength(LINKS_PER_COLUMN.length);
    }
  });
});
