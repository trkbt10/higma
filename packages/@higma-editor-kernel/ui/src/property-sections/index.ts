/**
 * @file Property section views entry point.
 *
 * Pure presentational property section views. Each view takes simple props
 * (numbers, strings, kernel-defined enums, callbacks) and renders the
 * controls a document editor would put inside a property panel section.
 *
 * Document editors (e.g. fig) project their document state into view props
 * and dispatch updates back through their editor action stream.
 */

// Appearance
export { OpacitySectionView, type OpacitySectionViewProps } from "./appearance/OpacitySectionView";
export {
  PositionSectionView,
  type PositionSectionField,
  type PositionSectionViewProps,
} from "./appearance/PositionSectionView";
export {
  SizeSectionView,
  type SizeSectionField,
  type SizeSectionViewProps,
} from "./appearance/SizeSectionView";
export {
  RotationSectionView,
  type RotationSectionViewProps,
} from "./appearance/RotationSectionView";
export {
  CornerRadiusSectionView,
  type CornerRadiusIndex,
  type CornerRadiusSectionViewProps,
  type CornerRadiusTuple,
} from "./appearance/CornerRadiusSectionView";

// Paint
export {
  PaintItemEditorView,
  type PaintItemEditorViewProps,
  type PaintItemImageOption,
} from "./paint/PaintItemEditorView";
export { GradientPaintControlsView } from "./paint/GradientPaintControlsView";
export {
  FillSectionView,
  type FillSectionViewProps,
  type PaintItemHandlers,
} from "./paint/FillSectionView";
export {
  StrokeSectionView,
  type StrokeAlignId,
  type StrokeCapId,
  type StrokeJoinId,
  type StrokeSectionViewProps,
  STROKE_ALIGN_OPTIONS,
  STROKE_CAP_OPTIONS,
  STROKE_JOIN_OPTIONS,
} from "./paint/StrokeSectionView";
export {
  EffectsSectionView,
  type EffectsSectionViewProps,
  type EffectTypeId,
  type EffectView,
  type BlendModeId,
  EFFECT_TYPE_OPTIONS,
  BLEND_MODE_OPTIONS,
} from "./paint/EffectsSectionView";
export type {
  GradientHandleView,
  GradientStopView,
  ImageScaleModeId,
  PaintGradientView,
  PaintImageView,
  PaintItemView,
  PaintTypeId,
} from "./paint/paint-view-model";
export { PAINT_TYPE_OPTIONS, IMAGE_SCALE_MODE_OPTIONS } from "./paint/paint-options";

// Layout
export {
  AutoLayoutSectionView,
  type AutoLayoutPadding,
  type AutoLayoutPaddingSide,
  type AutoLayoutSectionViewProps,
  type StackAlignId,
  type StackModeId,
  STACK_MODE_OPTIONS,
  STACK_ALIGN_OPTIONS,
} from "./layout/AutoLayoutSectionView";
export {
  LayoutConstraintsSectionView,
  type ConstraintTypeId,
  type LayoutConstraintsSectionViewProps,
  type StackCounterAlignId,
  type StackPositioningId,
  type StackSizingId,
  POSITIONING_OPTIONS,
  SIZING_OPTIONS,
  CONSTRAINT_OPTIONS,
  ALIGN_SELF_OPTIONS,
} from "./layout/LayoutConstraintsSectionView";

// Export
export {
  ExportSettingsSectionView,
  type ExportFormatId,
  type ExportPresetView,
  type ExportSettingsSectionViewProps,
  EXPORT_FORMAT_OPTIONS,
} from "./export/ExportSettingsSectionView";

// Structure
export {
  SectionBehaviorSectionView,
  type SectionBehaviorSectionViewProps,
} from "./structure/SectionBehaviorSectionView";

// Vector
export {
  OutlineSectionView,
  type OutlineSectionViewProps,
} from "./vector/OutlineSectionView";
export {
  VectorPathSectionView,
  type PathEditableCommand,
  type PathEditableCommandType,
  type VectorPathItemView,
  type VectorPathSectionViewProps,
  type WindingRuleId,
  WINDING_OPTIONS,
  PATH_COMMAND_OPTIONS,
  PATH_COMMAND_PARAM_LABELS,
} from "./vector/VectorPathSectionView";

// Component
export {
  ComponentPropertiesSectionView,
  type ComponentPropertiesSectionViewProps,
  type ComponentPropertyTypeId,
  type ComponentPropertyValueView,
  type ResolvedComponentPropertyView,
} from "./component/ComponentPropertiesSectionView";
export {
  VariantPropertiesSectionView,
  type VariantPropertiesSectionViewProps,
  type VariantPropertyView,
} from "./component/VariantPropertiesSectionView";
export {
  ComponentSetVariantsSectionView,
  type ComponentSetVariantsSectionViewProps,
  type VariantChildValueView,
  type VariantDefView,
} from "./component/ComponentSetVariantsSectionView";
export {
  InstanceOverridesSectionView,
  parsePercentInput,
  type InstanceOverrideRowView,
  type InstanceOverridesSectionViewProps,
} from "./component/InstanceOverridesSectionView";

// Text
export {
  TextPropertiesSectionView,
  type AutoResizeId,
  type TextPropertiesSectionViewProps,
  type VerticalAlignId,
} from "./text/TextPropertiesSectionView";
