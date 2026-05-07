/**
 * @file PNG chunk parser (state machine)
 *
 * Ported from pngjs (MIT License)
 * Copyright (c) 2015 Luke Page & Original Contributors
 * Copyright (c) 2012 Kuba Niegowski
 */

import * as constants from "./constants";
import { crc32 } from "./crc";
import { readUInt32BE, readInt32BE, readUInt16BE, concatUint8Arrays } from "./buffer-util";
import { inflate } from "pako";

export type PngMetadata = {
  width: number;
  height: number;
  depth: number;
  interlace: boolean;
  palette: boolean;
  color: boolean;
  alpha: boolean;
  bpp: number;
  colorType: number;
  transColor?: number[];
  data?: Uint8Array | Uint16Array;
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

export type ParserDependencies = {
  read: (length: number, callback: (data: Uint8Array) => void) => void;
  error: (err: Error) => void;
  metadata: (data: PngMetadata) => void;
  gamma: (value: number) => void;
  srgbIntent?: (value: number) => void;
  chromaticity?: (value: PngChromaticity) => void;
  iccProfile?: (value: PngIccProfile) => void;
  palette: (colors: number[][]) => void;
  transColor: (color: number[]) => void;
  inflateData: (data: Uint8Array) => void;
  simpleTransparency: () => void;
  headersFinished?: () => void;
};

type ParserOptions = {
  checkCRC?: boolean;
};

export type ParserHandle = {
  /** Start parsing from the PNG signature. */
  start: () => void;
};

/**
 * Create a PNG chunk-level parser. Processes PNG chunks sequentially via a callback-based reader.
 */
export function createParser(options: ParserOptions, deps: ParserDependencies): ParserHandle {
  const checkCRC = options.checkCRC ?? true;
  const headersFinished = deps.headersFinished || (() => {});

  const state = {
    hasIHDR: false,
    hasIEND: false,
    emittedHeadersFinished: false,
    palette: [] as number[][],
    colorType: 0,
    crcData: [] as Uint8Array[],
  };

  const chunks: Record<number, (length: number) => void> = {
    [constants.TYPE_IHDR]: handleIHDR,
    [constants.TYPE_IEND]: handleIEND,
    [constants.TYPE_IDAT]: handleIDAT,
    [constants.TYPE_PLTE]: handlePLTE,
    [constants.TYPE_tRNS]: handleTRNS,
    [constants.TYPE_gAMA]: handleGAMA,
    [constants.TYPE_sRGB]: handleSRGB,
    [constants.TYPE_cHRM]: handleCHRM,
    [constants.TYPE_iCCP]: handleICCP,
  };

  function parseSignature(data: Uint8Array): void {
    for (const i of Array.from({ length: constants.PNG_SIGNATURE.length }, (_, j) => j)) {
      if (data[i] !== constants.PNG_SIGNATURE[i]) {
        deps.error(new Error("Invalid file signature"));
        return;
      }
    }
    deps.read(8, parseChunkBegin);
  }

  function parseChunkBegin(data: Uint8Array): void {
    const length = readUInt32BE(data, 0);
    const type = readUInt32BE(data, 4);
    const name = String.fromCharCode(data[4], data[5], data[6], data[7]);
    const ancillary = Boolean(data[4] & 0x20);

    if (!state.hasIHDR && type !== constants.TYPE_IHDR) {
      deps.error(new Error("Expected IHDR on beginning"));
      return;
    }

    state.crcData = [data.slice(4, 8)];

    if (chunks[type]) {
      return chunks[type](length);
    }

    if (!ancillary) {
      deps.error(new Error("Unsupported critical chunk type " + name));
      return;
    }

    deps.read(length + 4, skipChunk);
  }

  function skipChunk(): void {
    deps.read(8, parseChunkBegin);
  }

  function handleChunkEnd(): void {
    deps.read(4, parseChunkEnd);
  }

  function parseChunkEnd(data: Uint8Array): void {
    const fileCrc = readInt32BE(data, 0);
    const calcCrc = crc32(concatUint8Arrays(state.crcData));

    if (checkCRC && calcCrc !== fileCrc) {
      deps.error(new Error("Crc error - " + fileCrc + " - " + calcCrc));
      return;
    }

    if (!state.hasIEND) {
      deps.read(8, parseChunkBegin);
    }
  }

  function handleIHDR(length: number): void {
    deps.read(length, parseIHDR);
  }

  function parseIHDR(data: Uint8Array): void {
    state.crcData.push(data);

    const width = readUInt32BE(data, 0);
    const height = readUInt32BE(data, 4);
    const depth = data[8];
    const colorType = data[9];
    const compr = data[10];
    const filter = data[11];
    const interlace = data[12];

    if (depth !== 8 && depth !== 4 && depth !== 2 && depth !== 1 && depth !== 16) {
      deps.error(new Error("Unsupported bit depth " + depth));
      return;
    }
    if (!(colorType in constants.COLORTYPE_TO_BPP_MAP)) {
      deps.error(new Error("Unsupported color type"));
      return;
    }
    if (compr !== 0) {
      deps.error(new Error("Unsupported compression method"));
      return;
    }
    if (filter !== 0) {
      deps.error(new Error("Unsupported filter method"));
      return;
    }
    if (interlace !== 0 && interlace !== 1) {
      deps.error(new Error("Unsupported interlace method"));
      return;
    }

    state.colorType = colorType;
    state.hasIHDR = true;

    deps.metadata({
      width,
      height,
      depth,
      interlace: Boolean(interlace),
      palette: Boolean(colorType & constants.COLORTYPE_PALETTE),
      color: Boolean(colorType & constants.COLORTYPE_COLOR),
      alpha: Boolean(colorType & constants.COLORTYPE_ALPHA),
      bpp: constants.COLORTYPE_TO_BPP_MAP[state.colorType],
      colorType,
    });

    handleChunkEnd();
  }

  function handlePLTE(length: number): void {
    deps.read(length, parsePLTE);
  }

  function parsePLTE(data: Uint8Array): void {
    state.crcData.push(data);
    const entries = Math.floor(data.length / 3);
    for (const i of Array.from({ length: entries }, (_, j) => j)) {
      state.palette.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 0xff]);
    }
    deps.palette(state.palette);
    handleChunkEnd();
  }

  function handleTRNS(length: number): void {
    deps.simpleTransparency();
    deps.read(length, parseTRNS);
  }

  function parseTRNS(data: Uint8Array): void {
    state.crcData.push(data);

    if (state.colorType === constants.COLORTYPE_PALETTE_COLOR) {
      if (state.palette.length === 0) {
        deps.error(new Error("Transparency chunk must be after palette"));
        return;
      }
      if (data.length > state.palette.length) {
        deps.error(new Error("More transparent colors than palette size"));
        return;
      }
      for (const i of Array.from({ length: data.length }, (_, j) => j)) {
        state.palette[i][3] = data[i];
      }
      deps.palette(state.palette);
    }

    if (state.colorType === constants.COLORTYPE_GRAYSCALE) {
      deps.transColor([readUInt16BE(data, 0)]);
    }
    if (state.colorType === constants.COLORTYPE_COLOR) {
      deps.transColor([readUInt16BE(data, 0), readUInt16BE(data, 2), readUInt16BE(data, 4)]);
    }

    handleChunkEnd();
  }

  function handleGAMA(length: number): void {
    deps.read(length, parseGAMA);
  }

  function parseGAMA(data: Uint8Array): void {
    state.crcData.push(data);
    deps.gamma(readUInt32BE(data, 0) / constants.GAMMA_DIVISION);
    handleChunkEnd();
  }

  function handleSRGB(length: number): void {
    deps.read(length, parseSRGB);
  }

  function parseSRGB(data: Uint8Array): void {
    state.crcData.push(data);
    if (data.length !== 1) {
      deps.error(new Error("sRGB chunk requires one rendering-intent byte"));
      return;
    }
    const intent = data[0];
    if (intent === undefined) {
      deps.error(new Error("sRGB chunk requires one rendering-intent byte"));
      return;
    }
    if (intent > 3) {
      deps.error(new Error("sRGB rendering intent must be 0, 1, 2, or 3"));
      return;
    }
    deps.srgbIntent?.(intent);
    handleChunkEnd();
  }

  function handleCHRM(length: number): void {
    deps.read(length, parseCHRM);
  }

  function parseCHRM(data: Uint8Array): void {
    state.crcData.push(data);
    if (data.length !== 32) {
      deps.error(new Error("cHRM chunk requires 32 bytes"));
      return;
    }
    deps.chromaticity?.({
      whitePointX: readUInt32BE(data, 0) / constants.GAMMA_DIVISION,
      whitePointY: readUInt32BE(data, 4) / constants.GAMMA_DIVISION,
      redX: readUInt32BE(data, 8) / constants.GAMMA_DIVISION,
      redY: readUInt32BE(data, 12) / constants.GAMMA_DIVISION,
      greenX: readUInt32BE(data, 16) / constants.GAMMA_DIVISION,
      greenY: readUInt32BE(data, 20) / constants.GAMMA_DIVISION,
      blueX: readUInt32BE(data, 24) / constants.GAMMA_DIVISION,
      blueY: readUInt32BE(data, 28) / constants.GAMMA_DIVISION,
    });
    handleChunkEnd();
  }

  function handleICCP(length: number): void {
    deps.read(length, parseICCP);
  }

  function parseICCP(data: Uint8Array): void {
    state.crcData.push(data);
    const separatorIndex = data.indexOf(0);
    if (separatorIndex < 1 || separatorIndex > 79) {
      deps.error(new Error("iCCP chunk requires a 1..79 byte profile name"));
      return;
    }
    const compressionMethod = data[separatorIndex + 1];
    if (compressionMethod !== 0) {
      deps.error(new Error("iCCP chunk requires zlib compression method 0"));
      return;
    }
    const compressedProfileStart = separatorIndex + 2;
    if (compressedProfileStart >= data.length) {
      deps.error(new Error("iCCP chunk requires compressed profile data"));
      return;
    }
    deps.iccProfile?.({
      name: decodeLatin1(data.slice(0, separatorIndex)),
      data: inflate(data.slice(compressedProfileStart)),
    });
    handleChunkEnd();
  }

  function handleIDAT(length: number): void {
    if (!state.emittedHeadersFinished) {
      state.emittedHeadersFinished = true;
      headersFinished();
    }
    deps.read(-length, (data: Uint8Array) => parseIDAT(length, data));
  }

  function parseIDAT(length: number, data: Uint8Array): void {
    state.crcData.push(data);

    if (state.colorType === constants.COLORTYPE_PALETTE_COLOR && state.palette.length === 0) {
      throw new Error("Expected palette not found");
    }

    deps.inflateData(data);
    const leftOverLength = length - data.length;

    if (leftOverLength > 0) {
      handleIDAT(leftOverLength);
    } else {
      handleChunkEnd();
    }
  }

  function handleIEND(length: number): void {
    deps.read(length, parseIEND);
  }

  function parseIEND(data: Uint8Array): void {
    state.crcData.push(data);
    state.hasIEND = true;
    handleChunkEnd();
  }

  return {
    start(): void {
      deps.read(constants.PNG_SIGNATURE.length, parseSignature);
    },
  };
}

function decodeLatin1(data: Uint8Array): string {
  return Array.from(data, (byte) => String.fromCharCode(byte)).join("");
}
