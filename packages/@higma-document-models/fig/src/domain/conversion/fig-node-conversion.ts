/**
 * @file Convert raw FigNode values to FigDesignNode values
 *
 * Bridges low-level parsed FigNode data to the high-level FigDesignNode
 * model used by IO, rendering, builder, and editor packages.
 *
 * The conversion:
 * 1. Converts each FigNode to a FigDesignNode with branded IDs
 * 2. Extracts typed properties, preserving unknown fields in _raw
 * 3. Collects COMPONENT/SYMBOL nodes into the components map
 */

import type {
  FigNode, FigNodeType, FigMatrix, FigVector, FigPaint, FigEffect,
  KiwiEnumValue, FigTextStyleOverrideEntry, FigComponentPropValue,
  FigKiwiSymbolOverride,
} from "@higma-document-models/fig/types";
import { FIG_NODE_TYPE } from "@higma-document-models/fig/types";
import type { FigBlob } from "../blob-path";
import type { FigGuid } from "../raw-node-tree";
import { getNodeType, parseGuidString } from "../raw-node-tree";
import {
  getEffectiveSymbolID,
  getInstanceSymbolOverrides,
  buildGuidTranslationMap,
  analyzeOverrideSets,
  resolveSymbolGuidStr,
  resolveStyledPaint,
  resolveStyledEffects,
  resolveStyledTextProperties,
  resolveStyledGrids,
  formatNodeLocator,
  isInstanceSelfOverride,
  createFigResolveContext,
} from "@higma-document-models/fig/symbols";
import type { GuidTranslationMap, FigResolveContext } from "@higma-document-models/fig/symbols";
import { defensiveMark } from "@higma-document-models/fig/diagnostics";
import type {
  FigDesignNode, AutoLayoutProps, LayoutConstraints, TextData, TextStyleOverride, SymbolOverride,
  DerivedTextData,
  ComponentPropertyDef, ComponentPropertyRef, ComponentPropertyAssignment, ComponentPropertyType, ComponentPropertyNodeField, ComponentPropertyValue,
  FigStyleRegistry,
} from "../document";
import type { BlendMode } from "@higma-document-models/fig/types";
import { EMPTY_FIG_STYLE_REGISTRY } from "../document";
import { guidToNodeId } from "../node-id";
import type { FigNodeId } from "../node-id";

// =============================================================================
// Constants
// =============================================================================

/**
 * Extract the effective symbol ID from a node's raw data and convert
 * it to a FigNodeId string suitable for looking up in the components map.
 *
 * Delegates to getEffectiveSymbolID (the SoT for INSTANCE → SYMBOL resolution)
 * which handles both `symbolData.symbolID` (real Figma exports) and top-level
 * `symbolID` (builder-generated files), plus `overriddenSymbolID` for variants.
 *
 * Returns undefined for non-INSTANCE nodes.
 */
function resolveSymbolIdForDomain(node: FigNode): FigNodeId | undefined {
  const guid = getEffectiveSymbolID(node);
  if (!guid) {return undefined;}
  return guidToNodeId(guid);
}

/** Node types that clip content by default in Figma. */
const CLIPPING_NODE_TYPES: ReadonlySet<FigNodeType> = new Set([
  FIG_NODE_TYPE.FRAME,
  FIG_NODE_TYPE.COMPONENT,
  FIG_NODE_TYPE.COMPONENT_SET,
]);

/**
 * Resolve clipsContent for domain model.
 *
 * Normalizes the Kiwi-level `frameMaskDisabled` (inverted semantics)
 * into a simple boolean, with correct defaults per node type.
 * After this, the domain model's `clipsContent` is authoritative and
 * no consumer needs to read `frameMaskDisabled` from `_raw`.
 */
function resolveClipsContentForDomain(node: FigNode, nodeType: FigNodeType): boolean | undefined {
  if (node.clipsContent !== undefined) { return node.clipsContent; }
  if (node.frameMaskDisabled !== undefined) { return !node.frameMaskDisabled; }
  if (CLIPPING_NODE_TYPES.has(nodeType)) { return true; }
  return undefined;
}

/** Identity matrix (no transform) */
const IDENTITY_MATRIX: FigMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

/** Default size */
const DEFAULT_SIZE: FigVector = { x: 0, y: 0 };

function isFigVector(value: unknown): value is FigVector {
  return typeof value === "object" && value !== null &&
    "x" in value && typeof value.x === "number" &&
    "y" in value && typeof value.y === "number";
}

/** Node types that are components */
const COMPONENT_TYPES: ReadonlySet<FigNodeType> = new Set([
  FIG_NODE_TYPE.COMPONENT,
  FIG_NODE_TYPE.COMPONENT_SET,
  FIG_NODE_TYPE.SYMBOL,
]);

/** True when a paint list carries at least one paint entry. */
function hasPaintEntries(paints: readonly FigPaint[] | undefined): paints is readonly FigPaint[] {
  return paints !== undefined && paints.length > 0;
}

/**
 * Resolve node fills via the style-paint SoT.
 *
 * Embedded SoT: a FRAME with `backgroundPaints` uses that as its own
 * paint cache; every other node uses `fillPaints`. `resolveStyledPaint`
 * lets the registry win when `styleIdForFill` resolves and otherwise
 * returns the embedded cache (matching Figma's render of dangling
 * refs).
 */
function resolveNodeFills(node: FigNode, styleRegistry: FigStyleRegistry): readonly FigPaint[] {
  const embedded = hasPaintEntries(node.backgroundPaints) ? node.backgroundPaints : node.fillPaints;
  return resolveStyledPaint(node.styleIdForFill, embedded, styleRegistry) ?? [];
}

/**
 * Resolve node strokes via the style-paint SoT.
 *
 * Mirrors `resolveNodeFills` with `strokePaints` as the embedded
 * cache. Figma allows referencing a FILL-type style as a stroke, so
 * the resolution itself is intent-agnostic — this function only
 * decides which embedded cache backs the consumer.
 */
function resolveNodeStrokes(node: FigNode, styleRegistry: FigStyleRegistry): readonly FigPaint[] {
  return resolveStyledPaint(node.styleIdForStrokeFill, node.strokePaints, styleRegistry) ?? [];
}

/**
 * Resolve node effects via the styled-effect SoT. Registry wins when
 * `styleIdForEffect` resolves; otherwise the node's embedded
 * `effects` cache is the SoT (matches Figma's render of dangling
 * refs). Empty result is normalised to `[]` because the domain field
 * is non-optional.
 */
function resolveNodeEffects(node: FigNode, styleRegistry: FigStyleRegistry): readonly FigEffect[] {
  return resolveStyledEffects(node.styleIdForEffect, node.effects, styleRegistry) ?? [];
}

/**
 * Resolve node layout grids via the styled-grid SoT. The domain
 * doesn't decode grids itself — consumers (editor overlays / future
 * layout systems) walk the array — so we forward the registry-or-
 * embedded result verbatim.
 */
