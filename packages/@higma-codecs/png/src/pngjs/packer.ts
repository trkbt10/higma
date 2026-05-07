/**
 * @file PNG chunk packer (encoder)
 *
 * Ported from pngjs (MIT License)
 * Copyright (c) 2015 Luke Page & Original Contributors
 * Copyright (c) 2012 Kuba Niegowski
 */

import { deflate } from "pako";
import * as constants from "./constants";
import { crc32 } from "./crc";
import { bitPack } from "./bitpacker";
import { filterData } from "./filter-pack";
import { writeUInt32BE, writeInt32BE, concatUint8Arrays } from "./buffer-util";

export type PackerOptions = {
  deflateLevel?: number;
  deflateStrategy?: number;
  deflateChunkSize?: number;
  inputHasAlpha?: boolean;
  bitDepth?: number;
  colorType?: number;
  inputColorType?: number;
  filterType?: number;
  bgColor?: { red: number; green: number; blue: number };
};

type DeflateLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

type ResolvedOptions = {
  deflateLevel: DeflateLevel;
  deflateStrategy: number;
  deflateChunkSize: number;
  inputHasAlpha: boolean;
  bitDepth: number;
  colorType: number;
  inputColorType: number;
  filterType: number;
  bgColor?: { red: number; green: number; blue: number };
};

function resolveOptions(options: PackerOptions): ResolvedOptions {
  const deflateLevel = (options.deflateLevel ?? 9) as DeflateLevel;
  const deflateStrategy = options.deflateStrategy ?? 3;
  const colorType = typeof options.colorType === "number" ? options.colorType : constants.COLORTYPE_COLOR_ALPHA;
  const inputColorType = typeof options.inputColorType === "number" ? options.inputColorType : constants.COLORTYPE_COLOR_ALPHA;

  const supportedColorTypes = [
    constants.COLORTYPE_GRAYSCALE,
    constants.COLORTYPE_COLOR,
    constants.COLORTYPE_COLOR_ALPHA,
    constants.COLORTYPE_ALPHA,
  ];

  if (supportedColorTypes.indexOf(colorType) === -1) {
    throw new Error("option color type:" + colorType + " is not supported at present");
  }
  if (supportedColorTypes.indexOf(inputColorType) === -1) {
    throw new Error("option input color type:" + inputColorType + " is not supported at present");
  }

  const bitDepth = options.bitDepth || 8;
  if (bitDepth !== 8 && bitDepth !== 16) {
    throw new Error("option bit depth:" + bitDepth + " is not supported at present");
  }

  return {
    deflateChunkSize: options.deflateChunkSize || 32 * 1024,
    deflateLevel,
    deflateStrategy,
    inputHasAlpha: options.inputHasAlpha ?? true,
    bitDepth,
    colorType,
    inputColorType,
    filterType: options.filterType ?? -1,
    bgColor: options.bgColor,
  };
}

function packChunk(type: number, data: Uint8Array | null): Uint8Array {
  const len = data ? data.length : 0;
  const buf = new Uint8Array(len + 12);

  writeUInt32BE(buf, len, 0);
  writeUInt32BE(buf, type, 4);

  if (data) {
    buf.set(data, 8);
  }

  const crcInput = buf.slice(4, buf.length - 4);
  writeInt32BE(buf, crc32(crcInput), buf.length - 4);

  return buf;
}

function packIHDR(width: number, height: number, opts: ResolvedOptions): Uint8Array {
  const buf = new Uint8Array(13);
  writeUInt32BE(buf, width, 0);
  writeUInt32BE(buf, height, 4);
  buf[8] = opts.bitDepth;
  buf[9] = opts.colorType;
  buf[10] = 0; // compression
  buf[11] = 0; // filter
  buf[12] = 0; // interlace

  return packChunk(constants.TYPE_IHDR, buf);
}

function packGAMA(gamma: number): Uint8Array {
  const buf = new Uint8Array(4);
  writeUInt32BE(buf, Math.floor(gamma * constants.GAMMA_DIVISION), 0);
  return packChunk(constants.TYPE_gAMA, buf);
}

function packSRGB(intent: number): Uint8Array {
  if (!Number.isInteger(intent) || intent < 0 || intent > 3) {
    throw new Error("sRGB rendering intent must be 0, 1, 2, or 3");
  }
  return packChunk(constants.TYPE_sRGB, new Uint8Array([intent]));
}

function chromaticityValueToPngInt(key: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`cHRM ${key} must be a finite value from 0 to 1`);
  }
  return Math.round(value * constants.GAMMA_DIVISION);
}

