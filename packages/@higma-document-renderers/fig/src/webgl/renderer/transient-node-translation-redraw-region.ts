/** @file Redraw region for one transient SceneGraph node translation. */
import {
  boundsIntersect,
  boundsUnion,
  resolveRenderNodeOutputBoundsAffectedByTranslatedNode,
  type RenderNodeTranslatedOutputBounds,
  type SceneGraphNodeTranslation,
  type SceneNodeId,
  type Bounds,
  type ViewportRect,
} from "@higma-document-renderers/fig/scene-graph";
import type { AffineMatrix } from "@higma-primitives/path";
import type { RenderNode } from "../../scene-graph";

export type TransientNodeTranslationRedrawRegionInput = {
  readonly children: readonly RenderNode[];
  readonly viewportTransform: AffineMatrix;
  readonly viewport: ViewportRect;
  readonly translation: SceneGraphNodeTranslation;
};

export type TransientNodeTranslationRedrawRegion = {
  readonly nodeId: string;
  readonly oldBounds: Bounds;
  readonly translatedBounds: Bounds;
  readonly redrawBounds: Bounds;
  readonly redrawViewport: ViewportRect;
};

function viewportBounds(viewport: ViewportRect): Bounds {
  return {
    minX: viewport.x,
    minY: viewport.y,
    maxX: viewport.x + viewport.width,
    maxY: viewport.y + viewport.height,
  };
}

function intersectBounds(left: Bounds, right: Bounds): Bounds | null {
  const minX = Math.max(left.minX, right.minX);
  const minY = Math.max(left.minY, right.minY);
  const maxX = Math.min(left.maxX, right.maxX);
  const maxY = Math.min(left.maxY, right.maxY);
  if (maxX <= minX || maxY <= minY) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

function boundsToViewportRect(bounds: Bounds): ViewportRect {
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

function transientNodeTranslationRedrawRegionBounds(
  region: TransientNodeTranslationRedrawRegion | null,
): readonly Bounds[] {
  if (region === null) {
    return [];
  }
  return [region.redrawBounds];
}

/** Resolve the current redraw viewport, including the previous preview pixels that must be restored. */
export function resolveTransientNodeTranslationRedrawViewport({
  current,
  previous,
}: {
  readonly current: TransientNodeTranslationRedrawRegion | null;
  readonly previous: TransientNodeTranslationRedrawRegion | null;
}): ViewportRect | null {
  const regions = [
    ...transientNodeTranslationRedrawRegionBounds(current),
    ...transientNodeTranslationRedrawRegionBounds(previous),
  ];
  if (regions.length === 0) {
    return null;
  }
  return boundsToViewportRect(regions.reduce(boundsUnion));
}

export type ContentEditRedrawRegion = {
  /** Null when the changed nodes are entirely off-screen (cached frame already correct). */
  readonly redrawViewport: ViewportRect | null;
};

function affectedOutputBoundsList(affected: RenderNodeTranslatedOutputBounds): readonly Bounds[] {
  return [
    affected.previousTargetOutputBounds,
    affected.translatedTargetOutputBounds,
    ...affected.ancestorCompositedOutputBounds,
    ...affected.backdropDependentOutputBounds,
  ];
}

/**
 * Resolve the on-screen region that must be repainted after one or more nodes'
 * content changed in place (a committed edit). Reuses the translated-node
 * coverage SoT with a zero displacement: `previous`/`translated` target bounds
 * collapse to the node's current output bounds, while the ancestor-composited
 * and backdrop-dependent bounds (effects, group opacity, blend, background blur,
 * masks) are still included so anything whose pixels depend on the changed node
 * is repainted. Bounds are unioned across the previous and current render trees
 * so a bounds-changing edit (resize) does not leave stale pixels.
 *
 * Returns `null` when the region cannot be determined safely (a changed node is
 * absent from either tree — added/removed), so the caller falls back to a full
 * settled render.
 */
export function resolveContentEditRedrawRegion({
  previousChildren,
  currentChildren,
  changedNodeIds,
  viewportTransform,
  viewport,
}: {
  readonly previousChildren: readonly RenderNode[];
  readonly currentChildren: readonly RenderNode[];
  readonly changedNodeIds: readonly SceneNodeId[];
  readonly viewportTransform: AffineMatrix;
  readonly viewport: ViewportRect;
}): ContentEditRedrawRegion | null {
  if (changedNodeIds.length === 0) {
    return null;
  }
  const collected: Bounds[] = [];
  for (const nodeId of changedNodeIds) {
    const translation: SceneGraphNodeTranslation = { nodeId, dx: 0, dy: 0 };
    const previous = resolveRenderNodeOutputBoundsAffectedByTranslatedNode({
      children: previousChildren,
      outputTransform: viewportTransform,
      translation,
    });
    const current = resolveRenderNodeOutputBoundsAffectedByTranslatedNode({
      children: currentChildren,
      outputTransform: viewportTransform,
      translation,
    });
    if (previous === null || current === null) {
      return null;
    }
    collected.push(...affectedOutputBoundsList(previous), ...affectedOutputBoundsList(current));
  }
  if (collected.length === 0) {
    return null;
  }
  const totalBounds = collected.reduce(boundsUnion);
  const visibleBounds = viewportBounds(viewport);
  if (!boundsIntersect(totalBounds, visibleBounds)) {
    return { redrawViewport: null };
  }
  const clippedRedrawBounds = intersectBounds(totalBounds, visibleBounds);
  if (clippedRedrawBounds === null) {
    throw new Error("Content edit redraw region lost viewport intersection after boundsIntersect");
  }
  return { redrawViewport: boundsToViewportRect(clippedRedrawBounds) };
}

/** Resolve the redraw region affected by one transient node translation. */
export function resolveTransientNodeTranslationRedrawRegion({
  children,
  viewportTransform,
  viewport,
  translation,
}: TransientNodeTranslationRedrawRegionInput): TransientNodeTranslationRedrawRegion | null {
  const translatedBounds = resolveRenderNodeOutputBoundsAffectedByTranslatedNode({
    children,
    outputTransform: viewportTransform,
    translation,
  });
  if (translatedBounds === null) {
    return null;
  }
  const oldBounds = translatedBounds.previousTargetOutputBounds;
  const targetBounds = translatedBounds.translatedTargetOutputBounds;
  if (oldBounds === undefined || targetBounds === undefined) {
    throw new Error(`Transient node translation redraw region lost target bounds for node ${translation.nodeId}`);
  }
  const redrawBounds = [
    targetBounds,
    ...translatedBounds.ancestorCompositedOutputBounds,
    ...translatedBounds.backdropDependentOutputBounds,
  ].reduce(boundsUnion, oldBounds);
  const visibleBounds = viewportBounds(viewport);
  if (!boundsIntersect(redrawBounds, visibleBounds)) {
    return null;
  }
  const clippedRedrawBounds = intersectBounds(redrawBounds, visibleBounds);
  if (clippedRedrawBounds === null) {
    throw new Error(`Transient node translation redraw region lost viewport intersection for node ${translation.nodeId}`);
  }
  return {
    nodeId: translatedBounds.targetNode.id,
    oldBounds,
    translatedBounds: targetBounds,
    redrawBounds: clippedRedrawBounds,
    redrawViewport: boundsToViewportRect(clippedRedrawBounds),
  };
}
