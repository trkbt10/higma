/**
 * @file Text properties section adapter
 *
 * Wires the kernel TextPropertiesSectionView to FigDesignNode.textData. The
 * formatting block and horizontal-justify block come from upper-layer shared
 * editors and are passed in as slots, because they depend on FigDesignNode's
 * text shape and surface-level controls that the kernel cannot import.
 */

import { useCallback } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { TextData } from "@higma-document-models/fig/domain";
import type { KiwiEnumValue } from "@higma-document-models/fig/types";
import { TextFormattingEditor } from "@higma-editor-surfaces/controls/text";
import type { TextFormatting, TextFormattingFeatures } from "@higma-editor-surfaces/controls/text";
import { TextJustifySection } from "react-editor-ui/sections/TextJustifySection";
import type { TextJustifyData } from "@higma-editor-kernel/core/adapter-types";
import {
  TextPropertiesSectionView,
  type AutoResizeId,
  type VerticalAlignId,
} from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import {
  figTextToFormatting,
  applyFormattingUpdate,
  getAutoResize,
  makeAutoResizeEnum,
  type FigTextAutoResize,
} from "./fig-text-adapter";
import { createPropertyPrimaryUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";

const FIG_TEXT_FEATURES: TextFormattingFeatures = {
  showFontFamily: true,
  showFontSize: true,
  showBold: true,
  showItalic: true,
  showUnderline: true,
  showStrikethrough: true,
  showTextColor: false,
  showHighlight: false,
  showSuperSubscript: false,
  showUnderlineStyle: false,
  showStrikeStyle: false,
  showCaps: false,
  showSpacing: true,
};

type TextJustify = "left" | "center" | "right" | "justify";

const H_ALIGN_TO_JUSTIFY: Record<string, TextJustify> = {
  LEFT: "left",
  CENTER: "center",
  RIGHT: "right",
  JUSTIFIED: "justify",
};

const JUSTIFY_TO_H_ALIGN: Record<string, { name: string; value: number }> = {
  left: { name: "LEFT", value: 0 },
  center: { name: "CENTER", value: 1 },
  right: { name: "RIGHT", value: 2 },
  justify: { name: "JUSTIFIED", value: 3 },
};

const VERTICAL_ALIGN_VALUES: Record<VerticalAlignId, number> = {
  TOP: 0,
  CENTER: 1,
  BOTTOM: 2,
};

function kiwiName(value: unknown): string {
  if (!value) {return "";}
  if (typeof value === "string") {return value;}
  if (typeof value === "object" && value !== null && "name" in value) {
    return (value as { name: string }).name ?? "";
  }
  return "";
}

function makeKiwiEnum(name: string, value: number) {
  return { value, name } as KiwiEnumValue;
}

type KiwiLineHeight = { readonly value: number; readonly units: KiwiEnumValue };
const PIXELS_UNITS = { value: 0, name: "PIXELS" } as KiwiEnumValue;

function mergeTextDataLineHeight(existing: KiwiLineHeight | undefined, newValue: number): KiwiLineHeight {
  return existing ? { ...existing, value: newValue } : { value: newValue, units: PIXELS_UNITS };
}

type TextPropertiesSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

/** Panel section for editing text formatting and layout properties of a Figma text node. */
export function TextPropertiesSection({ node, target, dispatch }: TextPropertiesSectionProps) {
  const textData = node.textData;
  if (!textData) {
    return null;
  }

  const updateTextData = useCallback(
    (updater: (td: TextData) => TextData) => {
      dispatch(createPropertyPrimaryUpdateAction({
        target,
        updater: (n) => {
          if (!n.textData) {return n;}
          return { ...n, textData: updater(n.textData) };
        },
      }));
    },
    [dispatch, target],
  );

  const textFormatting = figTextToFormatting(textData);
  const handleFormattingChange = useCallback(
    (update: Partial<TextFormatting>) => {
      updateTextData((td) => applyFormattingUpdate(td, update));
    },
    [updateTextData],
  );

  const hAlign = kiwiName(textData.textAlignHorizontal);
  const justifyData: TextJustifyData = { align: H_ALIGN_TO_JUSTIFY[hAlign] ?? "left" };
  const handleJustifyChange = useCallback(
    (data: TextJustifyData) => {
      const mapped = JUSTIFY_TO_H_ALIGN[data.align];
      if (mapped) {
        updateTextData((td) => ({
          ...td,
          textAlignHorizontal: makeKiwiEnum(mapped.name, mapped.value),
        }));
      }
    },
    [updateTextData],
  );

  const lineHeight = textData.lineHeight;
  const lineHeightMultiplier = lineHeight
    ? Math.round((lineHeight.value / textData.fontSize) * 100) / 100
    : undefined;

  const verticalAlign = (kiwiName(textData.textAlignVertical) || "TOP") as VerticalAlignId;
  const autoResize = getAutoResize(textData) as AutoResizeId;

  return (
    <TextPropertiesSectionView
      characters={textData.characters}
      onCharactersChange={(value) => updateTextData((td) => ({ ...td, characters: value }))}
      formattingSlot={
        <TextFormattingEditor
          value={textFormatting}
          onChange={handleFormattingChange}
          features={FIG_TEXT_FEATURES}
        />
      }
      justifySlot={
        <TextJustifySection
          data={justifyData}
          onChange={handleJustifyChange}
          size="sm"
        />
      }
      lineHeightMultiplier={lineHeightMultiplier}
      onLineHeightMultiplierChange={(multiplier) => updateTextData((td) => ({
        ...td,
        lineHeight: mergeTextDataLineHeight(td.lineHeight, multiplier * td.fontSize),
      }))}
      verticalAlign={verticalAlign}
      onVerticalAlignChange={(value) => updateTextData((td) => ({
        ...td,
        textAlignVertical: makeKiwiEnum(value, VERTICAL_ALIGN_VALUES[value]),
      }))}
      autoResize={autoResize}
      onAutoResizeChange={(value) => updateTextData((td) => ({
        ...td,
        textAutoResize: makeAutoResizeEnum(value as FigTextAutoResize),
      }))}
    />
  );
}
