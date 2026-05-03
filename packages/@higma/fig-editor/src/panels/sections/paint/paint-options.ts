/** @file Shared paint editor UI options (SoT for paint Select components). */

import type { FigImageScaleMode, FigPaint } from "@higma/fig/types";
import type { SelectOption } from "@higma/ui-components/types";

export const paintTypeOptions: readonly SelectOption<FigPaint["type"]>[] = [
  { value: "SOLID", label: "Solid" },
  { value: "GRADIENT_LINEAR", label: "Linear" },
  { value: "GRADIENT_RADIAL", label: "Radial" },
  { value: "GRADIENT_ANGULAR", label: "Angular" },
  { value: "GRADIENT_DIAMOND", label: "Diamond" },
  { value: "IMAGE", label: "Image" },
];

export const imageScaleModeOptions: readonly SelectOption<FigImageScaleMode>[] = [
  { value: "FILL", label: "Fill" },
  { value: "FIT", label: "Fit" },
  { value: "CROP", label: "Crop" },
  { value: "TILE", label: "Tile" },
  { value: "STRETCH", label: "Stretch" },
];
