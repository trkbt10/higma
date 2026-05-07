/**
 * @file Text node React formatter (from RenderTree)
 */

import { memo, type ReactNode } from "react";
import type { RenderTextNode } from "../../scene-graph/render-tree";
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

function RenderTextNodeComponentImpl({ node }: Props) {
  const defsEl = formatRenderDefs(node.defs);

  // Glyph contours (pre-outlined paths) — one <path> per fill run.
  if (node.content.mode === "glyphs") {
    const runs = node.content.runs;
    if (runs.length === 0) {
      return null;
    }

    const paths = runs.map((run, i) => (
      <path
        key={i}
        d={run.d}
        fill={run.fillColor}
        fillOpacity={run.fillOpacity < 1 ? run.fillOpacity : undefined}
      />
    ));
    let glyphContent: ReactNode = paths.length === 1 ? paths[0] : <>{paths}</>;
    glyphContent = wrapHyperlink(glyphContent, node.hyperlink);

    return (
      <RenderWrapper wrapper={node.wrapper} mask={node.mask}>
        {defsEl}
        {wrapTextClip(glyphContent, node.textClipId)}
      </RenderWrapper>
    );
  }

  // Text line layout: <text> elements
  if (node.content.layout.lines.length === 0) {
    return null;
  }

  let textContent: ReactNode = (
    <FigTextLines
      textLineLayout={node.content.layout}
      fill={node.fillColor}
      fillOpacity={node.fillOpacity}
    />
  );
  textContent = wrapHyperlink(textContent, node.hyperlink);

  return (
    <RenderWrapper wrapper={node.wrapper} mask={node.mask}>
      {defsEl}
      {wrapTextClip(textContent, node.textClipId)}
    </RenderWrapper>
  );
}

export const RenderTextNodeComponent = memo(RenderTextNodeComponentImpl);
