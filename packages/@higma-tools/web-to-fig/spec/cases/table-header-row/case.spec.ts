/**
 * @file Case `table-header-row` — header `<th>` retains the bold
 * weight from `font-weight: 700`; the table topology is preserved.
 */
import { asFrame, asText, normalizeOne, singleChild } from "../case-ir-assertions";
import { tableWithHeaderRow } from "./fixture";

describe("case table-header-row", () => {
  const table = asFrame(singleChild(normalizeOne(tableWithHeaderRow())));

  it("table has thead and tbody as children", () => {
    expect(table.children).toHaveLength(2);
  });

  it("header <th> text carries fontWeight 700 (bold)", () => {
    const thead = asFrame(table.children[0]!);
    const headerRow = asFrame(thead.children[0]!);
    const th = asText(headerRow.children[0]!);
    expect(th.characters).toBe("Name");
    expect(th.textStyle.fontWeight).toBe(700);
  });

  it("body <td> text carries the default fontWeight", () => {
    const tbody = asFrame(table.children[1]!);
    const bodyRow = asFrame(tbody.children[0]!);
    const td = asText(bodyRow.children[0]!);
    expect(td.characters).toBe("Alice");
    expect(td.textStyle.fontWeight).toBe(400);
  });
});
