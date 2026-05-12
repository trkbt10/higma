/**
 * @file Text property extraction
 *
 * Extracts text rendering properties from either FigDesignNode (domain)
 * or FigNode (raw parser type). The structural input type `TextNodeInput`
 * is satisfied by both, allowing a single extraction function to serve
 * both the scene-graph path and Direct SVG path.
 */

import type {
  FigPaint,
  FigMatrix,
  FigVector,
  FigValueWithUnits,
  KiwiEnumValue,
  FigNode,
} from "@higma-document-models/fig/types";
import type {
  ExtractedTextProps,
  TextAlignHorizontal,
  TextAlignVertical,
  TextCase,
  TextDecoration,
} from "./types";
import type { TextAutoResize } from "@higma-document-models/fig/scene-graph";
import { figmaFontToQuery } from "@higma-document-models/fig/font";

/**
 * Structured text data fields.
 *
 * Picked from FigNode's text-related fields. This is the same set of fields
 * that FigDesignNode.textData provides in domain form, and that FigNode
 * carries directly on the node object.
 *
 * SoT: FigNode type in @higma-document-models/fig/types.
 */
type TextDataFields = Pick<FigNode,
  | "characters"
  | "fontSize"
  | "fontName"
  | "letterSpacing"
  | "lineHeight"
  | "textAlignHorizontal"
  | "textAlignVertical"
  | "textAutoResize"
  | "textDecoration"
  | "textCase"
>;

/**
 * Input for extractTextProps.
 *
 * Accepted by both FigDesignNode (scene-graph path) and FigNode (direct SVG path).
 * FigDesignNode provides text fields via the structured `textData` object.
 * FigNode carries them as flat fields and satisfies this via the index signature.
 */
export type TextNodeInput = {
  readonly transform?: FigMatrix;
  readonly opacity?: number;
  readonly size?: FigVector;
  /** Structured text data (FigDesignNode.textData or compatible) */
  readonly textData?: TextDataFields;
  /** Domain fill paints (FigDesignNode.fills) */
  readonly fills?: readonly FigPaint[];
  /** Raw parser fill paints (FigNode.fillPaints) */
  readonly fillPaints?: readonly FigPaint[];
  /** Index signature for FigNode compatibility (additional Kiwi fields) */
  readonly [key: string]: unknown;
};

/**
 * Get numeric value from value-with-units structure
 *
 * Handles both direct number values and Figma's value-with-units format
 * which specifies values in different units (PIXELS, PERCENT, etc.)
 *
 * @param val - Raw value (number or value-with-units object)
 * @param defaultValue - Default if value is undefined
 * @param fontSize - Font size for percent calculations
 * @returns Resolved numeric value
 */
export function getValueWithUnits(val: FigValueWithUnits | number | undefined, defaultValue: number, fontSize?: number): number {
  if (typeof val === "number") {
    return val;
  }
  if (val && typeof val === "object" && "value" in val) {
    const units = val.units;
    const unitsName = typeof units === "string" ? units : units?.name;

    if (unitsName === "PERCENT" && fontSize) {
      return (val.value / 100) * fontSize;
    }
    // RAW = unitless em-relative multiplier (e.g., lineHeight 1.4 = 1.4 × fontSize)
    if (unitsName === "RAW" && fontSize) {
      return val.value * fontSize;
    }
    return val.value;
  }
  return defaultValue;
}

/**
 * Get enum name from Figma enum object (KiwiEnumValue)
 */
function getEnumName<T extends string>(enumObj: KiwiEnumValue | string | undefined, defaultValue: T): T {
  if (typeof enumObj === "string") {
    return enumObj as T;
  }
  if (enumObj && typeof enumObj === "object" && "name" in enumObj) {
    return enumObj.name as T;
  }
  return defaultValue;
}

/**
 * Apply textCase transformation to characters.
 *
 * Figma's textCase controls how the text is displayed without
 * modifying the underlying character data. The transformation must
 * be applied before rendering.
 */
