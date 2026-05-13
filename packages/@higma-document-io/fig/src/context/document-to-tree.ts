/**
 * @file Convert FigDesignDocument back to flat nodeChanges for serialization
 *
 * Single SoT for the high-level `FigDesignDocument → FigNode[]` projection.
 * Every load-bearing Kiwi field that Figma needs to render and persist a
 * node correctly is materialised here (via `applyNodeTypeDefaults`), so
 * downstream consumers — `exportFig`, the editor save flow, refine-fig —
 * never re-implement node construction.
 *
 * `FigDesignNode` itself carries every first-class load-bearing field
 * (`isSymbolPublishable`, `derivedSymbolData`, `frameMaskDisabled`, ...);
 * there is no `_raw` fall-through. Projection is therefore a pure walk
 * of the document tree.
 */

import type { FigNode, FigGuid, FigParentIndex, FigComponentPropValue, FigPaint, FigImagePaint, FigVector } from "@higma-document-models/fig/types";
import type {
  ComponentPropertyValue,
  FigDesignDocument,
  FigDesignNode,
  FigPage,
  FigDesignBlob,
  FigGridTrackPositions,
} from "@higma-document-models/fig/domain";
import { parseId, type FigBlob } from "@higma-document-models/fig/domain";
import type { FigNodeId, FigPageId } from "@higma-document-models/fig/domain";
import { NODE_TYPE_VALUES, type NodeType } from "@higma-document-models/fig/constants";
import { IDENTITY_MATRIX } from "@higma-document-models/fig/matrix";
import {
  applyNodeTypeDefaults,
  encodeEllipseBlob,
  encodeRectangleBlob,
  encodeRoundedRectangleBlob,
  encodeSvgPathBlob,
} from "@higma-document-models/fig/node-factory";

// =============================================================================
// Types
// =============================================================================

export type DocumentToTreeResult = {
  readonly nodeChanges: FigNode[];
  readonly blobs: readonly FigBlob[];
};

// =============================================================================
// ID Conversion
// =============================================================================

function nodeIdToGuid(id: FigNodeId | FigPageId): FigGuid {
  const parsed = parseId(id);
  return { sessionID: parsed.sessionID, localID: parsed.localID };
}

function createParentIndex(parentId: FigNodeId | FigPageId, position: string): FigParentIndex {
  return { guid: nodeIdToGuid(parentId), position };
}

const COMPONENT_PROP_TYPE_VALUES = {
  BOOL: 0,
  TEXT: 1,
  COLOR: 2,
  INSTANCE_SWAP: 3,
  VARIANT: 4,
  NUMBER: 5,
  IMAGE: 6,
  SLOT: 7,
} as const;

const COMPONENT_PROP_NODE_FIELD_VALUES = {
  VISIBLE: 0,
  TEXT_DATA: 1,
  OVERRIDDEN_SYMBOL_ID: 2,
  INHERIT_FILL_STYLE_ID: 3,
  SLOT_CONTENT_ID: 4,
} as const;

function componentPropertyValueToFig(value: ComponentPropertyValue): FigComponentPropValue {
  if (value.boolValue !== undefined) {
    return { boolValue: value.boolValue };
  }
  if (value.textValue !== undefined) {
    return { textValue: { characters: value.textValue.characters } };
  }
  if (value.referenceValue !== undefined) {
    return { guidValue: nodeIdToGuid(value.referenceValue) };
  }
  if (value.numberValue !== undefined) {
    return { numberValue: value.numberValue };
  }
  return {};
}

// =============================================================================
// Position String
// =============================================================================

// Figma's fractional-index alphabet starts at '!' (0x21). The committed
// pre-regeneration `rectangle.fig` (which opens in Figma) and the
// pre-`6ea3dc6` versions of all generator-built fixtures (which also
// opened — see the byte-for-byte diff in this file's history) emit
// positions in the range '!'..'~'. Starting at ' ' (0x20) results in a
// leading space the importer rejects.
const POSITION_FIRST_CHAR = 0x21;

// Reserved end-of-range position used for the Internal Only Canvas in
// real Figma exports and in pre-regeneration fixtures. The IOC must
// sort lexicographically last among the DOCUMENT's children regardless
// of how many visible canvases precede it.
const INTERNAL_ONLY_CANVAS_POSITION = "~";

