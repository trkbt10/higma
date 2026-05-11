/**
 * @file Read/write Latin-1 textual metadata into a PNG byte stream.
 *
 * Used by the fig-to-image streaming pipeline to embed the
 * fingerprint of the source subtree directly into the rendered
 * PNG. Reading the fingerprint back lets the next run decide
 * whether the on-disk PNG is still authoritative without
 * re-rasterising — the disk read is O(few KB) vs. spinning up
 * the harness.
 *
 * Why we hand-roll PNG chunk surgery here instead of pulling in
 * a library:
 *
 *   - We only need `tEXt` insertion and lookup, not full PNG
 *     parsing. A library would impose a heavier interface and
 *     an extra dep boundary.
 *   - The encoder we point at (the WebGL harness) emits a
 *     well-formed minimal PNG; this module just needs to inject
 *     one chunk before `IEND`.
 *
 * `tEXt` carries ASCII / Latin-1 keys + values separated by a
 * single NUL byte. We use it because:
 *
 *   - Our fingerprint is hex (Latin-1 safe).
 *   - `tEXt` survives every PNG tool we've tested (ImageOptim,
 *     macOS Preview re-encoding, `sips`, browser image decoders).
 *   - `iTXt` would allow UTF-8 but introduces compression flags
 *     and language tags we don't need.
 */

const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const IEND_TYPE = bytesOf("IEND");
const TEXT_TYPE = bytesOf("tEXt");
const NUL_BYTE = 0;

type PngChunk = {
  readonly type: Uint8Array;
  readonly data: Uint8Array;
};

/**
 * Insert (or replace) a `tEXt` chunk with the supplied
 * key/value before the PNG's `IEND` marker. Returns the new
 * PNG bytes.
 *
 * The function does NOT mutate `bytes`. If a `tEXt` chunk with
 * the same key already exists, it is replaced in place — keeps
 * the file size stable across re-runs even if the value length
 * changes.
 *
 * Throws when the input doesn't look like a PNG or is missing
 * an `IEND` chunk. The caller is expected to feed it a freshly-
 * rendered PNG from the harness, so a malformed input means
 * something upstream is broken — defensive recovery would hide
 * that.
 */
export function setTextMetadata(bytes: Uint8Array, key: string, value: string): Uint8Array {
  validateSignature(bytes);
  const chunks = readChunks(bytes);
  const iendIdx = chunks.findIndex((c) => equalBytes(c.type, IEND_TYPE));
  if (iendIdx === -1) {
    throw new Error("setTextMetadata: PNG is missing required IEND chunk");
  }
  const existingIdx = chunks.findIndex(
    (c) => equalBytes(c.type, TEXT_TYPE) && chunkTextKey(c.data) === key,
  );
  const newChunk = buildTextChunk(key, value);
  return assemblePng(replaceOrInsertChunk(chunks, newChunk, existingIdx, iendIdx));
}

function replaceOrInsertChunk(
  chunks: readonly PngChunk[],
  newChunk: PngChunk,
  existingIdx: number,
  iendIdx: number,
): readonly PngChunk[] {
  if (existingIdx >= 0) {
    return chunks.map((c, i) => (i === existingIdx ? newChunk : c));
  }
  return [...chunks.slice(0, iendIdx), newChunk, ...chunks.slice(iendIdx)];
}

/**
 * Read the value of a `tEXt` chunk whose key matches `key`, or
 * return `undefined` if no such chunk exists. Used to short-
 * circuit re-rasterisation when the on-disk PNG's embedded
 * fingerprint matches the freshly-computed one.
 */
export function getTextMetadata(bytes: Uint8Array, key: string): string | undefined {
  validateSignature(bytes);
  const chunks = readChunks(bytes);
  const match = chunks.find((c) => equalBytes(c.type, TEXT_TYPE) && chunkTextKey(c.data) === key);
  if (!match) {
    return undefined;
  }
  return chunkTextValue(match.data);
}

// ---------------------------------------------------------------------------
// PNG chunk plumbing
// ---------------------------------------------------------------------------

function validateSignature(bytes: Uint8Array): void {
  if (bytes.byteLength < PNG_SIGNATURE.byteLength) {
    throw new Error("PNG input too short");
  }
  for (let i = 0; i < PNG_SIGNATURE.byteLength; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error("PNG signature mismatch — input is not a PNG file");
    }
  }
}

/**
 * Walk every chunk in the PNG starting at the byte right after
 * the signature. Recursion replaces `let offset` and keeps the
 * walk pure.
 */
function readChunks(bytes: Uint8Array): readonly PngChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return readChunksAt(bytes, view, PNG_SIGNATURE.byteLength, []);
}

