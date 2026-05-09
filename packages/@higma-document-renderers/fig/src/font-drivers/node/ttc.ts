/**
 * @file TrueType Collection (.ttc) decoder.
 *
 * Apple bundles its core OS faces — Helvetica, Helvetica Neue, Avenir,
 * Times, Geneva, etc. — as `.ttc` containers each carrying multiple
 * faces in a single file. opentype.js's stock `parse()` does not
 * understand the TTC header, so the renderer's font loader has been
 * forced to skip these files entirely. That left every macOS install
 * unable to resolve the most common system fonts — `font-family:
 * Helvetica` falls back to whatever's left over.
 *
 * This module reads the TTC header (magic `ttcf` + per-face offsets
 * into the embedded TTF/OTF table directories), reconstructs a
 * standalone TTF buffer for each face by copying its referenced
 * tables into a fresh single-face header, and yields one parseable
 * `ArrayBuffer` per face. opentype.js then handles each as if it
 * were a plain `.ttf`.
 *
 * Spec references:
 *   - Microsoft OpenType TTC reference:
 *     https://learn.microsoft.com/en-us/typography/opentype/spec/otff#font-collections
 *   - The `name` table is identical between TTC-embedded and
 *     standalone faces, so post-extraction `parse()` can read family
 *     / subfamily / postScriptName via the existing helpers.
 */

const TTC_MAGIC = 0x74746366; // 'ttcf'
const HEAD_TABLE_TAG = 0x68656164; // 'head'
const SFNT_VERSION_TRUETYPE = 0x00010000;
const SFNT_VERSION_OTTO = 0x4f54544f; // 'OTTO'

type TableRecord = {
  readonly tag: number;
  readonly checksum: number;
  readonly offset: number;
  readonly length: number;
};

type TableLayoutEntry = {
  readonly record: TableRecord;
  readonly outOffset: number;
  readonly paddedLength: number;
};

/**
 * Quickly check the first four bytes of a buffer for the TTC magic.
 * Cheap enough to call before deciding whether to invoke the full
 * extractor.
 */
export function isTtc(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) {
    return false;
  }
  const view = new DataView(buffer);
  return view.getUint32(0) === TTC_MAGIC;
}

/**
 * Extract every face inside a TTC container as a list of standalone
 * TTF/OTF byte buffers. Each yielded buffer parses cleanly through
 * `opentype.parse()`.
 *
 * Faces whose extraction fails (table truncated, invalid offset) are
 * skipped — a partial result is more useful than throwing on the
 * first malformed face. Throw only when the container itself is not
 * a TTC.
 */
export function extractTtcFaces(buffer: ArrayBuffer): ArrayBuffer[] {
  if (!isTtc(buffer)) {
    throw new Error("extractTtcFaces: buffer is not a TrueType Collection");
  }
  const view = new DataView(buffer);
  // TTC header: tag (4) + majorVersion (2) + minorVersion (2) + numFonts (4) + offsets[numFonts] (4*N)
  const numFonts = view.getUint32(8);
  const offsets: number[] = [];
  for (let i = 0; i < numFonts; i += 1) {
    offsets.push(view.getUint32(12 + i * 4));
  }
  const faces: ArrayBuffer[] = [];
  for (const offset of offsets) {
    const face = tryExtractFace(buffer, offset);
    if (face) {
      faces.push(face);
    }
  }
  return faces;
}

/**
 * Reconstruct a standalone single-face TTF/OTF from one face inside a
 * TTC, given the byte offset where its sfnt table directory begins.
 *
 * Layout we produce:
 *
 *   sfnt header (12 bytes)
 *   N × table record (16 bytes each)
 *   table data, concatenated, each entry padded to 4-byte alignment
 *
 * Each table record's `offset` is rewritten to point inside our new
 * buffer; the original `length` and `checksum` are preserved.
 */
