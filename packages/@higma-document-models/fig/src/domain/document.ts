/**
 * @file High-level fig design document model
 *
 * Provides a structured, immutable view of a .fig file that is suitable
 * for editor state management and CRUD operations.
 *
 * The key differences from the raw FigNode tree:
 * - Branded IDs (FigNodeId, FigPageId) instead of raw FigGuid
 * - Typed properties instead of open index signature
 * - _raw field preserves unknown Kiwi fields for roundtrip fidelity
 *
 * These are domain types consumed by renderer, builder, and editor.
 */

import type {
  FigNodeType, FigMatrix, FigVector, FigColor, FigPaint, FigEffect, FigStrokeWeight, FigStrokeCap, FigStrokeJoin, FigStrokeAlign, FigFontName, KiwiEnumValue,
  FigDerivedBaseline, FigDerivedGlyph, FigDerivedDecoration, FigDerivedTextData,
  FigVectorPath, FigVectorData, FigStyleId, FigFillGeometry, FigGuid, FigExportSetting,
  BlendMode,
} from "../types";
import type { LoadedFigFile } from "./roundtrip-state";
import type { FigPackageImage, FigPackageMetadata } from "@higma-figma-containers/package";
import type { FigNodeId, FigPageId } from "./node-id";
import {
  applyOverrideToNode as applyOverrideToNodeImpl,
  isSelfOverride as isSelfOverrideImpl,
  isValidOverridePath as isValidOverridePathImpl,
  overrideFieldKeys as overrideFieldKeysImpl,
  overridePathToIds as overridePathToIdsImpl,
} from "./symbol-override-application";

// =============================================================================
// AutoLayout Types
// =============================================================================

/**
 * AutoLayout (Flex-like layout) properties for frame/symbol nodes.
 *
 * These map directly to Figma's auto-layout properties.
 * Enum values stored as KiwiEnumValue for binary compatibility.
 */
export type AutoLayoutProps = {
  readonly stackMode: KiwiEnumValue;
  readonly stackSpacing?: number;
  readonly stackPadding?: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly stackPrimaryAlignItems?: KiwiEnumValue;
  readonly stackCounterAlignItems?: KiwiEnumValue;
  readonly stackPrimaryAlignContent?: KiwiEnumValue;
  readonly stackWrap?: boolean;
  readonly stackCounterSpacing?: number;
  readonly itemReverseZIndex?: boolean;
};

/**
 * Constraint properties for a child node within an AutoLayout parent.
 */
export type LayoutConstraints = {
  readonly stackPositioning?: KiwiEnumValue;
  readonly stackPrimarySizing?: KiwiEnumValue;
  readonly stackCounterSizing?: KiwiEnumValue;
  readonly horizontalConstraint?: KiwiEnumValue;
  readonly verticalConstraint?: KiwiEnumValue;
  /** AutoLayout child cross-axis alignment override (STRETCH, etc.) */
  readonly stackChildAlignSelf?: KiwiEnumValue;
  /** AutoLayout child primary-axis grow factor (0 = fixed, 1 = fill) */
  readonly stackChildPrimaryGrow?: number;
};

// =============================================================================
// Text Data Types
// =============================================================================

/**
 * Text-specific data extracted from TEXT nodes.
 */
