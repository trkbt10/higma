/** @file NodeSpec to Kiwi FigNode construction. */

import type { FigGuid, FigMatrix, FigNode } from "@higma-document-models/fig/types";
import { NODE_TYPE_VALUES, NUMBER_UNITS_VALUES, type NodeType } from "@higma-document-models/fig/constants";
import type { NodeSpec, TextNodeSpec } from "../types/spec-types";
import { nextNodeGuid } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";

export type CreateNodeFromSpecOptions = {
  readonly state: FigBuilderState;
  readonly parentGuid: FigGuid;
  readonly position: string;
  readonly spec: NodeSpec;
};

function assertCreateNodeFromSpecOptions(options: CreateNodeFromSpecOptions): void {
  if (options.state === undefined) {
    throw new Error("createNodeFromSpec requires explicit builder state");
  }
  if (options.parentGuid === undefined) {
    throw new Error("createNodeFromSpec requires explicit parentGuid");
  }
  if (typeof options.position !== "string" || options.position.length === 0) {
    throw new Error("createNodeFromSpec requires explicit position");
  }
}

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

function textLineHeightSpec(spec: TextNodeSpec): NonNullable<FigNode["lineHeight"]> {
  if (spec.lineHeight === undefined) {
    throw new Error("createNodeFromSpec: TEXT spec requires explicit lineHeight");
  }
  return { value: spec.lineHeight, units: { name: "PIXELS", value: NUMBER_UNITS_VALUES.PIXELS } };
}

function textLetterSpacingSpec(letterSpacing: number | undefined): FigNode["letterSpacing"] {
  if (letterSpacing === undefined) {
    return undefined;
  }
  return { value: letterSpacing, units: { name: "PIXELS", value: NUMBER_UNITS_VALUES.PIXELS } };
}

function requiredTextFontSize(spec: TextNodeSpec): number {
  if (spec.fontSize === undefined) {
    throw new Error("createNodeFromSpec: TEXT spec requires explicit fontSize");
  }
  return spec.fontSize;
}

function requiredTextFontName(spec: TextNodeSpec): NonNullable<FigNode["fontName"]> {
  if (spec.fontFamily === undefined || spec.fontStyle === undefined) {
    throw new Error("createNodeFromSpec: TEXT spec requires explicit fontFamily and fontStyle");
  }
  return {
    family: spec.fontFamily,
    style: spec.fontStyle,
    postscript: `${spec.fontFamily}-${spec.fontStyle.replace(/\s+/g, "")}`,
  };
}

function baseNode(options: CreateNodeFromSpecOptions): FigNode {
  const { state, parentGuid, position, spec } = options;
  const typeValue = NODE_TYPE_VALUES[spec.type as NodeType];
  if (typeValue === undefined) {
    throw new Error(`createNodeFromSpec: unsupported node type ${spec.type}`);
  }
  return {
    guid: nextNodeGuid(state.nodeGuidCounter),
    parentIndex: { guid: parentGuid, position },
    phase: { value: 0, name: "CREATED" },
    type: { value: typeValue, name: spec.type },
    name: spec.name,
    visible: spec.visible,
    opacity: spec.opacity,
    transform: createTransform(spec.x, spec.y, spec.rotation),
    size: { x: spec.width, y: spec.height },
    fillPaints: spec.fills,
    strokePaints: spec.strokes,
    strokeWeight: spec.strokeWeight,
    strokeCap: spec.strokeCap,
    strokeJoin: spec.strokeJoin,
    strokeAlign: spec.strokeAlign,
    strokeDashes: spec.strokeDashes,
    effects: spec.effects,
    stackPositioning: spec.stackPositioning,
    stackPrimarySizing: spec.stackPrimarySizing,
    stackCounterSizing: spec.stackCounterSizing,
    horizontalConstraint: spec.horizontalConstraint,
    verticalConstraint: spec.verticalConstraint,
    stackChildAlignSelf: spec.stackChildAlignSelf,
    stackChildPrimaryGrow: spec.stackChildPrimaryGrow,
  };
}

/**
 * Convert an explicit node spec into a Kiwi FigNode.
 */
export function createNodeFromSpec(options: CreateNodeFromSpecOptions): FigNode {
  assertCreateNodeFromSpecOptions(options);
  const node = baseNode(options);
  const spec = options.spec;
  switch (spec.type) {
    case "FRAME":
    case "SYMBOL":
      return {
        ...node,
        clipsContent: spec.clipsContent,
        stackMode: spec.stackMode,
        stackSpacing: spec.stackSpacing,
        stackPadding: spec.stackPadding,
        stackVerticalPadding: spec.stackVerticalPadding,
        stackHorizontalPadding: spec.stackHorizontalPadding,
        stackPaddingRight: spec.stackPaddingRight,
        stackPaddingBottom: spec.stackPaddingBottom,
        stackPrimaryAlignItems: spec.stackPrimaryAlignItems,
        stackCounterAlignItems: spec.stackCounterAlignItems,
        stackPrimaryAlignContent: spec.stackPrimaryAlignContent,
        stackCounterAlignContent: spec.stackCounterAlignContent,
        stackWrap: spec.stackWrap,
        stackCounterSpacing: spec.stackCounterSpacing,
        stackReverseZIndex: spec.stackReverseZIndex,
        cornerRadius: spec.type === "FRAME" ? spec.cornerRadius : undefined,
        rectangleCornerRadii: spec.type === "FRAME" ? spec.rectangleCornerRadii : undefined,
      };
    case "BOOLEAN_OPERATION":
      return { ...node, booleanOperation: spec.booleanOperation };
    case "ROUNDED_RECTANGLE":
      return {
        ...node,
        cornerRadius: spec.cornerRadius,
        rectangleCornerRadii: spec.rectangleCornerRadii,
      };
    case "STAR":
    case "REGULAR_POLYGON":
      return { ...node, pointCount: spec.pointCount };
    case "VECTOR":
      return { ...node, vectorPaths: spec.vectorPaths };
    case "TEXT": {
      const fontSize = requiredTextFontSize(spec);
      const fontName = requiredTextFontName(spec);
      const lineHeight = textLineHeightSpec(spec);
      const letterSpacing = textLetterSpacingSpec(spec.letterSpacing);
      return {
        ...node,
        fontSize,
        fontName,
        lineHeight,
        letterSpacing,
        textData: {
          characters: spec.characters,
          fontSize,
          fontName,
          lineHeight,
          letterSpacing,
        },
        textAlignHorizontal: spec.textAlignHorizontal,
        textAlignVertical: spec.textAlignVertical,
      };
    }
    case "INSTANCE":
      return {
        ...node,
        symbolData: { symbolID: spec.symbolId },
      };
    default:
      return node;
  }
}
