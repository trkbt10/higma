/**
 * @file Node factory for creating FigDesignNode from NodeSpec
 *
 * Converts declarative spec objects into concrete FigDesignNode instances
 * with proper defaults and transforms.
 */

import type { FigMatrix, FigPaint } from "@higma-document-models/fig/types";
import type { FigDesignNode, TextData } from "@higma-document-models/fig/domain";
import { NUMBER_UNITS_VALUES } from "@higma-document-models/fig/constants";
import type { NodeSpec } from "../types/spec-types";
import { nextNodeId } from "../types/node-id";
import type { FigBuilderState } from "../types/node-id";

function textLineHeightSpec(lineHeight: number | undefined): TextData["lineHeight"] | undefined {
  if (lineHeight === undefined) {
    return undefined;
  }
  return { value: lineHeight, units: { name: "PIXELS", value: 0 } };
}

/**
 * Map a CSS-pixel tracking value onto the schema's `FigValueWithUnits`
 * shape with unit PIXELS. Returns undefined when the spec omits
 * letter-spacing, so `document-to-tree` leaves the Kiwi field absent —
 * the caller can later compose this with style-runs without a spurious
 * 0px overlay.
 */
function textLetterSpacingSpec(letterSpacing: number | undefined): TextData["letterSpacing"] | undefined {
  if (letterSpacing === undefined) {
    return undefined;
  }
  return { value: letterSpacing, units: { name: "PIXELS", value: NUMBER_UNITS_VALUES.PIXELS } };
}

// =============================================================================
// Transform Construction
// =============================================================================

/**
 * Create a 2x3 affine transform matrix from position and rotation.
 */
function createTransform(x: number, y: number, rotation?: number): FigMatrix {
  if (rotation === undefined || rotation === 0) {
    return { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y };
  }

  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    m00: cos,
    m01: -sin,
    m02: x,
    m10: sin,
    m11: cos,
    m12: y,
  };
}

// =============================================================================
// Default Paint
// =============================================================================

/**
 * Default fill for shapes when none is specified.
 */
const DEFAULT_SHAPE_FILL: readonly FigPaint[] = [
  {
    type: "SOLID",
    color: { r: 0.85, g: 0.85, b: 0.85, a: 1 },
    visible: true,
    opacity: 1,
  },
];

/**
 * Default fill for text nodes.
 */
const DEFAULT_TEXT_FILL: readonly FigPaint[] = [
  {
    type: "SOLID",
    color: { r: 0, g: 0, b: 0, a: 1 },
    visible: true,
    opacity: 1,
  },
];

/**
 * Default fill for frames (white).
 */
const DEFAULT_FRAME_FILL: readonly FigPaint[] = [
  {
    type: "SOLID",
    color: { r: 1, g: 1, b: 1, a: 1 },
    visible: true,
    opacity: 1,
  },
];

// =============================================================================
// Factory
// =============================================================================

/**
 * CreateNodeFromSpecOptions provides explicit builder state and node spec input for createNodeFromSpec.
 */
export type CreateNodeFromSpecOptions = {
  readonly state: FigBuilderState;
  readonly spec: NodeSpec;
};

/**
 * Create a FigDesignNode from a NodeSpec.
 *
 * Allocates the node ID from the caller-provided builder state.
 *
 * @param spec - Declarative spec describing the node to create
 */
export function createNodeFromSpec(options: CreateNodeFromSpecOptions): FigDesignNode {
  assertCreateNodeOptions(options);
  const { state, spec } = options;
  const nodeId = nextNodeId(state.nodeIdCounter);
  const transform = createTransform(spec.x, spec.y, spec.rotation);
  const size = { x: spec.width, y: spec.height };

  const base: FigDesignNode = {
    id: nodeId,
    type: spec.type,
    name: spec.name ?? getDefaultName(spec.type),
    visible: spec.visible ?? true,
    opacity: spec.opacity ?? 1,
    transform,
    size,
    fills: spec.fills ?? getDefaultFills(spec.type),
    strokes: spec.strokes ?? [],
    strokeWeight: spec.strokeWeight ?? 0,
    effects: spec.effects ?? [],
  };

  return applyTypeSpecificFields(base, spec);
}

/**
 * assertCreateNodeOptions rejects missing explicit builder state or node spec input.
 */