function resolveNodeGrids(node: FigNode, styleRegistry: FigStyleRegistry): readonly unknown[] | undefined {
  return resolveStyledGrids(node.styleIdForGrid, node.layoutGrids, styleRegistry);
}

/**
 * Extract per-side stroke weights from Kiwi node data.
 * Returns undefined when all sides are equal or no per-side data exists.
 */
/**
 * Build rectangleCornerRadii from Figma's per-corner fields or the array field.
 *
 * Real Figma .fig files store per-corner values as individual fields
 * (rectangleTopLeftCornerRadius, etc.) NOT as a rectangleCornerRadii array.
 * Builder-generated files may use rectangleCornerRadii directly.
 */
function extractCornerRadii(node: FigNode): readonly number[] | undefined {
  // Prefer the explicit array if present
  if (node.rectangleCornerRadii && node.rectangleCornerRadii.length === 4) {
    return node.rectangleCornerRadii;
  }

  // Build from individual fields (real Figma .fig format)
  const tl = node.rectangleTopLeftCornerRadius;
  const tr = node.rectangleTopRightCornerRadius;
  const br = node.rectangleBottomRightCornerRadius;
  const bl = node.rectangleBottomLeftCornerRadius;

  if (tl === undefined && tr === undefined && br === undefined && bl === undefined) {
    return undefined;
  }

  const radii = [tl ?? 0, tr ?? 0, br ?? 0, bl ?? 0];

  // If all corners are the same, don't store (cornerRadius handles uniform)
  if (radii[0] === radii[1] && radii[1] === radii[2] && radii[2] === radii[3]) {
    return undefined;
  }

  return radii;
}

function extractIndividualStrokeWeights(node: FigNode): FigDesignNode["individualStrokeWeights"] {
  if (!node.borderStrokeWeightsIndependent && node.borderTopWeight === undefined) {
    return undefined;
  }
  // Figma semantics when `borderStrokeWeightsIndependent=true`:
  //   - a defined per-side weight renders at that exact width
  //   - an undefined per-side weight means **0** (no border on that side)
  //   - `strokeWeight` is the uniform value shown in Figma's inspector but
  //     NOT used as a fallback for missing sides
  //
  // Pattern observed: separator-style frames (e.g. "Spine" / "Line 1-3"
  // / "Header") have only `borderBottomWeight` set with others
  // undefined — these are bottom-only accent rules. A card-style frame
  // may carry only `borderTopWeight=8` for a top-only accent strip.
  // A prior fix that fell back to `strokeWeight` here turned those
  // single-side accents into full 4-sided borders.
  const top = node.borderTopWeight ?? 0;
  const right = node.borderRightWeight ?? 0;
  const bottom = node.borderBottomWeight ?? 0;
  const left = node.borderLeftWeight ?? 0;

  // If all sides are equal, don't store individual weights (the uniform
  // `strokeWeight` already covers the case).
  if (top === right && right === bottom && bottom === left) {
    return undefined;
  }

  return { top, right, bottom, left };
}

/**
 * Fields that are explicitly modeled in FigDesignNode and should be
 * excluded from the _raw preservation bag.
 */
const MODELED_FIELDS: ReadonlySet<string> = new Set([
  "guid", "parentIndex", "children", "type", "phase",
  "name", "visible", "opacity",
  "transform", "size", "transformOrigin",
  "fillPaints", "backgroundPaints", "strokePaints", "strokeWeight", "strokeAlign", "strokeJoin", "strokeCap", "strokeDashes",
  "borderTopWeight", "borderRightWeight", "borderBottomWeight", "borderLeftWeight", "borderStrokeWeightsIndependent",
  "styleIdForFill", "styleIdForStrokeFill",
  "exportSettings",
  "cornerRadius", "rectangleCornerRadii", "cornerSmoothing",
  "rectangleTopLeftCornerRadius", "rectangleTopRightCornerRadius",
  "rectangleBottomLeftCornerRadius", "rectangleBottomRightCornerRadius",
  "dashPattern",
  "blendMode",
  "effects",
  "derivedTextData",
  "clipsContent", "frameMaskDisabled",
  "sectionContentsHidden",
  "stackMode", "stackSpacing", "stackPadding",
  "stackPrimaryAlignItems", "stackCounterAlignItems", "stackPrimaryAlignContent",
  "stackWrap", "stackCounterSpacing", "itemReverseZIndex",
  "stackPositioning", "stackPrimarySizing", "stackCounterSizing",
  "stackChildAlignSelf", "stackChildPrimaryGrow",
  "horizontalConstraint", "verticalConstraint",
  "characters", "fontSize", "fontName",
  "textAlignHorizontal", "textAlignVertical", "textAutoResize",
  "textDecoration", "textCase", "lineHeight", "letterSpacing",
  "textTruncation", "leadingTrim", "fontVariations", "hyperlink", "textTracking",
  "symbolID", "symbolOverrides", "symbolData", "derivedSymbolData",
  "componentPropDefs", "componentPropRefs", "componentPropAssignments", "variantPropSpecs",
  "mask",
  "arcData",
  "vectorPaths", "vectorData",
  "booleanOperation",
  "pointCount", "starInnerRadius", "starInnerScale",
  "fillGeometry", "strokeGeometry",
]);

// =============================================================================
// Blend Mode Extraction
// =============================================================================

/** Resolve a blend mode value to its string name, handling both string and KiwiEnumValue forms. */
function resolveBlendModeName(bm: string | KiwiEnumValue): string {
  if (typeof bm === "string") {
    return bm;
  }
  return bm.name;
}

/**
 * Extract blend mode from raw node data, normalizing KiwiEnumValue to BlendMode string.
 * Returns undefined for PASS_THROUGH/NORMAL (default blend modes don't need storage).
 */
function extractBlendMode(node: FigNode): BlendMode | undefined {
  const bm = node.blendMode;
  if (!bm) {return undefined;}

  const name = resolveBlendModeName(bm);
  if (name === "PASS_THROUGH" || name === "NORMAL") {
    return undefined;
  }

  return name as BlendMode;
}

// =============================================================================
// Node Conversion
// =============================================================================

/**
 * Extract the effective node type name from a FigNode.
 */
function nodeTypeName(node: FigNode): FigNodeType {
  return getNodeType(node) as FigNodeType;
}

/**
 * Extract AutoLayout properties from a FigNode, if present.
 *
 * Padding lives in several places depending on the .fig source:
 *   - `stackPadding`: an object `{ top, right, bottom, left }` (domain
 *     expanded form, sometimes emitted by builders)
 *   - `stackHorizontalPadding` / `stackVerticalPadding`: shorthand
 *     pre-2019 schema; horizontal applies to left+right, vertical to
 *     top+bottom
 *   - `stackPaddingTop` / `stackPaddingRight` / `stackPaddingBottom` /
 *     `stackPaddingLeft`: per-side fields (real .fig files from
 *     post-2020 Figma, e.g. Toolbar - Top in edge-cases.fig)
 *
 * We resolve them into a single `{top,right,bottom,left}` object so
 * downstream layout code reads padding from one place. Missing sides
 * default to the relevant shorthand (vertical → top+bottom,
 * horizontal → left+right) and finally to 0.
 */
