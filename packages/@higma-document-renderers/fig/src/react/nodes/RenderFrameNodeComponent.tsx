/**
 * @file Frame node React formatter (from RenderTree)
 */

import { memo, type ReactNode } from "react";
import type { RenderFrameNode } from "../../scene-graph";
import { formatRenderDefs } from "../primitives/render-defs";
import { RenderWrapper } from "../primitives/wrapper";
import { RectShape } from "../primitives/rect-shape";
import { MultiFillRectLayers } from "../primitives/multi-fill";
import { BackgroundBlurElement } from "../primitives/background-blur";
import { getUniformStrokeAttrs, StrokeRenderingElements } from "../primitives/stroke-rendering";
import { RenderNodeComponent } from "./RenderNodeComponent";
import type { StrokeRendering } from "../../scene-graph";

type Props = { readonly node: RenderFrameNode };

function renderFrameChildren(node: RenderFrameNode): ReactNode {
  const childElements = node.children.map((child) => <RenderNodeComponent key={child.id} node={child} />);
  const childClipId = node.omitChildClip ? undefined : node.childClipId;
  if (childClipId && childElements.length > 0) {
    return <g clipPath={`url(#${childClipId})`}>{childElements}</g>;
  }
  return <>{childElements}</>;
}

function renderFrameBackgroundRect(
  node: RenderFrameNode,
  uniformStroke: ReturnType<typeof getUniformStrokeAttrs>,
): ReactNode {
  if (!node.background) {
    return null;
  }
  if (node.background.fillLayers) {
    return <MultiFillRectLayers layers={node.background.fillLayers} width={node.width} height={node.height} cornerRadius={node.cornerRadius} cornerSmoothing={node.cornerSmoothing} stroke={uniformStroke} />;
  }
  const { fill } = node.background;
  return <RectShape width={node.width} height={node.height} cornerRadius={node.cornerRadius} cornerSmoothing={node.cornerSmoothing} fill={fill.attrs.fill} fillOpacity={fill.attrs.fillOpacity} {...(uniformStroke ?? {})} />;
}

function renderFrameBackgroundSurface(node: RenderFrameNode, content: ReactNode): ReactNode {
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
  const bgRect = renderFrameBackgroundSurface(node, renderFrameBackgroundRect(node, uniformStroke));

  const childrenContent = renderFrameChildren(node);

  return (
    <RenderWrapper wrapper={node.wrapper} mask={node.mask}>
      {defsEl}
      {bgRect}
      {sr && <StrokeRenderingElements sr={sr} />}
      {node.backgroundBlur && <BackgroundBlurElement blur={node.backgroundBlur} />}
      {childrenContent}
    </RenderWrapper>
  );
}

export const RenderFrameNodeComponent = memo(RenderFrameNodeComponentImpl);
