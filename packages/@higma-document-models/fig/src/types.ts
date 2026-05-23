/**
 * @file Fig format types
 */

import type { StackWrap } from "./constants";

// =============================================================================
// Kiwi Schema Types
// =============================================================================
//
// Kiwi schema shapes (`KiwiPrimitiveType`, `KiwiDefinitionKind`, `KiwiField`,
// `KiwiDefinition`, `KiwiSchema`) are owned by `@higma-codecs/kiwi/types`.
// Consumers must import them directly from there — this module deliberately
// does not republish them under domain-prefixed aliases.

/** Enum value as stored in Kiwi binary format */
export type KiwiEnumValue<T extends string = string> = {
  readonly value: number;
  readonly name: T;
};

/** GUID as stored in Kiwi binary format */
export type FigGuid = {
  readonly sessionID: number;
  readonly localID: number;
};

/**
 * Style reference as stored in Kiwi binary format.
 *
 * Corresponds to the Kiwi schema `StyleId` message (typeId 108).
 * References a shared style definition (fill style, stroke style, etc.)
 * via its GUID.
 */
/**
 * A shared-style reference.
 *
 * `guid` points to a style definition node in the same file. `assetRef`
 * (team-library key + version) points to a style imported from another
 * Figma file. A single reference may carry either, both, or neither.
 *
 * Resolution order used by the style registry: prefer `guid` (same-file
 * reference is authoritative). Fall back to `assetRef.key`, which we
 * match against any node in the same file whose own `key` equals the
 * asset key — Figma emits such "proxy" style-definition nodes on the
 * Internal Only Canvas so asset-referenced styles resolve locally.
 */
export type FigStyleId = {
  readonly guid?: FigGuid;
  readonly assetRef?: FigAssetRef;
};

/**
 * Team-library asset identifier (Kiwi schema `AssetRef`, typeId 105).
 * `key` is the stable content hash of the asset; `version` encodes the
 * library version at import time.
 */
export type FigAssetRef = {
  readonly key: string;
  readonly version?: string;
};

/** Parent index as stored in Kiwi binary format */
export type FigParentIndex = {
  readonly guid: FigGuid;
  readonly position: string;
};

/** Kiwi schema `GridTrackSizingType` enum. */
export type FigGridTrackSizingType = "FLEX" | "FIXED" | "HUG";

/** Kiwi schema `GridTrackSizingFunction` message. */
export type FigGridTrackSizingFunction = {
  readonly type?: KiwiEnumValue<FigGridTrackSizingType>;
  readonly value?: number;
};

/** Kiwi schema `GridTrackSize` message. */
export type FigGridTrackSizeValue = {
  readonly minSizing?: FigGridTrackSizingFunction;
  readonly maxSizing?: FigGridTrackSizingFunction;
};

/** Kiwi schema `GUIDGridTrackSizeMapEntry` message. */
export type FigGridTrackPositionEntry = {
  readonly id: FigGuid;
  readonly trackSize?: FigGridTrackSizeValue;
};

/** Kiwi schema `GUIDGridTrackSizeMap` message. */
export type FigGridTrackPositions = {
  readonly entries: readonly FigGridTrackPositionEntry[];
};

/**
 * Style override entry within a Kiwi TextData.styleOverrideTable.
 *
 * Each entry is a NodeChange with only style-related fields populated.
 * The `styleID` field identifies which characters use this override
 * (referenced via TextData.characterStyleIDs).
 *
 * @see Kiwi schema: TextData.styleOverrideTable (array of NodeChange)
 */
export type FigTextStyleOverrideEntry = {
  readonly styleID: number;
  readonly fontSize?: number;
  readonly fontName?: FigFontName;
  readonly fillPaints?: readonly FigPaint[];
  /**
   * Style references at the per-character override level. Carry the same
   * shape as the node-level fields so the renderer's run resolver can
   * route them through the same `FigStyleRegistry` SoT.
   */
  readonly styleIdForFill?: FigStyleId;
  readonly styleIdForStrokeFill?: FigStyleId;
  readonly textDecoration?: KiwiEnumValue;
  readonly textCase?: KiwiEnumValue;
  readonly lineHeight?: FigValueWithUnits;
  readonly letterSpacing?: FigValueWithUnits;
  readonly [key: string]: unknown;
};

/**
 * Kiwi TextData message as decoded from the binary format.
 *
 * Contains the text content plus per-character styling information.
 * The `characters` field is the same as the NodeChange-level `characters` field.
 *
 * @see Kiwi schema: TextData (message type 85)
 */
export type FigKiwiTextData = {
  readonly characters: string;
  readonly fontName?: FigFontName;
  readonly fontSize?: number;
  readonly lineHeight?: FigValueWithUnits;
  readonly letterSpacing?: FigValueWithUnits;
  readonly textAutoResize?: KiwiEnumValue;
  readonly textTruncation?: KiwiEnumValue;
  readonly leadingTrim?: KiwiEnumValue;
  readonly fontVariations?: readonly { readonly axisTag: number; readonly axisValue: number }[];
  readonly hyperlink?: { readonly url?: string };
  /**
   * Per-character style ID array. Each element corresponds to a character
   * and references a styleOverrideTable entry by its styleID field.
   * ID 0 means "use the node's base style" (no override).
   */
  readonly characterStyleIDs?: readonly number[];
  /**
   * Style override table. Each entry is a sparse NodeChange with only
   * style-related fields (fontSize, fontName, fillPaints, etc.).
   */
  readonly styleOverrideTable?: readonly FigTextStyleOverrideEntry[];
  readonly [key: string]: unknown;
};

// =============================================================================
// Derived Text Data Types (Kiwi schema representation)
// =============================================================================

/**
 * Baseline data from Kiwi derivedTextData.
 * Each baseline represents a line of text with its position and metrics.
 */
export type FigDerivedBaseline = {
  readonly position: FigVector;
  readonly width: number;
  readonly lineY: number;
  readonly lineHeight: number;
  readonly lineAscent: number;
  readonly firstCharacter: number;
  readonly endCharacter: number;
};

/**
 * Glyph data from Kiwi derivedTextData.
 * Each glyph references a blob index containing its path commands.
 */
export type FigDerivedGlyph = {
  readonly commandsBlob: number;
  readonly position: FigVector;
  readonly fontSize: number;
  /**
   * Source-string codepoint index of this glyph. Optional because
   * Figma's layout engine inserts synthetic glyphs (most notably the
   * ellipsis for `textTruncation=ENDING`) that do not correspond to
   * any source codepoint — those carry `firstCharacter = undefined`.
   * Renderers use this to distinguish "real" text glyphs from
   * synthetic insertions during post-layout filtering (e.g.
   * truncation tail suppression in `extractDerivedTextPathData`).
   */
  readonly firstCharacter?: number;
  readonly advance: number;
  readonly rotation?: number;
  readonly styleOverrideTable?: number;
};

/**
 * Decoration data from Kiwi derivedTextData (underlines, strikethroughs).
 */
export type FigDerivedDecoration = {
  readonly rects: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[];
  readonly styleID?: number;
};

/**
 * Per-line derived data in Kiwi derivedTextData.
 *
 * Each entry corresponds to one visually rendered line (after wrapping,
 * truncation, and BIDI resolution). The `characters` field — when present —
 * holds the substring of the source string displayed on that line; this is
 * the primary cue renderers use to detect line breaks vs. the source's own
 * `\n`-split text.
 */
export type FigDerivedLine = {
  readonly directionality?: KiwiEnumValue;
  readonly characters?: string;
  readonly baselinePosition?: FigVector;
  readonly width?: number;
};

/**
 * Per-font metadata stored alongside glyphs.
 *
 * Figma records the actual font family/style used for each glyph so that
 * renderers can reconstruct the exact line-height and baseline metrics,
 * even when the consuming environment does not have the font installed.
 */
export type FigFontMetaData = {
  readonly key?: {
    readonly family?: string;
    readonly style?: string;
    readonly postscript?: string;
  };
  readonly fontLineHeight?: number;
  readonly fontStyle?: KiwiEnumValue;
  readonly fontWeight?: number;
  /** Digest hash for font identity (opaque). */
  readonly fontDigest?: readonly number[];
};

/**
 * Pre-computed text rendering data from Kiwi binary format.
 * Contains glyph outlines, baselines, and decorations for path-based text rendering.
 *
 * `truncationStartIndex` (when >= 0) marks the codepoint index where the
 * displayed text begins showing truncation. `truncatedHeight` is the height
 * at which the text was cut (for multi-line truncation).
 */
export type FigDerivedTextData = {
  readonly layoutSize?: FigVector;
  readonly baselines?: readonly FigDerivedBaseline[];
  readonly glyphs?: readonly FigDerivedGlyph[];
  readonly decorations?: readonly FigDerivedDecoration[];
  readonly fontMetaData?: readonly FigFontMetaData[];
  readonly derivedLines?: readonly FigDerivedLine[];
  readonly truncationStartIndex?: number;
  readonly truncatedHeight?: number;
  readonly logicalIndexToCharacterOffsetMap?: readonly number[];
};

// =============================================================================
// Symbol/Instance Data Types (Kiwi schema representation)
// =============================================================================

/**
 * GUID path for targeting nested nodes in symbol overrides.
 */
export type FigGuidPath = {
  readonly guids: readonly FigGuid[];
};

/**
 * Maps a single GUID to a longer GUID path. Used by Kiwi
 * `unflatteningMappings` / `forceUnflatteningMappings` to record how a
 * flattened vector should be re-split into its component shapes when
 * re-edited.
 */
