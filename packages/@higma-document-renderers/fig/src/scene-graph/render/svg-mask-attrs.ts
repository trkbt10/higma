/** @file SVG mask element attributes shared by string and React SVG backends. */

import type { FigMaskType } from "@higma-document-models/fig/types";

export type SvgMaskBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SvgMaskType = "alpha" | "luminance";

export type SvgMaskPresentation = {
  readonly maskType: SvgMaskType;
};

export type SvgMaskElementAttrs = {
  readonly id: string;
  readonly maskType: SvgMaskType;
  readonly maskUnits: "userSpaceOnUse";
  readonly x: string;
  readonly y: string;
  readonly width: string;
  readonly height: string;
};

export type SvgStrokeMaskElementAttrs = {
  readonly id: string;
  readonly maskType: "luminance";
  readonly maskUnits: "userSpaceOnUse";
};

/** Resolve Kiwi mask semantics into SVG element and content formatting modes. */
export function resolveSvgMaskPresentation(maskType: FigMaskType): SvgMaskPresentation {
  switch (maskType) {
    case "ALPHA":
      return { maskType: "alpha" };
    case "LUMINANCE":
      return { maskType: "luminance" };
    case "OUTLINE":
      return { maskType: "luminance" };
  }
}

/**
 * Resolve the SVG mask region from the RenderTree mask source bounds.
 *
 * SVG defaults mask coordinates to objectBoundingBox. Figma mask content is
 * already in user space, so every backend must emit userSpaceOnUse plus an
 * explicit region derived from the mask source geometry. The coordinates are
 * intentionally not quantized here: the SVG export boundary projects wrapper
 * transforms into user-space defs first, then applies the same Figma precision
 * rule used by normal geometry attributes.
 */
export function resolveSvgMaskElementAttrs({
  id,
  bounds,
  maskType,
}: {
  readonly id: string;
  readonly bounds: SvgMaskBounds;
  readonly maskType: SvgMaskType;
}): SvgMaskElementAttrs {
  if (!(bounds.width > 0) || !(bounds.height > 0)) {
    throw new Error(`Mask ${id} has a non-positive SVG mask region`);
  }
  return {
    id,
    maskType,
    maskUnits: "userSpaceOnUse",
    x: String(bounds.x),
    y: String(bounds.y),
    width: String(bounds.width),
    height: String(bounds.height),
  };
}

/** Resolve attributes for stroke clipping masks. */
export function resolveSvgStrokeMaskElementAttrs(id: string): SvgStrokeMaskElementAttrs {
  return {
    id,
    maskType: "luminance",
    maskUnits: "userSpaceOnUse",
  };
}
