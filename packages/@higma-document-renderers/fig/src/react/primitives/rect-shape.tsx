/**
 * @file Rectangle shape for React — handles both uniform and per-corner radius
 *
 * Sharp-cornered rects (cornerRadius undefined or 0) emit `<rect>`. Rounded
 * rects emit `<path>` with cubic Bézier corners — the path-d builder is
 * the shared SoT (scene-graph/render/rounded-rect-path) used by the SVG
 * scene renderer and the RenderTree clip-path resolver. Using `<rect rx>`
 * for rounded corners would rasterise at slightly different sub-pixels
 * from Figma's exporter and produce AA-only diff regressions.
 */


import { buildRoundedRectPathD, buildSmoothedRoundedRectPathD } from "@higma-primitives/path";
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

function cornerRadiusTuple(cornerRadius: CornerRadius): readonly [number, number, number, number] {
  if (typeof cornerRadius !== "number") {
    return cornerRadius;
  }
  return [cornerRadius, cornerRadius, cornerRadius, cornerRadius];
}

function roundedRectPathD(width: number, height: number, cornerRadius: CornerRadius, cornerSmoothing: number | undefined): string {
  const radii = cornerRadiusTuple(cornerRadius);
  if (cornerSmoothing !== undefined && cornerSmoothing > 0) {
    return buildSmoothedRoundedRectPathD(width, height, radii, cornerSmoothing);
  }
  return buildRoundedRectPathD(width, height, radii);
}

export function RectShape({ width, height, cornerRadius, cornerSmoothing, ...rest }: RectShapeProps) {
  if (cornerRadius !== undefined && (typeof cornerRadius !== "number" || cornerRadius > 0)) {
    return <path d={roundedRectPathD(width, height, cornerRadius, cornerSmoothing)} {...rest} />;
  }

  return (
    <rect
      x={0}
      y={0}
      width={width}
      height={height}
      {...rest}
    />
  );
}