export type FigGuidPathMapping = {
  readonly id: FigGuid;
  readonly path: FigGuidPath;
};

/**
 * A canvas guide (horizontal or vertical ruler). Authored by users in
 * Figma's canvas to align content.
 */
export type FigGuide = {
  readonly axis: KiwiEnumValue;
  readonly offset: number;
  readonly guid: FigGuid;
};

/**
 * A symbol-link metadata entry (canonical URL + display labels).
 * Round-trip only — the renderer does not present these.
 */
export type FigSymbolLink = {
  readonly uri: string;
  readonly displayName: string;
  readonly displayText: string;
};

/**
 * A single dev-mode annotation property.
 */
export type FigAnnotationProperty = {
  readonly type: KiwiEnumValue;
};

/**
 * A dev-mode annotation attached to a node (text label + structured
 * properties).
 */
export type FigAnnotation = {
  readonly label: string;
  readonly properties?: readonly FigAnnotationProperty[];
  readonly labelV2?: string;
  readonly categoryId?: FigGuid;
};

/**
 * A dev-mode measurement edge between two nodes.
 */
export type FigAnnotationMeasurement = {
  readonly id: FigGuid;
  readonly fromNode: FigGuid;
  readonly toNode: FigGuid;
  readonly fromNodeSide: KiwiEnumValue;
  readonly toSameSide: boolean;
  readonly innerOffsetRelative: number;
  readonly outerOffsetFixed: number;
  readonly toNodeStablePath: FigGuidPath;
  readonly freeText: string;
};

// =============================================================================
// Library / publish round-trip metadata (Kiwi-decoded structs)
// =============================================================================

/** Records the prior key of an asset that has moved between libraries. */
export type FigLibraryMoveInfo = {
  readonly oldKey: string;
  readonly pasteFileKey: string;
};

/** One historical move entry tracking a node's prior identity. */
export type FigLibraryMoveHistoryItem = {
  readonly sourceNodeId: FigGuid;
  readonly sourceComponentKey: string;
};

/** Master / shared style metadata recorded by Figma's library system. */
export type FigSharedStyleMasterData = {
  readonly styleKey: string;
  readonly sortPosition: string;
  readonly fileKey: string;
};

export type FigSharedStyleReference = {
  readonly styleKey: string;
  readonly versionHash: string;
};

export type FigSharedComponentMasterData = {
  readonly componentKey: string;
  readonly publishingGUIDPathToTeamLibraryGUID?: readonly FigGuidPathMapping[];
  readonly isUnflattened?: boolean;
};

/** Section status (in-progress / approved / etc.) and edit metadata. */
export type FigSectionStatusInfo = {
  readonly status?: KiwiEnumValue;
  readonly lastUpdateUnixTimestamp?: number;
  readonly description?: string;
  readonly userId?: string;
  readonly prevStatus?: KiwiEnumValue;
};

/** Source coordinates for a paste operation. */
export type FigPasteSource = {
  readonly srcFile: string;
  readonly srcNode: FigGuid;
};

/** Last-edit author / timestamp metadata. */
export type FigEditInfo = {
  readonly timestampIso8601?: string;
  readonly userId?: string;
  readonly lastEditedAt?: number;
  readonly createdAt?: number;
};

/**
 * Transform modifier (repeat / skew variant of a node's geometry).
 * Used by Figma's repeat/grid pattern tools.
 */
export type FigTransformModifier = {
  readonly type: KiwiEnumValue;
  readonly offset?: { readonly x: number; readonly y: number };
  readonly visible?: boolean;
  readonly count?: number;
  readonly repeatType?: KiwiEnumValue;
  readonly axis?: KiwiEnumValue;
  readonly unitType?: KiwiEnumValue;
  readonly order?: KiwiEnumValue;
  readonly skewX?: number;
  readonly skewY?: number;
};

/**
 * A swapped-instance's prior overrides stashed against the original
 * `componentKey` so the swap can be reverted losslessly. Modern
 * exports use `InstanceOverrideStashV2` (carrying `localSymbolID`
 * instead of the legacy `componentKey`).
 */
export type FigInstanceOverrideStash = {
  readonly overridePathOfSwappedInstance: FigGuidPath;
  readonly componentKey: string;
  readonly overrides?: readonly unknown[];
};

export type FigInstanceOverrideStashV2 = {
  readonly overridePathOfSwappedInstance: FigGuidPath;
  readonly localSymbolID: FigGuid;
  readonly overrides?: readonly unknown[];
};

/**
 * A responsive-text variant — pinned to a breakpoint by `minWidth`.
 * `fields` carries a sparse NodeChange shape; the variable* fields are
 * VariableData passthroughs. Reference fields use typeId in the Kiwi
 * schema so the deepest payload is preserved verbatim.
 */
export type FigResponsiveTextStyleVariant = {
  readonly minWidth: number;
  readonly fields?: unknown;
  readonly variableFontSize?: unknown;
  readonly variableLineHeight?: unknown;
  readonly variableLetterSpacing?: unknown;
  readonly variableParagraphSpacing?: unknown;
  readonly name: string;
};

/**
 * Snapshot of the symbol-resolution result baked into a frame for
 * faster re-renders. `overrides` carries sparse NodeChange payloads
 * (typeId 211 in the Kiwi schema) and is preserved verbatim.
 */
export type FigDerivedImmutableFrameData = {
  readonly overrides?: readonly unknown[];
  readonly version?: number;
};

/**
 * Sync metadata for instance regeneration (fine-grained diff). The
 * `overrides` arrays carry sparse NodeChange payloads (typeId 211).
 */
export type FigNodeGenerationData = {
  readonly overrides?: readonly unknown[];
  readonly useFineGrainedSyncing?: boolean;
  readonly diffOnlyRemovals?: readonly unknown[];
};

/** Approval request entry for Figma's Buzz approval workflow. */
export type FigBuzzApprovalRequestInfo = {
  readonly requestId: string;
  readonly requesterUserId: string;
  readonly requestedAt: number;
  readonly reviewerUserIds: readonly string[];
  readonly title: string;
  readonly note: string;
  readonly assetsInRequest: readonly FigGuid[];
};

export type FigBuzzApprovalRequests = {
  readonly requests?: readonly FigBuzzApprovalRequestInfo[];
};

export type FigBuzzApprovalNodeStatusInfo = {
  readonly currentStatus?: KiwiEnumValue;
  readonly wasPreviouslyApproved?: boolean;
  readonly approvalRevokedAtHistory?: readonly number[];
};

/**
 * Per-paragraph list marker / indentation data attached to a text run.
 */
export type FigTextListData = {
  readonly listID?: number;
  readonly bulletType?: KiwiEnumValue;
  readonly indentationLevel?: number;
  readonly lineNumber?: number;
};

/**
 * Settings for a responsive variant set (Figma's Responsive feature).
 * Controls breakpoint-aware text scaling parameters.
 */
export type FigResponsiveSetSettings = {
  readonly title?: string;
  readonly description?: string;
  readonly scalingMode?: KiwiEnumValue;
  readonly scalingMinFontSize?: number;
  readonly scalingMaxFontSize?: number;
  readonly scalingMinLayoutWidth?: number;
  readonly scalingMaxLayoutWidth?: number;
  readonly lang?: string;
};

/**
 * Wrapper around a list of inherited variable IDs. The Kiwi `variableIds`
 * field is a typeId-260 array (variableId payload, opaque on the wire);
 * we preserve the inner array verbatim.
 */
export type FigInheritedVariablesData = {
  readonly variableIds?: readonly unknown[];
};

/**
 * Generic Kiwi "entries map" wrapper. Many fields in the schema take the
 * form `{ entries: ItemT[] }` — the codec preserves the inner array
 * verbatim, and consumers introspect it on demand.
 */
export type FigKiwiEntriesMap = {
  readonly entries?: readonly unknown[];
};

/** Slide theme reference (`{ themeID, version }`). */
export type FigSlideThemeData = {
  readonly themeID?: FigGuid;
  readonly version?: string;
};

/** Handoff (dev-mode) status map (`{ entries: HandoffStatusMapEntry[] }`). */
export type FigHandoffStatusMap = FigKiwiEntriesMap;

/** Migration status flags. */
export type FigMigrationStatus = {
  readonly dsdCleanup?: boolean;
};

/** Edit-scope diagnostics (`{ editScopeStacks, snapshots }`). */
export type FigEditScopeInfo = {
  readonly editScopeStacks?: readonly unknown[];
  readonly snapshots?: readonly unknown[];
};

/** Cooper-revert original NodeChange payload (`{ originalValues }`). */
export type FigCooperRevertData = {
  readonly originalValues?: unknown;
};

/** Hub-file attribution (`{ hubFileId, hubFileName }`). */
export type FigHubFileAttribution = {
  readonly hubFileId?: string;
  readonly hubFileName?: string;
};

/**
 * Node-level interaction / behavior bag. Each field carries a typed
 * sub-struct (link, appear, hover, etc.) — preserved verbatim; the
 * renderer does not yet emit interactions.
 */
export type FigNodeBehaviors = {
  readonly link?: unknown;
  readonly appear?: unknown;
  readonly hover?: unknown;
  readonly press?: unknown;
  readonly focus?: unknown;
  readonly scrollParallax?: unknown;
  readonly scrollTransform?: unknown;
  readonly cursor?: unknown;
};

// =============================================================================
// Round-trip metadata struct types for prototype / connector / widget /
// code / animation features. All preserved verbatim; renderer ignores.
// =============================================================================

