/**
 * @file Case `table-basic` — `<table><tr><td>` becomes FRAME → FRAME
 * → TEXT (cell text). The hierarchy must survive.
 */
import { asFrame, asText, normalizeOne, singleChild } from "../case-ir-assertions";
import { basicTable } from "./fixture";

describe("case table-basic", () => {
  const table = asFrame(singleChild(normalizeOne(basicTable())));

  it("table is a FRAME with one row child", () => {
    expect(table.kind).toBe("frame");
    expect(table.children).toHaveLength(1);
  });

  it("row is a FRAME with two cell children", () => {
    const row = asFrame(table.children[0]!);
    expect(row.children).toHaveLength(2);
  });

  it("cells are TEXT nodes carrying the literal cell content", () => {
    const row = asFrame(table.children[0]!);
    const t1 = asText(row.children[0]!);
    const t2 = asText(row.children[1]!);
    expect(t1.characters).toBe("A");
    expect(t2.characters).toBe("B");
  });
});