function positionString(index: number): string {
  return String.fromCharCode(POSITION_FIRST_CHAR + index);
}

// =============================================================================
// Paint projection (API/builder shape → Kiwi wire shape)
// =============================================================================

function hexStringToBytes(hex: string): number[] {
  if (hex.length % 2 !== 0) {
    throw new Error(`hexStringToBytes: hex must have even length, got ${hex.length} for ${hex}`);
  }
  const out: number[] = new Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`hexStringToBytes: invalid hex byte at offset ${i * 2} in ${hex}`);
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Project a `FigPaint` from the API/builder shape into the Kiwi wire
 * shape Figma's importer reads. The schema names the image reference
 * `image: { hash: byte[] }` — builder code carries `imageRef: <hex>`
 * for ergonomics, and the Kiwi encoder silently drops unknown fields.
 */
function projectPaintForWire(paint: FigPaint): FigPaint {
  if (paint.type !== "IMAGE") return paint;
  return projectImagePaintForWire(paint);
}

function projectImagePaintForWire(paint: FigImagePaint): FigImagePaint {
  if (paint.image && Array.isArray(paint.image.hash) && paint.image.hash.length > 0) {
    const { imageRef: _ref, imageHash: _hash, ...rest } = paint;
    return rest;
  }
  const refHex = pickImageRefHex(paint);
  if (refHex === null) {
    throw new Error(
      `IMAGE paint is missing 'image.hash' (wire), 'imageRef' (API), and 'imageHash' (API); ` +
      `cannot project to wire format`,
    );
  }
  const { imageRef: _ref, imageHash: _hash, ...rest } = paint;
  return { ...rest, image: { hash: hexStringToBytes(refHex) } };
}

function pickImageRefHex(paint: FigImagePaint): string | null {
  if (typeof paint.imageRef === "string" && paint.imageRef.length > 0) return paint.imageRef;
  if (typeof paint.imageHash === "string" && paint.imageHash.length > 0) return paint.imageHash;
  return null;
}

// =============================================================================
// FRAME load-bearing projections (domain → Kiwi wire shape)
// =============================================================================

/**
 * Wrap a `FigVector` into the wire-format `OptionalVector { value: Vector }`.
 * The Kiwi encoder treats bare `{x,y}` as a wrapper missing its `value`
 * field and serialises `{}`. Figma's importer rejects the malformed wrapper.
 */
function wrapAsOptionalVector(vector: FigVector): { readonly value: FigVector } {
  return { value: vector };
}

type GuidPositionMapEntryWire = {
  readonly id: FigGuid;
  readonly position: string;
};

/**
 * Project a domain-side `FigGridTrackPositions` into the wire-format
 * `GUIDPositionMap`. The schema's `GUIDPositionMapEntry` requires
 * `position: string` (fractional-index track-order key); the domain
 * model carries only `{id, trackSize?}` so we synthesise the
 * positions here using the same `'!'..'~'` alphabet as sibling node
 * order. Without `position` Figma's grid layout decoder rejects the
 * FRAME at import.
 */
function projectGuidPositionMap(
  map: FigGridTrackPositions,
): { readonly entries: readonly GuidPositionMapEntryWire[] } {
  const entries: GuidPositionMapEntryWire[] = map.entries.map((entry, i) => ({
    id: entry.id,
    position: positionString(i),
  }));
  return { entries };
}

// =============================================================================
// Design Node to FigNode
// =============================================================================

/**
 * Accumulator for fillGeometry blobs synthesised during projection.
 *
 * `doc.blobs` carries explicit blobs the author registered. Shape nodes
 * built via the scratch builder (`addNode` with type FRAME / RECTANGLE /
 * ROUNDED_RECTANGLE / ELLIPSE) seldom carry an explicit `fillGeometry`
 * because the on-disk requirement (every visible shape needs a path-
 * commands blob to render) is a property of the projection target, not
 * the domain. We synthesise the blob here and append it to the
 * accumulator; downstream `buildNodeChanges` concatenates the
 * accumulator with `doc.blobs` so the final wire payload carries both.
 */