/** Comment / collab mention attached to a node. */
export type FigMention = {
  readonly id: FigGuid;
  readonly mentionedUserId: string;
  readonly mentionedByUserId: string;
  readonly fileKey: string;
  readonly source?: KiwiEnumValue;
  readonly mentionedUserIdInt?: number;
  readonly mentionedByUserIdInt?: number;
};

export type FigTransitionInfo = {
  readonly type: KiwiEnumValue;
  readonly duration: number;
};

export type FigPrototypeDevice = {
  readonly type: KiwiEnumValue;
  readonly size?: FigVector;
  readonly presetIdentifier?: string;
  readonly rotation?: KiwiEnumValue;
};

/**
 * One prototype interaction (event → actions). The sub-typed payloads
 * for `event` and `actions` are preserved as opaque arrays — the
 * renderer does not run prototype interactions today.
 */
export type FigPrototypeInteraction = {
  readonly id: FigGuid;
  readonly event?: unknown;
  readonly actions?: readonly unknown[];
  readonly isDeleted?: boolean;
  readonly stateManagementVersion?: number;
};

export type FigPrototypeStartingPoint = {
  readonly name: string;
  readonly description: string;
  readonly position: string;
};

export type FigPluginData = {
  readonly pluginID: string;
  readonly value: string;
  readonly key: string;
};

export type FigPluginRelaunchData = {
  readonly pluginID: string;
  readonly message: string;
  readonly command: string;
  readonly isDeleted?: boolean;
};

export type FigConnectorEndpoint = {
  readonly endpointNodeID?: FigGuid;
  readonly position?: FigVector;
  readonly magnet?: KiwiEnumValue;
  readonly relativePosition?: FigVector;
};

export type FigConnectorControlPoint = {
  readonly position: FigVector;
  readonly axis?: FigVector;
};

export type FigConnectorTextMidpoint = {
  readonly section?: KiwiEnumValue;
  readonly offset?: number;
  readonly offAxisOffset?: KiwiEnumValue;
};

/** JSX-mode override snapshot (overrides is sparse NodeChange[]). */
export type FigJsxData = { readonly overrides?: readonly unknown[] };
export type FigDerivedJsxData = { readonly overrides?: readonly unknown[] };

export type FigLinkPreviewData = {
  readonly url: string;
  readonly title?: string;
  readonly provider?: string;
  readonly description?: string;
  readonly thumbnailImageHash?: string;
  readonly faviconImageHash?: string;
  readonly thumbnailImageWidth?: number;
  readonly thumbnailImageHeight?: number;
};

export type FigVideoPlayback = {
  readonly autoplay?: boolean;
  readonly mediaLoop?: boolean;
  readonly muted?: boolean;
  readonly showControls?: boolean;
  readonly startTimeMs?: number;
  readonly endTimeMs?: number;
};

export type FigStampData = {
  readonly userId: string;
  readonly votingSessionId?: string;
  readonly stampedByUserId?: string;
};

export type FigSectionPresetInfo = {
  readonly shelfId?: number;
  readonly templateId?: number;
  readonly templateName?: string;
  readonly state?: KiwiEnumValue;
};

export type FigPlatformShapeDefinition = {
  readonly propertyMapEntries?: readonly unknown[];
  readonly behaviorType?: KiwiEnumValue;
  readonly thumbnailNode?: FigGuidPath;
};

/** A Kiwi `MultiplayerMap` (used for jsxProps / widgetSyncedState / renderedSyncedState). */
export type FigMultiplayerMap = FigKiwiEntriesMap;

export type FigWidgetDerivedSubtreeCursor = {
  readonly sessionID: number;
  readonly counter: number;
};

export type FigWidgetPointer = {
  readonly nodeId: FigGuid;
};

export type FigWidgetHoverStyle = {
  readonly fillPaints?: readonly FigPaint[];
  readonly strokePaints?: readonly FigPaint[];
  readonly opacity?: number;
  readonly areFillPaintsSet?: boolean;
  readonly areStrokePaintsSet?: boolean;
  readonly isOpacitySet?: boolean;
};

export type FigWidgetMetadata = {
  readonly pluginID: string;
  readonly pluginVersionID?: string;
  readonly widgetName?: string;
  readonly isResizable?: boolean;
  readonly isRotatable?: boolean;
};

export type FigWidgetPropertyMenuItem = {
  readonly propertyName?: string;
  readonly tooltip?: string;
  readonly itemType?: KiwiEnumValue;
  readonly icon?: string;
  readonly options?: readonly unknown[];
  readonly selectedOption?: string;
  readonly isToggled?: boolean;
  readonly href?: string;
  readonly allowCustomColor?: boolean;
};

export type FigOverlayBackgroundAppearance = {
  readonly backgroundType: KiwiEnumValue;
  readonly backgroundColor?: FigColor;
};

export type FigKeyTrigger = {
  readonly keyCodes?: readonly number[];
  readonly triggerDevice?: KiwiEnumValue;
};

export type FigEmbedData = {
  readonly url: string;
  readonly srcUrl?: string;
  readonly title?: string;
  readonly thumbnailUrl?: string;
  readonly width?: number;
  readonly height?: number;
  readonly embedType?: string;
  readonly thumbnailImageHash?: string;
  readonly faviconImageHash?: string;
  readonly provider?: string;
  readonly originalText?: string;
  readonly description?: string;
  readonly embedVersionId?: string;
};

export type FigRichMediaData = {
  readonly mediaHash: string;
  readonly richMediaType?: KiwiEnumValue;
};

export type FigVariableWidthPoint = {
  readonly position: number;
  readonly ascent: number;
  readonly descent: number;
  readonly segmentId?: number;
};

export type FigDynamicStrokeSettings = {
  readonly frequency?: number;
  readonly wiggle?: number;
  readonly smoothen?: number;
};

export type FigScatterStrokeSettings = {
  readonly gap?: number;
  readonly wiggle?: number;
  readonly angularJitter?: number;
  readonly rotation?: number;
  readonly sizeJitter?: number;
};

export type FigStretchStrokeSettings = {
  readonly orientation: KiwiEnumValue;
};

export type FigCollaborativeTextOpID = {
  readonly sessionID: number;
  readonly counterID: number;
};

export type FigCollaborativePlainText = {
  readonly historyOpsWithIds?: readonly unknown[];
  readonly historyOpsWithLoc?: readonly unknown[];
  readonly historyStringContentBuffer?: Uint8Array;
  readonly changesToAppend?: readonly unknown[];
};

/** Generic GUID-or-assetRef payload used by SymbolId / CanvasNodeId / CodeLibraryId / etc. */
export type FigGuidOrAssetRefId = {
  readonly guid?: FigGuid;
  readonly assetRef?: FigAssetRef;
};

export type FigSymbolIdRef = FigGuidOrAssetRefId;
export type FigCodeLibraryId = FigGuidOrAssetRefId;
export type FigCodeFileId = FigGuidOrAssetRefId;
export type FigCodeComponentId = FigGuidOrAssetRefId;
export type FigCanvasNodeId = {
  readonly guid?: FigGuid;
  readonly symbolId?: FigSymbolIdRef;
  readonly stateGroupId?: FigGuidOrAssetRefId;
};

export type FigAssetId = {
  readonly guid?: FigGuid;
  readonly assetRef?: FigAssetRef;
  readonly stateGroupId?: FigGuidOrAssetRefId;
  readonly styleId?: FigStyleId;
  readonly symbolId?: FigSymbolIdRef;
  readonly variableId?: FigGuidOrAssetRefId;
  readonly variableSetId?: FigGuidOrAssetRefId;
};

export type FigAssetIdMap = {
  readonly entries?: readonly {
    readonly assetKey: string;
    readonly assetId: FigAssetId;
  }[];
};

export type FigImportedCodeFiles = FigKiwiEntriesMap;
export type FigImageImportMap = { readonly imports?: readonly unknown[] };

export type FigUsedMakeLibrary = {
  readonly makeLibraryId: string;
};

export type FigCodeExample = {
  readonly exampleName: string;
  readonly codeExportName?: string;
};

export type FigNodeChatMessage = {
  readonly id: FigGuid;
  readonly type?: KiwiEnumValue;
  readonly userId?: string;
  readonly textContent?: string;
  readonly sentAt?: number;
  readonly toolCalls?: readonly unknown[];
  readonly toolResults?: readonly unknown[];
  readonly sentAt64?: number;
};

export type FigNodeChatCompressionState = {
  readonly startIndex?: number;
  readonly summary?: string;
};

export type FigAIChatThread = {
  readonly messages?: readonly unknown[];
};

export type FigCodeSnapshot = {
  readonly state?: KiwiEnumValue;
  readonly invalidatedAt?: number;
  readonly paints?: readonly FigPaint[];
  readonly offset?: FigVector;
  readonly layoutSize?: FigVector;
  readonly canvasSize?: FigVector;
  readonly devicePixelRatio?: number;
};

export type FigCodeBehaviorData = {
  readonly name?: string;
  readonly icon?: string;
  readonly nodeTypes?: readonly string[];
  readonly category?: string;
  readonly apiVersion?: number;
};

export type FigCodeEmbedInfo = {
  readonly url: string;
  readonly srcUrl?: string;
  readonly title?: string;
  readonly thumbnailImageHash?: string;
};

export type FigCMSSelector = {
  readonly cmsCollectionId: string;
  readonly filterCriteria?: unknown;
  readonly sorts?: readonly unknown[];
  readonly limit?: number;
};

export type FigCMSConsumptionMap = FigKiwiEntriesMap;
export type FigCMSRichTextStyleMap = FigKiwiEntriesMap;

