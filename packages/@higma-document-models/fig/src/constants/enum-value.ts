/**
 * @file Figma Kiwi enum value construction.
 */

/**
 * Represents a Kiwi enum value with numeric value and string name
 */
export type EnumValue<T extends string> = { value: number; name: T };

/**
 * Convert a string enum name to a Kiwi enum value object. This is the
 * single canonical lift from "design surface" string names
 * (`"INSIDE"`, `"CENTER"`, `"JUSTIFIED"`, ...) to the wire-format
 * `{ value, name }` pair the Kiwi schema expects.
 *
 * Callers — the spec → FigNode factory, refinement plan appliers,
 * future low-level patchers — go through this single helper so the
 * numeric tag remains a single-source-of-truth concern of the
 * constants module. Reading the `*_VALUES` table directly is a SoT
 * violation: everyone needing the numeric value arrives via
 * `toEnumValue`.
 *
 * Always returns `EnumValue<T> | undefined`. Callers that statically
 * know the input is a literal (non-undefined) string apply a non-null
 * assertion at the call site (`toEnumValue("INSIDE", TABLE)!`); this
 * keeps a single function signature rather than splitting the surface
 * into "may be undefined" / "guaranteed defined" overloads.
 *
 * @param name - The enum name (e.g., "CENTER", "HORIZONTAL")
 * @param values - The value map (e.g., STACK_ALIGN_VALUES)
 */
export function toEnumValue<T extends string>(
  name: T | undefined,
  values: Readonly<Record<T, number>>
): EnumValue<T> | undefined {
  if (name === undefined) {
    return undefined;
  }
  return { value: values[name], name };
}

/**
 * Read a Kiwi enum name and reject non-Kiwi enum payloads.
 */
export function kiwiEnumName<T extends string>(value: unknown, fieldName: string): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object") {
    throw new Error(`${fieldName} must be a Kiwi enum object`);
  }
  if (!("name" in value)) {
    throw new Error(`${fieldName} is missing Kiwi enum name`);
  }
  const name = (value as { readonly name: unknown }).name;
  if (typeof name !== "string") {
    throw new Error(`${fieldName} Kiwi enum name must be a string`);
  }
  return name as T;
}
