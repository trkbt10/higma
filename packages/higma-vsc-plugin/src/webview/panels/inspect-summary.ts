/**
 * @file Aggregate statistics across a multi-node selection for the
 * Mixed inspect view.
 *
 * Figma's Mixed inspector follows a simple rule: numeric fields are
 * surfaced when every selected node agrees, and otherwise show the
 * literal "Mixed" label. Type breakdowns and color swatches are
 * surfaced as histograms — counts deduped by canonical key — so the
 * panel stays useful even when the selection is heterogeneous.
 *
 * The input is the *parallel* arrays of `FigDesignNode` and
 * `NodeBounds` already maintained by the viewer. They are kept aligned
 * (same length, same order) by `FigViewer`; this module assumes that
 * invariant rather than rebuilding the lookup itself.
 *
 * Hidden paints (`visible === false`) are excluded from color counts so
 * the summary mirrors what the canvas actually paints, matching the
 * single-node inspector's behaviour.
 */

import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { FigColor } from "@higma-document-models/fig/types";
import type { NodeBounds } from "../geometry/node-bounds";

export type SelectionUnionRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type MixedDimension =
  | { readonly kind: "uniform"; readonly value: number }
  | { readonly kind: "mixed"; readonly min: number; readonly max: number };

export type MixedTypeCount = {
  readonly type: FigDesignNode["type"];
  readonly count: number;
};

export type MixedColorCount = {
  readonly hex: string;
  readonly alpha: number;
  readonly count: number;
};

export type MixedSelectionSummary = {
  readonly count: number;
  readonly visibleCount: number;
  readonly hiddenCount: number;
  /** Per-type histogram, descending by count then alphabetical by type. */
  readonly typeCounts: readonly MixedTypeCount[];
  readonly width: MixedDimension;
  readonly height: MixedDimension;
  readonly opacity: MixedDimension;
  /** Top-left of the selection's union AABB in world coordinates. */
  readonly union: SelectionUnionRect;
  /** Solid fills surfaced as deduped hex+alpha buckets, descending by count. */
  readonly solidFills: readonly MixedColorCount[];
  readonly hasGradientFill: boolean;
  readonly hasImageFill: boolean;
};

export function summarizeMixedSelection(
  nodes: readonly FigDesignNode[],
  bounds: readonly NodeBounds[],
): MixedSelectionSummary {
  if (nodes.length !== bounds.length) {
    throw new Error(
      `summarizeMixedSelection: expected nodes.length === bounds.length but got ${nodes.length} vs ${bounds.length}`,
    );
  }
  const widths = nodes.map((node) => node.size.x);
  const heights = nodes.map((node) => node.size.y);
  const opacities = nodes.map((node) => node.opacity);

  const visibleCount = nodes.filter((n) => n.visible).length;

  const typeCounts = histogramTypes(nodes);
  const { union, hasUnion } = unionBounds(bounds);

  const fillStats = aggregateFills(nodes);

  return {
    count: nodes.length,
    visibleCount,
    hiddenCount: nodes.length - visibleCount,
    typeCounts,
    width: foldNumeric(widths),
    height: foldNumeric(heights),
    opacity: foldNumeric(opacities),
    union: hasUnion ? union : { x: 0, y: 0, width: 0, height: 0 },
    solidFills: fillStats.colors,
    hasGradientFill: fillStats.hasGradient,
    hasImageFill: fillStats.hasImage,
  };
}

function foldNumeric(values: readonly number[]): MixedDimension {
  if (values.length === 0) {
    return { kind: "uniform", value: 0 };
  }
  const seed = values[0] as number;
  const range = values.slice(1).reduce(
    (acc, value) => ({
      min: value < acc.min ? value : acc.min,
      max: value > acc.max ? value : acc.max,
    }),
    { min: seed, max: seed },
  );
  // Treat sub-pixel jitter as identical so a selection of two FRAMEs
  // whose widths differ by 1e-6 from float32→64 noise still reads as
  // a single value rather than "Mixed".
  if (Math.abs(range.max - range.min) <= 0.001) {
    return { kind: "uniform", value: seed };
  }
  return { kind: "mixed", min: range.min, max: range.max };
}

function histogramTypes(nodes: readonly FigDesignNode[]): readonly MixedTypeCount[] {
  const counts = new Map<FigDesignNode["type"], number>();
  for (const node of nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }
  const entries: MixedTypeCount[] = Array.from(counts, ([type, count]) => ({ type, count }));
  entries.sort((a, b) => {
    if (a.count !== b.count) {return b.count - a.count;}
    return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
  });
  return entries;
}

function unionBounds(bounds: readonly NodeBounds[]): {
  readonly union: SelectionUnionRect;
  readonly hasUnion: boolean;
} {
  if (bounds.length === 0) {
    return { union: { x: 0, y: 0, width: 0, height: 0 }, hasUnion: false };
  }
  const seed = bounds[0] as NodeBounds;
  const aabb = bounds.slice(1).reduce(
    (acc, b) => ({
      minX: b.x < acc.minX ? b.x : acc.minX,
      minY: b.y < acc.minY ? b.y : acc.minY,
      maxX: b.x + b.width > acc.maxX ? b.x + b.width : acc.maxX,
      maxY: b.y + b.height > acc.maxY ? b.y + b.height : acc.maxY,
    }),
    { minX: seed.x, minY: seed.y, maxX: seed.x + seed.width, maxY: seed.y + seed.height },
  );
  return {
    union: {
      x: aabb.minX,
      y: aabb.minY,
      width: aabb.maxX - aabb.minX,
      height: aabb.maxY - aabb.minY,
    },
    hasUnion: true,
  };
}

function aggregateFills(nodes: readonly FigDesignNode[]): {
  readonly colors: readonly MixedColorCount[];
  readonly hasGradient: boolean;
  readonly hasImage: boolean;
} {
  const buckets = new Map<string, { hex: string; alpha: number; count: number }>();
  const flags = { hasGradient: false, hasImage: false };
  for (const node of nodes) {
    for (const paint of node.fills) {
      if (paint.visible === false) {continue;}
      if (paint.type === "SOLID") {
        const hex = colorToHex(paint.color);
        const alpha = combineOpacity(paint.color.a, paint.opacity);
        bumpBucket(buckets, hex, alpha);
        continue;
      }
      if (paint.type === "IMAGE") {
        flags.hasImage = true;
        continue;
      }
      flags.hasGradient = true;
    }
  }
  const colors = Array.from(buckets.values()).sort(compareColorBuckets);
  return { colors, hasGradient: flags.hasGradient, hasImage: flags.hasImage };
}

function bumpBucket(
  buckets: Map<string, { hex: string; alpha: number; count: number }>,
  hex: string,
  alpha: number,
): void {
  const key = `${hex}|${alpha.toFixed(3)}`;
  const existing = buckets.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  buckets.set(key, { hex, alpha, count: 1 });
}

function compareColorBuckets(
  a: { readonly hex: string; readonly count: number },
  b: { readonly hex: string; readonly count: number },
): number {
  if (a.count !== b.count) {return b.count - a.count;}
  if (a.hex < b.hex) {return -1;}
  if (a.hex > b.hex) {return 1;}
  return 0;
}

function colorToHex(color: FigColor): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function combineOpacity(colorAlpha: number, paintOpacity: number | undefined): number {
  const base = Number.isFinite(colorAlpha) ? colorAlpha : 1;
  const factor = paintOpacity === undefined ? 1 : paintOpacity;
  return Math.max(0, Math.min(1, base * factor));
}