function tryExtractFace(buffer: ArrayBuffer, faceOffset: number): ArrayBuffer | undefined {
  if (faceOffset < 0 || faceOffset + 12 > buffer.byteLength) {
    return undefined;
  }
  const view = new DataView(buffer);
  const sfntVersion = view.getUint32(faceOffset);
  if (sfntVersion !== SFNT_VERSION_TRUETYPE && sfntVersion !== SFNT_VERSION_OTTO) {
    return undefined;
  }
  const numTables = view.getUint16(faceOffset + 4);
  const tableDirectoryOffset = faceOffset + 12;
  const tableRecordsLength = numTables * 16;
  if (tableDirectoryOffset + tableRecordsLength > buffer.byteLength) {
    return undefined;
  }

  const records: TableRecord[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const recordOffset = tableDirectoryOffset + i * 16;
    records.push({
      tag: view.getUint32(recordOffset),
      checksum: view.getUint32(recordOffset + 4),
      offset: view.getUint32(recordOffset + 8),
      length: view.getUint32(recordOffset + 12),
    });
  }

  // Compute output offsets; each table padded to 4-byte alignment.
  const headerLength = 12 + tableRecordsLength;
  const layout = layOutTables(records, headerLength, buffer.byteLength);
  if (!layout) {
    return undefined;
  }
  const dataLayout: readonly TableLayoutEntry[] = layout.entries;
  const totalLength = layout.totalLength;

  const out = new ArrayBuffer(totalLength);
  const outView = new DataView(out);
  const outBytes = new Uint8Array(out);
  const inBytes = new Uint8Array(buffer);

  // sfnt header
  outView.setUint32(0, sfntVersion);
  outView.setUint16(4, numTables);
  // searchRange / entrySelector / rangeShift — recompute from numTables
  // so the produced font passes opentype.js's strictness checks.
  const log2 = Math.floor(Math.log2(numTables));
  const searchRange = (1 << log2) * 16;
  outView.setUint16(6, searchRange);
  outView.setUint16(8, log2);
  outView.setUint16(10, numTables * 16 - searchRange);

  for (let i = 0; i < records.length; i += 1) {
    const layout = dataLayout[i]!;
    const record = layout.record;
    const recordOffset = 12 + i * 16;
    outView.setUint32(recordOffset, record.tag);
    // The 'head' table's checksumAdjustment field is computed from
    // the whole-font checksum, so its own table checksum no longer
    // matches after extraction. opentype.js does not enforce these,
    // so preserving the original value is acceptable.
    outView.setUint32(recordOffset + 4, record.checksum);
    outView.setUint32(recordOffset + 8, layout.outOffset);
    outView.setUint32(recordOffset + 12, record.length);
    outBytes.set(
      inBytes.subarray(record.offset, record.offset + record.length),
      layout.outOffset,
    );
    if (record.tag === HEAD_TABLE_TAG) {
      // checksumAdjustment lives at offset 8 inside the head table.
      // Some readers reject mismatched values; zero it out so the
      // font still validates after extraction.
      const headOut = layout.outOffset;
      outView.setUint32(headOut + 8, 0);
    }
  }
  return out;
}

/**
 * Lay out a sequence of TTF tables back-to-back, padding each entry to
 * the 4-byte boundary the OpenType spec demands. Returns undefined
 * when any record's source range escapes the input buffer — the
 * caller treats that as an unparseable face.
 */
function layOutTables(
  records: readonly TableRecord[],
  headerLength: number,
  bufferByteLength: number,
): { readonly entries: readonly TableLayoutEntry[]; readonly totalLength: number } | undefined {
  const entries: TableLayoutEntry[] = [];
  const cursorRef = { value: headerLength };
  for (const record of records) {
    if (record.offset + record.length > bufferByteLength) {
      return undefined;
    }
    const paddedLength = (record.length + 3) & ~3;
    entries.push({ record, outOffset: cursorRef.value, paddedLength });
    cursorRef.value += paddedLength;
  }
  return { entries, totalLength: cursorRef.value };
}
