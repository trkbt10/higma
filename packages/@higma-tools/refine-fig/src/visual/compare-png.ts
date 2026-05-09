/**
 * @file Pixel-diff two PNG buffers.
 *
 * Same shape and threshold defaults as the higma fidelity verifier;
 * inlined here so the refinement skill does not have to depend on
 * sibling tool packages (cross-tool deps within `@higma-tools/*` are
 * forbidden by the package-boundary rule).
 */
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

export type ComparisonOutcome =
  | {
      readonly kind: "compared";
      readonly width: number;
      readonly height: number;
      readonly diffPixels: number;
      readonly diffPercent: number;
      readonly diffPng: Uint8Array;
    }
  | {
      readonly kind: "mismatched-dimensions";
      readonly actual: { readonly width: number; readonly height: number };
      readonly expected: { readonly width: number; readonly height: number };
    };

export type CompareOptions = {
  readonly threshold?: number;
};

/** Pixel-diff `actualPng` against `expectedPng`. */
export function comparePng(
  actualPng: Uint8Array,
  expectedPng: Uint8Array,
  options: CompareOptions = {},
): ComparisonOutcome {
  const actual = PNG.sync.read(Buffer.from(actualPng));
  const expected = PNG.sync.read(Buffer.from(expectedPng));
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {
      kind: "mismatched-dimensions",
      actual: { width: actual.width, height: actual.height },
      expected: { width: expected.width, height: expected.height },
    };
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const diffPixels = pixelmatch(
    actual.data,
    expected.data,
    diff.data,
    actual.width,
    actual.height,
    { threshold: options.threshold ?? 0.1 },
  );
  const total = actual.width * actual.height;
  const diffPng = PNG.sync.write(diff);
  return {
    kind: "compared",
    width: actual.width,
    height: actual.height,
    diffPixels,
    diffPercent: total === 0 ? 0 : (diffPixels / total) * 100,
    diffPng: new Uint8Array(diffPng.buffer, diffPng.byteOffset, diffPng.byteLength),
  };
}
