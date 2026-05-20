/** @file Kiwi image hash codec for Paint.image.hash and package image refs. */

function assertImageHashByte(byte: number, index: number): void {
  if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
    throw new Error(`Kiwi image hash byte at index ${index} must be an integer in [0, 255]`);
  }
}

/**
 * Convert Kiwi `Paint.image.hash` bytes to the package `images/<hex>` ref.
 */
export function figImageHashBytesToHex(hash: readonly number[]): string {
  if (hash.length === 0) {
    throw new Error("Kiwi image hash bytes must not be empty");
  }
  return hash.map((byte, index) => {
    assertImageHashByte(byte, index);
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

/**
 * Convert the package `images/<hex>` ref into Kiwi `Paint.image.hash` bytes.
 */
export function figImageHashHexToBytes(hex: string): readonly number[] {
  if (hex.length === 0) {
    throw new Error("Kiwi image hash hex must not be empty");
  }
  if (hex.length % 2 !== 0) {
    throw new Error(`Kiwi image hash hex length must be even: ${hex.length}`);
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Kiwi image hash hex must contain only hexadecimal characters");
  }

  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return bytes;
}
