/**
 * @file Pixel-diff two PNG byte buffers.
 *
 * Single source of truth for the visual-fidelity comparison primitive used
 * by `@higma-tools/refine-fig` and `@higma-tools/web-fig-roundtrip`. Both
 * tools need to compare a renderer's PNG output against a Playwright
 * screenshot, but cross-tool deps within `@higma-tools/*` are forbidden by
 * the package-boundary rule, so the primitive lives one layer below.
 *
 * The comparison is *strict* on dimensions: if the two images do not agree
 * on width/height the function returns a `mismatched-dimensions` outcome
 * instead of pretending the comparison happened. The caller decides whether
 * to crop, scale, or fail. We never silently resize — the contract is
 * "what dimensions did the renderer produce vs the browser".
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
  /**
   * Whether anti-aliasing differences count as diff pixels. Default
   * `true` (count them). Set `false` for design-fidelity comparisons
   * where the renderer and the baseline rasteriser produce slightly
   * different sub-pixel coverage on shape edges — excluding AA lets
   * axis-aligned vector shapes hit ~0.0% diff so any residual signal
   * is real geometry / paint / stroke divergence.
   */
  readonly includeAA?: boolean;
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
    { threshold: options.threshold ?? 0.1, includeAA: options.includeAA ?? true },
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