export type FigRepeaterCmsOverrideData = {
  readonly overrides?: readonly unknown[];
};

export type FigRepeaterOverrideData = {
  readonly parentIndexOverrides?: readonly unknown[];
};

export type FigFirstDraftData = {
  readonly generationId: string;
  readonly kit?: KiwiEnumValue;
};

export type FigFirstDraftKitElementData = {
  readonly type: KiwiEnumValue;
};

export type FigCooperTemplateData = {
  readonly type: KiwiEnumValue;
};

export type FigManagedStringData = {
  readonly key: string;
  readonly context?: string;
  readonly locale?: string;
  readonly content?: unknown;
  readonly contentSchema?: unknown;
};

export type FigAiCanvasPrompt = {
  readonly userPrompt: string;
  readonly authorId?: string;
  readonly parentNodeIds?: readonly FigGuid[];
};

export type FigTRSSTransform2D = {
  readonly translation?: FigVector;
  readonly rotation?: number;
  readonly scale?: FigVector;
  readonly shearX?: number;
};

export type FigKeyframeValueData = {
  readonly value?: unknown;
  readonly valueType?: KiwiEnumValue;
};

export type FigBezierHandles = {
  readonly p1x: number;
  readonly p1y: number;
  readonly p2x: number;
  readonly p2y: number;
};

export type FigEasingData = {
  readonly easingType?: KiwiEnumValue;
  readonly easingValue?: unknown;
};

export type FigAnimationPresets = {
  readonly presets?: readonly unknown[];
};

export type FigTransitionOverrideData = {
  readonly all?: readonly unknown[];
  readonly propertyOverrides?: unknown;
};

/**
 * A shared/published-symbol reference snapshot. Carries the master
 * key, the GUID-path mappings for nested overrides, and the
 * library subscription metadata.
 */
export type FigSharedSymbolReference = {
  readonly fileKey: string;
  readonly symbolID: FigGuid;
  readonly versionHash: string;
  readonly guidPathMappings?: readonly FigGuidPathMapping[];
  readonly bytes?: Uint8Array;
  readonly libraryGUIDToSubscribingGUID?: readonly unknown[];
  readonly componentKey: string;
  readonly unflatteningMappings?: readonly FigGuidPathMapping[];
  readonly isUnflattened?: boolean;
};

/**
 * `VariableID` references a Figma variable, either local (sessionID +
 * localID, like any other GUID) or imported from a published library
 * (`assetRef`). The library-asset form cannot be resolved from a
 * single .fig file — its value is opaque to local evaluation.
 */
export type FigVariableID =
  | FigGuid
  | { readonly assetRef: { readonly key: string; readonly version?: string } };

/**
 * `Expression` mirrors the Kiwi `Expression` message. Wraps an
 * `expressionFunction` (RESOLVE_VARIANT / NEGATE / MULTIPLY / ...)
 * with a list of argument `VariableData` payloads.
 */
export type FigVariableExpression = {
  readonly expressionFunction: KiwiEnumValue;
  readonly expressionArguments?: readonly FigKiwiVariableData[];
};

/**
 * One key/value pair inside a `VariableMapValue`. Used by RESOLVE_VARIANT
 * to bind a property name (e.g. "BG Context") to its resolved variable
 * data, optionally tagged by `guidKey` for unique identification across
 * library boundaries.
 */
export type FigVariableMapEntry = {
  readonly key: string;
  readonly value?: FigKiwiVariableData;
  readonly guidKey?: FigGuid;
};

export type FigVariableMap = {
  readonly values?: readonly FigVariableMapEntry[];
};

/**
 * Kiwi-shape `VariableAnyValue`: at most one of these fields is set,
 * matching the schema's "oneof" semantics expressed via field
 * presence. Consumers should not branch on this type directly —
 * project it through `projectVariableAnyValue` (see
 * `@higma-document-models/fig/variables`) into the `FigVariableAnyValue` discriminated
 * union and then `switch (kind)`.
 */
export type FigKiwiVariableAnyValue = {
  readonly boolValue?: boolean;
  readonly textValue?: string;
  readonly floatValue?: number;
  readonly alias?: FigVariableID;
  readonly colorValue?: FigColor;
  readonly expressionValue?: FigVariableExpression;
  readonly mapValue?: FigVariableMap;
};

/**
 * Discriminated union of every variant the Kiwi `VariableAnyValue`
 * message can carry. The `kind` discriminator is synthetic — the Kiwi
 * representation uses field presence (`FigKiwiVariableAnyValue`) — but
 * downstream consumers (resolvers, renderer) want a single
 * switchable shape, so we project the schema's "exactly one of" rule
 * onto a typed union here.
 */
export type FigVariableAnyValue =
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "alias"; readonly value: FigVariableID }
  | { readonly kind: "color"; readonly value: FigColor }
  | { readonly kind: "expression"; readonly value: FigVariableExpression }
  | { readonly kind: "map"; readonly value: FigVariableMap };

/**
 * Variable-data binding entry — one mapping from a node field to a
 * Figma variable's value. Carried by overrides whose authored value
 * came from a Figma variable rather than a literal.
 *
 * `variableData` mirrors the Kiwi `VariableData` message: the
 * authored value plus its declared and resolved data types. The inner
 * `value` slot is the Kiwi-shape `FigKiwiVariableAnyValue`; project
 * via `projectVariableAnyValue` for the discriminated union form.
 */
export type FigKiwiVariableData = {
  readonly value?: FigKiwiVariableAnyValue;
  readonly dataType?: KiwiEnumValue;
  readonly resolvedDataType?: KiwiEnumValue;
};

export type FigKiwiVariableDataMapEntry = {
  readonly nodeField?: number;
  readonly variableData?: FigKiwiVariableData;
  readonly variableField?: KiwiEnumValue;
};

export type FigKiwiVariableDataMap = {
  readonly entries: readonly FigKiwiVariableDataMapEntry[];
};

export type FigKiwiVariableDataValueEntry = {
  readonly modeID?: FigGuid;
  readonly variableData?: FigKiwiVariableData;
};

export type FigKiwiVariableDataValues = {
  readonly entries: readonly FigKiwiVariableDataValueEntry[];
};

export type FigKiwiVariableSetMode = {
  readonly id?: FigGuid;
  readonly name?: string;
  readonly sortPosition?: string;
};

/**
 * `variableModeBySetMap` lists which mode a variable-set is currently
 * pinned to — e.g. "Mode=Light" for the iOS color set. Each entry
 * names a `variableSetID` and a `variableModeID`.
 */
export type FigKiwiVariableModeBySetMapEntry = {
  readonly variableSetID?: FigGuidOrAssetRefId;
  readonly variableModeID?: FigGuid;
};

export type FigKiwiVariableModeBySetMap = {
  readonly entries: readonly FigKiwiVariableModeBySetMapEntry[];
};

/**
 * Symbol override entry as stored in Kiwi binary format.
 *
 * Each entry targets a specific child node (via guidPath) and overrides
 * one or more of its properties. Structurally an override is a guidPath
 * plus a payload of typed FigNode-shaped fields.
 *
 * We cannot literally write `Partial<FigNode>` here because FigNode contains
 * `derivedSymbolData: FigKiwiSymbolOverride[]` — that circularity causes
 * TypeScript to widen field accesses back to `unknown`. Instead we maintain
 * `FigKiwiSymbolOverridePayload` as the SoT for "which FigNode fields may
 * appear in an override" and keep it in sync with FigNode by construction.
 */
