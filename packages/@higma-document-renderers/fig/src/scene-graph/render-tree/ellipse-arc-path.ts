/** @file RenderTree SVG path conversion for ellipse arc nodes. */

import type { ArcData } from "../types";

/**
 * Generate SVG path data for an ellipse with Figma ArcData.
 */
export function buildEllipseArcPathD(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  arc: ArcData,
): string {
  const { startingAngle, endingAngle, innerRadius } = arc;
  const sweep = endingAngle - startingAngle;
  const isFullCircle = Math.abs(sweep) >= Math.PI * 2 - 1e-6;
  const outerStartX = cx + rx * Math.cos(startingAngle);
  const outerStartY = cy + ry * Math.sin(startingAngle);
  const outerEndX = cx + rx * Math.cos(endingAngle);
  const outerEndY = cy + ry * Math.sin(endingAngle);
  const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
  const sweepFlag = sweep > 0 ? 1 : 0;

  if (innerRadius <= 0) {
    if (isFullCircle) {
      const midAngle = startingAngle + Math.PI;
      const midX = cx + rx * Math.cos(midAngle);
      const midY = cy + ry * Math.sin(midAngle);
      return [
        `M${outerStartX} ${outerStartY}`,
        `A${rx} ${ry} 0 1 ${sweepFlag} ${midX} ${midY}`,
        `A${rx} ${ry} 0 1 ${sweepFlag} ${outerStartX} ${outerStartY}`,
        "Z",
      ].join("");
    }
    return [
      `M${cx} ${cy}`,
      `L${outerStartX} ${outerStartY}`,
      `A${rx} ${ry} 0 ${largeArc} ${sweepFlag} ${outerEndX} ${outerEndY}`,
      "Z",
    ].join("");
  }

  const irx = rx * innerRadius;
  const iry = ry * innerRadius;
  const innerStartX = cx + irx * Math.cos(startingAngle);
  const innerStartY = cy + iry * Math.sin(startingAngle);
  const innerEndX = cx + irx * Math.cos(endingAngle);
  const innerEndY = cy + iry * Math.sin(endingAngle);
  const reverseSweep = sweepFlag === 1 ? 0 : 1;

  if (isFullCircle) {
    const midAngle = startingAngle + Math.PI;
    const outerMidX = cx + rx * Math.cos(midAngle);
    const outerMidY = cy + ry * Math.sin(midAngle);
    const innerMidX = cx + irx * Math.cos(midAngle);
    const innerMidY = cy + iry * Math.sin(midAngle);
    return [
      `M${outerStartX} ${outerStartY}`,
      `A${rx} ${ry} 0 1 ${sweepFlag} ${outerMidX} ${outerMidY}`,
      `A${rx} ${ry} 0 1 ${sweepFlag} ${outerStartX} ${outerStartY}`,
      "Z",
      `M${innerStartX} ${innerStartY}`,
      `A${irx} ${iry} 0 1 ${reverseSweep} ${innerMidX} ${innerMidY}`,
      `A${irx} ${iry} 0 1 ${reverseSweep} ${innerStartX} ${innerStartY}`,
      "Z",
    ].join("");
  }

  return [
    `M${outerStartX} ${outerStartY}`,
    `A${rx} ${ry} 0 ${largeArc} ${sweepFlag} ${outerEndX} ${outerEndY}`,
    `L${innerEndX} ${innerEndY}`,
    `A${irx} ${iry} 0 ${largeArc} ${reverseSweep} ${innerStartX} ${innerStartY}`,
    "Z",
  ].join("");
}
