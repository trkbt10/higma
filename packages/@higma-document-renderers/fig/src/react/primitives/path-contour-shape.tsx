/** @file Path contour shape formatter for React SVG output. */

import type { SVGProps } from "react";
import { resolvePathContourRectPrimitive, type PathContourRectSize } from "../../scene-graph";

type PathContourShapeProps = SVGProps<SVGPathElement> & SVGProps<SVGRectElement> & {
  readonly contour: { readonly d: string; readonly fillRule?: "evenodd" };
  readonly size?: PathContourRectSize;
};

/**
 * Renders a path contour through the shared SVG rectangle primitive resolver.
 */
export function PathContourShape({ contour, size, ...attrs }: PathContourShapeProps) {
  const rectPrimitive = resolvePathContourRectPrimitive(contour, size);
  if (rectPrimitive !== undefined) {
    return (
      <rect
        x={rectPrimitive.x}
        y={rectPrimitive.y}
        width={rectPrimitive.width}
        height={rectPrimitive.height}
        rx={rectPrimitive.rx}
        {...attrs}
      />
    );
  }
  return <path d={contour.d} fillRule={contour.fillRule} {...attrs} />;
}

/**
 * Renders the contour exactly as a path. Multi-paint path layers use
 * Figma's authored contour path; projecting rounded contours to
 * `<rect rx>` changes browser edge coverage at layer boundaries.
 */
export function PreservedPathContourShape({ contour, ...attrs }: Omit<PathContourShapeProps, "size">) {
  return <path d={contour.d} fillRule={contour.fillRule} {...attrs} />;
}
