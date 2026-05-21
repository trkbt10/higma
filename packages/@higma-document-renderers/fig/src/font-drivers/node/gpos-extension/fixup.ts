/**
 * @file Apply GPOS Extension Positioning fixup to an opentype.js Font.
 *
 * opentype.js 1.3.x leaves every `LookupType 9` (Extension Positioning)
 * subtable as `{error: "GPOS Lookup 9 not supported"}` and never follows
 * the wrapper's `extensionOffset`. Modern macOS system fonts (SFNS, SF
 * Compact) wire their `kern` feature through a single LookupType 9
 * lookup, so `font.getKerningValue(left, right)` returns 0 for every
 * pair on those fonts even though the on-disk GPOS table carries the
 * full pair-adjustment data. This module re-reads each affected lookup
 * from the raw font bytes and overwrites the parsed structure in place
 * so `Position.getKerningValue` consumes the resolved Pair Adjustment
 * subtables directly.
 *
 * After mutation the function refreshes `font.position.defaultKerningTables`,
 * which opentype.js caches at parse time via a `lookupType === 2` filter:
 * a lookup whose stored `lookupType` was 9 at parse time would otherwise
 * remain invisible to the kerning resolver no matter what we put inside it.
 *
 * Fail-fast policy (AGENTS.md):
 *   - When a `kern`-feature lookup is an Extension whose
 *     `extensionLookupType` is anything other than 2 (Pair Adjustment) we
 *     throw. A `kern` feature pointing at a non-pair-adjustment lookup is
 *     a font bug; silently leaving it at zero kerning would mask it.
 *   - When a single Extension lookup mixes different `extensionLookupType`
 *     values across its subtables we throw. The OpenType spec allows it
 *     in principle but no real font ships that way and reconciling
 *     multi-type subtables under a single `lookupType` slot is not
 *     representable in opentype.js's data model.
 *   - When the buffer is truncated or any offset overruns the GPOS
 *     table we throw — raw-reader.ts surfaces those errors.
 * Lookups that are not LookupType 9 are left untouched. Lookups that
 * are LookupType 9 but are not reachable from the `kern` feature are
 * also left untouched — there is no path to silently corrupting
 * non-kerning GPOS lookups by this fixup.
 */

import type { PairAdjustmentSubtable } from "./subtable-parser";
import { parsePairAdjustmentSubtable } from "./subtable-parser";
import {
  locateGposTable,
  readLookupLocations,
  type GposTableLocation,
  type LookupLocation,
} from "./raw-reader";
import { extractWoffGpos, isWoff } from "./woff-reader";

/**
 * The slice of an opentype.js Font we need to mutate. The renderer's
 * `AbstractFont` deliberately does not surface GPOS internals, so this
 * shape is defined locally — the alternative is to import opentype.js's
 * types and leak them across the renderer boundary.
 */
type GposLookup = {
  lookupType: number;
  lookupFlag: number;
  subtables: readonly unknown[];
  markFilteringSet?: number | undefined;
};

type GposTable = {
  readonly version: number;
  readonly features: readonly {
    readonly tag: string;
    readonly feature: { readonly lookupListIndexes: readonly number[] };
  }[];
  lookups: GposLookup[];
};

type PositionApi = {
  /**
   * Recomputes `defaultKerningTables` against the current `tables.gpos`
   * lookups. opentype.js calls this once during Font construction; after
   * we mutate the lookups we need to re-run it so the kerning resolver
   * sees the Extension-resolved data.
   */
  init?(): void;
  defaultKerningTables?: unknown;
};

type FontWithGpos = {
  readonly tables?: {
    readonly gpos?: GposTable;
  } | undefined;
  readonly position?: PositionApi;
};

const EXTENSION_LOOKUP_TYPE = 9;
const PAIR_ADJUSTMENT_LOOKUP_TYPE = 2;

/**
 * Mutate `font` so every kerning-relevant LookupType 9 lookup is
 * rewritten in place to its resolved Pair Adjustment form. Safe to call
 * on fonts that don't need it — when there is no GPOS table, no
 * Extension-wrapped lookup, or no `kern` feature, the function returns
 * `false` without touching the font. Returns `true` when at least one
 * lookup was rewritten.
 *
 * `fontBytes` MUST be the same buffer that produced `font` via
 * `opentype.parse`; otherwise byte offsets won't line up and the
 * rewrites will silently produce garbage data. The caller (node-loader)
 * holds both references at parse time, so wiring this through is
 * straightforward.
 */
