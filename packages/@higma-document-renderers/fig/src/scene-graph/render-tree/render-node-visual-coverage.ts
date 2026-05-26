/** @file RenderNode visual coverage and viewport intersection checks for every RenderTree consumer. */
/* eslint-disable jsdoc/require-jsdoc -- Exported functions form the RenderTree visibility contract and are covered by colocated specs. */

import {
  resolveEffectBounds,
} from "../render";
import {
  translateSceneNodeTransform,
  type SceneGraphNodeTranslation,
} from "../translate-scene-node";
import { multiplyMatrices } from "@higma-document-models/fig/matrix";
import type {
  ClipShape,
  PathContour,
  Stroke,
} from "../model";
import type {
  RenderFrameNode,
  RenderGroupNode,
  RenderNode,
} from "./types";
import { pathContoursBoundingBox } from "@higma-primitives/path";
import type { AffineMatrix, CornerRadius } from "@higma-primitives/path";

export type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type ViewportIntersectionOptions = {
  readonly paddingPx?: number;
  readonly minPixelArea?: number;
};

export type ViewportRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type RenderNodeVisualTransform =
  | { readonly type: "source-transforms" }
  | { readonly type: "scene-graph-node-translation"; readonly translation: SceneGraphNodeTranslation };

export type RenderNodeTranslatedOutputBounds = {
  readonly targetNode: RenderNode;
  readonly previousTargetOutputBounds: Bounds;
  readonly translatedTargetOutputBounds: Bounds;
  readonly ancestorCompositedOutputBounds: readonly Bounds[];
  readonly backdropDependentOutputBounds: readonly Bounds[];
};

export const RENDER_NODE_SOURCE_TRANSFORMS: RenderNodeVisualTransform = Object.freeze({
  type: "source-transforms",
});

type CornerRadii = {
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomRight: number;
  readonly bottomLeft: number;
};

type IndividualStrokeWeights = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

export function renderNodeIntersectsViewport({
  node,
  transform,
  viewport,
  visualTransform,
  options,
}: {
  readonly node: RenderNode;
  readonly transform: AffineMatrix;
  readonly viewport: ViewportRect;
  readonly visualTransform: RenderNodeVisualTransform;
  readonly options?: ViewportIntersectionOptions;
}): boolean {
  const visualBounds = resolveRenderNodeLocalSubtreeVisualBounds({ node, visualTransform });
  if (!visualBounds) {
    return true;
  }
  const screenBounds = transformBounds(visualBounds, transform);
  if (!boundsIntersect(screenBounds, expandViewport(viewport, options?.paddingPx ?? 0))) {
    return false;
  }
  return isLargeEnoughForExplicitPixelArea({
    screenBounds,
    minPixelArea: options?.minPixelArea,
  });
}

/**
 * Per-frame pan/zoom rerenders pass the same `RenderNode` instances
 * when the caller preserves the RenderTree content objects across
 * viewport-only updates and only swaps the surrounding viewport rect.
 * Local bounds are derived from immutable node fields, so a WeakMap
 * keyed on the node is a sound cross-frame cache — entries are released
 * automatically when the render tree drops the node.
 */
const localBoundsCache = new WeakMap<RenderNode, Bounds | null>();
const localAuthoredBoundsCache = new WeakMap<RenderNode, Bounds | null>();
const localFrameChildClipBoundsCache = new WeakMap<RenderNode, Bounds | null>();
const localSourceEffectInputBoundsCache = new WeakMap<RenderNode, Bounds | null>();
const localFrameSurfaceFilterInputBoundsCache = new WeakMap<RenderFrameNode, Bounds | null>();
const localSubtreeVisualBoundsCache = new WeakMap<RenderNode, Bounds | null>();
const inheritedContainerOpacityCache = new WeakMap<RenderGroupNode | RenderFrameNode, boolean>();

export function getRenderNodeLocalBounds(node: RenderNode): Bounds | null {
  const cached = localBoundsCache.get(node);
  if (cached !== undefined) {
    return cached;
  }
  const bounds = computeRenderNodeLocalBounds(node);
  localBoundsCache.set(node, bounds);
  return bounds;
}

export function getRenderNodeLocalAuthoredBounds(node: RenderNode): Bounds | null {
  const cached = localAuthoredBoundsCache.get(node);
  if (cached !== undefined) {
    return cached;
  }
  const bounds = computeRenderNodeLocalAuthoredBounds(node);
  localAuthoredBoundsCache.set(node, bounds);
  return bounds;
}

export function getRenderNodeLocalFrameChildClipBounds(node: RenderNode): Bounds | null {
  const cached = localFrameChildClipBoundsCache.get(node);
  if (cached !== undefined) {
    return cached;
  }
  const bounds = computeRenderNodeLocalFrameChildClipBounds(node);
  localFrameChildClipBoundsCache.set(node, bounds);
  return bounds;
}

