/**
 * @file Unit tests for `applyGposExtensionFixup`.
 *
 * Building a fully-parseable synthetic font from scratch would require
 * a valid head/hmtx/maxp/cmap/glyf etc. — far more work than the fixup
 * itself. Instead each test:
 *
 *   1. Crafts the raw bytes of a complete sfnt directory + GPOS table
 *      that contains a single LookupType 9 Extension wrapper around a
 *      LookupType 2 Pair Adjustment Format 1 subtable.
 *   2. Builds the *parsed-shape* object opentype.js would produce for
 *      that same font (with placeholder subtables that match opentype.js
 *      1.3.x's `{error: "GPOS Lookup 9 not supported"}`).
 *   3. Invokes the fixup and verifies the parsed lookups are rewritten
 *      to LookupType 2 with the resolved Pair Adjustment shape.
 *
 * This exercises the byte-walking (`raw-reader`), the Extension
 * resolution (`fixup`), and the inner subtable parser
 * (`subtable-parser`) end-to-end without needing the rest of the font
 * machinery.
 */

import { applyGposExtensionFixup } from "./fixup";

/** uint16 in big-endian byte order. */
function u16(value: number): readonly number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

/** int16 in big-endian byte order. */
function i16(value: number): readonly number[] {
  const unsigned = value & 0xffff;
  return [(unsigned >>> 8) & 0xff, unsigned & 0xff];
}

/** uint32 in big-endian byte order. */
function u32(value: number): readonly number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

/** 4-character tag as 4 bytes of ASCII. */
function tag(t: string): readonly number[] {
  return [t.charCodeAt(0), t.charCodeAt(1), t.charCodeAt(2), t.charCodeAt(3)];
}

/**
 * Build a minimal sfnt container with a single GPOS table. The sfnt
 * header + one TableRecord occupies 28 bytes; the GPOS body follows
 * immediately. We don't include other tables — the fixup only walks the
 * sfnt directory to locate GPOS and never touches other tables.
 */
function buildSfntWithGpos(gposBody: readonly number[]): ArrayBuffer {
  const gposOffset = 12 + 16; // 12-byte sfnt header + one 16-byte TableRecord
  const header = [
    ...u32(0x00010000), // sfntVersion = TrueType
    ...u16(1), // numTables
    ...u16(16), // searchRange (1 << log2(numTables) * 16) — not consulted by fixup
    ...u16(0), // entrySelector
    ...u16(0), // rangeShift
  ];
  const tableRecord = [
    ...tag("GPOS"),
    ...u32(0), // checksum — fixup doesn't validate it
    ...u32(gposOffset),
    ...u32(gposBody.length),
  ];
  const all = [...header, ...tableRecord, ...gposBody];
  const buf = new ArrayBuffer(all.length);
  new Uint8Array(buf).set(all);
  return buf;
}

/**
 * Build a GPOS table body containing exactly one lookup:
 *   Lookup[0]: LookupType 9 (Extension Positioning), one subtable that
 *   wraps a LookupType 2 (Pair Adjustment Format 1) inner subtable.
 * The kern feature points at Lookup[0]. The resulting body is a
 * valid GPOS 1.0 table.
 *
 * Pair adjustment:
 *   coverage covers glyph 100; pair (100 → 200) carries xAdvance = -160.
 */
