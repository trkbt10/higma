/**
 * @file Grid track sizing — SoT for interpreting the Kiwi `GridTrackSize`
 * payload that hangs off each `FigGridTrackPositions` entry.
 *
 * The Kiwi payload is preserved verbatim (typed `unknown` on
 * `FigGridTrackPositions.entries[].trackSize`) because the schema
 * shape is not yet promoted to a dedicated generated TypeScript type.
 * This module is the single place that interprets that payload as the
 * typed `FigGridTrackSize` the GRID layout solver
 * (`applyGridLayout`) can consult.
 *
 * Input (Kiwi side):
 *
 *   {
 *     minSizing: { type: { value: 0, name: "FLEX" }, value: 1 },
 *     maxSizing: { type: { value: 0, name: "FLEX" }, value: 1 }
 *   }
 *
 * Output (domain):
 *
 *   { minSizing: { type: "FLEX", value: 1 },
 *     maxSizing: { type: "FLEX", value: 1 } }
 *
 * Missing shapes return `undefined`; malformed shapes throw.
 */
import { kiwiEnumName } from "../constants";

export type FigGridTrackSizingType = "FLEX" | "FIXED" | "AUTO" | "HUG" | "RESIZE_TO_FIT";

export type FigGridTrackAxisSize = {
  readonly type: FigGridTrackSizingType;
  readonly value: number;
};

export type FigGridTrackSize = {
  readonly minSizing?: FigGridTrackAxisSize;
  readonly maxSizing?: FigGridTrackAxisSize;
};

const VALID_TYPES: ReadonlySet<FigGridTrackSizingType> = new Set([
  "FLEX",
  "FIXED",
  "AUTO",
  "HUG",
  "RESIZE_TO_FIT",
]);

function readTypeName(raw: unknown): FigGridTrackSizingType | undefined {
  const name = kiwiEnumName<FigGridTrackSizingType>(raw, "GridTrackSize.type");
  if (name === undefined) {
    return undefined;
  }
  if ((VALID_TYPES as ReadonlySet<string>).has(name)) {
    return name;
  }
  return undefined;
}

function readAxisSize(raw: unknown, fieldName: string): FigGridTrackAxisSize | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null || typeof raw !== "object") {
    throw new Error(`interpretGridTrackSize: ${fieldName} must be an object`);
  }
  const type = readTypeName((raw as { type?: unknown }).type);
  if (!type) {
    throw new Error(`interpretGridTrackSize: ${fieldName}.type is missing or unsupported`);
  }
  const value = (raw as { value?: unknown }).value;
  if ((type === "FLEX" || type === "FIXED") && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`interpretGridTrackSize: ${fieldName}.value is required for ${type}`);
  }
  return {
    type,
    value: typeof value === "number" && Number.isFinite(value) ? value : 0,
  };
}

/**
 * Interpret an `unknown` `trackSize` payload as a typed
 * `FigGridTrackSize`. Returns `undefined` when the payload is absent.
 */
export function interpretGridTrackSize(raw: unknown): FigGridTrackSize | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null || typeof raw !== "object") {
    throw new Error("interpretGridTrackSize: trackSize must be an object");
  }
  const min = readAxisSize((raw as { minSizing?: unknown }).minSizing, "minSizing");
  const max = readAxisSize((raw as { maxSizing?: unknown }).maxSizing, "maxSizing");
  if (!min && !max) {
    return undefined;
  }
  return {
    ...(min !== undefined ? { minSizing: min } : {}),
    ...(max !== undefined ? { maxSizing: max } : {}),
  };
}

/**
 * Resolve a single track's pixel size given:
 *   - the (interpreted) per-track sizing pair (or `undefined`);
 *   - the largest child size in this track (for AUTO/RESIZE_TO_FIT);
 *   - the FLEX share width (pixels per unit of flex weight) computed
 *     by the column/row solver after subtracting fixed/auto sizes.
 *
 * Returns the pixel size the solver should reserve for this track.
 */
export function resolveTrackSize(
  trackSize: FigGridTrackSize | undefined,
  intrinsicSize: number,
  flexShare: number,
): number {
  // `maxSizing` wins — it bounds the maximum extent — but FLEX min/max
  // both indicate "share remaining space". Use the strictest mode
  // available: if either axis is FIXED, that's the size. Otherwise
  // prefer the max-sizing mode.
  const min = trackSize?.minSizing;
  const max = trackSize?.maxSizing;
  if (max?.type === "FIXED") { return max.value; }
  if (min?.type === "FIXED") { return min.value; }
  if (max?.type === "FLEX") { return Math.max(0, max.value) * flexShare; }
  if (min?.type === "FLEX") { return Math.max(0, min.value) * flexShare; }
  // AUTO / RESIZE_TO_FIT / unknown — content-based size.
  return intrinsicSize;
}

/**
 * Compute the pixel-per-flex-unit share from the parent's primary-axis
 * available size and the per-track sizing entries.
 *
 * Algorithm: subtract the fixed tracks and the AUTO/intrinsic tracks
 * from the available size; divide the remainder among the total flex
 * weight. Returns `0` when there is no flex weight (the solver then
 * uses intrinsic sizes only).
 *
 * `intrinsicByIndex` reports the largest child size in each track;
 * `tracks` is the per-track sizing array (parallel order); `available`
 * is the parent axis size minus padding minus inter-track gaps.
 */
export function computeFlexShare(
  tracks: readonly (FigGridTrackSize | undefined)[],
  intrinsicByIndex: readonly number[],
  available: number,
): number {
  let totalFlex = 0;
  let totalFixed = 0;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const intrinsic = intrinsicByIndex[i] ?? 0;
    const max = t?.maxSizing;
    const min = t?.minSizing;
    if (max?.type === "FIXED") {
      totalFixed += max.value;
      continue;
    }
    if (min?.type === "FIXED") {
      totalFixed += min.value;
      continue;
    }
    if (max?.type === "FLEX") {
      totalFlex += Math.max(0, max.value);
      continue;
    }
    if (min?.type === "FLEX") {
      totalFlex += Math.max(0, min.value);
      continue;
    }
    // AUTO / RESIZE_TO_FIT / unknown — reserves its intrinsic size.
    totalFixed += intrinsic;
  }
  if (totalFlex <= 0) { return 0; }
  return Math.max(0, available - totalFixed) / totalFlex;
}
