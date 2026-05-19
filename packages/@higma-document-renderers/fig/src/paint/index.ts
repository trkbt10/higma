/**
 * @file Figma paint interpretation — shared SoT
 *
 * Pure functions that interpret FigPaint objects into platform-agnostic
 * intermediate structures. Both the SVG string renderer and the SceneGraph
 * builder consume these functions, ensuring a single source of truth for
 * gradient direction, stop extraction, image reference resolution, etc.
 *
 * These functions operate on Kiwi FigPaint payloads.
 * They do NOT produce SVG strings or React elements — consumers handle
 * their own output format.
 */

export {
  getGradientStops,
  getGradientDirection,
  getGradientDirectionFromTransform,
  getRadialGradientCenterAndRadius,
  getAngularGradientParams,
  getDiamondGradientParams,
  getImageHash,
  getImageTransform,
  getScaleMode,
  getScalingFactor,
  getPaintFilter,
  getImageShouldColorManage,
  type GradientDirection,
  type RadialGradientParams,
  type AngularGradientParams,
  type DiamondGradientParams,
} from "./interpret";
