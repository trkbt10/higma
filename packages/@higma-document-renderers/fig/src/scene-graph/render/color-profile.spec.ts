/**
 * @file Regression — `identifySupportedIccProfile` reads the ICC v4
 * `profileDescriptionTag` whose data type is `mluc`.
 *
 * The ICC v4.3 sRGB profile that ships with images authored in Figma
 * (visible in real-world Community files such as the E-commerce
 * template) stores its profile description as `multiLocalizedUnicode`
 * (type signature `mluc`) under tag signature `desc`. The previous
 * implementation iterated tag *signatures* looking for either `desc`
 * or `mluc`, then required the tag's *type* to match the same string —
 * which forced the description to be `desc`/textDescriptionType, the
 * v2 layout. v4 profiles silently failed to resolve and tripped the
 * "ICC profile does not contain a desc or mluc profile description"
 * fail-fast even though they were perfectly well-formed.
 *
 * The fix differentiates the tag *signature* (`desc`, the only
 * signature ICC v2/v4 uses for the description) from the tag *type*
 * (`desc` for v2, `mluc` for v4). This spec drives both branches.
 */

import { identifySupportedIccProfile } from "./color-profile";

function writeUint32BE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index++) {
    target[offset + index] = text.charCodeAt(index) & 0xff;
  }
}

function writeUtf16BE(target: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    target[offset + index * 2] = (code >>> 8) & 0xff;
    target[offset + index * 2 + 1] = code & 0xff;
  }
}

const ICC_TAG_TABLE_OFFSET = 128;
const ICC_TAG_RECORD_LENGTH = 12;

function buildIccProfileWithDescTag(opts: {
  readonly tagBytes: Uint8Array;
  readonly version: { readonly major: number; readonly minor: number };
}): Uint8Array {
  // One-tag profile: header (128) + tag count (4) + one record (12) +
  // tag data. ICC offsets are absolute from byte 0 of the profile.
  const tagOffset = ICC_TAG_TABLE_OFFSET + 4 + ICC_TAG_RECORD_LENGTH;
  const totalSize = tagOffset + opts.tagBytes.length;
  const buffer = new Uint8Array(totalSize);
  // Profile header — only the fields the parser actually reads need to
  // be valid. Profile size, version, and `acsp` signature are checked.
  writeUint32BE(buffer, 0, totalSize);
  buffer[8] = opts.version.major;
  buffer[9] = (opts.version.minor & 0xf) << 4;
  writeAscii(buffer, 36, "acsp");
  // Tag table.
  writeUint32BE(buffer, ICC_TAG_TABLE_OFFSET, 1);
  writeAscii(buffer, ICC_TAG_TABLE_OFFSET + 4, "desc");
  writeUint32BE(buffer, ICC_TAG_TABLE_OFFSET + 8, tagOffset);
  writeUint32BE(buffer, ICC_TAG_TABLE_OFFSET + 12, opts.tagBytes.length);
  buffer.set(opts.tagBytes, tagOffset);
  return buffer;
}

function buildV2DescTagBytes(text: string): Uint8Array {
  // textDescriptionType layout: type sig (4) | reserved (4) |
  // ascii length (4) | ascii bytes (length, NUL-terminated).
  const length = text.length + 1;
  const bytes = new Uint8Array(12 + length);
  writeAscii(bytes, 0, "desc");
  writeUint32BE(bytes, 8, length);
  writeAscii(bytes, 12, text);
  // Trailing NUL is included in `length` per ICC v2 §6.5.17.
  return bytes;
}

function buildV4MlucTagBytes(text: string): Uint8Array {
  // multiLocalizedUnicodeType layout: type sig (4) | reserved (4) |
  // record count (4) | record size (4) | record { lang(2) | country(2)
  // | text length (4) | text offset (4) } | UTF-16BE text.
  const recordSize = 12;
  const headerLen = 16 + recordSize;
  const textBytes = text.length * 2;
  const bytes = new Uint8Array(headerLen + textBytes);
  writeAscii(bytes, 0, "mluc");
  writeUint32BE(bytes, 8, 1);
  writeUint32BE(bytes, 12, recordSize);
  // First record — language/country left zero (unspecified locale).
  writeUint32BE(bytes, 16 + 4, textBytes);
  writeUint32BE(bytes, 16 + 8, headerLen);
  writeUtf16BE(bytes, headerLen, text);
  return bytes;
}

describe("identifySupportedIccProfile — ICC v2/v4 profileDescriptionTag", () => {
  it("recognises v4 sRGB profiles whose description is encoded as `mluc`", () => {
    // This is the layout real Figma .figs ship: tag signature `desc`,
    // tag type `mluc`, description string "sRGB".
    const profile = {
      name: "ICC Profile",
      data: buildIccProfileWithDescTag({
        tagBytes: buildV4MlucTagBytes("sRGB"),
        version: { major: 4, minor: 3 },
      }),
    };
    expect(identifySupportedIccProfile(profile)).toBe("SRGB");
  });

  it("recognises v2 sRGB profiles whose description is encoded as `desc`", () => {
    // The classic ICC v2 layout — tag signature `desc`, tag type
    // `desc`, ASCII description. Older PNG/JPEG ICC payloads still
    // ship this form; the parser must handle both.
    const profile = {
      name: "ICC Profile",
      data: buildIccProfileWithDescTag({
        tagBytes: buildV2DescTagBytes("sRGB IEC61966-2.1"),
        version: { major: 2, minor: 1 },
      }),
    };
    expect(identifySupportedIccProfile(profile)).toBe("SRGB");
  });

  it("recognises v4 Display P3 profiles whose description is encoded as `mluc`", () => {
    const profile = {
      name: "ICC Profile",
      data: buildIccProfileWithDescTag({
        tagBytes: buildV4MlucTagBytes("Display P3"),
        version: { major: 4, minor: 0 },
      }),
    };
    expect(identifySupportedIccProfile(profile)).toBe("DISPLAY_P3_V4");
  });

  it("throws fail-fast when the description tag uses an unsupported type signature", () => {
    // SoT: only `desc` and `mluc` are valid type signatures for the
    // profileDescriptionTag. Anything else is malformed and the parser
    // must surface it rather than silently treating the description as
    // missing.
    const bogus = new Uint8Array(16);
    writeAscii(bogus, 0, "XYZ ");
    const profile = {
      name: "ICC Profile",
      data: buildIccProfileWithDescTag({
        tagBytes: bogus,
        version: { major: 4, minor: 0 },
      }),
    };
    expect(() => identifySupportedIccProfile(profile)).toThrow(
      "ICC desc tag has unsupported type signature: XYZ",
    );
  });

  it("throws fail-fast when the profile is missing the description tag entirely", () => {
    // A profile with zero tags is malformed — the description tag is
    // mandatory per ICC.1:2010.
    const buffer = new Uint8Array(132);
    writeUint32BE(buffer, 0, buffer.length);
    buffer[8] = 4;
    buffer[9] = 0x30;
    writeAscii(buffer, 36, "acsp");
    writeUint32BE(buffer, ICC_TAG_TABLE_OFFSET, 0);
    expect(() => identifySupportedIccProfile({ name: "x", data: buffer })).toThrow(
      "ICC profile is missing the required profileDescriptionTag (desc)",
    );
  });
});
