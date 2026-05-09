/**
 * @file Vector node builder
 */

import { createBaseShapeState, attachBaseShapeMethods, buildBaseData, colorOrPaintToPaint, type FluentShapeBuilder } from "./base";
import type { VectorNodeData } from "./types";
import { SHAPE_NODE_TYPES, WINDING_RULE_VALUES, type WindingRule } from "@higma-document-models/fig/constants";

/** Vector node builder instance */
type VectorNodeBuilderMethods = {
  windingRule: (rule: WindingRule) => VectorNodeBuilder;
  vectorNetworkBlob: (blobIndex: number) => VectorNodeBuilder;
  /**
   * Append an SVG path `d` string. Multiple `.path(...)` calls add
   * additional sub-paths to the same VECTOR node — each becomes one
   * `fillGeometry` slot at write time. The fig-file builder turns
   * each `d` into a path-command blob (the same byte format
   * `encodeRectangleBlob` uses) and registers it via `addBlob`.
   */
  path: (d: string) => VectorNodeBuilder;
  build: () => VectorNodeData;
};

export type VectorNodeBuilder = FluentShapeBuilder<VectorNodeBuilderMethods>;

/** Build vector data from extra state */
function buildVectorData(
  extra: { vectorNetworkBlob?: number },
  state: { width: number; height: number },
): VectorNodeData["vectorData"] {
  if (extra.vectorNetworkBlob === undefined) {
    return undefined;
  }
  return {
    vectorNetworkBlob: extra.vectorNetworkBlob,
    normalizedSize: { x: state.width, y: state.height },
  };
};

/** Create a vector node builder */
function createVectorNodeBuilder(localID: number, parentID: number): VectorNodeBuilder {
  const state = createBaseShapeState(localID, parentID);
  state.name = "Vector";
  state.fillPaints = [colorOrPaintToPaint({ r: 0.5, g: 0.5, b: 0.5, a: 1 })];
  const extra: {
    windingRule: WindingRule;
    vectorNetworkBlob: number | undefined;
    paths: string[];
  } = {
    windingRule: "NONZERO",
    vectorNetworkBlob: undefined,
    paths: [],
  };

  const builder = {} as VectorNodeBuilder;
  Object.assign(builder, attachBaseShapeMethods(state, builder), {
    /** Set winding rule for path filling */
    windingRule(rule: WindingRule) {
      extra.windingRule = rule;
      return builder;
    },
    /** Set vector network blob reference */
    vectorNetworkBlob(blobIndex: number) {
      extra.vectorNetworkBlob = blobIndex;
      return builder;
    },
    /** Append an SVG path `d` string. */
    path(d: string) {
      extra.paths.push(d);
      return builder;
    },
    build(): VectorNodeData {
      const vectorData = buildVectorData(extra, state);
      return {
        ...buildBaseData(state),
        nodeType: SHAPE_NODE_TYPES.VECTOR,
        vectorData,
        paths: extra.paths.length > 0 ? extra.paths : undefined,
        windingRule: extra.windingRule === "EVENODD" ? "EVENODD" : "NONZERO",
        handleMirroring: { value: WINDING_RULE_VALUES[extra.windingRule], name: extra.windingRule },
      };
    },
  });

  return builder;
}

/**
 * Create a new Vector node builder
 */
export function vectorNode(localID: number, parentID: number): VectorNodeBuilder {
  return createVectorNodeBuilder(localID, parentID);
}
