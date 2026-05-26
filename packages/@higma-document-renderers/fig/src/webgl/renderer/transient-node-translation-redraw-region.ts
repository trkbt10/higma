/** @file Redraw region for one transient SceneGraph node translation. */
import {
  boundsIntersect,
  boundsUnion,
  resolveRenderNodeOutputBoundsAffectedByTranslatedNode,
  type SceneGraphNodeTranslation,
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
