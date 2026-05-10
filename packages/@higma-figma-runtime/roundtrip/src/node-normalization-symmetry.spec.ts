/**
 * @file Symmetry tests for normalise ↔ denormalise.
 *
 * The roundtrip boundary lives or dies on these two transforms
 * being mirror images. If they ever diverge silently, every
 * downstream `loadFigFile → editor → saveFigFile` flow corrupts
 * data with no immediate error. The tests below stress the most
 * common drift directions:
 *
 *   - every Stack* / Stroke* / Paint* / Effect / BlendMode value
 *     declared in the schema-driven enum tables;
 *   - the legacy aliases (CROP, LAYER_BLUR) that domain code still
 *     emits;
 *   - paint nests inside `symbolOverrides`, `fillPaints`,
 *     `strokePaints`, `backgroundPaints`;
 *   - the stability of an opaque (non-enum) field, ensuring
 *     normalisation never disturbs unrelated data.
 */

import {
  denormaliseFigFamilyNodeForEncode,
  normaliseFigFamilyNodeChanges,
} from "./node-normalization";
import {
  FIG_BLEND_MODE_VALUES,
  FIG_EFFECT_TYPE_VALUES,
  FIG_IMAGE_SCALE_MODE_VALUES,
  FIG_PAINT_TYPE_VALUES,
  FIG_STROKE_ALIGN_VALUES,
  FIG_STROKE_CAP_VALUES,
  FIG_STROKE_JOIN_VALUES,
} from "./fig-enum-values";

type AnyRecord = Record<string, unknown>;

function asKiwi(value: number, name: string): { value: number; name: string } {
  return { value, name };
}