export type TextData = {
  readonly characters: string;
  readonly fontSize: number;
  readonly fontName: { readonly family: string; readonly style: string; readonly postscript?: string };
  readonly textAlignHorizontal?: KiwiEnumValue;
  readonly textAlignVertical?: KiwiEnumValue;
  readonly textAutoResize?: KiwiEnumValue;
  readonly textDecoration?: KiwiEnumValue;
  readonly textCase?: KiwiEnumValue;
  readonly lineHeight?: { readonly value: number; readonly units: KiwiEnumValue };
  readonly letterSpacing?: { readonly value: number; readonly units: KiwiEnumValue };
  /**
   * Per-character style IDs.
   *
   * Each element corresponds to a character in `characters` and references
   * an entry in `styleOverrideTable` by its `styleID` field.
   * Characters with the same ID share the same style override.
   * ID 0 means "use the node's base style" (no override).
   *
   * Post-conversion contract: when present, `characterStyleIDs.length`
   * equals `characters.length`. The raw Kiwi field may be shorter than
   * the source string — Figma omits trailing entries when they would all
   * be the base-style sentinel (0) — but the conversion layer pads to
   * full length so consumers see a single canonical shape.
   *
   * This is a near-direct representation of Figma's Kiwi
   * TextData.characterStyleIDs (with trailing-zero padding applied).
   * @see Kiwi schema: TextData.characterStyleIDs
   */
  readonly characterStyleIDs?: readonly number[];
  /**
   * Style override table.
   *
   * Each entry defines a set of style properties (fontSize, fontName,
   * fillPaints, etc.) that override the node's base style for characters
   * referencing this entry's `styleID` via `characterStyleIDs`.
   *
   * This is a direct representation of Figma's Kiwi TextData.styleOverrideTable.
   * The entries are sparse subsets of NodeChange — only style-related fields
   * are present.
   *
   * @see Kiwi schema: TextData.styleOverrideTable (array of NodeChange)
   */
  readonly styleOverrideTable?: readonly TextStyleOverride[];

  /**
   * Text truncation mode.
   * ENDING = truncate with ellipsis at the end.
   */
  readonly textTruncation?: KiwiEnumValue;

  /**
   * Leading (line spacing) trim mode.
   * CAP_HEIGHT = trim leading to cap height rather than full ascent.
   */
  readonly leadingTrim?: KiwiEnumValue;

  /**
   * Variable font axis values (e.g. weight, width).
   * Empty array when no variations are applied.
   */
  readonly fontVariations?: readonly { readonly axisTag: number; readonly axisValue: number }[];

  /**
   * Hyperlink URL attached to this text node.
   */
  readonly hyperlink?: { readonly url?: string };
};

/**
 * A style override entry for per-character text styling.
 *
 * In Figma's Kiwi format, this is a NodeChange with only style-related
 * fields populated. We model the relevant subset here.
 *
 * Each override is identified by `styleID`, which is referenced from
 * `characterStyleIDs`. The fields present in this override replace the
 * node's base style for the corresponding characters.
 */
export type TextStyleOverride = {
  /** Unique ID referenced by characterStyleIDs. 0 = base style (never in the table). */
  readonly styleID: number;
  readonly fontSize?: number;
  readonly fontName?: FigFontName;
  readonly fillPaints?: readonly FigPaint[];
  /**
   * Reference to a shared FILL style for this character range. When present,
   * the resolved paint from the style registry overrides any inline
   * `fillPaints` on this entry — same SoT precedence as on a regular node.
   */
  readonly styleIdForFill?: FigStyleId;
  /**
   * Reference to a shared FILL/STROKE style used as a stroke for this
   * character range. Symmetric to `styleIdForFill`.
   */
  readonly styleIdForStrokeFill?: FigStyleId;
  readonly textDecoration?: KiwiEnumValue;
  readonly textCase?: KiwiEnumValue;
  readonly lineHeight?: { readonly value: number; readonly units: KiwiEnumValue };
  readonly letterSpacing?: { readonly value: number; readonly units: KiwiEnumValue };
  readonly fontWeight?: number;
  readonly textStyleId?: number;
};

// =============================================================================
// Blend Mode
// =============================================================================

// BlendMode lives in `@higma-document-models/fig/types` (SSoT). Consumers must import
// directly from there — re-exporting through this module would create a
// second import surface and obscure the SSoT chain.

// =============================================================================
// Derived Text Data (for high-fidelity text rendering)
// =============================================================================

// SSoT for derived text data lives in `@higma-document-models/fig/types`
// (`FigDerived*`). Consumers must import those names directly from there;
// this module deliberately does not re-publish them under shorter aliases.

