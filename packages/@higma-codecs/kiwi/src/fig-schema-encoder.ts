/**
 * @file Fig-family Kiwi schema encoder.
 *
 * Sister of `encodeSchema` in `./encoder.ts`: encodes a Kiwi schema using
 * the null-terminated string variant required by the `.fig` binary format
 * and fig-family canvas payloads. `encodeSchema` writes length-prefixed
 * strings; this writer writes C-style null-terminated strings, which is
 * the on-wire format the fig family expects.
 */

import { ByteBuffer } from "./byte-buffer";
import type { KiwiSchema } from "./types";
import { KIWI_TYPE } from "./schema";

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

function encodeFieldTypeId(definitionKind: string, fieldTypeId: number): number {
  if (definitionKind === "ENUM") {
    return KIWI_TYPE.UINT;
  }
  return fieldTypeId;
}

/**
 * Encode a Kiwi schema into the null-terminated string variant used by
 * fig-family canvases and the `.fig` file format.
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
      buffer.writeVarInt(encodeFieldTypeId(def.kind, field.typeId));
      buffer.writeByte(field.isArray ? 1 : 0);
      buffer.writeVarUint(field.value);
    }
  }

  return buffer.toUint8Array();
}
