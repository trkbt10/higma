/**
 * @file Raw sfnt/GPOS byte navigation for the Extension Positioning fixup.
 *
 * opentype.js 1.3.x drops `LookupType 9` (Extension Positioning) subtables
 * with a `{error: "GPOS Lookup 9 not supported"}` placeholder. Modern macOS
 * system fonts (SFNS, SF Compact) wrap their entire `kern` feature inside a
 * single `LookupType 9` lookup, so `font.getKerningValue(...)` returns 0 for
 * every pair on those fonts. This module exposes the minimum raw-byte
 * navigation required to re-locate the GPOS table and walk each Lookup's
 * subtable offsets — `subtable-parser.ts` then parses each subtable
 * faithfully and `fixup.ts` stitches the result back into the font.
 *
 * Numbers in OpenType are big-endian. Offsets inside an OpenType subtable
 * tree are stored as `Offset16` / `Offset32` relative to the start of the
 * enclosing parent table — exactly the convention opentype.js's own
 * `Parser.parsePointer` uses, mirrored here so byte-level arithmetic stays
 * one-to-one with the spec.
 */

/**
 * Byte location of the GPOS table inside a font's sfnt container, plus the
 * length declared by its TableRecord. The fixup uses `offset` as the base
 * for all GPOS-relative reads; `length` is the upper bound a well-formed
 * read must stay below.
 */
export type GposTableLocation = {
  readonly offset: number;
  readonly length: number;
};

/**
 * Locate the GPOS table inside the font's sfnt directory. Returns
 * `undefined` when the font carries no GPOS table — static fonts shipped
 * without pair-adjustment data fall through this path unchanged.
 *
 * Throws when the buffer is too short for a valid sfnt header or when the
 * TableRecord array runs past the buffer end. Both indicate a truncated
 * font file — a fail-fast surface is intentional per the renderer's
 * fail-fast policy.
 */
export function locateGposTable(view: DataView): GposTableLocation | undefined {
  if (view.byteLength < 12) {
    throw new Error(
      `locateGposTable: buffer too short for sfnt header (${view.byteLength} bytes)`,
    );
  }
  // sfnt header layout: sfntVersion (uint32), numTables (uint16),
  // searchRange (uint16), entrySelector (uint16), rangeShift (uint16).
  const numTables = view.getUint16(4, false);
  const tableRecordsEnd = 12 + numTables * 16;
  if (view.byteLength < tableRecordsEnd) {
    throw new Error(
      `locateGposTable: TableRecord array (${numTables} records) overruns buffer (${view.byteLength} bytes)`,
    );
  }
  for (let i = 0; i < numTables; i += 1) {
    const recordOffset = 12 + i * 16;
    const tag = readTag(view, recordOffset);
    if (tag === "GPOS") {
      const offset = view.getUint32(recordOffset + 8, false);
      const length = view.getUint32(recordOffset + 12, false);
      if (offset + length > view.byteLength) {
        throw new Error(
          `locateGposTable: GPOS record (offset=${offset}, length=${length}) overruns buffer (${view.byteLength} bytes)`,
        );
      }
      return { offset, length };
    }
  }
  return undefined;
}

/**
 * A single Lookup's location inside the GPOS table — the byte offset of the
 * Lookup table itself (from the font's start) plus the parsed Lookup header
 * fields. Subtable offsets in a Lookup are stored relative to `start`, so
 * downstream code rebuilds absolute offsets as `start + subtableOffset`.
 */
export type LookupLocation = {
  /** Absolute byte offset of this Lookup table inside the font buffer. */
  readonly start: number;
  /** Lookup type as declared in the header (1..9). */
  readonly lookupType: number;
  /** Lookup flag bitfield (we don't interpret it; preserved for clarity). */
  readonly lookupFlag: number;
  /** Absolute byte offsets of this Lookup's subtables. */
  readonly subtableOffsets: readonly number[];
};

/**
 * Walk the GPOS LookupList and return every Lookup's location and subtable
 * offsets. The result preserves Lookup order — index `i` in the output
 * matches `font.tables.gpos.lookups[i]` parsed by opentype.js. Callers can
 * therefore use the parsed object and the raw location side-by-side.
 *
 * Throws on malformed offsets so the fixup never produces silently-wrong
 * kerning data.
 */
export function readLookupLocations(
  view: DataView,
  gpos: GposTableLocation,
): readonly LookupLocation[] {
  const gposStart = gpos.offset;
  // GPOS header: majorVersion (uint16), minorVersion (uint16),
  // scriptListOffset (uint16), featureListOffset (uint16),
  // lookupListOffset (uint16), [optional] featureVariationsOffset (uint32).
  const lookupListRelative = view.getUint16(gposStart + 8, false);
  const lookupListStart = gposStart + lookupListRelative;
  if (lookupListStart + 2 > gposStart + gpos.length) {
    throw new Error(
      `readLookupLocations: LookupList header overruns GPOS table (lookupListStart=${lookupListStart})`,
    );
  }
  const lookupCount = view.getUint16(lookupListStart, false);
  const lookupOffsetsEnd = lookupListStart + 2 + lookupCount * 2;
  if (lookupOffsetsEnd > gposStart + gpos.length) {
    throw new Error(
      `readLookupLocations: LookupList offset array (${lookupCount} entries) overruns GPOS table`,
    );
  }
  const out: LookupLocation[] = [];
  for (let i = 0; i < lookupCount; i += 1) {
    const lookupRel = view.getUint16(lookupListStart + 2 + i * 2, false);
    const lookupStart = lookupListStart + lookupRel;
    if (lookupStart + 6 > gposStart + gpos.length) {
      throw new Error(
        `readLookupLocations: Lookup[${i}] header overruns GPOS table (lookupStart=${lookupStart})`,
      );
    }
    const lookupType = view.getUint16(lookupStart, false);
    const lookupFlag = view.getUint16(lookupStart + 2, false);
    const subTableCount = view.getUint16(lookupStart + 4, false);
    const subOffsetsEnd = lookupStart + 6 + subTableCount * 2;
    if (subOffsetsEnd > gposStart + gpos.length) {
      throw new Error(
        `readLookupLocations: Lookup[${i}] subtable offset array overruns GPOS table`,
      );
    }
    const subtableOffsets: number[] = [];
    for (let s = 0; s < subTableCount; s += 1) {
      const subRel = view.getUint16(lookupStart + 6 + s * 2, false);
      subtableOffsets.push(lookupStart + subRel);
    }
    out.push({
      start: lookupStart,
      lookupType,
      lookupFlag,
      subtableOffsets,
    });
  }
  return out;
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}