// =============================================================================
// Component/Instance Data Types
// =============================================================================

/**
 * Symbol override for an instance node.
 *
 * guidPath is the Kiwi FigGuidPath structure as-is — no conversion.
 * Each guid in the path identifies a target node in the symbol tree.
 * The remaining fields are the overridden properties (same structure
 * as FigNode fields: fillPaints, opacity, visible, transform, size, etc.).
 */
/**
 * Field-level payload for a SymbolOverride.
 *
 * Each property here carries the type the override can legally assign.
 * Modelling the payload as a typed record (not `[key: string]: unknown`)
 * lets `applyOverrideToNode`'s switch narrow the value by its key at
 * compile time — removing the per-field `value as <T>` casts that
 * previously silenced the checker.
 *
 * Field names mirror the raw Kiwi schema for ease of mapping. When a
 * Kiwi field name differs from the domain counterpart (e.g.
 * `fillPaints` → FigDesignNode.fills), applyOverrideToNode handles the
 * rename; the input type stays faithful to the .fig format.
 */
export type SymbolOverrideFields = {
  // Paint sources (Kiwi names — renamed to fills/strokes at apply time).
  readonly fillPaints?: readonly FigPaint[];
  readonly strokePaints?: readonly FigPaint[];
  readonly backgroundPaints?: readonly FigPaint[];
  // Visibility / opacity.
  readonly visible?: boolean;
  readonly opacity?: number;
  // Effects.
  readonly effects?: readonly FigEffect[];
  // Geometry.
  readonly transform?: FigMatrix;
  readonly size?: FigVector;
  readonly fillGeometry?: readonly FigFillGeometry[];
  readonly strokeGeometry?: readonly FigFillGeometry[];
  // Corner radius (uniform + per-corner).
  readonly cornerRadius?: number;
  readonly rectangleCornerRadii?: readonly number[];
  readonly rectangleTopLeftCornerRadius?: number;
  readonly rectangleTopRightCornerRadius?: number;
  readonly rectangleBottomLeftCornerRadius?: number;
  readonly rectangleBottomRightCornerRadius?: number;
  // Stroke metrics. Domain string-union unified across FigNode,
  // FigKiwiSymbolOverride, FigDesignNode, and SymbolOverride.
  readonly strokeWeight?: FigStrokeWeight;
  readonly strokeJoin?: FigStrokeJoin;
  readonly strokeCap?: FigStrokeCap;
  readonly strokeDashes?: readonly number[];
  readonly borderTopWeight?: number;
  readonly borderRightWeight?: number;
  readonly borderBottomWeight?: number;
  readonly borderLeftWeight?: number;
  // Clipping / cosmetic.
  readonly clipsContent?: boolean;
  readonly cornerSmoothing?: number;
  readonly blendMode?: BlendMode;
  // Text-derived.
  readonly derivedTextData?: FigDerivedTextData;
  // Style references.
  readonly styleIdForFill?: FigStyleId;
  readonly styleIdForStrokeFill?: FigStyleId;
  // Auto-layout per-child.
  readonly stackPositioning?: KiwiEnumValue;
  // Metadata.
  readonly name?: string;
  readonly locked?: boolean;
  // Instance swap.
  readonly overriddenSymbolID?: { readonly sessionID: number; readonly localID: number };
  // Nested-INSTANCE CPA carry-through.
  //
  // When a SYMBOL's authored design embeds an INSTANCE that itself
  // carries componentPropAssignments, Figma's exporter ships those
  // assignments inside a symbolOverride entry whose guidPath addresses
  // the embedded INSTANCE. The override needs to deliver the CPA to
  // the embedded INSTANCE so its descendants (e.g. an inner Symbol
  // [TEXT] with a matching componentPropertyRef) can apply the value.
  //
  // Concrete case: a Close Button INSTANCE carrying a symbolOverride
  // whose only payload is a `componentPropAssignments` entry setting
  // `defID → characters="..."` (an icon glyph swap). Without this
  // field, the override is silently dropped and the inner TEXT keeps
  // the SYMBOL-default glyph.
  readonly componentPropertyAssignments?: readonly ComponentPropertyAssignment[];
};