export function applyGposExtensionFixup(font: unknown, fontBytes: ArrayBuffer): boolean {
  const shape = font as FontWithGpos;
  const gpos = shape.tables?.gpos;
  if (!gpos) {
    return false;
  }
  const kernLookupIndexes = collectKernLookupIndexes(gpos);
  if (kernLookupIndexes.length === 0) {
    return false;
  }
  const needsRewrite = kernLookupIndexes.some(
    (idx) => gpos.lookups[idx]?.lookupType === EXTENSION_LOOKUP_TYPE,
  );
  if (!needsRewrite) {
    return false;
  }
  const gposView = resolveGposView(fontBytes);
  if (!gposView) {
    // Buffer is a wrapper format we don't decode (notably WOFF2,
    // which opentype.js itself also can't parse — the loader refuses
    // these upstream). The fixup walks raw GPOS bytes and cannot
    // operate without them; surface the skip rather than fabricate a
    // wrong rewrite.
    return false;
  }
  const lookupLocations = readLookupLocations(gposView.view, gposView.location);
  if (lookupLocations.length !== gpos.lookups.length) {
    throw new Error(
      `applyGposExtensionFixup: parsed lookup count ${gpos.lookups.length} differs from raw lookup count ${lookupLocations.length}`,
    );
  }
  // Mutate only the lookups the `kern` feature points at. Other
  // Extension-wrapped lookups (if any) belong to unrelated GPOS features
  // and the renderer doesn't consume them; rewriting them would add
  // surface area without value and risk hitting an extensionLookupType
  // the parser doesn't support.
  for (const lookupIndex of kernLookupIndexes) {
    const parsedLookup = gpos.lookups[lookupIndex];
    if (!parsedLookup || parsedLookup.lookupType !== EXTENSION_LOOKUP_TYPE) {
      continue;
    }
    rewriteExtensionLookup(gposView.view, lookupLocations[lookupIndex]!, parsedLookup);
  }
  // Refresh the cached kerning lookup list. `Position.init` re-evaluates
  // the script-and-feature filter against the now-mutated lookups; if
  // we skip this step `font.getKerningValue` keeps returning zero
  // because its cache still reflects the pre-fixup `lookupType === 9`
  // entry that the filter rejected.
  shape.position?.init?.();
  return true;
}

function collectKernLookupIndexes(gpos: GposTable): readonly number[] {
  const indexes = new Set<number>();
  for (const featureRecord of gpos.features) {
    if (featureRecord.tag !== "kern") {
      continue;
    }
    for (const lookupIndex of featureRecord.feature.lookupListIndexes) {
      indexes.add(lookupIndex);
    }
  }
  return [...indexes];
}

function rewriteExtensionLookup(
  view: DataView,
  location: LookupLocation,
  parsedLookup: GposLookup,
): void {
  if (location.subtableOffsets.length !== parsedLookup.subtables.length) {
    throw new Error(
      `rewriteExtensionLookup: parsed subtable count ${parsedLookup.subtables.length} differs from raw subtable count ${location.subtableOffsets.length}`,
    );
  }
  const resolved = location.subtableOffsets.map((subtableOffset) =>
    resolveExtensionSubtable(view, subtableOffset),
  );
  const distinctTypes = new Set(resolved.map((entry) => entry.extensionLookupType));
  if (distinctTypes.size !== 1) {
    throw new Error(
      `rewriteExtensionLookup: Extension lookup at 0x${location.start.toString(16)} mixes extensionLookupType values (${[...distinctTypes].join(", ")}); not supported`,
    );
  }
  const extensionLookupType = resolved[0]!.extensionLookupType;
  if (extensionLookupType !== PAIR_ADJUSTMENT_LOOKUP_TYPE) {
    throw new Error(
      `rewriteExtensionLookup: kern feature points at Extension lookup with extensionLookupType=${extensionLookupType}; only Pair Adjustment (type 2) is supported`,
    );
  }
  // Mutate in place. `font.tables.gpos.lookups` is the live array the
  // resolver reads — replacing the slot would be safe too but mutating
  // matches opentype.js's own convention of treating parsed tables as a
  // mutable cache. `Position.init` will pick up the new shape.
  parsedLookup.lookupType = PAIR_ADJUSTMENT_LOOKUP_TYPE;
  parsedLookup.subtables = resolved.map((entry) => entry.subtable);
}

type ResolvedSubtable = {
  readonly extensionLookupType: number;
  readonly subtable: PairAdjustmentSubtable;
};

