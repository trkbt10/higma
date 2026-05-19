/**
 * @file Contract tests pinning the constants modules to the Kiwi schema.
 *
 * Every numeric value here used to be hand-written; the rewrite
 * pulled them from `@higma-figma-schema/profiles`. The tests below
 * do two things:
 *
 *   1. Lock in the exact value the schema currently emits for every
 *      name the codebase exercises. A future schema bump that
 *      renumbers a member will fail one of these tests immediately
 *      rather than silently corrupting fig payloads.
 *
 *   2. Make sure schema-vs-codebase aliases (CROP → FILL,
 *      EVENODD → ODD) keep producing
 *      the right numeric value. The aliases exist for legacy domain
 *      callers; if any of them drift, the encode side breaks.
 */

import {
  PAINT_TYPE_VALUES,
  BLEND_MODE_VALUES,
  SCALE_MODE_VALUES,
  canonicaliseImageScaleMode,
} from "./paints";
import { EFFECT_TYPE_VALUES } from "./effects";
import {
  STROKE_CAP_VALUES,
  STROKE_JOIN_VALUES,
  STROKE_ALIGN_VALUES,
} from "./strokes";
import {
  STACK_MODE_VALUES,
  STACK_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_WRAP_VALUES,
  STACK_COUNTER_ALIGN_VALUES,
  STACK_POSITIONING_VALUES,
  STACK_SIZING_VALUES,
  CONSTRAINT_TYPE_VALUES,
  WINDING_RULE_VALUES,
  resolveStackSizingInput,
} from "./layout";
import {
  TEXT_ALIGN_H_VALUES,
  TEXT_ALIGN_V_VALUES,
  TEXT_AUTO_RESIZE_VALUES,
  TEXT_DECORATION_VALUES,
  TEXT_CASE_VALUES,
  NUMBER_UNITS_VALUES,
} from "./text";

describe("paint constants", () => {
  it("aligns PaintType values with the Figma Kiwi schema", () => {
    expect(PAINT_TYPE_VALUES).toMatchObject({
      SOLID: 0,
      GRADIENT_LINEAR: 1,
      GRADIENT_RADIAL: 2,
      GRADIENT_ANGULAR: 3,
      GRADIENT_DIAMOND: 4,
      IMAGE: 5,
      EMOJI: 6,
      VIDEO: 7,
    });
  });

  it("aligns BlendMode values with the Figma Kiwi schema", () => {
    expect(BLEND_MODE_VALUES).toMatchObject({
      PASS_THROUGH: 0,
      NORMAL: 1,
      MULTIPLY: 3,
      SCREEN: 7,
      OVERLAY: 10,
      LUMINOSITY: 18,
    });
  });

  it("aligns ImageScaleMode values with the Figma Kiwi schema (CROP is intentionally absent)", () => {
    expect(SCALE_MODE_VALUES).toEqual({ STRETCH: 0, FIT: 1, FILL: 2, TILE: 3 });
    // The schema does not declare CROP — domain callers must
    // canonicalise before encoding.
    expect("CROP" in SCALE_MODE_VALUES).toBe(false);
  });

  it("canonicaliseImageScaleMode collapses CROP to FILL", () => {
    expect(canonicaliseImageScaleMode("CROP")).toBe("FILL");
  });

  it("canonicaliseImageScaleMode passes schema names through unchanged", () => {
    expect(canonicaliseImageScaleMode("STRETCH")).toBe("STRETCH");
    expect(canonicaliseImageScaleMode("FIT")).toBe("FIT");
    expect(canonicaliseImageScaleMode("FILL")).toBe("FILL");
    expect(canonicaliseImageScaleMode("TILE")).toBe("TILE");
  });

  it("canonicaliseImageScaleMode throws for unknown labels", () => {
    expect(() => canonicaliseImageScaleMode("BOGUS")).toThrow(/Unsupported imageScaleMode/);
  });
});

describe("effect constants", () => {
  it("aligns the four legacy EffectType members with the Figma Kiwi schema", () => {
    // The schema also defines REPEAT/SYMMETRY/GRAIN/NOISE/GLASS;
    // those are read-only round-trip data for now and not part of
    // the strict EffectType union — so the constant exposes only
    // the four members the builder is allowed to emit.
    expect(EFFECT_TYPE_VALUES).toMatchObject({
      INNER_SHADOW: 0,
      DROP_SHADOW: 1,
      FOREGROUND_BLUR: 2,
      BACKGROUND_BLUR: 3,
    });
  });
});

describe("stroke constants", () => {
  it("StrokeCap value 0 is NONE", () => {
    expect(STROKE_CAP_VALUES.NONE).toBe(0);
  });

  it("StrokeJoin schema-canonical mapping", () => {
    expect(STROKE_JOIN_VALUES).toMatchObject({ MITER: 0, BEVEL: 1, ROUND: 2 });
  });

  it("StrokeAlign schema-canonical mapping", () => {
    expect(STROKE_ALIGN_VALUES).toEqual({ CENTER: 0, INSIDE: 1, OUTSIDE: 2 });
  });
});

