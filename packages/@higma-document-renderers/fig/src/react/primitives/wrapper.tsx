/**
 * @file Wrapper <g> element for RenderNode — SoT for applying wrapper attributes
 *
 * Every RenderNode that needs a wrapping <g> (transform, opacity, filter,
 * blendMode, mask) MUST use this component. This ensures all wrapper
 * attributes are applied consistently across all node types.
 *
 * Adding a new wrapper attribute (e.g. a future "isolation" CSS prop)
 * requires changing ONLY this file — all node renderers inherit it.
 */

import type { ReactNode } from "react";
import type { ResolvedWrapperAttrs, RenderMask } from "../../scene-graph";
import { blendModeStyle } from "./blend-mode";

type WrapperProps = {
  readonly wrapper: ResolvedWrapperAttrs;
  readonly mask?: RenderMask;
  readonly includeFilter?: boolean;
  readonly children: ReactNode;
};

type ForegroundFilterProps = {
  readonly wrapper: ResolvedWrapperAttrs;
  readonly children: ReactNode;
};

function resolveWrapperFilter(wrapper: ResolvedWrapperAttrs, includeFilter: boolean): string | undefined {
  if (!includeFilter) {
    return undefined;
  }
  return wrapper.filterAttr;
}

/**
 * Render a wrapping <g> element with all resolved wrapper attributes.
 *
 * This is the single source of truth for how ResolvedWrapperAttrs
 * maps to SVG/React attributes. Both SVG string and React renderers
 * MUST express wrapper attributes through the same set of fields.
 */
export function RenderWrapper({ wrapper, mask, includeFilter = true, children }: WrapperProps) {
  // Figma's SVG exporter does not add CSS isolation to filtered groups.
  // Blend isolation changes the backdrop that mix-blend-mode samples and
  // is therefore never inferred here; filters already define their own SVG
  // offscreen pipeline via <filter>.
  const finalStyle = blendModeStyle(wrapper.blendMode);

  return (
    <g
      transform={wrapper.transform}
      opacity={wrapper.opacity}
      filter={resolveWrapperFilter(wrapper, includeFilter)}
      mask={mask?.maskAttr}
      style={finalStyle}
    >
      {children}
    </g>
  );
}

/**
 * Applies an already-resolved foreground filter wrapper around rendered children.
 */
export function RenderForegroundFilter({ wrapper, children }: ForegroundFilterProps) {
  if (wrapper.filterAttr === undefined) {
    return <>{children}</>;
  }
  return (
    <g filter={wrapper.filterAttr}>
      {children}
    </g>
  );
}
