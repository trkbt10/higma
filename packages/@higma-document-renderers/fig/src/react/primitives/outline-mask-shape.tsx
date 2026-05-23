/** @file OUTLINE mask geometry formatter for the React SVG backend. */

import type { ReactNode } from "react";
import type {
  PathContourRectSize,
  RenderFrameNode,
  RenderImageNode,
  RenderNode,
  RenderPathNode,
  RenderTextNode,
  StrokeRendering,
} from "../../scene-graph";
import { RectShape } from "./rect-shape";
import { PathContourShape } from "./path-contour-shape";

type Props = {
  readonly node: RenderNode;
  readonly fill: string;
};

type MaskStrokeAttrs = {
  readonly stroke: "white";
  readonly strokeWidth: number;
};

function positiveStrokeWidth(width: number): number | undefined {
  if (width <= 0) {
    return undefined;
  }
  return width;
}

function maskStrokeWidth(strokeRendering: StrokeRendering | undefined): number | undefined {
  if (strokeRendering === undefined) {
    return undefined;
  }
  switch (strokeRendering.mode) {
    case "uniform":
    case "masked":
      return positiveStrokeWidth(strokeRendering.attrs.strokeWidth);
    case "layers": {
      const first = strokeRendering.layers[0];
      if (first === undefined) {
        throw new Error("Resolved OUTLINE mask stroke layers were empty");
      }
      return positiveStrokeWidth(first.attrs.strokeWidth);
    }
    case "geometry":
    case "individual":
      return undefined;
  }
}

function strokeRenderingForMaskNode(node: RenderNode): StrokeRendering | undefined {
  switch (node.type) {
    case "rect":
    case "ellipse":
    case "path":
      return node.strokeRendering;
    case "frame":
      return node.background?.strokeRendering;
    case "group":
    case "text":
    case "image":
      return undefined;
  }
}

function maskStrokeAttrsForNode(node: RenderNode): MaskStrokeAttrs | undefined {
  const width = maskStrokeWidth(strokeRenderingForMaskNode(node));
  if (width === undefined) {
    return undefined;
  }
  return { stroke: "white", strokeWidth: width };
}

function renderMaskStrokeGeometry(strokeRendering: StrokeRendering | undefined, fill: string): ReactNode[] {
  if (strokeRendering?.mode !== "geometry") {
    return [];
  }
  return strokeRendering.paths.map((path, index) => (
    <PathContourShape key={`stroke-${index}`} contour={path} fill={fill} />
  ));
}

function renderTextMaskShape(node: RenderTextNode, fill: string): ReactNode {
  if (node.content.mode !== "glyphs") {
    throw new Error(`Text mask node ${node.id} requires glyph geometry`);
  }
  const paths = node.content.runs.map((run, index) => (
    <path key={index} d={run.d} fill={fill} />
  ));
  if (paths.length === 1) {
    return paths[0];
  }
  return <>{paths}</>;
}

function renderImageMaskShape(node: RenderImageNode): ReactNode {
  if (node.dataUri === undefined) {
    throw new Error(`Image mask node ${node.id} is missing SVG image data`);
  }
  return (
    <image
      href={node.dataUri}
      x={0}
      y={0}
      width={node.width}
      height={node.height}
      preserveAspectRatio={node.preserveAspectRatio}
    />
  );
}

function renderFrameMaskBackground(
  node: RenderFrameNode,
  fill: string,
  strokeAttrs: MaskStrokeAttrs | undefined,
): ReactNode {
  return (
    <RectShape
      width={node.width}
      height={node.height}
      cornerRadius={node.cornerRadius}
      cornerSmoothing={node.cornerSmoothing}
      fill={fill}
      {...(strokeAttrs ?? {})}
    />
  );
}

function renderOutlineMaskShapeBody(node: RenderNode, fill: string): ReactNode {
  const strokeAttrs = maskStrokeAttrsForNode(node);
  switch (node.type) {
    case "path": {
      const size = pathNodeContourSize(node);
      const parts = [
        ...node.paths.map((path, index) => (
          <PathContourShape key={`fill-${index}`} contour={path} size={size} fill={fill} {...(strokeAttrs ?? {})} />
        )),
        ...renderMaskStrokeGeometry(node.strokeRendering, fill),
      ];
      if (parts.length === 1) {
        return parts[0];
      }
      return <>{parts}</>;
    }
    case "rect":
      return (
        <RectShape
          width={node.width}
          height={node.height}
          cornerRadius={node.cornerRadius}
          cornerSmoothing={node.cornerSmoothing}
          fill={fill}
          {...(strokeAttrs ?? {})}
        />
      );
    case "ellipse":
      if (node.rx === node.ry) {
        return <circle cx={node.cx} cy={node.cy} r={node.rx} fill={fill} {...(strokeAttrs ?? {})} />;
      }
      return <ellipse cx={node.cx} cy={node.cy} rx={node.rx} ry={node.ry} fill={fill} {...(strokeAttrs ?? {})} />;
    case "group": {
      const children = node.children.map((child) => (
        <RenderOutlineMaskShape key={child.id} node={child} fill={fill} />
      ));
      if (children.length === 1) {
        return children[0];
      }
      return <>{children}</>;
    }
    case "frame": {
      const background = renderFrameMaskBackground(node, fill, strokeAttrs);
      if (node.children.length === 0) {
        return background;
      }
      const children = node.children.map((child) => (
        <RenderOutlineMaskShape key={child.id} node={child} fill={fill} />
      ));
      return (
        <>
          {background}
          {children}
        </>
      );
    }
    case "text":
      return renderTextMaskShape(node, fill);
    case "image":
      return renderImageMaskShape(node);
  }
}

function pathNodeContourSize(node: RenderPathNode): PathContourRectSize | undefined {
  const source = node.source;
  if (source.type !== "path") {
    return undefined;
  }
  if (typeof source.width !== "number" || typeof source.height !== "number") {
    return undefined;
  }
  return { width: source.width, height: source.height };
}

/** Render a RenderTree node as forced geometry for a Kiwi OUTLINE mask. */
export function RenderOutlineMaskShape({ node, fill }: Props): ReactNode {
  const body = renderOutlineMaskShapeBody(node, fill);
  if (node.wrapper.transform === undefined) {
    return body;
  }
  return <g transform={node.wrapper.transform}>{body}</g>;
}