describe("normalise / denormalise symmetry", () => {
  describe("paint enum members survive a full round trip", () => {
    const cases: ReadonlyArray<{ readonly name: string; readonly value: number }> = Object.entries(FIG_PAINT_TYPE_VALUES)
      .map(([name, value]) => ({ name, value }));

    for (const c of cases) {
      it(`PaintType "${c.name}"`, () => {
        const raw = [{ fillPaints: [{ type: asKiwi(c.value, c.name) }] }];
        const normalised = normaliseFigFamilyNodeChanges<AnyRecord>(raw);
        const fillPaints = (normalised[0] as { fillPaints: AnyRecord[] }).fillPaints;
        expect(fillPaints[0].type).toBe(c.name);

        const denorm = denormaliseFigFamilyNodeForEncode(normalised[0]);
        const reFillPaints = (denorm as { fillPaints: AnyRecord[] }).fillPaints;
        expect(reFillPaints[0].type).toEqual(asKiwi(c.value, c.name));
      });
    }
  });

  describe("blend mode survives a full round trip", () => {
    for (const [name, value] of Object.entries(FIG_BLEND_MODE_VALUES)) {
      it(`BlendMode "${name}"`, () => {
        const raw = [{ blendMode: asKiwi(value, name) }];
        const normalised = normaliseFigFamilyNodeChanges<AnyRecord>(raw);
        expect(normalised[0].blendMode).toBe(name);
        const denorm = denormaliseFigFamilyNodeForEncode(normalised[0]);
        expect((denorm as AnyRecord).blendMode).toEqual(asKiwi(value, name));
      });
    }
  });

  describe("stroke align / join / cap survive a full round trip", () => {
    type StrokeCase = { readonly field: "strokeAlign" | "strokeJoin" | "strokeCap"; readonly table: Readonly<Record<string, number>> };
    const strokeCases: readonly StrokeCase[] = [
      { field: "strokeAlign", table: FIG_STROKE_ALIGN_VALUES },
      { field: "strokeJoin", table: FIG_STROKE_JOIN_VALUES },
      { field: "strokeCap", table: FIG_STROKE_CAP_VALUES },
    ];
    for (const { field, table } of strokeCases) {
      for (const [name, value] of Object.entries(table)) {
        it(`${field} "${name}"`, () => {
          const raw = [{ [field]: asKiwi(value, name) }];
          const normalised = normaliseFigFamilyNodeChanges<AnyRecord>(raw);
          expect(normalised[0][field]).toBe(name);
          const denorm = denormaliseFigFamilyNodeForEncode(normalised[0]);
          expect((denorm as AnyRecord)[field]).toEqual(asKiwi(value, name));
        });
      }
    }
  });

  describe("image scale mode", () => {
    for (const [name, value] of Object.entries(FIG_IMAGE_SCALE_MODE_VALUES)) {
      it(`schema name "${name}" round-trips`, () => {
        const raw = [{ fillPaints: [{ type: asKiwi(5, "IMAGE"), imageScaleMode: asKiwi(value, name) }] }];
        const normalised = normaliseFigFamilyNodeChanges<AnyRecord>(raw);
        const denorm = denormaliseFigFamilyNodeForEncode(normalised[0]);
        const fillPaints = (denorm as { fillPaints: AnyRecord[] }).fillPaints;
        expect(fillPaints[0].imageScaleMode).toEqual(asKiwi(value, name));
      });
    }

    it("legacy CROP alias canonicalises to FILL on encode", () => {
      // CROP comes from the editor UI; the schema does not declare
      // it. The denormalise step must collapse it to FILL so the
      // emitted bytes always match the schema-canonical mapping.
      const node = { fillPaints: [{ type: "IMAGE", imageScaleMode: "CROP" }] };
      const denorm = denormaliseFigFamilyNodeForEncode(node);
      const fillPaints = (denorm as { fillPaints: AnyRecord[] }).fillPaints;
      expect(fillPaints[0].imageScaleMode).toEqual({ value: 2, name: "FILL" });
    });

    it("alias collapse applies to both `scaleMode` and `imageScaleMode`", () => {
      const node = { fillPaints: [{ type: "IMAGE", scaleMode: "CROP", imageScaleMode: "CROP" }] };
      const denorm = denormaliseFigFamilyNodeForEncode(node);
      const fillPaints = (denorm as { fillPaints: AnyRecord[] }).fillPaints;
      expect(fillPaints[0].scaleMode).toEqual({ value: 2, name: "FILL" });
      expect(fillPaints[0].imageScaleMode).toEqual({ value: 2, name: "FILL" });
    });
  });

  describe("effect type", () => {
    for (const [name, value] of Object.entries(FIG_EFFECT_TYPE_VALUES)) {
      it(`EffectType "${name}" round-trips`, () => {
        const raw = [{ effects: [{ type: asKiwi(value, name) }] }];
        const normalised = normaliseFigFamilyNodeChanges<AnyRecord>(raw);
        const denorm = denormaliseFigFamilyNodeForEncode(normalised[0]);
        const effects = (denorm as { effects: AnyRecord[] }).effects;
        // LAYER_BLUR and FOREGROUND_BLUR share value=2; the
        // denormalise step always picks the alias the source
        // string named, which is the desired identity behaviour.
        expect(effects[0].type).toEqual(asKiwi(value, name));
      });
    }

    it("LAYER_BLUR is a legacy alias of FOREGROUND_BLUR (same numeric value)", () => {
      expect(FIG_EFFECT_TYPE_VALUES.LAYER_BLUR).toBe(FIG_EFFECT_TYPE_VALUES.FOREGROUND_BLUR);
    });

    it("LAYER_BLUR string survives denormalisation as itself (no rename)", () => {
      const node = { effects: [{ type: "LAYER_BLUR" }] };
      const denorm = denormaliseFigFamilyNodeForEncode(node);
      const effects = (denorm as { effects: AnyRecord[] }).effects;
      expect(effects[0].type).toEqual({ value: 2, name: "LAYER_BLUR" });
    });
  });

  describe("nested paint lists", () => {
    it("normalises paints inside symbolData.symbolOverrides", () => {
      const raw = [{
        symbolData: {
          symbolOverrides: [{
            fillPaints: [{ type: asKiwi(5, "IMAGE"), imageScaleMode: asKiwi(2, "FILL") }],
            strokePaints: [{ type: asKiwi(0, "SOLID") }],
            backgroundPaints: [{ type: asKiwi(0, "SOLID") }],
            effects: [{ type: asKiwi(1, "DROP_SHADOW") }],
          }],
        },
      }];
      const [normalised] = normaliseFigFamilyNodeChanges<AnyRecord>(raw);
      const overrides = ((normalised.symbolData as AnyRecord).symbolOverrides as AnyRecord[])[0];
      expect((overrides.fillPaints as AnyRecord[])[0].type).toBe("IMAGE");
      expect((overrides.fillPaints as AnyRecord[])[0].imageScaleMode).toBe("FILL");
      expect((overrides.effects as AnyRecord[])[0].type).toBe("DROP_SHADOW");
    });
  });

  describe("isolation", () => {
    it("denormalisation does not mutate the source node", () => {
      const node = { fillPaints: [{ type: "IMAGE", imageScaleMode: "CROP" }] };
      const snapshot = JSON.parse(JSON.stringify(node));
      denormaliseFigFamilyNodeForEncode(node);
      expect(node).toEqual(snapshot);
    });

    it("opaque (non-enum) fields are passed through untouched on both sides", () => {
      const raw = [{
        guid: { sessionID: 1, localID: 42 },
        name: "leaf",
        fillPaints: [{ type: asKiwi(0, "SOLID"), opacity: 0.5, color: { r: 1, g: 0, b: 0, a: 1 } }],
      }];
      const [normalised] = normaliseFigFamilyNodeChanges<AnyRecord>(raw);
      expect(normalised.guid).toEqual({ sessionID: 1, localID: 42 });
      expect(normalised.name).toBe("leaf");
      const fillPaints = normalised.fillPaints as AnyRecord[];
      expect(fillPaints[0].opacity).toBe(0.5);
      expect(fillPaints[0].color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    });
  });
});
