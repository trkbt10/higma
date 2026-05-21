/**
 * @file Text property extraction
 *
 * Extracts text rendering properties from Kiwi FigNode-shaped input.
 */

import type {
  FigPaint,
  FigMatrix,
  FigVector,
  FigValueWithUnits,
  KiwiEnumValue,
  FigNode,
  FigDerivedTextData,
} from "@higma-document-models/fig/types";
import type {
  ExtractedTextProps,
  TextAlignHorizontal,
  TextAlignVertical,
  TextCase,
  TextDecoration,
} from "./types";
import type { TextAutoResize } from "@higma-document-renderers/fig/scene-graph";
import { TEXT_AUTO_RESIZE_OMITTED_DEFAULT } from "@higma-document-models/fig/constants";
import { figmaTextFontToQuery } from "@higma-document-models/fig/font";

/**
 * Structured text data fields.
 *
 * Picked from FigNode's text-related fields.
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
 * FigNode carries text fields directly and may also carry the nested
 * `textData` payload for per-character styling.
 */
export type TextNodeInput = {
  readonly transform?: FigMatrix;
  readonly opacity?: number;
  readonly size?: FigVector;
  /** Kiwi TextData payload. */
  readonly textData?: TextDataFields;
  /** Kiwi precomputed text metrics. */
  readonly derivedTextData?: FigDerivedTextData;
  /** Kiwi fill paints. */
  readonly fillPaints?: readonly FigPaint[];
  /** Shared fill style reference resolved by text rendering before extraction. */
  readonly styleIdForFill?: FigNode["styleIdForFill"];
  /** Additional Kiwi fields carried by FigNode. */
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
  if (!val || typeof val !== "object" || !("value" in val)) {
    return defaultValue;
  }
  const units = val.units;
  const unitsName = typeof units === "string" ? units : units?.name;
  if (!fontSize) {
    return val.value;
  }
  if (unitsName === "PERCENT") {
    return (val.value / 100) * fontSize;
  }
  // RAW = unitless em-relative multiplier (e.g., lineHeight 1.4 = 1.4 × fontSize)
  if (unitsName === "RAW") {
    return val.value * fontSize;
  }
  return val.value;
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
 * Extract text properties from a FigNode-shaped value.
 *
 * @param node - FigNode-shaped text input
 * @returns Extracted text properties
 */
export function extractTextProps(node: TextNodeInput): ExtractedTextProps {
  const transform = node.transform;
  const opacity = node.opacity ?? 1;
  const td = node.textData;
  // Flat Kiwi fields live directly on the node; cast through
  // TextDataFields to keep the readers typed.
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
  const font = figmaTextFontToQuery(fontName, node.derivedTextData?.fontMetaData);

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

  // Text auto-resize mode.
  // Default = schema's value-0 entry (NONE) — the Kiwi binary's "omitted
  // field = first enum value" semantic. WIDTH_AND_HEIGHT would mean
  // "grow to content, no wrap" and silently disagrees with what Figma
  // reads back from the same omitted field.
  const textAutoResize = getEnumName<TextAutoResize>(
    td?.textAutoResize ?? raw?.textAutoResize,
    TEXT_AUTO_RESIZE_OMITTED_DEFAULT,
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
    fillPaints: node.fillPaints,
    opacity,
    textAlignHorizontal,
    textAlignVertical,
    textAutoResize,
    textDecoration,
    size,
  };
}
