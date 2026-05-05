/**
 * @file Schema encoder for fig-kiwi roundtrip output
 */

import { ByteBuffer } from "@higma/kiwi/byte-buffer";
import type { KiwiSchema } from "@higma/kiwi/types";

function writeNullString(buffer: ByteBuffer, value: string): void {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  for (const byte of bytes) {
    buffer.writeByte(byte);
  }
  buffer.writeByte(0);
}

function encodeDefinitionKind(kind: string): number {
  switch (kind) {
    case "ENUM":
      return 0;
    case "STRUCT":
      return 1;
    default:
      return 2;
  }
}

/**
 * Encode a Kiwi schema into the null-terminated string variant used by fig-kiwi.
 */
export function encodeFigSchema(schema: KiwiSchema): Uint8Array {
  const buffer = new ByteBuffer();
  buffer.writeVarUint(schema.definitions.length);

  for (const def of schema.definitions) {
    writeNullString(buffer, def.name);
    buffer.writeByte(encodeDefinitionKind(def.kind));
    buffer.writeVarUint(def.fields.length);

    for (const field of def.fields) {
      writeNullString(buffer, field.name);
      buffer.writeVarInt(field.typeId);
      buffer.writeByte(field.isArray ? 1 : 0);
      buffer.writeVarUint(field.value);
    }
  }

  return buffer.toUint8Array();
}
