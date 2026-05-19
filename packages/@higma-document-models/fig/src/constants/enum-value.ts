/**
 * @file Figma Kiwi enum value construction.
 */

/**
 * Represents a Kiwi enum value with numeric value and string name
 */
export type EnumValue<T extends string> = { value: number; name: T };

/**
 * Convert a string enum name to a Kiwi enum value object
 *
 * @param name - The enum name (e.g., "CENTER", "HORIZONTAL")
 * @param values - The value map (e.g., STACK_ALIGN_VALUES)
 * @returns EnumValue object or undefined if name is undefined
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
