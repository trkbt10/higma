/**
 * @file Story registry
 *
 * Add new component stories here to include them in the preview.
 */

import type { Category } from "../types";

// Primitives
import { ButtonStories } from "./Button.stories";
import { InputStories } from "./Input.stories";
import { ToggleStories } from "./Toggle.stories";
import { SliderStories } from "./Slider.stories";
import { TabsStories } from "./Tabs.stories";
import { IconButtonStories } from "./IconButton.stories";
import { SuffixSelectStories } from "./SuffixSelect.stories";

// Player
import { PlayerStories } from "./Player.stories";

// Viewer
import { NavigationControlsStories } from "./NavigationControls.stories";

// Operation primitives
import { AlignmentControlsStories } from "./operations/AlignmentControls.stories";
import { ConstraintAnchorGridStories } from "./operations/ConstraintAnchorGrid.stories";
import { TransformActionsStories } from "./operations/TransformActions.stories";

// Property sections
import { OpacitySectionStories } from "./property-sections/OpacitySection.stories";
import { PositionSectionStories } from "./property-sections/PositionSection.stories";
import { SizeSectionStories } from "./property-sections/SizeSection.stories";
import { RotationSectionStories } from "./property-sections/RotationSection.stories";
import { CornerRadiusSectionStories } from "./property-sections/CornerRadiusSection.stories";
import { SectionBehaviorSectionStories } from "./property-sections/SectionBehavior.stories";
import { OutlineSectionStories } from "./property-sections/Outline.stories";
import { ExportSettingsSectionStories } from "./property-sections/ExportSettings.stories";
import { AutoLayoutSectionStories } from "./property-sections/AutoLayoutSection.stories";
import { LayoutConstraintsSectionStories } from "./property-sections/LayoutConstraintsSection.stories";
import { FillSectionStories } from "./property-sections/FillSection.stories";
import { StrokeSectionStories } from "./property-sections/StrokeSection.stories";
import { EffectsSectionStories } from "./property-sections/EffectsSection.stories";
import { VectorPathSectionStories } from "./property-sections/VectorPathSection.stories";
import { ComponentPropertiesSectionStories } from "./property-sections/ComponentPropertiesSection.stories";
import { VariantPropertiesSectionStories } from "./property-sections/VariantPropertiesSection.stories";
import { ComponentSetVariantsSectionStories } from "./property-sections/ComponentSetVariantsSection.stories";
import { InstanceOverridesSectionStories } from "./property-sections/InstanceOverridesSection.stories";
import { TextPropertiesSectionStories } from "./property-sections/TextPropertiesSection.stories";

/**
 * All component categories and their stories.
 */
export const catalog: readonly Category[] = [
  {
    name: "Primitives",
    components: [
      ButtonStories,
      IconButtonStories,
      InputStories,
      SliderStories,
      SuffixSelectStories,
      TabsStories,
      ToggleStories,
    ],
  },
  {
    name: "Player",
    components: [PlayerStories],
  },
  {
    name: "Viewer",
    components: [NavigationControlsStories],
  },
  {
    name: "Operations",
    components: [
      AlignmentControlsStories,
      ConstraintAnchorGridStories,
      TransformActionsStories,
    ],
  },
  {
    name: "Property Sections",
    components: [
      PositionSectionStories,
      SizeSectionStories,
      RotationSectionStories,
      OpacitySectionStories,
      CornerRadiusSectionStories,
      FillSectionStories,
      StrokeSectionStories,
      EffectsSectionStories,
      AutoLayoutSectionStories,
      LayoutConstraintsSectionStories,
      ExportSettingsSectionStories,
      SectionBehaviorSectionStories,
      OutlineSectionStories,
      VectorPathSectionStories,
      ComponentPropertiesSectionStories,
      VariantPropertiesSectionStories,
      ComponentSetVariantsSectionStories,
      InstanceOverridesSectionStories,
      TextPropertiesSectionStories,
    ],
  },
];
