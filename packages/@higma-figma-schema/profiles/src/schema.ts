/**
 * @file Bundled Figma Kiwi schema and enum-table SoT.
 *
 * The schema JSON shipped here is the canonical source of truth for
 * every product that reads, writes, or transforms `.fig` documents
 * inside this monorepo. Numeric enum values, structure definitions,
 * and message-format wiring all come from this one file — no module
 * is allowed to hand-write a parallel enum table that drifts
 * silently from what Figma actually emits.
 *
 * `getFigEnumTable(name)` returns a `name → number` map for any
 * enum definition. Callers that need a stable, named subset of the
 * map (e.g. `BlendMode = "NORMAL"`) should obtain it via
 * `requireFigEnumTable(name, requiredNames)` — that asserts at
 * module load that the schema actually contains the names the
 * caller relies on, so a future schema bump that drops a name fails
 * fast instead of producing silently miscoded fig files.
 */

import figmaSchemaJson from "./figma-schema.json";

/**
 * Minimal structural projection of `KiwiSchema`. We deliberately do
 * not import `KiwiSchema` from `@higma-codecs/kiwi` here because
 * `@higma-figma-schema` sits beneath the codec layer in the package
 * boundary stack — pulling a higher-layer type would invert the
 * dependency graph. The shape is a pure superset of what we need.
 */
export type FigSchemaDefinition = {
  readonly name: string;
  readonly kind: string;
  readonly fields: readonly { readonly name: string; readonly value: number; readonly type?: string }[];
};

export type FigSchema = {
  readonly definitions: readonly FigSchemaDefinition[];
};

/** Bundled canonical Figma Kiwi schema. */
export const FIGMA_KIWI_SCHEMA: FigSchema = figmaSchemaJson;

/**
 * `name → numeric value` map for one of the schema's ENUM
 * definitions. Returned object is frozen and shared — callers that
 * need to mutate must clone first.
 */
export type FigEnumTable = Readonly<Record<string, number>>;

const ENUM_TABLE_CACHE = new Map<string, FigEnumTable>();

function findDefinition(name: string): FigSchemaDefinition | undefined {
  return FIGMA_KIWI_SCHEMA.definitions.find((definition) => definition.name === name);
}

function buildEnumTable(definition: FigSchemaDefinition): FigEnumTable {
  const table: Record<string, number> = {};
  for (const field of definition.fields) {
    table[field.name] = field.value;
  }
  return Object.freeze(table);
}

/**
 * Return the `name → value` map for an ENUM definition, or
 * `undefined` when the schema has no such ENUM.
 */
export function getFigEnumTable(definitionName: string): FigEnumTable | undefined {
  const cached = ENUM_TABLE_CACHE.get(definitionName);
  if (cached) {
    return cached;
  }
  const definition = findDefinition(definitionName);
  if (!definition || definition.kind !== "ENUM") {
    return undefined;
  }
  const table = buildEnumTable(definition);
  ENUM_TABLE_CACHE.set(definitionName, table);
  return table;
}

/**
 * Return the `name → value` map for an ENUM definition and assert
 * that every name in `requiredNames` is present. Throws at module
 * load if the schema lacks any required name — that is the desired
 * fail-fast behaviour: a schema bump that drops a name we depend on
 * must surface immediately, not silently corrupt fig files.
 *
 * The return type is statically narrowed to `Record<Name, number>`
 * for the supplied literal name tuple, so callers can use the table
 * with strict-key APIs (e.g. `toEnumValue<"CENTER" | "MIN" | ...>`)
 * without weakening their type signatures.
 */
export function requireFigEnumTable<const Name extends string>(
  definitionName: string,
  requiredNames: readonly Name[],
): Readonly<Record<Name, number>> {
  const table = getFigEnumTable(definitionName);
  if (!table) {
    throw new Error(`Figma schema is missing ENUM definition "${definitionName}"`);
  }
  const missing = requiredNames.filter((name) => !(name in table));
  if (missing.length > 0) {
    throw new Error(
      `Figma schema ENUM "${definitionName}" is missing required names: ${missing.join(", ")}. ` +
      `Update the bundled figma-schema.json or fix the call site.`,
    );
  }
  return table as Readonly<Record<Name, number>>;
}

/**
 * Schema-prescribed default name for a Kiwi enum when the field is
 * omitted from the binary encoding.
 *
 * Kiwi's `MESSAGE` framing is tag-prefixed: enum fields whose value
 * equals the declaration's first listed name (always assigned numeric
 * value 0 in canonical Figma definitions) are not written to disk and
 * decode back as `undefined`. The semantically correct way to handle
 * those holes is to materialise the "first listed name" — that is the
 * value Figma's runtime would observe on the missing field.
 *
 * SoT: the schema's declaration order. Anything else (e.g. a hand-
 * picked fallback at the consumer) drifts the moment Figma reorders
 * fields or renames a value, so consumers must route through this
 * helper rather than hard-code an enum name.
 *
 * Throws when the named ENUM is missing or its declaration is empty
 * — both are bugs the caller cannot meaningfully recover from.
 */
export function kiwiOmittedEnumName<const Name extends string>(
  definitionName: string,
  requiredNames: readonly Name[],
): Name {
  const table = requireFigEnumTable(definitionName, requiredNames);
  for (const name of Object.keys(table)) {
    if (table[name as Name] === 0) {
      return name as Name;
    }
  }
  throw new Error(
    `Figma schema ENUM "${definitionName}" has no value-0 entry. Cannot derive Kiwi-omitted default.`,
  );
}

/**
 * Reverse lookup: numeric value → name. Useful when decoding raw
 * Kiwi enum values back into their string identifier.
 */
export function reverseFigEnumTable(definitionName: string): Readonly<Record<number, string>> | undefined {
  const table = getFigEnumTable(definitionName);
  if (!table) {
    return undefined;
  }
  const reversed: Record<number, string> = {};
  for (const [name, value] of Object.entries(table)) {
    // Schema sometimes assigns the same value to multiple names
    // (legacy aliases). The "first" name wins for reverse lookups
    // so we fall back to a stable canonical identifier rather than
    // the alias.
    if (!(value in reversed)) {
      reversed[value] = name;
    }
  }
  return Object.freeze(reversed);
}