function packCHRM(chromaticity: PngChromaticity): Uint8Array {
  const buf = new Uint8Array(32);
  writeUInt32BE(buf, chromaticityValueToPngInt("whitePointX", chromaticity.whitePointX), 0);
  writeUInt32BE(buf, chromaticityValueToPngInt("whitePointY", chromaticity.whitePointY), 4);
  writeUInt32BE(buf, chromaticityValueToPngInt("redX", chromaticity.redX), 8);
  writeUInt32BE(buf, chromaticityValueToPngInt("redY", chromaticity.redY), 12);
  writeUInt32BE(buf, chromaticityValueToPngInt("greenX", chromaticity.greenX), 16);
  writeUInt32BE(buf, chromaticityValueToPngInt("greenY", chromaticity.greenY), 20);
  writeUInt32BE(buf, chromaticityValueToPngInt("blueX", chromaticity.blueX), 24);
  writeUInt32BE(buf, chromaticityValueToPngInt("blueY", chromaticity.blueY), 28);
  return packChunk(constants.TYPE_cHRM, buf);
}

function packICCP(profile: PngIccProfile): Uint8Array {
  const nameBytes = encodeIccProfileName(profile.name);
  const compressedProfile = deflate(profile.data, { level: 9 });
  if (!compressedProfile || compressedProfile.length === 0) {
    throw new Error("iCCP profile requires compressible profile bytes");
  }
  return packChunk(constants.TYPE_iCCP, concatUint8Arrays([
    nameBytes,
    new Uint8Array([0, 0]),
    compressedProfile,
  ]));
}

function packIDAT(data: Uint8Array): Uint8Array {
  return packChunk(constants.TYPE_IDAT, data);
}

function packIEND(): Uint8Array {
  return packChunk(constants.TYPE_IEND, null);
}

export type PngData = {
  width: number;
  height: number;
  data: Uint8Array;
  gamma?: number;
  srgbIntent?: number;
  chromaticity?: PngChromaticity;
  iccProfile?: PngIccProfile;
};

export type PngChromaticity = {
  readonly whitePointX: number;
  readonly whitePointY: number;
  readonly redX: number;
  readonly redY: number;
  readonly greenX: number;
  readonly greenY: number;
  readonly blueX: number;
  readonly blueY: number;
};

export type PngIccProfile = {
  readonly name: string;
  readonly data: Uint8Array;
};

/**
 * Encode pixel data into a PNG byte stream.
 */
export function pack(metaData: PngData, opt?: PackerOptions): Uint8Array {
  const options = resolveOptions(opt || {});
  assertColorSpaceChunks(metaData);

  const chunks: Uint8Array[] = [
    new Uint8Array(constants.PNG_SIGNATURE),
    packIHDR(metaData.width, metaData.height, options),
  ];

  if (metaData.iccProfile) {
    chunks.push(packICCP(metaData.iccProfile));
  }

  if (!metaData.iccProfile && metaData.srgbIntent !== undefined) {
    chunks.push(packSRGB(metaData.srgbIntent));
  }

  if (!metaData.iccProfile && metaData.chromaticity) {
    chunks.push(packCHRM(metaData.chromaticity));
  }

  if (!metaData.iccProfile && metaData.gamma) {
    chunks.push(packGAMA(metaData.gamma));
  }

  const packedData = bitPack({
    dataIn: metaData.data,
    width: metaData.width,
    height: metaData.height,
    options: {
      colorType: options.colorType,
      inputColorType: options.inputColorType,
      bitDepth: options.bitDepth,
      inputHasAlpha: options.inputHasAlpha,
      bgColor: options.bgColor,
    },
  });

  const bpp = constants.COLORTYPE_TO_BPP_MAP[options.colorType];
  const filteredData = filterData({
    pxData: packedData,
    width: metaData.width,
    height: metaData.height,
    options: { filterType: options.filterType, bitDepth: options.bitDepth },
    bpp,
  });

  const compressedData = deflate(filteredData, { level: options.deflateLevel });

  if (!compressedData || !compressedData.length) {
    throw new Error("bad png - invalid compressed data response");
  }

  chunks.push(packIDAT(compressedData));
  chunks.push(packIEND());

  return concatUint8Arrays(chunks);
}

function assertColorSpaceChunks(metaData: PngData): void {
  if (!metaData.iccProfile) {
    return;
  }
  if (metaData.srgbIntent !== undefined || metaData.chromaticity !== undefined || metaData.gamma !== undefined) {
    throw new Error("PNG iCCP profile must not be combined with sRGB, cHRM, or gAMA chunks");
  }
}

function encodeIccProfileName(name: string): Uint8Array {
  if (name.length < 1 || name.length > 79) {
    throw new Error("iCCP profile name must contain 1..79 Latin-1 characters");
  }
  const bytes = Array.from(name, (char) => {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new Error("iCCP profile name must contain printable Latin-1 characters");
    }
    return code;
  });
  return new Uint8Array(bytes);
}
