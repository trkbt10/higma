/** @file Unit tests for the CSS custom-property emitter. */
import { tokensToCss } from "./css";
import type { Token, TokenSet } from "../token-set";

function colorTokenWithModes(args: {
  readonly path: string;
  readonly cssId: string;
  readonly setSlug: string;
  readonly setName: string;
  readonly defaultMode: string;
  readonly valuesByMode: ReadonlyArray<readonly [string, string]>;
}): Token {
  return {
    path: args.path,
    cssId: args.cssId,
    source: "variable",
    variableSetSlug: args.setSlug,
    variableSetName: args.setName,
    defaultModeName: args.defaultMode,
    valuesByMode: new Map(
      args.valuesByMode.map(([mode, css]) => [mode, { kind: "color", css }] as const),
    ),
  };
}

describe("tokensToCss", () => {
  it("emits :root with the default-mode value for a colour variable", () => {
    const token = colorTokenWithModes({
      path: "Colors/Primary",
      cssId: "colors-primary",
      setSlug: "colors",
      setName: "Colors",
      defaultMode: "Light",
      valuesByMode: [["Light", "#0066ff"]],
    });
    const set: TokenSet = {
      tokens: [token],
      modesBySetSlug: new Map([["colors", ["Light"]]]),
    };
    const css = tokensToCss(set, { preamble: "none" });
    expect(css).toContain(":root {");
    expect(css).toContain("--colors-primary: #0066ff;");
  });

  it("emits a per-set mode override block for each non-default mode", () => {
    const token = colorTokenWithModes({
      path: "Colors/Primary",
      cssId: "colors-primary",
      setSlug: "colors",
      setName: "Colors",
      defaultMode: "Light",
      valuesByMode: [
        ["Light", "#0066ff"],
        ["Dark", "#3399ff"],
      ],
    });
    const set: TokenSet = {
      tokens: [token],
      modesBySetSlug: new Map([["colors", ["Light", "Dark"]]]),
    };
    const css = tokensToCss(set, { preamble: "none" });
    expect(css).toContain(`:root[data-colors-mode="Dark"]`);
    expect(css).toContain("--colors-primary: #3399ff;");
    // Default value still in :root.
    expect(css).toContain("--colors-primary: #0066ff;");
  });

  it("skips override block when the non-default value equals the default", () => {
    const token = colorTokenWithModes({
      path: "Colors/Primary",
      cssId: "colors-primary",
      setSlug: "colors",
      setName: "Colors",
      defaultMode: "Light",
      valuesByMode: [
        ["Light", "#0066ff"],
        ["Dark", "#0066ff"],
      ],
    });
    const set: TokenSet = {
      tokens: [token],
      modesBySetSlug: new Map([["colors", ["Light", "Dark"]]]),
    };
    const css = tokensToCss(set, { preamble: "none" });
    expect(css).not.toContain(`data-colors-mode="Dark"`);
  });

  it("expands typography tokens into sub-property variables", () => {
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
    const css = tokensToCss(set, { preamble: "none" });
    expect(css).toContain(`--heading-h1-font-family: "Inter";`);
    expect(css).toContain("--heading-h1-font-size: 32px;");
    expect(css).toContain("--heading-h1-font-weight: 700;");
    expect(css).toContain("--heading-h1-line-height: 40px;");
    // Letter-spacing omitted.
    expect(css).not.toContain("--heading-h1-letter-spacing");
  });

  it("emits number tokens with the inferred unit", () => {
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
    const css = tokensToCss(set, { preamble: "none" });
    expect(css).toContain("--spacing-md: 16px;");
  });
});
