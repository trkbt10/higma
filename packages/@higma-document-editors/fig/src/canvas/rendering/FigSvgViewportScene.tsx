/** @file React SVG viewport layer for the fig editor. */

import type { CSSProperties } from "react";
import { FigSceneRenderer } from "@higma-document-renderers/fig/react";
import type { SceneGraph } from "@higma-document-models/fig/scene-graph";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import { resolveViewportLayerFrame, type ViewportLayerPlacement } from "../layout/viewport-render-plan";

type FigSvgViewportSceneProps = {
  readonly sceneGraph: SceneGraph;
  readonly renderOptions?: SceneGraphRenderOptions;
  readonly placement?: ViewportLayerPlacement;
};

function resolveViewBox(sceneGraph: SceneGraph): string {
  const viewport = sceneGraph.viewport ?? {
    x: 0,
    y: 0,
    width: sceneGraph.width,
    height: sceneGraph.height,
  };

  return `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`;
}

function resolveSvgLayerStyle({
  sceneGraph,
  placement,
}: {
  readonly sceneGraph: SceneGraph;
  readonly placement: ViewportLayerPlacement;
}): CSSProperties {
  const frame = resolveViewportLayerFrame({ sceneGraph, placement });

  return {
    position: "absolute",
    left: frame.left,
    top: frame.top,
    display: "block",
    width: frame.width,
    height: frame.height,
    overflow: "visible",
    pointerEvents: "none",
    userSelect: "none",
  };
}

/** Render the SVG backend as a React-owned SVG tree so React can diff node updates. */
export function FigSvgViewportScene({ sceneGraph, renderOptions, placement = "world" }: FigSvgViewportSceneProps) {
  return (
    <svg
      viewBox={resolveViewBox(sceneGraph)}
      preserveAspectRatio="none"
      style={resolveSvgLayerStyle({ sceneGraph, placement })}
      aria-hidden="true"
    >
      <FigSceneRenderer sceneGraph={sceneGraph} renderOptions={renderOptions} />
    </svg>
  );
}
