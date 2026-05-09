/**
 * @file Compare two PNG byte buffers and report a pixel-diff summary.
 *
 * Used by the visual-fidelity verifier to decide whether the SVG/PNG
 * rendered from the captured `.fig` still resembles the original
 * Playwright screenshot. Returns the per-pixel diff count, percentage,
 * and a diff PNG visualising the mismatched pixels — written to disk
 * by the caller.
 *
 * The comparison is *strict* on dimensions: if the two images do not
 * agree on width/height (after optional letterboxing) the function
 * returns a `mismatched-dimensions` outcome instead of pretending the
 * comparison happened. The caller decides whether to crop, scale, or
 * fail. We never silently resize — the contract is "what dimensions
 * did the renderer produce vs the browser".
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
  /** pixelmatch threshold in [0,1]; lower = stricter. Default 0.1. */
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
