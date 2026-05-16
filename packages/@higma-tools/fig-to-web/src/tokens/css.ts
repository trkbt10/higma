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
import { buildCssFontFamily } from "@higma-document-models/fig/font";

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

/**
 * Emit the CSS `font-family` value for a token's family.
 *
 * Delegates to the canonical `buildCssFontFamily` SoT, which routes
 * through `COMMON_FONT_MAPPINGS` (Inter, Roboto, SF Pro, …) before
 * falling back to a category-default stack. Re-implementing the
 * fallback chain here would silently disagree with the inline
 * `style.ts` emitter and the renderer's resolver.
 */
function quoteFontFamily(family: string): string {
  return buildCssFontFamily(family);
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
 * Emit the full design-token CSS file.
 *
 * The earlier revision prepended a `.fig-page`-scoped
 * `box-sizing: border-box` reset so generated `<div>` widths
 * (Figma frame width + padding) rendered with the padding inside
 * the authored width. The class is gone now: it risked collision
 * with consumer markup and forced a `page` concept onto every
 * generated component, which doesn't apply when the same emit is
 * consumed as a re-usable component inside a larger React tree.
 * The reset moved to per-element `style.boxSizing = "border-box"`
 * in the emit pipeline, so the token file no longer carries a
 * structural CSS rule — only design-token CSS custom properties.
 */
export function tokensToCss(tokens: TokenSet): string {
  const blocks = [
    emitColorBlock(tokens.colors),
    emitTypographyBlock(tokens.typography),
    emitSpacingBlock(tokens.spacing),
    emitRadiusBlock(tokens.radii),
    emitShadowBlock(tokens.shadows),
  ].filter((block) => block.length > 0);

  return renderRoot(blocks);
}

function renderRoot(blocks: readonly string[]): string {
  if (blocks.length === 0) {
    return ":root {\n}\n";
  }
  return `:root {\n${blocks.join("\n\n")}\n}\n`;
}
