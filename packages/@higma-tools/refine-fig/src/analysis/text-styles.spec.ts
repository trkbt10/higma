/**
 * @file Unit tests for `analyseTypography` near-duplicate detection.
 *
 * Two typography entries that differ only in `lineHeightKey` or
 * `letterSpacingKey` (with the same family/style/weight/size) are
 * almost certainly the *same* style entered twice — one with a stray
 * line-height. We surface that as `aliases[]` on the most-used entry
 * so the agent can decide whether to bind both to the same TEXT proxy
 * via the `merge` field on decisions.
 *
 * We never merge automatically: the entries remain distinct in the
 * inventory; the agent's `decisions.typography[secondary].merge =
 * primary` is what redirects the bind. Fail-fast — silence is honest.
 */
import type { FigNode, FigValueWithUnits } from "@higma-document-models/fig/types";
import { analyseTypography } from "./text-styles";
import { fakeFigNode } from "./test-helpers";

function units(value: number, name: "PIXELS" | "PERCENT"): FigValueWithUnits {
  // KiwiEnumValue requires { value, name }; the analyser only reads the
  // .name field, so a placeholder enum value is enough for these tests.
  return { value, units: { value: 0, name } };
}

function textNode(
  localID: number,
  characters: string,
  desc: {
    family: string;
    style: string;
    size: number;
    lh?: FigValueWithUnits;
    ls?: FigValueWithUnits;
  },
): FigNode {
  return fakeFigNode({
    type: { value: 13, name: "TEXT" },
    guid: { sessionID: 1, localID },
    name: `t${localID}`,
    characters,
    fontName: { family: desc.family, style: desc.style },
    fontSize: desc.size,
    lineHeight: desc.lh,
    letterSpacing: desc.ls,
  });
}

function frameOf(localID: number, children: readonly FigNode[]): FigNode {
  return fakeFigNode({
    type: { value: 1, name: "FRAME" },
    guid: { sessionID: 1, localID },
    children,
  });
}

describe("analyseTypography — near-duplicate detection", () => {
  it("flags a near-duplicate that differs only by lineHeight as an alias of the most-used entry", () => {
    // Win98 case: five usages of MS Sans Serif 11px lh=12 (the real
    // style), one stray usage with lh=13 (the typo). The stray must
    // surface as an alias of the most-used entry, not as a separate
    // peer the agent has to reconcile by hand.
    const lh12: FigValueWithUnits = units(12, "PIXELS");
    const lh13: FigValueWithUnits = units(13, "PIXELS");
    const frame = frameOf(1, [
      textNode(10, "hello", { family: "MS Sans Serif", style: "Regular", size: 11, lh: lh12 }),
      textNode(11, "hello", { family: "MS Sans Serif", style: "Regular", size: 11, lh: lh12 }),
      textNode(12, "hello", { family: "MS Sans Serif", style: "Regular", size: 11, lh: lh12 }),
      textNode(13, "hello", { family: "MS Sans Serif", style: "Regular", size: 11, lh: lh12 }),
      textNode(14, "hello", { family: "MS Sans Serif", style: "Regular", size: 11, lh: lh12 }),
      textNode(20, "hello", { family: "MS Sans Serif", style: "Regular", size: 11, lh: lh13 }),
    ]);
    const result = analyseTypography([frame], []);

    expect(result.clusters.length).toBe(2);
    const major = result.clusters[0];
    if (!major) {
      throw new Error("expected a major cluster");
    }
    expect(major.aliases.length).toBe(1);
    const alias = major.aliases[0];
    if (!alias) {
      throw new Error("expected one alias");
    }
    expect(alias.usageCount).toBe(1);
    expect(alias.differingFields).toContain("lineHeightKey");
  });

  it("does not cross-alias distinct font families or sizes", () => {
    const frame = frameOf(1, [
      textNode(10, "a", { family: "Arial", style: "Regular", size: 12 }),
      textNode(11, "b", { family: "Helvetica", style: "Regular", size: 12 }),
      textNode(12, "c", { family: "Arial", style: "Regular", size: 18 }),
    ]);
    const result = analyseTypography([frame], []);
    expect(result.clusters.length).toBe(3);
    for (const c of result.clusters) {
      expect(c.aliases, `cluster ${c.key} must have no aliases`).toEqual([]);
    }
  });

  it("groups multiple near-duplicates as aliases of the same primary", () => {
    const lh12 = units(12, "PIXELS");
    const lh13 = units(13, "PIXELS");
    const lh14 = units(14, "PIXELS");
    const frame = frameOf(1, [
      textNode(10, "x", { family: "MS Sans Serif", style: "Regular", size: 11, lh: lh12 }),
      textNode(11, "x", { family: "MS Sans Serif", style: "Regular", size: 11, lh: lh12 }),
      textNode(12, "x", { family: "MS Sans Serif", style: "Regular", size: 11, lh: lh12 }),
      textNode(13, "x", { family: "MS Sans Serif", style: "Regular", size: 11, lh: lh13 }),
      textNode(14, "x", { family: "MS Sans Serif", style: "Regular", size: 11, lh: lh14 }),
    ]);
    const result = analyseTypography([frame], []);
    const primary = result.clusters[0];
    if (!primary) {
      throw new Error("expected primary cluster");
    }
    expect(primary.aliases.length).toBe(2);
    for (const alias of primary.aliases) {
      expect(alias.differingFields).toContain("lineHeightKey");
    }
  });
});
