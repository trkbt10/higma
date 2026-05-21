/**
 * @file Shape shell — assembles a shape node's defs, content, and background blur
 *
 * All shape nodes (rect, ellipse, path) share the same assembly pattern:
 * 1. Render defs
 * 2. Render background blur before foreground pixels when present
 * 3. Keep foreground filters off the background blur
 * 4. Wrap in RenderWrapper
 *
 * This component is the React counterpart of SVG's assembleShapeNode.
 */

import type { ReactNode } from "react";
import type { ResolvedWrapperAttrs, RenderDef, RenderBackgroundBlur, RenderMask } from "../../scene-graph";
import { formatRenderDefs } from "./render-defs";
import { RenderForegroundFilter, RenderWrapper } from "./wrapper";
import { BackgroundBlurElement } from "./background-blur";

type ShapeShellProps = {
  readonly wrapper: ResolvedWrapperAttrs;
  readonly defs: readonly RenderDef[];
  readonly backgroundBlur?: RenderBackgroundBlur;
  readonly mask?: RenderMask;
  readonly children: ReactNode;
};

/**
 * Wraps shape content with defs, background blur, mask, and wrapper <g>.
 */
export function ShapeShell({ wrapper, defs, backgroundBlur, mask, children }: ShapeShellProps) {
  if (backgroundBlur === undefined) {
    return (
      <RenderWrapper wrapper={wrapper} mask={mask}>
        {formatRenderDefs(defs)}
        {children}
      </RenderWrapper>
    );
  }

  return (
    <RenderWrapper wrapper={wrapper} mask={mask} includeFilter={false}>
      {formatRenderDefs(defs)}
      <BackgroundBlurElement blur={backgroundBlur} />
      <RenderForegroundFilter wrapper={wrapper}>
        {children}
      </RenderForegroundFilter>
    </RenderWrapper>
  );
}
