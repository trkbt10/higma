/**
 * @file TrueType Collection extractor tests.
 *
 * Synthesises a TTC by concatenating two opentype.js-built TTFs into
 * the OpenType collection container, then verifies `extractTtcFaces`
 * yields parseable single-face buffers — one per embedded face,
 * preserving the family / subfamily metadata of each.
 */

import { parse as parseFont } from "opentype.js";
import { extractTtcFaces, isTtc } from "./ttc";
import { synthesizeFontBytes } from "./test-helpers";

const TTC_MAGIC = 0x74746366; // 'ttcf'

/** Detach a Uint8Array's bytes into a fresh `ArrayBuffer` so the
 * value is unambiguously `ArrayBuffer` (not `ArrayBufferLike`) for
 * the `extractTtcFaces` / `isTtc` argument type, and so the buffer
 * isn't a slab shared with neighbouring allocations. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

/** Read an English-localized name out of opentype.js' parsed names
 * structure, traversing the platform-specific tables when the
 * top-level entry is missing — same fallback shape the loader uses
 * via `fontNameValue`. */
function readEnglishName(names: unknown, key: string): string | undefined {
  if (typeof names !== "object" || names === null) {
    return undefined;
  }
  const top = (names as Record<string, { en?: string } | undefined>)[key];
  if (top?.en) {
    return top.en;
  }
  const platforms = names as Record<string, Record<string, { en?: string } | undefined> | undefined>;
  return platforms.windows?.[key]?.en
    ?? platforms.macintosh?.[key]?.en
    ?? platforms.unicode?.[key]?.en;
}

/**
 * Build a minimal but spec-conformant TTC from a list of single-face
 * TTF/OTF buffers. Layout:
 *
 *   header (12 bytes)        — 'ttcf', version 1.0, numFonts
 *   offsets[numFonts]        — 4 bytes each, byte offset of each face
 *   face data                — appended back-to-back; each face's
 *                              embedded table records have their
 *                              `offset` fields rewritten to point
 *                              into the TTC's coordinate space (the
 *                              OpenType TTC layout requires absolute
 *                              offsets within the collection buffer).
 *
 * The resulting buffer is what the macOS system fonts look like on
 * disk (Helvetica.ttc et al.), modulo Apple's extra `dsig` table.
 */
function buildTtc(faces: readonly Uint8Array[]): Uint8Array {
  const headerLength = 12 + 4 * faces.length;
  const layout = faces.reduce<{ readonly offsets: readonly number[]; readonly cursor: number }>(
    (acc, face) => ({
      offsets: [...acc.offsets, acc.cursor],
      cursor: acc.cursor + face.length,
    }),
    { offsets: [], cursor: headerLength },
  );
  const offsets = layout.offsets;
  const totalLength = layout.cursor;
  const out = new Uint8Array(totalLength);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  outView.setUint32(0, TTC_MAGIC);
  outView.setUint16(4, 1);
  outView.setUint16(6, 0);
  outView.setUint32(8, faces.length);
  for (let i = 0; i < faces.length; i += 1) {
    outView.setUint32(12 + i * 4, offsets[i]);
  }
  for (let i = 0; i < faces.length; i += 1) {
    const face = faces[i];
    const faceOffset = offsets[i];
    out.set(face, faceOffset);
    relocateTableRecords(outView, face, faceOffset);
  }
  return out;
}

/**
 * Rewrite the table records of a face copied into a TTC so each
 * record's `offset` field points into the collection buffer rather
 * than into the original single-face TTF. The data bytes themselves
 * stay where the bulk copy placed them; only the directory needs
 * adjustment.
 */
function relocateTableRecords(outView: DataView, face: Uint8Array, faceOffset: number): void {
  const numTables = (face[4] << 8) | face[5];
  for (let t = 0; t < numTables; t += 1) {
    const recordPos = faceOffset + 12 + t * 16;
    const originalOffset = outView.getUint32(recordPos + 8);
    outView.setUint32(recordPos + 8, faceOffset + originalOffset);
  }
}

describe("isTtc", () => {
  it("detects the 'ttcf' magic in the first four bytes", () => {
    const ttc = buildTtc([
      synthesizeFontBytes({ familyName: "A", styleName: "Regular" }),
    ]);
    expect(isTtc(toArrayBuffer(ttc))).toBe(true);
  });

  it("returns false for a plain TTF", () => {
    const ttf = synthesizeFontBytes({ familyName: "A", styleName: "Regular" });
    expect(isTtc(toArrayBuffer(ttf))).toBe(false);
  });

  it("returns false for a buffer too short to contain the magic", () => {
    expect(isTtc(new ArrayBuffer(3))).toBe(false);
  });
});

describe("extractTtcFaces", () => {
  it("decomposes a multi-face TTC into individually-parseable buffers", () => {
    const helveticaRegular = synthesizeFontBytes({
      familyName: "Helvetica",
      styleName: "Regular",
    });
    const helveticaBold = synthesizeFontBytes({
      familyName: "Helvetica",
      styleName: "Bold",
    });
    const ttc = buildTtc([helveticaRegular, helveticaBold]);

    const faces = extractTtcFaces(toArrayBuffer(ttc));

    expect(faces).toHaveLength(2);
    const parsedA = parseFont(faces[0]);
    const parsedB = parseFont(faces[1]);
    // Subfamily round-trips through the name table, so the two faces
    // must surface as distinct styles when the loader inspects them.
    const subA = readEnglishName(parsedA.names, "fontSubfamily");
    const subB = readEnglishName(parsedB.names, "fontSubfamily");
    expect(new Set([subA, subB])).toEqual(new Set(["Regular", "Bold"]));
  });

  it("throws when handed a non-TTC buffer — the caller is misusing the API", () => {
    const ttf = synthesizeFontBytes({ familyName: "A", styleName: "Regular" });
    expect(() => extractTtcFaces(toArrayBuffer(ttf))).toThrow(/not a TrueType Collection/);
  });
});
