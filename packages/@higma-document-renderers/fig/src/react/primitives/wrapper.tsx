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

type WrapperProps = {
  readonly wrapper: ResolvedWrapperAttrs;
  readonly mask?: RenderMask;
  readonly children: ReactNode;
};

function buildBlendModeStyle(wrapper: ResolvedWrapperAttrs): React.CSSProperties | undefined {
  if (!wrapper.blendMode) { return undefined; }
  return { mixBlendMode: wrapper.blendMode as React.CSSProperties["mixBlendMode"] };
}

function buildFinalStyle(wrapper: ResolvedWrapperAttrs): React.CSSProperties | undefined {
  const style = buildBlendModeStyle(wrapper);
  if (wrapper.filterAttr && !wrapper.blendMode) {
    return { ...(style ?? {}), isolation: "isolate" as const };
  }
  return style;
}

/**
 * Render a wrapping <g> element with all resolved wrapper attributes.
 *
 * This is the single source of truth for how ResolvedWrapperAttrs
 * maps to SVG/React attributes. Both SVG string and React renderers
 * MUST express wrapper attributes through the same set of fields.
 */
export function RenderWrapper({ wrapper, mask, children }: WrapperProps) {
  // Stacking-context isolation matches the SVG renderer's behaviour
  // (see `scene-renderer.ts:wrapperAttrs`). We isolate filter-only
  // wrappers but NOT a wrapper that carries `mix-blend-mode` because
  // the blend's backdrop must reach back to the parent's fill.
  // Isolating the blend-moded node would constrain the backdrop to its
  // own descendants and silently void the blend (a HUE-blended overlay
  // rendered solid because the underlying pattern from the grandparent
  // never reached the blend's backdrop).
  const finalStyle = buildFinalStyle(wrapper);

  return (
    <g
      transform={wrapper.transform}
      opacity={wrapper.opacity}
      filter={wrapper.filterAttr}
      mask={mask?.maskAttr}
      style={finalStyle}
    >
      {children}
    </g>
  );
}
