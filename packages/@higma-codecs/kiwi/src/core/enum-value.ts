/**
 * @file Kiwi enum value extraction.
 */

import { KiwiBuildError } from "../errors";

/**
 * Extract enum value with strict validation.
 */
export function extractEnumValue(value: unknown): number {
  if (typeof value !== "object" || value === null) {
    throw new KiwiBuildError(
      `Expected enum object with "value" property, got ${value === null ? "null" : typeof value}`
    );
  }
  if (!("value" in value)) {
    throw new KiwiBuildError(
      `Expected enum object with "value" property, got object without "value"`
    );
  }
  const enumValue = (value as { readonly value: unknown }).value;
  if (typeof enumValue !== "number") {
    throw new KiwiBuildError(
      `Expected enum "value" to be number, got ${typeof enumValue}`
    );
  }
  return enumValue;
}
