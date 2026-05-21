/**
 * @file Group node React formatter (from RenderTree)
 */

import { memo } from "react";
import type { ReactNode } from "react";
import type { RenderGroupNode } from "../../scene-graph";
import { formatRenderDefs } from "../primitives/render-defs";
import { RenderWrapper } from "../primitives/wrapper";
import { RenderNodeComponent } from "./RenderNodeComponent";

type Props = {
  readonly node: RenderGroupNode;
};

function renderGroupChildren(node: RenderGroupNode): readonly ReactNode[] {
  const children = node.children.map((child) => (
    <RenderNodeComponent key={child.id} node={child} />
  ));
  if (node.childClipId === undefined) {
    return children;
  }
  return [<g key="group-child-clip" clipPath={`url(#${node.childClipId})`}>{children}</g>];
}

function RenderGroupNodeComponentImpl({ node }: Props) {
  const children = renderGroupChildren(node);

  // Optimization: unwrap single child if no wrapper attrs needed
  if (node.canUnwrapSingleChild && children.length === 1 && node.defs.length === 0) {
    return <>{children[0]}</>;
  }

  return (
    <RenderWrapper wrapper={node.wrapper} mask={node.mask}>
      {formatRenderDefs(node.defs)}
      {children}
    </RenderWrapper>
  );
}

export const RenderGroupNodeComponent = memo(RenderGroupNodeComponentImpl);
