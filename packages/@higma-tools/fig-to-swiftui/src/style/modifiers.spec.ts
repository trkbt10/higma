/**
 * @file Spec for individual SwiftUI modifier builders.
 */
import type { FigEffect, FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import type { Modifier } from "../swift-tree/types";
import { ident, leaf } from "../swift-tree/builder";
import { serialize } from "../swift-tree/serialize";
import {
  backgroundModifier,
  cornerRadiusModifier,
  fontModifier,
  foregroundColorModifier,
  frameModifier,
  offsetModifier,
  opacityModifier,
  paddingModifier,
  shadowModifier,
  swiftWeightForFigStyle,
} from "./modifiers";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function makeFrame(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    ...partial,
  } as FigNode;
}

function makeText(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 2 },
    phase: enumName("CREATED"),
    type: enumName("TEXT"),
    ...partial,
  } as FigNode;
}

function applied(node: FigNode, getMod: (n: FigNode) => Modifier | undefined): string {
  const mod = getMod(node);
  if (!mod) {
    throw new Error("expected a modifier");
  }
  return serialize(leaf(ident("V"), [mod]));
}

describe("frameModifier", () => {
  it("uses the node's authored size", () => {
    const node = makeFrame({ size: { x: 320, y: 44 } });
    expect(applied(node, frameModifier)).toBe(
      "V\n  .frame(width: 320, height: 44, alignment: .topLeading)",
    );
  });

  it("returns undefined when size is missing", () => {
    expect(frameModifier(makeFrame({}))).toBeUndefined();
  });
});

describe("backgroundModifier", () => {
  it("emits .background(Color(...)) for a SOLID fill", () => {
    const node = makeFrame({
      fillPaints: [
        { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } },
      ],
    });
    expect(applied(node, backgroundModifier)).toBe(
      "V\n  .background(Color(red: 1, green: 0, blue: 0))",
    );
  });

  it("ignores invisible paints", () => {
    const node = makeFrame({
      fillPaints: [
        { type: "SOLID", visible: false, color: { r: 1, g: 0, b: 0, a: 1 } },
      ],
    });
    expect(backgroundModifier(node)).toBeUndefined();
  });

  it("returns undefined when no SOLID paint exists", () => {
    expect(backgroundModifier(makeFrame({ fillPaints: [] }))).toBeUndefined();
  });
});

describe("cornerRadiusModifier", () => {
  it("uses the node's uniform cornerRadius", () => {
    const node = makeFrame({ cornerRadius: 12 });
    expect(applied(node, cornerRadiusModifier)).toBe("V\n  .cornerRadius(12)");
  });

  it("uses uniform per-corner radii when all four are equal", () => {
    const node = makeFrame({
      rectangleTopLeftCornerRadius: 8,
      rectangleTopRightCornerRadius: 8,
      rectangleBottomLeftCornerRadius: 8,
      rectangleBottomRightCornerRadius: 8,
    });
    expect(applied(node, cornerRadiusModifier)).toBe("V\n  .cornerRadius(8)");
  });

  it("throws on non-uniform per-corner radii", () => {
    const node = makeFrame({
      rectangleTopLeftCornerRadius: 8,
      rectangleTopRightCornerRadius: 4,
      rectangleBottomLeftCornerRadius: 8,
      rectangleBottomRightCornerRadius: 8,
    });
    expect(() => cornerRadiusModifier(node)).toThrow(/per-corner radii/u);
  });

  it("returns undefined when no radius is set", () => {
    expect(cornerRadiusModifier(makeFrame({}))).toBeUndefined();
  });
});