function getRenderNodeLocalSourceEffectInputBounds(node: RenderNode): Bounds | null {
  const cached = localSourceEffectInputBoundsCache.get(node);
  if (cached !== undefined) {
    return cached;
  }
  const bounds = computeRenderNodeLocalSourceEffectInputBounds(node);
  localSourceEffectInputBoundsCache.set(node, bounds);
  return bounds;
}

export function getRenderFrameLocalSurfaceFilterInputBounds(node: RenderFrameNode): Bounds | null {
  const cached = localFrameSurfaceFilterInputBoundsCache.get(node);
  if (cached !== undefined) {
    return cached;
  }
  const bounds = computeRenderFrameLocalSurfaceFilterInputBounds(node);
  localFrameSurfaceFilterInputBoundsCache.set(node, bounds);
  return bounds;
}

function getRenderNodeLocalSubtreeVisualBounds(node: RenderNode): Bounds | null {
  const cached = localSubtreeVisualBoundsCache.get(node);
  if (cached !== undefined) {
    return cached;
  }
  const bounds = computeRenderNodeLocalSubtreeVisualBounds(node);
  localSubtreeVisualBoundsCache.set(node, bounds);
  return bounds;
}

export function resolveRenderNodeLocalSourceEffectInputBounds({
  node,
  visualTransform,
}: {
  readonly node: RenderNode;
  readonly visualTransform: RenderNodeVisualTransform;
}): Bounds | null {
  if (visualTransform.type === "source-transforms") {
    return getRenderNodeLocalSourceEffectInputBounds(node);
  }
  return computeRenderNodeLocalSourceEffectInputBoundsForVisualTransform({ node, visualTransform });
}

export function resolveRenderNodeLocalSubtreeVisualBounds({
  node,
  visualTransform,
}: {
  readonly node: RenderNode;
  readonly visualTransform: RenderNodeVisualTransform;
}): Bounds | null {
  if (visualTransform.type === "source-transforms") {
    return getRenderNodeLocalSubtreeVisualBounds(node);
  }
  return computeRenderNodeLocalSubtreeVisualBoundsForVisualTransform({ node, visualTransform });
}

export function resolveRenderNodeOutputBoundsAffectedByTranslatedNode({
  children,
  outputTransform,
  translation,
}: {
  readonly children: readonly RenderNode[];
  readonly outputTransform: AffineMatrix;
  readonly translation: SceneGraphNodeTranslation;
}): RenderNodeTranslatedOutputBounds | null {
  return children.reduce<RenderNodeTranslatedOutputBounds | null>((result, child) => {
    if (result !== null) {
      return result;
    }
    return findRenderNodeOutputBoundsAffectedByTranslatedNode(child, outputTransform, outputTransform, translation) ?? null;
  }, null);
}

/** Return true when a container opacity can be pushed to descendants without changing compositing. */
export function canRenderContainerOpacityWithInheritedOpacity({
  node,
  visualTransform,
}: {
  readonly node: RenderGroupNode | RenderFrameNode;
  readonly visualTransform: RenderNodeVisualTransform;
}): boolean {
  if (visualTransform.type !== "source-transforms") {
    return computeCanRenderContainerOpacityWithInheritedOpacity({ node, visualTransform });
  }
  const cached = inheritedContainerOpacityCache.get(node);
  if (cached !== undefined) {
    return cached;
  }
  const result = computeCanRenderContainerOpacityWithInheritedOpacity({ node, visualTransform });
  inheritedContainerOpacityCache.set(node, result);
  return result;
}

export function canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary({
  node,
  visualTransform,
}: {
  readonly node: RenderFrameNode;
  readonly visualTransform: RenderNodeVisualTransform;
}): boolean {
  if (node.childClipId === undefined) {
    return false;
  }
  const sourceSurfaceShape = node.sourceSurfaceShape;
  if (sourceSurfaceShape.type !== "rect") {
    return false;
  }
  if (cornerSmoothingHasPositiveValue(sourceSurfaceShape.cornerSmoothing)) {
    return false;
  }
  const frameBounds = rectBounds({
    x: 0,
    y: 0,
    width: sourceSurfaceShape.width,
    height: sourceSurfaceShape.height,
  });
  return node.children.every((child) => transformedChildSubtreeVisualBoundsAreContained({
    child,
    containerBounds: frameBounds,
    cornerRadius: sourceSurfaceShape.cornerRadius,
    visualTransform,
  }));
}

function computeCanRenderContainerOpacityWithInheritedOpacity({
  node,
  visualTransform,
}: {
  readonly node: RenderGroupNode | RenderFrameNode;
  readonly visualTransform: RenderNodeVisualTransform;
}): boolean {
  if (containerOwnRenderingRequiresOpacityIsolation(node)) {
    return false;
  }
  if (renderNodeChildren(node).some(subtreeRequiresBackdropIsolation)) {
    return false;
  }
  return !transformedChildVisualBoundsOverlap(renderNodeChildren(node), visualTransform);
}

