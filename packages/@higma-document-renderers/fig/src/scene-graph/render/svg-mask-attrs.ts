/** @file SVG mask element attributes shared by string and React SVG backends. */

import type { FigMaskType } from "@higma-document-models/fig/types";

export type SvgMaskBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SvgMaskType = "alpha" | "luminance";

export type SvgMaskContentMode = "source" | "outline";

export type SvgMaskPresentation = {
  readonly maskType: SvgMaskType;
  readonly contentMode: SvgMaskContentMode;
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
      return { maskType: "alpha", contentMode: "source" };
    case "LUMINANCE":
      return { maskType: "luminance", contentMode: "source" };
    case "OUTLINE":
      return { maskType: "luminance", contentMode: "outline" };
  }
}

/**
 * Resolve the SVG mask region from the RenderTree mask source bounds.
 *
 * SVG defaults mask coordinates to objectBoundingBox. Figma mask content is
 * already in user space, so every backend must emit userSpaceOnUse plus an
 * explicit integer region derived from the mask source geometry.
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
  const x = Math.floor(bounds.x);
  const y = Math.floor(bounds.y);
  const width = Math.ceil(bounds.x + bounds.width) - x;
  const height = Math.ceil(bounds.y + bounds.height) - y;
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`Mask ${id} has a non-positive SVG mask region`);
  }
  return {
    id,
    maskType,
    maskUnits: "userSpaceOnUse",
    x: String(x),
    y: String(y),
    width: String(width),
    height: String(height),
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
