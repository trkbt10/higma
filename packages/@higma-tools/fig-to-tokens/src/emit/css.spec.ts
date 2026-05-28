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

  it("emits unitless number tokens without a suffix", () => {
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
    const css = tokensToCss(set, { preamble: "none" });
    expect(css).toContain("--opacity-disabled: 0.5;");
  });

  it("renders booleans as 1 / 0 and strings as quoted literals", () => {
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
            ["default", { kind: "string", value: "Open Sans" }],
          ]),
        },
      ],
      modesBySetSlug: new Map([
        ["flags", ["default"]],
        ["strings", ["default"]],
      ]),
    };
    const css = tokensToCss(tokens, { preamble: "none" });
    expect(css).toContain("--flag: 1;");
    expect(css).toContain(`--label: "Open Sans";`);
  });

  it("renders shadow and raw-css values verbatim", () => {
    const tokens: TokenSet = {
      tokens: [
        {
          path: "Elevation/MD",
          cssId: "elevation-md",
          source: "style",
          variableSetSlug: null,
          variableSetName: null,
          defaultModeName: "default",
          valuesByMode: new Map([
            ["default", { kind: "shadow", css: "0 2px 4px rgba(0, 0, 0, 0.1)" }],
          ]),
        },
        {
          path: "Bg/Gradient",
          cssId: "bg-gradient",
          source: "style",
          variableSetSlug: null,
          variableSetName: null,
          defaultModeName: "default",
          valuesByMode: new Map([
            ["default", { kind: "raw-css", css: "linear-gradient(to right, red, blue)" }],
          ]),
        },
      ],
      modesBySetSlug: new Map(),
    };
    const css = tokensToCss(tokens, { preamble: "none" });
    expect(css).toContain("--elevation-md: 0 2px 4px rgba(0, 0, 0, 0.1);");
    expect(css).toContain("--bg-gradient: linear-gradient(to right, red, blue);");
  });

  it("expands typography overrides into per-property sub-vars under the mode selector", () => {
    const token: Token = {
      path: "Heading",
      cssId: "heading",
      source: "variable",
      variableSetSlug: "typography",
      variableSetName: "Typography",
      defaultModeName: "Display",
      valuesByMode: new Map([
        [
          "Display",
          {
            kind: "typography",
            fontFamily: '"Inter"',
            fontWeight: 700,
            fontSize: "32px",
            lineHeight: undefined,
            letterSpacing: "0.02em",
          },
        ],
        [
          "Compact",
          {
            kind: "typography",
            fontFamily: '"Inter"',
            fontWeight: 600,
            fontSize: "24px",
            lineHeight: undefined,
            letterSpacing: "0.02em",
          },
        ],
      ]),
    };
    const set: TokenSet = {
      tokens: [token],
      modesBySetSlug: new Map([["typography", ["Display", "Compact"]]]),
    };
    const css = tokensToCss(set, { preamble: "none" });
    expect(css).toContain(`:root[data-typography-mode="Compact"]`);
    expect(css).toContain("--heading-font-family: \"Inter\";");
    expect(css).toContain("--heading-font-size: 24px;");
    expect(css).toContain("--heading-font-weight: 600;");
    expect(css).toContain("--heading-letter-spacing: 0.02em;");
  });

  it("prepends a generated-by banner when preamble option is omitted", () => {
    const set: TokenSet = { tokens: [], modesBySetSlug: new Map() };
    const css = tokensToCss(set);
    expect(css.startsWith("/* Generated by @higma-tools/fig-to-tokens.")).toBe(true);
  });
});
