/** @file Fig editor canvas bounds derived from page content. */

import type { FigDesignNode } from "@higma-document-models/fig/domain";

const MIN_CANVAS_SIZE = 800;
const CANVAS_PADDING = 200;

export type FigCanvasBounds = {
  readonly width: number;
  readonly height: number;
  readonly renderX: number;
  readonly renderY: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
};

/** Compute canvas dimensions that enclose all nodes with padding. */
export function computeCanvasBoundsFromNodes(nodes: readonly FigDesignNode[]): FigCanvasBounds {
  if (nodes.length === 0) {
    return {
      width: MIN_CANVAS_SIZE,
      height: MIN_CANVAS_SIZE,
      renderX: 0,
      renderY: 0,
      renderWidth: MIN_CANVAS_SIZE,
      renderHeight: MIN_CANVAS_SIZE,
    };
  }

  const extremes = nodes.reduce(
    (acc, node) => {
      const left = node.transform.m02;
      const top = node.transform.m12;
      const right = node.transform.m02 + node.size.x;
      const bottom = node.transform.m12 + node.size.y;
      return {
        minLeft: Math.min(acc.minLeft, left),
        minTop: Math.min(acc.minTop, top),
        maxRight: Math.max(acc.maxRight, right),
        maxBottom: Math.max(acc.maxBottom, bottom),
      };
    },
    { minLeft: 0, minTop: 0, maxRight: 0, maxBottom: 0 },
  );

  return {
    width: Math.max(MIN_CANVAS_SIZE, extremes.maxRight + CANVAS_PADDING),
    height: Math.max(MIN_CANVAS_SIZE, extremes.maxBottom + CANVAS_PADDING),
    renderX: extremes.minLeft - CANVAS_PADDING,
    renderY: extremes.minTop - CANVAS_PADDING,
    renderWidth: Math.max(MIN_CANVAS_SIZE, extremes.maxRight - extremes.minLeft + CANVAS_PADDING * 2),
    renderHeight: Math.max(MIN_CANVAS_SIZE, extremes.maxBottom - extremes.minTop + CANVAS_PADDING * 2),
  };
}
