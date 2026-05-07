/**
 * @file resolveTextRuns unit tests — pin the SoT contract.
 */

import type { FigPaint } from "@higma-document-models/fig/types";
import type { FigStyleRegistry, TextStyleOverride } from "@higma-document-models/fig/domain";
import { EMPTY_FIG_STYLE_REGISTRY } from "@higma-document-models/fig/domain";
import { resolveTextRuns } from "./resolve";

const black: FigPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, blendMode: "NORMAL" };
const red: FigPaint = { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, blendMode: "NORMAL" };

describe("resolveTextRuns", () => {
  it("returns an empty list for an empty source string", () => {
    const runs = resolveTextRuns({
      characters: "",
      baseFillPaints: [black],
      characterStyleIDs: undefined,
      styleOverrideTable: undefined,
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "test",
    });
    expect(runs).toEqual([]);
  });

  it("returns one base run when no characterStyleIDs are present", () => {
    const runs = resolveTextRuns({
      characters: "hello",
      baseFillPaints: [black],
      characterStyleIDs: undefined,
      styleOverrideTable: undefined,
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "test",
    });
    expect(runs).toEqual([{ start: 0, end: 5, fillColor: "#000000", fillOpacity: 1 }]);
  });

  it("returns one base run when every character uses styleID 0", () => {
    const runs = resolveTextRuns({
      characters: "abcd",
      baseFillPaints: [black],
      characterStyleIDs: [0, 0, 0, 0],
      styleOverrideTable: undefined,
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "test",
    });
    expect(runs).toEqual([{ start: 0, end: 4, fillColor: "#000000", fillOpacity: 1 }]);
  });

  it("groups contiguous identical styleIDs into runs and switches fill on boundary", () => {
    const overrides: TextStyleOverride[] = [
      { styleID: 2, fillPaints: [red] },
    ];
    const runs = resolveTextRuns({
      characters: "Comments 149",
      baseFillPaints: [black],
      // 9 chars "Comments " base, 3 chars "149" override id=2
      characterStyleIDs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2],
      styleOverrideTable: overrides,
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "test",
    });
    expect(runs).toEqual([
      { start: 0, end: 9, fillColor: "#000000", fillOpacity: 1 },
      { start: 9, end: 12, fillColor: "#ff0000", fillOpacity: 1 },
    ]);
  });

  it("partitions every character — no gaps, no overlaps, contiguous", () => {
    const overrides: TextStyleOverride[] = [
      { styleID: 1, fillPaints: [red] },
      { styleID: 2, fillPaints: [red] },
    ];
    const runs = resolveTextRuns({
      characters: "abcdef",
      baseFillPaints: [black],
      characterStyleIDs: [0, 1, 1, 0, 2, 0],
      styleOverrideTable: overrides,
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "test",
    });
    // Boundary check
    expect(runs[0].start).toBe(0);
    expect(runs[runs.length - 1].end).toBe(6);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].start).toBe(runs[i - 1].end);
      expect(runs[i].start).toBeLessThan(runs[i].end);
    }
    expect(runs.map((r) => `${r.start}-${r.end}`)).toEqual(["0-1", "1-3", "3-4", "4-5", "5-6"]);
  });

  it("resolves override.styleIdForFill through the style registry", () => {
    const styleRegistry: FigStyleRegistry = {
      paints: new Map([["7:81", [red]]]),
      effects: new Map(),
      textProperties: new Map(),
      layoutGrids: new Map(),
    };
    const overrides: TextStyleOverride[] = [
      { styleID: 2, styleIdForFill: { guid: { sessionID: 7, localID: 81 } } },
    ];
    const runs = resolveTextRuns({
      characters: "ab",
      baseFillPaints: [black],
      characterStyleIDs: [0, 2],
      styleOverrideTable: overrides,
      styleRegistry,
      locator: () => "test",
    });
    expect(runs[0].fillColor).toBe("#000000");
    expect(runs[1].fillColor).toBe("#ff0000");
  });

  it("inherits the base fill when an override entry omits both styleIdForFill and fillPaints", () => {
    // A sparse override (e.g. only changes fontSize) intentionally leaves
    // the fill unchanged from the base. This is the documented Kiwi
    // NodeChange semantic — not a fallback.
    const overrides: TextStyleOverride[] = [
      { styleID: 5, fontSize: 24 },
    ];
    const runs = resolveTextRuns({
      characters: "ab",
      baseFillPaints: [black],
      characterStyleIDs: [0, 5],
      styleOverrideTable: overrides,
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "test",
    });
    expect(runs[0].fillColor).toBe("#000000");
    expect(runs[1].fillColor).toBe("#000000");
  });

  it("throws when characterStyleIDs length doesn't match the source", () => {
    // The resolver expects post-normalised input where the length already
    // equals `characters.length` (the conversion layer pads Figma's
    // trailing-zero-omitted Kiwi array). Feeding it un-normalised data is
    // a caller bug and should fail loudly.
    expect(() => resolveTextRuns({
      characters: "abc",
      baseFillPaints: [black],
      characterStyleIDs: [0, 0],
      styleOverrideTable: undefined,
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "node 1:2",
    })).toThrow(/length 2 does not match characters length 3 on node 1:2/);
  });

  it("throws when characterStyleIDs references a styleID that has no override entry", () => {
    expect(() => resolveTextRuns({
      characters: "ab",
      baseFillPaints: [black],
      characterStyleIDs: [0, 7],
      styleOverrideTable: [],
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "node 1:2",
    })).toThrow(/styleID=7 which has no entry in styleOverrideTable on node 1:2/);
  });

  it("falls through to override.fillPaints when override.styleIdForFill is dangling", () => {
    // A run whose override carries a styleId that the registry can't
    // resolve must use the override's own embedded fillPaints (when
    // present). Figma Community exports routinely emit dangling refs
    // and Figma itself renders them with the embedded paint.
    const overrides: TextStyleOverride[] = [
      { styleID: 2, styleIdForFill: { guid: { sessionID: 99, localID: 99 } }, fillPaints: [red] },
    ];
    const runs = resolveTextRuns({
      characters: "ab",
      baseFillPaints: [black],
      characterStyleIDs: [0, 2],
      styleOverrideTable: overrides,
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "node 1:2",
    });
    expect(runs[0].fillColor).toBe("#000000");
    expect(runs[1].fillColor).toBe("#ff0000");
  });

  it("inherits the base fill when a sparse override authors only a dangling styleIdForFill", () => {
    // Override doesn't author its own fillPaints and the styleId is
    // dangling — there is no override fill, so the run should keep
    // the node's base fill (Figma's "this override doesn't touch
    // fill" semantic, applied even when the dangling styleId is
    // present).
    const overrides: TextStyleOverride[] = [
      { styleID: 2, styleIdForFill: { guid: { sessionID: 99, localID: 99 } } },
    ];
    const runs = resolveTextRuns({
      characters: "ab",
      baseFillPaints: [black],
      characterStyleIDs: [0, 2],
      styleOverrideTable: overrides,
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "node 1:2",
    });
    expect(runs[0].fillColor).toBe("#000000");
    expect(runs[1].fillColor).toBe("#000000");
  });

  it("rejects styleID=0 in the override table (forbidden by the schema)", () => {
    expect(() => resolveTextRuns({
      characters: "a",
      baseFillPaints: [black],
      characterStyleIDs: [0],
      styleOverrideTable: [{ styleID: 0, fillPaints: [red] }],
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "node 1:2",
    })).toThrow(/forbidden styleID=0/);
  });

  it("rejects duplicate styleIDs in the override table", () => {
    expect(() => resolveTextRuns({
      characters: "a",
      baseFillPaints: [black],
      characterStyleIDs: [0],
      styleOverrideTable: [
        { styleID: 2, fillPaints: [red] },
        { styleID: 2, fillPaints: [black] },
      ],
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      locator: () => "node 1:2",
    })).toThrow(/duplicate styleID=2/);
  });
});