function findRenderNodeOutputBoundsAffectedByTranslatedNode(
  node: RenderNode,
  previousParentOutputTransform: AffineMatrix,
  translatedParentOutputTransform: AffineMatrix,
  translation: SceneGraphNodeTranslation,
): RenderNodeTranslatedOutputBounds | undefined {
  const nodeTransform = childTransformForVisualTransform({
    node,
    visualTransform: { type: "scene-graph-node-translation", translation },
  });
  const previousOutputTransform = multiplyMatrices(previousParentOutputTransform, node.source.transform);
  const translatedOutputTransform = multiplyMatrices(translatedParentOutputTransform, nodeTransform);
  if (node.id === translation.nodeId) {
    return targetRenderNodeOutputBoundsAffectedByTranslation({ node, previousOutputTransform, translatedOutputTransform });
  }
  const children = renderNodeChildren(node);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const childResult = findRenderNodeOutputBoundsAffectedByTranslatedNode(child, previousOutputTransform, translatedOutputTransform, translation);
    if (childResult === undefined) {
      continue;
    }
    const followingSiblingBackdropDependencies = backdropDependentOutputBoundsAffectedByPreviousSiblingTranslation({
      siblings: children.slice(index + 1),
      parentOutputTransform: previousOutputTransform,
      childResult,
    });
    return ancestorRenderNodeOutputBoundsAffectedByTranslatedDescendant({
      node,
      previousOutputTransform,
      translatedOutputTransform,
      translation,
      childResult: {
        ...childResult,
        backdropDependentOutputBounds: [
          ...childResult.backdropDependentOutputBounds,
          ...followingSiblingBackdropDependencies,
        ],
      },
    });
  }
  return undefined;
}

function targetRenderNodeOutputBoundsAffectedByTranslation({
  node,
  previousOutputTransform,
  translatedOutputTransform,
}: {
  readonly node: RenderNode;
  readonly previousOutputTransform: AffineMatrix;
  readonly translatedOutputTransform: AffineMatrix;
}): RenderNodeTranslatedOutputBounds | undefined {
  const localBounds = resolveRenderNodeLocalSubtreeVisualBounds({
    node,
    visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
  });
  if (localBounds === null) {
    return undefined;
  }
  return {
    targetNode: node,
    previousTargetOutputBounds: transformBounds(localBounds, previousOutputTransform),
    translatedTargetOutputBounds: transformBounds(localBounds, translatedOutputTransform),
    ancestorCompositedOutputBounds: [],
    backdropDependentOutputBounds: [],
  };
}

function ancestorRenderNodeOutputBoundsAffectedByTranslatedDescendant({
  node,
  previousOutputTransform,
  translatedOutputTransform,
  translation,
  childResult,
}: {
  readonly node: RenderNode;
  readonly previousOutputTransform: AffineMatrix;
  readonly translatedOutputTransform: AffineMatrix;
  readonly translation: SceneGraphNodeTranslation;
  readonly childResult: RenderNodeTranslatedOutputBounds;
}): RenderNodeTranslatedOutputBounds {
  return {
    targetNode: childResult.targetNode,
    previousTargetOutputBounds: childResult.previousTargetOutputBounds,
    translatedTargetOutputBounds: childResult.translatedTargetOutputBounds,
    ancestorCompositedOutputBounds: [
      ...childResult.ancestorCompositedOutputBounds,
      ...ancestorCompositedOutputBoundsAffectedByTranslatedDescendant({
        node,
        previousOutputTransform,
        translatedOutputTransform,
        translation,
      }),
    ],
    backdropDependentOutputBounds: childResult.backdropDependentOutputBounds,
  };
}

function backdropDependentOutputBoundsAffectedByPreviousSiblingTranslation({
  siblings,
  parentOutputTransform,
  childResult,
}: {
  readonly siblings: readonly RenderNode[];
  readonly parentOutputTransform: AffineMatrix;
  readonly childResult: RenderNodeTranslatedOutputBounds;
}): readonly Bounds[] {
  return siblings.flatMap((sibling) => backdropDependentOutputBoundsAffectedByOutputBounds({
    node: sibling,
    parentOutputTransform,
    dependencyPreviousOutputBounds: childResult.previousTargetOutputBounds,
    dependencyTranslatedOutputBounds: childResult.translatedTargetOutputBounds,
  }));
}

function backdropDependentOutputBoundsAffectedByOutputBounds({
  node,
  parentOutputTransform,
  dependencyPreviousOutputBounds,
  dependencyTranslatedOutputBounds,
}: {
  readonly node: RenderNode;
  readonly parentOutputTransform: AffineMatrix;
  readonly dependencyPreviousOutputBounds: Bounds;
  readonly dependencyTranslatedOutputBounds: Bounds;
}): readonly Bounds[] {
  const outputTransform = multiplyMatrices(parentOutputTransform, node.source.transform);
  const ownDependency = ownBackdropDependentOutputBoundsAffectedByOutputBounds({
    node,
    outputTransform,
    dependencyPreviousOutputBounds,
    dependencyTranslatedOutputBounds,
  });
  const childDependencies = renderNodeChildren(node).flatMap((child) => backdropDependentOutputBoundsAffectedByOutputBounds({
    node: child,
    parentOutputTransform: outputTransform,
    dependencyPreviousOutputBounds,
    dependencyTranslatedOutputBounds,
  }));
  return [...ownDependency, ...childDependencies];
}