function readChunksAt(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  acc: readonly PngChunk[],
): readonly PngChunk[] {
  if (offset >= bytes.byteLength) {
    return acc;
  }
  if (offset + 8 > bytes.byteLength) {
    throw new Error("PNG truncated mid-chunk-header");
  }
  const length = view.getUint32(offset);
  const typeStart = offset + 4;
  const dataStart = offset + 8;
  const dataEnd = dataStart + length;
  const crcEnd = dataEnd + 4;
  if (crcEnd > bytes.byteLength) {
    throw new Error("PNG truncated mid-chunk-body");
  }
  const type = cloneBytes(bytes.subarray(typeStart, dataStart));
  const data = cloneBytes(bytes.subarray(dataStart, dataEnd));
  const next = [...acc, { type, data }];
  if (equalBytes(type, IEND_TYPE)) {
    // IEND is the last chunk; anything past it is decoration we
    // don't preserve.
    return next;
  }
  return readChunksAt(bytes, view, crcEnd, next);
}

function chunkByteLength(chunk: PngChunk): number {
  // length(4) + type(4) + data(N) + crc(4)
  return 12 + chunk.data.byteLength;
}

function assemblePng(chunks: readonly PngChunk[]): Uint8Array {
  const total = chunks.reduce((acc, c) => acc + chunkByteLength(c), PNG_SIGNATURE.byteLength);
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE, 0);
  const view = new DataView(out.buffer);
  writeChunksAt(out, view, chunks, 0, PNG_SIGNATURE.byteLength);
  return out;
}

function writeChunksAt(
  out: Uint8Array,
  view: DataView,
  chunks: readonly PngChunk[],
  index: number,
  offset: number,
): void {
  if (index >= chunks.length) {
    return;
  }
  const chunk = chunks[index]!;
  view.setUint32(offset, chunk.data.byteLength);
  out.set(chunk.type, offset + 4);
  out.set(chunk.data, offset + 8);
  const crc = crc32Of(chunk.type, chunk.data);
  view.setUint32(offset + 8 + chunk.data.byteLength, crc);
  writeChunksAt(out, view, chunks, index + 1, offset + chunkByteLength(chunk));
}

function buildTextChunk(key: string, value: string): PngChunk {
  if (key.length === 0 || key.length > 79) {
    throw new Error("PNG tEXt key must be 1..79 Latin-1 characters");
  }
  if (key.indexOf(String.fromCharCode(NUL_BYTE)) !== -1) {
    throw new Error("PNG tEXt key may not contain NUL (U+0000)");
  }
  const keyBytes = latin1Encode(key);
  const valueBytes = latin1Encode(value);
  const data = new Uint8Array(keyBytes.byteLength + 1 + valueBytes.byteLength);
  data.set(keyBytes, 0);
  data[keyBytes.byteLength] = NUL_BYTE;
  data.set(valueBytes, keyBytes.byteLength + 1);
  return { type: TEXT_TYPE, data };
}

function chunkTextKey(data: Uint8Array): string {
  const nul = data.indexOf(NUL_BYTE);
  const slice = nul < 0 ? data : data.subarray(0, nul);
  return latin1Decode(slice);
}

function chunkTextValue(data: Uint8Array): string {
  const nul = data.indexOf(NUL_BYTE);
  if (nul < 0) {
    return "";
  }
  return latin1Decode(data.subarray(nul + 1));
}

// ---------------------------------------------------------------------------
// CRC-32 (PNG variant)
// ---------------------------------------------------------------------------

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    table[n] = crcEntryFor(n, 0, 8);
  }
  return table;
}

function crcEntryFor(value: number, step: number, remaining: number): number {
  if (remaining === 0) {
    return value >>> 0;
  }
  const next = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return crcEntryFor(next, step + 1, remaining - 1);
}

function crc32Of(type: Uint8Array, data: Uint8Array): number {
  const seeded = crcUpdate(0xffffffff, type, 0);
  const finalCrc = crcUpdate(seeded, data, 0);
  return (finalCrc ^ 0xffffffff) >>> 0;
}

function crcUpdate(crc: number, bytes: Uint8Array, i: number): number {
  if (i >= bytes.byteLength) {
    return crc;
  }
  const tableIndex = (crc ^ bytes[i]!) & 0xff;
  const next = (CRC_TABLE[tableIndex]! ^ (crc >>> 8)) >>> 0;
  return crcUpdate(next, bytes, i + 1);
}

// ---------------------------------------------------------------------------
// Latin-1 helpers
// ---------------------------------------------------------------------------

function latin1Encode(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code > 0xff) {
      const hex = code.toString(16).padStart(4, "0");
      throw new Error(`PNG tEXt requires Latin-1 (ISO 8859-1); got codepoint U+${hex}`);
    }
    out[i] = code;
  }
  return out;
}

function latin1Decode(bytes: Uint8Array): string {
  // Avoid a `let` accumulator: build an array of single-char
  // strings then join.  Equivalent to repeated `s += ...` but
  // keeps the function strictly expression-shaped per the
  // project's "no let outside controlled loops" style.
  const chars = Array.from(bytes, (b) => String.fromCharCode(b));
  return chars.join("");
}

function bytesOf(ascii: string): Uint8Array {
  const out = new Uint8Array(ascii.length);
  for (let i = 0; i < ascii.length; i += 1) {
    out[i] = ascii.charCodeAt(i);
  }
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function cloneBytes(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(source.byteLength);
  out.set(source);
  return out;
}