function extractAutoLayout(node: FigNode): AutoLayoutProps | undefined {
  const stackMode = node.stackMode;
  if (!stackMode || stackMode.name === "NONE") {
    return undefined;
  }
  // Resolve per-side padding from the Kiwi schema's overlapping fields.
  //
  // Per-side overrides (Right / Bottom) — when present — supersede the
  // legacy axis-uniform pair (Horizontal / Vertical). The Kiwi schema
  // does not expose `stackPaddingTop` / `stackPaddingLeft`; those sides
  // always come from the legacy `Vertical` / `Horizontal` shorthand.
  const ph = node.stackHorizontalPadding;
  const pv = node.stackVerticalPadding;
  const top = pv ?? 0;
  const right = node.stackPaddingRight ?? ph ?? 0;
  const bottom = node.stackPaddingBottom ?? pv ?? 0;
  const left = ph ?? 0;
  // Raw `stackPadding` is the uniform-on-all-sides scalar from the
  // Kiwi schema. When that is set, every per-side override above
  // already accounts for it via the `?? ph ?? 0` fallback chain on
  // each side, so we just need to materialise the per-side bag once
  // any side has a non-zero value.
  const uniform = node.stackPadding;
  const padTop = top || uniform || 0;
  const padRight = right || uniform || 0;
  const padBottom = bottom || uniform || 0;
  const padLeft = left || uniform || 0;
  const stackPadding: AutoLayoutProps["stackPadding"] | undefined = (() => {
    if (padTop || padRight || padBottom || padLeft) {
      return { top: padTop, right: padRight, bottom: padBottom, left: padLeft };
    }
    return undefined;
  })();
  return {
    stackMode,
    stackSpacing: node.stackSpacing,
    stackPadding,
    stackPrimaryAlignItems: node.stackPrimaryAlignItems,
    stackCounterAlignItems: node.stackCounterAlignItems,
    stackPrimaryAlignContent: node.stackPrimaryAlignContent,
    stackWrap: node.stackWrap,
    stackCounterSpacing: node.stackCounterSpacing,
    itemReverseZIndex: node.itemReverseZIndex,
  };
}

/**
 * Extract layout constraint properties from a FigNode, if present.
 */
function extractLayoutConstraints(node: FigNode): LayoutConstraints | undefined {
  const has =
    node.stackPositioning !== undefined ||
    node.stackPrimarySizing !== undefined ||
    node.stackCounterSizing !== undefined ||
    node.horizontalConstraint !== undefined ||
    node.verticalConstraint !== undefined ||
    node.stackChildAlignSelf !== undefined ||
    node.stackChildPrimaryGrow !== undefined;

  if (!has) {
    return undefined;
  }

  return {
    stackPositioning: node.stackPositioning,
    stackPrimarySizing: node.stackPrimarySizing,
    stackCounterSizing: node.stackCounterSizing,
    horizontalConstraint: node.horizontalConstraint,
    verticalConstraint: node.verticalConstraint,
    stackChildAlignSelf: node.stackChildAlignSelf,
    stackChildPrimaryGrow: node.stackChildPrimaryGrow,
  };
}

/**
 * Extract text-specific data from a TEXT node.
 *
 * Characters may exist as:
 * - `raw.characters` (real .fig files from Figma have it as a direct node field)
 * - `raw.textData.characters` (builder-generated files store it in the TextData message)
 */
function extractTextData(node: FigNode, styleRegistry: FigStyleRegistry): TextData | undefined {
  // Resolve characters from direct field or nested textData.
  // In real .fig files, characters is a direct NodeChange field.
  // In builder-generated files, it's inside the textData Kiwi message.
  const kiwiTextData = node.textData;
  const characters = typeof node.characters === "string" ? node.characters : kiwiTextData?.characters;
  if (typeof characters !== "string") {
    return undefined;
  }

  // Extract characterStyleIDs and styleOverrideTable from the typed Kiwi TextData.
  const rawOverrideTable = kiwiTextData?.styleOverrideTable;
  const styleOverrideTable = rawOverrideTable ? convertKiwiOverrideTable(rawOverrideTable) : undefined;
  const characterStyleIDs = normaliseCharacterStyleIDs(
    kiwiTextData?.characterStyleIDs,
    characters.length,
    () => formatNodeLocator(node),
  );

  // SoT: when the node references a TEXT-type shared style via
  // `styleIdForText`, its properties override the node's own
  // (potentially stale) cache, property by property. Dangling refs
  // leave every property at its embedded value.
  const textProperties = resolveStyledTextProperties(
    node.styleIdForText,
    {
      fontName: node.fontName,
      fontSize: node.fontSize,
      lineHeight: node.lineHeight,
      letterSpacing: node.letterSpacing,
      textCase: node.textCase,
      textDecoration: node.textDecoration,
      textTracking: node.textTracking,
      fontVariations: node.fontVariations,
    },
    styleRegistry,
  );

  return {
    characters,
    fontSize: textProperties.fontSize ?? 12,
    fontName: textProperties.fontName ?? { family: "Inter", style: "Regular", postscript: "Inter-Regular" },
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    textAutoResize: node.textAutoResize,
    textDecoration: textProperties.textDecoration,
    textCase: textProperties.textCase,
    lineHeight: textProperties.lineHeight,
    letterSpacing: textProperties.letterSpacing,
    characterStyleIDs,
    styleOverrideTable: styleOverrideTable && styleOverrideTable.length > 0 ? styleOverrideTable : undefined,
    textTruncation: node.textTruncation,
    leadingTrim: node.leadingTrim,
    fontVariations: textProperties.fontVariations,
    hyperlink: node.hyperlink,
  };
}

/**
 * Normalise the per-character style id array to the post-conversion contract:
 *   `result.length === characters.length`
 *
 * Figma's `.fig` exporter omits trailing entries when every remaining
 * character uses the base style (styleID 0). The Kiwi schema's
 * length-prefixed array therefore reports a length less than the source
 * string when the tail is "all base". This is a deliberate file-size
 * compression — every observed file in the workspace either matches the
 * source length exactly or is short by exactly the trailing base run, and
 * styleID 0 is the documented "use the node's base style" sentinel.
 *
 * Padding here means downstream consumers (renderer SVG, WebGL, editor
 * overlays) all see a single canonical shape and never need to reason
 * about the trailing-omit compression themselves.
 *
 * Overflow (more ids than characters) is still treated as corruption and
 * surfaced via throw — Figma never emits this, so seeing it means the
 * file is malformed or the parser truncated `characters`.
 */
