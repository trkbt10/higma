/**
 * @file Fig text formatting adapter
 *
 * Converts between FigDesignNode.textData and the generic TextFormatting /
 * ParagraphFormatting types used by the shared editor controls
 * (TextFormattingEditor, ParagraphFormattingEditor).
 *
 * This follows the same adapter pattern as pptx-text-adapter.ts:
 * domain type → generic type for UI, generic update → domain updater.
 */

import type { TextData } from "@higma-document-models/fig/domain";
import type { KiwiEnumValue } from "@higma-document-models/fig/types";
import { figmaFontToQuery, fontQueryToStyleName, isItalic, FONT_WEIGHTS } from "@higma-document-models/fig/font";
import type { TextFormatting, ParagraphFormatting, HorizontalAlignment } from "@higma-editor-surfaces/controls/text";

// =============================================================================
// KiwiEnumValue helpers
// =============================================================================

type LetterSpacing = { readonly value: number; readonly units: KiwiEnumValue };
const DEFAULT_LETTER_SPACING_UNITS: KiwiEnumValue = { value: 0, name: "PIXELS" } as KiwiEnumValue;

function mergeLetterSpacing(existing: LetterSpacing | undefined, newValue: number): LetterSpacing {
  return existing ? { ...existing, value: newValue } : { value: newValue, units: DEFAULT_LETTER_SPACING_UNITS };
}

function mergeLineHeight(existing: LetterSpacing | undefined, newValue: number): LetterSpacing {
  return existing ? { ...existing, value: newValue } : { value: newValue, units: DEFAULT_LETTER_SPACING_UNITS };
}

function kiwiName(value: KiwiEnumValue | undefined): string {
  if (!value) {return "";}
  return typeof value === "string" ? value : value.name ?? "";
}

function makeKiwiEnum(name: string, value: number): KiwiEnumValue {
  return { value, name } as KiwiEnumValue;
}

// =============================================================================
// TextData → TextFormatting
// =============================================================================

/**
 * Extract generic TextFormatting from fig's TextData.
 *
 * Bold / italic come from the canonical `figmaFontToQuery` SoT —
 * weight ≥ 600 maps to bold, italic detection delegates to
 * `isItalic`. Re-implementing `style.includes("bold")` here would
 * disagree with cache keys and resolver lookups elsewhere.
 */
export function figTextToFormatting(td: TextData): TextFormatting {
  const query = figmaFontToQuery(td.fontName);
  return {
    fontFamily: td.fontName.family,
    fontSize: td.fontSize,
    bold: query.weight >= FONT_WEIGHTS.SEMI_BOLD,
    italic: query.style === "italic" || query.style === "oblique",
    underline: kiwiName(td.textDecoration) === "UNDERLINE",
    strikethrough: kiwiName(td.textDecoration) === "STRIKETHROUGH",
    letterSpacing: td.letterSpacing?.value,
  };
}

/**
 * Apply a TextFormatting update to TextData, returning the updated TextData.
 */
