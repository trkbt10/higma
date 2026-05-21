/** @file RenderTree clip shape resolution. */


import type { ClipPathShape } from "./types";
import { buildRoundedRectPathD, buildSmoothedRoundedRectPathD } from "@higma-primitives/path";
import type { CornerRadius } from "@higma-primitives/path";

/**
 * Build a ClipPathShape from dimensions, corner radius, and optional
 * iOS-style corner smoothing.
 *
 * Rounded rects emit a path because path clip rasterisation aligns with the
 * fill path used by the renderers; rect rx clip paths can create AA slivers.
 *
 * When `cornerSmoothing` is non-zero the path traces the continuous-
 * curvature (squircle) corners Figma's exporter writes, so the clip
 * stays aligned with the smoothed fill rect.
 */
export function buildClipShape(
  width: number,
  height: number,
  cornerRadius: CornerRadius | undefined,
  cornerSmoothing?: number,
): ClipPathShape {
  const smoothing = typeof cornerSmoothing === "number" && cornerSmoothing > 0 ? cornerSmoothing : 0;
  if (cornerRadius !== undefined && typeof cornerRadius !== "number") {
    const d = buildClipPathD(width, height, cornerRadius, smoothing);
    return { kind: "path", d };
  }
  const radius = typeof cornerRadius === "number" ? cornerRadius : undefined;
  if (radius !== undefined && radius > 0) {
    const radii: readonly [number, number, number, number] = [radius, radius, radius, radius];
    const d = buildClipPathD(width, height, radii, smoothing);
    return { kind: "path", d };
  }
  return { kind: "rect", x: 0, y: 0, width, height, rx: radius, ry: radius };
}

function buildClipPathD(
  width: number,
  height: number,
  radii: readonly [number, number, number, number],
  smoothing: number,
): string {
  if (smoothing > 0) {
    return buildSmoothedRoundedRectPathD(width, height, radii, smoothing);
  }
  return buildRoundedRectPathD(width, height, radii);
}