export type SymbolOverride = {
  readonly guidPath: { readonly guids: readonly { readonly sessionID: number; readonly localID: number }[] };
} & SymbolOverrideFields;

/** Keys of SymbolOverrideFields — the legal override field-name set. */
export type SymbolOverrideFieldKey = keyof SymbolOverrideFields;

/** Helper: the value type a given override field may carry. */
export type SymbolOverrideFieldValue<K extends SymbolOverrideFieldKey> = SymbolOverrideFields[K];

/**
 * Mutable version of FigDesignNode for override application.
 *
 * After deep-cloning, overrides need to mutate specific fields.
 * This type makes all fields writable while preserving the field names
 * so that property access is type-safe (no `as Record<string, unknown>`).
 */
export type MutableFigDesignNode = { -readonly [K in keyof FigDesignNode]: FigDesignNode[K] };

export const applyOverrideToNode = applyOverrideToNodeImpl;
export const isSelfOverride = isSelfOverrideImpl;
export const isValidOverridePath = isValidOverridePathImpl;
export const overrideFieldKeys = overrideFieldKeysImpl;
export const overridePathToIds = overridePathToIdsImpl;


// =============================================================================
// Component Property Types
//
// Figma's component properties allow SYMBOL/COMPONENT authors to define
// named, typed slots (text, boolean, color, instance swap, etc.) that
// INSTANCE nodes can override.
//
// Data flow:
//   SYMBOL/COMPONENT node  →  componentPropertyDefs  (definitions)
//   Child nodes of SYMBOL  →  componentPropertyRefs  (bindings to defs)
//   INSTANCE node          →  componentPropertyAssignments  (overridden values)
// =============================================================================

/**
 * Component property type.
 *
 * Maps to Figma's ComponentPropType enum:
 *   BOOL=0, TEXT=1, COLOR=2, INSTANCE_SWAP=3, VARIANT=4, NUMBER=5, IMAGE=6, SLOT=7
 */
export type ComponentPropertyType =
  | "BOOL"
  | "TEXT"
  | "COLOR"
  | "INSTANCE_SWAP"
  | "VARIANT"
  | "NUMBER"
  | "IMAGE"
  | "SLOT";

/**
 * Component property value.
 *
 * Each field corresponds to a ComponentPropertyType:
 * - BOOL       → boolValue
 * - TEXT       → textValue
 * - COLOR / INSTANCE_SWAP / VARIANT / IMAGE / SLOT
 *              → referenceValue (domain projection of Kiwi guidValue)
 * - NUMBER     → numberValue
 *
 * At runtime, exactly one field is populated based on the property type.
 * No index signature — all known value shapes are explicit.
 */
export type ComponentPropertyValue = {
  readonly boolValue?: boolean;
  readonly textValue?: {
    readonly characters: string;
  };
  /**
   * References a COMPONENT/SYMBOL node for INSTANCE_SWAP or VARIANT properties.
   * Converted from raw FigGuid to FigNodeId at domain construction time
   * via `guidToNodeId()`, ensuring type-safe lookup against `components` map.
   */
  readonly referenceValue?: FigNodeId;
  readonly numberValue?: number;
};

/**
 * A component property definition on a SYMBOL/COMPONENT node.
 *
 * Defines a named, typed slot that INSTANCE nodes can override.
 */
export type ComponentPropertyDef = {
  /** Unique identifier for this definition (GUID → FigNodeId for lookup) */
  readonly id: FigNodeId;
  /** Human-readable name (e.g., "Label", "Show Icon", "Variant") */
  readonly name: string;
  /** Property type */
  readonly type: ComponentPropertyType;
  /** Initial/default value */
  readonly initialValue?: ComponentPropertyValue;
  /** Sort order in Figma's property panel */
  readonly sortPosition?: string;
};

