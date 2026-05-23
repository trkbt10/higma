/**
 * @file Path node React formatter (from RenderTree)
 */

import { memo } from "react";
import type { RenderPathNode } from "../../scene-graph";
import { ShapeShell } from "../primitives/shape-shell";
import { MultiFillPathLayers } from "../primitives/multi-fill";
import { getUniformStrokeAttrs, StrokeRenderingElements } from "../primitives/stroke-rendering";
import { directShapeBlendModeStyle } from "../primitives/blend-mode";
import { PathContourShape } from "../primitives/path-contour-shape";
import type { PathContourRectSize } from "../../scene-graph";

type Props = { readonly node: RenderPathNode };

function renderPathElements(node: RenderPathNode, uniformStroke: ReturnType<typeof getUniformStrokeAttrs>) {
  const size = pathNodeContourSize(node);
  return node.paths.map((p, i) => {
    const fa = p.fillOverride ?? node.fill;
    return (
      <PathContourShape
        key={i}
        contour={p}
        size={size}
        fill={fa.attrs.fill}
        fillOpacity={fa.attrs.fillOpacity}
        style={directShapeBlendModeStyle({
          paintBlendMode: fa.blendMode,
          nodeBlendMode: node.wrapper.blendMode,
          wrapped: node.needsWrapper,
          nodeId: node.id,
        })}
        {...(uniformStroke ?? {})}
      />
    );
  });
}

function renderPathFillContent(node: RenderPathNode, uniformStroke: ReturnType<typeof getUniformStrokeAttrs>) {
  if (node.fillLayers) {
    return <MultiFillPathLayers layers={node.fillLayers} paths={node.paths} stroke={uniformStroke} />;
  }
  return renderPathElements(node, uniformStroke);
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

function RenderPathNodeComponentImpl({ node }: Props) {
  if (node.paths.length === 0) { return null; }

  const sr = node.strokeRendering;
  const uniformStroke = getUniformStrokeAttrs(sr);

  if (node.fillLayers || sr) {
    return (
      <ShapeShell wrapper={node.wrapper} defs={node.defs} backgroundBlur={node.backgroundBlur} mask={node.mask}>
        {renderPathFillContent(node, uniformStroke)}
        {sr && <StrokeRenderingElements sr={sr} />}
      </ShapeShell>
    );
  }

  const pathElements = renderPathElements(node, uniformStroke);

  if (node.needsWrapper) {
    return <ShapeShell wrapper={node.wrapper} defs={node.defs} backgroundBlur={node.backgroundBlur} mask={node.mask}>{pathElements}</ShapeShell>;
  }
  return pathElements[0];
}

export const RenderPathNodeComponent = memo(RenderPathNodeComponentImpl);