export function applyFormattingUpdate(td: TextData, update: Partial<TextFormatting>): TextData {
  let result = td;

  if (update.fontFamily !== undefined) {
    result = {
      ...result,
      fontName: { ...result.fontName, family: update.fontFamily },
    };
  }

  if (update.fontSize !== undefined) {
    result = { ...result, fontSize: update.fontSize };
  }

  // Bold/italic: reconstruct fontName.style from toggles.
  //
  // Read the current state via the canonical `figmaFontToQuery` SoT so
  // we always agree with the resolver / cache about what the prior
  // state was. Then build the next style string via the inverse
  // canonical SoT (`fontQueryToStyleName`) so the result round-trips
  // back to the same FontQuery on the next read. Anywhere that hand-
  // assembles "Bold Italic" risks emitting a label `detectWeight`
  // doesn't recognise.
  if (update.bold !== undefined || update.italic !== undefined) {
    const currentQuery = figmaFontToQuery(result.fontName);
    const currentBold = currentQuery.weight >= FONT_WEIGHTS.SEMI_BOLD;
    const currentItalic = isItalic(result.fontName.style);
    const nextBold = update.bold ?? currentBold;
    const nextItalic = update.italic ?? currentItalic;
    // Bold toggle picks 700 vs 400 — preserving non-bold weights other
    // than 400 (Light, Medium, …) on a pure italic toggle is out of
    // scope of a simple bold/italic editor; consumers needing fine-grained
    // weight control go through the FontFamilySelect picker instead.
    const newStyle = fontQueryToStyleName({
      family: result.fontName.family,
      weight: nextBold ? FONT_WEIGHTS.BOLD : FONT_WEIGHTS.REGULAR,
      style: nextItalic ? "italic" : "normal",
    });
    result = {
      ...result,
      fontName: { ...result.fontName, style: newStyle },
    };
  }

  if (update.underline !== undefined || update.strikethrough !== undefined) {
    const decoration = update.strikethrough ? "STRIKETHROUGH" : update.underline ? "UNDERLINE" : "NONE";
    result = {
      ...result,
      textDecoration: makeKiwiEnum(decoration, decoration === "NONE" ? 0 : decoration === "UNDERLINE" ? 1 : 2),
    };
  }

  if (update.letterSpacing !== undefined) {
    result = {
      ...result,
      letterSpacing: mergeLetterSpacing(result.letterSpacing, update.letterSpacing),
    };
  }

  return result;
}

// =============================================================================
// TextData → ParagraphFormatting
// =============================================================================

const H_ALIGN_MAP: Record<string, HorizontalAlignment> = {
  LEFT: "left",
  CENTER: "center",
  RIGHT: "right",
  JUSTIFIED: "justify",
};

const H_ALIGN_REVERSE: Record<string, { name: string; value: number }> = {
  left: { name: "LEFT", value: 0 },
  center: { name: "CENTER", value: 1 },
  right: { name: "RIGHT", value: 2 },
  justify: { name: "JUSTIFIED", value: 3 },
};

/**
 * Extract generic ParagraphFormatting from fig's TextData.
 */
export function figTextToParagraphFormatting(td: TextData): ParagraphFormatting {
  const hAlign = kiwiName(td.textAlignHorizontal);
  const lineHeight = td.lineHeight;

  return {
    alignment: H_ALIGN_MAP[hAlign] ?? "left",
    lineSpacing: lineHeight ? lineHeight.value / td.fontSize : undefined,
  };
}

/**
 * Apply a ParagraphFormatting update to TextData.
 */
export function applyParagraphUpdate(td: TextData, update: Partial<ParagraphFormatting>): TextData {
  let result = td;

  if (update.alignment !== undefined) {
    const mapped = H_ALIGN_REVERSE[update.alignment];
    if (mapped) {
      result = {
        ...result,
        textAlignHorizontal: makeKiwiEnum(mapped.name, mapped.value),
      };
    }
  }

  if (update.lineSpacing !== undefined) {
    const lineHeightValue = update.lineSpacing * result.fontSize;
    result = {
      ...result,
      lineHeight: mergeLineHeight(result.lineHeight, lineHeightValue),
    };
  }

  return result;
}

// =============================================================================
// textAutoResize helpers
// =============================================================================

export type FigTextAutoResize = "WIDTH_AND_HEIGHT" | "HEIGHT" | "NONE";

const AUTO_RESIZE_VALUES: Record<FigTextAutoResize, number> = {
  WIDTH_AND_HEIGHT: 0,
  HEIGHT: 1,
  NONE: 2,
};






/** Returns the text auto-resize mode from a Figma TextData node. */
export function getAutoResize(td: TextData): FigTextAutoResize {
  const name = kiwiName(td.textAutoResize);
  if (name === "HEIGHT" || name === "NONE") {return name;}
  return "WIDTH_AND_HEIGHT";
}






/** Converts a FigTextAutoResize mode to its corresponding Kiwi enum value. */
export function makeAutoResizeEnum(mode: FigTextAutoResize): KiwiEnumValue {
  return makeKiwiEnum(mode, AUTO_RESIZE_VALUES[mode]);
}