/**
 * What node field a component property reference binds to.
 *
 * Maps to Figma's ComponentPropNodeField enum:
 *   VISIBLE=0, TEXT_DATA=1, OVERRIDDEN_SYMBOL_ID=2, INHERIT_FILL_STYLE_ID=3, SLOT_CONTENT_ID=4
 */
export type ComponentPropertyNodeField =
  | "VISIBLE"
  | "TEXT_DATA"
  | "OVERRIDDEN_SYMBOL_ID"
  | "INHERIT_FILL_STYLE_ID"
  | "SLOT_CONTENT_ID";

/**
 * A component property reference on a child node of a SYMBOL/COMPONENT.
 *
 * Binds a specific node field to a property definition so the field
 * can be overridden by INSTANCE property assignments.
 */
export type ComponentPropertyRef = {
  /** References a ComponentPropertyDef.id */
  readonly defId: FigNodeId;
  /** Which node field this reference controls */
  readonly nodeField: ComponentPropertyNodeField;
};

/**
 * A component property assignment on an INSTANCE node.
 *
 * Overrides the value of a component property defined on the SYMBOL.
 */
export type ComponentPropertyAssignment = {
  /** References a ComponentPropertyDef.id */
  readonly defId: FigNodeId;
  /** The overridden value */
  readonly value: ComponentPropertyValue;
};

/** Variant value authored on a COMPONENT inside a COMPONENT_SET. */
export type VariantPropSpec = {
  readonly propDefId: FigNodeId;
  readonly value: string;
};

// =============================================================================
// Design Node
// =============================================================================

/**
 * A single node in the design document tree.
 *
 * This is the high-level representation of a Figma node,
 * carrying typed properties and branded IDs.
 *
 * The _raw field preserves the complete original FigNode data
 * (excluding children) for roundtrip export fidelity. Fields not
 * explicitly modeled here (e.g., advanced constraints, export settings,
 * derived data) are preserved through _raw.
 */
