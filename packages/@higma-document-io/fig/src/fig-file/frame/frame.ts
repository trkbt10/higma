/**
 * @file Frame node builder
 */

import { createTranslationMatrix } from "@higma-document-models/fig/matrix";
import type { Color, Paint, StackPadding, Stroke } from "../types";
import type { EffectData } from "../effect/types";
import type { ExportSettings, FrameNodeData } from "./types";
import {
  IMAGE_TYPE_VALUES,
  EXPORT_CONSTRAINT_VALUES,
  EXPORT_COLOR_PROFILE_VALUES,
  SVG_ID_MODE_VALUES,
  STACK_MODE_VALUES,
  STACK_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_COUNTER_ALIGN_VALUES,
  STACK_POSITIONING_VALUES,
  STACK_SIZING_VALUES,
  CONSTRAINT_TYPE_VALUES,
  toEnumValue,
  resolveStackSizingInput,
  type StackMode,
  type StackAlign,
  type StackJustify,
  type StackCounterAlign,
  type StackPositioning,
  type StackSizing,
  type StackSizingInput,
  type ConstraintType,
} from "@higma-document-models/fig/constants";

function solidPaint(color: Color): Paint {
  return {
    type: { value: 0, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
    blendMode: { value: 1, name: "NORMAL" },
  };
}

function solidStroke(color: Color): Stroke {
  return {
    type: { value: 0, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
    blendMode: { value: 1, name: "NORMAL" },
  };
}

/**
 * Default SVG export settings (matches Figma's defaults)
 */
export const DEFAULT_SVG_EXPORT_SETTINGS: ExportSettings = {
  suffix: "",
  imageType: { value: IMAGE_TYPE_VALUES.SVG, name: "SVG" },
  constraint: {
    type: { value: EXPORT_CONSTRAINT_VALUES.CONTENT_SCALE, name: "CONTENT_SCALE" },
    value: 1,
  },
  svgDataName: false,
  svgIDMode: { value: SVG_ID_MODE_VALUES.IF_NEEDED, name: "IF_NEEDED" },
  svgOutlineText: true,
  contentsOnly: true,
  svgForceStrokeMasks: false,
  useAbsoluteBounds: false,
  colorProfile: { value: EXPORT_COLOR_PROFILE_VALUES.DOCUMENT, name: "DOCUMENT" },
  useBicubicSampler: true,
};

/** Frame node builder instance */
export type FrameNodeBuilder = {
  name: (name: string) => FrameNodeBuilder;
  size: (width: number, height: number) => FrameNodeBuilder;
  position: (x: number, y: number) => FrameNodeBuilder;
  background: (c: Color) => FrameNodeBuilder;
  fill: (paint: Paint) => FrameNodeBuilder;
  /**
   * Drop the frame's fill stack entirely so it renders without a
   * solid background. Useful for transparent web containers (the
   * captured `<html>` / wrapping `<div>`s) where the default opaque
   * white would otherwise paint over an ancestor's background.
   */
  noFill: () => FrameNodeBuilder;
  stroke: (color: Color) => FrameNodeBuilder;
  strokeWeight: (weight: number) => FrameNodeBuilder;
  bordersTakeSpace: (enabled: boolean) => FrameNodeBuilder;
  borderWeights: (opts: { top: number; right: number; bottom: number; left: number }) => FrameNodeBuilder;
  opacity: (o: number) => FrameNodeBuilder;
  effects: (effects: readonly EffectData[]) => FrameNodeBuilder;
  clipsContent: (clips: boolean) => FrameNodeBuilder;
  cornerRadius: (radius: number) => FrameNodeBuilder;
  lockAspectRatio: (width: number, height: number) => FrameNodeBuilder;
  autoLayout: (mode: StackMode) => FrameNodeBuilder;
  gap: (spacing: number) => FrameNodeBuilder;
  padding: (value: number | StackPadding) => FrameNodeBuilder;
  primaryAlign: (align: StackJustify) => FrameNodeBuilder;
  counterAlign: (align: StackAlign) => FrameNodeBuilder;
  contentAlign: (align: StackAlign) => FrameNodeBuilder;
  wrap: (enabled?: boolean) => FrameNodeBuilder;
  counterGap: (spacing: number) => FrameNodeBuilder;
  reverseZIndex: (enabled?: boolean) => FrameNodeBuilder;
  positioning: (mode: StackPositioning) => FrameNodeBuilder;
  primarySizing: (sizing: StackSizingInput) => FrameNodeBuilder;
  counterSizing: (sizing: StackSizingInput) => FrameNodeBuilder;
  primaryGrow: (grow: number) => FrameNodeBuilder;
  childAlignSelf: (align: StackCounterAlign) => FrameNodeBuilder;
  horizontalConstraint: (constraint: ConstraintType) => FrameNodeBuilder;
  verticalConstraint: (constraint: ConstraintType) => FrameNodeBuilder;
  addExportSettings: (settings: ExportSettings) => FrameNodeBuilder;
  exportAsSVG: () => FrameNodeBuilder;
  exportAsPNG: (scale?: number) => FrameNodeBuilder;
  build: () => FrameNodeData;
};

type FrameBuilderState = {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  fillPaints: Paint[];
  strokeColor: Color | undefined;
  strokeWeight: number | undefined;
  bordersTakeSpace: boolean | undefined;
  borderTopWeight: number | undefined;
  borderRightWeight: number | undefined;
  borderBottomWeight: number | undefined;
  borderLeftWeight: number | undefined;
  borderStrokeWeightsIndependent: boolean | undefined;
  opacity: number;
  effects: readonly EffectData[] | undefined;
  clipsContent: boolean;
  cornerRadius: number | undefined;
  targetAspectRatio: { x: number; y: number } | undefined;
  proportionsConstrained: boolean | undefined;
  exportSettings: ExportSettings[];
  stackMode: StackMode | undefined;
  stackSpacing: number | undefined;
  stackPadding: StackPadding | undefined;
  stackPrimaryAlignItems: StackJustify | undefined;
  stackCounterAlignItems: StackAlign | undefined;
  stackPrimaryAlignContent: StackAlign | undefined;
  stackWrap: boolean | undefined;
  stackCounterSpacing: number | undefined;
  stackReverseZIndex: boolean | undefined;
  stackPositioning: StackPositioning | undefined;
  stackPrimarySizing: StackSizing | undefined;
  stackCounterSizing: StackSizing | undefined;
  stackChildPrimaryGrow: number | undefined;
  stackChildAlignSelf: StackCounterAlign | undefined;
  horizontalConstraint: ConstraintType | undefined;
  verticalConstraint: ConstraintType | undefined;
};

/** Create a frame node builder */
function createFrameNodeBuilder(localID: number, parentID: number): FrameNodeBuilder {
  const state: FrameBuilderState = {
    name: "Frame",
    width: 200,
    height: 100,
    x: 0,
    y: 0,
    fillPaints: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
    strokeColor: undefined,
    strokeWeight: undefined,
    bordersTakeSpace: undefined,
    borderTopWeight: undefined,
    borderRightWeight: undefined,
    borderBottomWeight: undefined,
    borderLeftWeight: undefined,
    borderStrokeWeightsIndependent: undefined,
    opacity: 1,
    effects: undefined,
    clipsContent: true,
    cornerRadius: undefined,
    targetAspectRatio: undefined,
    proportionsConstrained: undefined,
    exportSettings: [],
    stackMode: undefined,
    stackSpacing: undefined,
    stackPadding: undefined,
    stackPrimaryAlignItems: undefined,
    stackCounterAlignItems: undefined,
    stackPrimaryAlignContent: undefined,
    stackWrap: undefined,
    stackCounterSpacing: undefined,
    stackReverseZIndex: undefined,
    stackPositioning: undefined,
    stackPrimarySizing: undefined,
    stackCounterSizing: undefined,
    stackChildPrimaryGrow: undefined,
    stackChildAlignSelf: undefined,
    horizontalConstraint: undefined,
    verticalConstraint: undefined,
  };

  const builder: FrameNodeBuilder = {
    name(n: string) { state.name = n; return builder; },
    size(width: number, height: number) { state.width = width; state.height = height; return builder; },
    position(x: number, y: number) { state.x = x; state.y = y; return builder; },
    background(c: Color) { state.fillPaints = [solidPaint(c)]; return builder; },
    fill(paint: Paint) { state.fillPaints = [paint]; return builder; },
    noFill() { state.fillPaints = []; return builder; },
    stroke(color: Color) { state.strokeColor = color; return builder; },
    strokeWeight(weight: number) { state.strokeWeight = weight; return builder; },
    bordersTakeSpace(enabled: boolean) { state.bordersTakeSpace = enabled; return builder; },
    borderWeights(opts: { top: number; right: number; bottom: number; left: number }) {
      state.borderTopWeight = opts.top;
      state.borderRightWeight = opts.right;
      state.borderBottomWeight = opts.bottom;
      state.borderLeftWeight = opts.left;
      if (opts.top !== opts.right || opts.right !== opts.bottom || opts.bottom !== opts.left) {
        state.borderStrokeWeightsIndependent = true;
      }
      return builder;
    },
    opacity(o: number) { state.opacity = o; return builder; },
    effects(e: readonly EffectData[]) { state.effects = e; return builder; },
    clipsContent(clips: boolean) { state.clipsContent = clips; return builder; },
    cornerRadius(radius: number) { state.cornerRadius = radius; return builder; },
    lockAspectRatio(width: number, height: number) {
      state.targetAspectRatio = { x: width, y: height };
      state.proportionsConstrained = true;
      return builder;
    },
    /** Set the auto-layout mode (direction) */
    autoLayout(mode: StackMode) { state.stackMode = mode; return builder; },
    /** Set gap between items (main axis spacing) */
    gap(spacing: number) { state.stackSpacing = spacing; return builder; },
    /** Set padding (uniform value or full padding object) */
    padding(value: number | StackPadding) {
      if (typeof value === "number") {
        state.stackPadding = { top: value, right: value, bottom: value, left: value };
      } else {
        state.stackPadding = value;
      }
      return builder;
    },
    /** Set primary axis alignment (justify-content equivalent). Uses StackJustify enum. */
    primaryAlign(align: StackJustify) { state.stackPrimaryAlignItems = align; return builder; },
    /** Set counter axis alignment (align-items equivalent). Uses StackAlign — STRETCH must travel through each child's `childAlignSelf("STRETCH")` instead, since the StackAlign enum has no STRETCH variant. */
    counterAlign(align: StackAlign) { state.stackCounterAlignItems = align; return builder; },
    /** Set content alignment for wrap mode (align-content equivalent) */
    contentAlign(align: StackAlign) { state.stackPrimaryAlignContent = align; return builder; },
    /** Enable wrap mode (auto-wrap items) */
    wrap(enabled: boolean = true) {
      state.stackWrap = enabled;
      return builder;
    },
    /** Set counter axis spacing (for wrap mode) */
    counterGap(spacing: number) { state.stackCounterSpacing = spacing; return builder; },
    /** Reverse z-index order of items */
    reverseZIndex(enabled: boolean = true) { state.stackReverseZIndex = enabled; return builder; },
    /** Set positioning mode when inside auto-layout parent */
    positioning(mode: StackPositioning) { state.stackPositioning = mode; return builder; },
    /** Set sizing along primary axis (when inside auto-layout parent) */
    primarySizing(sizing: StackSizingInput) { state.stackPrimarySizing = resolveStackSizingInput(sizing); return builder; },
    /** Set sizing along counter axis (when inside auto-layout parent) */
    counterSizing(sizing: StackSizingInput) { state.stackCounterSizing = resolveStackSizingInput(sizing); return builder; },
    /** Set Figma's `stackChildPrimaryGrow` for fill-container behavior. */
    primaryGrow(grow: number) { state.stackChildPrimaryGrow = grow; return builder; },
    /** Override the auto-layout counter-axis alignment for this child. Uses StackCounterAlign enum (STRETCH is valid). */
    childAlignSelf(align: StackCounterAlign) { state.stackChildAlignSelf = align; return builder; },
    /** Set horizontal constraint */
    horizontalConstraint(constraint: ConstraintType) { state.horizontalConstraint = constraint; return builder; },
    /** Set vertical constraint */
    verticalConstraint(constraint: ConstraintType) { state.verticalConstraint = constraint; return builder; },
    /** Add export settings (can be called multiple times for multiple exports) */
    addExportSettings(settings: ExportSettings) { state.exportSettings.push(settings); return builder; },
    /** Add default SVG export settings */
    exportAsSVG() { state.exportSettings.push(DEFAULT_SVG_EXPORT_SETTINGS); return builder; },
    /** Add PNG export settings with optional scale */
    exportAsPNG(scale: number = 1) {
      state.exportSettings.push({
        suffix: scale === 1 ? "" : `@${scale}x`,
        imageType: { value: IMAGE_TYPE_VALUES.PNG, name: "PNG" },
        constraint: { type: { value: EXPORT_CONSTRAINT_VALUES.CONTENT_SCALE, name: "CONTENT_SCALE" }, value: scale },
        svgDataName: false,
        svgIDMode: { value: SVG_ID_MODE_VALUES.IF_NEEDED, name: "IF_NEEDED" },
        svgOutlineText: false,
        contentsOnly: true,
        svgForceStrokeMasks: false,
        useAbsoluteBounds: false,
        colorProfile: { value: EXPORT_COLOR_PROFILE_VALUES.DOCUMENT, name: "DOCUMENT" },
        useBicubicSampler: true,
      });
      return builder;
    },

    build(): FrameNodeData {
      return {
        localID,
        parentID,
        name: state.name,
        size: { x: state.width, y: state.height },
        transform: createTranslationMatrix(state.x, state.y),
        fillPaints: state.fillPaints,
        strokePaints: state.strokeColor ? [solidStroke(state.strokeColor)] : undefined,
        strokeWeight: state.strokeWeight ?? 0,
        bordersTakeSpace: state.bordersTakeSpace,
        borderTopWeight: state.borderTopWeight,
        borderRightWeight: state.borderRightWeight,
        borderBottomWeight: state.borderBottomWeight,
        borderLeftWeight: state.borderLeftWeight,
        borderStrokeWeightsIndependent: state.borderStrokeWeightsIndependent,
        visible: true,
        opacity: state.opacity,
        clipsContent: state.clipsContent,
        cornerRadius: state.cornerRadius,
        targetAspectRatio: state.targetAspectRatio,
        proportionsConstrained: state.proportionsConstrained,
        exportSettings: state.exportSettings.length > 0 ? state.exportSettings : undefined,
        effects: state.effects,
        stackMode: toEnumValue(state.stackMode, STACK_MODE_VALUES),
        stackSpacing: state.stackSpacing,
        stackPadding: state.stackPadding,
        stackPrimaryAlignItems: toEnumValue(state.stackPrimaryAlignItems, STACK_JUSTIFY_VALUES),
        stackCounterAlignItems: toEnumValue(state.stackCounterAlignItems, STACK_ALIGN_VALUES),
        stackPrimaryAlignContent: toEnumValue(state.stackPrimaryAlignContent, STACK_ALIGN_VALUES),
        stackWrap: state.stackWrap,
        stackCounterSpacing: state.stackCounterSpacing,
        stackReverseZIndex: state.stackReverseZIndex,
        stackPositioning: toEnumValue(state.stackPositioning, STACK_POSITIONING_VALUES),
        stackPrimarySizing: toEnumValue(state.stackPrimarySizing, STACK_SIZING_VALUES),
        stackCounterSizing: toEnumValue(state.stackCounterSizing, STACK_SIZING_VALUES),
        stackChildPrimaryGrow: state.stackChildPrimaryGrow,
        stackChildAlignSelf: toEnumValue(state.stackChildAlignSelf, STACK_COUNTER_ALIGN_VALUES),
        horizontalConstraint: toEnumValue(state.horizontalConstraint, CONSTRAINT_TYPE_VALUES),
        verticalConstraint: toEnumValue(state.verticalConstraint, CONSTRAINT_TYPE_VALUES),
      };
    },
  };

  return builder;
}

/**
 * Create a new Frame node builder
 */
export function frameNode(localID: number, parentID: number): FrameNodeBuilder {
  return createFrameNodeBuilder(localID, parentID);
}
