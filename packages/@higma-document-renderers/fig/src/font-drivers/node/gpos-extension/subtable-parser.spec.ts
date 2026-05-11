/**
 * @file Unit tests for the GPOS subtable parsers.
 *
 * Each test crafts the smallest valid byte sequence the spec requires
 * and verifies the parsed output matches opentype.js's own parsed shape
 * so `Position.getKerningValue` and `Layout.getCoverageIndex` consume it
 * unchanged.
 *
 * Bytes are written big-endian (the OpenType convention). Multi-byte
 * fields are split for readability — e.g. `[0x00, 0x01]` is the uint16
 * value 1.
 */

import {
  parseCoverageTable,
  parseClassDefTable,
  parseValueRecord,
  parsePairAdjustmentSubtable,
  valueRecordByteSize,
} from "./subtable-parser";

/** Convenience: build a DataView over the given byte sequence. */
function viewOf(bytes: readonly number[]): DataView {
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return new DataView(buf);
}

/** uint16 in big-endian byte order. */
function u16(value: number): readonly number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

/** int16 in big-endian byte order. */
function i16(value: number): readonly number[] {
  // The OpenType spec uses two's-complement int16. `(value & 0xffff)`
  // squashes negative numbers into the right bit pattern before split.
  const unsigned = value & 0xffff;
  return [(unsigned >>> 8) & 0xff, unsigned & 0xff];
}

describe("parseCoverageTable", () => {
  it("reads a format 1 coverage with explicit glyph list", () => {
    const bytes = [
      ...u16(1), // coverage format 1
      ...u16(3), // glyphCount
      ...u16(10),
      ...u16(20),
      ...u16(30),
    ];
    const result = parseCoverageTable(viewOf(bytes), 0);
    expect(result).toEqual({ format: 1, glyphs: [10, 20, 30] });
  });

  it("reads a format 2 coverage with ranges", () => {
    const bytes = [
      ...u16(2), // coverage format 2
      ...u16(2), // rangeCount
      ...u16(10),
      ...u16(15),
      ...u16(0), // index: glyph 10 is the 0th covered
      ...u16(20),
      ...u16(25),
      ...u16(6), // index: glyph 20 is the 6th covered (10..15 covers 6 glyphs)
    ];
    const result = parseCoverageTable(viewOf(bytes), 0);
    expect(result).toEqual({
      format: 2,
      ranges: [
        { start: 10, end: 15, index: 0 },
        { start: 20, end: 25, index: 6 },
      ],
    });
  });

  it("throws on an unknown coverage format", () => {
    const bytes = [...u16(7), ...u16(0)];
    expect(() => parseCoverageTable(viewOf(bytes), 0)).toThrow(/unexpected coverage format/);
  });
});

describe("parseClassDefTable", () => {
  it("reads a format 1 class definition", () => {
    const bytes = [
      ...u16(1), // ClassDef format 1
      ...u16(5), // startGlyph
      ...u16(3), // glyphCount
      ...u16(0),
      ...u16(1),
      ...u16(2),
    ];
    const result = parseClassDefTable(viewOf(bytes), 0);
    expect(result).toEqual({ format: 1, startGlyph: 5, classes: [0, 1, 2] });
  });

  it("reads a format 2 class definition with ranges", () => {
    const bytes = [
      ...u16(2), // ClassDef format 2
      ...u16(2), // classRangeCount
      ...u16(10),
      ...u16(20),
      ...u16(1),
      ...u16(30),
      ...u16(40),
      ...u16(2),
    ];
    const result = parseClassDefTable(viewOf(bytes), 0);
    expect(result).toEqual({
      format: 2,
      ranges: [
        { start: 10, end: 20, classId: 1 },
        { start: 30, end: 40, classId: 2 },
      ],
    });
  });
});

describe("valueRecordByteSize", () => {
  it("returns 0 for an empty value format", () => {
    expect(valueRecordByteSize(0)).toBe(0);
  });

  it("counts each set bit as 2 bytes", () => {
    // xAdvance only → 2 bytes
    expect(valueRecordByteSize(4)).toBe(2);
    // xPlacement + yPlacement + xAdvance + yAdvance → 8 bytes
    expect(valueRecordByteSize(15)).toBe(8);
    // All 8 bits set → 16 bytes
    expect(valueRecordByteSize(0xff)).toBe(16);
  });
});

