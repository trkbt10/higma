/**
 * @file Raw GPOS subtable parsers that mirror opentype.js's parsed shape.
 *
 * The output of every function here matches the structure opentype.js
 * produces when it parses a non-Extension Pair Adjustment subtable
 * directly, so `Position.prototype.getKerningValue` consumes either side
 * interchangeably. See `node_modules/opentype.js/dist/opentype.mjs`:
 *   - `subtableParsers2[2]`        — Pair Adjustment subtable shape
 *   - `Parser.parseCoverage`       — Coverage table shape
 *   - `Parser.parseClassDef`       — ClassDef table shape
 *   - `Parser.parseValueRecord`    — ValueRecord shape
 *
 * Only the subset the Pair Adjustment subtable needs is implemented; other
 * GPOS lookup types are reachable via Extension wrapping in principle but
 * fall outside the kerning scope and the fixup rejects them by throw.
 *
 * The OpenType spec encodes offsets in two ways inside a subtable tree:
 *   - `Offset16` (2 bytes), relative to the immediate enclosing parent.
 *   - `Offset32` (4 bytes), used by the Extension subtable for its inner
 *     payload pointer so an Extension-wrapped subtable can sit anywhere
 *     in the font (the very reason `LookupType 9` exists).
 * Every routine here takes absolute byte offsets — the caller is expected
 * to resolve the relative pointer at the call site so this module never
 * needs to know about its position in the lookup tree.
 */

/**
 * Glyph-ID-keyed coverage table — matches opentype.js's parseCoverage
 * output exactly so `Layout.getCoverageIndex` consumes it without
 * adaptation.
 */
export type Coverage =
  | { readonly format: 1; readonly glyphs: readonly number[] }
  | {
      readonly format: 2;
      readonly ranges: readonly {
        readonly start: number;
        readonly end: number;
        readonly index: number;
      }[];
    };

/**
 * Glyph-ID-keyed class definition — matches opentype.js's parseClassDef
 * output exactly so `Layout.getGlyphClass` consumes it without adaptation.
 */
export type ClassDef =
  | {
      readonly format: 1;
      readonly startGlyph: number;
      readonly classes: readonly number[];
    }
  | {
      readonly format: 2;
      readonly ranges: readonly {
        readonly start: number;
        readonly end: number;
        readonly classId: number;
      }[];
    };

/**
 * Selectively-populated GPOS ValueRecord. Each present field corresponds
 * to a bit in the parent table's valueFormat. `xAdvance` (bit 2 / value 4)
 * is the only field `Position.getKerningValue` reads, but the full record
 * is preserved so any future GPOS consumer in opentype.js's surface area
 * receives the same shape it would from a non-Extension subtable.
 */
export type ValueRecord = {
  readonly xPlacement?: number;
  readonly yPlacement?: number;
  readonly xAdvance?: number;
  readonly yAdvance?: number;
};

/**
 * Pair Adjustment Format 1 — coverage-indexed list of pair sets. Each
 * pair set is a list of (secondGlyph, value1, value2) records that apply
 * after the first glyph (the one matched by coverage).
 */
export type PairAdjustmentFormat1 = {
  readonly posFormat: 1;
  readonly coverage: Coverage;
  readonly valueFormat1: number;
  readonly valueFormat2: number;
  readonly pairSets: readonly (readonly {
    readonly secondGlyph: number;
    readonly value1: ValueRecord | undefined;
    readonly value2: ValueRecord | undefined;
  }[])[];
};

/**
 * Pair Adjustment Format 2 — class-indexed matrix. Both glyphs are
 * mapped to classes via `classDef1` / `classDef2` and the resulting
 * `(class1, class2)` cell holds the adjustment.
 */
export type PairAdjustmentFormat2 = {
  readonly posFormat: 2;
  readonly coverage: Coverage;
  readonly valueFormat1: number;
  readonly valueFormat2: number;
  readonly classDef1: ClassDef;
  readonly classDef2: ClassDef;
  readonly class1Count: number;
  readonly class2Count: number;
  readonly classRecords: readonly (readonly {
    readonly value1: ValueRecord | undefined;
    readonly value2: ValueRecord | undefined;
  }[])[];
};

