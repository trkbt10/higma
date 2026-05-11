/**
 * @file Unit tests for the sfnt-directory + GPOS-table byte readers.
 *
 * Synthesises minimum-viable sfnt directories and GPOS LookupList byte
 * sequences and walks them with `locateGposTable` / `readLookupLocations`.
 * Every offset overrun and tag-not-found case is exercised so the fail-fast
 * surface stays observable.
 */

import { locateGposTable, readLookupLocations } from "./raw-reader";

function u16(value: number): readonly number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u32(value: number): readonly number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function tag(t: string): readonly number[] {
  return [t.charCodeAt(0), t.charCodeAt(1), t.charCodeAt(2), t.charCodeAt(3)];
}

function viewOf(bytes: readonly number[]): DataView {
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return new DataView(buf);
}

describe("locateGposTable", () => {
  it("returns the GPOS offset and length from a multi-table sfnt directory", () => {
    // 12-byte sfnt header + 3 × 16-byte TableRecord = 60 bytes of header.
    // Place GPOS at offset 60, length 32.
    const bytes = [
      ...u32(0x00010000),
      ...u16(3), // numTables
      ...u16(0), // searchRange (unused by reader)
      ...u16(0),
      ...u16(0),
      // Record 0: head
      ...tag("head"),
      ...u32(0),
      ...u32(60),
      ...u32(8),
      // Record 1: GPOS
      ...tag("GPOS"),
      ...u32(0),
      ...u32(68),
      ...u32(32),
      // Record 2: name
      ...tag("name"),
      ...u32(0),
      ...u32(100),
      ...u32(4),
    ];
    // Pad to cover GPOS offset+length = 68 + 32 = 100.
    const padded = [...bytes, ...new Array(100).fill(0)];
    const view = viewOf(padded);
    expect(locateGposTable(view)).toEqual({ offset: 68, length: 32 });
  });

  it("returns undefined when no GPOS record is present", () => {
    const bytes = [
      ...u32(0x00010000),
      ...u16(1),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...tag("head"),
      ...u32(0),
      ...u32(28),
      ...u32(8),
      ...new Array(8).fill(0),
    ];
    expect(locateGposTable(viewOf(bytes))).toBeUndefined();
  });

  it("throws when the buffer is too small for an sfnt header", () => {
    const view = viewOf([0, 0, 0]);
    expect(() => locateGposTable(view)).toThrow(/buffer too short/);
  });

  it("throws when the GPOS record overruns the buffer", () => {
    // numTables claims 1, GPOS offset=0 length=10_000 — past the buffer end.
    const bytes = [
      ...u32(0x00010000),
      ...u16(1),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...tag("GPOS"),
      ...u32(0),
      ...u32(0),
      ...u32(10_000),
    ];
    expect(() => locateGposTable(viewOf(bytes))).toThrow(/overruns buffer/);
  });
});

describe("readLookupLocations", () => {
  it("walks the LookupList and exposes each lookup's subtable offsets", () => {
    // GPOS header (10 bytes): lookupListOffset uint16 at +8.
    // Place LookupList at offset 10 inside GPOS:
    //   lookupCount uint16 = 2
    //   lookupOffsets[0] uint16 = 6 (= 2 (count) + 2*2 (offset array))
    //   lookupOffsets[1] uint16 = 18 (= 6 + lookup0 size)
    //
    // Lookup[0] (8 bytes): type=2 flag=0 subCount=1 subOff[0]=8
    //   Lookup[0]'s subtable starts at lookupStart + 8 — outside the
    //   lookup's own bytes which is allowed by spec, but our test just
    //   asserts the absolute offset, not what's at it.
    // Lookup[1] (10 bytes): type=9 flag=0x10 subCount=2 subOff[0]=10
    //   subOff[1]=20 markFilteringSet=1 (because flag&0x10 → present in spec
    //   but our reader doesn't actually require parsing it).
    const gposBody = [
      ...u16(1), ...u16(0), // version
      ...u16(0), // scriptListOffset (unused by reader)
      ...u16(0), // featureListOffset (unused)
      ...u16(10), // lookupListOffset → start of LookupList inside GPOS
      // LookupList at +10
      ...u16(2), // lookupCount
      ...u16(6), // lookupOffsets[0]
      ...u16(18), // lookupOffsets[1]
      // Lookup[0] at LookupList + 6 = GPOS + 16
      ...u16(2),
      ...u16(0),
      ...u16(1),
      ...u16(8),
      ...new Array(4).fill(0), // padding so Lookup[1] sits at +18 of LookupList = +28 of GPOS
      // Lookup[1] at LookupList + 18 = GPOS + 28
      ...u16(9),
      ...u16(0x10),
      ...u16(2),
      ...u16(10),
      ...u16(20),
      ...u16(1),
    ];
    // Wrap into a full sfnt so locateGposTable returns the right offset.
    const gposOffset = 12 + 16;
    const sfnt = [
      ...u32(0x00010000),
      ...u16(1),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...tag("GPOS"),
      ...u32(0),
      ...u32(gposOffset),
      ...u32(gposBody.length),
      ...gposBody,
    ];
    const view = viewOf(sfnt);
    const gpos = locateGposTable(view);
    if (!gpos) {
      throw new Error("expected GPOS");
    }
    const lookups = readLookupLocations(view, gpos);
    expect(lookups).toHaveLength(2);
    expect(lookups[0]?.lookupType).toBe(2);
    expect(lookups[0]?.subtableOffsets).toEqual([gposOffset + 10 + 6 + 8]);
    expect(lookups[1]?.lookupType).toBe(9);
    expect(lookups[1]?.lookupFlag).toBe(0x10);
    expect(lookups[1]?.subtableOffsets).toEqual([
      gposOffset + 10 + 18 + 10,
      gposOffset + 10 + 18 + 20,
    ]);
  });
});