function normaliseCharacterStyleIDs(
  ids: readonly number[] | undefined,
  characterCount: number,
  locator: () => string,
): readonly number[] | undefined {
  if (!ids || ids.length === 0) { return undefined; }
  if (ids.length > characterCount) {
    throw new Error(
      `Text node has more characterStyleIDs (${ids.length}) than characters (${characterCount}) on ${locator()}`,
    );
  }
  if (ids.length === characterCount) { return ids; }
  // Short by `characterCount - ids.length` entries; pad the tail with the
  // base-style sentinel (0). Treat the result as immutable from here on.
  const padded = new Array<number>(characterCount);
  for (let i = 0; i < ids.length; i++) { padded[i] = ids[i]; }
  for (let i = ids.length; i < characterCount; i++) { padded[i] = 0; }
  return padded;
}

/**
 * Convert Kiwi-level FigTextStyleOverrideEntry to domain TextStyleOverride.
 *
 * The Kiwi entries are sparse NodeChange objects. We extract the style-related
 * subset into the typed domain representation.
 */
function convertKiwiOverrideTable(
  entries: readonly FigTextStyleOverrideEntry[],
): TextStyleOverride[] {
  return entries
    .filter((entry) => entry.styleID !== 0)
    .map((entry): TextStyleOverride => ({
      styleID: entry.styleID,
      fontSize: entry.fontSize,
      fontName: entry.fontName,
      fillPaints: entry.fillPaints,
      // The Kiwi-level entry is a sparse NodeChange that may carry style
      // references (`styleIdForFill` / `styleIdForStrokeFill`). Forward
      // both into the typed domain representation so the renderer's run
      // resolver can route through the same style-registry SoT used for
      // regular nodes.
      styleIdForFill: entry.styleIdForFill,
      styleIdForStrokeFill: entry.styleIdForStrokeFill,
      textDecoration: entry.textDecoration,
      textCase: entry.textCase,
      lineHeight: entry.lineHeight,
      letterSpacing: entry.letterSpacing,
    }));
}

// =============================================================================
// Component Property Extraction
// =============================================================================

/** Map ComponentPropType enum to domain string */
const PROP_TYPE_MAP: Record<number, ComponentPropertyType> = {
  0: "BOOL",
  1: "TEXT",
  2: "COLOR",
  3: "INSTANCE_SWAP",
  4: "VARIANT",
  5: "NUMBER",
  6: "IMAGE",
  7: "SLOT",
};

/** Map ComponentPropNodeField enum to domain string */
const NODE_FIELD_MAP: Record<number, ComponentPropertyNodeField> = {
  0: "VISIBLE",
  1: "TEXT_DATA",
  2: "OVERRIDDEN_SYMBOL_ID",
  3: "INHERIT_FILL_STYLE_ID",
  4: "SLOT_CONTENT_ID",
};

function resolveEnumName<T extends string>(v: unknown, map: Record<number, T>): T | undefined {
  if (v == null) {return undefined;}
  if (typeof v === "string") {return v as T;}
  if (typeof v === "object" && "value" in v) {
    const num = (v as { value: number }).value;
    return map[num];
  }
  if (typeof v === "number") {return map[v];}
  return undefined;
}

/**
 * Extract component property definitions from a SYMBOL/COMPONENT node.
 */
