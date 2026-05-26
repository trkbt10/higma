/**
 * @file Schema-coverage invariant for Kiwi NodeChange handling.
 *
 * Background — the SoT divergence problem
 * ---------------------------------------
 * The .fig file format is a Kiwi-serialised binary whose canonical SoT is
 * `FIGMA_KIWI_SCHEMA.definitions[NodeChange]`. Every Kiwi-declared field on
 * `NodeChange` is a real field that a Figma export may carry — and the
 * consumers must either:
 *   (a) read it directly from the Kiwi node / Kiwi document index, or
 *   (b) explicitly decide not to use it, with a documented reason.
 *
 * Historically this map described a hand-coded projected document. That
 * was the structural cause of divergence: some paths read Kiwi while other
 * paths read a second model. The current invariant is stricter: Kiwi is
 * the SoT, and this file only records direct consumers or explicit drops.
 *
 * The invariant
 * -------------
 * Every Kiwi-declared field on `NodeChange` must have an explicit entry
 * in `KIWI_NODECHANGE_HANDLING`. A field can be in one of these states:
 *
 *   - `mapped`: implementation reads this Kiwi field without changing
 *     its identity or meaning.
 *
 *   - `dropped`: consumers intentionally do NOT use this
 *     field. The `reason` must be one of:
 *       * "kiwi-internal" — Kiwi wire-format machinery
 *         (e.g., `guidTag`, `phaseTag` — version-tag fields encoded
 *         alongside the actual value).
 *       * "resolved-elsewhere" — value is consumed by a named SoT
 *         service such as `SymbolResolver` or `FigStyleRegistry`.
 *       * "metadata-not-rendered" — publishing / library / version
 *         metadata that does not affect visual output or editing.
 *       * "feature-not-supported" — feature exists in Kiwi but is not
 *         supported by this editor (e.g., AI-generated nodes, prototype
 *         configurations beyond rendering).
 *       * "experimental" — Figma-side experiments that are not yet
 *         observable in shipping .fig exports.
 *
 *   - `todo`: the field has not yet been classified. The schema-coverage
 *     test fails when any field is in this state. New Kiwi schema fields
 *     land here on first encounter and force a categorization decision
 *     before any code merges.
 *
 * The spec at `./schema-coverage.spec.ts` enumerates
 * `FIGMA_KIWI_SCHEMA.definitions[NodeChange].fields` and asserts every
 * field name has a non-`todo` entry. Adding a field to the Kiwi schema
 * without updating this map breaks the build.
 *
 * Where to wire new mappings
 * --------------------------
 * When a field is moved out of `dropped` / `todo` into `mapped`,
 * the actual read site should be the Kiwi consumer
 * (`SymbolResolver`, document index, renderer, or export boundary),
 * not a second document surface.
 */

export type KiwiFieldHandling =
  | { readonly kind: "mapped"; readonly to: string; readonly note?: string }
  | {
      readonly kind: "dropped";
      readonly reason:
        | "kiwi-internal"
        | "resolved-elsewhere"
        | "metadata-not-rendered"
        | "feature-not-supported"
        | "experimental";
      readonly note?: string;
    }
  | { readonly kind: "todo" };

/**
 * Canonical classification of every Kiwi-declared `NodeChange` field.
 *
 * This is the source of truth for the schema-coverage invariant. Every
 * field name that appears in `FIGMA_KIWI_SCHEMA.definitions[NodeChange]`
 * must have an entry here.
 *
 * The schema-coverage spec verifies bidirectional coverage:
 *   1. No Kiwi field is missing from this map (forces classification
 *      on every new schema field).
 *   2. No entry in this map is unknown to the schema (catches typos
 *      and stale entries when fields are renamed upstream).
 */