describe("shadowModifier", () => {
  it("emits .shadow with color/radius/x/y", () => {
    const effect: FigEffect = {
      type: "DROP_SHADOW",
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 4 },
      radius: 8,
    };
    const node = makeFrame({ effects: [effect] });
    expect(applied(node, shadowModifier)).toBe(
      "V\n  .shadow(color: Color(red: 0, green: 0, blue: 0, opacity: 0.25), radius: 8, x: 0, y: 4)",
    );
  });

  it("throws on non-zero spread", () => {
    const effect: FigEffect = {
      type: "DROP_SHADOW",
      color: { r: 0, g: 0, b: 0, a: 1 },
      offset: { x: 0, y: 0 },
      radius: 4,
      spread: 2,
    };
    expect(() => shadowModifier(makeFrame({ effects: [effect] }))).toThrow(/spread/u);
  });

  it("ignores invisible effects", () => {
    const effect: FigEffect = {
      type: "DROP_SHADOW",
      visible: false,
      color: { r: 0, g: 0, b: 0, a: 1 },
      offset: { x: 0, y: 4 },
      radius: 4,
    };
    expect(shadowModifier(makeFrame({ effects: [effect] }))).toBeUndefined();
  });
});

describe("opacityModifier", () => {
  it("emits .opacity for non-default opacity", () => {
    expect(applied(makeFrame({ opacity: 0.5 }), opacityModifier)).toBe(
      "V\n  .opacity(0.5)",
    );
  });
  it("returns undefined for opacity 1", () => {
    expect(opacityModifier(makeFrame({ opacity: 1 }))).toBeUndefined();
  });
  it("returns undefined when opacity is absent", () => {
    expect(opacityModifier(makeFrame({}))).toBeUndefined();
  });
});

describe("fontModifier and swiftWeightForFigStyle", () => {
  it("maps Figma styles to SwiftUI Font.Weight names", () => {
    expect(swiftWeightForFigStyle({ family: "Inter", style: "Regular" })).toBe("regular");
    expect(swiftWeightForFigStyle({ family: "Inter", style: "SemiBold" })).toBe("semibold");
    expect(swiftWeightForFigStyle({ family: "Inter", style: "Bold" })).toBe("bold");
    expect(swiftWeightForFigStyle({ family: "Inter", style: "Light" })).toBe("light");
  });

  it("emits .font(.system(size:, weight:)) with weight when known", () => {
    const node = makeText({ fontSize: 16, fontName: { family: "Inter", style: "Bold" } });
    expect(applied(node, fontModifier)).toBe(
      "V\n  .font(.system(size: 16, weight: .bold))",
    );
  });

  it("omits weight when style is not a recognised weight token", () => {
    const node = makeText({ fontSize: 13, fontName: { family: "Inter", style: "Italic" } });
    expect(applied(node, fontModifier)).toBe("V\n  .font(.system(size: 13))");
  });

  it("returns undefined when fontSize is missing", () => {
    expect(fontModifier(makeText({}))).toBeUndefined();
  });
});

describe("foregroundColorModifier", () => {
  it("emits .foregroundColor for the first visible SOLID fill", () => {
    const node = makeText({
      fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    expect(applied(node, foregroundColorModifier)).toBe(
      "V\n  .foregroundColor(Color(red: 0, green: 0, blue: 0))",
    );
  });
});

describe("paddingModifier", () => {
  it("compacts uniform padding to .padding(n)", () => {
    const mod = paddingModifier({ top: 8, right: 8, bottom: 8, left: 8 });
    expect(serialize(leaf(ident("V"), mod ? [mod] : []))).toBe("V\n  .padding(8)");
  });

  it("emits EdgeInsets for non-uniform padding", () => {
    const mod = paddingModifier({ top: 4, right: 8, bottom: 12, left: 16 });
    expect(serialize(leaf(ident("V"), mod ? [mod] : []))).toBe(
      "V\n  .padding(EdgeInsets(top: 4, leading: 16, bottom: 12, trailing: 8))",
    );
  });

  it("returns undefined when all sides are zero", () => {
    expect(paddingModifier({ top: 0, right: 0, bottom: 0, left: 0 })).toBeUndefined();
  });
});

describe("offsetModifier", () => {
  it("emits .offset(x:, y:) for non-zero offset", () => {
    const mod = offsetModifier(12, -4);
    expect(serialize(leaf(ident("V"), mod ? [mod] : []))).toBe(
      "V\n  .offset(x: 12, y: -4)",
    );
  });

  it("returns undefined when both axes are zero", () => {
    expect(offsetModifier(0, 0)).toBeUndefined();
  });
});
