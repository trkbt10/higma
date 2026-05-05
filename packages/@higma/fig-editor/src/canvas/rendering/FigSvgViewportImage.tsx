/** @file SVG-renderer viewport image for the fig editor. */

import { useMemo } from "react";
import type { SceneGraph } from "@higma/fig-renderer/scene-graph";
import { renderSceneGraphToSvg } from "@higma/fig-renderer/svg";
import { resolveViewportLayerFrame, type ViewportLayerPlacement } from "./viewport-render-plan";

type FigSvgViewportImageProps = {
  readonly sceneGraph: SceneGraph;
  readonly placement?: ViewportLayerPlacement;
};

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Render the SVG backend as an inert viewport-aligned image layer. */
export function FigSvgViewportImage({ sceneGraph, placement = "world" }: FigSvgViewportImageProps) {
  const href = useMemo(() => svgToDataUrl(renderSceneGraphToSvg(sceneGraph) as string), [sceneGraph]);
  const frame = resolveViewportLayerFrame({ sceneGraph, placement });

  return (
    <img
      src={href}
      alt=""
      draggable={false}
      style={{
        position: "absolute",
        left: frame.left,
        top: frame.top,
        display: "block",
        width: frame.width,
        height: frame.height,
        userSelect: "none",
      }}
    />
  );
}
