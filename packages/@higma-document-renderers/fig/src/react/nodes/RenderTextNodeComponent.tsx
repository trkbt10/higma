/**
 * @file Text node React formatter (from RenderTree)
 */

import { memo, type ReactNode } from "react";
import type { RenderTextNode } from "../../scene-graph";
import { formatRenderDefs } from "../primitives/render-defs";
import { RenderWrapper } from "../primitives/wrapper";
import { FigTextLines } from "./FigTextLines";

type Props = {
  readonly node: RenderTextNode;
};

/** Wrap content in <a> if hyperlink is present */
function wrapHyperlink(content: ReactNode, href: string | undefined): ReactNode {
  if (!href) { return content; }
  return <a href={href}>{content}</a>;
}

function wrapTextClip(content: ReactNode, textClipId: string | undefined): ReactNode {
  if (!textClipId) { return content; }
  return <g clipPath={`url(#${textClipId})`}>{content}</g>;
}

function formatGlyphContent(node: RenderTextNode): ReactNode {
  if (node.content.mode !== "glyphs") {
    throw new Error("formatGlyphContent requires glyph text content");
  }
  const paths = node.content.runs.map((run, i) => (
    <path
      key={i}
      d={run.d}
      fill={run.fillColor}
      fillOpacity={run.fillOpacity < 1 ? run.fillOpacity : undefined}
    />
  ));
  const body: ReactNode = paths.length === 1 ? paths[0] : <>{paths}</>;
  return wrapHyperlink(body, node.hyperlink);
}

function formatLineTextContent(node: RenderTextNode): ReactNode {
  if (node.content.mode !== "lines") {
    throw new Error("formatLineTextContent requires line text content");
  }
  if (node.fillColor === undefined) {
    throw new Error(`React text line renderer requires base text run fill for text node ${node.id}`);
  }
  const body = (
    <FigTextLines
      textLineLayout={node.content.layout}
      fill={node.fillColor}
      fillOpacity={node.fillOpacity}
    />
  );
  return wrapHyperlink(body, node.hyperlink);
}

function RenderTextNodeComponentImpl({ node }: Props) {
  const defsEl = formatRenderDefs(node.defs);

  // Glyph contours (pre-outlined paths) — one <path> per fill run.
  if (node.content.mode === "glyphs") {
    return renderGlyphTextNode(node, defsEl);
  }

  // Text line layout: <text> elements
  if (node.content.layout.lines.length === 0) {
    return null;
  }

  return (
    <RenderWrapper wrapper={node.wrapper} mask={node.mask}>
      {defsEl}
      {wrapTextClip(formatLineTextContent(node), node.textClipId)}
    </RenderWrapper>
  );
}

function renderGlyphTextNode(node: RenderTextNode, defsEl: ReactNode): ReactNode {
  if (node.content.mode !== "glyphs") {
    throw new Error("renderGlyphTextNode requires glyph text content");
  }
  if (node.content.runs.length === 0) {
    return null;
  }

  return (
    <RenderWrapper wrapper={node.wrapper} mask={node.mask}>
      {defsEl}
      {wrapTextClip(formatGlyphContent(node), node.textClipId)}
    </RenderWrapper>
  );
}

export const RenderTextNodeComponent = memo(RenderTextNodeComponentImpl);
