/**
 * @file Frame node React formatter (from RenderTree)
 */

import { memo, type ReactNode } from "react";
import type { RenderFrameNode } from "../../scene-graph";
import { formatRenderDefs } from "../primitives/render-defs";
import { RenderWrapper } from "../primitives/wrapper";
import { RectShape } from "../primitives/rect-shape";
import { MultiFillPathLayers, MultiFillRectLayers } from "../primitives/multi-fill";
import { BackgroundBlurElement } from "../primitives/background-blur";
import { getUniformStrokeAttrs, StrokeRenderingElements } from "../primitives/stroke-rendering";
import { RenderNodeComponent } from "./RenderNodeComponent";
import type { StrokeRendering } from "../../scene-graph";

type Props = { readonly node: RenderFrameNode };

function renderFrameSurfaceContents(
  node: RenderFrameNode,
  uniformStroke: ReturnType<typeof getUniformStrokeAttrs>,
): ReactNode {
  const childElements = node.children.map((child) => <RenderNodeComponent key={child.id} node={child} />);
  const childClipId = node.omitChildClip ? undefined : node.childClipId;
  const content = (
    <>
      {renderFrameBackgroundShape(node, uniformStroke)}
      {node.backgroundBlur === undefined ? null : <BackgroundBlurElement blur={node.backgroundBlur} />}
      {childElements}
    </>
  );
  if (childClipId && childElements.length > 0) {
    return <g clipPath={`url(#${childClipId})`}>{content}</g>;
  }
  return content;
}

function renderFrameBackgroundShape(
  node: RenderFrameNode,
  uniformStroke: ReturnType<typeof getUniformStrokeAttrs>,
): ReactNode {
  if (!node.background) {
    return null;
  }
  if (node.background.fillLayers) {
    if (node.surfaceShape.kind === "path") {
      return <MultiFillPathLayers layers={node.background.fillLayers} paths={node.surfaceShape.paths} stroke={uniformStroke} />;
    }
    return <MultiFillRectLayers layers={node.background.fillLayers} width={node.surfaceShape.width} height={node.surfaceShape.height} cornerRadius={node.surfaceShape.cornerRadius} cornerSmoothing={node.surfaceShape.cornerSmoothing} stroke={uniformStroke} />;
  }
  const { fill } = node.background;
  if (node.surfaceShape.kind === "path") {
    return (
      <>
        {node.surfaceShape.paths.map((p, index) => (
          <path key={index} d={p.d} fillRule={p.fillRule} fill={fill.attrs.fill} fillOpacity={fill.attrs.fillOpacity} {...(uniformStroke ?? {})} />
        ))}
      </>
    );
  }
  return <RectShape width={node.surfaceShape.width} height={node.surfaceShape.height} cornerRadius={node.surfaceShape.cornerRadius} cornerSmoothing={node.surfaceShape.cornerSmoothing} fill={fill.attrs.fill} fillOpacity={fill.attrs.fillOpacity} {...(uniformStroke ?? {})} />;
}

function renderFrameSurfaceEffectGroup(node: RenderFrameNode, content: ReactNode): ReactNode {
  const filterAttr = node.background?.filterAttr;
  if (filterAttr === undefined) {
    return content;
  }
  return <g filter={filterAttr}>{content}</g>;
}

function RenderFrameNodeComponentImpl({ node }: Props) {
  const defsEl = formatRenderDefs(node.defs);
  const sr: StrokeRendering | undefined = node.background?.strokeRendering;
  const uniformStroke = getUniformStrokeAttrs(sr);
  const surfaceContent = renderFrameSurfaceContents(node, uniformStroke);
  const surfaceEffectGroup = renderFrameSurfaceEffectGroup(node, surfaceContent);

  return (
    <RenderWrapper wrapper={node.wrapper} mask={node.mask}>
      {defsEl}
      {surfaceEffectGroup}
      {sr === undefined ? null : <StrokeRenderingElements sr={sr} />}
    </RenderWrapper>
  );
}

export const RenderFrameNodeComponent = memo(RenderFrameNodeComponentImpl);