export type PairAdjustmentSubtable = PairAdjustmentFormat1 | PairAdjustmentFormat2;

/**
 * Parse a Pair Adjustment (GPOS LookupType 2) subtable whose first byte
 * is at `subtableStart`. Throws on any unexpected `posFormat` or
 * over-length read — the fixup is strict by design and the renderer's
 * fail-fast policy forbids silently producing zero kerning.
 */
export function parsePairAdjustmentSubtable(
  view: DataView,
  subtableStart: number,
): PairAdjustmentSubtable {
  const posFormat = view.getUint16(subtableStart, false);
  if (posFormat === 1) {
    return parsePairAdjustmentFormat1(view, subtableStart);
  }
  if (posFormat === 2) {
    return parsePairAdjustmentFormat2(view, subtableStart);
  }
  throw new Error(
    `parsePairAdjustmentSubtable: unexpected posFormat ${posFormat} at offset 0x${subtableStart.toString(16)}`,
  );
}

function parsePairAdjustmentFormat1(view: DataView, start: number): PairAdjustmentFormat1 {
  // Layout:
  //   uint16  posFormat (= 1)               [start + 0]
  //   Offset16 coverageOffset               [start + 2]   // from `start`
  //   uint16  valueFormat1                  [start + 4]
  //   uint16  valueFormat2                  [start + 6]
  //   uint16  pairSetCount                  [start + 8]
  //   Offset16 pairSetOffsets[pairSetCount] [start + 10]  // each from `start`
  const coverageOffsetRel = view.getUint16(start + 2, false);
  const valueFormat1 = view.getUint16(start + 4, false);
  const valueFormat2 = view.getUint16(start + 6, false);
  const pairSetCount = view.getUint16(start + 8, false);
  const coverage = parseCoverageTable(view, start + coverageOffsetRel);
  const pairSets: readonly {
    secondGlyph: number;
    value1: ValueRecord | undefined;
    value2: ValueRecord | undefined;
  }[][] = readPairSets(view, start, pairSetCount, valueFormat1, valueFormat2);
  return {
    posFormat: 1,
    coverage,
    valueFormat1,
    valueFormat2,
    pairSets,
  };
}

function readPairSets(
  view: DataView,
  subtableStart: number,
  pairSetCount: number,
  valueFormat1: number,
  valueFormat2: number,
): readonly {
  secondGlyph: number;
  value1: ValueRecord | undefined;
  value2: ValueRecord | undefined;
}[][] {
  const result: {
    secondGlyph: number;
    value1: ValueRecord | undefined;
    value2: ValueRecord | undefined;
  }[][] = [];
  for (let i = 0; i < pairSetCount; i += 1) {
    const pairSetOffsetRel = view.getUint16(subtableStart + 10 + i * 2, false);
    const pairSetStart = subtableStart + pairSetOffsetRel;
    const pairValueCount = view.getUint16(pairSetStart, false);
    // Each PairValueRecord is 2 bytes (secondGlyph) + sizeof(value1) + sizeof(value2).
    const value1Size = valueRecordByteSize(valueFormat1);
    const value2Size = valueRecordByteSize(valueFormat2);
    const recordSize = 2 + value1Size + value2Size;
    const records: {
      secondGlyph: number;
      value1: ValueRecord | undefined;
      value2: ValueRecord | undefined;
    }[] = [];
    for (let r = 0; r < pairValueCount; r += 1) {
      const recordStart = pairSetStart + 2 + r * recordSize;
      const secondGlyph = view.getUint16(recordStart, false);
      const value1 = parseValueRecord(view, recordStart + 2, valueFormat1);
      const value2 = parseValueRecord(view, recordStart + 2 + value1Size, valueFormat2);
      records.push({ secondGlyph, value1, value2 });
    }
    result.push(records);
  }
  return result;
}