function ownBackdropDependentOutputBoundsAffectedByOutputBounds({
  node,
  outputTransform,
  dependencyPreviousOutputBounds,
  dependencyTranslatedOutputBounds,
}: {
  readonly node: RenderNode;
  readonly outputTransform: AffineMatrix;
  readonly dependencyPreviousOutputBounds: Bounds;
  readonly dependencyTranslatedOutputBounds: Bounds;
}): readonly Bounds[] {
  const samplingBounds = renderNodeLocalBackdropSamplingBounds(node);
  const outputBounds = renderNodeLocalBackdropDependentOutputBounds(node);
  if (samplingBounds === null || outputBounds === null) {
    return [];
  }
  const samplingOutputBounds = transformBounds(samplingBounds, outputTransform);
  if (
    !boundsIntersect(samplingOutputBounds, dependencyPreviousOutputBounds) &&
    !boundsIntersect(samplingOutputBounds, dependencyTranslatedOutputBounds)
  ) {
    return [];
  }
  return [transformBounds(outputBounds, outputTransform)];
}

function renderNodeLocalBackdropSamplingBounds(node: RenderNode): Bounds | null {
  const backgroundBlur = node.backgroundBlur;
  if (backgroundBlur !== undefined) {
    return rectToBounds(backgroundBlur.backdropBounds);
  }
  if (node.wrapper.blendMode !== undefined) {
    return resolveRenderNodeLocalSubtreeVisualBounds({
      node,
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
    });
  }
  return null;
}

function renderNodeLocalBackdropDependentOutputBounds(node: RenderNode): Bounds | null {
  if (node.backgroundBlur !== undefined) {
    return getRenderNodeLocalBounds(node);
  }
  if (node.wrapper.blendMode !== undefined) {
    return resolveRenderNodeLocalSubtreeVisualBounds({
      node,
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
    });
  }
  return null;
}

function ancestorCompositedOutputBoundsAffectedByTranslatedDescendant({
  node,
  previousOutputTransform,
  translatedOutputTransform,
  translation,
}: {
  readonly node: RenderNode;
  readonly previousOutputTransform: AffineMatrix;
  readonly translatedOutputTransform: AffineMatrix;
  readonly translation: SceneGraphNodeTranslation;
}): readonly Bounds[] {
  if (!renderNodeCompositedOutputDependsOnSceneGraphNodeTranslation({ node, translation })) {
    return [];
  }
  const previousAncestorBounds = resolveRenderNodeLocalSubtreeVisualBounds({
    node,
    visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
  });
  if (previousAncestorBounds === null) {
    return [];
  }
  const translatedAncestorBounds = resolveRenderNodeLocalSubtreeVisualBounds({
    node,
    visualTransform: { type: "scene-graph-node-translation", translation },
  });
  if (translatedAncestorBounds === null) {
    return [];
  }
  return [
    transformBounds(previousAncestorBounds, previousOutputTransform),
    transformBounds(translatedAncestorBounds, translatedOutputTransform),
  ];
}

function renderNodeCompositedOutputDependsOnSceneGraphNodeTranslation({
  node,
  translation,
}: {
  readonly node: RenderNode;
  readonly translation: SceneGraphNodeTranslation;
}): boolean {
  return renderNodeCompositedOutputDependsOnDescendantVisualBounds({
    node,
    visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
  }) || renderNodeCompositedOutputDependsOnDescendantVisualBounds({
    node,
    visualTransform: { type: "scene-graph-node-translation", translation },
  });
}

function renderNodeCompositedOutputDependsOnDescendantVisualBounds({
  node,
  visualTransform,
}: {
  readonly node: RenderNode;
  readonly visualTransform: RenderNodeVisualTransform;
}): boolean {
  if (node.type !== "group" && node.type !== "frame") {
    return false;
  }
  if (node.source.effects.length > 0 || node.wrapper.blendMode !== undefined || node.mask !== undefined || node.backgroundBlur !== undefined) {
    return true;
  }
  if (node.wrapper.opacity === undefined) {
    return false;
  }
  return !canRenderContainerOpacityWithInheritedOpacity({ node, visualTransform });
}

