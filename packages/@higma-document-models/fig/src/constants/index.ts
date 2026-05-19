/**
 * @file Constants module exports
 *
 * Centralized constants for Figma fig format values.
 * Import from here instead of defining duplicate constants.
 */

// Node types
export {
  NODE_TYPE_VALUES,
  SHAPE_NODE_TYPES,
  type NodeType,
  type ShapeNodeType,
} from "./node-types";

// Paints
export {
  PAINT_TYPE_VALUES,
  BLEND_MODE_VALUES,
  SCALE_MODE_VALUES,
  canonicaliseImageScaleMode,
  type PaintType,
  type BlendMode,
  type ScaleMode,
} from "./paints";

// Strokes
export {
  STROKE_CAP_VALUES,
  STROKE_JOIN_VALUES,
  STROKE_ALIGN_VALUES,
  type StrokeCap,
  type StrokeJoin,
  type StrokeAlign,
} from "./strokes";

// Effects
export { EFFECT_TYPE_VALUES, type EffectType } from "./effects";

// Styles
export { STYLE_TYPE_VALUES, type StyleType } from "./styles";

// Text
export {
  TEXT_ALIGN_H_VALUES,
  TEXT_ALIGN_V_VALUES,
  TEXT_AUTO_RESIZE_OMITTED_DEFAULT,
  TEXT_AUTO_RESIZE_VALUES,
  TEXT_DECORATION_VALUES,
  TEXT_CASE_VALUES,
  NUMBER_UNITS_VALUES,
  type TextAlignHorizontal,
  type TextAlignVertical,
  type TextAutoResize,
  type TextDecoration,
  type TextCase,
  type NumberUnits,
} from "./text";

// Layout
export {
  STACK_MODE_VALUES,
  STACK_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_WRAP_VALUES,
  STACK_COUNTER_ALIGN_VALUES,
  STACK_POSITIONING_VALUES,
  STACK_SIZING_VALUES,
  CONSTRAINT_TYPE_VALUES,
  WINDING_RULE_VALUES,
  resolveStackSizingInput,
  type StackMode,
  type StackAlign,
  type StackJustify,
  type StackWrap,
  type StackCounterAlign,
  type StackPositioning,
  type StackSizing,
  type StackSizingInput,
  type ConstraintType,
  type WindingRule,
} from "./layout";

// Export
export {
  IMAGE_TYPE_VALUES,
  EXPORT_CONSTRAINT_VALUES,
  EXPORT_COLOR_PROFILE_VALUES,
  SVG_ID_MODE_VALUES,
  type ImageType,
  type ExportConstraintType,
  type ExportColorProfile,
  type ExportSVGIDMode,
} from "./export";

// Kiwi enum values
export { kiwiEnumName, toEnumValue, type EnumValue } from "./enum-value";
