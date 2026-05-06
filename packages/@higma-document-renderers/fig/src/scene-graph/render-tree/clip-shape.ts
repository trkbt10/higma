/** @file RenderTree clip shape resolution. */

import type { CornerRadius } from "../types";
import type { ClipPathShape } from "./types";
import { buildRoundedRectPathD } from "../render/rounded-rect-path";

/**
 * Build a ClipPathShape from dimensions and corner radius.
 *
 * Rounded rects emit a path because path clip rasterisation aligns with the
 * fill path used by the renderers; rect rx clip paths can create AA slivers.
 */
export function buildClipShape(
  width: number,
  height: number,
  cornerRadius: CornerRadius | undefined,
): ClipPathShape {
  if (cornerRadius !== undefined && typeof cornerRadius !== "number") {
    return { kind: "path", d: buildRoundedRectPathD(width, height, cornerRadius) };
  }
  const radius = typeof cornerRadius === "number" ? cornerRadius : undefined;
  if (radius !== undefined && radius > 0) {
    return { kind: "path", d: buildRoundedRectPathD(width, height, [radius, radius, radius, radius]) };
  }
  return { kind: "rect", x: 0, y: 0, width, height, rx: radius, ry: radius };
}
