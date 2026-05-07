/**
 * @file Tests for fig-family Kiwi enum normalization.
 */

import { denormaliseFigFamilyNodeForEncode, normaliseFigFamilyNodeChanges } from "./node-normalization";

describe("fig-family node normalization", () => {
  it("normalizes Kiwi enum values on nodes, paints, effects, and symbol overrides", () => {
    const rawNodes = [{
      blendMode: { value: 1, name: "NORMAL" },
      strokeAlign: { value: 1, name: "INSIDE" },
      fillPaints: [{
        type: { value: 0, name: "SOLID" },
        blendMode: { value: 1, name: "NORMAL" },
      }],
      effects: [{
        type: { value: 1, name: "DROP_SHADOW" },
        blendMode: { value: 1, name: "NORMAL" },
      }],
      symbolData: {
        symbolOverrides: [{
          strokeCap: { value: 1, name: "ROUND" },
          fillPaints: [{ type: { value: 5, name: "IMAGE" } }],
        }],
      },
    }];

    const nodes = normaliseFigFamilyNodeChanges<Record<string, unknown>>(rawNodes);
    expect(nodes[0]).toMatchObject({
      blendMode: "NORMAL",
      strokeAlign: "INSIDE",
      fillPaints: [{ type: "SOLID", blendMode: "NORMAL" }],
      effects: [{ type: "DROP_SHADOW", blendMode: "NORMAL" }],
      symbolData: {
        symbolOverrides: [{
          strokeCap: "ROUND",
          fillPaints: [{ type: "IMAGE" }],
        }],
      },
    });
  });

  it("denormalizes string enum values without mutating the source node", () => {
    const node = {
      strokeJoin: "ROUND",
      fillPaints: [{ type: "IMAGE", imageScaleMode: "CROP" }],
      effects: [{ type: "FOREGROUND_BLUR", blendMode: "NORMAL" }],
    };

    const encoded = denormaliseFigFamilyNodeForEncode(node);

    expect(encoded).toMatchObject({
      strokeJoin: { value: 2, name: "ROUND" },
      fillPaints: [{ type: { value: 5, name: "IMAGE" }, imageScaleMode: { value: 4, name: "CROP" } }],
      effects: [{ type: { value: 2, name: "FOREGROUND_BLUR" }, blendMode: { value: 1, name: "NORMAL" } }],
    });
    expect(node).toEqual({
      strokeJoin: "ROUND",
      fillPaints: [{ type: "IMAGE", imageScaleMode: "CROP" }],
      effects: [{ type: "FOREGROUND_BLUR", blendMode: "NORMAL" }],
    });
  });
});
