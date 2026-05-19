/**
 * @file Case `table-cell-spans` — colspan/rowspan come through as
 * geometry only. The wide cell's IR box width matches the spanned
 * width; the remaining cells in subsequent rows sit at their own
 * column origins.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { SPANNED_CELL_WIDTH, SINGLE_CELL_WIDTH, tableWithColspan } from "./fixture";

describe("case table-cell-spans", () => {
  const table = asFrame(singleChild(normalizeOne(tableWithColspan())));

  it("first row's cell box width equals the spanned width", () => {
    const row1 = asFrame(table.children[0]!);
    expect(row1.children).toHaveLength(1);
    expect(row1.children[0]!.box.width).toBe(SPANNED_CELL_WIDTH);
  });

  it("second row has two single-column cells at their own origins", () => {
    const row2 = asFrame(table.children[1]!);
    expect(row2.children).toHaveLength(2);
    expect(row2.children[0]!.box.x).toBe(0);
    expect(row2.children[1]!.box.x).toBe(SINGLE_CELL_WIDTH);
    expect(row2.children[0]!.box.width).toBe(SINGLE_CELL_WIDTH);
    expect(row2.children[1]!.box.width).toBe(SINGLE_CELL_WIDTH);
  });
});