export type FigKiwiSymbolOverridePayload = {
  readonly name?: string;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly blendMode?: KiwiEnumValue<BlendMode>;
  readonly mask?: boolean;
  readonly maskIsOutline?: boolean;
  readonly maskType?: KiwiEnumValue<FigMaskType>;
  readonly clipsContent?: boolean;
  readonly frameMaskDisabled?: boolean;
  readonly transform?: FigMatrix;
  readonly size?: FigVector;
  readonly fillPaints?: readonly FigPaint[];
  readonly strokePaints?: readonly FigPaint[];
  readonly strokeWeight?: FigStrokeWeight;
  readonly individualStrokeWeights?: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly strokeJoin?: KiwiEnumValue<FigStrokeJoin>;
  readonly strokeCap?: KiwiEnumValue<FigStrokeCap>;
  readonly strokeAlign?: KiwiEnumValue<FigStrokeAlign>;
  readonly strokeDashes?: readonly number[];
  readonly borderTopWeight?: number;
  readonly borderRightWeight?: number;
  readonly borderBottomWeight?: number;
  readonly borderLeftWeight?: number;
  readonly borderStrokeWeightsIndependent?: boolean;
  readonly cornerRadius?: number;
  readonly rectangleCornerRadii?: readonly number[];
  readonly rectangleTopLeftCornerRadius?: number;
  readonly rectangleTopRightCornerRadius?: number;
  readonly rectangleBottomLeftCornerRadius?: number;
  readonly rectangleBottomRightCornerRadius?: number;
  readonly rectangleCornerRadiiIndependent?: boolean;
  // "Constrain proportions" flag — Figma's UI lets authors toggle this
  // directly on an INSTANCE (paired with `size`) without descending into
  // a SYMBOL descendant, so the parser surfaces it on override entries
  // whose path-first guid is the INSTANCE's own ghost-allocated guid.
  // Treated as an INSTANCE-self field by the self-override classifier.
  readonly proportionsConstrained?: boolean;
  readonly fillGeometry?: readonly FigFillGeometry[];
  readonly strokeGeometry?: readonly FigFillGeometry[];
  readonly vectorPaths?: readonly FigVectorPath[];
  readonly vectorData?: FigVectorData;
  readonly effects?: readonly FigEffect[];
  readonly styleIdForFill?: FigStyleId;
  readonly styleIdForStrokeFill?: FigStyleId;
  readonly styleIdForText?: FigStyleId;
  readonly styleIdForEffect?: FigStyleId;
  readonly styleIdForGrid?: FigStyleId;
  readonly characters?: string;
  readonly textData?: FigKiwiTextData;
  readonly derivedTextData?: FigDerivedTextData;
  readonly componentPropAssignments?: readonly FigComponentPropAssignment[];
  readonly overriddenSymbolID?: FigGuid;
  // Variable / parameter consumption (component property bindings).
  //
  // Schema: `Map<entries[]>`. Each entry binds a Figma variable to a
  // node field. The full payload (`variableData.value` chain) is only
  // needed by RESOLVE_VARIANT evaluation; until that lands the entries
  // are preserved verbatim and only field-level presence is consumed
  // by the self-override detector.
  readonly variableConsumptionMap?: FigKiwiVariableDataMap;
  readonly parameterConsumptionMap?: FigKiwiVariableDataMap;
  readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
  // Authoring-only metadata fields the parser preserves verbatim.
  readonly stackPositioning?: KiwiEnumValue;
  readonly stackPrimarySizing?: KiwiEnumValue;
  // Auto-layout padding overrides. Real Figma exports place these on
  // INSTANCE override entries whose single-guid path addresses the
  // INSTANCE itself (via an unreachable ghost-session guid). Without
  // declaring them on this payload type the parser still passes them
  // through (the Kiwi schema accepts them), but the self-override
  // detector cannot classify them and they get dropped with
  // "[higma] dropping override entry with unreachable guid …".
  // Surfaced by the App Store Community template "Search" INSTANCEs
  // (effective SYMBOL `2:2878 State=Placeholder`) which carry
  // `{name, size, stackPaddingRight}` self-overrides.
  readonly stackPadding?: number;
  readonly stackVerticalPadding?: number;
  readonly stackHorizontalPadding?: number;
  readonly stackPaddingRight?: number;
  readonly stackPaddingBottom?: number;
  readonly stackSpacing?: number;
  readonly stackPrimaryAlignItems?: KiwiEnumValue;
  readonly stackCounterAlignItems?: KiwiEnumValue;
  readonly stackPrimaryAlignContent?: KiwiEnumValue;
  readonly stackCounterAlignContent?: KiwiEnumValue;
  readonly stackCounterSpacing?: number;
  readonly stackCounterSizing?: KiwiEnumValue;
  readonly stackWrap?: KiwiEnumValue<StackWrap>;
  readonly stackReverseZIndex?: boolean;
  readonly stackChildAlignSelf?: KiwiEnumValue;
  readonly stackChildPrimaryGrow?: number;
  readonly stackMode?: KiwiEnumValue;
  readonly overrideLevel?: number;
};

export type FigKiwiSymbolOverride = FigKiwiSymbolOverridePayload & {
  readonly guidPath: FigGuidPath;
};

/**
 * Symbol data message as stored in Kiwi binary format.
 *
 * Contains the SYMBOL reference and override data for INSTANCE nodes.
 * (Figma's UI "Component" concept is encoded on disk as a SYMBOL — the
 * canonical `figma-schema.json` declares only `SYMBOL=15` and
 * `INSTANCE=16`, never `COMPONENT` or `COMPONENT_SET`.)
 */
export type FigKiwiSymbolData = {
  readonly symbolID?: FigGuid;
  readonly symbolOverrides?: readonly FigKiwiSymbolOverride[];
  readonly [key: string]: unknown;
};

// =============================================================================
// Component Property Types (Kiwi schema representation)
// =============================================================================

/**
 * Component property definition as stored in Kiwi binary format.
 */
export type FigComponentPropDef = {
  readonly id?: FigGuid;
  readonly name?: string;
  readonly type?: KiwiEnumValue;
  readonly initialValue?: FigComponentPropValue;
  readonly sortPosition?: string;
  readonly [key: string]: unknown;
};

/**
 * Variant property assignment as stored in Kiwi binary format.
 * Sibling SYMBOL nodes inside a variant-set FRAME use this to declare
 * which variant value they represent for a given component property
 * definition. (The variant-set parent is a FRAME on disk; the
 * `Prop=Value` sibling-naming pattern is how variants are encoded.)
 */
export type FigVariantPropSpec = {
  readonly propDefId?: FigGuid;
  readonly value?: string;
  readonly [key: string]: unknown;
};

/**
 * Component property value as stored in Kiwi binary format.
 */
export type FigComponentPropValue = {
  readonly boolValue?: boolean;
  readonly textValue?: { readonly characters: string; readonly lines?: readonly unknown[] };
  readonly guidValue?: FigGuid;
  readonly numberValue?: number;
  readonly floatValue?: number;
  readonly [key: string]: unknown;
};

/**
 * Component property reference as stored in Kiwi binary format.
 * Binds a node field to a component property definition.
 */
export type FigComponentPropRef = {
  readonly defID?: FigGuid;
  readonly componentPropNodeField?: KiwiEnumValue;
  readonly [key: string]: unknown;
};

// =============================================================================
// Export Setting (Kiwi schema representation)
// =============================================================================

/**
 * Export setting as stored in Kiwi binary format.
 */
export type FigExportSetting = {
  readonly suffix?: string;
  readonly imageType?: KiwiEnumValue;
  readonly constraint?: { readonly type?: KiwiEnumValue; readonly value?: number };
  readonly svgDataName?: boolean;
  readonly [key: string]: unknown;
};

// =============================================================================
// Component Property Assignment (Kiwi schema representation)
// =============================================================================

/**
 * Component property assignment as stored in Kiwi binary format.
 *
 * Represents an overridden value for a component property on an INSTANCE node.
 * `defID` references the ComponentPropertyDef on the SYMBOL.
 */
export type FigComponentPropAssignment = {
  readonly defID: FigGuid;
  readonly value: FigComponentPropValue;
};

// =============================================================================
// Node Type
// =============================================================================

/**
 * Fig node as decoded from Kiwi binary format.
 * This represents the Kiwi structure, not a secondary API.
 *
 * Typed fields cover the most commonly accessed properties.
 * The index signature provides access to additional Kiwi schema fields.
 */
