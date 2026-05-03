/** @file Shared paint editor options. */

import type { FigImageScaleMode } from "@higuma/fig/types";
import type { SelectOption } from "@higuma/ui-components/types";

export const imageScaleModeOptions: readonly SelectOption<FigImageScaleMode>[] = [
  { value: "FILL", label: "Fill" },
  { value: "FIT", label: "Fit" },
  { value: "CROP", label: "Crop" },
  { value: "TILE", label: "Tile" },
  { value: "STRETCH", label: "Stretch" },
];