describe("parseValueRecord", () => {
  it("returns undefined when valueFormat is 0", () => {
    expect(parseValueRecord(viewOf([]), 0, 0)).toBeUndefined();
  });

  it("reads only the fields the format selects", () => {
    // valueFormat = 4 → xAdvance only.
    const result = parseValueRecord(viewOf([...i16(-160)]), 0, 4);
    expect(result).toEqual({
      xPlacement: undefined,
      yPlacement: undefined,
      xAdvance: -160,
      yAdvance: undefined,
    });
  });

  it("preserves signed values across all four placement fields", () => {
    // valueFormat = 15 → all four placement fields, in spec order:
    // xPlacement, yPlacement, xAdvance, yAdvance.
    const bytes = [...i16(-10), ...i16(20), ...i16(-300), ...i16(7)];
    const result = parseValueRecord(viewOf(bytes), 0, 15);
    expect(result).toEqual({
      xPlacement: -10,
      yPlacement: 20,
      xAdvance: -300,
      yAdvance: 7,
    });
  });

  it("skips device-table offsets without reading them as values", () => {
    // valueFormat = 4 | 64 = 68 → xAdvance (2 bytes) + xAdvDevice
    // offset (2 bytes, discarded). Without the skip we'd misread
    // the device offset as a numeric advance contribution.
    const bytes = [...i16(-200), ...u16(0xabcd)];
    const result = parseValueRecord(viewOf(bytes), 0, 68);
    expect(result?.xAdvance).toBe(-200);
  });
});

