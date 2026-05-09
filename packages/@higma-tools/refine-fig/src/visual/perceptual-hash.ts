/**
 * @file Perceptual hashing for FigNode renderings.
 *
 * Implements aHash (average hash) and dHash (difference hash) over a
 * downscaled greyscale render of the PNG. Both produce a 64-bit
 * integer encoded as a hex string. Hamming distance between two
 * hashes is a robust similarity measure that survives small colour
 * shifts, antialiasing differences, and tiny size variations.
 *
 * We emit both because they capture different signal:
 *  - aHash leaks gross brightness layout
 *  - dHash captures local edges
 * Combining them with `combinedDistance` gives a 0..128 score where
 * 0 is identical and ~30 is "definitely different".
 */
import { PNG } from "pngjs";

const HASH_SIZE = 8;

export type PerceptualHash = {
  readonly aHash: string;
  readonly dHash: string;
};

/**
 * Decode a PNG and downscale it to an 8x8 (aHash) / 9x8 (dHash)
 * greyscale grid using box averaging.
 */
function decodeGrey(png: Uint8Array): { readonly width: number; readonly height: number; readonly grey: Float32Array } {
  const decoded = PNG.sync.read(Buffer.from(png));
  const width = decoded.width;
  const height = decoded.height;
  const grey = new Float32Array(width * height);
  for (let i = 0; i < width * height; i = i + 1) {
    const r = decoded.data[i * 4 + 0] ?? 0;
    const g = decoded.data[i * 4 + 1] ?? 0;
    const b = decoded.data[i * 4 + 2] ?? 0;
    const a = decoded.data[i * 4 + 3] ?? 0;
    // Composite over white so transparent areas don't all collapse to 0.
    const alpha = a / 255;
    const compR = r * alpha + 255 * (1 - alpha);
    const compG = g * alpha + 255 * (1 - alpha);
    const compB = b * alpha + 255 * (1 - alpha);
    grey[i] = 0.2126 * compR + 0.7152 * compG + 0.0722 * compB;
  }
  return { width, height, grey };
}

function boxAverage(
  source: { readonly width: number; readonly grey: Float32Array },
  sx0: number,
  sx1: number,
  sy0: number,
  sy1: number,
): number {
  const w = source.width;
  const grey = source.grey;
  // Two reduces would re-walk; explicit running totals via array.from + reduce
  // would allocate; an inner for-let is the cheapest accurate option and the
  // `for (let ...)` variant is exempt from the no-let rule.
  const total = sumBox(grey, w, sx0, sx1, sy0, sy1);
  const count = (sx1 - sx0) * (sy1 - sy0);
  return count === 0 ? 0 : total / count;
}

function sumRow(
  grey: Float32Array,
  width: number,
  sx0: number,
  sx1: number,
  y: number,
): number {
  return rangeSum(sx0, sx1, (x) => grey[y * width + x] ?? 0);
}

function sumBox(
  grey: Float32Array,
  width: number,
  sx0: number,
  sx1: number,
  sy0: number,
  sy1: number,
): number {
  return rangeSum(sy0, sy1, (y) => sumRow(grey, width, sx0, sx1, y));
}

function rangeSum(start: number, end: number, fn: (i: number) => number): number {
  if (start >= end) {
    return 0;
  }
  return fn(start) + rangeSum(start + 1, end, fn);
}

function downsample(
  source: { readonly width: number; readonly height: number; readonly grey: Float32Array },
  outW: number,
  outH: number,
): Float32Array {
  const out = new Float32Array(outW * outH);
  const xRatio = source.width / outW;
  const yRatio = source.height / outH;
  for (let oy = 0; oy < outH; oy = oy + 1) {
    const sy0 = Math.floor(oy * yRatio);
    const sy1 = Math.min(source.height, Math.max(sy0 + 1, Math.floor((oy + 1) * yRatio)));
    for (let ox = 0; ox < outW; ox = ox + 1) {
      const sx0 = Math.floor(ox * xRatio);
      const sx1 = Math.min(source.width, Math.max(sx0 + 1, Math.floor((ox + 1) * xRatio)));
      out[oy * outW + ox] = boxAverage(source, sx0, sx1, sy0, sy1);
    }
  }
  return out;
}

function bitsToHex(bits: readonly number[]): string {
  const acc = bits.reduce((a, b) => (a << 1n) | (b ? 1n : 0n), 0n);
  return acc.toString(16).padStart(16, "0");
}

function aHashBits(grid: Float32Array): number[] {
  const sum = grid.reduce((a, v) => a + v, 0);
  const avg = sum / grid.length;
  return Array.from(grid, (v) => (v > avg ? 1 : 0));
}

function dHashBits(grid: Float32Array, w: number, h: number): number[] {
  const bits: number[] = [];
  for (let y = 0; y < h; y = y + 1) {
    for (let x = 0; x < w - 1; x = x + 1) {
      const a = grid[y * w + x] ?? 0;
      const b = grid[y * w + x + 1] ?? 0;
      bits.push(a > b ? 1 : 0);
    }
  }
  return bits;
}

/** Compute aHash + dHash for the given rendered PNG. */
export function perceptualHash(png: Uint8Array): PerceptualHash {
  const grey = decodeGrey(png);
  const a = downsample(grey, HASH_SIZE, HASH_SIZE);
  const d = downsample(grey, HASH_SIZE + 1, HASH_SIZE);
  return {
    aHash: bitsToHex(aHashBits(a)),
    dHash: bitsToHex(dHashBits(d, HASH_SIZE + 1, HASH_SIZE)),
  };
}

function popcount(value: bigint): number {
  if (value === 0n) {
    return 0;
  }
  return 1 + popcount(value & (value - 1n));
}

function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`hamming: length mismatch ${a.length} vs ${b.length}`);
  }
  return popcount(BigInt(`0x${a}`) ^ BigInt(`0x${b}`));
}

/** 0..128 — sum of aHash and dHash hamming distances. */
export function combinedDistance(a: PerceptualHash, b: PerceptualHash): number {
  return hammingHex(a.aHash, b.aHash) + hammingHex(a.dHash, b.dHash);
}
