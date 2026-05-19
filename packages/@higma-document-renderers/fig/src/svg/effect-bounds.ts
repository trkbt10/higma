/**
 * @file Compute the export-time bounds expansion contributed by a node's
 * outward-extending effects.
 *
 * Figma's SVG exporter expands the exported viewBox so that DROP_SHADOW
 * blur/offset, FOREGROUND_BLUR and any spread reach
 * fully inside the document. The Event Card SYMBOL (362×296, DROP_SHADOW
 * radius=12 offset=(0,4)) exports as `viewBox="0 0 386 320"` with the
 * card BG positioned at `(12, 8)` — 12 px on the left/right, 8 px on
 * top, 16 px on the bottom. INNER_SHADOW and BACKGROUND_BLUR live
 * inside the node's bounds and contribute nothing to outward expansion.
 *
 * This module exposes a single function, `computeRootEffectExpansion`,
 * which returns the per-side padding a caller must add around a root
 * node's intrinsic bounds to mirror that behaviour. Callers can then
 * size the SVG viewBox and shift the root content inside it.
 *
 * This code reads raw `FigNode` data before the scene graph is built.
 * The same Kiwi document SoT is used by the WebGL and React backends
 * through their respective entry points.
 *
 * Notes on the per-effect semantics:
 *
 * - DROP_SHADOW: the shadow is the node's silhouette translated by
 *   `offset`, blurred by `radius`, and grown by `spread`. The shadow
 *   silhouette's bounding box therefore extends from `offset - radius
 *   - spread` to `offset + radius + spread` on each axis relative to
 *   the original node. The expansion this contributes is the part of
 *   that interval OUTSIDE the original bounds — capped at 0 (we never
 *   "shrink" the export when an effect lies entirely inside).
 *
 * - FOREGROUND_BLUR: the blur is applied to the node
 *   itself, expanding its visual silhouette by `radius` in every
 *   direction. No offset/spread.
 *
 * - INNER_SHADOW: lives entirely inside the silhouette by spec, no
 *   outward expansion.
 *
 * - BACKGROUND_BLUR: samples the backdrop from inside the node's
 *   shape; the node's outward bounds are unchanged.
 */

import type { FigEffect, FigEffectType, FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";

/**
 * Per-side padding (in user-space units) a caller must reserve around a
 * node's intrinsic bounds to fully contain the outward extent of every
 * visible outward-extending effect on that node.
 *
 * All four values are non-negative — `0` means "no extra padding on
 * that edge".
 */
export type EffectExpansion = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
};

const ZERO_EXPANSION: EffectExpansion = { left: 0, right: 0, top: 0, bottom: 0 };

function readEffectTypeName(type: FigEffect["type"] | undefined): FigEffectType | undefined {
  if (type === undefined) {
    return undefined;
  }
  if (typeof type === "string") {
    return type;
  }
  // Kiwi enum form: { value: number, name: string }
  const kiwi = type as KiwiEnumValue<FigEffectType>;
  return kiwi.name;
}

/**
 * Compute the outward expansion contributed by a single effect.
 *
 * Returns `ZERO_EXPANSION` for invisible effects, INNER_SHADOW,
 * BACKGROUND_BLUR, or unrecognised effect types.
 */
function expansionForEffect(effect: FigEffect): EffectExpansion {
  if (effect.visible === false) {
    return ZERO_EXPANSION;
  }
  const typeName = readEffectTypeName(effect.type);
  if (typeName === undefined) {
    return ZERO_EXPANSION;
  }
  const radius = effect.radius ?? 0;
  const spread = effect.spread ?? 0;
  const offsetX = effect.offset?.x ?? 0;
  const offsetY = effect.offset?.y ?? 0;

  switch (typeName) {
    case "DROP_SHADOW": {
      // Shadow rect extends from `offset - radius - spread` to
      // `offset + radius + spread` relative to the original node. The
      // expansion is the negative side flipped to positive (clamped to
      // 0 — a positive offset that exceeds the radius still draws the
      // shadow inside the bounds on the negative side).
      const halo = radius + spread;
      return {
        left: Math.max(0, halo - offsetX),
        right: Math.max(0, halo + offsetX),
        top: Math.max(0, halo - offsetY),
        bottom: Math.max(0, halo + offsetY),
      };
    }
    case "FOREGROUND_BLUR": {
      // Blur expands the node's silhouette equally on every side. No
      // offset/spread parameters apply.
      return { left: radius, right: radius, top: radius, bottom: radius };
    }
    case "INNER_SHADOW":
    case "BACKGROUND_BLUR":
      return ZERO_EXPANSION;
  }
}

/**
 * Combine two expansions by taking the per-side maximum. Used to merge
 * the contributions of multiple effects on the same node.
 */
function maxExpansion(a: EffectExpansion, b: EffectExpansion): EffectExpansion {
  return {
    left: Math.max(a.left, b.left),
    right: Math.max(a.right, b.right),
    top: Math.max(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/**
 * Compute the outward expansion contributed by ALL effects on a single
 * node. Multiple effects on the same node never compound — Figma renders
 * each effect at the same source silhouette — so taking the per-side
 * maximum reproduces the largest outward extent reached.
 */
export function computeNodeEffectExpansion(node: { readonly effects?: readonly FigEffect[] }): EffectExpansion {
  const effects = node.effects;
  if (!effects || effects.length === 0) {
    return ZERO_EXPANSION;
  }
  return effects.reduce<EffectExpansion>((acc, e) => maxExpansion(acc, expansionForEffect(e)), ZERO_EXPANSION);
}

/**
 * Compute the worst-case effect expansion across a list of root nodes
 * — the bounds the caller must reserve around the union of node bounds
 * so every effect lands inside the exported viewBox.
 *
 * Only effects on the supplied nodes themselves contribute; we do NOT
 * walk into children. Figma's exporter likewise reserves padding from
 * the canvas root's direct effect list, on the assumption that any
 * effect deeper in the tree is positioned within its own ancestor's
 * bounds (Figma compositing renders each effect against the node it
 * is attached to, not against the canvas root).
 */
export function computeRootEffectExpansion(nodes: readonly FigNode[]): EffectExpansion {
  return nodes.reduce<EffectExpansion>((acc, n) => maxExpansion(acc, computeNodeEffectExpansion(n)), ZERO_EXPANSION);
}