function transformedChildSubtreeVisualBoundsAreContained({
  child,
  containerBounds,
  cornerRadius,
  visualTransform,
}: {
  readonly child: RenderNode;
  readonly containerBounds: Bounds;
  readonly cornerRadius: CornerRadius | undefined;
  readonly visualTransform: RenderNodeVisualTransform;
}): boolean {
  const childBounds = resolveRenderNodeLocalSubtreeVisualBounds({ node: child, visualTransform });
  if (childBounds === null) {
    return true;
  }
  const transformedBounds = transformBounds(childBounds, childTransformForVisualTransform({ node: child, visualTransform }));
  if (!boundsContain(containerBounds, transformedBounds)) {
    return false;
  }
  return boundsCannotReachRoundedRectCornerClipBoundary({
    bounds: transformedBounds,
    containerBounds,
    cornerRadius,
  });
}

function boundsContain(container: Bounds, subject: Bounds): boolean {
  return (
    subject.minX >= container.minX &&
    subject.maxX <= container.maxX &&
    subject.minY >= container.minY &&
    subject.maxY <= container.maxY
  );
}

function cornerRadiusHasPositiveValue(cornerRadius: CornerRadius | undefined): boolean {
  if (cornerRadius === undefined) {
    return false;
  }
  if (typeof cornerRadius === "number") {
    return cornerRadius > 0;
  }
  return cornerRadius.some((radius) => radius > 0);
}

function cornerSmoothingHasPositiveValue(cornerSmoothing: number | undefined): boolean {
  return typeof cornerSmoothing === "number" && cornerSmoothing > 0;
}

function boundsCannotReachRoundedRectCornerClipBoundary({
  bounds,
  containerBounds,
  cornerRadius,
}: {
  readonly bounds: Bounds;
  readonly containerBounds: Bounds;
  readonly cornerRadius: CornerRadius | undefined;
}): boolean {
  if (cornerRadius === undefined) {
    return true;
  }
  if (!cornerRadiusHasPositiveValue(cornerRadius)) {
    return true;
  }
  const radii = cornerRadii(cornerRadius);
  const horizontalBody = {
    minY: containerBounds.minY + Math.max(radii.topLeft, radii.topRight),
    maxY: containerBounds.maxY - Math.max(radii.bottomLeft, radii.bottomRight),
  };
  const verticalBody = {
    minX: containerBounds.minX + Math.max(radii.topLeft, radii.bottomLeft),
    maxX: containerBounds.maxX - Math.max(radii.topRight, radii.bottomRight),
  };
  if (bounds.minY >= horizontalBody.minY && bounds.maxY <= horizontalBody.maxY) {
    return true;
  }
  return bounds.minX >= verticalBody.minX && bounds.maxX <= verticalBody.maxX;
}

function cornerRadii(cornerRadius: CornerRadius): CornerRadii {
  if (typeof cornerRadius === "number") {
    return {
      topLeft: cornerRadius,
      topRight: cornerRadius,
      bottomRight: cornerRadius,
      bottomLeft: cornerRadius,
    };
  }
  return {
    topLeft: cornerRadius[0],
    topRight: cornerRadius[1],
    bottomRight: cornerRadius[2],
    bottomLeft: cornerRadius[3],
  };
}

function computeRenderNodeLocalBounds(node: RenderNode): Bounds | null {
  switch (node.type) {
    case "group":
      return null;
    case "frame":
      return getClipShapeLocalBounds(node.sourceSurfaceShape);
    case "rect":
      return rectBounds({ x: 0, y: 0, width: node.width, height: node.height });
    case "ellipse":
      return rectBounds({ x: node.cx - node.rx, y: node.cy - node.ry, width: node.rx * 2, height: node.ry * 2 });
    case "path":
      return pathBounds(node.sourceContours);
    case "text":
      return rectBounds({ x: 0, y: 0, width: node.width, height: node.height });
    case "image":
      return rectBounds({ x: 0, y: 0, width: node.width, height: node.height });
  }
}

function containerOwnRenderingRequiresOpacityIsolation(node: RenderGroupNode | RenderFrameNode): boolean {
  if (node.mask !== undefined || node.wrapper.blendMode !== undefined || node.backgroundBlur !== undefined) {
    return true;
  }
  if (node.source.effects.length > 0 || node.filterSource !== undefined) {
    return true;
  }
  if (node.type === "frame") {
    return node.background !== null || node.sourceFills.length > 0 || node.sourceStroke !== undefined;
  }
  return false;
}

function subtreeRequiresBackdropIsolation(node: RenderNode): boolean {
  if (node.mask !== undefined || node.wrapper.blendMode !== undefined || node.backgroundBlur !== undefined) {
    return true;
  }
  if (node.source.effects.length > 0 || node.filterSource !== undefined) {
    return true;
  }
  return renderNodeChildren(node).some(subtreeRequiresBackdropIsolation);
}