type BlobAccumulator = {
  readonly synthesised: { bytes: number[] }[];
  readonly explicitCount: number;
};

function nextBlobIndex(acc: BlobAccumulator): number {
  return acc.explicitCount + acc.synthesised.length;
}

function encodeStackWrap(wrap: boolean): { value: number; name: "WRAP" | "NO_WRAP" } {
  if (wrap) return { value: 1, name: "WRAP" };
  return { value: 0, name: "NO_WRAP" };
}

function encodeWindingRule(isEvenOdd: boolean): { value: number; name: "ODD" | "NONZERO" } {
  if (isEvenOdd) return { value: 1, name: "ODD" };
  return { value: 0, name: "NONZERO" };
}

function designNodeToFigNode(
  node: FigDesignNode,
  parentId: FigNodeId | FigPageId,
  childIndex: number,
  blobAcc: BlobAccumulator,
): FigNode {
  const guid = nodeIdToGuid(node.id);
  const typeValue = NODE_TYPE_VALUES[node.type as NodeType];
  if (typeValue === undefined) {
    throw new Error(`Unknown FigNodeType for projection: ${node.type}`);
  }

  const base: Record<string, unknown> = {
    guid,
    parentIndex: createParentIndex(parentId, positionString(childIndex)),
    type: { value: typeValue, name: node.type },
    phase: { value: 0, name: "CREATED" },
    name: node.name,
    visible: node.visible,
    opacity: node.opacity,
    transform: node.transform,
    size: node.size,
  };

  if (node.transformOrigin !== undefined) { base.transformOrigin = node.transformOrigin; }
  // `imageRef` (builder/API) → `image.hash` (wire); see projectPaintForWire.
  if (node.fills.length > 0) { base.fillPaints = node.fills.map(projectPaintForWire); }
  if (node.backgroundPaints !== undefined) { base.backgroundPaints = node.backgroundPaints.map(projectPaintForWire); }
  if (node.strokes.length > 0) { base.strokePaints = node.strokes.map(projectPaintForWire); }
  base.strokeWeight = node.strokeWeight;
  if (node.exportSettings !== undefined) { base.exportSettings = node.exportSettings; }

  if (node.strokeAlign !== undefined) { base.strokeAlign = node.strokeAlign; }
  if (node.strokeJoin !== undefined) { base.strokeJoin = node.strokeJoin; }
  if (node.strokeCap !== undefined) { base.strokeCap = node.strokeCap; }
  if (node.strokeDashes !== undefined) { base.strokeDashes = node.strokeDashes; }
  if (node.cornerRadius !== undefined) { base.cornerRadius = node.cornerRadius; }
  if (node.rectangleCornerRadii !== undefined) { base.rectangleCornerRadii = node.rectangleCornerRadii; }
  if (node.cornerSmoothing !== undefined) { base.cornerSmoothing = node.cornerSmoothing; }
  if (node.individualStrokeWeights !== undefined) {
    base.borderStrokeWeightsIndependent = true;
    base.borderTopWeight = node.individualStrokeWeights.top;
    base.borderRightWeight = node.individualStrokeWeights.right;
    base.borderBottomWeight = node.individualStrokeWeights.bottom;
    base.borderLeftWeight = node.individualStrokeWeights.left;
  }
  if (node.effects.length > 0) { base.effects = node.effects; }
  if (node.clipsContent !== undefined) {
    base.clipsContent = node.clipsContent;
    base.frameMaskDisabled = !node.clipsContent;
  }
  if (node.sectionContentsHidden !== undefined) { base.sectionContentsHidden = node.sectionContentsHidden; }
  if (node.mask !== undefined) { base.mask = node.mask; }
  if (node.arcData !== undefined) { base.arcData = node.arcData; }
  if (node.vectorPaths !== undefined) { base.vectorPaths = node.vectorPaths; }
  if (node.vectorData !== undefined) { base.vectorData = node.vectorData; }
  if (node.fillGeometry !== undefined) { base.fillGeometry = node.fillGeometry; }
  if (node.strokeGeometry !== undefined) { base.strokeGeometry = node.strokeGeometry; }
  if (node.booleanOperation !== undefined) { base.booleanOperation = node.booleanOperation; }
  if (node.pointCount !== undefined) { base.pointCount = node.pointCount; }
  if (node.starInnerRadius !== undefined) { base.starInnerRadius = node.starInnerRadius; }
  if (node.starInnerScale !== undefined) { base.starInnerScale = node.starInnerScale; }
  if (node.handleMirroring !== undefined) { base.handleMirroring = node.handleMirroring; }
  if (node.styleIdForFill !== undefined) { base.styleIdForFill = node.styleIdForFill; }
  if (node.styleIdForStrokeFill !== undefined) { base.styleIdForStrokeFill = node.styleIdForStrokeFill; }
  if (node.styleIdForText !== undefined) { base.styleIdForText = node.styleIdForText; }
  if (node.styleIdForEffect !== undefined) { base.styleIdForEffect = node.styleIdForEffect; }
  if (node.styleIdForGrid !== undefined) { base.styleIdForGrid = node.styleIdForGrid; }
  if (node.styleType !== undefined) { base.styleType = node.styleType; }
  if (node.key !== undefined) { base.key = node.key; }
  if (node.overrideKey !== undefined) { base.overrideKey = node.overrideKey; }
  if (node.blendMode !== undefined) { base.blendMode = node.blendMode; }

  // FRAME load-bearing — wrap bare-Vector / id-only entries into the
  // wire-format shapes the Kiwi schema declares (`OptionalVector` /
  // `GUIDPositionMap`). Without these projections the encoder emits
  // malformed `{}` wrappers and entries lacking `position`, which
  // Figma's importer rejects.
  if (node.minSize !== undefined) { base.minSize = wrapAsOptionalVector(node.minSize); }
  if (node.maxSize !== undefined) { base.maxSize = wrapAsOptionalVector(node.maxSize); }
  if (node.bordersTakeSpace !== undefined) { base.bordersTakeSpace = node.bordersTakeSpace; }
  // `targetAspectRatio` has the same `OptionalVector { value: Vector }`
  // shape as min/maxSize in the schema, but pre-`6ea3dc6` fixtures
  // (which open in Figma) emit it as the unwrapped `{}` Kiwi produces
  // when the encoder cannot match `x`/`y` against `value`. Match that
  // wire output exactly: pass the bare vector and let the encoder
  // emit `{}`. Figma treats `{}` as "ratio not set" and accepts the
  // file. Wrapping it correctly causes regressions we don't yet
  // understand and is out of scope for this fix.
  if (node.targetAspectRatio !== undefined) { base.targetAspectRatio = node.targetAspectRatio; }
  if (node.proportionsConstrained !== undefined) { base.proportionsConstrained = node.proportionsConstrained; }
  if (node.gridRows !== undefined) { base.gridRows = projectGuidPositionMap(node.gridRows); }
  if (node.gridColumns !== undefined) { base.gridColumns = projectGuidPositionMap(node.gridColumns); }
  if (node.gridRowGap !== undefined) { base.gridRowGap = node.gridRowGap; }
  if (node.gridColumnGap !== undefined) { base.gridColumnGap = node.gridColumnGap; }

  // AutoLayout
  if (node.autoLayout) {
    base.stackMode = node.autoLayout.stackMode;
    if (node.autoLayout.stackSpacing !== undefined) { base.stackSpacing = node.autoLayout.stackSpacing; }
    if (node.autoLayout.stackPadding !== undefined) {
      // Kiwi schema offers two padding spellings:
      //   - `stackPadding: float` (legacy uniform — value 109)
      //   - `stackHorizontalPadding` / `stackVerticalPadding` /
      //     `stackPaddingRight` / `stackPaddingBottom` (per-side — values 209+)
      // Real Figma exports today use the per-side spelling. Pre-`6ea3dc6`
      // fixtures used the legacy spelling for uniform padding. Both are
      // valid per the bundled schema, but we match the pre-regen fixtures
      // (which open in Figma) byte-for-byte: emit `stackPadding` alone
      // when all four sides are equal, and fall back to the per-side
      // spelling otherwise.
      const pad = node.autoLayout.stackPadding;
      if (pad.top === pad.right && pad.right === pad.bottom && pad.bottom === pad.left) {
        base.stackPadding = pad.top;
      } else {
        base.stackHorizontalPadding = pad.left;
        base.stackPaddingRight = pad.right;
        base.stackVerticalPadding = pad.top;
        base.stackPaddingBottom = pad.bottom;
      }
    }
    if (node.autoLayout.stackPrimaryAlignItems !== undefined) { base.stackPrimaryAlignItems = node.autoLayout.stackPrimaryAlignItems; }
    if (node.autoLayout.stackCounterAlignItems !== undefined) { base.stackCounterAlignItems = node.autoLayout.stackCounterAlignItems; }
    if (node.autoLayout.stackPrimaryAlignContent !== undefined) { base.stackPrimaryAlignContent = node.autoLayout.stackPrimaryAlignContent; }
    if (node.autoLayout.stackWrap !== undefined) {
      // Kiwi models `stackWrap` as the `StackWrap` enum
      // (NO_WRAP=0, WRAP=1); writing the raw boolean throws at the
      // value codec. The domain model carries the ergonomic boolean,
      // so translate at the projection boundary.
      base.stackWrap = encodeStackWrap(node.autoLayout.stackWrap);
    }
    if (node.autoLayout.stackCounterSpacing !== undefined) { base.stackCounterSpacing = node.autoLayout.stackCounterSpacing; }
    if (node.autoLayout.stackReverseZIndex !== undefined) { base.stackReverseZIndex = node.autoLayout.stackReverseZIndex; }
  }
  if (node.layoutConstraints) {
    if (node.layoutConstraints.stackPositioning !== undefined) { base.stackPositioning = node.layoutConstraints.stackPositioning; }
    if (node.layoutConstraints.stackPrimarySizing !== undefined) { base.stackPrimarySizing = node.layoutConstraints.stackPrimarySizing; }
    if (node.layoutConstraints.stackCounterSizing !== undefined) { base.stackCounterSizing = node.layoutConstraints.stackCounterSizing; }
    if (node.layoutConstraints.horizontalConstraint !== undefined) { base.horizontalConstraint = node.layoutConstraints.horizontalConstraint; }
    if (node.layoutConstraints.verticalConstraint !== undefined) { base.verticalConstraint = node.layoutConstraints.verticalConstraint; }
    if (node.layoutConstraints.stackChildAlignSelf !== undefined) { base.stackChildAlignSelf = node.layoutConstraints.stackChildAlignSelf; }
    if (node.layoutConstraints.stackChildPrimaryGrow !== undefined) { base.stackChildPrimaryGrow = node.layoutConstraints.stackChildPrimaryGrow; }
  }

  // Text
  if (node.textData) {
    base.characters = node.textData.characters;
    base.fontSize = node.textData.fontSize;
    base.fontName = node.textData.fontName;
    if (node.textData.textAlignHorizontal !== undefined) { base.textAlignHorizontal = node.textData.textAlignHorizontal; }
    if (node.textData.textAlignVertical !== undefined) { base.textAlignVertical = node.textData.textAlignVertical; }
    if (node.textData.textAutoResize !== undefined) { base.textAutoResize = node.textData.textAutoResize; }
    if (node.textData.textDecoration !== undefined) { base.textDecoration = node.textData.textDecoration; }
    if (node.textData.textCase !== undefined) { base.textCase = node.textData.textCase; }
    if (node.textData.lineHeight !== undefined) { base.lineHeight = node.textData.lineHeight; }
    if (node.textData.letterSpacing !== undefined) { base.letterSpacing = node.textData.letterSpacing; }

    const textDataMsg: Record<string, unknown> = {
      characters: node.textData.characters,
      characterStyleIDs: node.textData.characterStyleIDs ?? new Array(node.textData.characters.length).fill(0),
    };
    if (node.textData.styleOverrideTable && node.textData.styleOverrideTable.length > 0) {
      textDataMsg.styleOverrideTable = node.textData.styleOverrideTable.map((entry) => {
        const nc: Record<string, unknown> = { styleID: entry.styleID };
        if (entry.fontSize !== undefined) { nc.fontSize = entry.fontSize; }
        if (entry.fontName !== undefined) { nc.fontName = entry.fontName; }
        if (entry.fillPaints !== undefined) { nc.fillPaints = entry.fillPaints; }
        if (entry.textDecoration !== undefined) { nc.textDecoration = entry.textDecoration; }
        if (entry.textCase !== undefined) { nc.textCase = entry.textCase; }
        if (entry.lineHeight !== undefined) { nc.lineHeight = entry.lineHeight; }
        if (entry.letterSpacing !== undefined) { nc.letterSpacing = entry.letterSpacing; }
        return nc;
      });
    }
    base.textData = textDataMsg;
  }
  if (node.derivedTextData !== undefined) { base.derivedTextData = node.derivedTextData; }
  if (node.textTracking !== undefined) { base.textTracking = node.textTracking; }
  if (node.textTruncation !== undefined) { base.textTruncation = node.textTruncation; }
  if (node.leadingTrim !== undefined) { base.leadingTrim = node.leadingTrim; }
  if (node.fontVariations !== undefined) { base.fontVariations = node.fontVariations; }
  if (node.hyperlink !== undefined) { base.hyperlink = node.hyperlink; }

  // Symbol / Instance.
  //
  // `rawOverrides` / `rawDerivedSymbolData` are the resolve-pre copies
  // produced by `convertFigNode` at load time; when present, they are
  // the SoT for round-trip projection (they carry Figma's per-session
  // ghost-guid trace verbatim). The resolve-post `overrides` /
  // `derivedSymbolData` are used by renderers but have rerouted paths
  // that the re-parser would otherwise refuse.
  if (node.symbolId !== undefined) {
    const projectedOverrides = node.rawOverrides ?? node.overrides ?? [];
    base.symbolData = {
      symbolID: nodeIdToGuid(node.symbolId),
      symbolOverrides: projectedOverrides,
      uniformScaleFactor: 1,
    };
    base.symbolID = nodeIdToGuid(node.symbolId);
    if (projectedOverrides.length > 0) {
      base.symbolOverrides = projectedOverrides;
    }
  }
  if (node.overriddenSymbolID !== undefined) {
    base.overriddenSymbolID = nodeIdToGuid(node.overriddenSymbolID as FigNodeId);
  }
  // Prefer the resolve-pre raw entries so the projected Kiwi node
  // matches the on-disk representation Figma's importer expects.
  const projectedDerived = node.rawDerivedSymbolData ?? node.derivedSymbolData;
  if (projectedDerived !== undefined && projectedDerived.length > 0) {
    base.derivedSymbolData = projectedDerived;
  }
  if (node.componentPropertyReferences !== undefined) {
    base.componentPropertyReferences = node.componentPropertyReferences;
  }
  if (node.isSymbolPublishable !== undefined) { base.isSymbolPublishable = node.isSymbolPublishable; }
  if (node.sharedSymbolVersion !== undefined) { base.sharedSymbolVersion = node.sharedSymbolVersion; }

  if (node.componentPropertyDefs !== undefined) {
    base.componentPropDefs = node.componentPropertyDefs.map((def) => ({
      id: nodeIdToGuid(def.id),
      name: def.name,
      type: { value: COMPONENT_PROP_TYPE_VALUES[def.type], name: def.type },
      initialValue: def.initialValue ? componentPropertyValueToFig(def.initialValue) : undefined,
      sortPosition: def.sortPosition,
    }));
  }
  if (node.componentPropertyRefs !== undefined) {
    base.componentPropRefs = node.componentPropertyRefs.map((ref) => ({
      defID: nodeIdToGuid(ref.defId),
      componentPropNodeField: {
        value: COMPONENT_PROP_NODE_FIELD_VALUES[ref.nodeField],
        name: ref.nodeField,
      },
    }));
  }
  if (node.componentPropertyAssignments !== undefined) {
    base.componentPropAssignments = node.componentPropertyAssignments.map((assignment) => ({
      defID: nodeIdToGuid(assignment.defId),
      value: componentPropertyValueToFig(assignment.value),
    }));
  }
  if (node.variantPropSpecs !== undefined) {
    base.variantPropSpecs = node.variantPropSpecs.map((spec) => ({
      propDefId: nodeIdToGuid(spec.propDefId),
      value: spec.value,
    }));
  }
  if (node.isStateGroup !== undefined) {
    base.isStateGroup = node.isStateGroup;
  }

  // Variable consumption
  if (node.parameterConsumptionMap !== undefined) { base.parameterConsumptionMap = node.parameterConsumptionMap; }
  if (node.variableConsumptionMap !== undefined) { base.variableConsumptionMap = node.variableConsumptionMap; }
  if (node.variableModeBySetMap !== undefined) { base.variableModeBySetMap = node.variableModeBySetMap; }

  // Auto-synthesise `fillGeometry` for shape kinds that need a path-
  // commands blob to render. Authors of FigDesignDocuments construct
  // semantic specs (`{type: "FRAME", width, height, fills}`) and don't
  // know about the on-disk requirement that visible shapes carry a
  // blob index — that's a property of the wire format. If the
  // caller already supplied an explicit `fillGeometry`, leave it
  // alone. Otherwise generate the appropriate blob and register it
  // in the accumulator.
  if (base.fillGeometry === undefined && node.fillGeometry === undefined) {
    if (node.type === "VECTOR" && node.vectorPaths !== undefined && node.vectorPaths.length > 0) {
      // VECTOR carries one fillGeometry entry per vectorPaths entry,
      // each encoded as the Figma path-command blob format. The
      // legacy fig-file builder did the same encoding inline; we
      // route through the canonical helper now.
      const entries = node.vectorPaths
        .map((p) => p.data)
        .filter((d): d is string => typeof d === "string" && d.length > 0)
        .map((d) => {
          const blob = encodeSvgPathBlob(d);
          const blobIndex = nextBlobIndex(blobAcc);
          blobAcc.synthesised.push({ bytes: [...blob.bytes] });
          // Pick the winding rule from the first vectorPath that
          // declared one; default to NONZERO when none did.
          const winding = node.vectorPaths!.find((p) => p.windingRule !== undefined)?.windingRule;
          const isEvenOdd = winding === "EVENODD" || winding === "ODD" ||
            (typeof winding === "object" && winding !== null && (winding.name === "EVENODD" || winding.name === "ODD"));
          return {
            windingRule: encodeWindingRule(isEvenOdd),
            commandsBlob: blobIndex,
            styleID: 0,
          };
        });
      if (entries.length > 0) {
        base.fillGeometry = entries;
      }
    } else {
      const synthesisedBlob = synthesiseFillGeometryBlob(node);
      if (synthesisedBlob !== undefined) {
        const blobIndex = nextBlobIndex(blobAcc);
        blobAcc.synthesised.push({ bytes: synthesisedBlob });
        base.fillGeometry = [
          { windingRule: { value: 0, name: "NONZERO" }, commandsBlob: blobIndex, styleID: 0 },
        ];
      }
    }
  }

  // Apply load-bearing defaults last so caller-supplied values win.
  applyNodeTypeDefaults(base, node.type);

  return base as FigNode;
}

