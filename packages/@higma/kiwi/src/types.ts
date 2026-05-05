/**
 * @file Kiwi schema and binary codec types
 */

/** Kiwi primitive types. */
export type KiwiPrimitiveType =
  | "bool"
  | "byte"
  | "int"
  | "uint"
  | "float"
  | "string"
  | "int64"
  | "uint64";

/** Kiwi definition kinds. */
export type KiwiDefinitionKind = "ENUM" | "STRUCT" | "MESSAGE";

/** Kiwi field definition. */
export type KiwiField = {
  readonly name: string;
  readonly type: KiwiPrimitiveType | string;
  readonly typeId: number;
  readonly isArray: boolean;
  readonly value: number;
};

/** Kiwi definition. */
export type KiwiDefinition = {
  readonly name: string;
  readonly kind: KiwiDefinitionKind;
  readonly fields: readonly KiwiField[];
};

/** Kiwi schema. */
export type KiwiSchema = {
  readonly definitions: readonly KiwiDefinition[];
};
