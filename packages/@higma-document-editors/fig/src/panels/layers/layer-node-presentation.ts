/**
 * @file Layer panel node presentation rules.
 *
 * The on-disk schema has no COMPONENT / COMPONENT_SET NodeType — a
 * Figma "Component" is encoded as a SYMBOL and a "Component Set" /
 * "Variant Set" is a FRAME bearing variant metadata. See
 * `docs/refactor/component-type-cleanup.md`.
 *
 * Variant-Set badge distinction is a UI/presentation concern that
 * lives in this module's caller — it cannot be inferred from
 * `node.type` alone. Callers pass `kind: "variant-set"` when the
 * surrounding tree-walk classifier identifies a Variant Set FRAME.
 */

import type { CSSProperties } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";

export type LayerNodeBadge = {
  readonly label: string;
  readonly color: string;
};

export type LayerNodePresentation = {
  readonly iconColor: string | undefined;
  readonly rowStyle: CSSProperties | undefined;
  readonly badge: LayerNodeBadge | undefined;
};

/**
 * Presentation-layer classification of a node beyond its disk type.
 *
 * `"variant-set"` is a FRAME that carries Variant-Set metadata
 * (`isStateGroup` + VARIANT-typed `componentPropDefs`). The disk type
 * is still FRAME; only callers that walk the tree can determine this.
 */
export type LayerNodeKind = "variant-set" | undefined;

const INSTANCE_COLOR = "#9747FF";
const FRAME_COLOR = "#248EFF";
const SYMBOL_COLOR = "#10B981";

const INSTANCE_ROW_STYLE: CSSProperties = {
  backgroundColor: "rgba(151, 71, 255, 0.06)",
};

const FRAME_ROW_STYLE: CSSProperties = {
  backgroundColor: "rgba(36, 142, 255, 0.05)",
};

const COMPONENT_ROW_STYLE: CSSProperties = {
  backgroundColor: "rgba(151, 71, 255, 0.08)",
};

const SYMBOL_ROW_STYLE: CSSProperties = {
  backgroundColor: "rgba(16, 185, 129, 0.07)",
};

function createBadge(label: string, color: string): LayerNodeBadge {
  return { label, color };
}

function getStandaloneBadge(
  nodeType: FigDesignNode["type"],
  kind: LayerNodeKind,
): LayerNodeBadge | undefined {
  if (kind === "variant-set") {
    return createBadge("Set", INSTANCE_COLOR);
  }
  switch (nodeType) {
    case "FRAME":
      return createBadge("Frame", FRAME_COLOR);
    case "SYMBOL":
      // Presentation-layer label for the SYMBOL disk type follows the
      // Figma UI: a top-level SYMBOL surfaces as "Component".
      return createBadge("Component", INSTANCE_COLOR);
    case "INSTANCE":
      return createBadge("Instance", INSTANCE_COLOR);
    default:
      return undefined;
  }
}

function getStandaloneRowStyle(
  nodeType: FigDesignNode["type"],
  kind: LayerNodeKind,
): CSSProperties | undefined {
  if (kind === "variant-set") {
    return COMPONENT_ROW_STYLE;
  }
  switch (nodeType) {
    case "FRAME":
      return FRAME_ROW_STYLE;
    case "SYMBOL":
      return SYMBOL_ROW_STYLE;
    case "INSTANCE":
      return INSTANCE_ROW_STYLE;
    default:
      return undefined;
  }
}

/** Resolves icon tint, row background, and badge data for a layer tree row. */
export function resolveLayerNodePresentation(
  nodeType: FigDesignNode["type"],
  isInstanceContext: boolean,
  kind: LayerNodeKind = undefined,
): LayerNodePresentation {
  if (isInstanceContext) {
    return {
      iconColor: INSTANCE_COLOR,
      rowStyle: INSTANCE_ROW_STYLE,
      badge: createBadge("Inherited", INSTANCE_COLOR),
    };
  }
  return {
    iconColor: getStandaloneBadge(nodeType, kind)?.color,
    rowStyle: getStandaloneRowStyle(nodeType, kind),
    badge: getStandaloneBadge(nodeType, kind),
  };
}