function transformedChildVisualBoundsOverlap(
  children: readonly RenderNode[],
  visualTransform: RenderNodeVisualTransform,
): boolean {
  const bounds = children.flatMap((child) => {
    const childBounds = resolveRenderNodeLocalSubtreeVisualBounds({ node: child, visualTransform });
    if (childBounds === null) {
      return [];
    }
    return [transformBounds(childBounds, childTransformForVisualTransform({ node: child, visualTransform }))];
  });
  return bounds.some((current, index) => {
    const laterBounds = bounds.slice(index + 1);
    return laterBounds.some((other) => boundsInteriorOverlap(current, other));
  });
}

function boundsInteriorOverlap(a: Bounds, b: Bounds): boolean {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY;
}

function computeRenderNodeLocalBaseVisualBounds(node: RenderNode): Bounds | null {
  const bounds = getRenderNodeLocalBounds(node);
  if (bounds === null) {
    return null;
  }
  return expandBoundsByPadding(bounds, getStrokePadding(node));
}

function computeRenderNodeLocalAuthoredBounds(node: RenderNode): Bounds | null {
  return mergeOwnAndChildBounds({
    ownBounds: getRenderNodeLocalBounds(node),
    childBounds: renderNodeChildBounds(node, (child) => getRenderNodeLocalAuthoredBounds(child)),
  });
}

function computeRenderNodeLocalFrameChildClipBounds(node: RenderNode): Bounds | null {
  return mergeOwnAndChildBounds({
    ownBounds: renderNodeFrameChildClipIntrinsicBounds(node),
    childBounds: renderNodeChildBounds(node, (child) => getRenderNodeLocalFrameChildClipBounds(child)),
  });
}

function computeRenderNodeLocalSourceEffectInputBounds(node: RenderNode): Bounds | null {
  const ownBounds = computeRenderNodeLocalBaseVisualBounds(node);
  return mergeOwnAndChildBounds({
    ownBounds,
    childBounds: renderNodeChildVisualContributionBounds(
      node,
      (child) => resolveRenderNodeLocalSubtreeVisualBounds({ node: child, visualTransform: RENDER_NODE_SOURCE_TRANSFORMS }),
      (child) => childTransformForVisualTransform({ node: child, visualTransform: RENDER_NODE_SOURCE_TRANSFORMS }),
    ),
  });
}

function computeRenderFrameLocalSurfaceFilterInputBounds(node: RenderFrameNode): Bounds | null {
  if (node.surfaceFilterAttr === undefined) {
    return null;
  }
  return computeRenderFrameLocalSurfaceFilterBaseBounds(node);
}

function computeRenderFrameLocalSurfaceFilterBaseBounds(node: RenderFrameNode): Bounds | null {
  if (node.sourceFills.length === 0 && node.background?.strokeRendering?.mode !== "uniform") {
    return null;
  }
  const bounds = getClipShapeLocalBounds(node.sourceSurfaceShape);
  if (node.background?.strokeRendering?.mode !== "uniform") {
    return bounds;
  }
  return expandBoundsByPadding(bounds, getFrameUniformStrokePadding(node));
}

function getFrameUniformStrokePadding(node: RenderFrameNode): number {
  const strokeWidth = node.sourceStroke?.width;
  if (strokeWidth === undefined) {
    return 0;
  }
  return strokeWidth / 2;
}

function computeRenderNodeLocalSubtreeVisualBounds(node: RenderNode): Bounds | null {
  const sourceEffectInputBounds = getRenderNodeLocalSourceEffectInputBounds(node);
  if (sourceEffectInputBounds === null) {
    return null;
  }
  return resolveEffectVisualBounds(node, sourceEffectInputBounds);
}

function computeRenderNodeLocalSourceEffectInputBoundsForVisualTransform({
  node,
  visualTransform,
}: {
  readonly node: RenderNode;
  readonly visualTransform: RenderNodeVisualTransform;
}): Bounds | null {
  const ownBounds = computeRenderNodeLocalBaseVisualBounds(node);
  return mergeOwnAndChildBounds({
    ownBounds,
    childBounds: renderNodeChildVisualContributionBounds(
      node,
      (child) => resolveRenderNodeLocalSubtreeVisualBounds({ node: child, visualTransform }),
      (child) => childTransformForVisualTransform({ node: child, visualTransform }),
    ),
  });
}

function computeRenderNodeLocalSubtreeVisualBoundsForVisualTransform({
  node,
  visualTransform,
}: {
  readonly node: RenderNode;
  readonly visualTransform: RenderNodeVisualTransform;
}): Bounds | null {
  const bounds = resolveRenderNodeLocalSourceEffectInputBounds({ node, visualTransform });
  if (bounds === null) {
    return null;
  }
  return resolveEffectVisualBounds(node, bounds);
}

function renderNodeChildVisualContributionBounds(
  node: RenderNode,
  localChildSubtreeVisualBounds: (child: RenderNode) => Bounds | null,
  childTransform: (child: RenderNode) => AffineMatrix = (child) => child.source.transform,
): readonly Bounds[] {
  const childClipBounds = renderNodeChildClipBounds(node);
  return renderNodeChildren(node)
    .map((child) => {
      const bounds = localChildSubtreeVisualBounds(child);
      if (bounds === null) {
        return null;
      }
      const transformedBounds = transformBounds(bounds, childTransform(child));
      if (childClipBounds === null) {
        return transformedBounds;
      }
      return boundsIntersection(transformedBounds, childClipBounds);
    })
    .filter((bounds): bounds is Bounds => bounds !== null);
}

