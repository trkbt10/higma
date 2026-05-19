/**
 * @file Case `table-with-caption-and-thead` — full table tree shape:
 * `<table>` → [caption(TEXT), thead(FRAME), tbody(FRAME)] →
 * tr(FRAME) → cells. Asserts the structural nesting survives the
 * normaliser end-to-end (no row-group flattening, no caption merge).
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { CAPTION_TEXT, tableWithCaptionAndThead } from "./fixture";

describe("case table-with-caption-and-thead", () => {
  const ir = normalizeOne(tableWithCaptionAndThead());
  const table = asFrame(singleChild(ir));

  it("preserves caption + thead + tbody as three children of the `<table>`", () => {
    expect(table.children).toHaveLength(3);
  });

  it("collapses the `<caption>` to a TEXT IR carrying the caption verbatim", () => {
    const caption = table.children[0];
    if (!caption || caption.kind !== "text") {
      throw new Error("expected caption to be a text");
    }
    expect(caption.characters).toBe(CAPTION_TEXT);
  });

  it("keeps `<thead>` as a FRAME wrapping a single `<tr>`", () => {
    const thead = table.children[1];
    if (!thead || thead.kind !== "frame") {
      throw new Error("expected thead to be a frame");
    }
    expect(thead.children).toHaveLength(1);
  });

  it("keeps `<tbody>` as a FRAME wrapping a single `<tr>`", () => {
    const tbody = table.children[2];
    if (!tbody || tbody.kind !== "frame") {
      throw new Error("expected tbody to be a frame");
    }
    expect(tbody.children).toHaveLength(1);
  });

  it("preserves both header `<th>` cells as TEXT children of the header row", () => {
    const thead = table.children[1];
    if (!thead || thead.kind !== "frame") {
      throw new Error("expected thead frame");
    }
    const headerRow = thead.children[0];
    if (!headerRow || headerRow.kind !== "frame") {
      throw new Error("expected header row to be a frame");
    }
    expect(headerRow.children).toHaveLength(2);
    for (const cell of headerRow.children) {
      expect(cell.kind).toBe("text");
    }
  });
});
