/**
 * @file Product-free Kiwi schema difference helpers.
 */

import type { KiwiSchema } from "@higma-codecs/kiwi/types";

export type KiwiSchemaDiff = {
  readonly addedDefinitions: readonly string[];
  readonly removedDefinitions: readonly string[];
};

function sortedDefinitionNames(schema: KiwiSchema): readonly string[] {
  return schema.definitions.map((definition) => definition.name).sort();
}

function difference(left: readonly string[], right: ReadonlySet<string>): readonly string[] {
  return left.filter((name) => !right.has(name));
}

/** Compare two Kiwi schemas by definition names. */
export function diffKiwiSchemaDefinitions(base: KiwiSchema, candidate: KiwiSchema): KiwiSchemaDiff {
  const baseNames = sortedDefinitionNames(base);
  const candidateNames = sortedDefinitionNames(candidate);
  return {
    addedDefinitions: difference(candidateNames, new Set(baseNames)),
    removedDefinitions: difference(baseNames, new Set(candidateNames)),
  };
}
