/**
 * @file Decide which targets need to be rasterised vs. served
 * from the on-disk cache.
 *
 * The CLI computes the fingerprint of every selected target's
 * source subtree, then compares it against the `tEXt` chunk
 * embedded in any pre-existing PNG at the planned output path.
 * Matches short-circuit the render; mismatches (or missing
 * files) flow into the streaming rasterisation.
 *
 * Pure-ish: the only IO is `readFile` for cache probing. The
 * `readFile` injection point is a function parameter rather
 * than a top-level import so unit tests can drive
 * `isCacheHit` / `planTargets` without touching the
 * filesystem.
 */
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { fingerprintFigSubtree } from "../fingerprint";
import { getTextMetadata } from "../png-meta";
import { applyFilename } from "../io/slug";
import type { FigFrameTarget } from "../types";

/** Key under which the fingerprint is stored in the PNG `tEXt` chunk. */
export const FINGERPRINT_PNG_KEY = "Higma-Fingerprint";

/** Signature of an injectable file reader. Returns `undefined` on miss. */
export type ReadFileFn = (path: string) => Promise<Uint8Array | undefined>;

/** Single plan entry for a target. */
export type RenderPlanEntry = {
  readonly target: FigFrameTarget;
  readonly filename: string;
  readonly outPath: string;
  readonly fingerprint: string;
  readonly skip: boolean;
};

export type PlanTargetsOptions = {
  readonly outDir: string;
  readonly filename: string;
  readonly scale: number;
  readonly force: boolean;
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly readFile: ReadFileFn;
  /**
   * Path-join function (injectable so tests can run independent of
   * the platform's path separator). Defaults to `node:path.resolve`-
   * compatible behaviour: `joinPath(dir, file)`.
   */
  readonly joinPath: (dir: string, file: string) => string;
  /**
   * Canvas background colour (folded into the fingerprint so a
   * transparent ↔ white flip invalidates the cached PNG).
   */
  readonly background?: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
};

/**
 * Probe the on-disk PNG at `path` and report whether its
 * embedded fingerprint matches `expected`.
 *
 * Returns `false` on any read or parse failure — the caller will
 * re-rasterise and overwrite. We never let a defensive branch
 * pass off a stale-but-readable file as a cache hit.
 */
export async function isCacheHit(
  path: string,
  expected: string,
  readFile: ReadFileFn,
): Promise<boolean> {
  const bytes = await readFile(path);
  if (!bytes) {
    return false;
  }
  const existing = readFingerprintSafely(bytes);
  return existing === expected;
}

function readFingerprintSafely(bytes: Uint8Array): string | undefined {
  try {
    return getTextMetadata(bytes, FINGERPRINT_PNG_KEY);
  } catch (error: unknown) {
    // A malformed PNG can't carry a trustworthy fingerprint —
    // treat it as a cache miss. We log the error class so the
    // operator can investigate; we don't surface the message
    // because partial PNGs are common during interrupted writes
    // and don't reflect a bug in the writer.
    void error;
    return undefined;
  }
}

/**
 * Build a plan per target — slugified filename, full output
 * path, fingerprint, skip flag. Used by the CLI as a pre-pass
 * before deciding whether to start the harness at all.
 */
export async function planTargets(
  targets: readonly FigFrameTarget[],
  options: PlanTargetsOptions,
): Promise<readonly RenderPlanEntry[]> {
  const plans: RenderPlanEntry[] = [];
  for (const target of targets) {
    const filename = applyFilename(options.filename, target.frame);
    const outPath = options.joinPath(options.outDir, filename);
    const fingerprint = fingerprintFigSubtree(target.node, {
      pixelRatio: options.scale,
      symbolMap: options.symbolMap,
      backgroundColor: options.background,
    });
    const skip = !options.force && (await isCacheHit(outPath, fingerprint, options.readFile));
    plans.push({ target, filename, outPath, fingerprint, skip });
  }
  return plans;
}
