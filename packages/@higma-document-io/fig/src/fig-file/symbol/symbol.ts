/**
 * @file Symbol (component definition) node builder
 */

import { createTranslationMatrix } from "@higma-document-models/fig/matrix";
import type { Color, StackPadding } from "../types";
import type { SymbolNodeData } from "./types";
import type { ExportSettings } from "../frame";
import { DEFAULT_SVG_EXPORT_SETTINGS } from "../frame";
import {
  STACK_MODE_VALUES,
  STACK_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_SIZING_VALUES,
  toEnumValue,
  resolveStackSizingInput,
  type StackMode,
  type StackAlign,
  type StackJustify,
  type StackSizing,
  type StackSizingInput,
} from "@higma-document-models/fig/constants";

/** Symbol node builder instance */
export type SymbolNodeBuilder = {
  name: (name: string) => SymbolNodeBuilder;
  size: (width: number, height: number) => SymbolNodeBuilder;
  position: (x: number, y: number) => SymbolNodeBuilder;
  background: (c: Color) => SymbolNodeBuilder;
  /**
   * Drop the SYMBOL's fill stack so it renders without a solid
   * background. Mirrors `frameNode.noFill()` — useful for transparent
   * page-component definitions that should let the wrapper's bg
   * show through every INSTANCE.
   */
  noFill: () => SymbolNodeBuilder;
  clipsContent: (clips: boolean) => SymbolNodeBuilder;
  cornerRadius: (radius: number) => SymbolNodeBuilder;
  visible: (v: boolean) => SymbolNodeBuilder;
  opacity: (o: number) => SymbolNodeBuilder;
  autoLayout: (mode: StackMode) => SymbolNodeBuilder;
  gap: (spacing: number) => SymbolNodeBuilder;
  padding: (value: number | StackPadding) => SymbolNodeBuilder;
  primaryAlign: (align: StackJustify) => SymbolNodeBuilder;
  counterAlign: (align: StackAlign) => SymbolNodeBuilder;
  contentAlign: (align: StackAlign) => SymbolNodeBuilder;
  wrap: (enabled?: boolean) => SymbolNodeBuilder;
  counterGap: (spacing: number) => SymbolNodeBuilder;
  /**
   * Set the SYMBOL's own primary-axis sizing (FIXED / FILL / HUG).
   * HUG (= `RESIZE_TO_FIT_WITH_IMPLICIT_SIZE` on the wire) lets the
   * SYMBOL's authored height grow with its auto-layout content —
   * required for a responsive page component whose paragraphs
   * re-wrap into different line counts per INSTANCE width.
   */
  primarySizing: (sizing: StackSizingInput) => SymbolNodeBuilder;
  /** Set the SYMBOL's own counter-axis sizing (FIXED / FILL / HUG). */
  counterSizing: (sizing: StackSizingInput) => SymbolNodeBuilder;
  primaryGrow: (grow: number) => SymbolNodeBuilder;
  reverseZIndex: (enabled?: boolean) => SymbolNodeBuilder;
  addExportSettings: (settings: ExportSettings) => SymbolNodeBuilder;
  exportAsSVG: () => SymbolNodeBuilder;
  build: () => SymbolNodeData;
};

type SymbolBuilderState = {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  fillColor: Color;
  hasFill: boolean;
  clipsContent: boolean;
  cornerRadius: number | undefined;
  visible: boolean;
  opacity: number;
  exportSettings: ExportSettings[];
  stackMode: StackMode | undefined;
  stackSpacing: number | undefined;
  stackPadding: StackPadding | undefined;
  stackPrimaryAlignItems: StackJustify | undefined;
  stackCounterAlignItems: StackAlign | undefined;
  stackPrimaryAlignContent: StackAlign | undefined;
  stackWrap: boolean | undefined;
  stackCounterSpacing: number | undefined;
  itemReverseZIndex: boolean | undefined;
  stackPrimarySizing: StackSizing | undefined;
  stackCounterSizing: StackSizing | undefined;
  stackChildPrimaryGrow: number | undefined;
};