function parsePairAdjustmentFormat2(view: DataView, start: number): PairAdjustmentFormat2 {
  // Layout:
  //   uint16  posFormat (= 2)               [start + 0]
  //   Offset16 coverageOffset               [start + 2]   // from `start`
  //   uint16  valueFormat1                  [start + 4]
  //   uint16  valueFormat2                  [start + 6]
  //   Offset16 classDef1Offset              [start + 8]   // from `start`
  //   Offset16 classDef2Offset              [start + 10]  // from `start`
  //   uint16  class1Count                   [start + 12]
  //   uint16  class2Count                   [start + 14]
  //   Class1Record class1Records[class1Count]:
  //     Class2Record class2Records[class2Count]:
  //       ValueRecord value1                // valueFormat1 wide
  //       ValueRecord value2                // valueFormat2 wide
  const coverageOffsetRel = view.getUint16(start + 2, false);
  const valueFormat1 = view.getUint16(start + 4, false);
  const valueFormat2 = view.getUint16(start + 6, false);
  const classDef1OffsetRel = view.getUint16(start + 8, false);
  const classDef2OffsetRel = view.getUint16(start + 10, false);
  const class1Count = view.getUint16(start + 12, false);
  const class2Count = view.getUint16(start + 14, false);
  const coverage = parseCoverageTable(view, start + coverageOffsetRel);
  const classDef1 = parseClassDefTable(view, start + classDef1OffsetRel);
  const classDef2 = parseClassDefTable(view, start + classDef2OffsetRel);
  const value1Size = valueRecordByteSize(valueFormat1);
  const value2Size = valueRecordByteSize(valueFormat2);
  const class2Size = value1Size + value2Size;
  const class1Size = class2Count * class2Size;
  const recordsStart = start + 16;
  const classRecords: { value1: ValueRecord | undefined; value2: ValueRecord | undefined }[][] = [];
  for (let i = 0; i < class1Count; i += 1) {
    const row: { value1: ValueRecord | undefined; value2: ValueRecord | undefined }[] = [];
    const rowStart = recordsStart + i * class1Size;
    for (let j = 0; j < class2Count; j += 1) {
      const cellStart = rowStart + j * class2Size;
      const value1 = parseValueRecord(view, cellStart, valueFormat1);
      const value2 = parseValueRecord(view, cellStart + value1Size, valueFormat2);
      row.push({ value1, value2 });
    }
    classRecords.push(row);
  }
  return {
    posFormat: 2,
    coverage,
    valueFormat1,
    valueFormat2,
    classDef1,
    classDef2,
    class1Count,
    class2Count,
    classRecords,
  };
}

/**
 * Read a `Coverage` table at `start`. Mirrors opentype.js's
 * `Parser.parseCoverage` 1:1 so the result drops directly into a parsed
 * lookup's `subtable.coverage` slot.
 */
export function parseCoverageTable(view: DataView, start: number): Coverage {
  const format = view.getUint16(start, false);
  const count = view.getUint16(start + 2, false);
  if (format === 1) {
    const glyphs: number[] = [];
    for (let i = 0; i < count; i += 1) {
      glyphs.push(view.getUint16(start + 4 + i * 2, false));
    }
    return { format: 1, glyphs };
  }
  if (format === 2) {
    const ranges: { start: number; end: number; index: number }[] = [];
    for (let i = 0; i < count; i += 1) {
      const rangeStart = start + 4 + i * 6;
      ranges.push({
        start: view.getUint16(rangeStart, false),
        end: view.getUint16(rangeStart + 2, false),
        index: view.getUint16(rangeStart + 4, false),
      });
    }
    return { format: 2, ranges };
  }
  throw new Error(`parseCoverageTable: unexpected coverage format ${format} at 0x${start.toString(16)}`);
}

/**
 * Read a `ClassDef` table at `start`. Mirrors opentype.js's
 * `Parser.parseClassDef` 1:1.
 */
