/**
 * @file Domain model for fig design documents
 *
 * High-level, typed representation of .fig files.
 * Consumed by renderer, builder, and editor packages.
 */

// Branded ID types and helpers
export type { FigNodeId, FigPageId } from "./node-id";
export { guidToNodeId, guidToPageId, parseId, toNodeId, toPageId } from "./node-id";

// Document model
export type {
  FigDesignDocument,
  FigDesignNode,
  FigPage,
  AutoLayoutProps,
  LayoutConstraints,
  TextData,
  TextStyleOverride,
  SymbolOverride,
  MutableFigDesignNode,
  ComponentPropertyType,
  ComponentPropertyValue,
  ComponentPropertyDef,
  ComponentPropertyNodeField,
  ComponentPropertyRef,
  ComponentPropertyAssignment,
  VariantPropSpec,
  FigGridTrackPositions,
  FigStyleRegistry,
  FigDesignBlob,
} from "./document";
export type { LoadedFigFile } from "./roundtrip-state";
export type { FigGuid, NodeTreeResult } from "./raw-node-tree";
export type { FigBlob, PathCommand, SvgPathOptions } from "./blob-path";

export {
  DEFAULT_PAGE_BACKGROUND,
  EMPTY_FIG_STYLE_REGISTRY,
  isValidOverridePath,
  isSelfOverride,
  overridePathToIds,
  overrideFieldKeys,
  applyOverrideToNode,
} from "./document";

export { convertFigNode } from "./conversion";

export {
  buildNodeTree,
  guidToString,
  parseGuidString,
  getNodeType,
  findNodesByType,
  findNodeByGuid,
  safeChildren,
} from "./raw-node-tree";

export {
  decodePathCommands,
  pathCommandsToSvgPath,
  decodeBlobToSvgPath,
} from "./blob-path";

export { isVariantSetFrame } from "./variant-set";
