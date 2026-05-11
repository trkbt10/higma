/**
 * @file Minimal WOFF reader — just enough to extract the decompressed
 * GPOS table bytes when the Extension Positioning fixup is asked to
 * walk a woff-wrapped font.
 *
 * Why we need this: opentype.js parses both raw sfnt (.ttf/.otf) and
 * WOFF (.woff) buffers. For raw sfnt, the fixup walks the buffer's
 * sfnt directory directly to re-resolve LookupType 9 Extension
 * Positioning subtables. For WOFF, the sfnt directory the parser
 * actually used lives behind a per-table zlib-compressed wrapper —
 * the raw buffer we hold no longer carries navigable table offsets.
 *
 * `@fontsource/inter` (and several other webfont bundles) ships .woff,
 * and Inter Bold routes its `kern` feature through a LookupType 9
 * lookup. Without a WOFF-aware path, every Inter `getKerningValue`
 * call returns 0 — text widens ~11px on a `AVATAR To Top`-class
 * sample, which is exactly the residual drift the fixed-font
 * verification case turned up.
 *
 * Scope is deliberately tiny: read the WOFF header + table directory,
 * locate the GPOS table record, return its decompressed body. We do
 * NOT attempt to reconstruct a full sfnt directory or handle
 * brotli-compressed WOFF2 — opentype.js can't parse WOFF2 either, so
 * a WOFF2 path here would chase a font format the renderer's font
 * loader already refuses to index.
 *
 * Spec reference: https://www.w3.org/TR/WOFF/#WOFFHeader
 */

import { inflateSync } from "node:zlib";

/**
 * Magic value at offset 0 of every WOFF1 file: ASCII `wOFF`.
 */
const WOFF_SIGNATURE = 0x774f4646;

/**
 * Tag value the GPOS `TableDirectoryEntry` carries.
 */
const GPOS_TAG = 0x47504f53; // 'G','P','O','S' as uint32 big-endian

export type WoffGposExtraction = {
  /** The decompressed GPOS table contents — what we'd find inside a raw sfnt. */
  readonly gposBytes: ArrayBuffer;
};

/**
 * Detect whether `view` is a WOFF1 buffer.
 */
export function isWoff(view: DataView): boolean {
  if (view.byteLength < 4) {
    return false;
  }
  return view.getUint32(0, false) === WOFF_SIGNATURE;
}

/**
 * Pull the GPOS table out of a WOFF1 buffer and return its
 * decompressed bytes. Returns `undefined` when the WOFF carries no
 * GPOS table (the rare static font that ships no positioning).
 *
 * Throws on header / directory inconsistencies — surfacing a corrupt
 * WOFF is the right behaviour for the renderer's font driver, which
 * already throws on unparseable fonts before they reach this code.
 */
export function extractWoffGpos(view: DataView): WoffGposExtraction | undefined {
  if (!isWoff(view)) {
    throw new Error("extractWoffGpos: buffer does not start with WOFF signature");
  }
  if (view.byteLength < 44) {
    throw new Error(`extractWoffGpos: WOFF header is 44 bytes but buffer is ${view.byteLength}`);
  }
  // Header layout (offsets from start):
  //   00  signature       uint32  (= 'wOFF')
  //   04  flavor          uint32
  //   08  length          uint32
  //   12  numTables       uint16
  //   14  reserved        uint16
  //   16  totalSfntSize   uint32
  //   20  majorVersion    uint16
  //   22  minorVersion    uint16
  //   24  metaOffset      uint32
  //   28  metaLength      uint32
  //   32  metaOrigLength  uint32
  //   36  privOffset      uint32
  //   40  privLength      uint32
  const numTables = view.getUint16(12, false);
  const dirEnd = 44 + numTables * 20;
  if (dirEnd > view.byteLength) {
    throw new Error(
      `extractWoffGpos: table directory (${numTables} entries) overruns buffer`,
    );
  }
  for (let i = 0; i < numTables; i += 1) {
    const recordOffset = 44 + i * 20;
    const tag = view.getUint32(recordOffset, false);
    if (tag !== GPOS_TAG) {
      continue;
    }
    const offset = view.getUint32(recordOffset + 4, false);
    const compLength = view.getUint32(recordOffset + 8, false);
    const origLength = view.getUint32(recordOffset + 12, false);
    if (offset + compLength > view.byteLength) {
      throw new Error(
        `extractWoffGpos: GPOS body (offset=${offset}, compLength=${compLength}) overruns buffer (${view.byteLength})`,
      );
    }
    const compressed = new Uint8Array(view.buffer, view.byteOffset + offset, compLength);
    if (compLength === origLength) {
      // Stored verbatim, no compression.
      const copy = new ArrayBuffer(origLength);
      new Uint8Array(copy).set(compressed);
      return { gposBytes: copy };
    }
    // zlib-deflated. Inflate and verify the size matches origLength.
    const inflated = inflateSync(compressed);
    if (inflated.byteLength !== origLength) {
      throw new Error(
        `extractWoffGpos: GPOS table inflated to ${inflated.byteLength} bytes but directory declared ${origLength}`,
      );
    }
    // Copy into a fresh ArrayBuffer so downstream consumers can mint
    // a DataView without worrying about Buffer-backed slab aliasing.
    const out = new ArrayBuffer(origLength);
    new Uint8Array(out).set(inflated);
    return { gposBytes: out };
  }
  return undefined;
}
