/**
 * @file Node-type load-bearing defaults SoT
 *
 * Single source of truth for the Kiwi field defaults Figma's binary format
 * requires per node type. Applied during `FigDesignDocument → FigNode[]`
 * projection so that every node type carries the load-bearing fields Figma
 * needs to render, edit, and persist correctly.
 *
 * The values here were empirically derived from real Figma `.fig`
 * exports (`docs/refactor/disk-sot-verification/`). Don't change a
 * default without empirical evidence — Figma silently rejects or
 * mis-renders files whose load-bearing fields drift from the on-disk
 * SoT.
 */

import { IDENTITY_MATRIX } from "../matrix";
import type { FigNodeType } from "../types";

const STROKE_CENTER = { value: 0, name: "CENTER" } as const;
const STROKE_INSIDE = { value: 1, name: "INSIDE" } as const;
const STROKE_BEVEL = { value: 1, name: "BEVEL" } as const;
const STROKE_MITER = { value: 0, name: "MITER" } as const;
const COLOR_PROFILE_SRGB = { value: 1, name: "SRGB" } as const;

/**
 * Apply load-bearing Kiwi field defaults to a projected node base. The
 * `base` argument is a partial `FigNode` shape being built by the
 * `document-to-tree` projection; fields already populated are preserved
 * (`??=`), missing load-bearing fields are filled in.
 */
export function applyNodeTypeDefaults(base: Record<string, unknown>, type: FigNodeType): void {
  switch (type) {
    case "DOCUMENT":
      base.transform ??= IDENTITY_MATRIX;
      base.strokeWeight ??= 0;
      base.strokeAlign ??= STROKE_CENTER;
      base.strokeJoin ??= STROKE_BEVEL;
      base.documentColorProfile ??= COLOR_PROFILE_SRGB;
      return;
    case "CANVAS":
      base.transform ??= IDENTITY_MATRIX;
      base.backgroundOpacity ??= 1;
      base.backgroundEnabled ??= true;
      base.strokeWeight ??= 0;
      base.strokeAlign ??= STROKE_CENTER;
      base.strokeJoin ??= STROKE_BEVEL;
      return;
    case "FRAME":
      base.strokeWeight ??= 1;
      base.strokeAlign ??= STROKE_INSIDE;
      base.strokeJoin ??= STROKE_MITER;
      // frameMaskDisabled defaults to false (clipsContent default = true).
      // If caller already set either flag, leave it.
      if (base.frameMaskDisabled === undefined && base.clipsContent === undefined) {
        base.frameMaskDisabled = false;
      }
      return;
    case "SYMBOL":
      // Load-bearing: real Figma exports mark user-authored SYMBOLs as
      // publishable Local Components. Without this flag the SYMBOL fails
      // to appear in the Assets panel and Variant Set containment can break.
      base.isSymbolPublishable ??= true;
      base.strokeWeight ??= 1;
      base.strokeAlign ??= STROKE_INSIDE;
      base.strokeJoin ??= STROKE_MITER;
      return;
    case "INSTANCE":
      base.strokeWeight ??= 1;
      base.strokeAlign ??= STROKE_INSIDE;
      base.strokeJoin ??= STROKE_MITER;
      return;
    case "TEXT":
      base.strokeWeight ??= 0;
      base.strokeAlign ??= STROKE_INSIDE;
      base.strokeJoin ??= STROKE_MITER;
      return;
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
    case "ELLIPSE":
    case "STAR":
    case "REGULAR_POLYGON":
    case "LINE":
    case "VECTOR":
      base.strokeWeight ??= 1;
      base.strokeAlign ??= STROKE_INSIDE;
      base.strokeJoin ??= STROKE_MITER;
      return;
    case "GROUP":
    case "BOOLEAN_OPERATION":
      // Empirical: real Figma exports omit stroke metadata on these
      // logical containers. Leave fields absent.
      return;
    case "SECTION":
      base.strokeWeight ??= 1;
      base.strokeAlign ??= STROKE_INSIDE;
      base.strokeJoin ??= STROKE_MITER;
      base.cornerRadius ??= 2;
      base.frameMaskDisabled ??= true;
      return;
    case "SLICE":
    case "STICKY":
    case "SHAPE_WITH_TEXT":
    case "CONNECTOR":
    case "CODE_BLOCK":
    case "WIDGET":
    case "STAMP":
    case "MEDIA":
    case "TABLE":
    case "TABLE_CELL":
    case "EMBED":
    case "LINK_UNFURL":
      // Unused or non-renderable in this product profile. Leave alone.
      return;
    default:
      return;
  }
}