export type FigNode = {
  readonly guid: FigGuid;
  readonly phase: KiwiEnumValue;
  readonly type: KiwiEnumValue<FigNodeType>;
  readonly name?: string;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly parentIndex?: FigParentIndex;
  readonly transform?: FigMatrix;
  readonly size?: FigVector;
  readonly fillPaints?: readonly FigPaint[];
  /** Frame background paints used by real Figma exports. */
  readonly backgroundPaints?: readonly FigPaint[];
  /** Fill-style GUID for `backgroundPaints` (Kiwi schema field 194). */
  readonly inheritFillStyleIDForBackground?: FigGuid;
  readonly strokePaints?: readonly FigPaint[];
  readonly strokeWeight?: FigStrokeWeight;
  readonly individualStrokeWeights?: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly strokeAlign?: KiwiEnumValue<FigStrokeAlign>;
  readonly strokeJoin?: KiwiEnumValue<FigStrokeJoin>;
  readonly strokeCap?: KiwiEnumValue<FigStrokeCap>;
  readonly cornerRadius?: number;
  readonly rectangleCornerRadii?: readonly number[];
  /** Individual corner radius fields (real .fig format — alternative to array) */
  readonly rectangleTopLeftCornerRadius?: number;
  readonly rectangleTopRightCornerRadius?: number;
  readonly rectangleBottomRightCornerRadius?: number;
  readonly rectangleBottomLeftCornerRadius?: number;
  readonly fillGeometry?: readonly FigFillGeometry[];
  readonly strokeGeometry?: readonly FigFillGeometry[];
  readonly vectorPaths?: readonly FigVectorPath[];
  /** Vector data including network blob and per-path style overrides */
  readonly vectorData?: FigVectorData;
  /** Canvas guide definitions authored on frame-like nodes (Kiwi `Guide[]`). */
  readonly guides?: readonly FigGuide[];
  readonly effects?: readonly FigEffect[];
  /** Style reference for fill paint (Kiwi schema field 332) */
  readonly styleIdForFill?: FigStyleId;
  /** Style reference for stroke paint (Kiwi schema field 333) */
  readonly styleIdForStrokeFill?: FigStyleId;
  /**
   * Style reference for text properties (Kiwi schema field 334).
   * Resolves to a TEXT-type style-definition node whose own
   * `fontName` / `fontSize` / `lineHeight` / `letterSpacing` /
   * `textCase` / `textDecoration` / `textTracking` define the
   * shared text style. Used on TEXT nodes only.
   */
  readonly styleIdForText?: FigStyleId;
  /**
   * Style reference for effects (Kiwi schema field 335). Resolves to
   * an EFFECT-type style-definition node whose own `effects` array
   * (DROP_SHADOW / INNER_SHADOW / FOREGROUND_BLUR / BACKGROUND_BLUR)
   * defines the shared effect style.
   */
  readonly styleIdForEffect?: FigStyleId;
  /**
   * Style reference for layout grids (Kiwi schema field 336).
   * Resolves to a GRID-type style-definition node whose own
   * `layoutGrids` array defines the shared grid style. Used on
   * FRAME / SECTION nodes that publish layout grids.
   */
  readonly styleIdForGrid?: FigStyleId;
  /** Stroke dash pattern */
  readonly strokeDashes?: readonly number[];
  /**
   * Whether per-side border weights consume layout space. `true` means
   * strokes contribute to auto-layout sizing; `false` (default for
   * legacy files) means strokes paint without affecting flow. Kiwi
   * field 294.
   */
  readonly bordersTakeSpace?: boolean;
  /** Per-side stroke weights (Figma "Independent stroke weights" feature) */
  readonly borderTopWeight?: number;
  readonly borderRightWeight?: number;
  readonly borderBottomWeight?: number;
  readonly borderLeftWeight?: number;
  readonly borderStrokeWeightsIndependent?: boolean;
  /** Per-side border visibility ("hidden" sides skip the stroke entirely). */
  readonly borderTopHidden?: boolean;
  readonly borderRightHidden?: boolean;
  readonly borderBottomHidden?: boolean;
  readonly borderLeftHidden?: boolean;
  /**
   * When true, the node's exported / measurement bounds use its absolute
   * (post-transform) bounding box rather than its layout-flow bounds.
   * Figma's "Use absolute bounds for measurements" toggle. Kiwi field 258.
   */
  readonly useAbsoluteBounds?: boolean;
  readonly mask?: boolean;
  readonly maskIsOutline?: boolean;
  readonly maskType?: KiwiEnumValue<FigMaskType>;
  readonly clipsContent?: boolean;
  readonly frameMaskDisabled?: boolean;
  readonly backgroundColor?: FigColor;
  readonly backgroundEnabled?: boolean;
  readonly backgroundOpacity?: number;
  readonly documentColorProfile?: KiwiEnumValue;
  /** Blend mode for compositing. */
  readonly blendMode?: KiwiEnumValue<BlendMode>;
  /** iOS-style corner smoothing (0-1 range) */
  readonly cornerSmoothing?: number;

  // ---- AutoLayout (frame-level) ----
  /** Stack (auto-layout) direction: VERTICAL or HORIZONTAL */
  readonly stackMode?: KiwiEnumValue;
  /** Spacing between stack children (px) */
  readonly stackSpacing?: number;
  /** Padding: number (uniform) or per-side object */
  readonly stackPadding?: number;
  /** Vertical padding (legacy shorthand, Kiwi field) */
  readonly stackVerticalPadding?: number;
  /** Horizontal padding (legacy shorthand, Kiwi field) */
  readonly stackHorizontalPadding?: number;
  /** Right padding override */
  readonly stackPaddingRight?: number;
  /** Bottom padding override */
  readonly stackPaddingBottom?: number;
  /** Primary axis alignment */
  readonly stackPrimaryAlignItems?: KiwiEnumValue;
  /** Counter axis alignment */
  readonly stackCounterAlignItems?: KiwiEnumValue;
  /** Primary axis content distribution */
  readonly stackPrimaryAlignContent?: KiwiEnumValue;
  /** Counter axis content distribution (parallel to Primary; written by modern Figma when stackWrap is enabled). */
  readonly stackCounterAlignContent?: KiwiEnumValue;
  /** Whether children wrap to next line */
  readonly stackWrap?: KiwiEnumValue<StackWrap>;
  /** Spacing between wrapped rows/columns */
  readonly stackCounterSpacing?: number;
  /** Reverse z-order of children */
  readonly stackReverseZIndex?: boolean;
  /** CSS-grid column track map, Kiwi field `gridColumns`. */
  readonly gridColumns?: FigGridTrackPositions;
  /** CSS-grid row track map, Kiwi field `gridRows`. */
  readonly gridRows?: FigGridTrackPositions;
  /** CSS-grid column sizing map, Kiwi field `gridColumnsSizing`. */
  readonly gridColumnsSizing?: FigGridTrackPositions;
  /** CSS-grid row sizing map, Kiwi field `gridRowsSizing`. */
  readonly gridRowsSizing?: FigGridTrackPositions;

  // ---- AutoLayout (child-level) ----
  /** How this child is positioned in the parent stack (AUTO or ABSOLUTE) */
  readonly stackPositioning?: KiwiEnumValue;
  /** How this child sizes on primary axis (FIXED, HUG, FILL) */
  readonly stackPrimarySizing?: KiwiEnumValue;
  /** How this child sizes on counter axis (FIXED, HUG, FILL) */
  readonly stackCounterSizing?: KiwiEnumValue;
  /** Horizontal constraint for non-auto-layout positioning */
  readonly horizontalConstraint?: KiwiEnumValue;
  /** Vertical constraint for non-auto-layout positioning */
  readonly verticalConstraint?: KiwiEnumValue;
  /** AutoLayout child cross-axis alignment override (STRETCH, AUTO, etc.) */
  readonly stackChildAlignSelf?: KiwiEnumValue;
  /** AutoLayout child primary-axis grow factor (0 = fixed, 1 = fill container) */
  readonly stackChildPrimaryGrow?: number;

  // ---- Boolean operation ----
  /** Boolean operation type (UNION, SUBTRACT, INTERSECT, EXCLUDE) */
  readonly booleanOperation?: KiwiEnumValue;

  // ---- Symbol/Instance fields ----
  /** Symbol data for INSTANCE nodes (symbolID, overrides) */
  readonly symbolData?: FigKiwiSymbolData;
  /** Overridden symbol ID for variant swapping */
  readonly overriddenSymbolID?: FigGuid;
  /** Derived symbol data (computed transforms for INSTANCE children) */
  readonly derivedSymbolData?: readonly FigKiwiSymbolOverride[];
  /** Kiwi layout-version marker for `derivedSymbolData`; preserved with the INSTANCE. */
  readonly derivedSymbolDataLayoutVersion?: number;
  /** Component property references (bound property definition IDs, string format) */
  readonly componentPropertyReferences?: readonly string[];
  /** Component property assignments (overridden values on INSTANCE) */
  readonly componentPropAssignments?: readonly FigComponentPropAssignment[];
  /** Component property definitions (on SYMBOL nodes, Kiwi format) */
  readonly componentPropDefs?: readonly FigComponentPropDef[];
  /** Component property references on child nodes (binds field to prop def) */
  readonly componentPropRefs?: readonly FigComponentPropRef[];
  /** Variant property values on SYMBOL nodes inside a variant-set FRAME */
  readonly variantPropSpecs?: readonly FigVariantPropSpec[];
  /** Canonical link metadata attached to SYMBOL/component definitions. */
  readonly symbolLinks?: readonly FigSymbolLink[];
  /** Variant backing node reference stored in Kiwi as CanvasNodeId. */
  readonly backingNodeId?: FigCanvasNodeId;
  /**
   * Variant-Set marker on a FRAME. On disk, a "Component Set" /
   * "Variant Set" is a FRAME bearing `isStateGroup === true` plus
   * VARIANT-typed `componentPropDefs`. The canonical schema has no
   * COMPONENT_SET NodeType — see
   * `docs/refactor/component-type-cleanup.md`.
   */
  readonly isStateGroup?: boolean;

  /**
   * Per-property ordering metadata on a Variant Set FRAME — the
   * canonical sort order Figma displays in its variants picker. Kiwi
   * field 238 (`stateGroupPropertyValueOrders`). Separate from the
   * `componentPropDefs[].preferredValues` map: order is authored on
   * the parent FRAME, value semantics on the per-prop def.
   */
  readonly stateGroupPropertyValueOrders?: readonly {
    readonly property: string;
    readonly values: readonly string[];
  }[];

  /**
   * Generic publish-to-library flag (Kiwi field 174). Distinct from
   * `isSymbolPublishable` (field 123); both can sit on the same
   * NodeChange. Used on a Variant Set parent FRAME to mark it as
   * published — read by Figma's library indexer alongside the
   * per-SYMBOL `isSymbolPublishable`.
   */
  readonly isPublishable?: boolean;

  // ---- Variable consumption (RESOLVE_VARIANT, color binding, etc.) ----
  /**
   * Per-field variable bindings on this INSTANCE. The expression form
   * (RESOLVE_VARIANT, NEGATE, ...) drives variant selection and dynamic
   * value resolution. See `@higma-document-models/fig/symbols/variable-resolution` for
   * the evaluator that consumes this field.
   */
  readonly variableConsumptionMap?: FigKiwiVariableDataMap;
  /** Component-property variable bindings (parameter form). */
  readonly parameterConsumptionMap?: FigKiwiVariableDataMap;
  /** Active mode per variable-set referenced by this INSTANCE / its ancestors. */
  readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
  /** Variable-set modes on VARIABLE_SET nodes. */
  readonly variableSetModes?: readonly FigKiwiVariableSetMode[];
  /** Owning variable set on VARIABLE nodes. */
  readonly variableSetID?: FigGuidOrAssetRefId;
  /** Concrete per-mode values on VARIABLE nodes. */
  readonly variableDataValues?: FigKiwiVariableDataValues;
  /** Resolved primitive type on VARIABLE nodes. */
  readonly variableResolvedType?: KiwiEnumValue;
  /** Human-readable token path on VARIABLE nodes. */
  readonly variableTokenName?: string;

  // ---- Style-definition fields (shared-style proxy nodes) ----
  /**
   * Style classification for nodes that ARE style definitions (rather than
   * consumers). A style-definition node's own `fillPaints` / `strokePaints`
   * is the authoritative paint value for the referenced style, and its
   * `key` matches the `assetRef.key` of every consumer's `styleIdForFill` /
   * `styleIdForStrokeFill`. Figma places such nodes on the Internal Only
   * Canvas so they do not render as visible content.
   */
  readonly styleType?: KiwiEnumValue;
  /**
   * Team-library asset key for a node that is a style or component
   * definition. Used to resolve `styleIdForFill.assetRef.key` references
   * to their local style-definition node when the asset was imported from
   * another Figma file.
   */
  readonly key?: string;
  /** Team-library asset version paired with `key` on imported style/component/variable metadata nodes. */
  readonly version?: string;
  /** File asset id map stored on library/style/component metadata nodes. */
  readonly fileAssetIds?: FigAssetIdMap;
  /** Legacy style-definition marker stored as Kiwi uint field 49. */
  readonly styleID?: number;

  // ---- Section fields ----
  /** Whether section contents are hidden (collapsed) */
  readonly sectionContentsHidden?: boolean;

  // ---- Shape fields ----
  /** Number of points for STAR and REGULAR_POLYGON nodes */
  readonly pointCount?: number;
  /** Inner radius ratio for STAR nodes (0-1 range, default 0.382) */
  readonly starInnerRadius?: number;
  /** Star inner scale factor (0-1). Controls inner vertex positions relative to outer. */
  readonly starInnerScale?: number;
  /** Stroke dash pattern emitted by older Kiwi captures. */
  readonly dashPattern?: readonly number[];
  /** Handle mirroring mode for vector point handles */
  readonly handleMirroring?: KiwiEnumValue;

  // ---- Export settings ----
  /** Export settings for the node (Kiwi ExportSettings message) */
  readonly exportSettings?: readonly FigExportSetting[];

  // ---- Internal metadata ----
  /** Whether this node is internal-only (e.g., Internal Only Canvas) */
  readonly internalOnly?: boolean;

  // ---- Text fields ----
  /** Text characters content */
  readonly characters?: string;
  /** Font size in pixels */
  readonly fontSize?: number;
  /** Font family and style */
  readonly fontName?: FigFontName;
  /** Horizontal text alignment */
  readonly textAlignHorizontal?: KiwiEnumValue;
  /** Vertical text alignment */
  readonly textAlignVertical?: KiwiEnumValue;
  /** Text auto-resize mode */
  readonly textAutoResize?: KiwiEnumValue;
  /** Text decoration (underline, strikethrough) */
  readonly textDecoration?: KiwiEnumValue;
  /** Text case transformation (UPPER, LOWER, TITLE, etc.) */
  readonly textCase?: KiwiEnumValue;
  /** Line height with units */
  readonly lineHeight?: FigValueWithUnits;
  /** Letter spacing with units */
  readonly letterSpacing?: FigValueWithUnits;
  /** Text truncation mode (ENDING = ellipsis at end) */
  readonly textTruncation?: KiwiEnumValue;
  /** Leading trim mode (CAP_HEIGHT = trim to cap height) */
  readonly leadingTrim?: KiwiEnumValue;
  /** Variable font axis values */
  readonly fontVariations?: readonly { readonly axisTag: number; readonly axisValue: number }[];
  /**
   * Letter-spacing tracking value (Kiwi `textTracking`). Distinct from
   * the unit-bearing `letterSpacing`: this is a numeric tracking adjust
   * applied at the engine level. Used by text-style definitions and
   * preserved on TEXT nodes that carry it.
   */
  readonly textTracking?: number;
  /** Hyperlink data */
  readonly hyperlink?: { readonly url?: string };
  /**
   * Layout grids (Kiwi `layoutGrids`). Set on FRAME / SECTION nodes
   * that publish layout grids and on GRID-type style-definition nodes
   * whose `layoutGrids` array is the authoritative grid set.
   */
  readonly layoutGrids?: readonly unknown[];
  /** Kiwi TextData message for TEXT nodes (per-character styling) */
  readonly textData?: FigKiwiTextData;
  /** Pre-computed text rendering data (glyph outlines, baselines, decorations) */
  readonly derivedTextData?: FigDerivedTextData;

  /**
   * Override key — Figma's stable identifier used by SYMBOL-side overrides
   * to address descendant slots. Different from `guid` (instance-side).
   * DSD `guidPath` entries reference this key, so SymbolResolver treats
   * `overrideKey` as an exact slot address alongside the descendant GUID.
   */
  readonly overrideKey?: FigGuid;

  // ---- Ellipse fields ----
  /** Arc data for partial ellipse/donut shapes */
  readonly arcData?: {
    readonly startingAngle: number;
    readonly endingAngle: number;
    readonly innerRadius: number;
  };

  /** Child nodes when a parser/runtime source already materialized nested children. */
  readonly children?: readonly (FigNode | null | undefined)[];
  /** Additional fields (Kiwi schema has many optional fields) */
  readonly [key: string]: unknown;
};