export const KIWI_NODECHANGE_HANDLING: Readonly<Record<string, KiwiFieldHandling>> = {
  // Editing protocol:
  //   - To promote a `todo` to `mapped`, first add the corresponding
  //     direct Kiwi read at the owning consumer. Then change the entry here.
  //   - To promote a `todo` to `dropped`, write a one-line `note`
  //     explaining the categorisation (especially for
  //     `feature-not-supported` and `experimental`).
  //   - To rename a `mapped` `to:` target, update the direct Kiwi read
  //     at the named consumer in the same change.

  "guid": { kind: "mapped", to: "guid", note: "FigGuid is the identity SoT. Consumers must not convert it to branded string ids." },
  "guidTag": { kind: "dropped", reason: "kiwi-internal" },
  "phase": { kind: "dropped", reason: "resolved-elsewhere", note: "Kiwi node-change lifecycle metadata. Export boundaries emit CREATED when creating new nodeChanges." },
  "phaseTag": { kind: "dropped", reason: "kiwi-internal" },
  "parentIndex": { kind: "mapped", to: "FigKiwiDocumentIndex.childrenOf", note: "The Kiwi document index consumes parent GUID and fractional position without materialising a second document." },
  "parentIndexTag": { kind: "dropped", reason: "kiwi-internal" },
  "type": { kind: "mapped", to: "type" },
  "typeTag": { kind: "dropped", reason: "kiwi-internal" },
  "name": { kind: "mapped", to: "name" },
  "nameTag": { kind: "dropped", reason: "kiwi-internal" },
  "isPublishable": { kind: "mapped", to: "isPublishable" },
  "description": { kind: "mapped", to: "description" },
  "libraryMoveInfo": { kind: "mapped", to: "libraryMoveInfo" },
  "libraryMoveHistory": { kind: "mapped", to: "libraryMoveHistory" },
  "key": { kind: "mapped", to: "FigNode.key", note: "Round-trip/library metadata; not a SymbolResolver input." },
  "fileAssetIds": { kind: "mapped", to: "FigNode.fileAssetIds", note: "Kiwi AssetIdMap is preserved as a typed FigNode field; not a SymbolResolver input." },
  // Legacy node-level style identifier (predates the GUID-based
  // styleIdForFill / styleIdForStrokeFill references and the styleType
  // enum). Modern Figma exports still emit it alongside the new keys
  // as legacy metadata; the codec preserves it verbatim so round-trip
  // through this pipeline stays byte-equivalent. The renderer's SoT for
  // style resolution is the GUID-keyed style-registry built from
  // styleType — see style-registry.ts.
  "styleID": { kind: "mapped", to: "FigNode.styleID", note: "Legacy style-definition marker. Preserved for round-trip; style resolution SoT is styleType/styleId* via style-registry." },
  "styleIDTag": { kind: "dropped", reason: "kiwi-internal" },
  // Legacy per-kind style-definition markers, replaced by styleType.
  // The renderer dispatches on styleType (see style-registry.ts); these
  // booleans are no longer consulted but are preserved for round-trip.
  "isFillStyle": { kind: "mapped", to: "isFillStyle" },
  "isStrokeStyle": { kind: "mapped", to: "isStrokeStyle" },
  "isOverrideOverTextStyle": { kind: "mapped", to: "isOverrideOverTextStyle" },
  "styleType": { kind: "mapped", to: "styleType" },
  "styleDescription": { kind: "mapped", to: "styleDescription" },
  "version": { kind: "mapped", to: "version" },
  "userFacingVersion": { kind: "mapped", to: "userFacingVersion" },
  "sortPosition": { kind: "mapped", to: "sortPosition" },
  "ojansSuperSecretNodeField": { kind: "dropped", reason: "experimental" },
  "sevMoonlitLilyData": { kind: "dropped", reason: "experimental" },
  "isSoftDeletedStyle": { kind: "mapped", to: "isSoftDeletedStyle" },
  "isNonUpdateable": { kind: "mapped", to: "isNonUpdateable" },
  "sharedStyleMasterData": { kind: "mapped", to: "sharedStyleMasterData" },
  "sharedStyleReference": { kind: "mapped", to: "sharedStyleReference" },
  "inheritFillStyleID": { kind: "dropped", reason: "resolved-elsewhere", note: "Legacy style-reference field; modern Kiwi style resolution is carried by styleIdForFill and FigStyleRegistry." },
  "inheritStrokeStyleID": { kind: "dropped", reason: "resolved-elsewhere", note: "Legacy style-reference field; modern Kiwi style resolution is carried by styleIdForStrokeFill and FigStyleRegistry." },
  "inheritTextStyleID": { kind: "dropped", reason: "resolved-elsewhere", note: "Legacy style-reference field; modern Kiwi style resolution is carried by styleIdForText and FigStyleRegistry." },
  "inheritExportStyleID": { kind: "dropped", reason: "feature-not-supported", note: "Export styles are not consumed by the document renderer/editor." },
  "inheritEffectStyleID": { kind: "dropped", reason: "resolved-elsewhere", note: "Legacy style-reference field; modern Kiwi effect style resolution is carried by styleIdForEffect and FigStyleRegistry." },
  "inheritGridStyleID": { kind: "dropped", reason: "resolved-elsewhere", note: "Legacy style-reference field; modern Kiwi grid style resolution is carried by styleIdForGrid and FigStyleRegistry." },
  "inheritFillStyleIDForStroke": { kind: "dropped", reason: "resolved-elsewhere", note: "Legacy stroke-style reference; modern Kiwi stroke style resolution is carried by styleIdForStrokeFill and FigStyleRegistry." },
  "styleIdForFill": { kind: "mapped", to: "styleIdForFill", note: "SceneGraph builder resolves node fills through FigStyleRegistry; registry wins only when the Kiwi style definition exists locally." },
  "styleIdForStrokeFill": { kind: "mapped", to: "styleIdForStrokeFill", note: "SceneGraph builder resolves node strokes through FigStyleRegistry; registry wins only when the Kiwi style definition exists locally." },
  "styleIdForText": { kind: "mapped", to: "styleIdForText", note: "Text rendering resolves shared text-style properties through FigStyleRegistry." },
  "styleIdForEffect": { kind: "mapped", to: "styleIdForEffect", note: "SceneGraph builder resolves node effects through FigStyleRegistry before converting effects." },
  "styleIdForGrid": { kind: "mapped", to: "styleIdForGrid", note: "FigStyleRegistry indexes GRID style definitions for layout-grid consumers." },
  "backgroundPaints": { kind: "mapped", to: "backgroundPaints", note: "SceneGraph builder reads Kiwi FRAME background paints directly for frame decoration." },
  "inheritFillStyleIDForBackground": { kind: "mapped", to: "inheritFillStyleIDForBackground", note: "SceneGraph builder resolves FRAME background style through FigStyleRegistry; GUID remains FigGuid." },
  "isStateGroup": { kind: "mapped", to: "isStateGroup" },
  "stateGroupPropertyValueOrders": { kind: "mapped", to: "stateGroupPropertyValueOrders" },
  "sharedSymbolReference": { kind: "mapped", to: "sharedSymbolReference" },
  "isSymbolPublishable": { kind: "mapped", to: "isSymbolPublishable" },
  "sharedSymbolMappings": { kind: "mapped", to: "sharedSymbolMappings" },
  "sharedSymbolVersion": { kind: "mapped", to: "sharedSymbolVersion" },
  "sharedComponentMasterData": { kind: "mapped", to: "sharedComponentMasterData" },
  "symbolDescription": { kind: "mapped", to: "symbolDescription" },
  "unflatteningMappings": { kind: "mapped", to: "unflatteningMappings" },
  "forceUnflatteningMappings": { kind: "mapped", to: "forceUnflatteningMappings" },
  "publishFile": { kind: "mapped", to: "publishFile" },
  "sourceLibraryKey": { kind: "mapped", to: "sourceLibraryKey" },
  "publishID": { kind: "mapped", to: "publishID" },
  "componentKey": { kind: "mapped", to: "componentKey" },
  "isC2": { kind: "mapped", to: "isC2" },
  "publishedVersion": { kind: "mapped", to: "publishedVersion" },
  "originComponentKey": { kind: "mapped", to: "originComponentKey" },
  "componentPropDefs": { kind: "mapped", to: "componentPropDefs", note: "SymbolResolver consumes Kiwi componentPropDefs for variant metadata; editor component-property UI resolves parentPropDefId through resolveFigComponentPropDef so inheritance remains owner-node scoped." },
  "componentPropRefs": { kind: "mapped", to: "componentPropRefs", note: "SymbolResolver and emitters consume Kiwi componentPropRefs directly." },
  "variantPropSpecs": { kind: "mapped", to: "variantPropSpecs" },
  "symbolData": { kind: "mapped", to: "symbolData", note: "SymbolResolver reads symbolData.symbolID and symbolData.symbolOverrides directly, including INSTANCE-swap overriddenSymbolID payloads." },
  "symbolDataTag": { kind: "dropped", reason: "kiwi-internal" },
  "derivedSymbolData": { kind: "mapped", to: "derivedSymbolData", note: "SymbolResolver consumes Kiwi derivedSymbolData directly for document-local and document-external INSTANCE materialization; export preserves the field on FigNode." },
  // Re-classified after grep audit: no production Kiwi consumer reads
  // these (zero non-spec references across @higma-document-*). If a
  // future .fig requires them, promote to `todo` and add the direct
  // consumer.
  "nestedInstanceResizeEnabled": { kind: "mapped", to: "nestedInstanceResizeEnabled" },
  "overriddenSymbolID": { kind: "mapped", to: "overriddenSymbolID", note: "SymbolResolver owns effective INSTANCE target selection for both NodeChange fields and SymbolOverride payloads; the GUID remains FigGuid." },
  "componentPropAssignments": { kind: "mapped", to: "componentPropAssignments", note: "SymbolResolver consumes Kiwi componentPropAssignments directly, including node-level guidValue INSTANCE_SWAP selections that bind document-external DSD slots to local SYMBOL roots." },
  "propsAreBubbled": { kind: "mapped", to: "propsAreBubbled" },
  "overrideStash": { kind: "mapped", to: "overrideStash" },
  "overrideStashV2": { kind: "mapped", to: "overrideStashV2" },
  "guidPath": { kind: "dropped", reason: "feature-not-supported", note: "Top-level NodeChange.guidPath is not the SymbolOverride.guidPath carried under symbolData/derivedSymbolData." },
  "guidPathTag": { kind: "dropped", reason: "kiwi-internal" },
  "overrideLevel": { kind: "mapped", to: "overrideLevel" },
  "moduleType": { kind: "mapped", to: "moduleType" },
  "isSlot": { kind: "mapped", to: "isSlot" },
  "isSlotContent": { kind: "mapped", to: "isSlotContent" },
  "fontSize": { kind: "mapped", to: "fontSize" },
  "fontSizeTag": { kind: "dropped", reason: "kiwi-internal" },
  "paragraphIndent": { kind: "mapped", to: "paragraphIndent" },
  "paragraphIndentTag": { kind: "dropped", reason: "kiwi-internal" },
  "paragraphSpacing": { kind: "mapped", to: "paragraphSpacing" },
  "paragraphSpacingTag": { kind: "dropped", reason: "kiwi-internal" },
  "textAlignHorizontal": { kind: "mapped", to: "textAlignHorizontal" },
  "textAlignHorizontalTag": { kind: "dropped", reason: "kiwi-internal" },
  "textAlignVertical": { kind: "mapped", to: "textAlignVertical" },
  "textAlignVerticalTag": { kind: "dropped", reason: "kiwi-internal" },
  "textCase": { kind: "mapped", to: "textCase" },
  "textCaseTag": { kind: "dropped", reason: "kiwi-internal" },
  "textDecoration": { kind: "mapped", to: "textDecoration" },
  "textDecorationTag": { kind: "dropped", reason: "kiwi-internal" },
  "lineHeight": { kind: "mapped", to: "lineHeight" },
  "lineHeightTag": { kind: "dropped", reason: "kiwi-internal" },
  "fontName": { kind: "mapped", to: "fontName" },
  "fontNameTag": { kind: "dropped", reason: "kiwi-internal" },
  "textData": { kind: "mapped", to: "textData" },
  "textDataTag": { kind: "dropped", reason: "kiwi-internal" },
  "derivedTextData": { kind: "mapped", to: "derivedTextData", note: "Text layout and glyph rendering consume Kiwi glyph positions, baselines, layoutSize, and fontMetaData before host font measurement." },
  // OpenType variant toggles — rare typography. Drop until real demand.
  "fontVariantCommonLigatures": { kind: "mapped", to: "fontVariantCommonLigatures" },
  "fontVariantContextualLigatures": { kind: "mapped", to: "fontVariantContextualLigatures" },
  "fontVariantDiscretionaryLigatures": { kind: "mapped", to: "fontVariantDiscretionaryLigatures" },
  "fontVariantHistoricalLigatures": { kind: "mapped", to: "fontVariantHistoricalLigatures" },
  "fontVariantOrdinal": { kind: "mapped", to: "fontVariantOrdinal" },
  "fontVariantSlashedZero": { kind: "mapped", to: "fontVariantSlashedZero" },
  "fontVariantNumericFigure": { kind: "mapped", to: "fontVariantNumericFigure" },
  "fontVariantNumericSpacing": { kind: "mapped", to: "fontVariantNumericSpacing" },
  "fontVariantNumericFraction": { kind: "mapped", to: "fontVariantNumericFraction" },
  "fontVariantCaps": { kind: "mapped", to: "fontVariantCaps" },
  "fontVariantPosition": { kind: "mapped", to: "fontVariantPosition" },
  "letterSpacing": { kind: "mapped", to: "letterSpacing" },
  "fontVersion": { kind: "mapped", to: "fontVersion" }, // font file version stamp
  "leadingTrim": { kind: "mapped", to: "leadingTrim" },
  "hangingPunctuation": { kind: "mapped", to: "hangingPunctuation" },
  "hangingList": { kind: "mapped", to: "hangingList" },
  "maxLines": { kind: "mapped", to: "maxLines" },
  // Responsive text variants: not rendered yet (no breakpoint runtime).
  "responsiveTextStyleVariants": { kind: "mapped", to: "responsiveTextStyleVariants" },
  // Section status flags: collaboration metadata, not visual.
  "sectionStatus": { kind: "mapped", to: "sectionStatus" },
  "sectionStatusInfo": { kind: "mapped", to: "sectionStatusInfo" },
  // Text layout version markers: internal cache versioning.
  "textUserLayoutVersion": { kind: "mapped", to: "textUserLayoutVersion" },
  "textExplicitLayoutVersion": { kind: "mapped", to: "textExplicitLayoutVersion" },
  // OpenType feature toggles: rare. Drop.
  "toggledOnOTFeatures": { kind: "mapped", to: "toggledOnOTFeatures" },
  "toggledOffOTFeatures": { kind: "mapped", to: "toggledOffOTFeatures" },
  "hyperlink": { kind: "mapped", to: "hyperlink" },
  "mention": { kind: "mapped", to: "mention" }, // collaboration mention
  "fontVariations": { kind: "mapped", to: "fontVariations" },
  "textBidiVersion": { kind: "mapped", to: "textBidiVersion" },
  "textTruncation": { kind: "mapped", to: "textTruncation" },
  "hasHadRTLText": { kind: "mapped", to: "hasHadRTLText" },
  "emojiImageSet": { kind: "mapped", to: "emojiImageSet" },
  "slideThumbnailHash": { kind: "mapped", to: "slideThumbnailHash" },
  "visible": { kind: "mapped", to: "visible" },
  "visibleTag": { kind: "dropped", reason: "kiwi-internal" },
  "locked": { kind: "mapped", to: "locked" },
  "lockedTag": { kind: "dropped", reason: "kiwi-internal" },
  "lockMode": { kind: "mapped", to: "lockMode" },
  "opacity": { kind: "mapped", to: "opacity" },
  "opacityTag": { kind: "dropped", reason: "kiwi-internal" },
  "blendMode": { kind: "mapped", to: "blendMode" },
  "blendModeTag": { kind: "dropped", reason: "kiwi-internal" },
  "size": { kind: "mapped", to: "size" },
  "sizeTag": { kind: "dropped", reason: "kiwi-internal" },
  "transform": { kind: "mapped", to: "transform" },
  "transformTag": { kind: "dropped", reason: "kiwi-internal" },
  "dashPattern": { kind: "mapped", to: "dashPattern" },
  "dashPatternTag": { kind: "dropped", reason: "kiwi-internal" },
  "mask": { kind: "mapped", to: "mask" },
  "maskTag": { kind: "dropped", reason: "kiwi-internal" },
  "rotationOrigin": { kind: "mapped", to: "rotationOrigin" },
  "maskIsOutline": { kind: "mapped", to: "maskIsOutline" },
  "maskIsOutlineTag": { kind: "dropped", reason: "kiwi-internal" },
  "maskType": { kind: "mapped", to: "maskType" },
  "backgroundOpacity": { kind: "mapped", to: "backgroundOpacity" },
  "backgroundOpacityTag": { kind: "dropped", reason: "kiwi-internal" },
  "cornerRadius": { kind: "mapped", to: "cornerRadius" },
  "cornerRadiusTag": { kind: "dropped", reason: "kiwi-internal" },
  "strokeWeight": { kind: "mapped", to: "strokeWeight" },
  "strokeWeightTag": { kind: "dropped", reason: "kiwi-internal" },
  "strokeAlign": { kind: "mapped", to: "strokeAlign" },
  "strokeAlignTag": { kind: "dropped", reason: "kiwi-internal" },
  "strokeCap": { kind: "mapped", to: "strokeCap" },
  "strokeCapTag": { kind: "dropped", reason: "kiwi-internal" },
  "strokeCapSize": { kind: "mapped", to: "strokeCapSize" },
  "strokeJoin": { kind: "mapped", to: "strokeJoin" },
  "strokeJoinTag": { kind: "dropped", reason: "kiwi-internal" },
  "fillPaints": { kind: "mapped", to: "fillPaints" },
  "fillPaintsTag": { kind: "dropped", reason: "kiwi-internal" },
  "strokePaints": { kind: "mapped", to: "strokePaints" },
  "strokePaintsTag": { kind: "dropped", reason: "kiwi-internal" },
  "effects": { kind: "mapped", to: "effects" },
  "effectsTag": { kind: "dropped", reason: "kiwi-internal" },
  "backgroundColor": { kind: "mapped", to: "backgroundColor" },
  "backgroundColorTag": { kind: "dropped", reason: "kiwi-internal" },
  "fillGeometry": { kind: "mapped", to: "fillGeometry" },
  "fillGeometryTag": { kind: "dropped", reason: "kiwi-internal" },
  "strokeGeometry": { kind: "mapped", to: "strokeGeometry" },
  "strokeGeometryTag": { kind: "dropped", reason: "kiwi-internal" },
  // Text decoration details: drop. Underline color/style/thickness rare.
  "textDecorationFillPaints": { kind: "mapped", to: "textDecorationFillPaints" },
  "textDecorationSkipInk": { kind: "mapped", to: "textDecorationSkipInk" },
  "textUnderlineOffset": { kind: "mapped", to: "textUnderlineOffset" },
  "textDecorationThickness": { kind: "mapped", to: "textDecorationThickness" },
  "textDecorationStyle": { kind: "mapped", to: "textDecorationStyle" },
  "transformModifiers": { kind: "mapped", to: "transformModifiers" },
  "rectangleTopLeftCornerRadius": { kind: "mapped", to: "rectangleTopLeftCornerRadius" },
  "rectangleTopRightCornerRadius": { kind: "mapped", to: "rectangleTopRightCornerRadius" },
  "rectangleBottomLeftCornerRadius": { kind: "mapped", to: "rectangleBottomLeftCornerRadius" },
  "rectangleBottomRightCornerRadius": { kind: "mapped", to: "rectangleBottomRightCornerRadius" },
  "rectangleCornerRadiiIndependent": { kind: "mapped", to: "rectangleCornerRadiiIndependent" },
  "rectangleCornerToolIndependent": { kind: "mapped", to: "rectangleCornerToolIndependent" }, // corner-tool UI state
  "proportionsConstrained": { kind: "mapped", to: "proportionsConstrained" },
  "targetAspectRatio": { kind: "mapped", to: "targetAspectRatio" },
  "useAbsoluteBounds": { kind: "mapped", to: "useAbsoluteBounds" },
  "borderTopHidden": { kind: "mapped", to: "borderTopHidden" },
  "borderBottomHidden": { kind: "mapped", to: "borderBottomHidden" },
  "borderLeftHidden": { kind: "mapped", to: "borderLeftHidden" },
  "borderRightHidden": { kind: "mapped", to: "borderRightHidden" },
  "bordersTakeSpace": { kind: "mapped", to: "bordersTakeSpace" },
  "borderTopWeight": { kind: "mapped", to: "borderTopWeight" },
  "borderBottomWeight": { kind: "mapped", to: "borderBottomWeight" },
  "borderLeftWeight": { kind: "mapped", to: "borderLeftWeight" },
  "borderRightWeight": { kind: "mapped", to: "borderRightWeight" },
  "borderStrokeWeightsIndependent": { kind: "mapped", to: "borderStrokeWeightsIndependent" },
  "horizontalConstraint": { kind: "mapped", to: "horizontalConstraint" },
  "horizontalConstraintTag": { kind: "dropped", reason: "kiwi-internal" },
  "stackMode": { kind: "mapped", to: "stackMode" },
  "stackModeTag": { kind: "dropped", reason: "kiwi-internal" },
  "stackSpacing": { kind: "mapped", to: "stackSpacing" },
  "stackSpacingTag": { kind: "dropped", reason: "kiwi-internal" },
  "stackPadding": { kind: "mapped", to: "stackPadding" },
  "stackPaddingTag": { kind: "dropped", reason: "kiwi-internal" },
  // Legacy Kiwi alignment enums superseded by `stackPrimary*Items` /
  // `stackCounter*Items` / `stack*AlignContent`. Modern .fig files never
  // set these; current Kiwi consumers ignore them.
  "stackCounterAlign": { kind: "mapped", to: "stackCounterAlign" },
  "stackJustify": { kind: "mapped", to: "stackJustify" },
  "stackAlign": { kind: "mapped", to: "stackAlign" },
  "stackHorizontalPadding": { kind: "mapped", to: "stackHorizontalPadding" },
  "stackVerticalPadding": { kind: "mapped", to: "stackVerticalPadding" },
  // Legacy Kiwi sizing enums superseded by `stackPrimarySizing` /
  // `stackCounterSizing`. Modern .fig files never set these.
  "stackWidth": { kind: "mapped", to: "stackWidth" },
  "stackHeight": { kind: "mapped", to: "stackHeight" },
  "stackPrimarySizing": { kind: "mapped", to: "stackPrimarySizing" },
  "stackPrimaryAlignItems": { kind: "mapped", to: "stackPrimaryAlignItems" },
  "stackCounterAlignItems": { kind: "mapped", to: "stackCounterAlignItems" },
  "stackChildPrimaryGrow": { kind: "mapped", to: "stackChildPrimaryGrow" },
  "stackPaddingRight": { kind: "mapped", to: "stackPaddingRight" },
  "stackPaddingBottom": { kind: "mapped", to: "stackPaddingBottom" },
  "stackChildAlignSelf": { kind: "mapped", to: "stackChildAlignSelf" },
  "stackPositioning": { kind: "mapped", to: "stackPositioning" },
  "stackReverseZIndex": { kind: "mapped", to: "stackReverseZIndex" },
  "stackWrap": { kind: "mapped", to: "stackWrap" },
  "stackCounterSpacing": { kind: "mapped", to: "stackCounterSpacing" },
  "minSize": { kind: "mapped", to: "minSize" },
  "maxSize": { kind: "mapped", to: "maxSize" },
  "stackCounterAlignContent": { kind: "mapped", to: "stackCounterAlignContent" },
  "sortedMovingChildIndices": { kind: "mapped", to: "sortedMovingChildIndices" }, // child reorder cache
  "gridRows": { kind: "mapped", to: "gridRows" },
  "gridColumns": { kind: "mapped", to: "gridColumns" },
  "gridRowGap": { kind: "mapped", to: "gridRowGap" },
  "gridColumnGap": { kind: "mapped", to: "gridColumnGap" },
  // CSS-grid layout fields. The GRID solver consumes these via
  // `applyGridLayout`; per-track sizing is interpreted through
  // `interpretGridTrackSize` and used to compute pixel column/row
  // widths.
  "gridRowAnchor": { kind: "mapped", to: "gridRowAnchor" },
  "gridColumnAnchor": { kind: "mapped", to: "gridColumnAnchor" },
  "gridRowSpan": { kind: "mapped", to: "gridRowSpan" },
  "gridColumnSpan": { kind: "mapped", to: "gridColumnSpan" },
  "gridColumnsSizing": { kind: "mapped", to: "gridColumnsSizing" },
  "gridRowsSizing": { kind: "mapped", to: "gridRowsSizing" },
  "gridChildVerticalAlign": { kind: "mapped", to: "gridChildVerticalAlign" },
  "gridChildHorizontalAlign": { kind: "mapped", to: "gridChildHorizontalAlign" },
  // FigJam / prototype features: no support today. Group dropped.
  "isSnakeGameBoard": { kind: "mapped", to: "isSnakeGameBoard" },
  "transitionNodeID": { kind: "mapped", to: "transitionNodeID" },
  "prototypeStartNodeID": { kind: "mapped", to: "prototypeStartNodeID" },
  "prototypeBackgroundColor": { kind: "mapped", to: "prototypeBackgroundColor" },
  "transitionInfo": { kind: "mapped", to: "transitionInfo" },
  "transitionType": { kind: "mapped", to: "transitionType" },
  "transitionDuration": { kind: "mapped", to: "transitionDuration" },
  "easingType": { kind: "mapped", to: "easingType" },
  "transitionPreserveScroll": { kind: "mapped", to: "transitionPreserveScroll" },
  "connectionType": { kind: "mapped", to: "connectionType" },
  "connectionURL": { kind: "mapped", to: "connectionURL" },
  "prototypeDevice": { kind: "mapped", to: "prototypeDevice" },
  "interactionType": { kind: "mapped", to: "interactionType" },
  "transitionTimeout": { kind: "mapped", to: "transitionTimeout" },
  "interactionMaintained": { kind: "mapped", to: "interactionMaintained" },
  "interactionDuration": { kind: "mapped", to: "interactionDuration" },
  "destinationIsOverlay": { kind: "mapped", to: "destinationIsOverlay" },
  "transitionShouldSmartAnimate": { kind: "mapped", to: "transitionShouldSmartAnimate" },
  "prototypeInteractions": { kind: "mapped", to: "prototypeInteractions" },
  "objectAnimations": { kind: "mapped", to: "objectAnimations" },
  "prototypeStartingPoint": { kind: "mapped", to: "prototypeStartingPoint" },
  "pluginData": { kind: "mapped", to: "pluginData" },
  "pluginRelaunchData": { kind: "mapped", to: "pluginRelaunchData" },
  // FigJam connectors: no support.
  "connectorStart": { kind: "mapped", to: "connectorStart" },
  "connectorEnd": { kind: "mapped", to: "connectorEnd" },
  "connectorLineStyle": { kind: "mapped", to: "connectorLineStyle" },
  "connectorStartCap": { kind: "mapped", to: "connectorStartCap" },
  "connectorEndCap": { kind: "mapped", to: "connectorEndCap" },
  "connectorControlPoints": { kind: "mapped", to: "connectorControlPoints" },
  "connectorBezierControlPoints": { kind: "mapped", to: "connectorBezierControlPoints" },
  "connectorTextMidpoint": { kind: "mapped", to: "connectorTextMidpoint" },
  "connectorType": { kind: "mapped", to: "connectorType" },
  "connectorVersion": { kind: "mapped", to: "connectorVersion" },
  // Annotations / measurements: no support.
  "annotations": { kind: "mapped", to: "annotations" },
  "measurements": { kind: "mapped", to: "measurements" },
  "annotationCategories": { kind: "mapped", to: "annotationCategories" },
  // ShapeWithText / FigJam-only shapes: no support.
  "shapeWithTextType": { kind: "mapped", to: "shapeWithTextType" },
  "shapeUserHeight": { kind: "mapped", to: "shapeUserHeight" },
  "shapeTruncates": { kind: "mapped", to: "shapeTruncates" },
  // Derived caches Figma writes to optimise its own renderer — current
  // rendering recomputes them as needed, no carry required.
  "isStrokePaintDerived": { kind: "mapped", to: "isStrokePaintDerived" },
  "derivedImmutableFrameData": { kind: "mapped", to: "derivedImmutableFrameData" },
  "derivedImmutableFrameDataVersion": { kind: "mapped", to: "derivedImmutableFrameDataVersion" },
  "nodeGenerationData": { kind: "mapped", to: "nodeGenerationData" },
  // JSX / code blocks: no support.
  "jsxData": { kind: "mapped", to: "jsxData" },
  "derivedJsxData": { kind: "mapped", to: "derivedJsxData" },
  "stableKey": { kind: "mapped", to: "stableKey" },
  "codeBlockLanguage": { kind: "mapped", to: "codeBlockLanguage" },
  "codeBlockTheme": { kind: "mapped", to: "codeBlockTheme" },
  "linkPreviewData": { kind: "mapped", to: "linkPreviewData" },
  "sectionContentsHidden": { kind: "mapped", to: "sectionContentsHidden" },
  "videoPlayback": { kind: "mapped", to: "videoPlayback" },
  "stampData": { kind: "mapped", to: "stampData" },
  "sectionPresetInfo": { kind: "mapped", to: "sectionPresetInfo" },
  "platformShapeDefinition": { kind: "mapped", to: "platformShapeDefinition" },
  // Widget* (FigJam widgets): no support.
  "widgetSyncedState": { kind: "mapped", to: "widgetSyncedState" },
  "widgetSyncCursor": { kind: "mapped", to: "widgetSyncCursor" },
  "widgetDerivedSubtreeCursor": { kind: "mapped", to: "widgetDerivedSubtreeCursor" },
  "widgetCachedAncestor": { kind: "mapped", to: "widgetCachedAncestor" },
  "widgetInputBehavior": { kind: "mapped", to: "widgetInputBehavior" },
  "widgetTooltip": { kind: "mapped", to: "widgetTooltip" },
  "widgetHoverStyle": { kind: "mapped", to: "widgetHoverStyle" },
  "isWidgetStickable": { kind: "mapped", to: "isWidgetStickable" },
  "shouldHideCursorsOnWidgetHover": { kind: "mapped", to: "shouldHideCursorsOnWidgetHover" },
  "widgetMetadata": { kind: "mapped", to: "widgetMetadata" },
  "widgetEvents": { kind: "mapped", to: "widgetEvents" },
  "widgetPropertyMenuItems": { kind: "mapped", to: "widgetPropertyMenuItems" },
  "widgetInputTextNodeType": { kind: "mapped", to: "widgetInputTextNodeType" },
  "jsxProps": { kind: "mapped", to: "jsxProps" },
  "tableRowPositions": { kind: "mapped", to: "tableRowPositions" },
  "tableColumnPositions": { kind: "mapped", to: "tableColumnPositions" },
  "tableRowHeights": { kind: "mapped", to: "tableRowHeights" },
  "tableColumnWidths": { kind: "mapped", to: "tableColumnWidths" },
  "tableMergedCells": { kind: "mapped", to: "tableMergedCells" },
  "interactiveSlideConfigData": { kind: "mapped", to: "interactiveSlideConfigData" },
  "interactiveSlideParticipantData": { kind: "mapped", to: "interactiveSlideParticipantData" },
  "flappType": { kind: "mapped", to: "flappType" },
  "isEmbeddedPrototype": { kind: "mapped", to: "isEmbeddedPrototype" },
  "slideSpeakerNotes": { kind: "mapped", to: "slideSpeakerNotes" },
  "isSkippedSlide": { kind: "mapped", to: "isSkippedSlide" },
  "themeID": { kind: "mapped", to: "themeID" },
  "slideThemeData": { kind: "mapped", to: "slideThemeData" },
  "slideThemeMap": { kind: "mapped", to: "slideThemeMap" },
  "slideTemplateFileKey": { kind: "mapped", to: "slideTemplateFileKey" },
  "slideNumber": { kind: "mapped", to: "slideNumber" },
  "slideNumberSeparator": { kind: "mapped", to: "slideNumberSeparator" },
  "diagramParentId": { kind: "mapped", to: "diagramParentId" },
  "layoutRoot": { kind: "mapped", to: "layoutRoot" },
  "layoutPosition": { kind: "mapped", to: "layoutPosition" },
  "diagramLayoutRuleType": { kind: "mapped", to: "diagramLayoutRuleType" },
  "diagramParentIndex": { kind: "mapped", to: "diagramParentIndex" },
  "diagramLayoutPaused": { kind: "mapped", to: "diagramLayoutPaused" },
  "isPageDivider": { kind: "mapped", to: "isPageDivider" },
  "internalEnumForTest": { kind: "dropped", reason: "experimental" },
  "internalDataForTest": { kind: "dropped", reason: "experimental" },
  "autoRename": { kind: "mapped", to: "autoRename" }, // UI rename behavior
  "autoRenameTag": { kind: "dropped", reason: "kiwi-internal" },
  "backgroundEnabled": { kind: "mapped", to: "backgroundEnabled" },
  "backgroundEnabledTag": { kind: "dropped", reason: "kiwi-internal" },
  "exportContentsOnly": { kind: "mapped", to: "exportContentsOnly" },
  "exportContentsOnlyTag": { kind: "dropped", reason: "kiwi-internal" },
  "miterLimit": { kind: "mapped", to: "miterLimit" },
  "miterLimitTag": { kind: "dropped", reason: "kiwi-internal" },
  "textTracking": { kind: "mapped", to: "textTracking" },
  "textTrackingTag": { kind: "dropped", reason: "kiwi-internal" },
  "verticalConstraint": { kind: "mapped", to: "verticalConstraint" },
  "verticalConstraintTag": { kind: "dropped", reason: "kiwi-internal" },
  "exportSettings": { kind: "mapped", to: "exportSettings" },
  "exportSettingsTag": { kind: "dropped", reason: "kiwi-internal" },
  "textAutoResize": { kind: "mapped", to: "textAutoResize" },
  "textAutoResizeTag": { kind: "dropped", reason: "kiwi-internal" },
  "layoutGrids": { kind: "mapped", to: "layoutGrids" },
  "layoutGridsTag": { kind: "dropped", reason: "kiwi-internal" },
  "frameMaskDisabled": { kind: "mapped", to: "frameMaskDisabled", note: "SceneGraph builder feeds the Kiwi inverted clip flag into resolveClipsContent; SVG and WebGL consume the same RenderTree clip decision." },
  "frameMaskDisabledTag": { kind: "dropped", reason: "kiwi-internal" },
  "resizeToFit": { kind: "mapped", to: "resizeToFit" },
  "resizeToFitTag": { kind: "dropped", reason: "kiwi-internal" },
  "booleanOperation": { kind: "mapped", to: "booleanOperation" },
  "booleanOperationTag": { kind: "dropped", reason: "kiwi-internal" },
  "handleMirroring": { kind: "mapped", to: "handleMirroring" },
  "handleMirroringTag": { kind: "dropped", reason: "kiwi-internal" },
  "count": { kind: "mapped", to: "count" },
  "countTag": { kind: "dropped", reason: "kiwi-internal" },
  "starInnerScale": { kind: "mapped", to: "starInnerScale" },
  "starInnerScaleTag": { kind: "dropped", reason: "kiwi-internal" },
  "arcData": { kind: "mapped", to: "arcData" },
  "vectorData": { kind: "mapped", to: "vectorData" },
  "vectorDataTag": { kind: "dropped", reason: "kiwi-internal" },
  "vectorOperationVersion": { kind: "mapped", to: "vectorOperationVersion" },
  "textPathStart": { kind: "mapped", to: "textPathStart" },
  "exportBackgroundDisabled": { kind: "mapped", to: "exportBackgroundDisabled" },
  "guides": { kind: "mapped", to: "FigNode.guides", note: "Kiwi Guide[] is preserved directly on FigNode; renderer/editor do not synthesize a second guide model." },
  "internalOnly": { kind: "mapped", to: "internalOnly" },
  "scrollDirection": { kind: "mapped", to: "scrollDirection" },
  "cornerSmoothing": { kind: "mapped", to: "cornerSmoothing" },
  "scrollOffset": { kind: "mapped", to: "scrollOffset" },
  "exportTextAsSVGText": { kind: "mapped", to: "exportTextAsSVGText" },
  "scrollContractedState": { kind: "mapped", to: "scrollContractedState" },
  "contractedSize": { kind: "mapped", to: "contractedSize" },
  "fixedChildrenDivider": { kind: "mapped", to: "fixedChildrenDivider" },
  "scrollBehavior": { kind: "mapped", to: "scrollBehavior" },
  "derivedSymbolDataLayoutVersion": { kind: "mapped", to: "FigNode.derivedSymbolDataLayoutVersion" },
  "navigationType": { kind: "mapped", to: "navigationType" },
  "overlayPositionType": { kind: "mapped", to: "overlayPositionType" },
  "overlayRelativePosition": { kind: "mapped", to: "overlayRelativePosition" },
  "overlayBackgroundInteraction": { kind: "mapped", to: "overlayBackgroundInteraction" },
  "overlayBackgroundAppearance": { kind: "mapped", to: "overlayBackgroundAppearance" },
  "overrideKey": { kind: "mapped", to: "SymbolResolver.overrideKeySlotIndex", note: "SymbolResolver indexes descendant overrideKey values as exact slot addresses; no external translation map." },
  "containerSupportsFillStrokeAndCorners": { kind: "mapped", to: "containerSupportsFillStrokeAndCorners" },
  "stackCounterSizing": { kind: "mapped", to: "stackCounterSizing" },
  "containersSupportFillStrokeAndCorners": { kind: "mapped", to: "containersSupportFillStrokeAndCorners" },
  "keyTrigger": { kind: "mapped", to: "keyTrigger" },
  "voiceEventPhrase": { kind: "mapped", to: "voiceEventPhrase" },
  "ancestorPathBeforeDeletion": { kind: "mapped", to: "ancestorPathBeforeDeletion" },
  "symbolLinks": { kind: "mapped", to: "FigNode.symbolLinks", note: "Kiwi SymbolLink[] is preserved directly on FigNode as component metadata." },
  "textListData": { kind: "mapped", to: "textListData" },
  "detachOpticalSizeFromFontSize": { kind: "mapped", to: "detachOpticalSizeFromFontSize" },
  "listSpacing": { kind: "mapped", to: "listSpacing" },
  "embedData": { kind: "mapped", to: "embedData" },
  "richMediaData": { kind: "mapped", to: "richMediaData" },
  "renderedSyncedState": { kind: "mapped", to: "renderedSyncedState" },
  "simplifyInstancePanels": { kind: "mapped", to: "simplifyInstancePanels" },
  "accessibleHTMLTag": { kind: "dropped", reason: "kiwi-internal" },
  "ariaRole": { kind: "mapped", to: "ariaRole" },
  "ariaAttributes": { kind: "mapped", to: "ariaAttributes" },
  "accessibleLabel": { kind: "mapped", to: "accessibleLabel" },
  "isDecorativeImage": { kind: "mapped", to: "isDecorativeImage" },
  "variableData": { kind: "mapped", to: "variableData" },
  "variableConsumptionMap": { kind: "mapped", to: "variableConsumptionMap" },
  "variableModeBySetMap": { kind: "mapped", to: "variableModeBySetMap", note: "SymbolResolver carries this as the inherited variable mode context for INSTANCE target selection." },
  "variableSetModes": { kind: "mapped", to: "variableSetModes", note: "SymbolResolver uses VARIABLE_SET mode order as the local Kiwi default when no active mode entry is pinned." },
  "variableSetID": { kind: "mapped", to: "variableSetID" },
  "variableResolvedType": { kind: "mapped", to: "variableResolvedType" },
  "variableDataValues": { kind: "mapped", to: "variableDataValues", note: "SymbolResolver resolves local VARIABLE alias values from this per-mode table; unresolved library aliases remain external." },
  "variableTokenName": { kind: "mapped", to: "variableTokenName" },
  "variableScopes": { kind: "mapped", to: "variableScopes" },
  "parameterConsumptionMap": { kind: "mapped", to: "parameterConsumptionMap" },
  "codeSyntax": { kind: "mapped", to: "codeSyntax" },
  "pasteSource": { kind: "mapped", to: "pasteSource" },
  "pageType": { kind: "mapped", to: "pageType" },
  "strokeBrushGuid": { kind: "mapped", to: "strokeBrushGuid" },
  "strokeSeed": { kind: "mapped", to: "strokeSeed" },
  "variableWidthPoints": { kind: "mapped", to: "variableWidthPoints" },
  "dynamicStrokeSettings": { kind: "mapped", to: "dynamicStrokeSettings" },
  "scatterStrokeSettings": { kind: "mapped", to: "scatterStrokeSettings" },
  "stretchStrokeSettings": { kind: "mapped", to: "stretchStrokeSettings" },
  "scatterBrushTransforms": { kind: "mapped", to: "scatterBrushTransforms" },
  "brushType": { kind: "mapped", to: "brushType" },
  "backingVariableSetId": { kind: "mapped", to: "backingVariableSetId" },
  // Variables system: not rendered today.
  "overriddenVariableId": { kind: "mapped", to: "overriddenVariableId" },
  "backingVariableId": { kind: "mapped", to: "backingVariableId" },
  "isCollectionExtendable": { kind: "mapped", to: "isCollectionExtendable" },
  "rootVariableKey": { kind: "mapped", to: "rootVariableKey" },
  "inheritedVariableIds": { kind: "mapped", to: "inheritedVariableIds" },
  // Handoff / agenda / migration / soft-delete / edit metadata.
  "handoffStatusMap": { kind: "mapped", to: "handoffStatusMap" },
  "agendaPositionMap": { kind: "mapped", to: "agendaPositionMap" },
  "agendaMetadataMap": { kind: "mapped", to: "agendaMetadataMap" },
  "migrationStatus": { kind: "mapped", to: "migrationStatus" },
  "isSoftDeleted": { kind: "mapped", to: "isSoftDeleted" }, // tombstone — caller filters earlier
  "editInfo": { kind: "mapped", to: "editInfo" },
  "colorProfile": { kind: "mapped", to: "colorProfile" },
  "detachedSymbolId": { kind: "mapped", to: "detachedSymbolId" },
  "childReadingDirection": { kind: "mapped", to: "childReadingDirection" }, // reading order a11y
  "readingIndex": { kind: "mapped", to: "readingIndex" },
  "documentColorProfile": { kind: "mapped", to: "documentColorProfile" },
  "developerRelatedLinks": { kind: "mapped", to: "developerRelatedLinks" },
  // Slides theming / responsive breakpoints / make-libraries / source
  // code blocks / AI chat / repeater / CMS / hub file attribution /
  // motion timeline — none rendered by this editor today.
  "slideActiveThemeLibKey": { kind: "mapped", to: "slideActiveThemeLibKey" },
  "editScopeInfo": { kind: "mapped", to: "editScopeInfo" },
  "semanticWeight": { kind: "mapped", to: "semanticWeight" },
  "semanticItalic": { kind: "mapped", to: "semanticItalic" },
  "areSlidesManuallyIndented": { kind: "mapped", to: "areSlidesManuallyIndented" },
  "isResponsiveSet": { kind: "mapped", to: "isResponsiveSet" },
  "derivedBreakpointData": { kind: "mapped", to: "derivedBreakpointData" },
  "defaultResponsiveSetId": { kind: "mapped", to: "defaultResponsiveSetId" },
  "isPrimaryBreakpoint": { kind: "mapped", to: "isPrimaryBreakpoint" },
  "primaryResponsiveNodeId": { kind: "mapped", to: "primaryResponsiveNodeId" },
  "multiEditGlueId": { kind: "mapped", to: "multiEditGlueId" },
  "breakpointMinWidth": { kind: "mapped", to: "breakpointMinWidth" },
  "isBreakpointInFocus": { kind: "mapped", to: "isBreakpointInFocus" },
  "responsiveSetSettings": { kind: "mapped", to: "responsiveSetSettings" },
  "behaviors": { kind: "mapped", to: "behaviors" },
  "sourceCode": { kind: "mapped", to: "sourceCode" },
  "sourceCodeCollaborativeTextVersion": { kind: "mapped", to: "sourceCodeCollaborativeTextVersion" },
  "collaborativeSourceCode": { kind: "mapped", to: "collaborativeSourceCode" },
  "belongsToCodeLibraryId": { kind: "mapped", to: "belongsToCodeLibraryId" },
  "importedCodeFiles": { kind: "mapped", to: "importedCodeFiles" },
  "codeFileCanvasNodeId": { kind: "mapped", to: "codeFileCanvasNodeId" },
  "isEntrypointCodeFile": { kind: "mapped", to: "isEntrypointCodeFile" },
  "componentOrStateGroupKey": { kind: "mapped", to: "componentOrStateGroupKey" },
  "componentOrStateGroupVersion": { kind: "mapped", to: "componentOrStateGroupVersion" },
  "sourceCodeLibraryKey": { kind: "mapped", to: "sourceCodeLibraryKey" },
  "sourceCodeLibraryKeys": { kind: "mapped", to: "sourceCodeLibraryKeys" },
  "usedMakeLibraries": { kind: "mapped", to: "usedMakeLibraries" },
  "makeLibraryComponentId": { kind: "mapped", to: "makeLibraryComponentId" },
  "shouldHidePreviewForMakeKitCreation": { kind: "mapped", to: "shouldHidePreviewForMakeKitCreation" },
  "codePreviewSettings": { kind: "mapped", to: "codePreviewSettings" },
  "codeExamples": { kind: "mapped", to: "codeExamples" },
  "exportedFromCodeFileId": { kind: "mapped", to: "exportedFromCodeFileId" },
  "codeExportName": { kind: "mapped", to: "codeExportName" },
  "backingCodeComponentId": { kind: "mapped", to: "backingCodeComponentId" },
  "isMainCodeComponent": { kind: "mapped", to: "isMainCodeComponent" },
  "codeSnapshotState": { kind: "mapped", to: "codeSnapshotState" },
  "chatMessages": { kind: "mapped", to: "chatMessages" },
  "chatCompressionState": { kind: "mapped", to: "chatCompressionState" },
  "aiChatThread": { kind: "mapped", to: "aiChatThread" },
  "codeChatMessagesKey": { kind: "mapped", to: "codeChatMessagesKey" },
  "codeSnapshot": { kind: "mapped", to: "codeSnapshot" },
  "codeSnapshotInvalidatedAt": { kind: "mapped", to: "codeSnapshotInvalidatedAt" },
  "isCodeBehavior": { kind: "mapped", to: "isCodeBehavior" },
  "autoForkCode": { kind: "mapped", to: "autoForkCode" },
  "hasBeenManuallyRenamed": { kind: "mapped", to: "hasBeenManuallyRenamed" },
  "codeCreatedFromDesign": { kind: "mapped", to: "codeCreatedFromDesign" },
  "codeCreatedFromDesignNodeId": { kind: "mapped", to: "codeCreatedFromDesignNodeId" },
  "imageImports": { kind: "mapped", to: "imageImports" },
  "codeObjectType": { kind: "mapped", to: "codeObjectType" },
  "codeFilePath": { kind: "mapped", to: "codeFilePath" },
  "codeBehaviorData": { kind: "mapped", to: "codeBehaviorData" },
  "codeLibraryFormat": { kind: "mapped", to: "codeLibraryFormat" },
  "isCodePreviewPlayingOnCanvas": { kind: "mapped", to: "isCodePreviewPlayingOnCanvas" },
  "codeEmbedInfo": { kind: "mapped", to: "codeEmbedInfo" },
  "mimeType": { kind: "mapped", to: "mimeType" },
  "blobRef": { kind: "mapped", to: "blobRef" }, // not used by paint or image resolution
  "cmsSelector": { kind: "mapped", to: "cmsSelector" },
  "cmsConsumptionMap": { kind: "mapped", to: "cmsConsumptionMap" },
  "cmsRichTextStyleMap": { kind: "mapped", to: "cmsRichTextStyleMap" },
  "repeaterSymbolId": { kind: "mapped", to: "repeaterSymbolId" },
  "repeaterCmsOverrideData": { kind: "mapped", to: "repeaterCmsOverrideData" },
  "repeaterOverrideData": { kind: "mapped", to: "repeaterOverrideData" },
  "aiEditedNodeChangeFieldNumbers": { kind: "mapped", to: "aiEditedNodeChangeFieldNumbers" },
  "aiEditScopeLabel": { kind: "mapped", to: "aiEditScopeLabel" },
  "firstDraftData": { kind: "mapped", to: "firstDraftData" },
  "firstDraftKitElementData": { kind: "mapped", to: "firstDraftKitElementData" },
  "cooperRevertData": { kind: "mapped", to: "cooperRevertData" },
  "cooperTemplateData": { kind: "mapped", to: "cooperTemplateData" },
  "buzzApprovalRequests": { kind: "mapped", to: "buzzApprovalRequests" },
  "buzzApprovalNodeStatusInfo": { kind: "mapped", to: "buzzApprovalNodeStatusInfo" },
  "hubFileAttribution": { kind: "mapped", to: "hubFileAttribution" },
  "managedStringData": { kind: "mapped", to: "managedStringData" },
  "thumbnailInfo": { kind: "mapped", to: "thumbnailInfo" },
  "aiCanvasPrompt": { kind: "mapped", to: "aiCanvasPrompt" },
  "backingNodeId": { kind: "mapped", to: "FigNode.backingNodeId", note: "Kiwi CanvasNodeId metadata is preserved directly; SymbolResolver does not resolve INSTANCE targets from it." },
  // Motion / animation timelines: no support.
  "motionTransform": { kind: "mapped", to: "motionTransform" },
  "timelinePosition": { kind: "mapped", to: "timelinePosition" },
  "keyframeValue": { kind: "mapped", to: "keyframeValue" },
  "interpolationType": { kind: "mapped", to: "interpolationType" },
  "bezierHandles": { kind: "mapped", to: "bezierHandles" },
  "easingData": { kind: "mapped", to: "easingData" },
  "keyframeOperation": { kind: "mapped", to: "keyframeOperation" },
  "timelinePositionType": { kind: "mapped", to: "timelinePositionType" },
  "clipId": { kind: "mapped", to: "clipId" },
  "timelineDuration": { kind: "mapped", to: "timelineDuration" },
  "timelineOffset": { kind: "mapped", to: "timelineOffset" },
  "playbackStyle": { kind: "mapped", to: "playbackStyle" },
  "animationPresets": { kind: "mapped", to: "animationPresets" },
  "transitionOverrides": { kind: "mapped", to: "transitionOverrides" },
};
