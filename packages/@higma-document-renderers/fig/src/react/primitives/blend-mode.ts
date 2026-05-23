/** @file React SVG blend-mode attribute formatting. */

import type { CSSProperties } from "react";
import type { BlendMode } from "../../scene-graph";

/**
 * Formats a RenderTree blend mode for React's SVG style surface.
 */
export function blendModeStyle(blendMode: BlendMode | undefined): CSSProperties | undefined {
  if (blendMode === undefined) {
    return undefined;
  }
  return { mixBlendMode: blendMode as CSSProperties["mixBlendMode"] };
}

export function directShapeBlendModeStyle(input: {
  readonly paintBlendMode?: BlendMode;
  readonly nodeBlendMode?: BlendMode;
  readonly wrapped: boolean;
  readonly nodeId: string;
}): CSSProperties | undefined {
  if (input.paintBlendMode !== undefined && !input.wrapped && input.nodeBlendMode !== undefined) {
    throw new Error(`FigSceneRenderer cannot fold node-level blend onto paint-blended shape ${input.nodeId}`);
  }
  if (input.paintBlendMode !== undefined) {
    return blendModeStyle(input.paintBlendMode);
  }
  if (input.wrapped || input.nodeBlendMode === undefined) {
    return undefined;
  }
  return blendModeStyle(input.nodeBlendMode);
}