/**
 * Mutable version of FigNode for use in clone-and-mutate operations.
 *
 * `deepCloneNode` creates a shallow copy of a FigNode. The resulting
 * object is structurally identical but needs to be mutated by
 * `applyOverrides`, `applyComponentPropAssignments`, etc.
 *
 * Using this type instead of `Record<string, unknown>` preserves
 * type safety while allowing mutation.
 */
export type MutableFigNode = {
  -readonly [K in keyof FigNode]: FigNode[K];
};

// =============================================================================
// Figma Node Types
// =============================================================================

/**
 * Known Figma node types.
 *
 * SSoT — every `FigNodeType` comparison / switch / Set member must refer
 * to the `FIG_NODE_TYPE.*` constants below. Raw string literals such as
 * `"INSTANCE"` are forbidden in consumers because a typo silently
 * compiles against the widened string type.
 */
export const FIG_NODE_TYPE = {
  DOCUMENT: "DOCUMENT",
  CANVAS: "CANVAS",
  FRAME: "FRAME",
  GROUP: "GROUP",
  RECTANGLE: "RECTANGLE",
  ROUNDED_RECTANGLE: "ROUNDED_RECTANGLE",
  ELLIPSE: "ELLIPSE",
  VECTOR: "VECTOR",
  TEXT: "TEXT",
  LINE: "LINE",
  BOOLEAN_OPERATION: "BOOLEAN_OPERATION",
  INSTANCE: "INSTANCE",
  SYMBOL: "SYMBOL",
  STAR: "STAR",
  REGULAR_POLYGON: "REGULAR_POLYGON",
  SLICE: "SLICE",
  STICKY: "STICKY",
  CONNECTOR: "CONNECTOR",
  SHAPE_WITH_TEXT: "SHAPE_WITH_TEXT",
  CODE_BLOCK: "CODE_BLOCK",
  STAMP: "STAMP",
  WIDGET: "WIDGET",
  EMBED: "EMBED",
  LINK_UNFURL: "LINK_UNFURL",
  MEDIA: "MEDIA",
  HIGHLIGHT: "HIGHLIGHT",
  SECTION: "SECTION",
  SECTION_OVERLAY: "SECTION_OVERLAY",
  WASHI_TAPE: "WASHI_TAPE",
  VARIABLE: "VARIABLE",
  TABLE: "TABLE",
  TABLE_CELL: "TABLE_CELL",
  VARIABLE_SET: "VARIABLE_SET",
  SLIDE: "SLIDE",
} as const;

export type FigNodeType = typeof FIG_NODE_TYPE[keyof typeof FIG_NODE_TYPE];

// =============================================================================
// Figma Geometry Types
// =============================================================================

/**
 * Figma 2x3 affine transform matrix
 * Represents a 2D transformation: [a c tx; b d ty]
 */
export type FigMatrix = {
  readonly m00: number; // a (scale x)
  readonly m01: number; // c (skew x)
  readonly m02: number; // tx (translate x)
  readonly m10: number; // b (skew y)
  readonly m11: number; // d (scale y)
  readonly m12: number; // ty (translate y)
};

/**
 * 2D vector
 */
export type FigVector = {
  readonly x: number;
  readonly y: number;
};

/**
 * Value with units (used for lineHeight, letterSpacing).
 *
 * Kiwi encoding: `{ value: number, units: KiwiEnumValue }`.
 * Units enum values: PIXELS, PERCENT, AUTO.
 */
export type FigValueWithUnits = {
  readonly value: number;
  readonly units: KiwiEnumValue;
};

/**
 * Font name reference.
 *
 * Kiwi encoding stores `family`, `style`, and optionally `postscript`.
 */
export type FigFontName = {
  readonly family: string;
  readonly style: string;
  readonly postscript?: string;
};

// =============================================================================
// Figma Color Types
// =============================================================================

/**
 * RGBA color (0-1 range)
 */
export type FigColor = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

// =============================================================================
// Figma Paint Types
// =============================================================================

/**
 * Paint type enum
 */
export type FigPaintType =
  | "SOLID"
  | "GRADIENT_LINEAR"
  | "GRADIENT_RADIAL"
  | "GRADIENT_ANGULAR"
  | "GRADIENT_DIAMOND"
  | "IMAGE"
  | "EMOJI"
  | "VIDEO";

/**
 * Gradient stop
 */
export type FigGradientStop = {
  readonly position: number;
  readonly color: FigColor;
};

export type FigColorStopVar = {
  readonly color?: FigColor;
  readonly colorVar?: FigKiwiVariableData;
  readonly position?: number;
};

/**
 * Base paint interface.
 *
 * `type` and `blendMode` are decoded Kiwi enum payloads. Consumers
 * must read them through the paint accessors in `color.ts`.
 */
export type FigPaintBase = {
  readonly type: KiwiEnumValue<FigPaintType>;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly opacityVar?: FigKiwiVariableData;
  readonly colorVar?: FigKiwiVariableData;
  readonly blendMode?: KiwiEnumValue<BlendMode>;
};

/**
 * Solid paint
 */
export type FigSolidPaint = FigPaintBase & {
  readonly type: KiwiEnumValue<"SOLID">;
  readonly color: FigColor;
};

