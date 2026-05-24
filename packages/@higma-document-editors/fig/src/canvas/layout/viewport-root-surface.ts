/** @file Root render surface projection from the editor viewport. */
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import type { FigNode } from "@higma-document-models/fig/types";
import { resolveLayoutBoundsIntersection, type LayoutBounds } from "./layout-bounds";

export type ViewportRootRenderWindow = LayoutBounds & {
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
};

export type ViewportRootSurfacePlan = {
  readonly cssBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly viewport: LayoutBounds;
};

const AXIS_ALIGNED_ROOT_SURFACE_MATRIX_EPSILON = 1e-6;

function isAxisAlignedRootSurfaceTransform(transform: ReturnType<typeof readKiwiTransform>): boolean {
  return Math.abs(transform.m00 - 1) <= AXIS_ALIGNED_ROOT_SURFACE_MATRIX_EPSILON
    && Math.abs(transform.m01) <= AXIS_ALIGNED_ROOT_SURFACE_MATRIX_EPSILON
    && Math.abs(transform.m10) <= AXIS_ALIGNED_ROOT_SURFACE_MATRIX_EPSILON
    && Math.abs(transform.m11 - 1) <= AXIS_ALIGNED_ROOT_SURFACE_MATRIX_EPSILON;
}

function hasPositiveKiwiNodeSize(node: FigNode): node is FigNode & { readonly size: { readonly x: number; readonly y: number } } {
  return node.size !== undefined && node.size.x > 0 && node.size.y > 0;
}

function unboundedRootViewportSurfacePlan(renderWindow: ViewportRootRenderWindow): ViewportRootSurfacePlan {
  return {
    cssBox: {
      x: 0,
      y: 0,
      width: renderWindow.surfaceWidth,
      height: renderWindow.surfaceHeight,
    },
    canvasWidth: renderWindow.surfaceWidth,
    canvasHeight: renderWindow.surfaceHeight,
    viewport: {
      x: renderWindow.x,
      y: renderWindow.y,
      width: renderWindow.width,
      height: renderWindow.height,
    },
  };
}

function axisAlignedKiwiRootBounds(node: FigNode & { readonly size: { readonly x: number; readonly y: number } }): LayoutBounds | undefined {
  const transform = readKiwiTransform(node.transform);
  if (!isAxisAlignedRootSurfaceTransform(transform)) {
    return undefined;
  }
  return {
    x: transform.m02,
    y: transform.m12,
    width: node.size.x,
    height: node.size.y,
  };
}

function axisAlignedRootViewportSurfacePlan({
  rootRect,
  renderWindow,
  viewportScale,
}: {
  readonly rootRect: LayoutBounds;
  readonly renderWindow: ViewportRootRenderWindow;
  readonly viewportScale: number;
}): ViewportRootSurfacePlan | undefined {
  const viewport = resolveLayoutBoundsIntersection(rootRect, renderWindow);
  if (viewport === undefined) {
    return undefined;
  }
  const width = viewport.width * viewportScale;
  const height = viewport.height * viewportScale;
  return {
    cssBox: {
      x: (viewport.x - renderWindow.x) * viewportScale,
      y: (viewport.y - renderWindow.y) * viewportScale,
      width,
      height,
    },
    canvasWidth: width,
    canvasHeight: height,
    viewport,
  };
}

/** Resolve the only viewport projection consumed by SVG and WebGL editor root surfaces. */
export function resolveViewportRootSurfacePlan({
  node,
  renderWindow,
  viewportScale,
}: {
  readonly node: FigNode;
  readonly renderWindow: ViewportRootRenderWindow;
  readonly viewportScale: number;
}): ViewportRootSurfacePlan | undefined {
  if (!hasPositiveKiwiNodeSize(node)) {
    return unboundedRootViewportSurfacePlan(renderWindow);
  }
  const rootRect = axisAlignedKiwiRootBounds(node);
  if (rootRect === undefined) {
    return unboundedRootViewportSurfacePlan(renderWindow);
  }
  return axisAlignedRootViewportSurfacePlan({ rootRect, renderWindow, viewportScale });
}