function buildGposBody(): readonly number[] {
  // We assemble bottom-up: build the inner subtable first, then the
  // Extension wrapper, then the LookupList, then the FeatureList and
  // ScriptList, then the GPOS header. Each table's child offsets are
  // computed relative to its own start, so we treat each as a Uint8 ===
  // its bytes plus its size.

  // --- Inner Pair Adjustment subtable (LookupType 2, Format 1) ---
  // Layout: 12-byte PairPos header + 6-byte Coverage (format 1, single
  // glyph) + 6-byte PairSet (one pair, xAdvance only).
  //   bytes  0..11  posFormat=1 coverageOffset=12 valueFormat1=4
  //                 valueFormat2=0 pairSetCount=1 pairSetOffset[0]=18
  //   bytes 12..17  coverage(format=1, glyphCount=1, glyph=100)
  //   bytes 18..23  pairSet(pairValueCount=1, secondGlyph=200, xAdvance=-160)
  const innerSubtable = [
    ...u16(1), // posFormat
    ...u16(12), // coverageOffset
    ...u16(4), // valueFormat1
    ...u16(0), // valueFormat2
    ...u16(1), // pairSetCount
    ...u16(18), // pairSetOffsets[0]
    // coverage at offset 12 (within subtable), 6 bytes
    ...u16(1), // coverage format
    ...u16(1), // glyphCount
    ...u16(100), // glyph
    // pair set at offset 18, 6 bytes
    ...u16(1), // pairValueCount
    ...u16(200), // secondGlyph
    ...i16(-160), // value1.xAdvance
  ];

  // --- Extension Positioning subtable (wraps innerSubtable) ---
  // posFormat=1, extensionLookupType=2, extensionOffset=8 (immediately after
  // the 8-byte Extension header so the inner subtable is reachable).
  const extensionSubtable = [
    ...u16(1), // posFormat
    ...u16(2), // extensionLookupType
    ...u32(8), // extensionOffset (from start of this Extension subtable)
    ...innerSubtable,
  ];

  // --- Lookup table (LookupType 9, one subtable) ---
  // Lookup header is 6 bytes: lookupType + lookupFlag + subTableCount.
  // Then one subtable offset (uint16) = 8 (right after the 8-byte
  // lookupTable header — 6 base + 2 for the single subtable offset).
  const lookupTable = [
    ...u16(9), // lookupType (Extension Positioning)
    ...u16(0), // lookupFlag
    ...u16(1), // subTableCount
    ...u16(8), // subtableOffset (from lookup start)
    ...extensionSubtable,
  ];

  // --- LookupList ---
  // lookupCount (uint16) + one Offset16 to the lookup (relative to
  // LookupList start). The lookup begins at offset 4.
  const lookupList = [
    ...u16(1), // lookupCount
    ...u16(4), // lookupOffset[0]
    ...lookupTable,
  ];

  // --- FeatureList ---
  // featureCount (uint16), then one FeatureRecord (4-byte tag +
  // featureOffset uint16). The feature table follows immediately.
  // FeatureRecord total: 6 bytes. Feature table: featureParams (uint16,
  // null = 0) + lookupIndexCount (uint16) + lookupListIndexes[0] (uint16).
  const featureList = [
    ...u16(1), // featureCount
    ...tag("kern"),
    ...u16(8), // featureOffset (after the 2-byte count + 6-byte record)
    // feature table starts here
    ...u16(0), // featureParams (null)
    ...u16(1), // lookupIndexCount
    ...u16(0), // lookupListIndexes[0] → first (and only) lookup
  ];

  // --- ScriptList ---
  // We need a valid (even if minimal) ScriptList because
  // `Position.init → getKerningTables → getFeatureTable` walks it to
  // pick the default script. We provide a single "DFLT" script with a
  // default language system that references feature index 0.
  //
  // ScriptList:
  //   scriptCount uint16 = 1
  //   ScriptRecord (tag 4 + offset16) — script table follows
  // Script table:
  //   defaultLangSys offset16 → LangSys (4 bytes after start)
  //   langSysCount uint16 = 0
  // LangSys table:
  //   lookupOrderOffset uint16 = 0
  //   requiredFeatureIndex uint16 = 0xFFFF (none required)
  //   featureIndexCount uint16 = 1
  //   featureIndices[0] uint16 = 0
  //
  // Offsets:
  //   ScriptList header: 2 (count) + 6 (record) = 8 bytes before the script
  //   table at +8.
  //   Script table: defaultLangSys offset (from script table start). We
  //   place LangSys right after the 4-byte Script header → offset 4.
  const scriptList = [
    ...u16(1), // scriptCount
    ...tag("DFLT"),
    ...u16(8), // scriptOffset (from ScriptList start)
    // Script table at +8
    ...u16(4), // defaultLangSysOffset (from script table start)
    ...u16(0), // langSysCount
    // LangSys at +12 (script table start +4)
    ...u16(0), // lookupOrderOffset
    ...u16(0xffff), // requiredFeatureIndex (none)
    ...u16(1), // featureIndexCount
    ...u16(0), // featureIndices[0]
  ];

  // --- GPOS header ---
  // version (1.0): majorVersion uint16 + minorVersion uint16 (4 bytes)
  // scriptListOffset uint16
  // featureListOffset uint16
  // lookupListOffset uint16
  // Header is 10 bytes. Tables follow in this order so offsets stack:
  //   header (10)  → scripts (scriptList.length) → features → lookups
  const scriptOffset = 10;
  const featureOffset = 10 + scriptList.length;
  const lookupOffset = featureOffset + featureList.length;
  const gposHeader = [
    ...u16(1), // major version
    ...u16(0), // minor version
    ...u16(scriptOffset),
    ...u16(featureOffset),
    ...u16(lookupOffset),
  ];

  return [...gposHeader, ...scriptList, ...featureList, ...lookupList];
}