export type FigDesignNode = {
  readonly id: FigNodeId;
  readonly type: FigNodeType;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly transform: FigMatrix;
  readonly size: FigVector;
  /** Editor rotation/scaling origin in local node coordinates. Defaults to center when absent. */
  readonly transformOrigin?: FigVector;

  // Paint & stroke
  readonly fills: readonly FigPaint[];
  readonly strokes: readonly FigPaint[];
  readonly strokeWeight: FigStrokeWeight;
  // Stroke enums — domain string-unions, matching FigNode / SymbolOverride.
  readonly strokeAlign?: FigStrokeAlign;
  readonly strokeJoin?: FigStrokeJoin;
  readonly strokeCap?: FigStrokeCap;

  /** Stroke dash pattern (e.g., [4, 2] for dashed stroke) */
  readonly strokeDashes?: readonly number[];

  /**
   * Per-side stroke weights for frames/rectangles.
   * When borderStrokeWeightsIndependent is true, each side may have
   * a different stroke width. SVG renders this as separate stroked
   * paths per side rather than a single stroke-width attribute.
   */
  readonly individualStrokeWeights?: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };

  /**
   * Style reference for fill paint (Kiwi schema field 332).
   *
   * When present, references a shared fill style whose GUID identifies
   * a style definition node in the document. The `fills` field may
   * contain stale cached paints — consumers should resolve via a
   * FigStyleRegistry when this field is present.
   *
   * At domain construction time (`treeToDocument`), fills are pre-resolved
   * from the registry so this field serves as provenance metadata.
   * At render time, vector per-path overrides may also carry styleIdForFill
   * which needs runtime resolution via the registry.
   */
  readonly styleIdForFill?: FigStyleId;

  /**
   * Style reference for stroke paint (Kiwi schema field 333).
   * Same semantics as styleIdForFill but for strokes.
   */
  readonly styleIdForStrokeFill?: FigStyleId;

  // Geometry
  /**
   * Fill geometry: blob references for decoded path commands.
   * Each entry's commandsBlob is an index into the document's blobs array.
   */
  readonly fillGeometry?: readonly FigFillGeometry[];
  /** Stroke geometry: pre-expanded stroke outlines as blob references. */
  readonly strokeGeometry?: readonly FigFillGeometry[];

  readonly cornerRadius?: number;
  readonly rectangleCornerRadii?: readonly number[];

  /** Whether this node is a mask for its siblings */
  readonly mask?: boolean;

  /**
   * Ellipse arc data for partial arcs and donuts.
   * When present, the ellipse is rendered as a path.
   */
  readonly arcData?: {
    readonly startingAngle?: number;
    readonly endingAngle?: number;
    readonly innerRadius?: number;
  };

  /**
   * Pre-decoded SVG path strings (vectorPaths from Kiwi binary).
   * Priority source for VECTOR/LINE/STAR/POLYGON geometry.
   */
  readonly vectorPaths?: readonly FigVectorPath[];

  /**
   * Vector data including per-path style override table.
   * Used for per-contour fill overrides on VECTOR nodes.
   */
  readonly vectorData?: FigVectorData;
  /** iOS-style corner smoothing (0 = none, 1 = full) */
  readonly cornerSmoothing?: number;

  // Visual compositing
  /**
   * Blend mode for compositing this node onto the canvas.
   * PASS_THROUGH means the node inherits the parent's blend mode.
   * Stored as KiwiEnumValue in .fig binary, normalized to string at domain level.
   */
  readonly blendMode?: BlendMode;

  // Effects
  readonly effects: readonly FigEffect[];

  // Hierarchy
  readonly children?: readonly FigDesignNode[];

  // Frame/container specifics
  readonly clipsContent?: boolean;
  readonly sectionContentsHidden?: boolean;
  readonly autoLayout?: AutoLayoutProps;
  readonly layoutConstraints?: LayoutConstraints;
  /**
   * Layout grids published by FRAME / SECTION nodes. The shape is the
   * raw Kiwi `LayoutGrid` array — opaque at the domain layer because
   * domain consumers don't currently decode grids; editor overlays
   * walk the array directly when they need it. Resolved through the
   * style registry at conversion time, so `styleIdForGrid`-bound
   * grids are already substituted with the registry's authoritative
   * value when present (matching the paint / effect / text-style
   * resolution paths).
   */
  readonly layoutGrids?: readonly unknown[];

  // Text specifics
  readonly textData?: TextData;
  /**
   * Pre-computed glyph outlines for high-fidelity text rendering.
   * Contains path blobs, baselines, and decorations from the .fig binary.
   * When present, renderers use this for exact Figma-parity output
   * instead of font measurement.
   */
  readonly derivedTextData?: FigDerivedTextData;

  // Component/instance specifics
  /**
   * Reference to the SYMBOL/COMPONENT this INSTANCE resolves to.
   *
   * Uses FigNodeId (branded "sessionID:localID" string) — the same type as
   * the keys of `FigDesignDocument.components`. This type-level guarantee
   * prevents accidental assignment of raw FigGuid structs or untyped strings.
   *
   * Must be produced via `guidToNodeId(getEffectiveSymbolID(raw))` — no
   * other construction path is valid.
   */
  readonly symbolId?: FigNodeId;
  readonly overrides?: readonly SymbolOverride[];

  /**
   * Figma's pre-computed layout data for resized INSTANCE children.
   *
   * When an INSTANCE has a different size than its SYMBOL, Figma computes
   * adjusted positions/sizes for each child based on constraints. This
   * pre-computed data is stored as override entries (same structure as
   * symbolOverrides) targeting child nodes with transform/size fields.
   *
   * Used by resolveInstance to adjust child layout. Falls back to
   * constraint resolution when absent.
   */
  readonly derivedSymbolData?: readonly SymbolOverride[];

  /**
   * Component property definitions (on SYMBOL/COMPONENT nodes).
   * Defines the named, typed slots that INSTANCE nodes can override.
   */
  readonly componentPropertyDefs?: readonly ComponentPropertyDef[];

  /**
   * Component property references (on child nodes within a SYMBOL/COMPONENT).
   * Binds a node field (e.g., text content, visibility) to a property definition.
   */
  readonly componentPropertyRefs?: readonly ComponentPropertyRef[];

  /**
   * Component property assignments (on INSTANCE nodes).
   * Contains the overridden values for properties defined on the referenced SYMBOL.
   */
  readonly componentPropertyAssignments?: readonly ComponentPropertyAssignment[];

  /** Variant values for COMPONENT nodes that participate in a COMPONENT_SET. */
  readonly variantPropSpecs?: readonly VariantPropSpec[];

  /** Node export presets as stored by Figma's ExportSettings message. */
  readonly exportSettings?: readonly FigExportSetting[];

  // Boolean operation specifics
  readonly booleanOperation?: KiwiEnumValue;

  // Star/polygon specifics
  readonly pointCount?: number;
  readonly starInnerRadius?: number;
  /** Star inner scale factor (0-1). Alternative to starInnerRadius for controlling inner vertex positions. */
  readonly starInnerScale?: number;

  /**
   * Override key — Figma's stable cross-INSTANCE identifier for this
   * SYMBOL-descendant slot. When this node is the target of an override
   * or DSD entry, the entry's `guidPath` references the overrideKey,
   * not the node's own GUID. The slot-lookup pipeline must match
   * against `overrideKey` in addition to `id` so DSD entries authored
   * against the SYMBOL-side key resolve to the cloned descendant in an
   * INSTANCE expansion (e.g. Action 3 [15:943] DSD path 5591:26671 →
   * Title TEXT 15:874 whose overrideKey is 5591:26671).
   */
  readonly overrideKey?: FigGuid;

  /**
   * Raw Kiwi node data preserved for roundtrip fidelity.
   * Contains fields not explicitly modeled in this type.
   * Excluded: guid, parentIndex, children, type, name, visible, opacity,
   * transform, size, fillPaints, strokePaints (these are modeled above).
   */
  readonly _raw?: Record<string, unknown>;
};

