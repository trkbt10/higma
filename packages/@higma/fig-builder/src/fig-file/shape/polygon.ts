/**
 * @file Polygon node builder
 */

import { createBaseShapeState, attachBaseShapeMethods, buildBaseData, colorOrPaintToPaint, type FluentShapeBuilder } from "./base";
import type { PolygonNodeData } from "./types";
import { SHAPE_NODE_TYPES } from "@higma/fig/constants";

/** Polygon node builder instance */
type PolygonNodeBuilderMethods = {
  sides: (count: number) => PolygonNodeBuilder;
  build: () => PolygonNodeData;
};

export type PolygonNodeBuilder = FluentShapeBuilder<PolygonNodeBuilderMethods>;

/** Create a polygon node builder */
function createPolygonNodeBuilder(localID: number, parentID: number): PolygonNodeBuilder {
  const state = createBaseShapeState(localID, parentID);
  state.name = "Polygon";
  state.fillPaints = [colorOrPaintToPaint({ r: 0.4, g: 0.6, b: 1, a: 1 })];
  const extra = { pointCount: 6 };

  const builder = {} as PolygonNodeBuilder;
  Object.assign(builder, attachBaseShapeMethods(state, builder), {
    /** Set number of sides */
    sides(count: number) {
      extra.pointCount = Math.max(3, Math.round(count));
      return builder;
    },
    build(): PolygonNodeData {
      return { ...buildBaseData(state), nodeType: SHAPE_NODE_TYPES.REGULAR_POLYGON, pointCount: extra.pointCount };
    },
  });

  return builder;
}

/**
 * Create a new Polygon node builder
 */
export function polygonNode(localID: number, parentID: number): PolygonNodeBuilder {
  return createPolygonNodeBuilder(localID, parentID);
}
