/** @file Shared select-option lists for paint section views. */

import type { SelectOption } from "../../types";
import type { ImageScaleModeId, PaintTypeId } from "./paint-view-model";

export const PAINT_TYPE_OPTIONS: readonly SelectOption<PaintTypeId>[] = [
  { value: "SOLID", label: "Solid" },
  { value: "GRADIENT_LINEAR", label: "Linear" },
  { value: "GRADIENT_RADIAL", label: "Radial" },
  { value: "GRADIENT_ANGULAR", label: "Angular" },
  { value: "GRADIENT_DIAMOND", label: "Diamond" },
  { value: "IMAGE", label: "Image" },
];

export const IMAGE_SCALE_MODE_OPTIONS: readonly SelectOption<ImageScaleModeId>[] = [
  { value: "FILL", label: "Fill" },
  { value: "FIT", label: "Fit" },
  { value: "CROP", label: "Crop" },
  { value: "TILE", label: "Tile" },
];
