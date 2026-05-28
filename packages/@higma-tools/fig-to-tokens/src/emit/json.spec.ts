/** @file Unit tests for the DTCG JSON emitter. */
import { tokensToJson } from "./json";
import type { Token, TokenSet } from "../token-set";

function parse(json: string): unknown {
  return JSON.parse(json);
}

describe("tokensToJson", () => {
  it("nests tokens by slash path with $type/$value leaves", () => {
    const token: Token = {
      path: "Colors/Brand/Primary",
      cssId: "colors-brand-primary",
      source: "variable",
      variableSetSlug: "colors",
      variableSetName: "Colors",
      defaultModeName: "Light",
      valuesByMode: new Map([
        ["Light", { kind: "color", css: "#0066ff" }],
      ]),
    };
    const set: TokenSet = {
      tokens: [token],
      modesBySetSlug: new Map([["colors", ["Light"]]]),
    };
    const json = parse(tokensToJson(set)) as Record<string, unknown>;
    const leaf = (((json.Colors as Record<string, unknown>).Brand as Record<string, unknown>).Primary) as Record<string, unknown>;
    expect(leaf.$type).toBe("color");
    expect(leaf.$value).toBe("#0066ff");
  });

  it("records modes under $extensions.modes for multi-mode tokens", () => {
    const token: Token = {
      path: "Colors/Primary",
      cssId: "colors-primary",
      source: "variable",
      variableSetSlug: "colors",
      variableSetName: "Colors",
      defaultModeName: "Light",
      valuesByMode: new Map([
        ["Light", { kind: "color", css: "#0066ff" }],
        ["Dark", { kind: "color", css: "#3399ff" }],
      ]),
    };
    const set: TokenSet = {
      tokens: [token],
      modesBySetSlug: new Map([["colors", ["Light", "Dark"]]]),
    };
    const json = parse(tokensToJson(set)) as Record<string, unknown>;
    const leaf = (json.Colors as Record<string, unknown>).Primary as Record<string, unknown>;
    const ext = leaf.$extensions as Record<string, unknown>;
    expect(ext.modes).toEqual({ Light: "#0066ff", Dark: "#3399ff" });
    const higma = ext.higma as Record<string, unknown>;
    expect(higma.source).toBe("variable");
    expect(higma.variableSet).toBe("Colors");
    expect(higma.defaultMode).toBe("Light");
  });

  it("tags FLOAT variables as dimension when they carry a unit", () => {
    const token: Token = {
      path: "Spacing/MD",
      cssId: "spacing-md",
      source: "variable",
      variableSetSlug: "spacing",
      variableSetName: "Spacing",
      defaultModeName: "default",
      valuesByMode: new Map([
        ["default", { kind: "number", value: 16, unit: "px" }],
      ]),
    };
    const set: TokenSet = {
      tokens: [token],
      modesBySetSlug: new Map([["spacing", ["default"]]]),
    };
    const json = parse(tokensToJson(set)) as Record<string, unknown>;
    const leaf = (json.Spacing as Record<string, unknown>).MD as Record<string, unknown>;
    expect(leaf.$type).toBe("dimension");
    expect(leaf.$value).toBe("16px");
  });

  it("tags boolean / string / shadow values with the right $type", () => {
    const tokens: TokenSet = {
      tokens: [
        {
          path: "Flag",
          cssId: "flag",
          source: "variable",
          variableSetSlug: "flags",
          variableSetName: "Flags",
          defaultModeName: "default",
          valuesByMode: new Map([
            ["default", { kind: "boolean", value: true }],
          ]),
        },
        {
          path: "Label",
          cssId: "label",
          source: "variable",
          variableSetSlug: "strings",
          variableSetName: "Strings",
          defaultModeName: "default",
          valuesByMode: new Map([
            ["default", { kind: "string", value: "Inter" }],
          ]),
        },
        {
          path: "Elevation/MD",
          cssId: "elevation-md",
          source: "style",
          variableSetSlug: null,
          variableSetName: null,
          defaultModeName: "default",
          valuesByMode: new Map([
            ["default", { kind: "shadow", css: "0 2px 4px rgba(0,0,0,0.1)" }],
          ]),
        },
      ],
      modesBySetSlug: new Map(),
    };
    const json = parse(tokensToJson(tokens)) as Record<string, unknown>;
    expect((json.Flag as Record<string, unknown>).$type).toBe("boolean");
    expect((json.Flag as Record<string, unknown>).$value).toBe(true);
    expect((json.Label as Record<string, unknown>).$type).toBe("string");
    expect(((json.Elevation as Record<string, unknown>).MD as Record<string, unknown>).$type).toBe("shadow");
  });

  it("tags FLOAT without a unit as number", () => {
    const token: Token = {
      path: "Opacity/Disabled",
      cssId: "opacity-disabled",
      source: "variable",
      variableSetSlug: "opacity",
      variableSetName: "Opacity",
      defaultModeName: "default",
      valuesByMode: new Map([
        ["default", { kind: "number", value: 0.5, unit: null }],
      ]),
    };
    const set: TokenSet = {
      tokens: [token],
      modesBySetSlug: new Map([["opacity", ["default"]]]),
    };
    const json = parse(tokensToJson(set)) as Record<string, unknown>;
    const leaf = (json.Opacity as Record<string, unknown>).Disabled as Record<string, unknown>;
    expect(leaf.$type).toBe("number");
    expect(leaf.$value).toBe(0.5);
  });

  it("renames a folder when a leaf already claimed the slot", () => {
    const tokens: TokenSet = {
      tokens: [
        {
          path: "Colors",
          cssId: "colors",
          source: "variable",
          variableSetSlug: "colors",
          variableSetName: "Colors",
          defaultModeName: "default",
          valuesByMode: new Map([
            ["default", { kind: "color", css: "#000000" }],
          ]),
        },
        {
          path: "Colors/Brand/Primary",
          cssId: "colors-brand-primary",
          source: "variable",
          variableSetSlug: "colors",
          variableSetName: "Colors",
          defaultModeName: "default",
          valuesByMode: new Map([
            ["default", { kind: "color", css: "#0066ff" }],
          ]),
        },
      ],
      modesBySetSlug: new Map(),
    };
    const json = parse(tokensToJson(tokens)) as Record<string, unknown>;
    // The flat "Colors" leaf wins its name; the nested Colors/Brand/Primary
    // got routed under "Colors (group)" so the leaf is never silently
    // dropped.
    expect((json.Colors as Record<string, unknown>).$value).toBe("#000000");
    const colorsGroup = json["Colors (group)"] as Record<string, unknown>;
    expect(((colorsGroup.Brand as Record<string, unknown>).Primary as Record<string, unknown>).$value).toBe(
      "#0066ff",
    );
  });

  it("renders typography tokens as composite objects", () => {
    const token: Token = {
      path: "Heading/H1",
      cssId: "heading-h1",
      source: "style",
      variableSetSlug: null,
      variableSetName: null,
      defaultModeName: "default",
      valuesByMode: new Map([
        [
          "default",
          {
            kind: "typography",
            fontFamily: '"Inter"',
            fontWeight: 700,
            fontSize: "32px",
            lineHeight: "40px",
            letterSpacing: undefined,
          },
        ],
      ]),
    };
    const set: TokenSet = { tokens: [token], modesBySetSlug: new Map() };
    const json = parse(tokensToJson(set)) as Record<string, unknown>;
    const leaf = (json.Heading as Record<string, unknown>).H1 as Record<string, unknown>;
    expect(leaf.$type).toBe("typography");
    expect(leaf.$value).toEqual({
      fontFamily: '"Inter"',
      fontSize: "32px",
      fontWeight: 700,
      lineHeight: "40px",
    });
  });
});
