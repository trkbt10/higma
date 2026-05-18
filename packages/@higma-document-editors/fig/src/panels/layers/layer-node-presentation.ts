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
 *
 * No per-row background tint is returned. A per-row tint stamped on
 * every row composes a banded strip across the panel that operators
 * read as accidental ruled lines ("罫線"). Type identity stays on the
 * coloured leading icon, and on the text badge for the cases where
 * the icon alone is ambiguous ("Set" for variant-set FRAME and
 * "Inherited" for nodes inside an INSTANCE — those distinctions can't
 * be inferred from the icon's shape). Top-level FRAME / SYMBOL /
 * INSTANCE rows do not need a text badge because their icon shape
 * (FrameIcon vs RectIcon vs DiamondIcon) plus icon tint already
 * carries the type signal.
 */

import type { FigDesignNode } from "@higma-document-models/fig/domain";

export type LayerNodeBadge = {
  readonly label: string;
  readonly color: string;
};

export type LayerNodePresentation = {
  readonly iconColor: string | undefined;
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

function createBadge(label: string, color: string): LayerNodeBadge {
  return { label, color };
}

/**
 * Top-level icon tint by disk type. Icon colour is the primary
 * type-identity signal on a layer row (the row bg stays neutral so
 * stacked rows don't read as a banded strip).
 */
function getStandaloneIconColor(
  nodeType: FigDesignNode["type"],
  kind: LayerNodeKind,
): string | undefined {
  if (kind === "variant-set") {
    return INSTANCE_COLOR;
  }
  switch (nodeType) {
    case "FRAME":
      return FRAME_COLOR;
    case "SYMBOL":
      return INSTANCE_COLOR;
    case "INSTANCE":
      return INSTANCE_COLOR;
    default:
      return undefined;
  }
}

/**
 * Text badges are restricted to non-obvious distinctions.
 *
 * - "Set" — a FRAME that is actually a Variant Set. The icon is the
 *   same Frame icon as a regular FRAME, so the text label is the
 *   only way to communicate the distinction.
 * - "Inherited" — a child node living inside an INSTANCE that is
 *   coming from the master SYMBOL. Without the text label the row is
 *   indistinguishable from a freely-edited node.
 *
 * Plain FRAME / SYMBOL / INSTANCE rows return `undefined` — their
 * icon shape + tint already encodes the type, and stamping a third
 * redundant "FRAME" / "COMPONENT" / "INSTANCE" word on every row
 * forces the row label into a strip too narrow to fit any realistic
 * layer name ("App Ic..." truncation).
 */
function getStandaloneBadge(
  nodeType: FigDesignNode["type"],
  kind: LayerNodeKind,
): LayerNodeBadge | undefined {
  if (kind === "variant-set") {
    return createBadge("Set", INSTANCE_COLOR);
  }
  // FRAME, SYMBOL, INSTANCE intentionally return no badge — the icon
  // carries the type identity. See module docblock.
  void nodeType;
  return undefined;
}

/** Resolves icon tint and badge data for a layer tree row. */
export function resolveLayerNodePresentation(
  nodeType: FigDesignNode["type"],
  isInstanceContext: boolean,
  kind: LayerNodeKind = undefined,
): LayerNodePresentation {
  if (isInstanceContext) {
    return {
      iconColor: INSTANCE_COLOR,
      badge: createBadge("Inherited", INSTANCE_COLOR),
    };
  }
  return {
    iconColor: getStandaloneIconColor(nodeType, kind),
    badge: getStandaloneBadge(nodeType, kind),
  };
}