/**
 * Generate the path-commands blob for a shape node by computing its
 * geometry from the node's `size` and `cornerRadius` (when applicable).
 * Returns `undefined` for node kinds whose geometry is author-supplied
 * (VECTOR, LINE) or that don't render filled (DOCUMENT, CANVAS, GROUP,
 * BOOLEAN_OPERATION, INSTANCE — these get their geometry from
 * elsewhere).
 */
function synthesiseFillGeometryBlob(node: FigDesignNode): number[] | undefined {
  const width = node.size.x;
  const height = node.size.y;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  switch (node.type) {
    case "FRAME":
    case "SYMBOL":
    case "RECTANGLE":
    case "SECTION":
      return encodeRectangleBlob(width, height);
    case "ROUNDED_RECTANGLE":
      return encodeRoundedRectangleBlob(width, height, node.cornerRadius ?? 0);
    case "ELLIPSE":
      return encodeEllipseBlob(width, height);
    default:
      return undefined;
  }
}

// =============================================================================
// Page (CANVAS) Flatten
// =============================================================================

type FlattenPageOptions = {
  readonly page: FigPage;
  readonly documentId: FigNodeId;
  readonly pageIndex: number;
  readonly result: FigNode[];
  readonly blobAcc: BlobAccumulator;
};

function flattenPage({ page, documentId, pageIndex, result, blobAcc }: FlattenPageOptions): void {
  const canvasGuid = nodeIdToGuid(page.id);
  // Real Figma exports + pre-regen `rectangle.fig` place the Internal Only
  // Canvas at the reserved "~" position and omit `backgroundColor` /
  // `backgroundEnabled` / `backgroundOpacity` on it (the IOC never renders).
  // Emitting those fields on the IOC, or using ' ' (0x20) for the visible
  // canvas position, makes Figma's importer trip the file.
  const position = page.internalOnly === true
    ? INTERNAL_ONLY_CANVAS_POSITION
    : positionString(pageIndex);
  const canvasBase: Record<string, unknown> = {
    guid: canvasGuid,
    parentIndex: createParentIndex(documentId, position),
    type: { value: NODE_TYPE_VALUES.CANVAS, name: "CANVAS" },
    phase: { value: 0, name: "CREATED" },
    name: page.name,
    visible: page.internalOnly ? false : true,
    opacity: 1,
    transform: IDENTITY_MATRIX,
  };
  if (page.internalOnly !== undefined) { canvasBase.internalOnly = page.internalOnly; }
  if (page.internalOnly !== true) {
    canvasBase.backgroundColor = page.backgroundColor;
    if (page.backgroundOpacity !== undefined) { canvasBase.backgroundOpacity = page.backgroundOpacity; }
    if (page.backgroundEnabled !== undefined) { canvasBase.backgroundEnabled = page.backgroundEnabled; }
  }
  applyNodeTypeDefaults(canvasBase, "CANVAS");
  result.push(canvasBase as FigNode);
  flattenNodes(page.children, page.id, result, blobAcc);
}

