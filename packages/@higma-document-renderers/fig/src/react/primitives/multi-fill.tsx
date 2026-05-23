/**
 * @file Multi-paint fill layer rendering for React
 *
 * When a node has multiple fills (multi-paint), each fill is rendered
 * as a separate stacked shape element. This is the React SoT for
 * multi-fill layer rendering.
 *
 * Figma stacks fills bottom-to-top: fills[0] is bottommost.
 * Each fill layer can have its own blend mode (paint-level blend).
 */

import type { ReactNode } from "react";
import type { ResolvedFillLayer } from "../../scene-graph";
import type { ResolvedStrokeLayer } from "../../scene-graph";
import type { CornerRadius } from "@higma-primitives/path";
import { LayeredRectShape, RectShape } from "./rect-shape";
import type { UniformStrokeDomAttrs } from "./stroke-rendering";
import { blendModeStyle } from "./blend-mode";
import { PathContourShape, PreservedPathContourShape } from "./path-contour-shape";

type MultiFillRectLayersProps = {
  readonly layers: readonly ResolvedFillLayer[];
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: CornerRadius;
  readonly cornerSmoothing?: number;
  readonly stroke?: UniformStrokeDomAttrs;
};

/**
 * Renders stacked rectangle fill layers in Figma paint order.
 */
export function MultiFillRectLayers({ layers, width, height, cornerRadius, cornerSmoothing, stroke }: MultiFillRectLayersProps): ReactNode {
  return (
    <>
      {layers.map((layer, i) => (
        <LayeredRectShape
          key={i}
          width={width}
          height={height}
          cornerRadius={cornerRadius}
          cornerSmoothing={cornerSmoothing}
          fill={layer.attrs.fill}
          fillOpacity={layer.attrs.fillOpacity}
          style={blendModeStyle(layer.blendMode)}
          {...strokeAttrsForTopLayer(i, layers.length, stroke)}
        />
      ))}
    </>
  );
}

type MultiFillEllipseLayersProps = {
  readonly layers: readonly ResolvedFillLayer[];
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly stroke?: UniformStrokeDomAttrs;
};

/**
 * Renders stacked ellipse fill layers in Figma paint order.
 */
export function MultiFillEllipseLayers({ layers, cx, cy, rx, ry, stroke }: MultiFillEllipseLayersProps): ReactNode {
  return (
    <>
      {layers.map((layer, i) => (
        <ellipse
          key={i}
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill={layer.attrs.fill}
          fillOpacity={layer.attrs.fillOpacity}
          style={blendModeStyle(layer.blendMode)}
          {...strokeAttrsForTopLayer(i, layers.length, stroke)}
        />
      ))}
    </>
  );
}

type MultiFillPathLayersProps = {
  readonly layers: readonly ResolvedFillLayer[];
  readonly paths: readonly { d: string; fillRule?: "evenodd" }[];
  readonly stroke?: UniformStrokeDomAttrs;
};

/**
 * Renders stacked path fill layers in Figma paint order.
 */
export function MultiFillPathLayers({ layers, paths, stroke }: MultiFillPathLayersProps): ReactNode {
  return (
    <>
      {layers.flatMap((layer, li) =>
        paths.map((pathItem, pi) => (
          <PreservedPathContourShape
            key={`${li}-${pi}`}
            contour={pathItem}
            fill={layer.attrs.fill}
            fillOpacity={layer.attrs.fillOpacity}
            style={blendModeStyle(layer.blendMode)}
            {...strokeAttrsForTopLayer(li, layers.length, stroke)}
          />
        )),
      )}
    </>
  );
}

// =============================================================================
// Multi-stroke Layer Components
// =============================================================================

type MultiStrokeRectLayersProps = {
  readonly layers: readonly ResolvedStrokeLayer[];
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: CornerRadius;
  readonly cornerSmoothing?: number;
};

/**
 * Renders stacked rectangle stroke layers in Figma paint order.
 */
export function MultiStrokeRectLayers({ layers, width, height, cornerRadius, cornerSmoothing }: MultiStrokeRectLayersProps): ReactNode {
  return (
    <>
      {layers.map((layer, i) => (
        <RectShape
          key={`stroke-${i}`}
          width={width}
          height={height}
          cornerRadius={cornerRadius}
          cornerSmoothing={cornerSmoothing}
          fill="none"
          style={blendModeStyle(layer.blendMode)}
          {...layer.attrs}
        />
      ))}
    </>
  );
}

type MultiStrokeEllipseLayersProps = {
  readonly layers: readonly ResolvedStrokeLayer[];
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
};

/**
 * Renders stacked ellipse stroke layers in Figma paint order.
 */
export function MultiStrokeEllipseLayers({ layers, cx, cy, rx, ry }: MultiStrokeEllipseLayersProps): ReactNode {
  return (
    <>
      {layers.map((layer, i) => (
        <ellipse
          key={`stroke-${i}`}
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill="none"
          style={blendModeStyle(layer.blendMode)}
          {...layer.attrs}
        />
      ))}
    </>
  );
}

type MultiStrokePathLayersProps = {
  readonly layers: readonly ResolvedStrokeLayer[];
  readonly paths: readonly { d: string; fillRule?: "evenodd" }[];
};

/**
 * Renders stacked path stroke layers in Figma paint order.
 */
export function MultiStrokePathLayers({ layers, paths }: MultiStrokePathLayersProps): ReactNode {
  return (
    <>
      {layers.flatMap((layer, li) =>
        paths.map((pathItem, pi) => (
          <PathContourShape
            key={`stroke-${li}-${pi}`}
            contour={pathItem}
            fill="none"
            style={blendModeStyle(layer.blendMode)}
            {...layer.attrs}
          />
        )),
      )}
    </>
  );
}

function strokeAttrsForTopLayer(
  index: number,
  layerCount: number,
  stroke: UniformStrokeDomAttrs | undefined,
): UniformStrokeDomAttrs | undefined {
  if (index !== layerCount - 1) {
    return undefined;
  }
  return stroke;
}
