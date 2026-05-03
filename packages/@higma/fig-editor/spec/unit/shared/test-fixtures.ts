/** @file Shared test fixtures for fig-editor unit tests. */

import type { FigDesignNode, FigNodeId } from "@higma/fig/domain";

export type TestDesignNodeOverrides = {
  readonly fills?: FigDesignNode["fills"];
  readonly strokes?: FigDesignNode["strokes"];
  readonly strokeWeight?: number;
  readonly effects?: FigDesignNode["effects"];
};

export function createTestDesignNode(overrides: TestDesignNodeOverrides = {}): FigDesignNode {
  return {
    id: "test-node" as FigNodeId,
    type: "RECTANGLE",
    name: "Rectangle",
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: 100, y: 100 },
    fills: overrides.fills ?? [],
    strokes: overrides.strokes ?? [],
    strokeWeight: overrides.strokeWeight ?? 0,
    effects: overrides.effects ?? [],
  };
}
