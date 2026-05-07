/**
 * @file Raster image resampling for Figma image export parity.
 */

import type { FigmaImageResamplingMethod } from "./export-settings";

export type RgbaRaster = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

export type ResampleImageOptions = {
  readonly source: RgbaRaster;
  readonly width: number;
  readonly height: number;
  readonly method: FigmaImageResamplingMethod;
  readonly fit: "stretch" | "cover";
};

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Image resampling requires ${label} to be a positive integer`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cubicWeight(value: number): number {
  const x = Math.abs(value);
  if (x <= 1) {
    return 1.5 * x * x * x - 2.5 * x * x + 1;
  }
  if (x < 2) {
    return -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2;
  }
  return 0;
}

function sampleNearest(source: RgbaRaster, x: number, y: number, channel: number): number {
  const sx = clamp(Math.round(x), 0, source.width - 1);
  const sy = clamp(Math.round(y), 0, source.height - 1);
  return source.data[(sy * source.width + sx) * 4 + channel];
}

function sampleBicubic(source: RgbaRaster, x: number, y: number, channel: number): number {
  const baseX = Math.floor(x);
  const baseY = Math.floor(y);
  const rows = [-1, 0, 1, 2];
  const columns = [-1, 0, 1, 2];
  const sampled = rows.flatMap((yy) => {
    const sy = clamp(baseY + yy, 0, source.height - 1);
    const wy = cubicWeight(y - (baseY + yy));
    return columns.map((xx) => {
      const sx = clamp(baseX + xx, 0, source.width - 1);
      const wx = cubicWeight(x - (baseX + xx));
      const weight = wx * wy;
      return {
        value: source.data[(sy * source.width + sx) * 4 + channel] * weight,
        weight,
      };
    });
  });
  const totals = sampled.reduce((acc, sample) => ({
    value: acc.value + sample.value,
    weight: acc.weight + sample.weight,
  }), { value: 0, weight: 0 });
  if (totals.weight === 0) {
    throw new Error("Bicubic image resampling produced a zero total sample weight");
  }
  return Math.round(clamp(totals.value / totals.weight, 0, 255));
}

function scaleForFit(source: RgbaRaster, width: number, height: number, fit: ResampleImageOptions["fit"]): number {
  if (fit === "cover") {
    return Math.min(source.width / width, source.height / height);
  }
  if (fit === "stretch") {
    throw new Error("Stretch image resampling uses the full source rectangle without fit scaling");
  }
  throw new Error(`Unsupported image resampling fit mode: ${String(fit)}`);
}

function computeSourceRect(source: RgbaRaster, width: number, height: number, fit: ResampleImageOptions["fit"]): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  if (fit === "stretch") {
    return { x: 0, y: 0, width: source.width, height: source.height };
  }
  const scale = scaleForFit(source, width, height, fit);
  const cropWidth = width * scale;
  const cropHeight = height * scale;
  return {
    x: (source.width - cropWidth) / 2,
    y: (source.height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

function sourceCoordinate(start: number, length: number, index: number, targetLength: number): number {
  return start + ((index + 0.5) * length) / targetLength - 0.5;
}

/** Resample an RGBA raster using Figma's exposed Basic/Detailed export modes. */
export function resampleImage(options: ResampleImageOptions): RgbaRaster {
  const { source, width, height, method, fit } = options;
  assertPositiveInteger(source.width, "source.width");
  assertPositiveInteger(source.height, "source.height");
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");
  if (source.data.length !== source.width * source.height * 4) {
    throw new Error("Image resampling requires source RGBA data matching width and height");
  }
  const rect = computeSourceRect(source, width, height, fit);
  const output = new Uint8Array(width * height * 4);
  const sampler = method === "BASIC_NEAREST" ? sampleNearest : sampleBicubic;
  for (let y = 0; y < height; y++) {
    const sy = sourceCoordinate(rect.y, rect.height, y, height);
    for (let x = 0; x < width; x++) {
      const sx = sourceCoordinate(rect.x, rect.width, x, width);
      const offset = (y * width + x) * 4;
      output[offset] = sampler(source, sx, sy, 0);
      output[offset + 1] = sampler(source, sx, sy, 1);
      output[offset + 2] = sampler(source, sx, sy, 2);
      output[offset + 3] = sampler(source, sx, sy, 3);
    }
  }
  return { width, height, data: output };
}
