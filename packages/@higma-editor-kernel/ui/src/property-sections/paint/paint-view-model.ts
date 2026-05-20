/**
 * @file Paint view model
 *
 * Decoupled paint shapes used by the paint section views. The shapes here
 * intentionally mirror common attributes of a Figma-style paint but are
 * defined at the kernel layer so views never reach into any document model
 * directly. Document editors project their native paint type (e.g.
 * FigPaint) to/from these shapes at the package boundary.
 */

export type PaintTypeId =
  | "SOLID"
  | "GRADIENT_LINEAR"
  | "GRADIENT_RADIAL"
  | "GRADIENT_ANGULAR"
  | "GRADIENT_DIAMOND"
  | "IMAGE";

export type ImageScaleModeId = "FILL" | "FIT" | "CROP" | "TILE";

export type PaintImageView = {
  readonly imageHashHex: string;
  readonly scaleMode: ImageScaleModeId;
  readonly scale: number;
  /** Rotation in degrees. */
  readonly rotationDeg: number;
};

export type GradientStopView = {
  /** Position in 0..1. */
  readonly position: number;
  /** Hex color string `#RRGGBB`. */
  readonly hex: string;
  /** Alpha in 0..1. */
  readonly alpha: number;
};

export type GradientHandleView = {
  /** Normalized handle coordinate (0..1 spans the node bounds). */
  readonly x: number;
  readonly y: number;
};

export type PaintGradientView = {
  readonly stops: readonly GradientStopView[];
  readonly handles: readonly GradientHandleView[];
};

export type PaintItemView = {
  readonly type: PaintTypeId;
  /** Hex color (only meaningful for SOLID/GRADIENT stops representative color). */
  readonly hex: string;
  /** Paint-level opacity in 0..1. */
  readonly opacity: number;
  /** Image fields, when type === "IMAGE". */
  readonly image?: PaintImageView;
  /** Gradient fields, when type starts with "GRADIENT_". */
  readonly gradient?: PaintGradientView;
};