/**
 * Build the parsed-shape object opentype.js would produce when it
 * parses the same GPOS table the bytes describe. The Extension lookup's
 * subtable is the `{error: "..."}` placeholder opentype.js 1.3.x writes.
 */
function buildParsedShape(): {
  tables: {
    gpos: {
      version: number;
      features: { tag: string; feature: { lookupListIndexes: number[] } }[];
      lookups: {
        lookupType: number;
        lookupFlag: number;
        subtables: unknown[];
      }[];
    };
  };
  position: {
    init: () => void;
    defaultKerningTables: unknown;
    initCalls: number;
  };
} {
  const position: {
    init(): void;
    defaultKerningTables: unknown;
    initCalls: number;
  } = {
    init(): void {
      position.initCalls += 1;
    },
    defaultKerningTables: undefined,
    initCalls: 0,
  };
  return {
    tables: {
      gpos: {
        version: 1,
        features: [
          {
            tag: "kern",
            feature: { lookupListIndexes: [0] },
          },
        ],
        lookups: [
          {
            lookupType: 9,
            lookupFlag: 0,
            subtables: [{ error: "GPOS Lookup 9 not supported" }],
          },
        ],
      },
    },
    position,
  };
}

describe("applyGposExtensionFixup", () => {
  it("rewrites a LookupType 9 lookup into its resolved Pair Adjustment form", () => {
    const buffer = buildSfntWithGpos(buildGposBody());
    const font = buildParsedShape();
    const applied = applyGposExtensionFixup(font, buffer);
    expect(applied).toBe(true);
    expect(font.tables.gpos.lookups[0]?.lookupType).toBe(2);
    const sub = font.tables.gpos.lookups[0]?.subtables[0] as {
      posFormat?: number;
      coverage?: { format: number; glyphs?: number[] };
      pairSets?: { secondGlyph: number; value1: { xAdvance: number } }[][];
    };
    expect(sub.posFormat).toBe(1);
    expect(sub.coverage?.glyphs).toEqual([100]);
    expect(sub.pairSets?.[0]?.[0]?.secondGlyph).toBe(200);
    expect(sub.pairSets?.[0]?.[0]?.value1.xAdvance).toBe(-160);
  });

  it("refreshes Position.init so cached kerning lookups are rebuilt", () => {
    const buffer = buildSfntWithGpos(buildGposBody());
    const font = buildParsedShape();
    applyGposExtensionFixup(font, buffer);
    expect(font.position.initCalls).toBe(1);
  });

  it("returns false and leaves the font untouched when no kern feature is present", () => {
    const buffer = buildSfntWithGpos(buildGposBody());
    const font = buildParsedShape();
    // Drop the kern feature reference; the byte buffer still claims
    // there is one but the parsed shape's view doesn't — the fixup
    // honours the parsed shape because that's the SoT the resolver
    // walks. (A real parsed font is always consistent with its bytes;
    // this is a deliberately contrived edge case for the early-exit.)
    font.tables.gpos.features = [];
    const before = font.tables.gpos.lookups[0];
    const applied = applyGposExtensionFixup(font, buffer);
    expect(applied).toBe(false);
    expect(font.tables.gpos.lookups[0]).toBe(before);
    expect(font.tables.gpos.lookups[0]?.lookupType).toBe(9);
  });

  it("returns false when the kern feature already points at a non-Extension lookup", () => {
    const buffer = buildSfntWithGpos(buildGposBody());
    const font = buildParsedShape();
    const lookup = font.tables.gpos.lookups[0];
    if (!lookup) {
      throw new Error("expected pre-built lookup");
    }
    // Pretend this is a typical pair adjustment lookup already (Inter,
    // Roboto, …): the fixup must take the early-out path and not
    // attempt to re-parse it from the raw GPOS bytes.
    lookup.lookupType = 2;
    lookup.subtables = [{ posFormat: 1, coverage: {}, valueFormat1: 4, valueFormat2: 0, pairSets: [] }];
    const applied = applyGposExtensionFixup(font, buffer);
    expect(applied).toBe(false);
    expect(font.tables.gpos.lookups[0]?.lookupType).toBe(2);
  });

  it("returns false on a font with no GPOS table", () => {
    const buffer = new ArrayBuffer(0);
    const font = { tables: {} } as { tables: { gpos?: unknown }; position?: unknown };
    const applied = applyGposExtensionFixup(font, buffer);
    expect(applied).toBe(false);
  });
});
