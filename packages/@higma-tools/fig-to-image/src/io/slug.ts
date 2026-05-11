/**
 * @file Filename slug + template application helpers.
 *
 * Pure: no IO, no filesystem access. Lives in its own module so
 * the slug behaviour is unit-testable without touching the
 * harness.
 */

/**
 * Slugify a fig node's `name` field into a filename component.
 *
 * Fig naming allows arbitrary characters (`/`, spaces, dashes,
 * hashes) which are illegal or awkward in filesystem paths. We
 * lowercase, replace any non-`[a-z0-9]` run with a single hyphen,
 * strip leading/trailing hyphens, and fall back to `"frame"` when
 * the input collapses to an empty string.
 */
export function slugifyName(name: string): string {
  const lowered = name.toLowerCase();
  const replaced = lowered.replace(/[^a-z0-9]+/gu, "-");
  const trimmed = replaced.replace(/^-+|-+$/gu, "");
  if (trimmed.length > 0) {
    return trimmed;
  }
  return "frame";
}

/**
 * Substitute `{name}` in the template with the slugified node
 * name. Unknown placeholders are passed through verbatim — the
 * caller is responsible for declaring the syntax in their docs.
 */
export function applyFilename(template: string, name: string): string {
  return template.replace(/\{name\}/gu, slugifyName(name));
}