/**
 * Gradient paint transform matrix.
 *
 * Maps element unit object space (0..1, 0..1) to gradient space.
 * Same structure as FigMatrix but fields are optional because the
 * Kiwi binary format may omit identity components.
 *
 * Gradient space convention:
 *   (1, 0) → gradient start (0% stop position)
 *   (0, 0) → gradient end (100% stop position)
 */
export type FigGradientTransform = {
  readonly m00?: number; // a (scale x) — default 1
  readonly m01?: number; // c (skew x) — default 0
  readonly m02?: number; // tx (translate x) — default 0
  readonly m10?: number; // b (skew y) — default 0
  readonly m11?: number; // d (scale y) — default 1
  readonly m12?: number; // ty (translate y) — default 0
};

/**
 * Gradient paint
 *
 * Shape follows Kiwi schema `Paint`: `transform` and `stops`.
 */
export type FigGradientPaint = FigPaintBase & {
  readonly type:
    KiwiEnumValue<
      | "GRADIENT_LINEAR"
      | "GRADIENT_RADIAL"
      | "GRADIENT_ANGULAR"
      | "GRADIENT_DIAMOND"
    >;
  /** 2x3 affine transform mapping unit object space to gradient space. */
  readonly transform?: FigGradientTransform;
  /** Gradient color stops. */
  readonly stops?: readonly FigGradientStop[];
  /** Variable-backed gradient stops from Kiwi `Paint.stopsVar`. */
  readonly stopsVar?: readonly FigColorStopVar[];
};

/**
 * Image paint transform.
 *
 * Controls how the image is positioned and scaled within the element.
 * Uses the same 2x3 affine matrix structure as gradient transforms.
 * The transform maps image space to the element's unit object space (0..1, 0..1).
 */
export type FigImageTransform = FigGradientTransform;

/**
 * Image paint
 */
/** Kiwi ImageScaleMode enum names. */
export type FigImageScaleMode = "FILL" | "FIT" | "TILE" | "STRETCH";

export type FigImagePaintFilter = {
  readonly tint?: number;
  readonly shadows?: number;
  readonly highlights?: number;
  readonly detail?: number;
  readonly exposure?: number;
  readonly vignette?: number;
  readonly temperature?: number;
  readonly vibrance?: number;
  readonly contrast?: number;
  readonly brightness?: number;
  readonly saturation?: number;
};

export type FigImagePaint = FigPaintBase & {
  readonly type: KiwiEnumValue<"IMAGE">;
  /** Kiwi image scale mode enum payload. */
  readonly imageScaleMode?: KiwiEnumValue<FigImageScaleMode>;
  /** 2x3 affine transform for image positioning within the element */
  readonly transform?: FigImageTransform;
  /** Multiplier on the natural image size. */
  readonly scale?: number;
  /** Legacy Kiwi colour-adjustment payload. */
  readonly filterColorAdjust?: FigImagePaintFilter;
  /** Image colour-adjustment payload. */
  readonly paintFilter?: FigImagePaintFilter;
  /** Whether browser colour management should be used while decoding/uploading. */
  readonly imageShouldColorManage?: boolean;
  /**
   * Rotation of the image in radians, applied about the element center.
   * Kiwi binary field.
   */
  readonly rotation?: number;
  /** Image data reference. */
  readonly image?: { readonly hash?: readonly number[] };
  readonly imageVar?: FigKiwiVariableData;
};

/** Union of all supported Kiwi paint payloads. */
export type FigPaint =
  | FigSolidPaint
  | FigGradientPaint
  | FigImagePaint;

// =============================================================================
// Figma Stroke Types
// =============================================================================

/**
 * Stroke weight type
 */
export type FigStrokeWeight =
  | number
  | {
      readonly top: number;
      readonly right: number;
      readonly bottom: number;
      readonly left: number;
    };

/**
 * Blend mode string literals matching SVG/CSS mix-blend-mode values.
 *
 * SSoT for blend-mode names across the fig package. Decoded Kiwi
 * documents may carry either this string or a `KiwiEnumValue`.
 */
export type BlendMode =
  | "PASS_THROUGH"
  | "NORMAL"
  | "DARKEN"
  | "MULTIPLY"
  | "LINEAR_BURN"
  | "COLOR_BURN"
  | "LIGHTEN"
  | "SCREEN"
  | "LINEAR_DODGE"
  | "COLOR_DODGE"
  | "OVERLAY"
  | "SOFT_LIGHT"
  | "HARD_LIGHT"
  | "DIFFERENCE"
  | "EXCLUSION"
  | "HUE"
  | "SATURATION"
  | "COLOR"
  | "LUMINOSITY";

/** Mask interpretation mode from Kiwi `MaskType`. */
export type FigMaskType = "ALPHA" | "OUTLINE" | "LUMINANCE";

/**
 * Stroke cap type — names match the Kiwi schema (`StrokeCap` enum).
 * See `@higma-document-models/fig/constants/strokes` (`StrokeCap`) for
 * the SoT export; this alias mirrors it.
 */
export type FigStrokeCap =
  | "NONE"
  | "ROUND"
  | "SQUARE"
  | "ARROW_LINES"
  | "ARROW_EQUILATERAL";

/**
 * Stroke join type
 */
export type FigStrokeJoin = "MITER" | "BEVEL" | "ROUND";

/**
 * Stroke align type
 */
export type FigStrokeAlign = "INSIDE" | "OUTSIDE" | "CENTER";

// =============================================================================
// Figma Geometry Path Types
// =============================================================================

/**
 * Fill/stroke geometry as stored in Kiwi binary format.
 * References a commandsBlob index into the blobs array.
 */
export type FigFillGeometry = {
  readonly windingRule?: KiwiEnumValue | string;
  readonly commandsBlob?: number;
  readonly styleID?: number;
};

/**
 * Per-path style override entry in vectorData.styleOverrideTable.
 *
 * Each entry overrides fill/stroke properties for geometry paths
 * whose styleID matches this entry's styleID field.
 * Analogous to TextData.styleOverrideTable for text styling.
 */
export type FigVectorStyleOverride = {
  readonly styleID: number;
  readonly fillPaints?: readonly FigPaint[];
  readonly strokePaints?: readonly FigPaint[];
  readonly styleIdForFill?: FigStyleId;
  readonly styleIdForStrokeFill?: FigStyleId;
  readonly [key: string]: unknown;
};

/**
 * Vector data as stored in Kiwi binary format.
 *
 * Contains the vector network blob, Kiwi `normalizedSize`, and per-path
 * style overrides for VECTOR nodes.
 */
export type FigVectorData = {
  readonly vectorNetworkBlob?: number;
  readonly normalizedSize?: FigVector;
  readonly styleOverrideTable?: readonly FigVectorStyleOverride[];
  readonly [key: string]: unknown;
};

/**
 * Vector path as stored in Kiwi binary format.
 *
 * The windingRule can be:
 * - A string literal ("NONZERO", "EVENODD", "ODD") in builder-generated files
 * - A KiwiEnumValue ({ value, name }) in real .fig files
 */
export type FigVectorPath = {
  readonly windingRule?: string | KiwiEnumValue;
  readonly data?: string;
};

// =============================================================================
// Figma Effect Types
// =============================================================================

/**
 * Effect type enum
 */
export type FigEffectType =
  | "INNER_SHADOW"
  | "DROP_SHADOW"
  | "FOREGROUND_BLUR"
  | "BACKGROUND_BLUR";

export type FigBlurOpType =
  | "NORMAL"
  | "PROGRESSIVE";

/**
 * Figma effect as stored in Kiwi binary format.
 */
export type FigEffect = {
  readonly type: KiwiEnumValue<FigEffectType>;
  readonly visible?: boolean;
  readonly color?: FigColor;
  readonly colorVar?: FigKiwiVariableData;
  readonly offset?: FigVector;
  readonly xVar?: FigKiwiVariableData;
  readonly yVar?: FigKiwiVariableData;
  readonly radius?: number;
  readonly radiusVar?: FigKiwiVariableData;
  readonly spread?: number;
  readonly spreadVar?: FigKiwiVariableData;
  readonly blendMode?: KiwiEnumValue<BlendMode>;
  readonly showShadowBehindNode?: boolean;
  readonly count?: number;
  readonly repeatType?: KiwiEnumValue;
  readonly axis?: KiwiEnumValue;
  readonly unitType?: KiwiEnumValue;
  readonly order?: KiwiEnumValue;
  readonly blurOpType?: KiwiEnumValue<FigBlurOpType>;
  readonly startOffset?: FigVector;
  readonly endOffset?: FigVector;
  readonly startRadius?: number;
  readonly secondaryColor?: FigColor;
  readonly noiseSize?: FigVector;
  readonly seed?: number;
  readonly clipToShape?: boolean;
  readonly density?: number;
  readonly noiseType?: KiwiEnumValue;
  readonly opacity?: number;
  readonly refractionRadius?: number;
  readonly specularAngle?: number;
  readonly specularIntensity?: number;
  readonly bevelSize?: number;
  readonly chromaticAberration?: number;
  readonly reflectionDistance?: number;
  readonly refractionIntensity?: number;
  readonly refractionRadiusVar?: FigKiwiVariableData;
  readonly specularAngleVar?: FigKiwiVariableData;
  readonly specularIntensityVar?: FigKiwiVariableData;
  readonly chromaticAberrationVar?: FigKiwiVariableData;
  readonly splayVar?: FigKiwiVariableData;
  readonly refractionIntensityVar?: FigKiwiVariableData;
};
