/**
 * @file CSS-variable serialiser for the token set.
 *
 * Output is a single `tokens.css` file with one `:root` block. Sections
 * are ordered colors → typography → spacing → radii → shadows so the
 * generated file reads like a design-system manifest. Comments (`/* ... *\/`)
 * include the original Figma name when one exists so the file is
 * traceable back to the source.
 *
 * Typography tokens emit a triple of variables — `font-family`,
 * `font-size`, `font-weight` (when known) — plus optional
 * `line-height` / `letter-spacing`. The JSX emitter pulls each
 * sub-property by its own variable so consumers can mix and match
 * (e.g. override font-size while keeping the family token).
 */
import type {
  ColorToken,
  RadiusToken,
  ShadowToken,
  SpacingToken,
  TokenSet,
  TypographyToken,
} from "./types";
import { figColorToCss } from "../lib/css-format/color";

function colorToCss(c: ColorToken): string {
  return figColorToCss(c.value);
}

function colorComment(token: ColorToken): string {
  if (token.source === "style" && token.figmaName) {
    return ` /* ${escapeCommentText(token.figmaName)} */`;
  }
  return "";
}

function escapeCommentText(input: string): string {
  return input.replace(/\*\//g, "*\\/");
}

function quoteFontFamily(family: string): string {
  // Always end with a generic-family fallback so missing custom fonts
  // degrade gracefully. The CSS spec mandates a generic family at the
  // end of the stack — we pick `system-ui` as the closest neutral
  // proxy for design-tool sans-serif.
  return `${quoteFontName(family)}, system-ui, -apple-system, "Segoe UI", sans-serif`;
}

function quoteFontName(family: string): string {
  if (/^[A-Za-z][A-Za-z0-9 _-]*$/.test(family)) {
    return `"${family}"`;
  }
  return JSON.stringify(family);
}

function emitColorBlock(colors: ReadonlyMap<string, ColorToken>): string {
  if (colors.size === 0) {
    return "";
  }
  const lines = ["  /* Colors */"];
  for (const token of colors.values()) {
    lines.push(`  --${token.id}: ${colorToCss(token)};${colorComment(token)}`);
  }
  return lines.join("\n");
}

function emitTypographyBlock(typography: ReadonlyMap<string, TypographyToken>): string {
  if (typography.size === 0) {
    return "";
  }
  const lines = ["  /* Typography */"];
  for (const token of typography.values()) {
    lines.push(emitTypographyToken(token));
  }
  return lines.join("\n");
}

function emitTypographyToken(token: TypographyToken): string {
  const items = [
    `  --${token.id}-font-family: ${quoteFontFamily(token.fontFamily)};`,
    `  --${token.id}-font-size: ${token.fontSize}px;`,
  ];
  if (token.fontWeight !== undefined) {
    items.push(`  --${token.id}-font-weight: ${token.fontWeight};`);
  }
  if (token.lineHeight !== undefined) {
    items.push(`  --${token.id}-line-height: ${token.lineHeight};`);
  }
  if (token.letterSpacing !== undefined) {
    items.push(`  --${token.id}-letter-spacing: ${token.letterSpacing};`);
  }
  return items.join("\n");
}

function emitSpacingBlock(spacing: ReadonlyMap<string, SpacingToken>): string {
  if (spacing.size === 0) {
    return "";
  }
  const lines = ["  /* Spacing */"];
  for (const token of spacing.values()) {
    lines.push(`  --${token.id}: ${token.value}px;`);
  }
  return lines.join("\n");
}

function emitRadiusBlock(radii: ReadonlyMap<string, RadiusToken>): string {
  if (radii.size === 0) {
    return "";
  }
  const lines = ["  /* Radii */"];
  for (const token of radii.values()) {
    lines.push(`  --${token.id}: ${token.value}px;`);
  }
  return lines.join("\n");
}

function emitShadowBlock(shadows: ReadonlyMap<string, ShadowToken>): string {
  if (shadows.size === 0) {
    return "";
  }
  const lines = ["  /* Shadows */"];
  for (const token of shadows.values()) {
    lines.push(`  --${token.id}: ${token.cssValue};`);
  }
  return lines.join("\n");
}

/**
 * Reset block prepended to every generated stylesheet.
 *
 * Without `box-sizing: border-box` the default content-box model
 * makes `width: 360px; padding: 12px;` render as 384px wide — the
 * padding is added on top of the declared width. Every generated
 * frame uses Figma's frame size as its own width plus a non-zero
 * `padding`, so the content-box default visibly inflates every
 * container by the padding amount and shifts every sibling.
 *
 * The reset is scoped to `.fig-page` and its descendants (every
 * generated page-root `<div>` carries that class). A bare global
 * `*` selector would leak into surrounding application chrome — a
 * navigation bar or modal that wraps the generated output — and
 * silently change layout there.
 */
/**
 * Class name applied to every generated page-root `<div>`. Keep this
 * in sync with the CSS reset selector below — both must reference
 * the same identifier for the scoped `box-sizing: border-box`
 * contract to apply.
 */
export const FIG_PAGE_CLASS = "fig-page";
const BOX_SIZING_RESET = [
  `.${FIG_PAGE_CLASS},`,
  `.${FIG_PAGE_CLASS} *,`,
  `.${FIG_PAGE_CLASS} *::before,`,
  `.${FIG_PAGE_CLASS} *::after {`,
  "  box-sizing: border-box;",
  "}",
].join("\n");

/** Emit the full design-token CSS file. */
export function tokensToCss(tokens: TokenSet): string {
  const blocks = [
    emitColorBlock(tokens.colors),
    emitTypographyBlock(tokens.typography),
    emitSpacingBlock(tokens.spacing),
    emitRadiusBlock(tokens.radii),
    emitShadowBlock(tokens.shadows),
  ].filter((block) => block.length > 0);

  const root = renderRoot(blocks);
  return `${BOX_SIZING_RESET}\n\n${root}`;
}

function renderRoot(blocks: readonly string[]): string {
  if (blocks.length === 0) {
    return ":root {\n}\n";
  }
  return `:root {\n${blocks.join("\n\n")}\n}\n`;
}
