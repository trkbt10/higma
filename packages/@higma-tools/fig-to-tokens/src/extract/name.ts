/**
 * @file Token-name slugging.
 *
 * Figma names are free-form strings — they can contain slashes,
 * spaces, parentheses, emoji, full-width chars, anything a Latin-1
 * keyboard can type. Two consumers need slugs:
 *
 *   - DTCG JSON: `/` separates levels, everything else stays mostly
 *     literal (only quote / control chars need escaping by the JSON
 *     serialiser).
 *   - CSS custom properties: must match `[A-Za-z0-9_-]+`; any other
 *     char becomes `-`, runs collapse, leading / trailing dashes are
 *     trimmed.
 *
 * Both forms are derived from the same Figma source name so a JSON
 * token at path `colors/Brand/Primary 50%` corresponds to the CSS
 * variable `--colors-brand-primary-50`.
 */

/** Build a slash-separated DTCG path from a free-form Figma name. */
export function buildTokenPath(...parts: readonly string[]): string {
  return parts
    .flatMap((part) => part.split("/"))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");
}

/**
 * Build a CSS-safe slug from a free-form name. Folds any non-ASCII /
 * non-identifier char to `-`, collapses runs of dashes, and trims
 * leading / trailing dashes. Result is always lowercase to dodge the
 * case-folding ambiguity CSS custom properties technically allow.
 */
export function slugifyForCss(input: string): string {
  const lower = input.toLowerCase();
  // `\p{L}` / `\p{N}` would let non-ASCII letters through, but CSS
  // custom-property names are ASCII-only in every shipping browser. Be
  // conservative and stick to A–Z, 0–9, underscore, dash.
  const replaced = lower.replace(/[^a-z0-9_-]+/g, "-");
  const collapsed = replaced.replace(/-+/g, "-");
  return collapsed.replace(/^-|-$/g, "");
}

/**
 * Build a CSS variable id (without the leading `--`) by slugging each
 * path segment independently and joining with `-`. Segments are
 * slugged separately so an originally-slashed name keeps its hierarchy
 * visible in the flattened CSS id.
 */
export function buildCssId(path: string, ...prefixes: readonly string[]): string {
  const segments = [...prefixes, path];
  return segments
    .flatMap((segment) => segment.split("/"))
    .map((segment) => slugifyForCss(segment))
    .filter((segment) => segment.length > 0)
    .join("-");
}
