/**
 * @file SVG renderer barrel export
 */

export {
  type SvgString,
  unsafeSvg,
  EMPTY_SVG,
  buildAttrs,
  svg,
  g,
  defs,
  path,
  rect,
  circle,
  ellipse,
  line,
  text,
  tspan,
  image,
  linearGradient,
  radialGradient,
  stop,
  clipPath,
  mask,
} from "./primitives";

export {
  buildTransformAttr,
} from "./transform";

export {
  type FigSvgRenderOptions,
  renderFigToSvg,
  renderCanvas,
} from "./renderer";

export {
  type FigNodeViewport,
  requireFigNodeViewport,
} from "./node-viewport";

export {
  renderSceneGraphToSvg,
  formatRenderTreeToSvg,
} from "./scene-renderer";

export {
  type EffectExpansion,
  computeNodeEffectExpansion,
  computeRootEffectExpansion,
} from "./effect-bounds";

export {
  type FigExportBox,
  type FigChildrenOf,
  type ComputeFigExportBoundsOptions,
  computeFigExportBounds,
  computeFigExportViewport,
} from "./export-bounds";