function flattenNodes(
  nodes: readonly FigDesignNode[],
  parentId: FigNodeId | FigPageId,
  result: FigNode[],
  blobAcc: BlobAccumulator,
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    result.push(designNodeToFigNode(node, parentId, i, blobAcc));
    if (node.children && node.children.length > 0) {
      flattenNodes(node.children, node.id, result, blobAcc);
    }
  }
}

// =============================================================================
// Build NodeChanges
// =============================================================================

function designBlobsToFigBlobs(blobs: readonly FigDesignBlob[]): readonly FigBlob[] {
  return blobs.map((b) => ({ bytes: b.bytes }));
}

function buildNodeChanges(doc: FigDesignDocument): DocumentToTreeResult {
  const result: FigNode[] = [];
  const blobAcc: BlobAccumulator = {
    synthesised: [],
    explicitCount: doc.blobs.length,
  };

  const documentId = "0:0" as FigNodeId;
  const documentNode: Record<string, unknown> = {
    guid: { sessionID: 0, localID: 0 },
    type: { value: NODE_TYPE_VALUES.DOCUMENT, name: "DOCUMENT" },
    phase: { value: 0, name: "CREATED" },
    name: "Document",
    visible: true,
    opacity: 1,
    transform: IDENTITY_MATRIX,
  };
  if (doc.documentColorProfile) {
    documentNode.documentColorProfile = doc.documentColorProfile;
  }
  applyNodeTypeDefaults(documentNode, "DOCUMENT");
  result.push(documentNode as FigNode);

  for (let i = 0; i < doc.pages.length; i++) {
    flattenPage({ page: doc.pages[i], documentId, pageIndex: i, result, blobAcc });
  }

  return {
    nodeChanges: result,
    blobs: [
      ...designBlobsToFigBlobs(doc.blobs),
      ...blobAcc.synthesised.map((b) => ({ bytes: b.bytes })),
    ],
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Convert a FigDesignDocument to flat nodeChanges for serialization.
 *
 * The projection is purely a function of the document tree — no roundtrip
 * merge with the original `LoadedFigFile.nodeChanges` is required, because
 * `FigDesignNode` already carries every load-bearing Kiwi field.
 */
export function documentToTree(doc: FigDesignDocument): DocumentToTreeResult {
  return buildNodeChanges(doc);
}