describe("layout constants", () => {
  it("StackMode includes GRID at 3 (newer schema member)", () => {
    expect(STACK_MODE_VALUES.GRID).toBe(3);
  });

  it("StackAlign value 3 is BASELINE — not STRETCH (silent corruption guard)", () => {
    expect(STACK_ALIGN_VALUES).toMatchObject({ BASELINE: 3 });
    expect("STRETCH" in STACK_ALIGN_VALUES).toBe(false);
  });

  it("StackJustify SPACE_EVENLY precedes SPACE_BETWEEN", () => {
    expect(STACK_JUSTIFY_VALUES.SPACE_EVENLY).toBe(3);
    expect(STACK_JUSTIFY_VALUES.SPACE_BETWEEN).toBe(4);
  });

  it("StackWrap is a schema enum, not a boolean payload", () => {
    expect(STACK_WRAP_VALUES).toEqual({ NO_WRAP: 0, WRAP: 1 });
  });

  it("StackCounterAlign STRETCH=3 (where the actual stretch override lives)", () => {
    expect(STACK_COUNTER_ALIGN_VALUES.STRETCH).toBe(3);
    expect(STACK_COUNTER_ALIGN_VALUES.AUTO).toBe(4);
    expect(STACK_COUNTER_ALIGN_VALUES.BASELINE).toBe(5);
  });

  it("StackPositioning is binary AUTO/ABSOLUTE", () => {
    expect(STACK_POSITIONING_VALUES).toEqual({ AUTO: 0, ABSOLUTE: 1 });
  });

  it("StackSizing maps onto the schema's StackSize enum", () => {
    expect(STACK_SIZING_VALUES).toEqual({
      FIXED: 0,
      RESIZE_TO_FIT: 1,
      RESIZE_TO_FIT_WITH_IMPLICIT_SIZE: 2,
    });
  });

  it("resolveStackSizingInput rewrites HUG to RESIZE_TO_FIT", () => {
    expect(resolveStackSizingInput("HUG")).toBe("RESIZE_TO_FIT");
    expect(resolveStackSizingInput("FIXED")).toBe("FIXED");
    expect(resolveStackSizingInput("RESIZE_TO_FIT")).toBe("RESIZE_TO_FIT");
    expect(resolveStackSizingInput("RESIZE_TO_FIT_WITH_IMPLICIT_SIZE")).toBe("RESIZE_TO_FIT_WITH_IMPLICIT_SIZE");
  });

  it("ConstraintType schema-canonical mapping", () => {
    expect(CONSTRAINT_TYPE_VALUES).toMatchObject({
      MIN: 0,
      CENTER: 1,
      MAX: 2,
      STRETCH: 3,
      SCALE: 4,
    });
  });

  it("WindingRule keeps EVENODD as a domain alias for ODD (same numeric value)", () => {
    // Schema name is ODD; codebase historically used EVENODD. The
    // numeric value must agree — diverging would re-introduce the
    // silent corruption that motivated the rewrite.
    expect(WINDING_RULE_VALUES.NONZERO).toBe(0);
    expect(WINDING_RULE_VALUES.ODD).toBe(1);
    expect(WINDING_RULE_VALUES.EVENODD).toBe(WINDING_RULE_VALUES.ODD);
  });
});

describe("text constants", () => {
  it("TextAlignHorizontal", () => {
    expect(TEXT_ALIGN_H_VALUES).toEqual({ LEFT: 0, CENTER: 1, RIGHT: 2, JUSTIFIED: 3 });
  });

  it("TextAlignVertical", () => {
    expect(TEXT_ALIGN_V_VALUES).toEqual({ TOP: 0, CENTER: 1, BOTTOM: 2 });
  });

  it("TextAutoResize", () => {
    expect(TEXT_AUTO_RESIZE_VALUES).toEqual({ NONE: 0, WIDTH_AND_HEIGHT: 1, HEIGHT: 2 });
  });

  it("TextDecoration", () => {
    expect(TEXT_DECORATION_VALUES).toEqual({ NONE: 0, UNDERLINE: 1, STRIKETHROUGH: 2 });
  });

  it("TextCase", () => {
    expect(TEXT_CASE_VALUES).toMatchObject({
      ORIGINAL: 0,
      UPPER: 1,
      LOWER: 2,
      TITLE: 3,
      SMALL_CAPS: 4,
      SMALL_CAPS_FORCED: 5,
    });
  });

  it("NumberUnits", () => {
    expect(NUMBER_UNITS_VALUES).toEqual({ RAW: 0, PIXELS: 1, PERCENT: 2 });
  });
});
