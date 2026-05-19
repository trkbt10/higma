/** @file Outline Kiwi node operation tests. */

import { getNodeType } from "@higma-document-models/fig/domain";
import { sectionNode } from "../section-specimen";
import { canOutlineKiwiNode, outlineKiwiNode } from "./outline-node";

describe("outlineKiwiNode", () => {
  it("converts a rounded rectangle into a VECTOR with the same Kiwi guid", () => {
    const node = sectionNode("ROUNDED_RECTANGLE", {
      name: "Card",
      width: 120,
      height: 80,
      cornerRadius: 12,
    });
    const outlined = outlineKiwiNode(node);

    expect(getNodeType(outlined)).toBe("VECTOR");
    expect(outlined.guid).toEqual(node.guid);
    expect(outlined.parentIndex).toEqual(node.parentIndex);
    expect(outlined.name).toBe("Card Outline");
    expect(outlined.vectorPaths?.[0]?.data).toContain("C");
    expect(outlined.cornerRadius).toBeUndefined();
  });

  it("requires pointCount before outlining polygon nodes", () => {
    const node = sectionNode("REGULAR_POLYGON");

    expect(() => outlineKiwiNode(node)).toThrow("requires pointCount");
  });
});

describe("canOutlineKiwiNode", () => {
  it("reports the supported Kiwi geometry node set", () => {
    expect(canOutlineKiwiNode(sectionNode("ELLIPSE"))).toBe(true);
    expect(canOutlineKiwiNode(sectionNode("CANVAS"))).toBe(false);
  });
});
