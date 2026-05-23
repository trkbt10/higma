/**
 * @file Image node React formatter (from RenderTree)
 */

import { memo } from "react";
import type { RenderImageNode } from "../../scene-graph";
import { RenderWrapper } from "../primitives/wrapper";
import { directShapeBlendModeStyle } from "../primitives/blend-mode";

type Props = {
  readonly node: RenderImageNode;
};

function RenderImageNodeComponentImpl({ node }: Props) {
  if (!node.dataUri) {
    return null;
  }

  const imageEl = (
    <image
      href={node.dataUri}
      x={0}
      y={0}
      width={node.width}
      height={node.height}
      preserveAspectRatio={node.preserveAspectRatio}
      style={directShapeBlendModeStyle({
        nodeBlendMode: node.wrapper.blendMode,
        wrapped: node.needsWrapper,
        nodeId: node.id,
      })}
    />
  );

  if (node.needsWrapper) {
    return (
      <RenderWrapper wrapper={node.wrapper} mask={node.mask}>
        {imageEl}
      </RenderWrapper>
    );
  }

  return imageEl;
}

export const RenderImageNodeComponent = memo(RenderImageNodeComponentImpl);
