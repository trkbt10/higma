/**
 * @file Spec for StyleBoxFlat sub-resource construction.
 */
import type { FigEffect, FigNode, FigPaint, KiwiEnumValue } from "@higma-document-models/fig/types";
import {
  EFFECT_TYPE_VALUES,
  PAINT_TYPE_VALUES,
  STROKE_ALIGN_VALUES,
} from "@higma-document-models/fig/constants";
import {
  bgColorProperties,
  buildStyleBoxFlat,
  cornerRadiusProperties,
  shadowProperties,
  strokeProperties,
} from "./style-box";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function solidPaint(
  color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number },
  fields: Partial<Pick<FigPaint, "opacity" | "visible" | "blendMode">> = {},
): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    ...fields,
  };
}

function dropShadow(fields: Omit<FigEffect, "type">): FigEffect {
  return {
    type: { value: EFFECT_TYPE_VALUES.DROP_SHADOW, name: "DROP_SHADOW" },
    ...fields,
  };
}

const INSIDE_STROKE = { value: STROKE_ALIGN_VALUES.INSIDE, name: "INSIDE" } as const;

function rect(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 99 },
    phase: enumName("CREATED"),
    type: enumName("RECTANGLE"),
    ...partial,
  } as FigNode;
}

describe("bgColorProperties", () => {
  it("emits bg_color from the first visible SOLID fill", () => {
    const props = bgColorProperties(
      rect({ fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })] }),
    );
    expect(props).toHaveLength(1);
    expect(props[0]?.name).toBe("bg_color");
    expect(props[0]?.value.kind).toBe("color");
  });

  it("returns no property when the only fill is invisible", () => {
    expect(
      bgColorProperties(
        rect({
          fillPaints: [
            solidPaint({ r: 1, g: 0, b: 0, a: 1 }, { visible: false }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("returns no property when there are no fills", () => {
    expect(bgColorProperties(rect({}))).toEqual([]);
  });
});

describe("cornerRadiusProperties", () => {
  it("expands uniform cornerRadius to four equal int properties", () => {
    const props = cornerRadiusProperties(rect({ cornerRadius: 8 }));
    expect(props.map((p) => p.name)).toEqual([
      "corner_radius_top_left",
      "corner_radius_top_right",
      "corner_radius_bottom_right",
      "corner_radius_bottom_left",
    ]);
    for (const p of props) {
      if (p.value.kind !== "int") {
        throw new Error("expected int");
      }
      expect(p.value.value).toBe(8);
    }
  });

  it("emits per-corner radii when the node carries per-corner fields", () => {
    const props = cornerRadiusProperties(
      rect({
        rectangleTopLeftCornerRadius: 4,
        rectangleTopRightCornerRadius: 8,
        rectangleBottomRightCornerRadius: 12,
        rectangleBottomLeftCornerRadius: 16,
      }),
    );
    const values = props.map((p) => (p.value.kind === "int" ? p.value.value : NaN));
    expect(values).toEqual([4, 8, 12, 16]);
  });

  it("returns no properties when neither field is set", () => {
    expect(cornerRadiusProperties(rect({}))).toEqual([]);
  });
});

describe("strokeProperties", () => {
  it("emits border_color + four border_width sides + four expand_margin sides for a CENTER-aligned stroke", () => {
    const props = strokeProperties(
      rect({
        strokePaints: [solidPaint({ r: 0, g: 0, b: 0, a: 1 })],
        strokeWeight: 2,
      }),
    );
    expect(props.map((p) => p.name)).toEqual([
      "border_color",
      "border_width_top",
      "border_width_right",
      "border_width_bottom",
      "border_width_left",
      "expand_margin_top",
      "expand_margin_right",
      "expand_margin_bottom",
      "expand_margin_left",
    ]);
  });

  it("omits expand_margin for INSIDE strokeAlign (Godot default)", () => {
    const props = strokeProperties(
      rect({
        strokePaints: [solidPaint({ r: 0, g: 0, b: 0, a: 1 })],
        strokeWeight: 2,
        strokeAlign: INSIDE_STROKE,
      }),
    );
    expect(props.map((p) => p.name)).toEqual([
      "border_color",
      "border_width_top",
      "border_width_right",
      "border_width_bottom",
      "border_width_left",
    ]);
  });

  it("respects independent per-side weights", () => {
    const props = strokeProperties(
      rect({
        strokePaints: [solidPaint({ r: 0, g: 0, b: 0, a: 1 })],
        borderStrokeWeightsIndependent: true,
        borderTopWeight: 1,
        borderRightWeight: 2,
        borderBottomWeight: 3,
        borderLeftWeight: 4,
      }),
    );
    const widths = props
      .filter((p) => p.name.startsWith("border_width_"))
      .map((p) => (p.value.kind === "int" ? p.value.value : NaN));
    expect(widths).toEqual([1, 2, 3, 4]);
  });

  it("emits a CENTER border regardless of authored INSIDE / OUTSIDE alignment", () => {
    // Godot's StyleBoxFlat draws borders centred on the edge — no
    // INSIDE / OUTSIDE option exists. The emitter approximates by
    // ignoring strokeAlign and lets the per-frame diff cap absorb the
    // ±strokeWeight/2 visual shift.
    const props = strokeProperties(
      rect({
        strokePaints: [solidPaint({ r: 0, g: 0, b: 0, a: 1 })],
        strokeWeight: 2,
        strokeAlign: INSIDE_STROKE,
      }),
    );
    expect(props.map((p) => p.name)).toContain("border_color");
    expect(props.map((p) => p.name)).toContain("border_width_top");
  });

  it("throws on dashed strokes", () => {
    expect(() =>
      strokeProperties(
        rect({
          strokePaints: [solidPaint({ r: 0, g: 0, b: 0, a: 1 })],
          strokeWeight: 2,
          strokeDashes: [4, 4],
        }),
      ),
    ).toThrow(/dashed strokes/u);
  });
});

describe("shadowProperties", () => {
  it("emits shadow_color / shadow_size / shadow_offset for a DROP_SHADOW", () => {
    const props = shadowProperties(
      rect({
        effects: [
          dropShadow({
            color: { r: 0, g: 0, b: 0, a: 0.5 },
            offset: { x: 2, y: 4 },
            radius: 6,
          }),
        ],
      }),
    );
    expect(props.map((p) => p.name)).toEqual(["shadow_color", "shadow_size", "shadow_offset"]);
  });

  it("throws on non-zero spread (Godot StyleBoxFlat has no spread parameter)", () => {
    expect(() =>
      shadowProperties(
        rect({
          effects: [
            dropShadow({
              color: { r: 0, g: 0, b: 0, a: 1 },
              radius: 4,
              spread: 2,
            }),
          ],
        }),
      ),
    ).toThrow(/spread/u);
  });
});

describe("buildStyleBoxFlat", () => {
  it("returns undefined when no styling field contributes a property", () => {
    expect(buildStyleBoxFlat(rect({}), "id_001")).toBeUndefined();
  });

  it("composes background + corners + stroke + shadow into one sub-resource", () => {
    const sub = buildStyleBoxFlat(
      rect({
        fillPaints: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
        cornerRadius: 4,
        strokePaints: [solidPaint({ r: 0, g: 0, b: 0, a: 1 })],
        strokeWeight: 1,
        effects: [
          dropShadow({
            color: { r: 0, g: 0, b: 0, a: 1 },
            offset: { x: 0, y: 2 },
            radius: 4,
          }),
        ],
      }),
      "id_001",
    );
    expect(sub).toBeDefined();
    expect(sub?.type).toBe("StyleBoxFlat");
    const names = (sub?.properties ?? []).map((p) => p.name);
    expect(names).toContain("bg_color");
    expect(names).toContain("corner_radius_top_left");
    expect(names).toContain("border_color");
    expect(names).toContain("shadow_color");
  });
});