/** Create a symbol node builder */
function createSymbolNodeBuilder(localID: number, parentID: number): SymbolNodeBuilder {
  const state: SymbolBuilderState = {
    name: "Component",
    width: 200,
    height: 100,
    x: 0,
    y: 0,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    hasFill: true,
    clipsContent: true,
    cornerRadius: undefined,
    visible: true,
    opacity: 1,
    exportSettings: [],
    stackMode: undefined,
    stackSpacing: undefined,
    stackPadding: undefined,
    stackPrimaryAlignItems: undefined,
    stackCounterAlignItems: undefined,
    stackPrimaryAlignContent: undefined,
    stackWrap: undefined,
    stackCounterSpacing: undefined,
    itemReverseZIndex: undefined,
    stackPrimarySizing: undefined,
    stackCounterSizing: undefined,
    stackChildPrimaryGrow: undefined,
  };

  const builder: SymbolNodeBuilder = {
    name(n: string) { state.name = n; return builder; },
    size(width: number, height: number) { state.width = width; state.height = height; return builder; },
    position(x: number, y: number) { state.x = x; state.y = y; return builder; },
    background(c: Color) { state.fillColor = c; state.hasFill = true; return builder; },
    noFill() { state.hasFill = false; return builder; },
    clipsContent(clips: boolean) { state.clipsContent = clips; return builder; },
    cornerRadius(radius: number) { state.cornerRadius = radius; return builder; },
    visible(v: boolean) { state.visible = v; return builder; },
    opacity(o: number) { state.opacity = o; return builder; },
    autoLayout(mode: StackMode) { state.stackMode = mode; return builder; },
    gap(spacing: number) { state.stackSpacing = spacing; return builder; },
    padding(value: number | StackPadding) {
      if (typeof value === "number") {
        state.stackPadding = { top: value, right: value, bottom: value, left: value };
      } else {
        state.stackPadding = value;
      }
      return builder;
    },
    primaryAlign(align: StackJustify) { state.stackPrimaryAlignItems = align; return builder; },
    counterAlign(align: StackAlign) { state.stackCounterAlignItems = align; return builder; },
    contentAlign(align: StackAlign) { state.stackPrimaryAlignContent = align; return builder; },
    wrap(enabled: boolean = true) {
      state.stackWrap = enabled;
      return builder;
    },
    counterGap(spacing: number) { state.stackCounterSpacing = spacing; return builder; },
    primarySizing(sizing: StackSizingInput) { state.stackPrimarySizing = resolveStackSizingInput(sizing); return builder; },
    counterSizing(sizing: StackSizingInput) { state.stackCounterSizing = resolveStackSizingInput(sizing); return builder; },
    primaryGrow(grow: number) { state.stackChildPrimaryGrow = grow; return builder; },
    reverseZIndex(enabled: boolean = true) { state.itemReverseZIndex = enabled; return builder; },
    addExportSettings(settings: ExportSettings) { state.exportSettings.push(settings); return builder; },
    exportAsSVG() { state.exportSettings.push(DEFAULT_SVG_EXPORT_SETTINGS); return builder; },

    build(): SymbolNodeData {
      return {
        localID,
        parentID,
        name: state.name,
        size: { x: state.width, y: state.height },
        transform: createTranslationMatrix(state.x, state.y),
        fillPaints: buildFillPaints(state.hasFill, state.fillColor),
        visible: state.visible,
        opacity: state.opacity,
        clipsContent: state.clipsContent,
        cornerRadius: state.cornerRadius,
        exportSettings: state.exportSettings.length > 0 ? state.exportSettings : undefined,
        stackMode: toEnumValue(state.stackMode, STACK_MODE_VALUES),
        stackSpacing: state.stackSpacing,
        stackPadding: state.stackPadding,
        stackPrimaryAlignItems: toEnumValue(state.stackPrimaryAlignItems, STACK_JUSTIFY_VALUES),
        stackCounterAlignItems: toEnumValue(state.stackCounterAlignItems, STACK_ALIGN_VALUES),
        stackPrimaryAlignContent: toEnumValue(state.stackPrimaryAlignContent, STACK_ALIGN_VALUES),
        stackWrap: state.stackWrap,
        stackCounterSpacing: state.stackCounterSpacing,
        itemReverseZIndex: state.itemReverseZIndex,
        stackPrimarySizing: toEnumValue(state.stackPrimarySizing, STACK_SIZING_VALUES),
        stackCounterSizing: toEnumValue(state.stackCounterSizing, STACK_SIZING_VALUES),
        stackChildPrimaryGrow: state.stackChildPrimaryGrow,
      };
    },
  };

  return builder;
}

function buildFillPaints(hasFill: boolean, color: Color): SymbolNodeData["fillPaints"] {
  if (!hasFill) {
    return [];
  }
  return [{
    type: { value: 0, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
    blendMode: { value: 1, name: "NORMAL" },
  }];
}

/**
 * Create a new Symbol (component definition) builder
 */
export function symbolNode(localID: number, parentID: number): SymbolNodeBuilder {
  return createSymbolNodeBuilder(localID, parentID);
}
