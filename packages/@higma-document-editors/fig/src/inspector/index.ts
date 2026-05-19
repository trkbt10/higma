/**
 * @file Public inspector exports for the Fig editor package.
 */
export {
  FigInspectorProvider,
  useFigInspectorContextOptional,
  type FigInspectorContextValue,
  type FigInspectorProviderProps,
} from "./FigInspectorContext";
export { FigInspectorOverlay } from "./FigInspectorOverlay";
export {
  FIG_LEGEND_ORDER,
  FIG_NODE_CATEGORY_REGISTRY,
  classifyFigNode,
  type FigNodeCategory,
} from "./fig-node-categories";
export {
  collectFigInspectorBoxes,
  figNodeToInspectorTree,
  type FigInspectorProjectionOptions,
} from "./fig-inspector-projection";
