/**
 * @file Rectangle shape for React — handles both uniform and per-corner radius
 *
 * This consumes the scene-graph/render rectangle primitive resolver so
 * React SVG and the string SVG renderer do not make independent
 * `<rect rx>` vs `<path>` decisions.
 */


import { resolveLayeredRectShapePrimitive, resolveRectShapePrimitive, type RectShapePrimitive } from "../../scene-graph";
import type { CornerRadius } from "@higma-primitives/path";

type RectShapeProps = {
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: CornerRadius;
  readonly cornerSmoothing?: number;
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly [key: string]: unknown;
};

/**
 * Renders the shared rectangle primitive as React SVG.
 */
export function RectShape({ width, height, cornerRadius, cornerSmoothing, ...rest }: RectShapeProps) {
  const shape = resolveRectShapePrimitive(width, height, cornerRadius, cornerSmoothing);
  return <ResolvedRectShape shape={shape} attrs={rest} />;
}

/**
 * Renders a stacked paint layer rectangle using Figma's path primitive
 * for rounded corners.
 */
export function LayeredRectShape({ width, height, cornerRadius, cornerSmoothing, ...rest }: RectShapeProps) {
  const shape = resolveLayeredRectShapePrimitive(width, height, cornerRadius, cornerSmoothing);
  return <ResolvedRectShape shape={shape} attrs={rest} />;
}

function ResolvedRectShape(
  { shape, attrs }: {
    readonly shape: RectShapePrimitive;
    readonly attrs: Omit<RectShapeProps, "width" | "height" | "cornerRadius" | "cornerSmoothing">;
  },
) {
  switch (shape.kind) {
    case "path":
      return <path d={shape.d} {...attrs} />;
    case "rect":
      return (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.rx}
          {...attrs}
        />
      );
  }
}
