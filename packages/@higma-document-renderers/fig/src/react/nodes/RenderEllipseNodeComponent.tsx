/**
 * @file Ellipse node React formatter (from RenderTree)
 */

import { memo } from "react";
import type { RenderEllipseNode } from "../../scene-graph";
import { ShapeShell } from "../primitives/shape-shell";
import { MultiFillEllipseLayers } from "../primitives/multi-fill";
import { getUniformStrokeAttrs, StrokeRenderingElements } from "../primitives/stroke-rendering";
import { directShapeBlendModeStyle } from "../primitives/blend-mode";

type Props = { readonly node: RenderEllipseNode };

function renderEllipseShape(node: RenderEllipseNode, uniformStroke: ReturnType<typeof getUniformStrokeAttrs>) {
  const fillAttrs = {
    fill: node.fill.attrs.fill,
    fillOpacity: node.fill.attrs.fillOpacity,
    style: directShapeBlendModeStyle({
      paintBlendMode: node.fill.blendMode,
      nodeBlendMode: node.wrapper.blendMode,
      wrapped: node.needsWrapper,
      nodeId: node.id,
    }),
  };
  if (node.rx === node.ry) {
    return <circle cx={node.cx} cy={node.cy} r={node.rx} {...fillAttrs} {...(uniformStroke ?? {})} />;
  }
  return <ellipse cx={node.cx} cy={node.cy} rx={node.rx} ry={node.ry} {...fillAttrs} {...(uniformStroke ?? {})} />;
}

function renderEllipseFillContent(node: RenderEllipseNode, uniformStroke: ReturnType<typeof getUniformStrokeAttrs>) {
  if (node.fillLayers) {
    return <MultiFillEllipseLayers layers={node.fillLayers} cx={node.cx} cy={node.cy} rx={node.rx} ry={node.ry} stroke={uniformStroke} />;
  }
  return renderEllipseShape(node, uniformStroke);
}

function RenderEllipseNodeComponentImpl({ node }: Props) {
  const sr = node.strokeRendering;
  const uniformStroke = getUniformStrokeAttrs(sr);
  const shapeEl = renderEllipseShape(node, uniformStroke);

  if (node.fillLayers || sr) {
    return (
      <ShapeShell wrapper={node.wrapper} defs={node.defs} backgroundBlur={node.backgroundBlur} mask={node.mask}>
        {renderEllipseFillContent(node, uniformStroke)}
        {sr && <StrokeRenderingElements sr={sr} />}
      </ShapeShell>
    );
  }

  if (node.needsWrapper) {
    return <ShapeShell wrapper={node.wrapper} defs={node.defs} backgroundBlur={node.backgroundBlur} mask={node.mask}>{shapeEl}</ShapeShell>;
  }
  return shapeEl;
}

export const RenderEllipseNodeComponent = memo(RenderEllipseNodeComponentImpl);