function extractComponentPropertyDefs(node: FigNode): readonly ComponentPropertyDef[] | undefined {
  const defs = node.componentPropDefs;
  if (!defs || defs.length === 0) {return undefined;}

  const result: ComponentPropertyDef[] = [];
  for (const def of defs) {
    const id = def.id;
    if (!id || typeof id !== "object" || !("sessionID" in id)) {continue;}
    const name = def.name;
    if (!name) {continue;}

    const propType = resolveEnumName(def.type, PROP_TYPE_MAP);
    if (!propType) {continue;}

    result.push({
      id: guidToNodeId(id),
      name,
      type: propType,
      initialValue: convertPropertyValue(def.initialValue),
      sortPosition: def.sortPosition,
    });
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Convert a raw Kiwi component property value to the domain type.
 *
 * Handles the conversion of raw GUIDs (guidValue) to FigNodeId (referenceValue),
 * and strips unknown fields so the domain type doesn't carry opaque Kiwi data.
 */
function convertPropertyValue(raw: FigComponentPropValue | undefined): ComponentPropertyValue | undefined {
  if (!raw) {return undefined;}

  const result: {
    boolValue?: boolean;
    textValue?: { characters: string };
    referenceValue?: FigNodeId;
    numberValue?: number;
  } = {};

  if (typeof raw.boolValue === "boolean") {
    result.boolValue = raw.boolValue;
  }

  if (raw.textValue?.characters !== undefined) {
    result.textValue = { characters: raw.textValue.characters };
  }

  if (raw.guidValue && typeof raw.guidValue === "object" && "sessionID" in raw.guidValue) {
    result.referenceValue = guidToNodeId(raw.guidValue);
  }

  if (typeof raw.numberValue === "number") {
    result.numberValue = raw.numberValue;
  }

  if (typeof raw.floatValue === "number") {
    result.numberValue = raw.floatValue;
  }

  // Return undefined if no known fields were populated
  if (result.boolValue === undefined && result.textValue === undefined &&
      result.referenceValue === undefined && result.numberValue === undefined) {
    return undefined;
  }

  return result;
}

/**
 * Extract component property references from any child node.
 */
function extractComponentPropertyRefs(node: FigNode): readonly ComponentPropertyRef[] | undefined {
  const refs = node.componentPropRefs;
  if (!refs || refs.length === 0) {return undefined;}

  const result: ComponentPropertyRef[] = [];
  for (const ref of refs) {
    const defID = ref.defID;
    if (!defID || typeof defID !== "object" || !("sessionID" in defID)) {continue;}

    const nodeField = resolveEnumName(ref.componentPropNodeField, NODE_FIELD_MAP);
    if (!nodeField) {continue;}

    result.push({
      defId: guidToNodeId(defID),
      nodeField,
    });
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Extract component property assignments from an INSTANCE node.
 */
function extractComponentPropertyAssignments(node: FigNode): readonly ComponentPropertyAssignment[] | undefined {
  const assigns = node.componentPropAssignments;
  if (!assigns || assigns.length === 0) {return undefined;}

  const result: ComponentPropertyAssignment[] = [];
  for (const assign of assigns) {
    const defID = assign.defID;
    if (!defID || typeof defID !== "object" || !("sessionID" in defID)) {continue;}

    const value = convertPropertyValue(assign.value as FigComponentPropValue | undefined);
    if (!value) {continue;}

    result.push({
      defId: guidToNodeId(defID),
      value,
    });
  }
  return result.length > 0 ? result : undefined;
}

function extractVariantPropSpecs(node: FigNode): FigDesignNode["variantPropSpecs"] {
  const specs = node.variantPropSpecs;
  if (!specs || specs.length === 0) {return undefined;}

  const result: { readonly propDefId: FigNodeId; readonly value: string }[] = [];
  for (const spec of specs) {
    const propDefId = spec.propDefId;
    if (!propDefId || typeof propDefId !== "object" || !("sessionID" in propDefId)) {continue;}
    if (typeof spec.value !== "string") {continue;}
    result.push({
      propDefId: guidToNodeId(propDefId),
      value: spec.value,
    });
  }

  return result.length > 0 ? result : undefined;
}

// =============================================================================

/**
 * Collect raw fields not modeled in FigDesignNode for roundtrip preservation.
 */
export function collectFigRawFields(node: FigNode): Record<string, unknown> | undefined {
  const raw: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (!MODELED_FIELDS.has(key) && value !== undefined) {
      raw[key] = value;
    }
  }

  return Object.keys(raw).length > 0 ? raw : undefined;
}

/**
 * Resolve override guid paths carried by a node into the SYMBOL
 * descendant namespace the scene-graph builder will look them up in.
 *
 * This is the SoT for "which slot does this override address". It
 * handles every node type uniformly: non-INSTANCE nodes have no
 * overrides to resolve, INSTANCE nodes have their paths rewritten
 * once and verbatim. Callers do not branch on node.type.
 *
 * SSoT invariants:
 *   - Every resolved guid on every path is in the FigDesignNode
 *     namespace the renderer's `findNodeByOverridePath` looks up in.
 *     The kiwi-side runtime resolver (`@higma-document-models/fig/symbols/symbol-resolver`)
 *     may still call `buildGuidTranslationMap` for its own re-translation
 *     of nested-cascade DSDs onto local children — that's a separate
 *     concern from this initial path resolution.
 *   - Single pass per path: no "first-level vs tail" asymmetry, no
 *     deferred secondary resolution.
 *   - COMPONENT_SET variant semantics: when a sibling entry declares
 *     `overriddenSymbolID` for an INSTANCE along the path, subsequent
 *     guids are resolved in the variant's namespace.
 */
function resolveOverridePaths(
  ctx: FigResolveContext,
  node: FigNode,
  symbolMap: ReadonlyMap<string, FigNode> | undefined,
  blobs: readonly FigBlob[] | undefined,
): {
  overrides: readonly SymbolOverride[] | undefined;
  derivedSymbolData: readonly SymbolOverride[] | undefined;
} {
  const rawOverrides = getInstanceSymbolOverrides(node);
  const rawDerivedSymbolData = node.derivedSymbolData;

  // Non-INSTANCE nodes (or INSTANCE nodes without a resolvable SYMBOL in
  // the map) return their raw carries unchanged. `getInstanceSymbolOverrides`
  // returns undefined for non-INSTANCE nodes so the output is always
  // shaped to what the domain node expects.
  if (!symbolMap) {
    return { overrides: rawOverrides, derivedSymbolData: rawDerivedSymbolData };
  }
  const effectiveGuid = getEffectiveSymbolID(node);
  if (!effectiveGuid) {
    return { overrides: rawOverrides, derivedSymbolData: rawDerivedSymbolData };
  }
  const effectiveSymbol = resolveSymbolGuidStr(effectiveGuid, symbolMap);
  if (!effectiveSymbol) {
    return { overrides: rawOverrides, derivedSymbolData: rawDerivedSymbolData };
  }

  // Compute ghost sessions across both `rawOverrides` and
  // `rawDerivedSymbolData` so a session that uses 1 entry in each
  // (overrides+dsd combined ≥ 2) still passes Stage 1. The
  // session-counts-per-resolve approach mis-classified single-entry
  // overrides like Action 3-1's `[126:58332]` (overrides) +
  // `[126:59453]` (dsd) as phantoms because each `resolve` call only
  // saw a count of 1. Sharing the count across both arrays restores
  // the SF-Symbol glyph override that addresses 15:871 (the `Symbol`
  // text inside Action button SYMBOLs).
  const sharedGhostSessions = new Set<number>();
  {
    const combined = [
      ...(rawOverrides ?? []),
      ...(rawDerivedSymbolData ?? []),
    ];
    const sessionCounts = new Map<number, number>();
    for (const e of combined) {
      const g = e.guidPath?.guids?.[0];
      if (!g) {continue;}
      sessionCounts.set(g.sessionID, (sessionCounts.get(g.sessionID) ?? 0) + 1);
    }
    for (const [sessionID, count] of sessionCounts) {
      if (count >= 2) {sharedGhostSessions.add(sessionID);}
    }
  }
  const resolve = (
    entries: readonly FigKiwiSymbolOverride[],
  ): readonly SymbolOverride[] => {
    const effGuidStr = ctx.guidString(effectiveGuid);
    // Two-stage filter:
    //
    // Stage 1: the raw first guid must either exist in the file OR
    // belong to a "ghost session" that the entries collectively use
    // for at least two slots. The ghost-session escape hatch lets
    // INSTANCE-on-INSTANCE authoring through: Figma allocates
    // per-instance slot guids in a fresh session (e.g. session 127
    // for INSTANCEs living in a frame whose nodes were authored
    // later) that never appears in the file's node graph but still
    // identifies real descendants once the translation primitive
    // session-maps it. Without the escape hatch, every Contact
    // avatar override silently vanished and every contact rendered
    // with the SYMBOL's default avatar. The "≥ 2 entries share the
    // session" constraint distinguishes a real ghost session from a
    // single-shot phantom (authoring residue from rewritten TEXT,
    // stale rich-text style IDs, cross-file paste artefacts) that
    // the majority-vote heuristic would otherwise mis-route to an
    // arbitrary descendant.
    //
    // Stage 2: post-resolve first guid must be the INSTANCE's
    // effective SYMBOL (self-override) or a descendant of its
    // subtree. This drops cross-symbol authoring mistakes that
    // survive Stage 1 because the guid exists but belongs to an
    // unrelated SYMBOL.
    // Use the *shared* ghost sessions computed once at the top across
    // overrides + dsd; see the comment block above for why.
    const ghostSessions = sharedGhostSessions;
    // Detect self-override: a single-guid path whose entry carries
    // *INSTANCE-only* fields (name / size / variableConsumptionMap /
    // parameterConsumptionMap) and no slot-level paint or geometry
    // changes. Figma stores INSTANCE name/size in the same overrides
    // array but addresses them with the *INSTANCE's* own ghost guid,
    // not the SYMBOL root's guid. The translation primitive cannot
    // recognise that without help, and would otherwise route the entry
    // onto a sibling descendant (e.g. Contact INSTANCE 15:958's
    // [127:58424] name="Contact" landing on the Names FRAME 15:837 and
    // renaming it to "Contact" — which then collides with the parent
    // Contact INSTANCE's own name and corrupts walks that match by
    // `node.name === "Contact"`).
    //
    // The classifier is shared with the raw resolver — see
    // `isInstanceSelfOverride` in `@higma-document-models/fig/symbols`. Centralising
    // it ensures both pipelines treat the same authoring shape as a
    // self-override (routing it to the SYMBOL root) and avoid the
    // diverging-SoT failure mode (e.g. the Contact `[127:58424]` →
    // Names FRAME mis-route fixed before).
    const filtered = entries.filter((e) => {
      const g = e.guidPath?.guids?.[0];
      if (!g) {return true;}
      if (guidExistsInFile(ctx, g, symbolMap)) {return true;}
      // Exact slot in the effective SYMBOL (own-GUID or authored
      // overrideKey form). The own-GUID form is already covered by
      // `guidExistsInFile`, but `bundle.exactSlotMap` is the SoT for
      // "this address resolves to a SYMBOL slot exactly", so we
      // consult it here for the overrideKey form.
      if (ctx.symbolDescendants(effectiveSymbol.node).exactSlotMap.has(ctx.guidString(g))) {
        return true;
      }
      if (ghostSessions.has(g.sessionID)) {
        return true;
      }
      // INSTANCE self-overrides legitimately address the INSTANCE
      // itself with a per-instance ghost guid (a session never bound
      // to a node in the file). The single-entry shape — e.g. the
      // E-commerce template's `arrow-left` INSTANCEs that emit
      // `{size, proportionsConstrained}` against `[1027:7310]` —
      // doesn't qualify under the ≥2-entries-per-session ghost-session
      // heuristic and would otherwise throw before the reroute step
      // below can rescue it. Classify here using the same shared SoT
      // (`isInstanceSelfOverride`) the runtime resolver uses; the
      // rerouter immediately below redirects the path to the SYMBOL
      // root so the unreachable guid never reaches the translation
      // primitive.
      if (isInstanceSelfOverride(e)) {
        return true;
      }
      throw new Error(`Override path references unreachable guid ${ctx.guidString(g)}`);
    });
    // Re-route self-override entries' paths to the SYMBOL root before
    // running the translation primitive so they don't get pulled into
    // a sibling descendant by majority-vote.
    const rerouted = filtered.map((e) => {
      if (!isInstanceSelfOverride(e)) {return e;}
      // If the entry's path-first guid resolves to a real descendant in
      // the SYMBOL — either by GUID match or by `overrideKey` match —
      // it is NOT a self-override; it's a per-descendant size/name pin
      // that happens to use only INSTANCE-self field names. Examples:
      // Action SYMBOL's Title FRAME has overrideKey 5591:26670 and gets
      // a single-field `{size: 299×52}` DSD entry. Re-routing that to
      // the SYMBOL root corrupts the Action's primary-axis layout
      // (Title.size becomes 370 instead of 299, and the inner
      // _Separator stretches to 370 too, breaking iOS list separators
      // for Action 5/4-1/2-1/3-1).
      const firstGuid = e.guidPath?.guids?.[0];
      if (firstGuid) {
        const s = ctx.guidString(firstGuid);
        // Exact slot match in the SYMBOL — by descendant's own GUID
        // or by Figma's stable SYMBOL-side `overrideKey`. Both forms
        // live in `bundle.exactSlotMap`, the SoT for "is this address
        // an exact slot reference?". When matched, the entry targets
        // a real descendant (not the SYMBOL root) and must NOT be
        // rerouted as a self-override.
        const bundle = ctx.symbolDescendants(effectiveSymbol.node);
        if (bundle.exactSlotMap.has(s)) { return e; }
      }
      const newPath = { guids: [effectiveGuid] };
      return { ...e, guidPath: newPath };
    });
    const resolved = resolveEntryPaths(ctx, rerouted, effectiveSymbol.node, node, symbolMap, blobs);
    return resolved.filter((entry) => guidReachableInSymbol(
      ctx,
      entry.guidPath?.guids?.[0],
      effectiveSymbol.node,
      effGuidStr,
    ));
  };

  return {
    overrides: rawOverrides ? resolve(rawOverrides) : undefined,
    derivedSymbolData: rawDerivedSymbolData ? resolve(rawDerivedSymbolData) : undefined,
  };
}

function guidReachableInSymbol(
  ctx: FigResolveContext,
  guid: FigGuid | undefined,
  symbolRoot: FigNode,
  symbolIdStr: string,
): boolean {
  if (!guid) { return true; } // empty path — treated as no constraint
  const s = ctx.guidString(guid);
  if (s === symbolIdStr) { return true; }
  return findInKiwiTree(ctx, symbolRoot, s) !== undefined;
}

function guidExistsInFile(
  ctx: FigResolveContext,
  guid: FigGuid | undefined,
  symbolMap: ReadonlyMap<string, FigNode>,
): boolean {
  if (!guid) { return true; }
  // `symbolMap` is the full nodeMap built by `collectNodeMap` walking every
  // root recursively, so it already contains every descendant by GUID — a
  // direct `has` covers the entire file. A previous fallback iterated every
  // value and walked each subtree via `findInKiwiTree`, which can only ever
  // find descendants already keyed in the map, so it was guaranteed dead
  // code that scaled O(N²) per missing GUID. On a large production
  // .fig that produced 36k cache-miss walks at ~15ms each
  // (≈ 9 minutes of pure wasted work) and was the dominant cause of
  // the editor hanging.
  return symbolMap.has(ctx.guidString(guid));
}

/**
 * Walk each override path through the INSTANCE chain once, rewriting
 * guids into the namespace of the SYMBOL at each level. Variant
 * switches declared in `entries` are honoured so multi-level paths
 * descend into the variant's SYMBOL, not the default variant.
 */
function resolveEntryPaths(
  ctx: FigResolveContext,
  entries: readonly FigKiwiSymbolOverride[],
  symbolRoot: FigNode,
  instanceNode: FigNode,
  symbolMap: ReadonlyMap<string, FigNode>,
  blobs: readonly FigBlob[] | undefined,
): readonly SymbolOverride[] {
  // The override analysis is the SoT for what the override entries
  // collectively say about each first-guid. `buildGuidTranslationMap`
  // consumes the same bundle so we analyse once and thread the
  // result to it.
  const dsd = instanceNode.derivedSymbolData;
  const so = getInstanceSymbolOverrides(instanceNode);
  const overrideAnalysis = analyzeOverrideSets(ctx, dsd, so);

  // `levelMap` is the translation primitive's output — and the only
  // input the entry-path resolver consults. Earlier revisions merged
  // a positional "offset fallback" into this map for first-guids the
  // primitive couldn't resolve (`buildOffsetFallbackMap` paired
  // unresolved guids to SYMBOL descendants in BFS order, hoping that
  // matched Figma's allocation order). Calibration showed that of the
  // ~98k pairings the fallback emitted across the production fixture
  // corpus only ~85 (0.087%) survived the downstream
  // `guidReachableInSymbol` filter to actually reach the document, and
  // every one of those 85 was either type-mismatched (a SHAPE override
  // landing on a TEXT descendant — exactly the structural class
  // `buildGuidTranslationMap`'s Phase 1 validation explicitly removes)
  // or had no type signal at all. Removing the fallback aligns the
  // load-time pipeline with the runtime resolver in
  // `@higma-document-models/fig/symbols/symbol-resolver` and the variant-switch
  // resolver in `design-override-resolver` (neither carries a
  // fallback): three call sites, one SoT.
  const levelMap = buildGuidTranslationMap(
    symbolRoot,
    dsd,
    so,
    instanceNode.componentPropAssignments,
    symbolMap,
    blobs,
    ctx,
    overrideAnalysis,
  );

  // `resolvedSlotGuid → variantSymbolGuid`: a sibling single-guid entry
  // with `overriddenSymbolID` announces that the INSTANCE at
  // `resolvedSlotGuid` is running the named variant. Multi-level paths
  // that pass through the same slot descend into the variant's SYMBOL.
  // The raw `firstGuidStr → variantSymbolGuidStr` mapping comes from
  // the SoT analysis bundle; we only translate keys through the
  // resolved level map here.
  const variantAt = new Map<string, string>();
  for (const [rawSrc, variantSymStr] of overrideAnalysis.singleGuidVariantOverrides) {
    const resolved = levelMap.get(rawSrc) ?? rawSrc;
    variantAt.set(resolved, variantSymStr);
  }

  return entries.map((entry) =>
    resolveEntryPath(ctx, entry, levelMap, symbolRoot, symbolMap, blobs, variantAt),
  );
}

/**
 * Resolve every guid on a single entry's path from the INSTANCE's
 * namespace into the SYMBOL descendant namespace at each level.
 */
function resolveEntryPath(
  ctx: FigResolveContext,
  entry: FigKiwiSymbolOverride,
  topMap: GuidTranslationMap,
  symbolRoot: FigNode,
  symbolMap: ReadonlyMap<string, FigNode>,
  blobs: readonly FigBlob[] | undefined,
  variantAt: ReadonlyMap<string, string>,
): SymbolOverride {
  const guids = entry.guidPath?.guids;
  if (!guids || guids.length === 0) { return entry; }

  const resolved: { sessionID: number; localID: number }[] = [];
  const traversal: {
    levelMap: GuidTranslationMap;
    levelSymbolRoot: FigNode | undefined;
  } = {
    levelMap: topMap,
    levelSymbolRoot: symbolRoot,
  };

  for (let i = 0; i < guids.length; i++) {
    const src = ctx.guidString(guids[i]);
    // Identity preference: if the source guid already appears as a
    // descendant of the current SYMBOL, treat it as already-resolved
    // and do not consult the translation map. Without this check, the
    // heuristic in `buildGuidTranslationMap` can re-map a valid
    // descendant guid to a different descendant (because cross-session
    // override groups collapse under its majority-vote logic), pointing
    // multi-level paths at the wrong slot. See SDS Dialog variant swap
    // `[192:31517 → 315:31895 → 2072:9434]` where `315:31895` is a
    // direct child of the variant SYMBOL but was rewritten to a
    // sibling TEXT.
    const alreadyDescendant = traversal.levelSymbolRoot !== undefined && findInKiwiTree(ctx, traversal.levelSymbolRoot, src) !== undefined;
    const proposed = traversal.levelMap.get(src);
    if (alreadyDescendant && proposed !== undefined && proposed !== src) {
      // The translation primitive proposed a mapping for `src`, but
      // `src` already exists as a descendant of the current SYMBOL.
      // Identity preference wins (we keep `src` as-is) — but the fact
      // that the translation map disagreed with reality is worth
      // noticing: it usually means `buildGuidTranslationMap`'s
      // heuristic phases would have re-routed a valid descendant guid
      // to a different descendant. Recorded for calibration.
      defensiveMark("tree-to-document:alreadyDescendant-overrides-translation", {
        src,
        proposed,
      });
    }
    const resolvedStr = alreadyDescendant ? src : (proposed ?? src);
    resolved.push(parseGuidString(resolvedStr));

    if (i === guids.length - 1 || !traversal.levelSymbolRoot) { break; }

    const target = findInKiwiTree(ctx, traversal.levelSymbolRoot, resolvedStr);
    if (!target) { break; }
    if (getNodeType(target) !== FIG_NODE_TYPE.INSTANCE) { continue; }

    // No variant override on this slot → use the INSTANCE's effective
    // SYMBOL ID. This is the dominant code path (calibration: ~48k
    // fires across the corpus, vs. ~few hundred variant overrides),
    // so it is treated as the normal path rather than a defensive
    // branch.
    const variantGuidStr = variantAt.get(resolvedStr);
    const nestedSymbolGuid = (() => {
      if (variantGuidStr) {
        return parseGuidString(variantGuidStr);
      }
      return getEffectiveSymbolID(target);
    })();
    if (!nestedSymbolGuid) { break; }
    const nestedSymbol = resolveSymbolGuidStr(nestedSymbolGuid, symbolMap);
    if (!nestedSymbol) { break; }

    // Seed the next-level translation map with the subsequent guid so
    // `buildGuidTranslationMap`'s heuristics can place it even when
    // the nested INSTANCE declares no own overrides.
    //
    // When the next guid is the entry's leaf, also propagate the
    // entry's `size` field so Phase 1.5's size-aware matching can
    // resolve it correctly. Without the size, Phase 1.5 falls back to
    // positional sort and may pick a sibling descendant of mismatched
    // size (e.g. a 44×44 Close Button override could mis-route onto a
    // 199×18 Message TEXT because they're both TEXTs in localID
    // order).
    const isLastLevel = i + 1 === guids.length - 1;
    const seed: FigKiwiSymbolOverride = (() => {
      if (isLastLevel) {
        return { guidPath: { guids: [guids[i + 1]] }, size: entry.size, fillGeometry: entry.fillGeometry };
      }
      return { guidPath: { guids: [guids[i + 1]] } };
    })();
    const seeded = [
      ...(getInstanceSymbolOverrides(target) ?? []),
      seed,
    ];

    // Same SoT as the top-level call: one `analyzeOverrideSets` walk
    // feeds the translation primitive directly. No positional offset
    // fallback — see the rationale comment in `resolveEntryPaths`.
    const nestedAnalysis = analyzeOverrideSets(ctx, target.derivedSymbolData, seeded);

    traversal.levelMap = buildGuidTranslationMap(
      nestedSymbol.node,
      target.derivedSymbolData,
      seeded,
      target.componentPropAssignments,
      symbolMap,
      blobs,
      ctx,
      nestedAnalysis,
    );
    traversal.levelSymbolRoot = nestedSymbol.node;
  }

  // Convert kiwi `componentPropAssignments` (raw) into the domain
  // `componentPropertyAssignments` shape so `applyOverrideToNode` can
  // consume it. Without this rewrite the override field is silently
  // dropped — observed when a Close Button INSTANCE's icon-glyph CPA
  // (`defID → characters="..."`) ships as a
  // `componentPropAssignments` symbolOverride and is the only carrier
  // of the CPA into the inner TEXT.
  const kiwiCpa = entry.componentPropAssignments;
  const convertedCpa: readonly ComponentPropertyAssignment[] | undefined = (() => {
    if (kiwiCpa && kiwiCpa.length > 0) {
      const out: ComponentPropertyAssignment[] = [];
      for (const a of kiwiCpa) {
        const defID = a.defID;
        if (!defID || typeof defID !== "object" || !("sessionID" in defID)) {continue;}
        const value = convertPropertyValue(a.value as FigComponentPropValue | undefined);
        if (!value) {continue;}
        out.push({ defId: guidToNodeId(defID), value });
      }
      if (out.length > 0) {return out;}
    }
    return undefined;
  })();

  return {
    ...entry,
    guidPath: { guids: resolved },
    ...(convertedCpa ? { componentPropertyAssignments: convertedCpa } : {}),
  };
}

/**
 * SYMBOL-side slot lookup: returns the descendant FigNode whose `guid`
 * stringifies to `guidStr`, or `undefined` when no such descendant
 * exists. Routes through the cached `SymbolDescendantBundle.guidToDesc`
 * map so the lookup is O(1) — every INSTANCE that calls in against
 * the same SYMBOL shares the same Map. The previous DFS-per-call
 * implementation re-walked the SYMBOL subtree once per call (per
 * INSTANCE × per override entry), which was the residual O(N×k)
 * cost on large production .fig files after the bundle was introduced.
 */
function findInKiwiTree(ctx: FigResolveContext, root: FigNode, guidStr: string): FigNode | undefined {
  return ctx.symbolDescendants(root).guidToDesc.get(guidStr)?.node;
}

/**
 * Convert a raw FigNode to a FigDesignNode, recursively converting children.
 *
 * @param node - Raw Kiwi node from parser
 * @param components - Mutable map to collect component definitions
 * @param styleRegistry - Style ID → paint map for resolving styleIdForFill
 * @param symbolMap - Full Kiwi node map. Required to translate INSTANCE
 *   override GUIDs into the SYMBOL-descendant namespace (SSoT:
 *   `buildGuidTranslationMap`). Omit only when callers do not care about
 *   per-INSTANCE overrides (e.g. converting a single SYMBOL definition
 *   out of context) — all production paths that render INSTANCE nodes
 *   MUST pass the complete nodeMap or per-INSTANCE overrides silently
 *   fail.
 */
export function convertFigNode(
  node: FigNode,
  components: Map<string, FigDesignNode>,
  styleRegistry: FigStyleRegistry = EMPTY_FIG_STYLE_REGISTRY,
  symbolMap?: ReadonlyMap<string, FigNode>,
  /**
   * Optional blob array — when passed, INSTANCE override GUID translation
   * can use `fillGeometry` blob extents to disambiguate sibling targets
   * of different sizes (e.g. the two avatars in a multi-avatar Contact
   * variant). Without it, overrides lacking an explicit `size` field
   * fall back to sorted-localID pairing which mis-swaps such siblings.
   */
  blobs?: readonly FigBlob[],
  /**
   * Scoped resolve context — owns the GUID-string and safe-children
   * caches for one conversion. Defaults to a fresh per-call context
   * for external callers; `treeToDocument` passes an explicit shared
   * context so caching is amortised across the whole document.
   */
  ctx: FigResolveContext = createFigResolveContext(),
): FigDesignNode {
  const nodeType = nodeTypeName(node);
  const id = guidToNodeId(node.guid);

  const children = ctx.safeChildren(node);
  const convertedChildren = (() => {
    if (children.length > 0) {
      return children.map((child) => convertFigNode(child, components, styleRegistry, symbolMap, blobs, ctx));
    }
    return undefined;
  })();

  const { overrides: resolvedOverrides, derivedSymbolData: resolvedDerivedSymbolData } =
    resolveOverridePaths(ctx, node, symbolMap, blobs);

  const fills = resolveNodeFills(node, styleRegistry);
  const strokes = resolveNodeStrokes(node, styleRegistry);

  const designNode: FigDesignNode = {
    id,
    type: nodeType,
    name: node.name ?? "",
    visible: node.visible ?? true,
    opacity: node.opacity ?? 1,
    transform: node.transform ?? IDENTITY_MATRIX,
    size: node.size ?? DEFAULT_SIZE,
    transformOrigin: isFigVector(node.transformOrigin) ? node.transformOrigin : undefined,

    fills,
    strokes,
    strokeWeight: node.strokeWeight ?? 0,
    strokeAlign: node.strokeAlign,
    strokeJoin: node.strokeJoin,
    strokeCap: node.strokeCap,
    strokeDashes: node.strokeDashes ?? node.dashPattern,
    individualStrokeWeights: extractIndividualStrokeWeights(node),

    cornerRadius: node.cornerRadius,
    rectangleCornerRadii: extractCornerRadii(node),
    cornerSmoothing: node.cornerSmoothing,

    blendMode: extractBlendMode(node),

    effects: resolveNodeEffects(node, styleRegistry),

    children: convertedChildren,

    clipsContent: resolveClipsContentForDomain(node, nodeType),
    sectionContentsHidden: node.sectionContentsHidden,
    autoLayout: extractAutoLayout(node),
    layoutConstraints: extractLayoutConstraints(node),
    layoutGrids: resolveNodeGrids(node, styleRegistry),

    textData: nodeType === "TEXT" ? extractTextData(node, styleRegistry) : undefined,
    derivedTextData: node.derivedTextData as DerivedTextData | undefined,

    symbolId: resolveSymbolIdForDomain(node),
    overrides: resolvedOverrides,
    derivedSymbolData: resolvedDerivedSymbolData,

    componentPropertyDefs: extractComponentPropertyDefs(node),
    componentPropertyRefs: extractComponentPropertyRefs(node),
    componentPropertyAssignments: extractComponentPropertyAssignments(node),
    variantPropSpecs: extractVariantPropSpecs(node),
    exportSettings: node.exportSettings,

    styleIdForFill: node.styleIdForFill,
    styleIdForStrokeFill: node.styleIdForStrokeFill,

    fillGeometry: node.fillGeometry,
    strokeGeometry: node.strokeGeometry,

    mask: node.mask ?? undefined,
    arcData: node.arcData,
    vectorPaths: node.vectorPaths,
    vectorData: node.vectorData,

    booleanOperation: node.booleanOperation,

    pointCount: node.pointCount,
    starInnerRadius: node.starInnerRadius,
    starInnerScale: node.starInnerScale,

    overrideKey: node.overrideKey,

    _raw: collectFigRawFields(node),
  };

  // Collect components
  if (COMPONENT_TYPES.has(nodeType)) {
    components.set(id, designNode);
  }

  return designNode;
}

// =============================================================================
