/**
 * @file Slug + identifier helpers shared by token extraction and emit.
 *
 * Figma names are free-form Unicode strings and frequently contain
 * slashes (folder hierarchy), parentheses, and whitespace. CSS variable
 * names and React component identifiers must be reduced to a stable
 * ASCII form that does not collide with neighbouring names.
 *
 * Two outputs are needed and they have different rules:
 *
 * - **CSS slug**: lowercase, kebab-case, used for `--color-foo-bar`.
 *   Reserved characters become hyphens; consecutive hyphens collapse.
 *
 * - **JS PascalCase**: a valid JavaScript identifier suitable for a
 *   React component name. Leading digits get a `T` prefix because JSX
 *   parses lowercase tags as DOM elements.
 *
 * Both helpers go through the same `splitWords` step so the two
 * representations always derive from the same word boundaries.
 */

const NON_ALPHANUM = /[^A-Za-z0-9]+/g;

function splitWords(input: string): readonly string[] {
  const replaced = input.replace(/([a-z0-9])([A-Z])/g, "$1-$2");
  return replaced
    .split(NON_ALPHANUM)
    .filter((part) => part.length > 0);
}

/** Convert any string into a kebab-case slug suitable for CSS variable names. */
export function toCssSlug(input: string): string {
  const words = splitWords(input);
  if (words.length === 0) {
    return "x";
  }
  return words.map((w) => w.toLowerCase()).join("-");
}

/** Convert any string into a PascalCase identifier valid as a JS/JSX symbol. */
export function toPascalCase(input: string): string {
  const words = splitWords(input);
  if (words.length === 0) {
    return "Component";
  }
  const joined = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
  if (/^[0-9]/.test(joined)) {
    return `T${joined}`;
  }
  return joined;
}

/**
 * De-dupe a kebab-case id (CSS variable / file slug) by appending
 * `-2`, `-3`, ... on collision. The first occurrence wins the bare
 * name. The hyphen separator is safe inside CSS idents and file paths.
 */
export function uniqueId(base: string, used: Set<string>): string {
  return uniqueWithSeparator(base, used, "-");
}

/**
 * De-dupe a JS identifier by appending an integer suffix without a
 * hyphen separator. `"Property1Off"` collides → `"Property1Off2"`,
 * not `"Property1Off-2"` which would be a syntax error.
 */
export function uniqueIdent(base: string, used: Set<string>): string {
  return uniqueWithSeparator(base, used, "");
}

function uniqueWithSeparator(base: string, used: Set<string>, separator: string): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const collisionIndex = findCollisionIndex(base, used, separator);
  const candidate = `${base}${separator}${collisionIndex}`;
  used.add(candidate);
  return candidate;
}

function findCollisionIndex(base: string, used: Set<string>, separator: string): number {
  const start = 2;
  const limit = 10000;
  for (let i = start; i < limit; i = i + 1) {
    if (!used.has(`${base}${separator}${i}`)) {
      return i;
    }
  }
  throw new Error(`uniqueId: exhausted suffix space for base "${base}"`);
}
