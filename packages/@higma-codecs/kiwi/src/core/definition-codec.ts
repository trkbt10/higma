/**
 * @file Definition encoding and decoding logic
 */

import type { DecodeDefinitionOptions, EncodeDefinitionOptions } from "./types";
import { decodeField, encodeField } from "./field-codec";
import { extractEnumValue } from "./enum-value";
import { iterateMessageFields } from "./message-iterator";
import { KiwiParseError } from "../errors";

/**
 * Decode a definition (STRUCT/MESSAGE/ENUM).
 */
export function decodeDefinition(options: DecodeDefinitionOptions): unknown {
  const { buffer, schema, definition, format, decodeValue } = options;
  const result: Record<string, unknown> = {};

  switch (definition.kind) {
    case "STRUCT":
      for (const field of definition.fields) {
        result[field.name] = decodeField({ buffer, schema, field, format, decodeValue });
      }
      break;
    case "MESSAGE":
      for (const { field } of iterateMessageFields({ buffer, definition })) {
        result[field.name] = decodeField({ buffer, schema, field, format, decodeValue });
      }
      break;
    case "ENUM": {
      const value = buffer.readVarUint();
      const field = definition.fields.find((f) => f.value === value);
      if (field === undefined) {
        throw new KiwiParseError(`Unknown enum value ${value} for ${definition.name}`);
      }
      return { value, name: field.name };
    }
    default:
      break;
  }

  return result;
}

/**
 * Encode a definition (STRUCT/MESSAGE/ENUM).
 */
export function encodeDefinition(options: EncodeDefinitionOptions): void {
  const { buffer, schema, definition, message, format, encodeValue, strict } =
    options;

  switch (definition.kind) {
    case "STRUCT":
      for (const field of definition.fields) {
        const value = message[field.name];
        encodeField({ buffer, schema, field, value, format, encodeValue, strict });
      }
      break;
    case "MESSAGE":
      for (const field of definition.fields) {
        const value = message[field.name];
        if (value !== undefined && value !== null) {
          buffer.writeVarUint(field.value);
          encodeField({ buffer, schema, field, value, format, encodeValue, strict });
        }
      }
      buffer.writeVarUint(0); // End marker
      break;
    case "ENUM": {
      const enumValue = extractEnumValue(message);
      buffer.writeVarUint(enumValue);
      break;
    }
    default:
      break;
  }
}