function renderNodeChildBounds(
  node: RenderNode,
  localChildBounds: (child: RenderNode) => Bounds | null,
): readonly Bounds[] {
  return renderNodeChildren(node)
    .map((child) => {
      const bounds = localChildBounds(child);
      if (bounds === null) {
        return null;
      }
      return transformBounds(bounds, child.source.transform);
    })
    .filter((bounds): bounds is Bounds => bounds !== null);
}

function mergeOwnAndChildBounds({
  ownBounds,
  childBounds,
}: {
  readonly ownBounds: Bounds | null;
  readonly childBounds: readonly Bounds[];
}): Bounds | null {
  const allBounds = ownBounds === null ? childBounds : [ownBounds, ...childBounds];
  if (allBounds.length === 0) {
    return null;
  }
  return allBounds.slice(1).reduce(boundsUnion, allBounds[0]);
}

function renderNodeChildClipBounds(node: RenderNode): Bounds | null {
  switch (node.type) {
    case "group":
      if (node.childClipId === undefined) {
        return null;
      }
      if (node.source.clip === undefined) {
        throw new Error(`RenderNode ${node.id} has childClipId without source clip`);
      }
      return getClipShapeLocalBounds(node.source.clip);
    case "frame":
      if (node.childClipId === undefined || node.omitChildClip === true) {
        return null;
      }
      return getClipShapeLocalBounds(node.sourceSurfaceShape);
    case "rect":
    case "ellipse":
    case "path":
    case "text":
    case "image":
      return null;
  }
}

function childTransformForVisualTransform({
  node,
  visualTransform,
}: {
  readonly node: RenderNode;
  readonly visualTransform: RenderNodeVisualTransform;
}): AffineMatrix {
  if (visualTransform.type === "source-transforms") {
    return node.source.transform;
  }
  if (node.id !== visualTransform.translation.nodeId) {
    return node.source.transform;
  }
  return translateSceneNodeTransform(
    node.source.transform,
    visualTransform.translation.dx,
    visualTransform.translation.dy,
  );
}

function renderNodeChildren(node: RenderNode): readonly RenderNode[] {
  switch (node.type) {
    case "group":
    case "frame":
      return node.children;
    case "rect":
    case "ellipse":
    case "path":
    case "text":
    case "image":
      return [];
  }
}

function renderNodeFrameChildClipIntrinsicBounds(node: RenderNode): Bounds | null {
  const ownBounds = getRenderNodeLocalBounds(node);
  const strokeBounds = renderNodeFrameChildClipStrokeBounds(node, ownBounds);
  return mergeOwnAndChildBounds({
    ownBounds,
    childBounds: strokeBounds === null ? [] : [strokeBounds],
  });
}

function renderNodeFrameChildClipStrokeBounds(
  node: RenderNode,
  ownBounds: Bounds | null,
): Bounds | null {
  switch (node.type) {
    case "group":
    case "image":
    case "text":
      return null;
    case "frame":
    case "rect":
      return expandBoundsByStrokeOutsets({
        bounds: ownBounds,
        stroke: node.sourceStroke,
        individualStrokeWeights: node.source.individualStrokeWeights,
      });
    case "ellipse":
      return expandBoundsByStrokeOutsets({
        bounds: ownBounds,
        stroke: node.sourceStroke,
        individualStrokeWeights: undefined,
      });
    case "path":
      if (node.source.type === "path" && node.sourceStroke?.align !== "INSIDE" && node.source.strokeContours !== undefined) {
        return pathBounds(node.source.strokeContours);
      }
      return expandBoundsByStrokeOutsets({
        bounds: ownBounds,
        stroke: node.sourceStroke,
        individualStrokeWeights: undefined,
      });
  }
}