describe("parsePairAdjustmentSubtable", () => {
  it("parses a Format 1 Pair Adjustment with one pair set", () => {
    // Subtable layout — every offset is relative to the subtable start
    // (here always 0 because we point the parser at byte 0):
    //   bytes  0..11  PairPos header (12 bytes)
    //          00..01    posFormat = 1
    //          02..03    coverageOffset = 12
    //          04..05    valueFormat1 = 4 (xAdvance only)
    //          06..07    valueFormat2 = 0
    //          08..09    pairSetCount = 1
    //          10..11    pairSetOffset[0] = 18
    //   bytes 12..17  Coverage table (format 1, 1 glyph)
    //         12..13    format = 1
    //         14..15    glyphCount = 1
    //         16..17    glyph = 100
    //   bytes 18..23  PairSet table (1 pair, valueFormat1 stride = 2)
    //         18..19    pairValueCount = 1
    //         20..21    secondGlyph = 200
    //         22..23    value1.xAdvance = -160
    const bytes = [
      ...u16(1),
      ...u16(12),
      ...u16(4),
      ...u16(0),
      ...u16(1),
      ...u16(18),
      ...u16(1),
      ...u16(1),
      ...u16(100),
      ...u16(1),
      ...u16(200),
      ...i16(-160),
    ];
    const sub = parsePairAdjustmentSubtable(viewOf(bytes), 0);
    expect(sub.posFormat).toBe(1);
    if (sub.posFormat !== 1) {
      throw new Error("posFormat narrowed wrong");
    }
    expect(sub.valueFormat1).toBe(4);
    expect(sub.valueFormat2).toBe(0);
    expect(sub.coverage).toEqual({ format: 1, glyphs: [100] });
    expect(sub.pairSets.length).toBe(1);
    expect(sub.pairSets[0]).toEqual([
      {
        secondGlyph: 200,
        value1: {
          xPlacement: undefined,
          yPlacement: undefined,
          xAdvance: -160,
          yAdvance: undefined,
        },
        value2: undefined,
      },
    ]);
  });

  it("parses a Format 2 Pair Adjustment with a 2x2 class matrix", () => {
    // Layout — subtable at offset 0:
    //   00 00..01    posFormat = 2
    //   02 00..03    coverageOffset = 16
    //   04 00..05    valueFormat1 = 4 (xAdvance)
    //   06 00..07    valueFormat2 = 0
    //   08 00..09    classDef1Offset = 22
    //   10 00..11    classDef2Offset = 32
    //   12 00..13    class1Count = 2
    //   14 00..15    class2Count = 2
    //   ---- 16: classRecords (2x2 cells, each value1 = i16, value2 = nothing) ----
    //   class1=0,class2=0 → xAdvance = -100
    //   class1=0,class2=1 → xAdvance = 0
    //   class1=1,class2=0 → xAdvance = 50
    //   class1=1,class2=1 → xAdvance = -75
    //   ---- 22: coverage format 1, 2 glyphs (100, 200) ----
    //   ---- 32: classDef1 format 2, 2 ranges ----
    //   ---- 44: classDef2 format 2, 1 range ----
    // We'll position the inner tables manually.
    // Cells start at 16 — 2x2 = 4 cells, each 2 bytes = 8 bytes, ending at 24.
    // But the coverage at 16 overlaps — re-layout. Make headers end at offset
    // 16, then put cells at 16..23, coverage at 24, classDef1 at 32, classDef2 at 44.
    const bytes = [
      // header (16 bytes)
      ...u16(2),
      ...u16(24), // coverageOffset
      ...u16(4),
      ...u16(0),
      ...u16(32), // classDef1Offset
      ...u16(44), // classDef2Offset
      ...u16(2),
      ...u16(2),
      // class records start at +16, 8 bytes
      ...i16(-100),
      ...i16(0),
      ...i16(50),
      ...i16(-75),
      // coverage at +24, 8 bytes (format 1, count 2, glyphs 100, 200)
      ...u16(1),
      ...u16(2),
      ...u16(100),
      ...u16(200),
      // classDef1 at +32, 12 bytes (format 2, count 1, range 100..100 → class 0,
      // range 200..200 → class 1) — but ranges are 6 bytes each, so count 2 = 16 bytes
      ...u16(2),
      ...u16(2),
      ...u16(100),
      ...u16(100),
      ...u16(0),
      ...u16(200),
      ...u16(200),
      ...u16(1),
    ];
    // classDef2 starts at +44 ... but we wrote bytes through 32 + 4 + 12 = 48.
    // Re-fix: classDef2Offset = 48.
    // Easier: rebuild with classDef2Offset = 48, then append classDef2 (12 bytes).
    const fixedBytes = [
      // header (16 bytes)
      ...u16(2),
      ...u16(24),
      ...u16(4),
      ...u16(0),
      ...u16(32),
      ...u16(48), // classDef2Offset corrected
      ...u16(2),
      ...u16(2),
      // class records at +16, 8 bytes
      ...i16(-100),
      ...i16(0),
      ...i16(50),
      ...i16(-75),
      // coverage at +24, 8 bytes
      ...u16(1),
      ...u16(2),
      ...u16(100),
      ...u16(200),
      // classDef1 at +32, 16 bytes (format 2, count 2, two ranges)
      ...u16(2),
      ...u16(2),
      ...u16(100),
      ...u16(100),
      ...u16(0),
      ...u16(200),
      ...u16(200),
      ...u16(1),
      // classDef2 at +48, 16 bytes (format 2, count 2, two ranges)
      ...u16(2),
      ...u16(2),
      ...u16(100),
      ...u16(100),
      ...u16(0),
      ...u16(200),
      ...u16(200),
      ...u16(1),
    ];
    // Drop the unused first attempt that was discarded.
    void bytes;
    const sub = parsePairAdjustmentSubtable(viewOf(fixedBytes), 0);
    expect(sub.posFormat).toBe(2);
    if (sub.posFormat !== 2) {
      throw new Error("posFormat narrowed wrong");
    }
    expect(sub.class1Count).toBe(2);
    expect(sub.class2Count).toBe(2);
    expect(sub.classRecords[0]?.[0]?.value1?.xAdvance).toBe(-100);
    expect(sub.classRecords[0]?.[1]?.value1?.xAdvance).toBe(0);
    expect(sub.classRecords[1]?.[0]?.value1?.xAdvance).toBe(50);
    expect(sub.classRecords[1]?.[1]?.value1?.xAdvance).toBe(-75);
    expect(sub.coverage).toEqual({ format: 1, glyphs: [100, 200] });
  });

  it("throws on an unknown pair adjustment posFormat", () => {
    const bytes = [...u16(7)];
    expect(() => parsePairAdjustmentSubtable(viewOf(bytes), 0)).toThrow(/unexpected posFormat/);
  });
});