// =============================================================================
// Page
// =============================================================================

/**
 * A page in the design document (corresponds to a CANVAS node in .fig).
 */
export type FigPage = {
  readonly id: FigPageId;
  readonly name: string;
  readonly backgroundColor: FigColor;
  readonly children: readonly FigDesignNode[];

  /** Raw CANVAS node data for roundtrip */
  readonly _raw?: Record<string, unknown>;
};

// =============================================================================
// Style Registry
// =============================================================================

/**
 * Maps a style reference key to the authoritative paint array stored
 * on the corresponding style-definition node.
 *
 * One map covers both fill-style and stroke-style references because a
 * Figma style's paint is stored on the style node itself
 * (`fillPaints` for FILL-type styles, `strokePaints` for STROKE-type
 * styles), and a consumer may legitimately reference the same style as
 * either a fill (`styleIdForFill`) or a stroke (`styleIdForStrokeFill`).
 * Splitting the registry by consumer-side intent (fills vs strokes)
 * historically caused FILL-styles-used-as-stroke to silently fall back
 * to the consumer's stale cached `strokePaints` — this single-map SoT
 * eliminates that whole class of mismatch.
 *
 * Keys come from one of two namespaces, which never collide:
 *  - GUID strings ("sessionID:localID") for same-file references.
 *  - assetRef hash strings (hex digest) for team-library imports.
 *
 * Built by `buildFigStyleRegistry` from a document-wide `nodeMap`.
 *
 * Five Kiwi `StyleType` values are indexed, each in its own map:
 *  - `paints`         — FILL- and STROKE-type styles. The single map
 *                       holds both because consumer intent
 *                       (`styleIdForFill` vs `styleIdForStrokeFill`) is
 *                       independent of where the paint sits on the
 *                       definition.
 *  - `effects`        — EFFECT-type styles (drop shadow / blur / etc.).
 *  - `textProperties` — TEXT-type styles (font / size / line-height /
 *                       letter-spacing / case / decoration).
 *  - `layoutGrids`    — GRID-type styles (column / row / cross-grid
 *                       layout aids). Stored as the raw Kiwi
 *                       `layoutGrids` array; consumers that decode
 *                       grids do their own walk.
 */