export function transformBounds(bounds: Bounds, transform: AffineMatrix): Bounds {
  const points = [
    transformPoint({ x: bounds.minX, y: bounds.minY }, transform),
    transformPoint({ x: bounds.maxX, y: bounds.minY }, transform),
    transformPoint({ x: bounds.maxX, y: bounds.maxY }, transform),
    transformPoint({ x: bounds.minX, y: bounds.maxY }, transform),
  ];
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

export function boundsUnion(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function boundsIntersection(a: Bounds, b: Bounds): Bounds | null {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  if (maxX <= minX || maxY <= minY) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

export function getClipShapeLocalBounds(clip: ClipShape): Bounds {
  switch (clip.type) {
    case "rect":
      return rectBounds({ x: 0, y: 0, width: clip.width, height: clip.height });
    case "path":
      return pathBounds(clip.contours);
  }
}

/**
 * Control-hull bbox of the source contours. `pathContoursBoundingBox`
 * walks `PathCommand` endpoints and Bézier control points directly, so
 * the viewport intersection test consumes the RenderNode source geometry
 * without introducing a second path-data interpretation. The bbox is the
 * same for straight segments and only larger for curves, which preserves
 * pixels at viewport boundaries.
 */
function pathBounds(contours: readonly PathContour[]): Bounds {
  const bbox = pathContoursBoundingBox(contours);
  if (!bbox) {
    return rectBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
  return { minX: bbox.x, minY: bbox.y, maxX: bbox.x + bbox.w, maxY: bbox.y + bbox.h };
}

function rectBounds({
  x,
  y,
  width,
  height,
}: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): Bounds {
  return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

function expandViewport(viewport: ViewportRect, padding: number): Bounds {
  return {
    minX: viewport.x - padding,
    minY: viewport.y - padding,
    maxX: viewport.x + viewport.width + padding,
    maxY: viewport.y + viewport.height + padding,
  };
}

function boundsToRect(bounds: Bounds): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

function rectToBounds(rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): Bounds {
  return {
    minX: rect.x,
    minY: rect.y,
    maxX: rect.x + rect.width,
    maxY: rect.y + rect.height,
  };
}

function expandBoundsByPadding(bounds: Bounds, padding: number): Bounds {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}

function expandBoundsByStrokeOutsets({
  bounds,
  stroke,
  individualStrokeWeights,
}: {
  readonly bounds: Bounds | null;
  readonly stroke: Stroke | undefined;
  readonly individualStrokeWeights: IndividualStrokeWeights | undefined;
}): Bounds | null {
  if (bounds === null || stroke === undefined) {
    return null;
  }
  if (individualStrokeWeights !== undefined) {
    return expandBoundsByOutsets(bounds, {
      top: strokeOutset(individualStrokeWeights.top, stroke.align),
      right: strokeOutset(individualStrokeWeights.right, stroke.align),
      bottom: strokeOutset(individualStrokeWeights.bottom, stroke.align),
      left: strokeOutset(individualStrokeWeights.left, stroke.align),
    });
  }
  const outset = strokeOutset(stroke.width, stroke.align);
  return expandBoundsByOutsets(bounds, { top: outset, right: outset, bottom: outset, left: outset });
}

function strokeOutset(width: number, align: Stroke["align"]): number {
  if (width <= 0) {
    return 0;
  }
  switch (align) {
    case "INSIDE":
      return 0;
    case "OUTSIDE":
      return width;
    case "CENTER":
    case undefined:
      return width / 2;
  }
}

function expandBoundsByOutsets(
  bounds: Bounds,
  outsets: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number },
): Bounds | null {
  if (outsets.top === 0 && outsets.right === 0 && outsets.bottom === 0 && outsets.left === 0) {
    return null;
  }
  return {
    minX: bounds.minX - outsets.left,
    minY: bounds.minY - outsets.top,
    maxX: bounds.maxX + outsets.right,
    maxY: bounds.maxY + outsets.bottom,
  };
}

function resolveEffectVisualBounds(node: RenderNode, bounds: Bounds): Bounds {
  const visualOutputEffects = node.source.effects.filter((effect) => (
    effect.type === "drop-shadow" ||
    effect.type === "layer-blur"
  ));
  if (visualOutputEffects.length === 0) {
    return bounds;
  }
  return rectToBounds(resolveEffectBounds(visualOutputEffects, boundsToRect(bounds)));
}

function getStrokePadding(node: RenderNode): number {
  switch (node.type) {
    case "group":
    case "image":
    case "text":
      return 0;
    case "frame":
      return Math.max(node.sourceStroke?.width ?? 0, maxIndividualStrokeWeight(node.source.individualStrokeWeights)) / 2;
    case "rect":
    case "ellipse":
    case "path":
      return (node.sourceStroke?.width ?? 0) / 2;
  }
}

function maxIndividualStrokeWeight(weights: IndividualStrokeWeights | undefined): number {
  if (!weights) {
    return 0;
  }
  return Math.max(weights.top, weights.right, weights.bottom, weights.left);
}

function transformPoint(
  point: { readonly x: number; readonly y: number },
  transform: AffineMatrix,
): { readonly x: number; readonly y: number } {
  return {
    x: transform.m00 * point.x + transform.m01 * point.y + transform.m02,
    y: transform.m10 * point.x + transform.m11 * point.y + transform.m12,
  };
}

function boundsArea(bounds: Bounds): number {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

function isLargeEnoughForExplicitPixelArea({
  screenBounds,
  minPixelArea,
}: {
  readonly screenBounds: Bounds;
  readonly minPixelArea: number | undefined;
}): boolean {
  if (minPixelArea === undefined) {
    return true;
  }
  return boundsArea(screenBounds) >= minPixelArea;
}