function applyTextCase(characters: string, textCase: TextCase): string {
  switch (textCase) {
    case "UPPER":
      return characters.toUpperCase();
    case "LOWER":
      return characters.toLowerCase();
    case "TITLE":
      // Capitalize first letter of each word
      return characters.replace(/\b\w/g, (c) => c.toUpperCase());
    case "SMALL_CAPS":
    case "SMALL_CAPS_FORCED":
      // Small caps is an OpenType feature, not a simple text transform.
      // For path rendering, uppercase is a reasonable approximation.
      return characters.toUpperCase();
    default:
      return characters;
  }
}

/**
 * Extract text properties from a FigDesignNode or FigNode.
 *
 * For FigDesignNode: reads typed `textData` field (which holds the
 * structured text properties).
 * For FigNode: reads the same fields directly via the index signature.
 *
 * @param node - FigDesignNode or FigNode (structural match via TextNodeInput)
 * @returns Extracted text properties
 */
export function extractTextProps(node: TextNodeInput): ExtractedTextProps {
  const transform = node.transform;
  const opacity = node.opacity ?? 1;
  const td = node.textData;
  // For FigNode the flat fields live directly on the node; cast through
  // TextDataFields to reuse the same readers as the FigDesignNode path.
  const raw = node as TextDataFields;

  const characters = td?.characters ?? raw?.characters ?? "";
  const textCase = getEnumName<TextCase>(
    td?.textCase ?? raw?.textCase,
    "ORIGINAL",
  );
  const transformedCharacters = applyTextCase(characters, textCase);
  const hasVisibleText = transformedCharacters.length > 0;

  const fontSizeValue = td?.fontSize ?? raw?.fontSize;
  if (hasVisibleText && typeof fontSizeValue !== "number") {
    throw new Error("TEXT node requires fontSize for non-empty characters");
  }
  const fontSize = typeof fontSizeValue === "number" ? fontSizeValue : 0;

  const fontName = td?.fontName ?? raw?.fontName;
  if (hasVisibleText && !fontName?.family) {
    throw new Error("TEXT node requires fontName.family for non-empty characters");
  }
  const font = figmaFontToQuery(fontName);

  // Letter spacing
  const letterSpacingRaw = td?.letterSpacing ?? raw?.letterSpacing;
  const letterSpacing = getValueWithUnits(letterSpacingRaw, 0, fontSize);

  const lineHeightRaw = td?.lineHeight ?? raw?.lineHeight;
  if (hasVisibleText && lineHeightRaw === undefined) {
    throw new Error("TEXT node requires lineHeight for non-empty characters");
  }
  const lineHeight = getValueWithUnits(lineHeightRaw, 0, fontSize);

  // Text alignment
  const textAlignHorizontal = getEnumName<TextAlignHorizontal>(
    td?.textAlignHorizontal ?? raw?.textAlignHorizontal,
    "LEFT",
  );
  const textAlignVertical = getEnumName<TextAlignVertical>(
    td?.textAlignVertical ?? raw?.textAlignVertical,
    "TOP",
  );

  // Size of text box
  const size = node.size ? { width: node.size.x ?? 0, height: node.size.y ?? 0 } : undefined;

  // Text auto-resize mode
  const textAutoResize = getEnumName<TextAutoResize>(
    td?.textAutoResize ?? raw?.textAutoResize,
    "WIDTH_AND_HEIGHT",
  );

  // Text decoration (underline, strikethrough)
  const textDecoration = getEnumName<TextDecoration>(
    td?.textDecoration ?? raw?.textDecoration,
    "NONE",
  );

  return {
    transform,
    characters: transformedCharacters,
    fontSize,
    font,
    letterSpacing: letterSpacing !== 0 ? letterSpacing : undefined,
    lineHeight,
    fillPaints: node.fills ?? node.fillPaints,
    opacity,
    textAlignHorizontal,
    textAlignVertical,
    textAutoResize,
    textDecoration,
    size,
  };
}