export function parseClassDefTable(view: DataView, start: number): ClassDef {
  const format = view.getUint16(start, false);
  if (format === 1) {
    const startGlyph = view.getUint16(start + 2, false);
    const glyphCount = view.getUint16(start + 4, false);
    const classes: number[] = [];
    for (let i = 0; i < glyphCount; i += 1) {
      classes.push(view.getUint16(start + 6 + i * 2, false));
    }
    return { format: 1, startGlyph, classes };
  }
  if (format === 2) {
    const rangeCount = view.getUint16(start + 2, false);
    const ranges: { start: number; end: number; classId: number }[] = [];
    for (let i = 0; i < rangeCount; i += 1) {
      const rangeStart = start + 4 + i * 6;
      ranges.push({
        start: view.getUint16(rangeStart, false),
        end: view.getUint16(rangeStart + 2, false),
        classId: view.getUint16(rangeStart + 4, false),
      });
    }
    return { format: 2, ranges };
  }
  throw new Error(
    `parseClassDefTable: unexpected ClassDef format ${format} at 0x${start.toString(16)}`,
  );
}

/**
 * Byte-width of a `ValueRecord` for the given `valueFormat` bitfield.
 * Each set bit contributes 2 bytes. Mirrors the OpenType spec exactly so
 * cell-strides in Format 2 line up byte-for-byte with the on-disk layout.
 */
export function valueRecordByteSize(valueFormat: number): number {
  // Each of the eight bits (xPlacement, yPlacement, xAdvance, yAdvance,
  // xPlaDevice, yPlaDevice, xAdvDevice, yAdvDevice) adds a single uint16
  // when present. Higher bits are reserved and must be 0 — we don't try
  // to be defensive about them; a non-zero higher bit is a font bug.
  return popcountLow8(valueFormat) * 2;
}

function popcountLow8(n: number): number {
  // Inline 8-bit popcount keeps the dependency surface zero. Higher
  // bits in `valueFormat` are reserved and ignored by every shaper.
  const masked = n & 0xff;
  return (
    (masked & 1) +
    ((masked >>> 1) & 1) +
    ((masked >>> 2) & 1) +
    ((masked >>> 3) & 1) +
    ((masked >>> 4) & 1) +
    ((masked >>> 5) & 1) +
    ((masked >>> 6) & 1) +
    ((masked >>> 7) & 1)
  );
}

/**
 * Parse a `ValueRecord` of width `valueRecordByteSize(valueFormat)`
 * starting at `start`. Returns `undefined` for `valueFormat === 0` to
 * match opentype.js's convention — `Position.getKerningValue` already
 * handles `value1 == undefined` via short-circuit.
 *
 * Device-table offset fields (bits 4-7) are skipped exactly as opentype.js
 * itself does: read and discard the two-byte offset, but don't follow it.
 * Device tables are PPEM-keyed micro-adjustments and have never affected
 * the renderer's font-unit pair-adjustment output; reproducing
 * opentype.js's behaviour keeps the parsed shape interchangeable.
 */
export function parseValueRecord(
  view: DataView,
  start: number,
  valueFormat: number,
): ValueRecord | undefined {
  if (valueFormat === 0) {
    return undefined;
  }
  return readValueRecordFields(view, start, valueFormat);
}

function readValueRecordFields(view: DataView, start: number, valueFormat: number): ValueRecord {
  // Walk the eight ValueRecord bits in spec order, each contributing 2
  // bytes when set. Computing per-field absolute offsets up front avoids
  // a mutable cursor — the no-`let` lint rule rules that out anyway —
  // and lets each field read from the right byte regardless of whether
  // earlier fields were present.
  const hasXPlacement = (valueFormat & 1) !== 0;
  const hasYPlacement = (valueFormat & 2) !== 0;
  const hasXAdvance = (valueFormat & 4) !== 0;
  const hasYAdvance = (valueFormat & 8) !== 0;
  const xPlacementOffset = start;
  const yPlacementOffset = xPlacementOffset + (hasXPlacement ? 2 : 0);
  const xAdvanceOffset = yPlacementOffset + (hasYPlacement ? 2 : 0);
  const yAdvanceOffset = xAdvanceOffset + (hasXAdvance ? 2 : 0);
  return {
    xPlacement: hasXPlacement ? view.getInt16(xPlacementOffset, false) : undefined,
    yPlacement: hasYPlacement ? view.getInt16(yPlacementOffset, false) : undefined,
    xAdvance: hasXAdvance ? view.getInt16(xAdvanceOffset, false) : undefined,
    yAdvance: hasYAdvance ? view.getInt16(yAdvanceOffset, false) : undefined,
  };
}