function assertCreateNodeOptions(options: CreateNodeFromSpecOptions): void {
  if (!options) {
    throw new Error("createNodeFromSpec requires options");
  }
  if (!options.state) {
    throw new Error("createNodeFromSpec requires explicit builder state");
  }
  if (!options.spec) {
    throw new Error("createNodeFromSpec requires a node spec");
  }
}

// =============================================================================
// Type-Specific Fields
// =============================================================================

/**
 * applyTypeSpecificFields applies node-kind-specific fields after identifier allocation.
 */
function applyTypeSpecificFields(base: FigDesignNode, spec: NodeSpec): FigDesignNode {
  switch (spec.type) {
    case "FRAME":
      return {
        ...base,
        clipsContent: spec.clipsContent ?? true,
        autoLayout: spec.autoLayout,
        cornerRadius: spec.cornerRadius,
        rectangleCornerRadii: spec.rectangleCornerRadii,
        children: [],
      };

    case "SYMBOL":
      // SYMBOL is the on-disk encoding of the Figma UI concept
      // "Component". It is a container-like node carrying its definition
      // children. See `docs/refactor/component-type-cleanup.md`.
      return {
        ...base,
        clipsContent: spec.clipsContent ?? true,
        autoLayout: spec.autoLayout,
        children: [],
      };

    case "GROUP":
    case "SECTION":
      return {
        ...base,
        children: [],
      };

    case "BOOLEAN_OPERATION":
      return {
        ...base,
        booleanOperation: spec.booleanOperation,
        children: [],
      };

    case "ROUNDED_RECTANGLE":
      return {
        ...base,
        cornerRadius: spec.cornerRadius,
        rectangleCornerRadii: spec.rectangleCornerRadii,
      };

    case "STAR":
      return {
        ...base,
        pointCount: spec.pointCount ?? 5,
        starInnerRadius: spec.starInnerRadius ?? 0.382,
      };

    case "REGULAR_POLYGON":
      return {
        ...base,
        pointCount: spec.pointCount ?? 3,
      };

    case "VECTOR":
      return {
        ...base,
        vectorPaths: spec.vectorPaths,
      };

    case "TEXT":
      return {
        ...base,
        textData: {
          characters: spec.characters,
          fontSize: spec.fontSize ?? 14,
          fontName: {
            family: spec.fontFamily ?? "Inter",
            style: spec.fontStyle ?? "Regular",
            postscript: `${spec.fontFamily ?? "Inter"}-${(spec.fontStyle ?? "Regular").replace(/\s+/g, "")}`,
          },
          textAlignHorizontal: spec.textAlignHorizontal,
          textAlignVertical: spec.textAlignVertical,
          lineHeight: textLineHeightSpec(spec.lineHeight),
          letterSpacing: textLetterSpacingSpec(spec.letterSpacing),
        },
      };

    case "INSTANCE":
      return {
        ...base,
        symbolId: spec.symbolId,
        children: [],
      };

    default:
      return base;
  }
}

// =============================================================================
// Defaults
// =============================================================================

function getDefaultName(type: string): string {
  switch (type) {
    case "RECTANGLE": return "Rectangle";
    case "ROUNDED_RECTANGLE": return "Rectangle";
    case "ELLIPSE": return "Ellipse";
    case "LINE": return "Line";
    case "STAR": return "Star";
    case "REGULAR_POLYGON": return "Polygon";
    case "VECTOR": return "Vector";
    case "FRAME": return "Frame";
    case "GROUP": return "Group";
    case "SECTION": return "Section";
    case "BOOLEAN_OPERATION": return "Union";
    case "TEXT": return "Text";
    // The presentation-layer label for a SYMBOL (Figma's UI concept
    // "Component") is "Component". SYMBOL is the on-disk type;
    // "Component" is the editor-facing label.
    case "SYMBOL": return "Component";
    case "INSTANCE": return "Instance";
    default: return type;
  }
}

function getDefaultFills(type: string): readonly FigPaint[] {
  switch (type) {
    case "TEXT":
      return DEFAULT_TEXT_FILL;
    case "FRAME":
    case "SYMBOL":
      return DEFAULT_FRAME_FILL;
    case "GROUP":
    case "LINE":
    case "BOOLEAN_OPERATION":
      return [];
    default:
      return DEFAULT_SHAPE_FILL;
  }
}
