/**
 * @file Synchronous PNG parser (decoder)
 *
 * Ported from pngjs (MIT License)
 * Copyright (c) 2015 Luke Page & Original Contributors
 * Copyright (c) 2012 Kuba Niegowski
 */

import { inflate } from "pako";
import { createSyncReader } from "./sync-reader";
import { createFilter, type BitmapInfo } from "./filter-parse";
import { createParser, type PngChromaticity, type PngIccProfile, type PngMetadata } from "./parser";
import { dataToBitMap } from "./bitmapper";
import { normaliseFormat } from "./format-normaliser";
import { concatUint8Arrays } from "./buffer-util";

export type ParseOptions = {
  checkCRC?: boolean;
  skipRescale?: boolean;
};

export type ParseContent = "data" | "metadata";

export type ParseDataResult = {
  width: number;
  height: number;
  depth: number;
  interlace: boolean;
  palette: boolean;
  color: boolean;
  alpha: boolean;
  bpp: number;
  colorType: number;
  data: Uint8Array | Uint16Array;
  gamma: number;
  srgbIntent?: number;
  chromaticity?: PngChromaticity;
  iccProfile?: PngIccProfile;
  transColor?: number[];
};

export type ParseResult = ParseDataResult;

export type ParseMetadataResult = Omit<ParseDataResult, "data" | "transColor">;

function createParseState() {
  return {
    err: undefined as Error | undefined,
    metaData: undefined as PngMetadata | undefined,
    paletteData: undefined as number[][] | undefined,
    gamma: undefined as number | undefined,
    srgbIntent: undefined as number | undefined,
    chromaticity: undefined as PngChromaticity | undefined,
    iccProfile: undefined as PngIccProfile | undefined,
  };
}

function buildParseMetadataResult(state: ReturnType<typeof createParseState>): ParseMetadataResult {
  const md = state.metaData;
  if (!md) {
    throw new Error("bad png - missing metadata");
  }
  return {
    width: md.width,
    height: md.height,
    depth: md.depth,
    interlace: md.interlace,
    palette: md.palette,
    color: md.color,
    alpha: md.alpha,
    bpp: md.bpp,
    colorType: md.colorType,
    gamma: state.gamma ?? 0,
    srgbIntent: state.srgbIntent,
    chromaticity: state.chromaticity,
    iccProfile: state.iccProfile,
  };
}

/**
 * Synchronously parse a PNG buffer into pixel data and metadata.
 *
 * The second argument selects content: `"data"` (default) decodes
 * pixels, `"metadata"` skips inflate/filter and returns only chunk
 * metadata. The single-argument and `(buffer, options)` legacy forms
 * are preserved for callers that pre-date the metadata mode.
 */
export function parseSync(buffer: Uint8Array): ParseDataResult;
export function parseSync(buffer: Uint8Array, options: ParseOptions): ParseDataResult;
export function parseSync(buffer: Uint8Array, content: "data", options?: ParseOptions): ParseDataResult;
export function parseSync(buffer: Uint8Array, content: "metadata", options?: ParseOptions): ParseMetadataResult;
export function parseSync(
  buffer: Uint8Array,
  contentOrOptions?: ParseContent | ParseOptions,
  options?: ParseOptions,
): ParseDataResult | ParseMetadataResult {
  const content: ParseContent = typeof contentOrOptions === "string" ? contentOrOptions : "data";
  const opts = options ?? (typeof contentOrOptions === "object" ? contentOrOptions : undefined) ?? {};
  const state = createParseState();
  const inflateDataList: Uint8Array[] = [];

  const reader = createSyncReader(buffer);

  const parser = createParser(opts, {
    read: reader.read,
    error: (e: Error) => { state.err = e; },
    metadata: (m: PngMetadata) => { state.metaData = m; },
    gamma: (g: number) => { state.gamma = g; },
    srgbIntent: (intent: number) => { state.srgbIntent = intent; },
    chromaticity: (chromaticity: PngChromaticity) => { state.chromaticity = chromaticity; },
    iccProfile: (iccProfile: PngIccProfile) => { state.iccProfile = iccProfile; },
    palette: (p: number[][]) => { state.paletteData = p; },
    transColor: (c: number[]) => { state.metaData!.transColor = c; },
    inflateData: (d: Uint8Array) => {
      if (content === "data") {
        inflateDataList.push(d);
      }
    },
    simpleTransparency: () => { state.metaData!.alpha = true; },
  });

  parser.start();
  reader.process();

  if (state.err) {
    throw state.err;
  }

  if (content === "metadata") {
    return buildParseMetadataResult(state);
  }

  const inflateData = concatUint8Arrays(inflateDataList);
  const inflatedData = inflate(inflateData);

  if (!inflatedData || !inflatedData.length) {
    throw new Error("bad png - invalid inflate data response");
  }

  const md = state.metaData!;
  const bitmapInfo: BitmapInfo = {
    width: md.width,
    height: md.height,
    interlace: md.interlace,
    bpp: md.bpp,
    depth: md.depth,
  };

  const outBuffers: Uint8Array[] = [];
  const filterReader = createSyncReader(inflatedData);
  const filter = createFilter(bitmapInfo, {
    read: filterReader.read,
    write: (bufferPart: Uint8Array) => { outBuffers.push(bufferPart); },
    complete: () => {},
  });

  filter.start();
  filterReader.process();

  const unfilteredData = concatUint8Arrays(outBuffers);
  const bitmapData = dataToBitMap(unfilteredData, bitmapInfo);
  const normalisedBitmapData = normaliseFormat(bitmapData, {
    depth: md.depth,
    width: md.width,
    height: md.height,
    colorType: md.colorType,
    transColor: md.transColor,
    palette: state.paletteData,
  }, opts.skipRescale);

  return {
    width: md.width,
    height: md.height,
    depth: md.depth,
    interlace: md.interlace,
    palette: md.palette,
    color: md.color,
    alpha: md.alpha,
    bpp: md.bpp,
    colorType: md.colorType,
    data: normalisedBitmapData,
    gamma: state.gamma || 0,
    srgbIntent: state.srgbIntent,
    chromaticity: state.chromaticity,
    iccProfile: state.iccProfile,
    transColor: md.transColor,
  };
}
