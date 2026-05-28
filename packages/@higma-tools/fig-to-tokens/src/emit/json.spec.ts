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