type GposView = {
  /** DataView the fixup walks for GPOS table contents. */
  readonly view: DataView;
  /** Location of the GPOS table within `view`. For an sfnt buffer
   * this is the absolute offset / length recorded in the sfnt
   * directory; for a WOFF buffer this points at the freshly-inflated
   * GPOS payload, which starts at offset 0 of its own ArrayBuffer. */
  readonly location: GposTableLocation;
};

/**
 * Produce a `(DataView, GposTableLocation)` pair the fixup can walk,
 * regardless of whether the supplied buffer is a raw sfnt or a WOFF
 * wrapper.
 *
 * sfnt (.ttf / .otf): the buffer already carries the table directory
 * the fixup needs; `locateGposTable` finds the GPOS table by tag.
 *
 * WOFF (.woff): the table directory in the wrapped buffer points at
 * zlib-deflated table bodies whose offsets bear no relation to what
 * opentype.js parsed in memory. We pull the GPOS body out via
 * `extractWoffGpos`, inflate it, and return a synthetic location at
 * offset 0 — that lets `readLookupLocations` walk the GPOS LookupList
 * exactly the same way it would for a raw sfnt.
 *
 * Returns `undefined` for buffers we cannot navigate (notably WOFF2,
 * which opentype.js itself refuses upstream — the renderer's loader
 * throws on `.woff2` add). The fixup then takes the early-skip path.
 */
function resolveGposView(fontBytes: ArrayBuffer): GposView | undefined {
  const fullView = new DataView(fontBytes);
  if (hasSfntMagic(fullView)) {
    const location = locateGposTable(fullView);
    assertGposLocation(location, "sfnt");
    return { view: fullView, location };
  }
  if (isWoff(fullView)) {
    const extracted = extractWoffGpos(fullView);
    assertWoffGpos(extracted);
    const gposView = new DataView(extracted.gposBytes);
    return {
      view: gposView,
      location: { offset: 0, length: gposView.byteLength },
    };
  }
  return undefined;
}

function assertGposLocation(
  location: GposTableLocation | undefined,
  source: "sfnt",
): asserts location is GposTableLocation {
  if (location !== undefined) {
    return;
  }
  throw new Error(
    `resolveGposView: font.tables.gpos exists but the supplied ${source} buffer has no GPOS table record — fontBytes likely does not match the parsed font`,
  );
}

function assertWoffGpos(
  extracted: { readonly gposBytes: ArrayBuffer } | undefined,
): asserts extracted is { readonly gposBytes: ArrayBuffer } {
  if (extracted !== undefined) {
    return;
  }
  throw new Error(
    "resolveGposView: font.tables.gpos exists but the supplied WOFF has no GPOS table record — fontBytes likely does not match the parsed font",
  );
}

/**
 * Detect whether `view` starts with a recognisable sfnt magic. The
 * OpenType spec lists exactly three: `0x00010000` (TrueType), `OTTO`
 * (CFF / OpenType), and `true` (legacy Mac TrueType). Anything else
 * is a wrapped container (WOFF, WOFF2, ttcf, …).
 */
function hasSfntMagic(view: DataView): boolean {
  if (view.byteLength < 4) {
    return false;
  }
  const magic = view.getUint32(0, false);
  // 0x00010000 = TrueType; 0x4F54544F = "OTTO"; 0x74727565 = "true".
  return magic === 0x00010000 || magic === 0x4f54544f || magic === 0x74727565;
}

function resolveExtensionSubtable(view: DataView, subtableStart: number): ResolvedSubtable {
  // Extension Positioning subtable header:
  //   uint16   posFormat            (must be 1)
  //   uint16   extensionLookupType  (real lookup type; never 9)
  //   Offset32 extensionOffset      (relative to start of this subtable)
  const posFormat = view.getUint16(subtableStart, false);
  if (posFormat !== 1) {
    throw new Error(
      `resolveExtensionSubtable: Extension subtable at 0x${subtableStart.toString(16)} has unexpected posFormat ${posFormat}`,
    );
  }
  const extensionLookupType = view.getUint16(subtableStart + 2, false);
  if (extensionLookupType === EXTENSION_LOOKUP_TYPE) {
    throw new Error(
      `resolveExtensionSubtable: Extension subtable at 0x${subtableStart.toString(16)} points to LookupType 9 (recursive Extension); not permitted by spec`,
    );
  }
  const extensionOffset = view.getUint32(subtableStart + 4, false);
  const realSubtableStart = subtableStart + extensionOffset;
  const subtable = parsePairAdjustmentSubtable(view, realSubtableStart);
  return { extensionLookupType, subtable };
}
