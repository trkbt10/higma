/** @file SVG viewport scene wrapper for editor tests and embedding. */
import { FigPageRenderer, type FigPageRendererProps } from "./FigPageRenderer";

export type FigSvgViewportSceneProps = Omit<FigPageRendererProps, "renderer">;

/** Render a Fig page with the SVG backend. */
export function FigSvgViewportScene(props: FigSvgViewportSceneProps) {
  return <FigPageRenderer {...props} renderer="svg" />;
}