export type FigTextStyleProperties = {
  readonly fontName?: FigFontName;
  readonly fontSize?: number;
  readonly lineHeight?: { readonly value: number; readonly units: KiwiEnumValue };
  readonly letterSpacing?: { readonly value: number; readonly units: KiwiEnumValue };
  readonly textCase?: KiwiEnumValue;
  readonly textDecoration?: KiwiEnumValue;
  readonly textTracking?: number;
  readonly fontVariations?: readonly { readonly axisTag: number; readonly axisValue: number }[];
};

export type FigStyleRegistry = {
  readonly paints: ReadonlyMap<string, readonly FigPaint[]>;
  readonly effects: ReadonlyMap<string, readonly FigEffect[]>;
  readonly textProperties: ReadonlyMap<string, FigTextStyleProperties>;
  readonly layoutGrids: ReadonlyMap<string, readonly unknown[]>;
};

/** Empty style registry — no styles to resolve. */
export const EMPTY_FIG_STYLE_REGISTRY: FigStyleRegistry = {
  paints: new Map(),
  effects: new Map(),
  textProperties: new Map(),
  layoutGrids: new Map(),
};

// =============================================================================
// Design Document
// =============================================================================

/**
 * Default background color for new pages (Figma's default canvas background).
 */
export const DEFAULT_PAGE_BACKGROUND: FigColor = { r: 0.9607843, g: 0.9607843, b: 0.9607843, a: 1 };

/**
 * High-level representation of a complete .fig design file.
 *
 * Analogous to PresentationDocument in the PPTX pipeline.
 */
/**
 * Binary blob data for geometry decoding.
 *
 * Blobs are binary arrays containing encoded path commands, glyph outlines,
 * and other binary geometry data referenced by fillGeometry/strokeGeometry
 * indices on design nodes. Structurally identical to parser FigBlob —
 * defined separately to avoid domain → parser dependency.
 */
export type FigDesignBlob = {
  readonly bytes: readonly number[];
};

export type FigDesignDocument = {
  readonly pages: readonly FigPage[];
  /** Document-level color profile from the root DOCUMENT node. */
  readonly documentColorProfile?: KiwiEnumValue;
  /** Components (SYMBOL/COMPONENT nodes) indexed by their node ID */
  readonly components: ReadonlyMap<string, FigDesignNode>;
  /** Images extracted from the .fig ZIP */
  readonly images: ReadonlyMap<string, FigPackageImage>;
  /**
   * Binary blobs for geometry decoding (fillGeometry/strokeGeometry,
   * derived text paths, etc.). Indexed by blob reference numbers on nodes.
   */
  readonly blobs: readonly FigDesignBlob[];
  /** File metadata (name, export date, etc.) */
  readonly metadata: FigPackageMetadata | null;

  /**
   * Style registry mapping style GUIDs to resolved paint arrays.
   *
   * Built during domain conversion from (styleIdForFill, fillPaints) pairs
   * found across all nodes in the document. Consumers use this to resolve
   * per-path style overrides in vector data (vectorData.styleOverrideTable)
   * where an entry's `styleIdForFill` references a shared style.
   *
   * Node-level fills/strokes are pre-resolved during domain conversion,
   * so this registry is primarily needed for vector per-path overrides
   * that carry `styleIdForFill` references.
   */
  readonly styleRegistry: FigStyleRegistry;

  /**
   * Original loaded file data for roundtrip export.
   * Present only when the document was loaded from an existing .fig file.
   * Used by the export pipeline to preserve schema compatibility.
   */
  readonly _loaded?: LoadedFigFile;
};
