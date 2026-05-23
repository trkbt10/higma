/**
 * @file Rectangle node React formatter (from RenderTree)
 */

import { memo } from "react";
import type { RenderRectNode } from "../../scene-graph";
import { ShapeShell } from "../primitives/shape-shell";
import { RectShape } from "../primitives/rect-shape";
import { MultiFillRectLayers } from "../primitives/multi-fill";
import { getUniformStrokeAttrs, StrokeRenderingElements } from "../primitives/stroke-rendering";
import { directShapeBlendModeStyle } from "../primitives/blend-mode";

type Props = { readonly node: RenderRectNode };

function renderRectShape(node: RenderRectNode, uniformStroke: ReturnType<typeof getUniformStrokeAttrs>) {
  return (
    <RectShape
      width={node.width}
      height={node.height}
      cornerRadius={node.cornerRadius}
      cornerSmoothing={node.cornerSmoothing}
      fill={node.fill.attrs.fill}
      fillOpacity={node.fill.attrs.fillOpacity}
      style={directShapeBlendModeStyle({
        paintBlendMode: node.fill.blendMode,
        nodeBlendMode: node.wrapper.blendMode,
        wrapped: node.needsWrapper,
        nodeId: node.id,
      })}
      {...(uniformStroke ?? {})}
    />
  );
}

function renderRectFillContent(node: RenderRectNode, uniformStroke: ReturnType<typeof getUniformStrokeAttrs>) {
  if (node.fillLayers) {
    return <MultiFillRectLayers layers={node.fillLayers} width={node.width} height={node.height} cornerRadius={node.cornerRadius} cornerSmoothing={node.cornerSmoothing} stroke={uniformStroke} />;
  }
  return renderRectShape(node, uniformStroke);
}

function RenderRectNodeComponentImpl({ node }: Props) {
  const sr = node.strokeRendering;
  const uniformStroke = getUniformStrokeAttrs(sr);

  if (node.fillLayers || sr) {
    return (
      <ShapeShell wrapper={node.wrapper} defs={node.defs} backgroundBlur={node.backgroundBlur} mask={node.mask}>
        {renderRectFillContent(node, uniformStroke)}
        {sr && <StrokeRenderingElements sr={sr} />}
      </ShapeShell>
    );
  }

  const rectEl = renderRectShape(node, uniformStroke);

  if (node.needsWrapper) {
    return <ShapeShell wrapper={node.wrapper} defs={node.defs} backgroundBlur={node.backgroundBlur} mask={node.mask}>{rectEl}</ShapeShell>;
  }
  return rectEl;
}

export const RenderRectNodeComponent = memo(RenderRectNodeComponentImpl);
