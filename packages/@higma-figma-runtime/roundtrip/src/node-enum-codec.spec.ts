/** @file Tests for fig-family Kiwi enum encode materialisation. */

import { encodeFigFamilyNodeChange, readFigFamilyNodeChanges } from "./node-enum-codec";

describe("fig-family node enum codec", () => {
  it("reads decoded nodeChanges without rewriting enum payloads", () => {
    const rawNodes = [{
      blendMode: { value: 1, name: "NORMAL" },
      fillPaints: [{ type: { value: 0, name: "SOLID" } }],
    }];

    const nodes = readFigFamilyNodeChanges<Record<string, unknown>>(rawNodes);

    expect(nodes).toBe(rawNodes);
    expect(nodes[0]).toEqual(rawNodes[0]);
  });

  it("materialises builder-authored string enums for Kiwi encode without mutating the source", () => {
    const node = {
      strokeJoin: "ROUND",
      fillPaints: [{ type: "IMAGE", imageScaleMode: "CROP" }],
      effects: [{ type: "FOREGROUND_BLUR", blendMode: "NORMAL" }],
    };

    const encoded = encodeFigFamilyNodeChange(node);

    expect(encoded).toMatchObject({
      strokeJoin: { value: 2, name: "ROUND" },
      fillPaints: [{ type: { value: 5, name: "IMAGE" }, imageScaleMode: { value: 2, name: "FILL" } }],
      effects: [{ type: { value: 2, name: "FOREGROUND_BLUR" }, blendMode: { value: 1, name: "NORMAL" } }],
    });
    expect(node).toEqual({
      strokeJoin: "ROUND",
      fillPaints: [{ type: "IMAGE", imageScaleMode: "CROP" }],
      effects: [{ type: "FOREGROUND_BLUR", blendMode: "NORMAL" }],
    });
  });

  it("materialises nested override paint and effect lists", () => {
    const encoded = encodeFigFamilyNodeChange({
      symbolData: {
        symbolOverrides: [{
          strokeCap: "ROUND",
          fillPaints: [{ type: "SOLID", blendMode: "NORMAL" }],
          effects: [{ type: "DROP_SHADOW" }],
        }],
      },
      textData: {
        styleOverrideTable: [{
          styleID: 2,
          fillPaints: [{ type: "SOLID" }],
        }],
      },
    });

    const symbolData = encoded.symbolData as { readonly symbolOverrides: readonly Record<string, unknown>[] };
    const override = symbolData.symbolOverrides[0]!;
    expect(override.strokeCap).toEqual({ value: 1, name: "ROUND" });
    expect((override.fillPaints as readonly Record<string, unknown>[])[0]!.type)
      .toEqual({ value: 0, name: "SOLID" });
    expect((override.effects as readonly Record<string, unknown>[])[0]!.type)
      .toEqual({ value: 1, name: "DROP_SHADOW" });

    const textData = encoded.textData as { readonly styleOverrideTable: readonly Record<string, unknown>[] };
    expect(((textData.styleOverrideTable[0]!.fillPaints as readonly Record<string, unknown>[])[0]!).type)
      .toEqual({ value: 0, name: "SOLID" });
  });

  it("throws on unsupported string enum names", () => {
    expect(() => encodeFigFamilyNodeChange({ fillPaints: [{ type: "BOGUS" }] }))
      .toThrow('Unsupported Paint.type enum name "BOGUS"');
  });
});
