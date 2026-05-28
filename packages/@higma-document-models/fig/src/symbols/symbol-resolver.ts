/**
 * @file Symbol resolution for INSTANCE nodes
 */

import type {
  FigComponentPropAssignment,
  FigColor,
  FigDerivedTextData,
  FigFontMetaData,
  FigFillGeometry,
  FigGuid,
  FigKiwiTextData,
  FigKiwiSymbolData,
  FigKiwiSymbolOverride,
  FigKiwiVariableModeBySetMap,
  FigNode,
  FigPaint,
  FigNodeType,
  FigValueWithUnits,
  KiwiEnumValue,
  MutableFigNode,
} from "@higma-document-models/fig/types";
import { asSolidPaint } from "../color";
import {
  decodePathCommands,
  derivedTextDataHasVisualPayload,
  derivedTextDataWithoutVisualPayload,
  findNodeByGuid,
  type FigBlob,
  getNodeType,
  guidToString,
  isFigGuid,
  type FigKiwiDocumentIndex,
  writeFigKiwiTextDataCharacters,
} from "../domain";
import { resolveInstanceLayout } from "./constraints";
import { kiwiSymbolOverrideCarriesGeometry } from "./kiwi-override-geometry";
import { mergeVariableModeBySetMap, resolveVariantOverride } from "./variable-resolution";
import { isVariantSetFrame } from "./variant-set-kiwi";
import { pathCommandsBoundingBox } from "@higma-primitives/path";
import { resolveAutoLayoutFrame } from "./autolayout-solver";
import { projectVariableAnyValue } from "../variables";

// =============================================================================
// Types
// =============================================================================

/**
 * Derived symbol data: array of FigKiwiSymbolOverride entries
 * that carry computed transforms for INSTANCE child nodes.
 */
export type FigDerivedSymbolData = readonly FigKiwiSymbolOverride[];

// =============================================================================
// Self-override classification
// =============================================================================

/**
 * Field-name set that an authored INSTANCE may override on its own
 * SYMBOL root (the "self" slot).
 *
 * These are the fields Figma's authoring UI lets you set directly on
 * an INSTANCE without descending into a SYMBOL descendant: the
 * INSTANCE's display name, its outer size, the "Constrain proportions"
 * flag that pairs with size on the resize handles, the auto-layout
 * positioning hooks (which describe how the INSTANCE participates in
 * its *parent* container, not in the SYMBOL's internal layout), and
 * the variable / parameter bindings that drive component-property
 * resolution for the SYMBOL it points at. Any override entry whose
 * defined field-set is a subset of this list addresses the INSTANCE
 * itself, not a descendant of its SYMBOL.
 *
 * Real-world fixtures emit self-overrides through paths whose first
 * guid is the INSTANCE's per-instance ghost-allocated guid (a session
 * that is never bound to a node in the file). Those entries must be
 * classified as self-overrides so SymbolResolver applies them to the
 * SYMBOL root instead of treating the ghost guid as a descendant slot.
 * Examples surfaced during Phase 0a H roundtrip verification:
 *
 *   - Figma Community E-commerce template `arrow-left` INSTANCEs:
 *     `{size, proportionsConstrained}`.
 *   - The `inherit.fig` fixture's `Bezel` INSTANCEs emit
 *     `{name, size, stackPositioning}` — `stackPositioning` is a
 *     parent-container hook (`stackChildPositioning` semantics) and
 *     does not target any SYMBOL descendant.
 */
/**
 * Fields the merged-node applier (`applySelfOverridesToMergedNode`)
 * actually projects from a single-guid override onto the INSTANCE
 * frame. SoT for both the detector below and the applier — keeping
 * one shared set guarantees that anything the applier can write is
 * also classified as an INSTANCE-self field upstream, so the raw
 * filter does not silently drop an override the applier would have
 * accepted (e.g. App Store template Tab 7's
 * `{name, fillPaints, styleIdForFill, stackPrimarySizing}` self-
 * override, where the missing `styleIdForFill` previously made the
 * detector emit "dropping override entry with unreachable guid" 24×
 * per render despite the applier supporting that exact field).
 */
const SELF_OVERRIDE_PAYLOAD_FIELDS: ReadonlySet<keyof FigKiwiSymbolOverride> = new Set<keyof FigKiwiSymbolOverride>([
  // Paint / geometry / effect — applier writes these onto the merged
  // INSTANCE frame when a single-guid override targets the SYMBOL
  // root. Members are restricted to keys actually declared on
  // `FigKiwiSymbolOverridePayload`; the prior `SELF_OVERRIDE_PROPERTIES`
  // set contained dead entries (`backgroundColor`, `cornerSmoothing`,
  // etc.) that never appear on a real override entry.
  "fillPaints",
  "strokePaints",
  "strokeWeight",
  "strokeJoin",
  "strokeCap",
  "effects",
  "opacity",
  "visible",
  "cornerRadius",
  "rectangleCornerRadii",
  "rectangleTopLeftCornerRadius",
  "rectangleTopRightCornerRadius",
  "rectangleBottomRightCornerRadius",
  "rectangleBottomLeftCornerRadius",
  "rectangleCornerRadiiIndependent",
  "blendMode",
  "clipsContent",
  "frameMaskDisabled",
  "mask",
  "maskIsOutline",
  "maskType",
  // Style-id slots — the `{guid: 0xFFFFFFFF:0xFFFFFFFF}` sentinel
  // detaches a style binding; concrete style ids re-bind. The
  // applier writes the field onto the merged node. Paint/style
  // interpretation stays in the renderer's style registry path.
  "styleIdForFill",
  "styleIdForStrokeFill",
  "styleIdForText",
  "styleIdForEffect",
  "styleIdForGrid",
  // Auto-layout padding / spacing / alignment overrides. Figma
  // stores these on INSTANCE override entries whose single-guid
  // path is an unreachable ghost guid (App Store template "Search"
  // INSTANCEs in `2:2878 State=Placeholder` carry `stackPaddingRight`;
  // "Tab Bar" INSTANCE in `121:5431` carries `stackPositioning`).
  // Listing them here lets the applier project the value onto the
  // merged INSTANCE frame instead of dropping the entry.
  "stackPadding",
  "stackVerticalPadding",
  "stackHorizontalPadding",
  "stackPaddingRight",
  "stackPaddingBottom",
  "stackSpacing",
  "stackPrimaryAlignItems",
  "stackCounterAlignItems",
  "stackPrimaryAlignContent",
  "stackCounterAlignContent",
  "stackCounterSpacing",
  "stackCounterSizing",
  "stackWrap",
  "stackReverseZIndex",
  "stackChildAlignSelf",
  "stackChildPrimaryGrow",
  "stackMode",
]);

export const INSTANCE_SELF_OVERRIDE_FIELDS: ReadonlySet<keyof FigKiwiSymbolOverride> = new Set([
  // INSTANCE-only address / layout fields — these never address a
  // SYMBOL descendant. The applier handles `name`/`size`/etc. through
  // dedicated merge paths (not via `SELF_OVERRIDE_PAYLOAD_FIELDS`)
  // because they project to INSTANCE-level node properties rather
  // than slot-level paint or geometry.
  "name",
  "size",
  "proportionsConstrained",
  "stackPositioning",
  "stackPrimarySizing",
  "variableConsumptionMap",
  "parameterConsumptionMap",
  // Paint / geometry / effect fields shared with the applier (see
  // `SELF_OVERRIDE_PAYLOAD_FIELDS`). When paired with an unreachable
  // ghost-session guid, treating them as self-overrides and
  // binding them to the SYMBOL root preserves Figma's apparent
  // rendering (the SYMBOL root receives the override, not a
  // descendant). Real Figma exports of nested-component files
  // (`inherit.fig` etc., App Store Community template tab variants)
  // rely on this classification.
  ...SELF_OVERRIDE_PAYLOAD_FIELDS,
]);

/**
 * Iterate the override-payload keys that are actually defined on a
 * given entry. Yields keys typed as `keyof FigKiwiSymbolOverride`,
 * so callers consume them with the same type-safety as a struct
 * traversal — no `Record<string, unknown>` widening or `as any`.
 *
 * `guidPath` and `overriddenSymbolID` are address fields (the entry's
 * "where to" / "instance-swap target") and never carry a slot-payload
 * meaning; they are excluded from the iteration so a self-override
 * detector doesn't have to special-case them at the call site.
 */
export function* kiwiOverridePayloadKeys(
  entry: FigKiwiSymbolOverride,
): Generator<keyof FigKiwiSymbolOverride> {
  const ROUTING_KEYS: ReadonlySet<keyof FigKiwiSymbolOverride> = new Set([
    "guidPath",
    "overriddenSymbolID",
  ]);
  // Object.keys gives us the runtime field set the parser actually emitted.
  // The cast narrows the loop variable from `string` to the legal
  // payload-key type — sound because the parser only emits keys
  // declared on `FigKiwiSymbolOverridePayload`.
  for (const key of Object.keys(entry) as (keyof FigKiwiSymbolOverride)[]) {
    if (ROUTING_KEYS.has(key)) {
      continue;
    }
    if (entry[key] === undefined) {
      continue;
    }
    yield key;
  }
}

/**
 * `true` when the override addresses the INSTANCE itself (single-guid
 * path with only INSTANCE-self fields). SymbolResolver binds these
 * entries to the SYMBOL root before descendant-slot address resolution.
 */
export function isInstanceSelfOverride(entry: FigKiwiSymbolOverride): boolean {
  const guids = entry.guidPath?.guids;
  if (!guids || guids.length !== 1) {
    return false;
  }
  const keys = Array.from(kiwiOverridePayloadKeys(entry));
  return keys.length > 0 && keys.every((key) => INSTANCE_SELF_OVERRIDE_FIELDS.has(key));
}

// =============================================================================
// Symbol Resolution
// =============================================================================

// INSTANCE reference resolution
//
// Every consumer that needs "which SYMBOL does this INSTANCE point to?"
// MUST go through a SymbolResolver instance. GUID lookup is private to
// this file and reads from the Kiwi document index supplied at resolver
// construction.
// =============================================================================

/**
 * Resolved INSTANCE references.
 *
 * - `effectiveSymbol`: the SYMBOL that this INSTANCE should actually render
 *   (overriddenSymbolID takes precedence over symbolID).
 * - `allDependencyGuids`: all SYMBOL GUIDs this INSTANCE depends on
 *   (includes both symbolID and overriddenSymbolID for correct dep ordering).
 */
export type InstanceResolution = {
  readonly effectiveSymbol: ResolvedSymbolTarget | undefined;
  readonly allDependencyGuids: readonly FigGuid[];
};

export type ResolvedSymbolTarget = {
  readonly node: FigNode;
  readonly guid: FigGuid;
  readonly document: FigKiwiDocumentIndex;
};

export type SymbolResolverScope = {
  readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
};

export type SymbolResolver = {
  readonly resolveReferences: (node: FigNode, scope?: SymbolResolverScope) => InstanceResolution;
  readonly resolveInstanceTarget: (
    node: FigNode,
    overrideSymbolID?: FigGuid,
    scope?: SymbolResolverScope,
  ) => ResolvedSymbolTarget | undefined;
  readonly resolveInstance: (node: FigNode, scope?: SymbolResolverScope) => ResolvedInstanceNode;
  readonly childrenOfResolvedNode: (node: FigNode) => readonly FigNode[];
};

export type SymbolResolverInput = {
  readonly document: FigKiwiDocumentIndex;
  /**
   * Additional Kiwi document indexes that form the explicit SYMBOL
   * source set for this resolver. Callers must provide these sources
   * deliberately; renderer code must not infer or synthesize them.
   */
  readonly symbolSourceDocuments?: readonly FigKiwiDocumentIndex[];
  readonly blobs?: readonly FigBlob[];
};

type SymbolResolverDocuments = {
  readonly primary: FigKiwiDocumentIndex;
  readonly sources: readonly FigKiwiDocumentIndex[];
};

type SymbolIDPair = {
  readonly symbolID: FigGuid;
  readonly overriddenSymbolID?: FigGuid;
};

type SymbolIDSource = {
  readonly symbolData?: FigKiwiSymbolData | Record<string, unknown>;
  readonly overriddenSymbolID?: unknown;
};

function readSymbolID(symbolData: Record<string, unknown> | undefined): FigGuid | undefined {
  const value = symbolData?.symbolID;
  return isFigGuid(value) ? value : undefined;
}

function readOverriddenSymbolID(nodeData: SymbolIDSource): FigGuid | undefined {
  const value = nodeData.overriddenSymbolID;
  return isFigGuid(value) ? value : undefined;
}

function extractSymbolIDPair(nodeData: SymbolIDSource): SymbolIDPair | undefined {
  const symbolData = nodeData.symbolData;
  const symbolID = readSymbolID(symbolData);
  if (symbolID === undefined) { return undefined; }
  const overriddenSymbolID = readOverriddenSymbolID(nodeData);
  if (overriddenSymbolID !== undefined) {
    return { symbolID, overriddenSymbolID };
  }
  return { symbolID };
}

function resolveSymbolTarget(
  symbolID: FigGuid,
  documents: SymbolResolverDocuments,
): ResolvedSymbolTarget | undefined {
  const primary = resolvePrimarySymbolTarget(symbolID, documents.primary);
  if (primary !== undefined) {
    return primary;
  }
  const matches: ResolvedSymbolTarget[] = [];
  for (const document of documents.sources) {
    const exact = findNodeByGuid(document, symbolID);
    if (exact === undefined) {
      continue;
    }
    if (getNodeType(exact) !== "SYMBOL") {
      continue;
    }
    matches.push({ node: exact, guid: exact.guid, document });
  }
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0];
  }
  throw new Error(`SymbolResolver: SYMBOL ${guidToString(symbolID)} is defined by multiple Kiwi document sources`);
}

function resolvePrimarySymbolTarget(
  symbolID: FigGuid,
  document: FigKiwiDocumentIndex,
): ResolvedSymbolTarget | undefined {
  const primary = findNodeByGuid(document, symbolID);
  if (primary === undefined) {
    return undefined;
  }
  if (getNodeType(primary) !== "SYMBOL") {
    throw new Error(`SymbolResolver: symbolID ${guidToString(symbolID)} targets ${getNodeType(primary)} in the primary Kiwi document`);
  }
  return { node: primary, guid: primary.guid, document };
}

const EMPTY_RESOLVED_CHILDREN: readonly FigNode[] = [];

function childrenOfResolvedNode(node: FigNode): readonly FigNode[] {
  const children = node.children;
  if (children === undefined || children.length === 0) {
    return EMPTY_RESOLVED_CHILDREN;
  }
  for (const child of children) {
    if (child === null || child === undefined) {
      throw new Error(`SymbolResolver: resolved node ${guidToString(node.guid)} contains an empty child slot`);
    }
  }
  return children as readonly FigNode[];
}

/**
 * Create the document-bound SymbolResolver. This is the only public
 * entry for INSTANCE target selection, override address binding, and
 * resolved INSTANCE child traversal.
 */
export function createSymbolResolver(input: SymbolResolverInput): SymbolResolver {
  const document = input.document;
  const blobs = input.blobs;
  const documents: SymbolResolverDocuments = {
    primary: document,
    sources: input.symbolSourceDocuments ?? [],
  };
  const resolveInstanceTarget = (
    node: FigNode,
    overrideSymbolID?: FigGuid,
    scope?: SymbolResolverScope,
  ): ResolvedSymbolTarget | undefined => {
    const pair = extractSymbolIDPair(node);
    if (!pair) { return undefined; }
    if (overrideSymbolID === undefined) {
      return resolveReferencesForNode(node, documents, scope?.variableModeBySetMap).effectiveSymbol;
    }
    const targetSymbolID = overrideSymbolID ?? pair.overriddenSymbolID ?? pair.symbolID;
    return resolveSymbolTarget(targetSymbolID, documents);
  };
  const resolveReferences = (node: FigNode, scope?: SymbolResolverScope): InstanceResolution => (
    resolveReferencesForNode(node, documents, scope?.variableModeBySetMap)
  );
  const resolveInstance = (node: FigNode, scope?: SymbolResolverScope): ResolvedInstanceNode => (
    resolveInstanceNode(node, {
      document,
      documents,
      blobs,
      variableModeBySetMap: scope?.variableModeBySetMap,
    })
  );

  return {
    resolveReferences,
    resolveInstanceTarget,
    resolveInstance,
    childrenOfResolvedNode,
  };
}

/**
 * Resolve an INSTANCE node's SYMBOL references inside the SymbolResolver unit.
 *
 * Resolution order:
 *   1. `symbolID` identifies the static reference.
 *   2. `overriddenSymbolID` replaces that reference when the author
 *      swaps the INSTANCE target.
 *   3. RESOLVE_VARIANT evaluates against the active reference selected
 *      by step 2, so an author swap can still keep its selected
 *      variant property while variable mode changes another property.
 *
 * `RESOLVE_VARIANT` fires only when the active reference's parent is a
 * Variant Set (a FRAME with `isStateGroup` + VARIANT-typed
 * `componentPropDefs`). The canonical schema has no COMPONENT_SET
 * NodeType — see `docs/refactor/component-type-cleanup.md`. Most
 * fixtures have all properties resolving to library-only aliases;
 * those aliases are not local Kiwi values, so SymbolResolver keeps the
 * active reference instead of deriving a partial variant match.
 */
function resolveReferencesForNode(
  node: FigNode,
  documents: SymbolResolverDocuments,
  inheritedVariableModeBySetMap?: FigKiwiVariableModeBySetMap,
): InstanceResolution {
  const variableModeBySetMap = mergeVariableModeBySetMap(inheritedVariableModeBySetMap, node.variableModeBySetMap);
  const referenceNode = resolveReferenceSelectionNode(node);
  const pair = extractSymbolIDPair(referenceNode);
  if (!pair) { return { effectiveSymbol: undefined, allDependencyGuids: [] }; }

  const allDeps: FigGuid[] = [];

  const primaryResolved = resolveSymbolTarget(pair.symbolID, documents);
  if (primaryResolved) { allDeps.push(primaryResolved.guid); }

  const overrideResolved = resolveOverriddenSymbolTarget(pair.overriddenSymbolID, documents);
  if (overrideResolved) { allDeps.push(overrideResolved.guid); }

  const variantResolved = resolveVariantSymbolTarget(
    referenceNode,
    primaryResolved,
    overrideResolved,
    documents,
    variableModeBySetMap,
  );
  if (variantResolved !== undefined) {
    allDeps.push(variantResolved.guid);
  }

  return {
    effectiveSymbol: variantResolved ?? overrideResolved ?? primaryResolved,
    allDependencyGuids: allDeps,
  };
}

function resolveReferenceSelectionNode(node: FigNode): FigNode {
  const selfReferenceOverrides = (node.symbolData?.symbolOverrides ?? []).filter(symbolOverrideCarriesReferenceSelection);
  if (selfReferenceOverrides.length === 0) {
    return node;
  }
  return selfReferenceOverrides.reduce<MutableFigNode>((current, override) => {
    const next: MutableFigNode = { ...current };
    if (override.variableConsumptionMap !== undefined) {
      next.variableConsumptionMap = override.variableConsumptionMap;
    }
    if (override.parameterConsumptionMap !== undefined) {
      next.parameterConsumptionMap = override.parameterConsumptionMap;
    }
    return next;
  }, { ...node });
}

function symbolOverrideCarriesReferenceSelection(override: FigKiwiSymbolOverride): boolean {
  if (!isInstanceSelfOverride(override)) {
    return false;
  }
  return override.variableConsumptionMap !== undefined || override.parameterConsumptionMap !== undefined;
}

function resolveOverriddenSymbolTarget(
  overriddenSymbolID: FigGuid | undefined,
  documents: SymbolResolverDocuments,
): ResolvedSymbolTarget | undefined {
  if (overriddenSymbolID === undefined) {
    return undefined;
  }
  return resolveSymbolTarget(overriddenSymbolID, documents);
}

function resolveVariantSymbolTarget(
  node: FigNode,
  primaryResolved: ResolvedSymbolTarget | undefined,
  overrideResolved: ResolvedSymbolTarget | undefined,
  documents: SymbolResolverDocuments,
  variableModeBySetMap: FigKiwiVariableModeBySetMap | undefined,
): ResolvedSymbolTarget | undefined {
  const activeReference = overrideResolved ?? primaryResolved;
  if (activeReference === undefined) {
    return undefined;
  }
  const document = activeReference.document;
  const variantOutcome = resolveVariantOverride(node, activeReference.node, {
    document,
    childrenOf: document.childrenOf,
    variableModeBySetMap,
  });
  if (variantOutcome.resolvedSymbolID === undefined) {
    return undefined;
  }
  return resolveSymbolTarget(variantOutcome.resolvedSymbolID, documents);
}

// =============================================================================
// Node Cloning
// =============================================================================

/**
 * Deep clone a FigNode and its children
 */
type KiwiChildrenOf = (node: FigNode) => readonly FigNode[];

function deepCloneNode(node: FigNode, childrenOf: KiwiChildrenOf): MutableFigNode {
  const children = childrenOf(node);
  if (children.length === 0) {
    return { ...node };
  }
  return {
    ...node,
    children: children.map((child) => deepCloneNode(child, childrenOf)),
  };
}


/**
 * A component property reference on a node (e.g., TEXT_DATA)
 */
type ComponentPropRef = {
  readonly defID: FigGuid;
  readonly componentPropNodeField: { readonly value: number; readonly name: string };
};

/**
 * Options for cloning symbol children
 */
export type CloneSymbolChildrenOptions = {
  readonly childrenOf: KiwiChildrenOf;
  readonly symbolOverrides?: readonly FigKiwiSymbolOverride[];
  readonly derivedSymbolData?: FigDerivedSymbolData;
  /** Component property assignments from the INSTANCE node and its overrides */
  readonly componentPropAssignments?: readonly FigComponentPropAssignment[];
};

/**
 * Clone SYMBOL children for INSTANCE rendering
 *
 * @param symbolNode - The SYMBOL node to clone children from
 * @param options - Optional overrides and derived data to apply
 * @returns Cloned children with overrides applied
 */
export function cloneSymbolChildren(symbolNode: FigNode, options: CloneSymbolChildrenOptions): readonly FigNode[] {
  const children = options.childrenOf(symbolNode);
  if (children.length === 0) {
    return [];
  }

  // Deep clone children
  const cloned = children.map((child) => deepCloneNode(child, options.childrenOf));
  const childSourceSymbolOverrides = excludeSymbolRootAddressedOverrides(options?.symbolOverrides, symbolNode.guid);
  const childSourceDerivedData = excludeSymbolRootAddressedOverrides(options?.derivedSymbolData, symbolNode.guid);
  const materializedSlotResolution = resolveMaterializedOverrideSlotAddresses(
    cloned,
    childSourceSymbolOverrides,
    childSourceDerivedData,
  );
  const symbolOverrides = bindMaterializedOverridesToResolvedSlots(cloned, materializedSlotResolution, childSourceSymbolOverrides);
  const derivedSymbolData = bindMaterializedOverridesToResolvedSlots(cloned, materializedSlotResolution, childSourceDerivedData);

  // Apply symbol overrides (property overrides)
  if (symbolOverrides && symbolOverrides.length > 0) {
    applyOverrides(cloned, symbolOverrides, REQUIRE_MATERIALIZED_TARGET_POLICY);
  }
  const materializedOverrideTargetKeys = mergeMaterializedOverrideTargetKeys(
    collectMaterializedOverrideTargetKeys(cloned, symbolOverrides),
    materializedSlotResolution,
  );

  // Resolve component property assignments (text overrides — deletes stale derivedTextData)
  const textOverrideGuids = new Set<string>();
  if (options?.componentPropAssignments && options.componentPropAssignments.length > 0) {
    applyComponentPropAssignments(cloned, options.componentPropAssignments, textOverrideGuids);
  }

  // Apply derived symbol data LAST (provides fresh sizes, transforms, AND derivedTextData
  // with correct glyph paths for overridden text).
  //
  // Figma bakes the overridden text's glyph paths into derivedSymbolData at
  // export time — so the derivedTextData here corresponds to the CPA-overridden
  // characters, not the SYMBOL's default text. After CPA clears the SYMBOL's
  // stale derivedTextData, the DSD re-adds the correct pre-rasterized glyphs.
  if (derivedSymbolData && derivedSymbolData.length > 0) {
    applyOverrides(cloned, derivedSymbolData, {
      kind: "require-target-or-materialized-parent",
      materializedTargetKeys: materializedOverrideTargetKeys,
    });
  }

  // Clean up stale derivedTextData:
  //  1. CPA-overridden TEXT nodes whose glyphs weren't re-supplied by DSD.
  //  2. Any TEXT node whose derivedTextData glyph count grossly mismatches
  //     its final characters.
  cleanupStaleDerivedTextData(cloned, textOverrideGuids, derivedSymbolData);

  return cloned;
}

/**
 * Collect all componentPropAssignments from an INSTANCE node and its overrides.
 *
 * Sources (merged in order):
 * 1. INSTANCE node's own `componentPropAssignments`
 * 2. `componentPropAssignments` found inside `symbolOverrides` entries
 *
 * Scope: `componentPropAssignments` only override *non-VARIANT*
 * propDefs (TEXT, BOOL, COLOR, INSTANCE_SWAP, NUMBER, IMAGE, SLOT).
 * Variant switching does NOT flow through this collector — it
 * rewrites `symbolData.symbolID` to a sibling variant SYMBOL's GUID
 * directly. See `docs/refactor/component-type-cleanup.md`
 * (INSTANCE referencing a variant).
 */
export function collectComponentPropAssignments(
  instanceData: FigNode,
): readonly FigComponentPropAssignment[] {
  const result: FigComponentPropAssignment[] = [];

  // Instance-level assignments
  const instanceAssign = instanceData.componentPropAssignments as readonly FigComponentPropAssignment[] | undefined;
  if (instanceAssign) {
    result.push(...instanceAssign);
  }

  // Assignments from symbolOverrides
  const overrides = instanceData.symbolData?.symbolOverrides;
  if (overrides) {
    for (const ov of overrides) {
      // FigKiwiSymbolOverride carries arbitrary node properties via index signature
      const ovAssign = ov.componentPropAssignments as
        | readonly FigComponentPropAssignment[]
        | undefined;
      if (ovAssign) {
        result.push(...ovAssign);
      }
    }
  }

  return result;
}

/**
 * Apply component property assignments to cloned children.
 *
 * Visits cloned SYMBOL nodes looking for `componentPropRefs` that reference
 * a matching `defID`. When found, applies the assignment value:
 * - TEXT_DATA: sets `textData` and `characters` on the TEXT node
 *
 * @param textOverrideGuids - When provided, collects GUID strings of nodes
 *   whose text was overridden (derivedTextData deleted). Used by
 *   cleanupStaleDerivedTextData() to re-delete stale data after
 *   derivedSymbolData application.
 */
function applyComponentPropAssignments(
  nodes: MutableFigNode[],
  assignments: readonly FigComponentPropAssignment[],
  textOverrideGuids?: Set<string>,
): void {
  if (assignments.length === 0) {return;}

  // Build defID → assignment map
  const assignMap = new Map<string, FigComponentPropAssignment>();
  for (const a of assignments) {
    assignMap.set(guidToString(a.defID), a);
  }

  visitMutableNodes(nodes, (node) => {
    const propRefs = node.componentPropRefs as readonly ComponentPropRef[] | undefined;
    if (!propRefs) { return; }
    for (const ref of propRefs) {
      const defKey = guidToString(ref.defID);
      const assignment = assignMap.get(defKey);
      applyComponentPropRef(node, ref, assignment, textOverrideGuids);
    }
  });
}

function applyComponentPropRef(
  node: MutableFigNode,
  ref: ComponentPropRef,
  assignment: FigComponentPropAssignment | undefined,
  textOverrideGuids: Set<string> | undefined,
): void {
  const field = ref.componentPropNodeField?.name;
  if (field === "TEXT_DATA") {
    applyTextDataAssignment(node, assignment, textOverrideGuids);
    return;
  }
  if (field === "VISIBLE") {
    applyVisibleAssignment(node, assignment);
    return;
  }
  if (field === "OVERRIDDEN_SYMBOL_ID") {
    applyInstanceSwapAssignment(node, assignment);
  }
}

function applyTextDataAssignment(
  node: MutableFigNode,
  assignment: FigComponentPropAssignment | undefined,
  textOverrideGuids: Set<string> | undefined,
): void {
  const textValue = assignment?.value.textValue;
  if (textValue === undefined) {
    return;
  }
  const existingTextData = node.textData;
  const existingChars = existingTextData?.characters ?? node.characters ?? "";
  const isNoOp = existingChars === textValue.characters;
  node.textData = resolveAssignedTextData(existingTextData, textValue);
  node.characters = textValue.characters;
  if (isNoOp) {
    return;
  }
  discardDerivedTextVisualPayload(node);
  if (textOverrideGuids === undefined || node.guid === undefined) {
    return;
  }
  textOverrideGuids.add(guidToString(node.guid));
}

function resolveAssignedTextData(
  existingTextData: FigKiwiTextData | undefined,
  textValue: NonNullable<FigComponentPropAssignment["value"]["textValue"]>,
): FigKiwiTextData {
  const next = writeFigKiwiTextDataCharacters(existingTextData, textValue.characters);
  if (textValue.lines === undefined) {
    return next;
  }
  return { ...next, lines: textValue.lines };
}

function applyVisibleAssignment(
  node: MutableFigNode,
  assignment: FigComponentPropAssignment | undefined,
): void {
  const boolVal = assignment?.value.boolValue;
  if (typeof boolVal !== "boolean") {
    return;
  }
  node.visible = boolVal;
}

function applyInstanceSwapAssignment(
  node: MutableFigNode,
  assignment: FigComponentPropAssignment | undefined,
): void {
  const guidVal = assignment?.value.guidValue as FigGuid | undefined;
  if (guidVal === undefined) {
    return;
  }
  node.overriddenSymbolID = guidVal;
}

// =============================================================================
// Stale derivedTextData Cleanup
// =============================================================================

/**
 * Remove stale derivedTextData from nodes whose text was overridden by CPA.
 *
 * After applyComponentPropAssignments deletes derivedTextData (because the
 * glyph paths match the ORIGINAL text, not the CPA-overridden text),
 * applyOverrides with derivedSymbolData may blindly re-add stale
 * derivedTextData. This function visits cloned SYMBOL nodes and re-deletes
 * derivedTextData on any node whose GUID was recorded as text-overridden.
 */
function cleanupStaleDerivedTextData(
  nodes: MutableFigNode[],
  cpaGuids: Set<string>,
  derivedSymbolData: readonly FigKiwiSymbolOverride[] | undefined,
): void {
  // Collect depth-1 override GUIDs that set `derivedTextData` — these are
  // the overrides that carry fresh, post-CPA glyph paths. Any CPA-targeted
  // node whose GUID is ALSO in this set should keep its derivedTextData.
  const freshDerivedGuids = new Set<string>();
  if (derivedSymbolData) {
    for (const entry of derivedSymbolData) {
      const guids = entry.guidPath?.guids;
      if (!guids || guids.length !== 1) {
        continue;
      }
      if (entry.derivedTextData !== undefined) {
        freshDerivedGuids.add(guidToString(guids[0]));
      }
    }
  }

  function countCodePoints(s: string): number {
    // Spread iterates by Unicode codepoints (not UTF-16 units), so emoji and
    // SF Symbols (surrogate pair codepoints) count as 1 each.
    return [...s].length;
  }

  function derivedMatchesCharacters(
    dtd: FigDerivedTextData | undefined,
    characters: string | undefined,
  ): boolean {
    if (!dtd || typeof characters !== "string") {
      return false;
    }
    const cpCount = countCodePoints(characters);
    if (derivedLinesMatch(dtd.derivedLines, cpCount)) {
      return true;
    }
    const glyphs = dtd.glyphs;
    return Array.isArray(glyphs) && glyphs.length === cpCount;
  }

  function derivedLinesMatch(
    lines: FigDerivedTextData["derivedLines"],
    cpCount: number,
  ): boolean {
    if (!Array.isArray(lines)) {
      return false;
    }
    const sum = lines.reduce(
      (acc, l) => acc + (typeof l.characters === "string" ? countCodePoints(l.characters) : 0),
      0,
    );
    return sum === cpCount;
  }

  /**
   * Whether Figma's derivedTextData indicates runtime truncation was applied.
   * When truncated, glyph count != source character count is EXPECTED —
   * keeping derivedTextData lets the renderer draw Figma's exact truncated
   * output instead of re-laying out the full (overflowing) characters.
   */
  function isTruncated(dtd: FigDerivedTextData | undefined): boolean {
    return typeof dtd?.truncationStartIndex === "number" && dtd.truncationStartIndex >= 0;
  }

  // Detect text that requires Figma's pre-rasterized glyphs because the
  // codepoints live in the Unicode Private-Use Area (e.g. Apple SF Symbols).
  // For such text, the `characters` string cannot be rendered from a normal
  // font — we must preserve derivedTextData.
  function containsPrivateUseCodepoint(s: string): boolean {
    for (const ch of s) {
      const cp = ch.codePointAt(0) ?? 0;
      // BMP PUA: U+E000–U+F8FF
      // Supplementary PUA-A: U+F0000–U+FFFFD
      // Supplementary PUA-B: U+100000–U+10FFFD
      if ((cp >= 0xE000 && cp <= 0xF8FF) || (cp >= 0xF0000 && cp <= 0x10FFFD)) {
        return true;
      }
    }
    return false;
  }

  visitMutableNodes(nodes, (node) => {
    if (!node.guid || !node.derivedTextData) { return; }
    if (!derivedTextDataHasVisualPayload(node.derivedTextData)) { return; }
    const key = guidToString(node.guid);
    const cpaTarget = cpaGuids.has(key);
    const hasFreshDerived = freshDerivedGuids.has(key);
    const chars = node.characters ?? node.textData?.characters;
    const matches = derivedMatchesCharacters(node.derivedTextData, chars);
    const hasPUA = typeof chars === "string" && containsPrivateUseCodepoint(chars);
    const truncated = isTruncated(node.derivedTextData);

    // Drop derivedTextData when:
    //  1. The glyph data grossly mismatches the final characters (codepoint
    //     count differs) AND Figma did not mark the text as runtime-
    //     truncated. A truncation mismatch is expected — Figma's glyphs
    //     represent the cut-and-ellipsized output, not the source string.
    //  2. CPA overrode the text and the text does NOT contain private-use
    //     codepoints. Even if glyph count matches, Figma's pre-computed
    //     glyphs may correspond to a wrong sibling (e.g. same-length name).
    //     Fall back to text rendering which re-layouts with the final
    //     characters. Private-use codepoints (SF Symbols) and truncated
    //     text must keep the derivedTextData since no font can reconstruct
    //     them (PUA) or reproduce the exact truncation (ellipsis).
    const mismatchByLength = typeof chars === "string" && !matches && !truncated && !hasFreshDerived;
    const riskyCpaKeep = cpaTarget && !hasFreshDerived && matches && !hasPUA && !truncated;
    if (mismatchByLength || riskyCpaKeep) {
      discardDerivedTextVisualPayload(node);
    }
  });
}

function discardDerivedTextVisualPayload(node: MutableFigNode): void {
  const metricsOnly = derivedTextDataWithoutVisualPayload(node.derivedTextData);
  if (metricsOnly === undefined) {
    delete node.derivedTextData;
    return;
  }
  node.derivedTextData = metricsOnly;
}

// =============================================================================
// Override Application
// =============================================================================

/**
 * View a mutable FigNode's children as `MutableFigNode[]`.
 *
 * `MutableFigNode = -readonly { … }` lifts the outer per-property
 * `readonly` modifier but the array element type stays
 * `readonly FigNode[]`. The clones we work with were produced by
 * `deepCloneNode` and are safe to mutate; this function centralises the
 * single structural assertion required to view them as such, so
 * `applyOverrides` and friends don't sprinkle `as MutableFigNode[]`
 * casts at every recursion site.
 */
function mutableChildren(node: MutableFigNode): MutableFigNode[] {
  const cs = node.children;
  if (!cs) {
    return [];
  }
  // The runtime invariant — these `cs` entries were deep-cloned by
  // `deepCloneNode` and are mutable in practice — is enforced by the
  // pipeline's caller-side discipline, not the type system. The cast
  // is the single bridge from "outer-mutable but element-readonly" to
  // "fully mutable element-array" that the resolver loop actually
  // needs to write through.
  return cs as MutableFigNode[];
}

function visitMutableNodes(
  nodes: readonly MutableFigNode[],
  visit: (node: MutableFigNode) => void,
): void {
  for (const node of nodes) {
    visit(node);
    visitMutableNodes(mutableChildren(node), visit);
  }
}

/**
 * Apply a single Kiwi-shape override's payload onto a mutable FigNode.
 *
 * Iterates the override's payload keys via `kiwiOverridePayloadKeys`
 * (the SoT function for "which Kiwi fields are present and not address
 * fields"). The two field-application patterns are:
 *
 *   - `componentPropAssignments`: merge by `defID` (incoming wins per
 *     defID, otherwise existing entries are preserved).
 *   - every other key: overwrite the node's slot wholesale.
 *
 * Each `node[key] = override[key]` assignment is statically typed
 * because both sides resolve through `keyof FigKiwiSymbolOverride`,
 * which `keyof MutableFigNode` is a superset of (the override's payload
 * keys are exactly the FigNode fields that overrides may target).
 */
function applyKiwiOverrideToNode(node: MutableFigNode, override: FigKiwiSymbolOverride): void {
  applyOverriddenSymbolIDOverride(node, override);
  applyDerivedTextScaleForSizeOverride(node, override);
  // The kiwi→FigNode field-name correspondence: `FigKiwiSymbolOverridePayload`
  // is a strict subset of FigNode's override-eligible fields, so every
  // payload key from `kiwiOverridePayloadKeys` (which already filters
  // out address fields and undefined values) names a slot on the node
  // with an assignable value type. TypeScript cannot prove
  // that generically, so the single Record-of-unknown assertion below
  // is the SoT for that structural correspondence.
  const nodeRecord = node as Record<string, unknown>;
  for (const key of kiwiOverridePayloadKeys(override)) {
    if (key === "componentPropAssignments") {
      applyComponentPropAssignmentOverride(node, override.componentPropAssignments);
      continue;
    }
    nodeRecord[key] = override[key];
  }
  alignDerivedTextScaleAfterSizeOverride(node, override);
}

function applyDerivedTextScaleForSizeOverride(
  node: MutableFigNode,
  override: FigKiwiSymbolOverride,
): void {
  const nextSize = override.size;
  if (nextSize === undefined || override.derivedTextData !== undefined || getNodeType(node) !== "TEXT") {
    return;
  }
  const currentSize = node.size;
  const scale = resolveUniformScale(currentSize, nextSize);
  if (scale === undefined || scale === 1) {
    return;
  }
  const derivedTextData = node.derivedTextData;
  if (derivedTextData !== undefined) {
    node.derivedTextData = scaleDerivedTextData(derivedTextData, scale, nextSize);
  }
  if (node.textData !== undefined) {
    node.textData = scaleTextData(node.textData, scale);
  }
  scaleFlatTextFields(node, scale);
}

function alignDerivedTextScaleAfterSizeOverride(
  node: MutableFigNode,
  override: FigKiwiSymbolOverride,
): void {
  if (override.size === undefined || override.derivedTextData !== undefined || getNodeType(node) !== "TEXT") {
    return;
  }
  const derivedTextData = node.derivedTextData;
  if (derivedTextData === undefined) {
    return;
  }
  const layoutSize = derivedTextData.layoutSize;
  const nodeSize = node.size;
  if (layoutSize === undefined || nodeSize === undefined) {
    return;
  }
  const scale = resolveUniformScale(layoutSize, nodeSize);
  if (scale === undefined || scale === 1) {
    return;
  }
  node.derivedTextData = scaleDerivedTextData(derivedTextData, scale, nodeSize);
  if (node.textData !== undefined) {
    node.textData = scaleTextData(node.textData, scale);
  }
  scaleFlatTextFields(node, scale);
}

function resolveUniformScale(
  currentSize: FigNode["size"],
  nextSize: NonNullable<FigKiwiSymbolOverride["size"]>,
): number | undefined {
  if (currentSize === undefined || currentSize.x <= 0 || currentSize.y <= 0) {
    return undefined;
  }
  const scaleX = nextSize.x / currentSize.x;
  const scaleY = nextSize.y / currentSize.y;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return undefined;
  }
  if (Math.abs(scaleX - scaleY) > 1e-3) {
    return undefined;
  }
  return (scaleX + scaleY) / 2;
}

function scaleDerivedTextData(
  data: FigDerivedTextData,
  scale: number,
  layoutSize: NonNullable<FigKiwiSymbolOverride["size"]>,
): FigDerivedTextData {
  return {
    ...data,
    layoutSize,
    baselines: data.baselines?.map((baseline) => ({
      ...baseline,
      position: scaleVector(baseline.position, scale),
      width: baseline.width * scale,
      lineY: baseline.lineY * scale,
      lineHeight: baseline.lineHeight * scale,
      lineAscent: scaleOptionalDerivedTextMetric(baseline.lineAscent, scale),
    })),
    glyphs: data.glyphs?.map((glyph) => ({
      ...glyph,
      position: scaleVector(glyph.position, scale),
      fontSize: glyph.fontSize * scale,
      advance: glyph.advance * scale,
    })),
    decorations: data.decorations?.map((decoration) => ({
      ...decoration,
      rects: decoration.rects.map((rect) => ({
        x: rect.x * scale,
        y: rect.y * scale,
        w: rect.w * scale,
        h: rect.h * scale,
      })),
    })),
    derivedLines: data.derivedLines?.map((line) => ({
      ...line,
      baselinePosition: line.baselinePosition === undefined ? undefined : scaleVector(line.baselinePosition, scale),
      width: line.width === undefined ? undefined : line.width * scale,
    })),
    truncatedHeight: data.truncatedHeight === undefined ? undefined : data.truncatedHeight * scale,
  };
}

function scaleOptionalDerivedTextMetric(value: number | undefined, scale: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value * scale;
}

function scaleVector<T extends { readonly x: number; readonly y: number }>(
  value: T,
  scale: number,
): T {
  return {
    ...value,
    x: value.x * scale,
    y: value.y * scale,
  };
}

function scaleTextData(
  textData: NonNullable<FigNode["textData"]>,
  scale: number,
): NonNullable<FigNode["textData"]> {
  return {
    ...textData,
    fontSize: scaleOptionalNumber(textData.fontSize, scale),
    lineHeight: scaleValueWithUnits(textData.lineHeight, scale),
    letterSpacing: scaleValueWithUnits(textData.letterSpacing, scale),
  };
}

function scaleFlatTextFields(node: MutableFigNode, scale: number): void {
  node.fontSize = scaleOptionalNumber(node.fontSize, scale);
  node.lineHeight = scaleValueWithUnits(node.lineHeight, scale);
  node.letterSpacing = scaleValueWithUnits(node.letterSpacing, scale);
}

function scaleOptionalNumber(value: number | undefined, scale: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value * scale;
}

function scaleValueWithUnits(
  value: FigValueWithUnits | undefined,
  scale: number,
): FigValueWithUnits | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.units?.name !== "PIXELS") {
    return value;
  }
  return { ...value, value: value.value * scale };
}

function applyOverriddenSymbolIDOverride(node: MutableFigNode, override: FigKiwiSymbolOverride): void {
  const targetSymbolID = override.overriddenSymbolID;
  if (targetSymbolID === undefined) {
    return;
  }
  const nodeType = getNodeType(node);
  if (nodeType !== "INSTANCE") {
    throw new Error(`SymbolResolver: overriddenSymbolID override targets ${nodeType} node ${guidToString(node.guid)}`);
  }
  node.overriddenSymbolID = targetSymbolID;
}

function applyComponentPropAssignmentOverride(
  node: MutableFigNode,
  incoming: readonly FigComponentPropAssignment[] | undefined,
): void {
  if (incoming === undefined) {
    return;
  }
  const existing = node.componentPropAssignments;
  if (existing === undefined || existing.length === 0) {
    node.componentPropAssignments = incoming;
    return;
  }
  const incomingKeys = new Set(incoming.map((a) => guidToString(a.defID)));
  const merged = existing.filter((a) => !incomingKeys.has(guidToString(a.defID)));
  node.componentPropAssignments = [...merged, ...incoming];
}

/**
 * Apply symbol overrides to cloned nodes.
 *
 * Each override carries a `guidPath` that names a slot relative to the
 * cloned SYMBOL root. The algorithm walks the path one guid at a time:
 *
 *   1. If the path has length 1, the matching descendant is the target
 *      and the override's payload is applied via
 *      `applyKiwiOverrideToNode`. Direct entries with the same target
 *      merge (later entries overwrite earlier ones per field).
 *
 *   2. If the path is longer, the walker descends into the child
 *      identified by `guidPath[0]`:
 *       - When that child is an INSTANCE, the path-tail is appended to
 *         its `derivedSymbolData` slot; the inner `resolveInstance`
 *         pass picks it up later and re-runs the same walker against
 *         the instance's own SYMBOL descendants.
 *       - When that child is a non-INSTANCE container (FRAME, GROUP,
 *         …), the walker recurses into its `children` with the
 *         path-tail still untouched; descendant lookups happen step by
 *         step against the local children's own GUIDs, so no second
 *         path rewrite is needed.
 *
 * This is the same forwarding semantic used by render-time INSTANCE
 * expansion: carry a payload to the INSTANCE that owns the final slot.
 * Kiwi children are walked step by step, so each lookup stays in the
 * local child namespace and no second document path is introduced.
 */
function applyOverrides(
  nodes: MutableFigNode[],
  overrides: readonly FigKiwiSymbolOverride[],
  targetPolicy: OverrideTargetPolicy = REQUIRE_TARGET_POLICY,
): void {
  for (const override of overrides) {
    applyOverrideAtPath(nodes, override, targetPolicy);
  }
}

type OverrideTargetPolicy =
  | { readonly kind: "require-target" }
  | { readonly kind: "require-materialized-target" }
  | { readonly kind: "require-target-or-materialized-parent"; readonly materializedTargetKeys: ReadonlySet<string> };

const REQUIRE_TARGET_POLICY: OverrideTargetPolicy = { kind: "require-target" };
const REQUIRE_MATERIALIZED_TARGET_POLICY: OverrideTargetPolicy = { kind: "require-materialized-target" };

/**
 * Walk `override.guidPath` through `nodes`, applying the override at
 * its target slot. See `applyOverrides` for the full algorithm.
 *
 * Throws when any step fails to find its target. A misaddressed
 * override means SymbolResolver could not bind the address to a
 * SYMBOL slot, or the source Kiwi document is inconsistent.
 */
function applyOverrideAtPath(
  nodes: readonly MutableFigNode[],
  override: FigKiwiSymbolOverride,
  targetPolicy: OverrideTargetPolicy = REQUIRE_TARGET_POLICY,
): void {
  const guids = override.guidPath?.guids;
  if (!guids || guids.length === 0) {
    throw new Error("SymbolResolver: override entry is missing guidPath");
  }
  // Locate the descendant whose guid equals `guids[0]` anywhere in
  // the cloned SYMBOL descendants. Kiwi-side overrides may address slots at any depth,
  // not just depth 1. Subsequent guids descend into that
  // descendant's immediate children one step at a time.
  const targetGuid = guids[0];
  const child = findDescendantByGuid(nodes, targetGuid);
  if (!child) {
    handleMissingOverrideTarget(nodes, override, targetPolicy, targetGuid);
    return;
  }
  if (guids.length === 1) {
    applyDirectOverride(child, override);
    return;
  }
  // Multi-guid: forward the tail to the INSTANCE that owns it.
  const tail: FigKiwiSymbolOverride = {
    ...override,
    guidPath: { guids: guids.slice(1) },
  };
  if (getNodeType(child) === "INSTANCE") {
    // INSTANCE boundary: the inner `resolveInstance` will run this
    // walker again against its own SYMBOL descendants. Append the
    // tail onto its DSD so the inner pass picks it up.
    child.derivedSymbolData = [...(child.derivedSymbolData ?? []), tail];
    return;
  }
  // Non-INSTANCE container: descend with the tail untouched.
  applyOverrideAtPath(mutableChildren(child), tail, targetPolicy);
}

function handleMissingOverrideTarget(
  nodes: readonly MutableFigNode[],
  override: FigKiwiSymbolOverride,
  targetPolicy: OverrideTargetPolicy,
  targetGuid: FigGuid,
): void {
  if (isMaterializedParentTargetAllowed(targetGuid, targetPolicy)) {
    return;
  }
  if (isMaterializedOverrideTargetAllowed(nodes, override, targetPolicy)) {
    return;
  }
  if (isOrphanedDerivedSymbolEntry(targetPolicy)) {
    // Exported .fig files routinely carry derivedSymbolData entries
    // whose leading GUID addresses a slot from an external component
    // library — Figma keeps these as a cache and silently drops them
    // when the slot isn't present in the file's own SYMBOL. Matches
    // `isDerivedDataApplicable` in `constraints.ts`, which documents
    // the same "orphaned entries" tolerance for layout resolution.
    return;
  }
  throw new Error(`SymbolResolver: override target ${guidToString(targetGuid)} is not present in the cloned SYMBOL descendants`);
}

function isOrphanedDerivedSymbolEntry(targetPolicy: OverrideTargetPolicy): boolean {
  return targetPolicy.kind === "require-target-or-materialized-parent";
}

function isMaterializedOverrideTargetAllowed(
  nodes: readonly MutableFigNode[],
  override: FigKiwiSymbolOverride,
  targetPolicy: OverrideTargetPolicy,
): boolean {
  if (targetPolicy.kind !== "require-materialized-target") {
    return false;
  }
  return isOverrideAlreadyMaterialized(nodes, override);
}

function isMaterializedParentTargetAllowed(
  targetGuid: FigGuid,
  targetPolicy: OverrideTargetPolicy,
): boolean {
  if (targetPolicy.kind !== "require-target-or-materialized-parent") {
    return false;
  }
  return targetPolicy.materializedTargetKeys.has(guidToString(targetGuid));
}

function collectMaterializedOverrideTargetKeys(
  nodes: readonly MutableFigNode[],
  overrides: readonly FigKiwiSymbolOverride[] | undefined,
): ReadonlySet<string> {
  if (overrides === undefined || overrides.length === 0) {
    return new Set();
  }
  const keys = new Set<string>();
  for (const override of overrides) {
    const targetGuid = override.guidPath?.guids?.[0];
    if (targetGuid === undefined) {
      continue;
    }
    if (findDescendantByGuid(nodes, targetGuid) !== undefined) {
      continue;
    }
    if (!isOverrideAlreadyMaterialized(nodes, override)) {
      continue;
    }
    keys.add(guidToString(targetGuid));
  }
  return keys;
}

function mergeMaterializedOverrideTargetKeys(
  keys: ReadonlySet<string>,
  slotResolution: SymbolOverrideSlotResolution,
): ReadonlySet<string> {
  if (slotResolution.size === 0) {
    return keys;
  }
  return new Set([...keys, ...slotResolution.keys()]);
}

function resolveSymbolMaterializedOverrideSlotAddresses(
  symbolNode: FigNode,
  childrenOf: KiwiChildrenOf,
  symbolOverrides: readonly FigKiwiSymbolOverride[] | undefined,
  derivedSymbolData: readonly FigKiwiSymbolOverride[] | undefined,
): SymbolOverrideSlotResolution {
  const children = childrenOf(symbolNode);
  if (children.length === 0) {
    return new Map();
  }
  const cloned = children.map((child) => deepCloneNode(child, childrenOf));
  return resolveMaterializedOverrideSlotAddresses(
    cloned,
    excludeSymbolRootAddressedOverrides(symbolOverrides, symbolNode.guid),
    excludeSymbolRootAddressedOverrides(derivedSymbolData, symbolNode.guid),
  );
}

function excludeSymbolRootAddressedOverrides<T extends FigKiwiSymbolOverride>(
  entries: readonly T[] | undefined,
  symbolGuid: FigGuid,
): readonly T[] | undefined {
  if (entries === undefined) {
    return entries;
  }
  const symbolKey = guidToString(symbolGuid);
  const filtered = entries.filter((entry) => {
    const first = entry.guidPath?.guids[0];
    return first === undefined || guidToString(first) !== symbolKey;
  });
  return filtered.length === entries.length ? entries : filtered;
}

function resolveMaterializedOverrideSlotAddresses(
  nodes: readonly MutableFigNode[],
  symbolOverrides: readonly FigKiwiSymbolOverride[] | undefined,
  derivedSymbolData: readonly FigKiwiSymbolOverride[] | undefined,
): SymbolOverrideSlotResolution {
  const entries = [...(symbolOverrides ?? []), ...(derivedSymbolData ?? [])];
  if (entries.length === 0) {
    return new Map();
  }
  const slots = new Map<string, FigGuid>();
  resolveMaterializedOverrideSlotAddressesPass(nodes, entries, slots, entries.length + 1);
  return slots;
}

function resolveMaterializedOverrideSlotAddressesPass(
  nodes: readonly MutableFigNode[],
  entries: readonly FigKiwiSymbolOverride[],
  slots: Map<string, FigGuid>,
  remainingPasses: number,
): void {
  if (remainingPasses <= 0) {
    return;
  }
  const changed = entries.reduce((wasChanged, entry) => {
    const entryChanged = resolveMaterializedEntrySlotAddresses(nodes, entry, slots);
    return wasChanged || entryChanged;
  }, false);
  if (!changed) {
    return;
  }
  resolveMaterializedOverrideSlotAddressesPass(nodes, entries, slots, remainingPasses - 1);
}

function resolveMaterializedEntrySlotAddresses(
  nodes: readonly MutableFigNode[],
  entry: FigKiwiSymbolOverride,
  slots: Map<string, FigGuid>,
): boolean {
  const guids = entry.guidPath?.guids;
  if (guids === undefined || guids.length === 0) {
    return false;
  }
  return resolveMaterializedGuidPath(nodes, entry, guids, slots);
}

function resolveMaterializedGuidPath(
  nodes: readonly MutableFigNode[],
  entry: FigKiwiSymbolOverride,
  guids: readonly FigGuid[],
  slots: Map<string, FigGuid>,
): boolean {
  const targetGuid = guids[0];
  if (targetGuid === undefined) {
    return false;
  }
  const targetKey = guidToString(targetGuid);
  const mappedGuid = slots.get(targetKey) ?? targetGuid;
  const child = findDescendantByGuid(nodes, mappedGuid);
  const tail = guids.slice(1);
  if (child === undefined) {
    return resolveMissingMaterializedGuidPath(nodes, entry, targetKey, tail, slots);
  }
  if (tail.length === 0) {
    return false;
  }
  return resolveMaterializedGuidPath(mutableChildren(child), entry, tail, slots);
}

function resolveMissingMaterializedGuidPath(
  nodes: readonly MutableFigNode[],
  entry: FigKiwiSymbolOverride,
  targetKey: string,
  tail: readonly FigGuid[],
  slots: Map<string, FigGuid>,
): boolean {
  const materialized = findMaterializedSlotCandidate(nodes, entry, tail, slots);
  if (materialized === undefined) {
    return false;
  }
  slots.set(targetKey, materialized.guid);
  if (tail.length === 0) {
    return true;
  }
  resolveMaterializedGuidPath(mutableChildren(materialized), entry, tail, slots);
  return true;
}

function findMaterializedSlotCandidate(
  nodes: readonly MutableFigNode[],
  entry: FigKiwiSymbolOverride,
  tail: readonly FigGuid[],
  slots: ReadonlyMap<string, FigGuid>,
): MutableFigNode | undefined {
  if (tail.length > 0) {
    return findSingleMaterializedSlotCandidate(
      collectMutableDescendants(nodes),
      (node) => localInstanceAcceptsOverrideTail(node, tail),
      `tail ${formatGuidPath(tail)} for ${formatGuidPath(entry.guidPath?.guids ?? [])}`,
    );
  }
  const descendants = collectMutableDescendants(nodes);
  const exact = findSingleMaterializedSlotCandidate(
    descendants,
    (node) => materializedOverridePayloadMatches(node, entry),
    `payload for ${formatGuidPath(entry.guidPath?.guids ?? [])}`,
  );
  if (exact !== undefined) {
    return exact;
  }
  return findMaterializedDerivedTextSlotCandidate(descendants, entry, slots);
}

function collectMutableDescendants(nodes: readonly MutableFigNode[]): readonly MutableFigNode[] {
  return nodes.flatMap((node) => [node, ...collectMutableDescendants(mutableChildren(node))]);
}

function findSingleMaterializedSlotCandidate(
  nodes: readonly MutableFigNode[],
  matches: (node: MutableFigNode) => boolean,
  _subject: string,
): MutableFigNode | undefined {
  const candidates = nodes.filter(matches);
  if (candidates.length > 1) {
    return undefined;
  }
  return candidates[0];
}

function localInstanceAcceptsOverrideTail(node: MutableFigNode, tail: readonly FigGuid[]): boolean {
  if (getNodeType(node) !== "INSTANCE") {
    return false;
  }
  const nextGuid = tail[0];
  if (nextGuid === undefined) {
    return false;
  }
  return localInstanceHasOverrideAddress(node, nextGuid);
}

function localInstanceHasOverrideAddress(node: FigNode, targetGuid: FigGuid): boolean {
  const targetKey = guidToString(targetGuid);
  return (
    overrideSetHasAddress(node.symbolData?.symbolOverrides, targetKey) ||
    overrideSetHasAddress(node.derivedSymbolData as readonly FigKiwiSymbolOverride[] | undefined, targetKey)
  );
}

function overrideSetHasAddress(
  entries: readonly FigKiwiSymbolOverride[] | undefined,
  targetKey: string,
): boolean {
  if (entries === undefined) {
    return false;
  }
  return entries.some((entry) => entry.guidPath?.guids.some((guid) => guidToString(guid) === targetKey) === true);
}

function findMaterializedDerivedTextSlotCandidate(
  nodes: readonly MutableFigNode[],
  entry: FigKiwiSymbolOverride,
  slots: ReadonlyMap<string, FigGuid>,
): MutableFigNode | undefined {
  if (entry.derivedTextData === undefined) {
    return undefined;
  }
  const layout = findSingleMaterializedSlotCandidate(
    nodes,
    (node) => materializedDerivedTextLayoutMatches(node, entry),
    `derived text layout for ${formatGuidPath(entry.guidPath?.guids ?? [])}`,
  );
  if (layout !== undefined) {
    return layout;
  }
  const alreadyResolved = new Set(Array.from(slots.values()).map((guid) => guidToString(guid)));
  return findSingleMaterializedSlotCandidate(
    nodes,
    (node) => getNodeType(node) === "TEXT" && !alreadyResolved.has(guidToString(node.guid)),
    `remaining derived text for ${formatGuidPath(entry.guidPath?.guids ?? [])}`,
  );
}

function materializedDerivedTextLayoutMatches(
  node: MutableFigNode,
  entry: FigKiwiSymbolOverride,
): boolean {
  if (getNodeType(node) !== "TEXT") {
    return false;
  }
  if (entry.size !== undefined && !figVectorEquals(node.size, entry.size)) {
    return false;
  }
  if (entry.transform !== undefined && !figTransformEquals(node.transform, entry.transform)) {
    return false;
  }
  return entry.size !== undefined || entry.transform !== undefined;
}

function figVectorEquals(
  left: FigNode["size"],
  right: NonNullable<FigKiwiSymbolOverride["size"]>,
): boolean {
  return left !== undefined && left.x === right.x && left.y === right.y;
}

function figTransformEquals(
  left: FigNode["transform"],
  right: NonNullable<FigKiwiSymbolOverride["transform"]>,
): boolean {
  return (
    left !== undefined &&
    left.m00 === right.m00 &&
    left.m01 === right.m01 &&
    left.m02 === right.m02 &&
    left.m10 === right.m10 &&
    left.m11 === right.m11 &&
    left.m12 === right.m12
  );
}

function isOverrideAlreadyMaterialized(
  nodes: readonly MutableFigNode[],
  override: FigKiwiSymbolOverride,
): boolean {
  const name = override.name;
  if (typeof name !== "string") {
    return false;
  }
  const candidates = findDescendantsByName(nodes, name);
  return candidates.some((candidate) => materializedOverridePayloadMatches(candidate, override));
}

function findDescendantsByName(
  nodes: readonly MutableFigNode[],
  name: string,
): readonly MutableFigNode[] {
  const matches: MutableFigNode[] = [];
  for (const node of nodes) {
    if (node.name === name) {
      matches.push(node);
    }
    matches.push(...findDescendantsByName(mutableChildren(node), name));
  }
  return matches;
}

function materializedOverridePayloadMatches(
  node: MutableFigNode,
  override: FigKiwiSymbolOverride,
): boolean {
  const nodeRecord = node as Record<string, unknown>;
  const overrideRecord = override as Record<string, unknown>;
  for (const key of Object.keys(overrideRecord)) {
    if (key === "guidPath" || key === "overrideLevel") {
      continue;
    }
    const incoming = overrideRecord[key];
    if (incoming === undefined) {
      continue;
    }
    if (!kiwiPayloadValueEquals(nodeRecord[key], incoming)) {
      return false;
    }
  }
  return true;
}

function kiwiPayloadValueEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return kiwiArrayPayloadValueEquals(left, right);
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => key in rightRecord && kiwiPayloadValueEquals(leftRecord[key], rightRecord[key]));
}

function kiwiArrayPayloadValueEquals(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => kiwiPayloadValueEquals(value, right[index]));
}

function applyDirectOverride(node: MutableFigNode, override: FigKiwiSymbolOverride): void {
  applyKiwiOverrideToNode(node, override);
}

/**
 * Find a descendant whose `guid` equals `targetGuid`, searching the
 * full descendant set of `nodes`.
 *
 * Kiwi-side overrides may address slots authored anywhere in the
 * SYMBOL's descendants, not just at depth 1.
 *
 * After the matched node is returned, subsequent path steps
 * descend into ITS immediate children — so the walk is actually
 * "deep DFS for path[0], then stepwise descent for path[1..]".
 * No second document shape is introduced.
 */
function findDescendantByGuid(
  nodes: readonly MutableFigNode[],
  targetGuid: FigGuid,
): MutableFigNode | undefined {
  for (const node of nodes) {
    if (node.guid.sessionID === targetGuid.sessionID && node.guid.localID === targetGuid.localID) {
      return node;
    }
    const found = findDescendantByGuid(mutableChildren(node), targetGuid);
    if (found) {
      return found;
    }
  }
  return undefined;
}

// =============================================================================
// Instance node resolution — Full pipeline
//
// This is the SoT for "INSTANCE → renderable (node + children)".
// The renderer calls this; it does NOT implement resolution logic itself.
// =============================================================================

/**
 * Result of resolving an INSTANCE node into renderable content.
 */
export type ResolvedInstanceNode = {
  /** The node to render (may have SYMBOL properties merged in) */
  readonly node: FigNode;
  /** Resolved children (cloned from SYMBOL with overrides applied) */
  readonly children: readonly FigNode[];
};

/**
 * Context required for full INSTANCE resolution inside SymbolResolver.
 */
type InstanceResolveRuntime = {
  readonly document: FigKiwiDocumentIndex;
  readonly documents: SymbolResolverDocuments;
  readonly blobs?: readonly FigBlob[];
  readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
};

/**
 * Merge SYMBOL style properties into INSTANCE node.
 *
 * SYMBOL properties always take precedence for visual/style attributes.
 * In Figma's .fig format, INSTANCE nodes inherit all visual properties
 * from their referenced SYMBOL — direct property overrides on the
 * INSTANCE node itself (e.g. fillPaints, size) are ignored.
 * Instance-specific overrides go through symbolOverrides/derivedSymbolData,
 * which are applied separately via cloneSymbolChildren.
 */
export function mergeSymbolProperties(instanceNode: FigNode, symbolNode: FigNode): MutableFigNode {
  const merged: MutableFigNode = { ...instanceNode };

  // SYMBOL's visual properties always override INSTANCE-level values.
  if (symbolNode.fillPaints) { merged.fillPaints = symbolNode.fillPaints; }
  if (symbolNode.strokePaints) { merged.strokePaints = symbolNode.strokePaints; }
  if (symbolNode.strokeWeight !== undefined) { merged.strokeWeight = symbolNode.strokeWeight; }
  if (symbolNode.cornerRadius !== undefined) { merged.cornerRadius = symbolNode.cornerRadius; }
  if (symbolNode.rectangleCornerRadii) { merged.rectangleCornerRadii = symbolNode.rectangleCornerRadii; }
  if (symbolNode.rectangleTopLeftCornerRadius !== undefined) { merged.rectangleTopLeftCornerRadius = symbolNode.rectangleTopLeftCornerRadius; }
  if (symbolNode.rectangleTopRightCornerRadius !== undefined) { merged.rectangleTopRightCornerRadius = symbolNode.rectangleTopRightCornerRadius; }
  if (symbolNode.rectangleBottomRightCornerRadius !== undefined) { merged.rectangleBottomRightCornerRadius = symbolNode.rectangleBottomRightCornerRadius; }
  if (symbolNode.rectangleBottomLeftCornerRadius !== undefined) { merged.rectangleBottomLeftCornerRadius = symbolNode.rectangleBottomLeftCornerRadius; }
  if (symbolNode.rectangleCornerRadiiIndependent !== undefined) { merged.rectangleCornerRadiiIndependent = symbolNode.rectangleCornerRadiiIndependent; }

  // fillGeometry / strokeGeometry: only copy from SYMBOL if sizes match.
  const instSize = instanceNode.size;
  const symSize = symbolNode.size;
  const sameSize = instSize && symSize && instSize.x === symSize.x && instSize.y === symSize.y;
  if (symbolNode.fillGeometry && sameSize) { merged.fillGeometry = symbolNode.fillGeometry; }
  if (symbolNode.strokeGeometry && sameSize) { merged.strokeGeometry = symbolNode.strokeGeometry; }

  applySymbolClipFields(merged, instanceNode, symbolNode);

  if (symbolNode.effects) { merged.effects = symbolNode.effects; }
  if (symbolNode.strokeJoin !== undefined) { merged.strokeJoin = symbolNode.strokeJoin; }
  if (symbolNode.strokeCap !== undefined) { merged.strokeCap = symbolNode.strokeCap; }
  if (symbolNode.blendMode !== undefined) { merged.blendMode = symbolNode.blendMode; }
  if (symbolNode.mask !== undefined) { merged.mask = symbolNode.mask; }
  if (symbolNode.cornerSmoothing !== undefined) { merged.cornerSmoothing = symbolNode.cornerSmoothing; }
  if (symbolNode.size) { merged.size = symbolNode.size; }
  // opacity: the INSTANCE's opacity is the override channel — Figma
  // renders an instance with its own opacity, not the symbol's. SYMBOL
  // opacity only applies when the INSTANCE doesn't declare one.
  if (instanceNode.opacity === undefined && symbolNode.opacity !== undefined) {
    merged.opacity = symbolNode.opacity;
  }

  return merged;
}

function applySymbolClipFields(
  merged: MutableFigNode,
  instanceNode: FigNode,
  symbolNode: FigNode,
): void {
  const instanceHasOwnClip = instanceNode.frameMaskDisabled !== undefined || instanceNode.clipsContent !== undefined;
  if (instanceHasOwnClip) {
    return;
  }
  if (symbolNode.frameMaskDisabled !== undefined) {
    merged.frameMaskDisabled = symbolNode.frameMaskDisabled;
    return;
  }
  if (symbolNode.clipsContent !== undefined) {
    merged.clipsContent = symbolNode.clipsContent;
    return;
  }
  merged.frameMaskDisabled = false;
}

/**
 * Apply self-referencing symbolOverrides to the merged INSTANCE node.
 *
 * The set of fields projected here is `SELF_OVERRIDE_PAYLOAD_FIELDS`
 * (declared next to the detector's `INSTANCE_SELF_OVERRIDE_FIELDS`) —
 * keeping one shared SoT ensures the detector classifies exactly
 * the entries this applier will accept.
 */
export function applySelfOverridesToMergedNode(
  mergedNode: MutableFigNode,
  overrides: readonly FigKiwiSymbolOverride[],
  symbolGuidStr: string,
): void {
  for (const override of overrides) {
    applySelfOverrideEntry(mergedNode, override, symbolGuidStr);
  }
}

function applySelfOverrideEntry(
  mergedNode: MutableFigNode,
  override: FigKiwiSymbolOverride,
  symbolGuidStr: string,
): void {
  const guids = override.guidPath?.guids;
  if (!guids || guids.length !== 1) {
    return;
  }
  if (guidToString(guids[0]) !== symbolGuidStr) {
    return;
  }
  for (const key of Object.keys(override) as (keyof FigKiwiSymbolOverride)[]) {
    applySelfOverrideField(mergedNode, override, key);
  }
}

function applySelfOverrideField(
  mergedNode: MutableFigNode,
  override: FigKiwiSymbolOverride,
  key: keyof FigKiwiSymbolOverride,
): void {
  if (key === "guidPath" || !SELF_OVERRIDE_PAYLOAD_FIELDS.has(key)) {
    return;
  }
  const value = override[key];
  if (value === undefined) {
    return;
  }
  (mergedNode as Record<string, unknown>)[key] = value;
}

type SymbolOverrideSlotResolution = ReadonlyMap<string, FigGuid>;

function firstOverrideGuidKeys(
  ...sets: (readonly FigKiwiSymbolOverride[] | undefined)[]
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const set of sets) {
    if (set === undefined) {
      continue;
    }
    for (const entry of set) {
      const first = entry.guidPath?.guids[0];
      if (first !== undefined) {
        keys.add(guidToString(first));
      }
    }
  }
  return keys;
}

type SymbolSlotIndex = {
  readonly guidToSlot: ReadonlyMap<string, { readonly guid: FigGuid }>;
  readonly exactSlotMap: ReadonlyMap<string, string>;
};

function buildSymbolSlotIndex(symbolRoot: FigNode, childrenOf: KiwiChildrenOf): SymbolSlotIndex {
  const guidToSlot = new Map<string, { readonly guid: FigGuid }>();
  const exactSlotMap = new Map<string, string>();

  function visit(node: FigNode): void {
    registerSymbolSlot(node, guidToSlot, exactSlotMap);
    for (const child of childrenOf(node)) {
      visit(child);
    }
  }

  visit(symbolRoot);
  return { guidToSlot, exactSlotMap };
}

function registerSymbolSlot(
  node: FigNode,
  guidToSlot: Map<string, { readonly guid: FigGuid }>,
  exactSlotMap: Map<string, string>,
): void {
  const guid = node.guid;
  if (guid === undefined) {
    return;
  }
  const guidKey = guidToString(guid);
  const overrideKey = node.overrideKey;
  const overrideKeyAddress = overrideKey === undefined ? undefined : guidToString(overrideKey);
  if (!guidToSlot.has(guidKey)) {
    guidToSlot.set(guidKey, { guid });
  }
  if (!exactSlotMap.has(guidKey)) {
    exactSlotMap.set(guidKey, guidKey);
  }
  if (overrideKeyAddress === undefined || exactSlotMap.has(overrideKeyAddress)) {
    return;
  }
  exactSlotMap.set(overrideKeyAddress, guidKey);
}

function resolveOverrideSlotAddresses(
  {
    slotIndex,
    derivedSymbolData,
    symbolOverrides,
  }: {
    readonly slotIndex: SymbolSlotIndex;
    readonly derivedSymbolData?: readonly FigKiwiSymbolOverride[];
    readonly symbolOverrides?: readonly FigKiwiSymbolOverride[];
  },
): SymbolOverrideSlotResolution {
  const keys = firstOverrideGuidKeys(derivedSymbolData, symbolOverrides);
  if (keys.size === 0) {
    return new Map();
  }

  const slots = new Map<string, FigGuid>();
  for (const key of keys) {
    const targetKey = slotIndex.exactSlotMap.get(key);
    if (targetKey === undefined || targetKey === key) {
      continue;
    }
    const target = slotIndex.guidToSlot.get(targetKey);
    if (target === undefined) {
      throw new Error(`SymbolResolver: override slot ${targetKey} is missing from SYMBOL slot index`);
    }
    slots.set(key, target.guid);
  }
  return slots;
}

function bindOverridesToResolvedSlots(
  slotResolution: SymbolOverrideSlotResolution,
  overrides: readonly FigKiwiSymbolOverride[] | undefined,
): readonly FigKiwiSymbolOverride[] | undefined {
  if (overrides === undefined || slotResolution.size === 0) {
    return overrides;
  }
  return overrides.map((entry) => {
    const guids = entry.guidPath?.guids;
    if (guids === undefined || guids.length === 0) {
      return entry;
    }
    const mappedGuids = guids.map((guid) => slotResolution.get(guidToString(guid)) ?? guid);
    const changed = mappedGuids.some((guid, index) => guid !== guids[index]);
    if (!changed) {
      return entry;
    }
    return {
      ...entry,
      guidPath: {
        guids: mappedGuids,
      },
    };
  });
}

function bindMaterializedOverridesToResolvedSlots(
  nodes: readonly MutableFigNode[],
  slotResolution: SymbolOverrideSlotResolution,
  overrides: readonly FigKiwiSymbolOverride[] | undefined,
): readonly FigKiwiSymbolOverride[] | undefined {
  if (overrides === undefined || slotResolution.size === 0) {
    return overrides;
  }
  return overrides.map((entry) => {
    const guids = entry.guidPath?.guids;
    if (guids === undefined || guids.length === 0) {
      return entry;
    }
    const mappedGuids = guids.map((guid) => slotResolution.get(guidToString(guid)) ?? guid);
    const changed = mappedGuids.some((guid, index) => guid !== guids[index]);
    if (!changed || !resolvedOverridePathReachesTarget(nodes, mappedGuids)) {
      return entry;
    }
    return {
      ...entry,
      guidPath: {
        guids: mappedGuids,
      },
    };
  });
}

function resolvedOverridePathReachesTarget(
  nodes: readonly MutableFigNode[],
  guids: readonly FigGuid[],
): boolean {
  const targetGuid = guids[0];
  if (targetGuid === undefined) {
    return false;
  }
  const target = findDescendantByGuid(nodes, targetGuid);
  if (target === undefined) {
    return false;
  }
  const tail = guids.slice(1);
  if (tail.length === 0) {
    return true;
  }
  if (getNodeType(target) === "INSTANCE") {
    return true;
  }
  return resolvedOverridePathReachesTarget(mutableChildren(target), tail);
}

/**
 * Resolve an INSTANCE node into renderable content inside SymbolResolver.
 *
 * This is the single source of truth for the full INSTANCE resolution pipeline:
 * 1. Resolve INSTANCE → SYMBOL reference
 * 2. Merge SYMBOL properties into INSTANCE
 * 3. Resolve overrideKey addresses to descendant GUIDs
 * 4. Apply self-referencing overrides to the merged node
 * 5. Clone SYMBOL children with overrides applied
 * 6. Resolve layout for resized instances
 *
 * The renderer calls this function and renders the result — it does NOT
 * implement any resolution logic itself.
 */
function resolveInstanceNode(
  node: FigNode,
  ctx: InstanceResolveRuntime,
): ResolvedInstanceNode {
  const variableModeBySetMap = mergeVariableModeBySetMap(ctx.variableModeBySetMap, node.variableModeBySetMap);
  // 1. Resolve INSTANCE → SYMBOL
  const resolution = resolveReferencesForNode(node, ctx.documents, ctx.variableModeBySetMap);
  if (!resolution.effectiveSymbol) {
    return resolveDocumentExternalInstanceOrThrow(node, { ...ctx, variableModeBySetMap });
  }

  const { node: symNode } = resolution.effectiveSymbol;
  const symbolDocument = resolution.effectiveSymbol.document;
  const originalSymNode = symNode;

  // 2. Merge SYMBOL properties into INSTANCE
  const mergedNode = mergeSymbolProperties(node, symNode);
  applyVariableModeBySetMapToNode(mergedNode, variableModeBySetMap);

  // 3. Resolve overrideKey addresses to descendant GUIDs.
  const componentPropAssignments = collectComponentPropAssignments(node);
  const sourceSymbolOverrides = node.symbolData?.symbolOverrides;
  const slotIndex = buildSymbolSlotIndex(originalSymNode, symbolDocument.childrenOf);
  const supersededSlotIndex = buildSupersededSymbolSlotIndex(node, resolution.effectiveSymbol, ctx.documents);
  const inactiveVariantSlotIndex = buildInactiveVariantFamilySlotIndex(resolution.effectiveSymbol);
  const activeSourceSymbolOverrides = selectOverridesForEffectiveSymbol(
    sourceSymbolOverrides,
    slotIndex,
    supersededSlotIndex,
    inactiveVariantSlotIndex,
  );
  const activeSourceDerivedData = selectOverridesForEffectiveSymbol(
    node.derivedSymbolData as FigDerivedSymbolData | undefined,
    slotIndex,
    supersededSlotIndex,
    inactiveVariantSlotIndex,
  );
  const materializedSlotResolution = resolveSymbolMaterializedOverrideSlotAddresses(
    originalSymNode,
    symbolDocument.childrenOf,
    activeSourceSymbolOverrides,
    activeSourceDerivedData,
  );
  // Move self-override entries (single-guid path carrying only
  // INSTANCE-only fields like name/size/variableConsumptionMap/
  // parameterConsumptionMap) onto the SYMBOL root before the
  // descendant-slot address resolution runs.
  const symRootGuid = symNode.guid;
  const symbolRootBoundOverrides = bindSelfOverridesToSymbolRoot(
    activeSourceSymbolOverrides,
    symRootGuid,
    slotIndex.exactSlotMap,
    materializedSlotResolution,
  );
  const symbolRootBoundDerivedData = bindSelfOverridesToSymbolRoot(
    activeSourceDerivedData,
    symRootGuid,
    slotIndex.exactSlotMap,
    materializedSlotResolution,
  );
  // Strip self-override entries (path = SYMBOL root) before descendant
  // address resolution. Self-overrides apply only to the INSTANCE's merged node.
  const symRootGuidStr = guidToString(symRootGuid);
  const ovPart = partitionSymbolRootOverrides(symbolRootBoundOverrides, symRootGuidStr);
  const dsdPart = partitionSymbolRootOverrides(symbolRootBoundDerivedData, symRootGuidStr);
  const slotResolution = resolveOverrideSlotAddresses({
    slotIndex,
    derivedSymbolData: dsdPart.rest,
    symbolOverrides: ovPart.rest,
  });
  const symbolOverrides = bindOverridesToResolvedSlots(slotResolution, ovPart.rest);
  const derivedSymbolData = bindOverridesToResolvedSlots(slotResolution, dsdPart.rest);
  const symbolSelfOverrides = ovPart.selves;

  // 4. Apply self-referencing overrides — only the entries we
  // partitioned out above (path = SYMBOL root). They never went
  // through descendant address resolution so they keep their INSTANCE-only fields.
  if (symbolSelfOverrides.length > 0) {
    applySelfOverridesToMergedNode(mergedNode, symbolSelfOverrides, guidToString(symNode.guid));
  }

  // 5. Clone SYMBOL children with overrides
  const clonedChildren = cloneSymbolChildren(symNode, {
    childrenOf: symbolDocument.childrenOf,
    symbolOverrides,
    derivedSymbolData,
    componentPropAssignments: componentPropAssignments.length > 0 ? componentPropAssignments : undefined,
  });
  const externalVariableColoredChildren = materializeRootSelfFillColorForExternalVariablePaints(
    clonedChildren,
    rootSelfFillPaintsFromOverrides(symbolSelfOverrides),
    guidToString(symNode.guid),
  );
  const children = applyVariableModeBySetMapToResolvedChildren(externalVariableColoredChildren, variableModeBySetMap);

  // 6. Layout resolution for resized instances
  const instanceSize = node.size;
  const symbolSize = symNode.size;
  const resized = resolveResizedInstanceChildren({
    children,
    derivedSymbolData,
    instanceSize,
    symbolSize,
  });
  if (resized !== undefined) {
    applyResolvedInstanceSize(mergedNode, resized);
    const layoutResolved = resolveAutoLayoutFrame(mergedNode, resized.children);
    return { node: layoutResolved.parent, children: layoutResolved.children };
  }

  const layoutResolved = resolveAutoLayoutFrame(mergedNode, children);
  return { node: layoutResolved.parent, children: layoutResolved.children };
}

function rootSelfFillPaintsFromOverrides(overrides: readonly FigKiwiSymbolOverride[]): FigNode["fillPaints"] | undefined {
  const fillEntries = overrides.filter((override) => override.fillPaints !== undefined);
  return fillEntries[fillEntries.length - 1]?.fillPaints;
}

function materializeRootSelfFillColorForExternalVariablePaints(
  nodes: readonly FigNode[],
  rootFillPaints: FigNode["fillPaints"] | undefined,
  symbolGuidStr: string,
): readonly FigNode[] {
  if (rootFillPaints === undefined) {
    return nodes;
  }
  if (!nodesContainExternalVariablePaint(nodes)) {
    return nodes;
  }
  const color = requireSingleVisibleSolidFillColor(
    rootFillPaints,
    `SymbolResolver: SYMBOL ${symbolGuidStr} root self fill override`,
  );
  if (color === undefined) {
    return nodes;
  }
  return nodes.map((node) => materializeExternalVariablePaintsForNode(node, color));
}

function nodesContainExternalVariablePaint(nodes: readonly (FigNode | null | undefined)[]): boolean {
  return nodes.some((node) => {
    if (node === null || node === undefined) {
      return false;
    }
    if (paintsContainExternalVariableColor(node.fillPaints)) {
      return true;
    }
    if (paintsContainExternalVariableColor(node.strokePaints)) {
      return true;
    }
    return nodesContainExternalVariablePaint(node.children ?? []);
  });
}

function paintsContainExternalVariableColor(paints: readonly FigPaint[] | undefined): boolean {
  if (paints === undefined) {
    return false;
  }
  return paints.some((paint) => paintReferencesExternalColorVariable(paint));
}

function materializeExternalVariablePaintsForNode(node: FigNode, color: FigColor): FigNode {
  const fillPaints = materializeExternalVariablePaintColors(node.fillPaints, color);
  const strokePaints = materializeExternalVariablePaintColors(node.strokePaints, color);
  const children = materializeExternalVariablePaintsForChildren(node.children, color);
  if (fillPaints === node.fillPaints && strokePaints === node.strokePaints && children === node.children) {
    return node;
  }
  return {
    ...node,
    fillPaints,
    strokePaints,
    children,
  };
}

function materializeExternalVariablePaintsForChildren(
  children: FigNode["children"],
  color: FigColor,
): FigNode["children"] {
  if (children === undefined || children.length === 0) {
    return children;
  }
  const next = children.map((child) => {
    if (child === null || child === undefined) {
      return child;
    }
    return materializeExternalVariablePaintsForNode(child, color);
  });
  if (next.every((child, index) => child === children[index])) {
    return children;
  }
  return next;
}

function materializeExternalVariablePaintColors(
  paints: readonly FigPaint[] | undefined,
  color: FigColor,
): readonly FigPaint[] | undefined {
  if (paints === undefined || paints.length === 0) {
    return paints;
  }
  const next = paints.map((paint) => materializeExternalVariablePaintColor(paint, color));
  if (next.every((paint, index) => paint === paints[index])) {
    return paints;
  }
  return next;
}

function materializeExternalVariablePaintColor(paint: FigPaint, color: FigColor): FigPaint {
  const solid = asSolidPaint(paint);
  if (solid === undefined || !paintReferencesExternalColorVariable(solid)) {
    return paint;
  }
  if (figColorsEqual(solid.color, color)) {
    return paint;
  }
  return {
    ...solid,
    color,
  };
}

function paintReferencesExternalColorVariable(paint: FigPaint): boolean {
  const value = projectVariableAnyValue(paint.colorVar?.value);
  if (value?.kind !== "alias") {
    return false;
  }
  return "assetRef" in value.value && value.value.assetRef !== undefined;
}

function requireSingleVisibleSolidFillColor(paints: readonly FigPaint[], subject: string): FigColor | undefined {
  const visible = paints.filter((paint) => paint.visible !== false);
  if (visible.length === 0) {
    return undefined;
  }
  const colors = visible.map((paint) => {
    const solid = asSolidPaint(paint);
    if (solid === undefined) {
      throw new Error(`${subject} must use SOLID paint to resolve external color variable paints`);
    }
    return solid.color;
  });
  const first = colors[0];
  if (first === undefined) {
    return undefined;
  }
  const mismatch = colors.find((color) => !figColorsEqual(color, first));
  if (mismatch !== undefined) {
    throw new Error(`${subject} has multiple visible SOLID colors for external color variable paints`);
  }
  return first;
}

function figColorsEqual(left: FigColor, right: FigColor): boolean {
  return left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a;
}

function resolveDocumentExternalInstanceOrThrow(node: FigNode, ctx: InstanceResolveRuntime): ResolvedInstanceNode {
  const documentExternal = resolveDocumentExternalInstanceNode(node, ctx);
  if (documentExternal !== undefined) {
    return documentExternal;
  }
  throw new Error(`SymbolResolver: INSTANCE ${guidToString(node.guid)} does not resolve to a SYMBOL`);
}

function resolveDocumentExternalInstanceNode(node: FigNode, ctx: InstanceResolveRuntime): ResolvedInstanceNode | undefined {
  const derivedSymbolData = node.derivedSymbolData;
  if (derivedSymbolData === undefined || derivedSymbolData.length === 0) {
    return undefined;
  }
  const root = resolveDocumentExternalInstanceRoot(node);
  return {
    node: applyVariableModeBySetMapToClonedNode(root, ctx.variableModeBySetMap),
    children: applyVariableModeBySetMapToResolvedChildren(materializeDocumentExternalDerivedChildren(node, {
      document: ctx.document,
      documents: ctx.documents,
      blobs: ctx.blobs,
      visualContext: externalDerivedVisualContextFromNode(root, undefined),
      variableModeBySetMap: ctx.variableModeBySetMap,
    }), ctx.variableModeBySetMap),
  };
}

function applyVariableModeBySetMapToResolvedChildren(
  children: readonly FigNode[],
  inherited: FigKiwiVariableModeBySetMap | undefined,
): readonly FigNode[] {
  if (inherited === undefined) {
    return children;
  }
  return children.map((child) => applyVariableModeBySetMapToClonedNode(child, inherited));
}

function applyVariableModeBySetMapToClonedNode(
  node: FigNode,
  inherited: FigKiwiVariableModeBySetMap | undefined,
): FigNode {
  const variableModeBySetMap = mergeVariableModeBySetMap(inherited, node.variableModeBySetMap);
  const next: MutableFigNode = { ...node };
  applyVariableModeBySetMapToNode(next, variableModeBySetMap);
  const children = node.children;
  if (children === undefined || children.length === 0) {
    return next;
  }
  next.children = children.map((child) => {
    if (child === null || child === undefined) {
      return child;
    }
    return applyVariableModeBySetMapToClonedNode(child, variableModeBySetMap);
  });
  return next;
}

function applyVariableModeBySetMapToNode(
  node: MutableFigNode,
  variableModeBySetMap: FigKiwiVariableModeBySetMap | undefined,
): void {
  if (variableModeBySetMap === undefined) {
    delete node.variableModeBySetMap;
    return;
  }
  node.variableModeBySetMap = variableModeBySetMap;
}

function resolveDocumentExternalInstanceRoot(node: FigNode): FigNode {
  const root: MutableFigNode = { ...node };
  delete root.stackMode;
  delete root.stackSpacing;
  delete root.stackPadding;
  delete root.stackVerticalPadding;
  delete root.stackHorizontalPadding;
  delete root.stackPaddingRight;
  delete root.stackPaddingBottom;
  delete root.stackPrimaryAlignItems;
  delete root.stackCounterAlignItems;
  delete root.stackPrimaryAlignContent;
  delete root.stackCounterAlignContent;
  delete root.stackWrap;
  delete root.stackCounterSpacing;
  delete root.stackReverseZIndex;
  delete root.gridRows;
  delete root.gridColumns;
  delete root.gridRowsSizing;
  delete root.gridColumnsSizing;
  return root;
}

type ExternalDerivedSlot = {
  readonly guid: FigGuid;
  readonly path: readonly FigGuid[];
  readonly derivedPayloads: ExternalDerivedPayloadEntry[];
  readonly overridePayloads: ExternalDerivedPayloadEntry[];
  readonly children: Map<string, ExternalDerivedSlot>;
};

type ExternalDerivedEntrySource = "derived" | "symbolOverride";
type ExternalDerivedAddressScope = "prefixed" | "local";
type ExternalDerivedPayloadEntry = {
  readonly payload: FigKiwiSymbolOverride;
  readonly scope: ExternalDerivedAddressScope;
};

function externalDerivedPayloads(slot: ExternalDerivedSlot): readonly FigKiwiSymbolOverride[] {
  return externalDerivedPayloadEntries(slot).map((entry) => entry.payload);
}

function externalDerivedPayloadEntries(slot: ExternalDerivedSlot): readonly ExternalDerivedPayloadEntry[] {
  return [...slot.overridePayloads, ...slot.derivedPayloads];
}

type ExternalDerivedVisualContext = {
  readonly fillPaints?: FigNode["fillPaints"];
  readonly strokePaints?: FigNode["strokePaints"];
  readonly styleIdForFill?: FigNode["styleIdForFill"];
  readonly styleIdForStrokeFill?: FigNode["styleIdForStrokeFill"];
  readonly styleIdForEffect?: FigNode["styleIdForEffect"];
};

type ExternalDerivedMaterializeContext = {
  readonly document: FigKiwiDocumentIndex;
  readonly documents: SymbolResolverDocuments;
  readonly blobs?: readonly FigBlob[];
  readonly visualContext?: ExternalDerivedVisualContext;
  readonly documentExternalSlotSymbolRoots?: ReadonlyMap<string, FigNode>;
  readonly variableModeBySetMap?: FigKiwiVariableModeBySetMap;
};

type ExternalDerivedText = {
  readonly derivedTextData: FigDerivedTextData;
  readonly textValue?: NonNullable<FigComponentPropAssignment["value"]["textValue"]>;
  readonly absorbsChildSlots: boolean;
};

const EXTERNAL_DERIVED_PHASE: KiwiEnumValue = { value: 1, name: "CREATED" };
const RAW_NUMBER_UNITS: KiwiEnumValue<"RAW"> = { value: 0, name: "RAW" };
const PIXELS_NUMBER_UNITS: KiwiEnumValue<"PIXELS"> = { value: 1, name: "PIXELS" };

function materializeDocumentExternalDerivedChildren(
  node: FigNode,
  ctx: ExternalDerivedMaterializeContext,
): readonly FigNode[] {
  const slots = buildExternalDerivedSlots({
    derivedSymbolData: node.derivedSymbolData ?? [],
    symbolOverrides: node.symbolData?.symbolOverrides ?? [],
  });
  const documentExternalSlotSymbolRoots = resolveDocumentExternalSlotSymbolRoots(node, slots, ctx.document);
  const materializeContext: ExternalDerivedMaterializeContext = {
    document: ctx.document,
    documents: ctx.documents,
    blobs: ctx.blobs,
    visualContext: ctx.visualContext,
    documentExternalSlotSymbolRoots,
    variableModeBySetMap: ctx.variableModeBySetMap,
  };
  const children = markDocumentExternalLeadingMaskSource(materializeExternalDerivedSlots(slots, materializeContext));
  return alignDocumentExternalDerivedChildren(node, children, ctx.blobs);
}

function buildExternalDerivedSlots(
  entries: {
    readonly derivedSymbolData: readonly FigKiwiSymbolOverride[];
    readonly symbolOverrides: readonly FigKiwiSymbolOverride[];
  },
): readonly ExternalDerivedSlot[] {
  const slots = new Map<string, ExternalDerivedSlot>();
  addExternalDerivedEntriesToSlots(slots, entries.derivedSymbolData, "derived", "prefixed");
  addExternalDerivedEntriesToSlots(slots, entries.symbolOverrides, "symbolOverride", "prefixed");
  return Array.from(slots.values());
}

function resolveDocumentExternalSlotSymbolRoots(
  node: FigNode,
  slots: readonly ExternalDerivedSlot[],
  document: FigKiwiDocumentIndex,
): ReadonlyMap<string, FigNode> | undefined {
  const selectedSymbols = documentExternalSelectedLocalSymbolRoots(node, document);
  if (selectedSymbols.length === 0) {
    return undefined;
  }
  const roots = new Map<string, FigNode>();
  for (const symbolRoot of selectedSymbols) {
    const slot = requireDocumentExternalSlotForSelectedSymbol(node, symbolRoot, slots, document);
    const slotKey = guidToString(slot.guid);
    const existing = roots.get(slotKey);
    if (existing !== undefined && !figGuidEquals(existing.guid, symbolRoot.guid)) {
      throw new Error(
        `SymbolResolver: INSTANCE ${guidToString(node.guid)} maps external slot ${slotKey} to both selected SYMBOL ${guidToString(existing.guid)} and ${guidToString(symbolRoot.guid)}`,
      );
    }
    roots.set(slotKey, symbolRoot);
  }
  return roots;
}

function documentExternalSelectedLocalSymbolRoots(
  node: FigNode,
  document: FigKiwiDocumentIndex,
): readonly FigNode[] {
  const assignments = node.componentPropAssignments ?? [];
  const symbols = new Map<string, FigNode>();
  for (const assignment of assignments) {
    const guidValue = assignment.value.guidValue;
    if (guidValue === undefined) {
      continue;
    }
    const target = findNodeByGuid(document, guidValue);
    if (target === undefined || getNodeType(target) !== "SYMBOL") {
      continue;
    }
    symbols.set(guidToString(target.guid), target);
  }
  return Array.from(symbols.values());
}

function requireDocumentExternalSlotForSelectedSymbol(
  node: FigNode,
  symbolRoot: FigNode,
  slots: readonly ExternalDerivedSlot[],
  document: FigKiwiDocumentIndex,
): ExternalDerivedSlot {
  const descendantKeys = selectedSymbolDescendantKeys(symbolRoot, document);
  const matches = slots.filter((slot) => externalDerivedSlotContainsAnyGuid(slot, descendantKeys));
  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length === 0) {
    throw new Error(
      `SymbolResolver: INSTANCE ${guidToString(node.guid)} selects local SYMBOL ${guidToString(symbolRoot.guid)} but derivedSymbolData carries no matching external slot`,
    );
  }
  throw new Error(
    `SymbolResolver: INSTANCE ${guidToString(node.guid)} selects local SYMBOL ${guidToString(symbolRoot.guid)} but derivedSymbolData maps it to multiple external slots: ${matches.map((slot) => guidToString(slot.guid)).join(", ")}`,
  );
}

function selectedSymbolDescendantKeys(
  symbolRoot: FigNode,
  document: FigKiwiDocumentIndex,
): ReadonlySet<string> {
  const keys = new Set<string>();
  collectSelectedSymbolDescendantKeys(symbolRoot, document, keys);
  return keys;
}

function collectSelectedSymbolDescendantKeys(
  node: FigNode,
  document: FigKiwiDocumentIndex,
  keys: Set<string>,
): void {
  for (const child of document.childrenOf(node)) {
    keys.add(guidToString(child.guid));
    collectSelectedSymbolDescendantKeys(child, document, keys);
  }
}

function externalDerivedSlotContainsAnyGuid(
  slot: ExternalDerivedSlot,
  keys: ReadonlySet<string>,
): boolean {
  if (keys.has(guidToString(slot.guid))) {
    return true;
  }
  for (const child of slot.children.values()) {
    if (externalDerivedSlotContainsAnyGuid(child, keys)) {
      return true;
    }
  }
  return false;
}

type ExternalDerivedBounds = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

type ExternalDerivedOffset = {
  readonly x: number;
  readonly y: number;
};

function alignDocumentExternalDerivedChildren(
  node: FigNode,
  children: readonly FigNode[],
  blobs: readonly FigBlob[] | undefined,
): readonly FigNode[] {
  if (node.size === undefined || blobs === undefined || children.length === 0) {
    return children;
  }
  const offset = resolveDocumentExternalRootMaskOffset(node, children[0]!, blobs);
  if (offset === undefined) {
    return children;
  }
  return children.map((child) => translateExternalDerivedTopLevelNode(child, offset));
}

function resolveDocumentExternalRootMaskOffset(
  node: FigNode,
  firstChild: FigNode,
  blobs: readonly FigBlob[],
): ExternalDerivedOffset | undefined {
  const size = node.size;
  if (size === undefined) {
    return undefined;
  }
  if (!isDocumentExternalRootMaskSource(firstChild)) {
    return undefined;
  }
  const bounds = geometryBoundsFromKiwi(firstChild.fillGeometry, blobs);
  if (bounds === undefined || bounds.w === 0 || bounds.h === 0) {
    return undefined;
  }
  const offset = {
    x: (size.x - bounds.w) / 2 - bounds.x,
    y: (size.y - bounds.h) / 2 - bounds.y,
  };
  if (offset.x === 0 && offset.y === 0) {
    return undefined;
  }
  return offset;
}

function isDocumentExternalRootMaskSource(node: FigNode): boolean {
  if (node.transform !== undefined || node.size !== undefined) {
    return false;
  }
  if (node.children !== undefined && node.children.length > 0) {
    return false;
  }
  if (node.strokeGeometry === undefined || node.strokeGeometry.length === 0) {
    return false;
  }
  if (node.fillGeometry === undefined || node.fillGeometry.length === 0) {
    return false;
  }
  if (hasVisiblePaintOrExternalEffect(node) || hasTextPayload(node)) {
    return false;
  }
  return true;
}

function hasVisiblePaintOrExternalEffect(node: FigNode): boolean {
  if (node.styleIdForFill !== undefined || node.styleIdForStrokeFill !== undefined || node.styleIdForEffect !== undefined) {
    return true;
  }
  if (visibleExternalDerivedPaints(node.fillPaints) !== undefined) {
    return true;
  }
  if (visibleExternalDerivedPaints(node.strokePaints) !== undefined) {
    return true;
  }
  return node.effects !== undefined && node.effects.some((effect) => effect.visible !== false);
}

function geometryBoundsFromKiwi(
  geometry: readonly FigFillGeometry[] | undefined,
  blobs: readonly FigBlob[],
): ExternalDerivedBounds | undefined {
  if (geometry === undefined || geometry.length === 0) {
    return undefined;
  }
  return geometry
    .map((entry) => geometryEntryBoundsFromKiwi(entry, blobs))
    .reduce<ExternalDerivedBounds | undefined>((acc, bounds) => unionExternalDerivedBounds(acc, bounds), undefined);
}

function geometryEntryBoundsFromKiwi(entry: FigFillGeometry, blobs: readonly FigBlob[]): ExternalDerivedBounds {
  const blobIndex = entry.commandsBlob;
  if (blobIndex === undefined) {
    throw new Error("SymbolResolver: document-external root mask geometry is missing commandsBlob");
  }
  const blob = blobs[blobIndex];
  if (blob === undefined) {
    throw new Error(`SymbolResolver: document-external root mask geometry references missing blob ${blobIndex}`);
  }
  return pathCommandsBoundingBox(decodePathCommands(blob));
}

function unionExternalDerivedBounds(
  left: ExternalDerivedBounds | undefined,
  right: ExternalDerivedBounds,
): ExternalDerivedBounds {
  if (left === undefined) {
    return right;
  }
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.w, right.x + right.w);
  const maxY = Math.max(left.y + left.h, right.y + right.h);
  return { x, y, w: maxX - x, h: maxY - y };
}

function translateExternalDerivedTopLevelNode(node: FigNode, offset: ExternalDerivedOffset): FigNode {
  return {
    ...node,
    transform: translateExternalDerivedTransform(node.transform, offset),
  };
}

function translateExternalDerivedTransform(
  transform: FigNode["transform"],
  offset: ExternalDerivedOffset,
): NonNullable<FigNode["transform"]> {
  if (transform === undefined) {
    return { m00: 1, m01: 0, m02: offset.x, m10: 0, m11: 1, m12: offset.y };
  }
  return {
    ...transform,
    m02: transform.m02 + offset.x,
    m12: transform.m12 + offset.y,
  };
}

function ensureExternalDerivedSlotPath(
  slots: Map<string, ExternalDerivedSlot>,
  path: readonly FigGuid[],
  scope: ExternalDerivedAddressScope = "prefixed",
  prefix: readonly FigGuid[] = [],
): ExternalDerivedSlot {
  const guid = path[0];
  if (guid === undefined) {
    throw new Error("SymbolResolver: document-external derived slot path is empty");
  }
  const slotPath = [...prefix, guid];
  const slot = ensureExternalDerivedSlot(slots, guid, slotPath, scope);
  const tail = path.slice(1);
  if (tail.length === 0) {
    return slot;
  }
  return ensureExternalDerivedSlotPath(slot.children, tail, scope, slotPath);
}

function ensureExternalDerivedSlot(
  slots: Map<string, ExternalDerivedSlot>,
  guid: FigGuid,
  path: readonly FigGuid[],
  scope: ExternalDerivedAddressScope,
): ExternalDerivedSlot {
  const key = guidToString(guid);
  const existing = slots.get(key);
  if (existing === undefined) {
    const slot: ExternalDerivedSlot = { guid, path, derivedPayloads: [], overridePayloads: [], children: new Map() };
    slots.set(key, slot);
    return slot;
  }
  if (scope === "prefixed") {
    requireSameFigGuidPath(existing.path, path);
  }
  return existing;
}

function materializeExternalDerivedSlots(
  slots: readonly ExternalDerivedSlot[],
  ctx: ExternalDerivedMaterializeContext,
): readonly FigNode[] {
  const nodes: FigNode[] = [];
  for (const slot of slots) {
    const node = materializeExternalDerivedSlot(slot, ctx);
    if (node !== undefined) {
      nodes.push(node);
    }
  }
  return nodes;
}

function materializeExternalDerivedSlot(
  slot: ExternalDerivedSlot,
  ctx: ExternalDerivedMaterializeContext,
): FigNode | undefined {
  const localNode = findNodeByGuid(ctx.document, slot.guid);
  const resolvedLocalInstance = materializeResolvedLocalInstanceSlot(slot, localNode, ctx);
  if (resolvedLocalInstance !== undefined) {
    return resolvedLocalInstance;
  }
  const childSlots = externalDerivedChildSlots(slot, localNode);
  const text = resolveExternalDerivedText(slot);
  const selectedSymbolRoot = documentExternalSelectedSymbolRootForSlot(slot, ctx, localNode);
  const nodeType = resolveExternalDerivedNodeType(slot, text, childSlots, localNode, selectedSymbolRoot);
  const node: MutableFigNode = {
    guid: slot.guid,
    phase: EXTERNAL_DERIVED_PHASE,
    type: externalDerivedNodeType(nodeType),
    name: `Document external slot ${guidToString(slot.guid)}`,
    visible: true,
    opacity: 1,
  };
  applyExternalDerivedLocalNodeFields(node, localNode, ctx.document);
  applyExternalDerivedSlotPayloadsToNode(node, slot);
  applyExternalDerivedText(node, text);
  applyExternalDerivedVisualContext(node, ctx.visualContext);
  const childCtx: ExternalDerivedMaterializeContext = {
    document: ctx.document,
    documents: ctx.documents,
    blobs: ctx.blobs,
    visualContext: externalDerivedVisualContextFromNode(node, ctx.visualContext),
    documentExternalSlotSymbolRoots: ctx.documentExternalSlotSymbolRoots,
    variableModeBySetMap: mergeVariableModeBySetMap(ctx.variableModeBySetMap, node.variableModeBySetMap),
  };
  const children = materializeExternalDerivedSlotChildren(childSlots, text, childCtx);
  applyDocumentExternalSelectedSymbolRootSurfaceFields(node, selectedSymbolRoot);
  if (!externalDerivedSlotContributesNode(slot, text, children, localNode)) {
    return undefined;
  }
  if (children.length > 0) {
    node.children = children;
  }
  return node;
}

function materializeResolvedLocalInstanceSlot(
  slot: ExternalDerivedSlot,
  localNode: FigNode | undefined,
  ctx: ExternalDerivedMaterializeContext,
): FigNode | undefined {
  if (localNode === undefined || getNodeType(localNode) !== "INSTANCE") {
    return undefined;
  }
  const resolution = resolveReferencesForNode(localNode, ctx.documents, ctx.variableModeBySetMap);
  if (resolution.effectiveSymbol === undefined) {
    return undefined;
  }
  const scopedLocalNode = scopedLocalInstanceForExternalDerivedSlot(localNode, slot);
  const resolved = resolveInstanceNode(scopedLocalNode, {
    document: ctx.document,
    documents: ctx.documents,
    blobs: ctx.blobs,
    variableModeBySetMap: ctx.variableModeBySetMap,
  });
  const node: MutableFigNode = {
    ...resolved.node,
    type: externalDerivedNodeType("FRAME"),
  };
  applyExternalDerivedSlotPayloadsToNode(node, slot);
  applyExternalDerivedVisualContext(node, ctx.visualContext);
  if (resolved.children.length > 0) {
    node.children = resolved.children;
  }
  return node;
}

function scopedLocalInstanceForExternalDerivedSlot(
  localNode: FigNode,
  slot: ExternalDerivedSlot,
): FigNode {
  const node: MutableFigNode = { ...localNode };
  applyExternalDerivedSlotPayloadsToNode(node, slot);
  applyScopedExternalDerivedSymbolOverrides(node, slot);
  applyScopedExternalDerivedData(node, slot);
  return node;
}

function applyScopedExternalDerivedSymbolOverrides(
  node: MutableFigNode,
  slot: ExternalDerivedSlot,
): void {
  const overrides = rebaseExternalDerivedDescendantPayloads(slot, "symbolOverride");
  if (overrides.length === 0) {
    return;
  }
  const symbolData = node.symbolData;
  if (symbolData === undefined) {
    throw new Error(`SymbolResolver: local INSTANCE slot ${guidToString(slot.guid)} has no symbolData for scoped symbol overrides`);
  }
  node.symbolData = {
    ...symbolData,
    symbolOverrides: [...(symbolData.symbolOverrides ?? []), ...overrides],
  };
}

function applyScopedExternalDerivedData(
  node: MutableFigNode,
  slot: ExternalDerivedSlot,
): void {
  const derived = rebaseExternalDerivedDescendantPayloads(slot, "derived");
  if (derived.length === 0) {
    return;
  }
  node.derivedSymbolData = [...(node.derivedSymbolData ?? []), ...derived];
}

function rebaseExternalDerivedDescendantPayloads(
  slot: ExternalDerivedSlot,
  source: ExternalDerivedEntrySource,
): readonly FigKiwiSymbolOverride[] {
  const scoped: FigKiwiSymbolOverride[] = [];
  for (const child of slot.children.values()) {
    collectRebasedExternalDerivedPayloads(slot.path, child, source, scoped);
  }
  return scoped;
}

function collectRebasedExternalDerivedPayloads(
  rootPath: readonly FigGuid[],
  slot: ExternalDerivedSlot,
  source: ExternalDerivedEntrySource,
  scoped: FigKiwiSymbolOverride[],
): void {
  for (const entry of externalDerivedPayloadEntriesForSource(slot, source)) {
    scoped.push(rebaseExternalDerivedPayload(rootPath, entry));
  }
  for (const child of slot.children.values()) {
    collectRebasedExternalDerivedPayloads(rootPath, child, source, scoped);
  }
}

function externalDerivedPayloadEntriesForSource(
  slot: ExternalDerivedSlot,
  source: ExternalDerivedEntrySource,
): readonly ExternalDerivedPayloadEntry[] {
  if (source === "derived") {
    return slot.derivedPayloads;
  }
  return slot.overridePayloads;
}

function rebaseExternalDerivedPayload(
  rootPath: readonly FigGuid[],
  entry: ExternalDerivedPayloadEntry,
): FigKiwiSymbolOverride {
  const payload = entry.payload;
  if (entry.scope === "local") {
    return payload;
  }
  const guids = payload.guidPath?.guids;
  if (guids === undefined || guids.length <= rootPath.length) {
    throw new Error(`SymbolResolver: document-external descendant entry under ${formatGuidPath(rootPath)} is missing a descendant guidPath`);
  }
  if (!figGuidPathStartsWith(guids, rootPath)) {
    throw new Error(
      `SymbolResolver: document-external descendant entry ${formatGuidPath(guids)} is not scoped under ${formatGuidPath(rootPath)}`,
    );
  }
  return {
    ...payload,
    guidPath: { guids: guids.slice(rootPath.length) },
  };
}

function figGuidEquals(left: FigGuid, right: FigGuid): boolean {
  return left.sessionID === right.sessionID && left.localID === right.localID;
}

function figGuidPathStartsWith(path: readonly FigGuid[], prefix: readonly FigGuid[]): boolean {
  if (path.length < prefix.length) {
    return false;
  }
  return prefix.every((guid, index) => figGuidEquals(path[index]!, guid));
}

function requireSameFigGuidPath(left: readonly FigGuid[], right: readonly FigGuid[]): void {
  if (left.length === right.length && figGuidPathStartsWith(left, right)) {
    return;
  }
  throw new Error(`SymbolResolver: document-external slot path mismatch ${formatGuidPath(left)} vs ${formatGuidPath(right)}`);
}

function formatGuidPath(path: readonly FigGuid[]): string {
  return path.map((guid) => guidToString(guid)).join("/");
}

function materializeExternalDerivedSlotChildren(
  slots: readonly ExternalDerivedSlot[],
  text: ExternalDerivedText | undefined,
  ctx: ExternalDerivedMaterializeContext,
): readonly FigNode[] {
  if (text?.absorbsChildSlots === true) {
    return [];
  }
  return markDocumentExternalLeadingMaskSource(materializeExternalDerivedSlots(slots, ctx));
}

function markDocumentExternalLeadingMaskSource(children: readonly FigNode[]): readonly FigNode[] {
  const firstChild = children[0];
  if (firstChild === undefined || !isDocumentExternalRootMaskSource(firstChild)) {
    return children;
  }
  if (firstChild.mask === true) {
    return children;
  }
  return [{ ...firstChild, mask: true }, ...children.slice(1)];
}

function applyExternalDerivedSlotPayloadsToNode(node: MutableFigNode, slot: ExternalDerivedSlot): void {
  for (const payload of slot.overridePayloads) {
    applyExternalDerivedPayloadToNode(node, payload.payload);
  }
  for (const payload of slot.derivedPayloads) {
    applyExternalDerivedPayloadToNode(node, payload.payload);
  }
}

function applyExternalDerivedPayloadToNode(node: MutableFigNode, payload: FigKiwiSymbolOverride): void {
  if (payload.overriddenSymbolID !== undefined && getNodeType(node) !== "INSTANCE") {
    applyKiwiOverrideToNode(node, { ...payload, overriddenSymbolID: undefined });
    return;
  }
  applyKiwiOverrideToNode(node, payload);
}

function externalDerivedChildSlots(
  slot: ExternalDerivedSlot,
  localNode: FigNode | undefined,
): readonly ExternalDerivedSlot[] {
  if (localNode !== undefined) {
    const slots = new Map<string, ExternalDerivedSlot>();
    addExternalDerivedEntriesToSlots(slots, localNode.derivedSymbolData ?? [], "derived", "local");
    addExternalDerivedEntriesToSlots(slots, localNode.symbolData?.symbolOverrides ?? [], "symbolOverride", "local");
    mergeExternalDerivedSlotMap(slots, slot.children);
    return Array.from(slots.values());
  }
  const slots = cloneExternalDerivedSlotMap(slot.children);
  return Array.from(slots.values());
}

function cloneExternalDerivedSlotMap(
  source: ReadonlyMap<string, ExternalDerivedSlot>,
): Map<string, ExternalDerivedSlot> {
  const slots = new Map<string, ExternalDerivedSlot>();
  for (const [key, slot] of source) {
    slots.set(key, {
      guid: slot.guid,
      path: slot.path,
      derivedPayloads: [...slot.derivedPayloads],
      overridePayloads: [...slot.overridePayloads],
      children: cloneExternalDerivedSlotMap(slot.children),
    });
  }
  return slots;
}

function mergeExternalDerivedSlotMap(
  target: Map<string, ExternalDerivedSlot>,
  source: ReadonlyMap<string, ExternalDerivedSlot>,
): void {
  for (const slot of source.values()) {
    mergeExternalDerivedSlot(target, slot);
  }
}

function mergeExternalDerivedSlot(
  target: Map<string, ExternalDerivedSlot>,
  incoming: ExternalDerivedSlot,
): void {
  const key = guidToString(incoming.guid);
  const existing = target.get(key);
  if (existing === undefined) {
    target.set(key, cloneExternalDerivedSlot(incoming));
    return;
  }
  target.set(key, {
    guid: existing.guid,
    path: resolveMergedExternalDerivedSlotPath(existing, incoming),
    derivedPayloads: [...existing.derivedPayloads, ...incoming.derivedPayloads],
    overridePayloads: [...existing.overridePayloads, ...incoming.overridePayloads],
    children: mergeExternalDerivedChildSlotMaps(existing.children, incoming.children),
  });
}

function cloneExternalDerivedSlot(slot: ExternalDerivedSlot): ExternalDerivedSlot {
  return {
    guid: slot.guid,
    path: slot.path,
    derivedPayloads: [...slot.derivedPayloads],
    overridePayloads: [...slot.overridePayloads],
    children: cloneExternalDerivedSlotMap(slot.children),
  };
}

function mergeExternalDerivedChildSlotMaps(
  existing: ReadonlyMap<string, ExternalDerivedSlot>,
  incoming: ReadonlyMap<string, ExternalDerivedSlot>,
): Map<string, ExternalDerivedSlot> {
  const children = cloneExternalDerivedSlotMap(existing);
  mergeExternalDerivedSlotMap(children, incoming);
  return children;
}

function resolveMergedExternalDerivedSlotPath(
  existing: ExternalDerivedSlot,
  incoming: ExternalDerivedSlot,
): readonly FigGuid[] {
  if (figGuidPathStartsWith(existing.path, incoming.path) && existing.path.length === incoming.path.length) {
    return existing.path;
  }
  if (figGuidPathEndsWith(incoming.path, existing.path)) {
    return incoming.path;
  }
  if (figGuidPathEndsWith(existing.path, incoming.path)) {
    return existing.path;
  }
  throw new Error(
    `SymbolResolver: document-external child slot path mismatch ${formatGuidPath(existing.path)} vs ${formatGuidPath(incoming.path)}`,
  );
}

function figGuidPathEndsWith(path: readonly FigGuid[], suffix: readonly FigGuid[]): boolean {
  if (path.length < suffix.length) {
    return false;
  }
  const offset = path.length - suffix.length;
  return suffix.every((guid, index) => figGuidEquals(path[offset + index]!, guid));
}

function addExternalDerivedEntriesToSlots(
  slots: Map<string, ExternalDerivedSlot>,
  entries: readonly FigKiwiSymbolOverride[],
  source: ExternalDerivedEntrySource,
  scope: ExternalDerivedAddressScope,
): void {
  for (const entry of entries) {
    const path = entry.guidPath?.guids;
    if (path === undefined || path.length === 0) {
      throw new Error("SymbolResolver: document-external local derived entry is missing guidPath");
    }
    addExternalDerivedEntryToSlot(ensureExternalDerivedSlotPath(slots, path, scope), entry, source, scope);
  }
}

function addExternalDerivedEntryToSlot(
  slot: ExternalDerivedSlot,
  entry: FigKiwiSymbolOverride,
  source: ExternalDerivedEntrySource,
  scope: ExternalDerivedAddressScope,
): void {
  const payloadEntry = { payload: entry, scope };
  if (source === "derived") {
    slot.derivedPayloads.push(payloadEntry);
    return;
  }
  slot.overridePayloads.push(payloadEntry);
}

const EXTERNAL_DERIVED_LOCAL_NODE_FIELDS = [
  "name",
  "visible",
  "opacity",
  "blendMode",
  "mask",
  "maskIsOutline",
  "maskType",
  "clipsContent",
  "frameMaskDisabled",
  "transform",
  "size",
  "fillPaints",
  "backgroundPaints",
  "strokePaints",
  "strokeWeight",
  "individualStrokeWeights",
  "strokeJoin",
  "strokeCap",
  "strokeAlign",
  "strokeDashes",
  "borderTopWeight",
  "borderRightWeight",
  "borderBottomWeight",
  "borderLeftWeight",
  "borderStrokeWeightsIndependent",
  "borderTopHidden",
  "borderRightHidden",
  "borderBottomHidden",
  "borderLeftHidden",
  "cornerRadius",
  "rectangleCornerRadii",
  "rectangleTopLeftCornerRadius",
  "rectangleTopRightCornerRadius",
  "rectangleBottomRightCornerRadius",
  "rectangleBottomLeftCornerRadius",
  "rectangleCornerRadiiIndependent",
  "cornerSmoothing",
  "fillGeometry",
  "strokeGeometry",
  "vectorPaths",
  "vectorData",
  "effects",
  "styleIdForFill",
  "styleIdForStrokeFill",
  "styleIdForText",
  "styleIdForEffect",
  "styleIdForGrid",
  "characters",
  "fontSize",
  "fontName",
  "textAlignHorizontal",
  "textAlignVertical",
  "textAutoResize",
  "textDecoration",
  "textCase",
  "lineHeight",
  "letterSpacing",
  "textTruncation",
  "leadingTrim",
  "fontVariations",
  "textTracking",
  "textData",
  "derivedTextData",
  "componentPropAssignments",
  "variableConsumptionMap",
  "parameterConsumptionMap",
  "variableModeBySetMap",
  "stackMode",
  "stackSpacing",
  "stackPadding",
  "stackVerticalPadding",
  "stackHorizontalPadding",
  "stackPaddingRight",
  "stackPaddingBottom",
  "stackPrimaryAlignItems",
  "stackCounterAlignItems",
  "stackPrimaryAlignContent",
  "stackCounterAlignContent",
  "stackCounterSpacing",
  "stackCounterSizing",
  "stackPrimarySizing",
  "stackWrap",
  "stackReverseZIndex",
  "stackChildAlignSelf",
  "stackChildPrimaryGrow",
  "stackPositioning",
  "overriddenSymbolID",
] as const satisfies readonly (keyof FigNode)[];

const EXTERNAL_DERIVED_LOCAL_STACK_LAYOUT_FIELDS: ReadonlySet<keyof FigNode> = new Set<keyof FigNode>([
  "stackMode",
  "stackSpacing",
  "stackPadding",
  "stackVerticalPadding",
  "stackHorizontalPadding",
  "stackPaddingRight",
  "stackPaddingBottom",
  "stackPrimaryAlignItems",
  "stackCounterAlignItems",
  "stackPrimaryAlignContent",
  "stackCounterAlignContent",
  "stackCounterSpacing",
  "stackCounterSizing",
  "stackPrimarySizing",
  "stackWrap",
  "stackReverseZIndex",
  "stackChildAlignSelf",
  "stackChildPrimaryGrow",
  "stackPositioning",
]);

const EXTERNAL_DERIVED_LOCAL_NODE_FIELDS_WITHOUT_STACK_LAYOUT = EXTERNAL_DERIVED_LOCAL_NODE_FIELDS.filter(
  (field) => !EXTERNAL_DERIVED_LOCAL_STACK_LAYOUT_FIELDS.has(field),
);

const DOCUMENT_EXTERNAL_SELECTED_SYMBOL_ROOT_SURFACE_FIELDS = [
  "size",
  "visible",
  "opacity",
  "blendMode",
  "clipsContent",
  "frameMaskDisabled",
  "fillPaints",
  "backgroundPaints",
  "strokePaints",
  "strokeWeight",
  "individualStrokeWeights",
  "strokeJoin",
  "strokeCap",
  "strokeAlign",
  "strokeDashes",
  "borderTopWeight",
  "borderRightWeight",
  "borderBottomWeight",
  "borderLeftWeight",
  "borderStrokeWeightsIndependent",
  "borderTopHidden",
  "borderRightHidden",
  "borderBottomHidden",
  "borderLeftHidden",
  "cornerRadius",
  "rectangleCornerRadii",
  "rectangleTopLeftCornerRadius",
  "rectangleTopRightCornerRadius",
  "rectangleBottomRightCornerRadius",
  "rectangleBottomLeftCornerRadius",
  "rectangleCornerRadiiIndependent",
  "cornerSmoothing",
  "effects",
  "styleIdForFill",
  "styleIdForStrokeFill",
  "styleIdForEffect",
  "styleIdForGrid",
] as const satisfies readonly (keyof FigNode)[];

function applyExternalDerivedLocalNodeFields(
  node: MutableFigNode,
  localNode: FigNode | undefined,
  document: FigKiwiDocumentIndex,
): void {
  if (localNode === undefined) {
    return;
  }
  const fields = externalDerivedLocalNodeFields(localNode, document);
  const target = node as Record<string, unknown>;
  const source = localNode as Record<string, unknown>;
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined) {
      target[field] = value;
    }
  }
}

function documentExternalSelectedSymbolRootForSlot(
  slot: ExternalDerivedSlot,
  ctx: ExternalDerivedMaterializeContext,
  localNode: FigNode | undefined,
): FigNode | undefined {
  if (localNode !== undefined || slot.path.length !== 1) {
    return undefined;
  }
  return ctx.documentExternalSlotSymbolRoots?.get(guidToString(slot.guid));
}

function applyDocumentExternalSelectedSymbolRootSurfaceFields(
  node: MutableFigNode,
  symbolRoot: FigNode | undefined,
): void {
  if (symbolRoot === undefined) {
    return;
  }
  const target = node as Record<string, unknown>;
  const source = symbolRoot as Record<string, unknown>;
  for (const field of DOCUMENT_EXTERNAL_SELECTED_SYMBOL_ROOT_SURFACE_FIELDS) {
    if (target[field] !== undefined) {
      continue;
    }
    const value = source[field];
    if (value !== undefined) {
      target[field] = value;
    }
  }
}

function externalDerivedLocalNodeFields(
  localNode: FigNode,
  document: FigKiwiDocumentIndex,
): readonly (keyof FigNode)[] {
  if (!isUnresolvedExternalInstanceLocalNode(localNode, document)) {
    return EXTERNAL_DERIVED_LOCAL_NODE_FIELDS;
  }
  return EXTERNAL_DERIVED_LOCAL_NODE_FIELDS_WITHOUT_STACK_LAYOUT;
}

function isUnresolvedExternalInstanceLocalNode(
  localNode: FigNode,
  document: FigKiwiDocumentIndex,
): boolean {
  if (getNodeType(localNode) !== "INSTANCE") {
    return false;
  }
  if (localNode.symbolData?.symbolID === undefined) {
    return false;
  }
  return resolveReferencesForNode(
    localNode,
    { primary: document, sources: [] },
    localNode.variableModeBySetMap,
  ).effectiveSymbol === undefined;
}

function externalDerivedVisualContextFromNode(
  node: FigNode,
  inherited: ExternalDerivedVisualContext | undefined,
): ExternalDerivedVisualContext | undefined {
  const fillPaints = visibleExternalDerivedPaints(node.fillPaints) ?? inherited?.fillPaints;
  const strokePaints = visibleExternalDerivedPaints(node.strokePaints) ?? inherited?.strokePaints;
  const styleIdForFill = node.styleIdForFill ?? inherited?.styleIdForFill;
  const styleIdForStrokeFill = node.styleIdForStrokeFill ?? inherited?.styleIdForStrokeFill;
  const styleIdForEffect = node.styleIdForEffect ?? inherited?.styleIdForEffect;
  if (
    fillPaints === undefined &&
    strokePaints === undefined &&
    styleIdForFill === undefined &&
    styleIdForStrokeFill === undefined &&
    styleIdForEffect === undefined
  ) {
    return undefined;
  }
  return { fillPaints, strokePaints, styleIdForFill, styleIdForStrokeFill, styleIdForEffect };
}

function visibleExternalDerivedPaints(paints: FigNode["fillPaints"]): FigNode["fillPaints"] | undefined {
  if (paints === undefined || paints.length === 0) {
    return undefined;
  }
  return paints.some((paint) => paint.visible !== false) ? paints : undefined;
}

function applyExternalDerivedVisualContext(
  node: MutableFigNode,
  context: ExternalDerivedVisualContext | undefined,
): void {
  if (context === undefined) {
    return;
  }
  applyExternalDerivedFillContext(node, context);
  applyExternalDerivedStrokeContext(node, context);
  applyExternalDerivedEffectContext(node, context);
}

function applyExternalDerivedFillContext(
  node: MutableFigNode,
  context: ExternalDerivedVisualContext,
): void {
  if (!externalDerivedNeedsFillContext(node)) {
    return;
  }
  if (context.fillPaints !== undefined) {
    node.fillPaints = context.fillPaints;
  }
  if (context.styleIdForFill !== undefined) {
    node.styleIdForFill = context.styleIdForFill;
  }
}

function applyExternalDerivedStrokeContext(
  node: MutableFigNode,
  context: ExternalDerivedVisualContext,
): void {
  if (!externalDerivedNeedsStrokeContext(node)) {
    return;
  }
  if (context.strokePaints !== undefined) {
    node.strokePaints = context.strokePaints;
  }
  if (context.styleIdForStrokeFill !== undefined) {
    node.styleIdForStrokeFill = context.styleIdForStrokeFill;
  }
}

function applyExternalDerivedEffectContext(
  node: MutableFigNode,
  context: ExternalDerivedVisualContext,
): void {
  if (node.effects === undefined || node.styleIdForEffect !== undefined || context.styleIdForEffect === undefined) {
    return;
  }
  node.styleIdForEffect = context.styleIdForEffect;
}

function externalDerivedNeedsFillContext(node: FigNode): boolean {
  if (node.fillPaints !== undefined || node.styleIdForFill !== undefined) {
    return false;
  }
  return hasGeometry(node.fillGeometry) || hasVectorPaths(node) || hasTextPayload(node);
}

function externalDerivedNeedsStrokeContext(node: FigNode): boolean {
  if (node.strokePaints !== undefined || node.styleIdForStrokeFill !== undefined) {
    return false;
  }
  return hasGeometry(node.strokeGeometry);
}

function localNodeContributesExternalDerivedNode(node: FigNode): boolean {
  if (node.visible === false) {
    return false;
  }
  if (hasGeometry(node.fillGeometry) || hasGeometry(node.strokeGeometry) || hasVectorPaths(node)) {
    return true;
  }
  if (visibleExternalDerivedPaints(node.fillPaints) !== undefined) {
    return true;
  }
  if (visibleExternalDerivedPaints(node.strokePaints) !== undefined) {
    return true;
  }
  if (node.effects !== undefined && node.effects.length > 0) {
    return true;
  }
  if (node.characters !== undefined || node.textData !== undefined || node.derivedTextData !== undefined) {
    return true;
  }
  return node.size !== undefined;
}

function externalDerivedSlotContributesNode(
  slot: ExternalDerivedSlot,
  text: ExternalDerivedText | undefined,
  children: readonly FigNode[],
  localNode: FigNode | undefined,
): boolean {
  if (text !== undefined || children.length > 0) {
    return true;
  }
  if (localNode !== undefined && localNodeContributesExternalDerivedNode(localNode)) {
    return true;
  }
  return externalDerivedPayloads(slot).some((payload) => {
    if (payload.overriddenSymbolID !== undefined) {
      return true;
    }
    if (kiwiSymbolOverrideCarriesGeometry(payload)) {
      return true;
    }
    if (payload.fillPaints !== undefined && payload.fillPaints.length > 0) {
      return true;
    }
    if (payload.strokePaints !== undefined && payload.strokePaints.length > 0) {
      return true;
    }
    if (payload.effects !== undefined && payload.effects.length > 0) {
      return true;
    }
    return (
      payload.styleIdForFill !== undefined ||
      payload.styleIdForStrokeFill !== undefined ||
      payload.styleIdForEffect !== undefined
    );
  });
}

function externalDerivedNodeType(type: FigNodeType): FigNode["type"] {
  return { value: -1, name: type };
}

function resolveExternalDerivedNodeType(
  slot: ExternalDerivedSlot,
  text: ExternalDerivedText | undefined,
  childSlots: readonly ExternalDerivedSlot[],
  localNode: FigNode | undefined,
  selectedSymbolRoot: FigNode | undefined,
): FigNodeType {
  if (text !== undefined) {
    return "TEXT";
  }
  if (selectedSymbolRoot !== undefined) {
    return resolveExternalDerivedSelectedSymbolContainerNodeType(slot, selectedSymbolRoot);
  }
  if (childSlots.length > 0) {
    return resolveExternalDerivedContainerNodeType(slot, localNode);
  }
  if (externalDerivedPayloads(slot).some((payload) => kiwiSymbolOverrideCarriesGeometry(payload))) {
    return "VECTOR";
  }
  if (externalDerivedPayloads(slot).some((payload) => payload.overriddenSymbolID !== undefined)) {
    return "INSTANCE";
  }
  if (externalDerivedPayloads(slot).some((payload) => payload.size !== undefined)) {
    return "FRAME";
  }
  return "GROUP";
}

function resolveExternalDerivedSelectedSymbolContainerNodeType(
  slot: ExternalDerivedSlot,
  selectedSymbolRoot: FigNode,
): FigNodeType {
  if (selectedSymbolRoot.size !== undefined || externalDerivedSlotHasSize(slot)) {
    return "FRAME";
  }
  return "GROUP";
}

function resolveExternalDerivedContainerNodeType(
  slot: ExternalDerivedSlot,
  localNode: FigNode | undefined,
): FigNodeType {
  if (localNode !== undefined) {
    return resolveExternalDerivedLocalContainerNodeType(slot, localNode);
  }
  if (externalDerivedSlotHasSize(slot)) {
    return "FRAME";
  }
  return "GROUP";
}

function resolveExternalDerivedLocalContainerNodeType(
  slot: ExternalDerivedSlot,
  localNode: FigNode,
): FigNodeType {
  const typeName = getNodeType(localNode);
  switch (typeName) {
    case "INSTANCE":
      requireExternalDerivedContainerSize(slot, localNode);
      return "FRAME";
    case "FRAME":
    case "SECTION":
    case "SLIDE":
    case "SYMBOL":
      requireExternalDerivedContainerSize(slot, localNode);
      return typeName;
    default:
      if (externalDerivedSlotHasSize(slot)) {
        return "FRAME";
      }
      return "GROUP";
  }
}

function requireExternalDerivedContainerSize(
  slot: ExternalDerivedSlot,
  localNode: FigNode,
): void {
  if (localNode.size !== undefined) {
    return;
  }
  if (externalDerivedSlotHasSize(slot)) {
    return;
  }
  throw new Error(
    `SymbolResolver: document-external local ${getNodeType(localNode)} slot ${guidToString(slot.guid)} has materialized children but no Kiwi size`,
  );
}

function externalDerivedSlotHasSize(slot: ExternalDerivedSlot): boolean {
  return externalDerivedPayloads(slot).some((payload) => payload.size !== undefined);
}

function hasGeometry(geometry: FigNode["fillGeometry"]): boolean {
  return geometry !== undefined && geometry.length > 0;
}

function hasVectorPaths(node: FigNode): boolean {
  return node.vectorPaths !== undefined && node.vectorPaths.length > 0;
}

function hasTextPayload(node: FigNode): boolean {
  return node.characters !== undefined || node.textData !== undefined || node.derivedTextData !== undefined;
}

function resolveExternalDerivedText(slot: ExternalDerivedSlot): ExternalDerivedText | undefined {
  const payloads = externalDerivedPayloads(slot);
  const direct = findDirectDerivedTextData(payloads);
  const textValue = findTextAssignmentValue(payloads);
  if (direct !== undefined) {
    return { derivedTextData: direct, textValue, absorbsChildSlots: false };
  }
  const nested = findNestedDerivedTextData(slot.children);
  if (textValue === undefined || nested.length !== 1) {
    return undefined;
  }
  return { derivedTextData: nested[0], textValue, absorbsChildSlots: true };
}

function findDirectDerivedTextData(payloads: readonly FigKiwiSymbolOverride[]): FigDerivedTextData | undefined {
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const derivedTextData = payloads[index]!.derivedTextData;
    if (derivedTextData !== undefined) {
      return derivedTextData;
    }
  }
  return undefined;
}

function findNestedDerivedTextData(slots: ReadonlyMap<string, ExternalDerivedSlot>): readonly FigDerivedTextData[] {
  return Array.from(slots.values()).flatMap((slot) => {
    const direct = findDirectDerivedTextData(externalDerivedPayloads(slot));
    const nested = findNestedDerivedTextData(slot.children);
    if (direct === undefined) {
      return nested;
    }
    return [direct, ...nested];
  });
}

function findTextAssignmentValue(
  payloads: readonly FigKiwiSymbolOverride[],
): NonNullable<FigComponentPropAssignment["value"]["textValue"]> | undefined {
  for (let payloadIndex = payloads.length - 1; payloadIndex >= 0; payloadIndex -= 1) {
    const assignments = payloads[payloadIndex]!.componentPropAssignments ?? [];
    for (let assignmentIndex = assignments.length - 1; assignmentIndex >= 0; assignmentIndex -= 1) {
      const assignment = assignments[assignmentIndex]!;
      const textValue = assignment.value.textValue;
      if (textValue !== undefined) {
        return textValue;
      }
    }
  }
  return undefined;
}

function applyExternalDerivedText(node: MutableFigNode, text: ExternalDerivedText | undefined): void {
  if (text === undefined) {
    return;
  }
  const characters = text.textValue?.characters ?? derivedGlyphCharacters(text.derivedTextData);
  node.derivedTextData = text.derivedTextData;
  node.characters = characters;
  node.textData = buildExternalDerivedTextData(text.derivedTextData, characters, text.textValue);
  if (node.size === undefined) {
    node.size = text.derivedTextData.layoutSize;
  }
}

function buildExternalDerivedTextData(
  derivedTextData: FigDerivedTextData,
  characters: string,
  textValue: NonNullable<FigComponentPropAssignment["value"]["textValue"]> | undefined,
): FigKiwiTextData {
  const fontSize = requireExternalDerivedFontSize(derivedTextData);
  return {
    ...(textValue ?? { characters }),
    characters,
    fontName: requireExternalDerivedFontName(derivedTextData),
    fontSize,
    lineHeight: requireExternalDerivedLineHeight(derivedTextData, fontSize),
  };
}

function derivedGlyphCharacters(derivedTextData: FigDerivedTextData): string {
  const glyphs = derivedTextData.glyphs;
  if (glyphs === undefined || glyphs.length === 0) {
    return "";
  }
  const length = glyphs.reduce((max, glyph, index) => Math.max(max, (glyph.firstCharacter ?? index) + 1), 0);
  return "\uFFFC".repeat(length);
}

function firstExternalDerivedFontMetaData(derivedTextData: FigDerivedTextData): FigFontMetaData | undefined {
  return derivedTextData.fontMetaData?.[0];
}

function requireExternalDerivedFontName(derivedTextData: FigDerivedTextData): NonNullable<FigKiwiTextData["fontName"]> {
  const key = firstExternalDerivedFontMetaData(derivedTextData)?.key;
  if (typeof key?.family !== "string" || typeof key.style !== "string") {
    throw new Error("SymbolResolver: document-external derived text data is missing font metadata");
  }
  return {
    family: key.family,
    style: key.style,
    ...(typeof key.postscript === "string" ? { postscript: key.postscript } : {}),
  };
}

function requireExternalDerivedFontSize(derivedTextData: FigDerivedTextData): number {
  const fontSize = derivedTextData.glyphs?.find((glyph) => typeof glyph.fontSize === "number")?.fontSize;
  if (typeof fontSize !== "number") {
    throw new Error("SymbolResolver: document-external derived text data is missing glyph fontSize");
  }
  return fontSize;
}

function requireExternalDerivedLineHeight(
  derivedTextData: FigDerivedTextData,
  fontSize: number,
): FigValueWithUnits {
  const lineHeightRatio = firstExternalDerivedFontMetaData(derivedTextData)?.fontLineHeight;
  if (typeof lineHeightRatio === "number") {
    return { value: lineHeightRatio, units: RAW_NUMBER_UNITS };
  }
  const lineHeight = derivedTextData.baselines?.find((baseline) => typeof baseline.lineHeight === "number")?.lineHeight;
  if (typeof lineHeight === "number") {
    return { value: lineHeight, units: PIXELS_NUMBER_UNITS };
  }
  if (fontSize > 0) {
    throw new Error("SymbolResolver: document-external derived text data is missing line height");
  }
  throw new Error("SymbolResolver: document-external derived text data has invalid fontSize");
}

function applyResolvedInstanceSize(
  mergedNode: MutableFigNode,
  resized: { readonly sizeApplied: boolean; readonly instanceSize: NonNullable<FigNode["size"]> },
): void {
  if (!resized.sizeApplied) {
    return;
  }
  mergedNode.size = resized.instanceSize;
}

function resolveResizedInstanceChildren(
  input: {
    readonly children: readonly FigNode[];
    readonly derivedSymbolData: readonly FigKiwiSymbolOverride[] | undefined;
    readonly instanceSize: FigNode["size"];
    readonly symbolSize: FigNode["size"];
  },
): { readonly children: readonly FigNode[]; readonly sizeApplied: boolean; readonly instanceSize: NonNullable<FigNode["size"]> } | undefined {
  if (input.instanceSize === undefined || input.symbolSize === undefined) {
    return undefined;
  }
  if (input.instanceSize.x === input.symbolSize.x && input.instanceSize.y === input.symbolSize.y) {
    return undefined;
  }
  const layout = resolveInstanceLayout({
    children: input.children,
    symbolSize: input.symbolSize,
    instanceSize: input.instanceSize,
    derivedSymbolData: input.derivedSymbolData,
  });
  return { children: layout.children, sizeApplied: layout.sizeApplied, instanceSize: input.instanceSize };
}

function buildSupersededSymbolSlotIndex(
  node: FigNode,
  effectiveSymbol: ResolvedSymbolTarget,
  documents: SymbolResolverDocuments,
): SymbolSlotIndex | undefined {
  const pair = extractSymbolIDPair(node);
  if (pair === undefined) {
    return undefined;
  }
  if (guidToString(pair.symbolID) === guidToString(effectiveSymbol.guid)) {
    return undefined;
  }
  const primarySymbol = resolveSymbolTarget(pair.symbolID, documents);
  if (primarySymbol === undefined) {
    return undefined;
  }
  return buildSymbolSlotIndex(primarySymbol.node, primarySymbol.document.childrenOf);
}

function buildInactiveVariantFamilySlotIndex(
  effectiveSymbol: ResolvedSymbolTarget,
): SymbolSlotIndex | undefined {
  const document = effectiveSymbol.document;
  const parentGuid = effectiveSymbol.node.parentIndex?.guid;
  if (parentGuid === undefined) {
    return undefined;
  }
  const parent = findNodeByGuid(document, parentGuid);
  if (parent === undefined || !isVariantSetFrame(parent)) {
    return undefined;
  }
  const inactiveSymbols = document.childrenOf(parent).filter((node) => (
    getNodeType(node) === "SYMBOL" && !figGuidEquals(node.guid, effectiveSymbol.guid)
  ));
  if (inactiveSymbols.length === 0) {
    return undefined;
  }
  return mergeSymbolSlotIndexes(inactiveSymbols.map((symbol) => buildSymbolSlotIndex(symbol, document.childrenOf)));
}

function mergeSymbolSlotIndexes(indexes: readonly SymbolSlotIndex[]): SymbolSlotIndex {
  const guidToSlot = new Map<string, { readonly guid: FigGuid }>();
  const exactSlotMap = new Map<string, string>();
  for (const index of indexes) {
    for (const [key, value] of index.guidToSlot) {
      if (!guidToSlot.has(key)) {
        guidToSlot.set(key, value);
      }
    }
    for (const [key, value] of index.exactSlotMap) {
      if (!exactSlotMap.has(key)) {
        exactSlotMap.set(key, value);
      }
    }
  }
  return { guidToSlot, exactSlotMap };
}

function selectOverridesForEffectiveSymbol<T extends FigKiwiSymbolOverride>(
  entries: readonly T[] | undefined,
  effectiveSlotIndex: SymbolSlotIndex,
  supersededSlotIndex: SymbolSlotIndex | undefined,
  inactiveVariantSlotIndex: SymbolSlotIndex | undefined,
): readonly T[] | undefined {
  if (entries === undefined) {
    return entries;
  }
  if (supersededSlotIndex === undefined && inactiveVariantSlotIndex === undefined) {
    return entries;
  }
  const selected = entries.filter((entry) => overrideTargetsEffectiveSymbol(
    entry,
    effectiveSlotIndex,
    supersededSlotIndex,
    inactiveVariantSlotIndex,
  ));
  if (selected.length === entries.length) {
    return entries;
  }
  return selected;
}

function overrideTargetsEffectiveSymbol(
  entry: FigKiwiSymbolOverride,
  effectiveSlotIndex: SymbolSlotIndex,
  supersededSlotIndex: SymbolSlotIndex | undefined,
  inactiveVariantSlotIndex: SymbolSlotIndex | undefined,
): boolean {
  const firstGuid = entry.guidPath?.guids?.[0];
  if (firstGuid === undefined) {
    return true;
  }
  const firstKey = guidToString(firstGuid);
  if (effectiveSlotIndex.exactSlotMap.has(firstKey)) {
    return true;
  }
  if (supersededSlotIndex?.exactSlotMap.has(firstKey) === true) {
    return false;
  }
  if (inactiveVariantSlotIndex?.exactSlotMap.has(firstKey) === true) {
    return false;
  }
  return true;
}

function bindSelfOverridesToSymbolRoot<T extends FigKiwiSymbolOverride>(
  entries: readonly T[] | undefined,
  symRootGuid: FigGuid,
  exactSlotMap: ReadonlyMap<string, string>,
  materializedSlotResolution: SymbolOverrideSlotResolution,
): readonly T[] | undefined {
  if (entries === undefined) {
    return entries;
  }
  const bound = entries.map((entry) => {
    if (!shouldBindInstanceSelfOverrideToRoot(entry, symRootGuid, exactSlotMap, materializedSlotResolution)) {
      return entry;
    }
    return { ...entry, guidPath: { guids: [symRootGuid] } } as T;
  });
  const changed = bound.some((entry, index) => entry !== entries[index]);
  return changed ? bound : entries;
}

function shouldBindInstanceSelfOverrideToRoot(
  entry: FigKiwiSymbolOverride,
  symRootGuid: FigGuid,
  exactSlotMap: ReadonlyMap<string, string>,
  materializedSlotResolution: SymbolOverrideSlotResolution,
): boolean {
  if (!isInstanceSelfOverride(entry)) {
    return false;
  }
  const firstGuid = entry.guidPath?.guids?.[0];
  if (firstGuid === undefined) {
    return false;
  }
  if (materializedSlotResolution.has(guidToString(firstGuid))) {
    return false;
  }
  const rootKey = guidToString(symRootGuid);
  const addressedSlot = exactSlotMap.get(guidToString(firstGuid));
  if (addressedSlot === undefined) {
    return true;
  }
  return addressedSlot === rootKey;
}

function partitionSymbolRootOverrides<T extends FigKiwiSymbolOverride>(
  entries: readonly T[] | undefined,
  symRootGuidStr: string,
): { readonly selves: readonly T[]; readonly rest: readonly T[] } {
  const selves: T[] = [];
  const rest: T[] = [];
  for (const entry of entries ?? []) {
    if (isSelfOverrideTargetingRoot(entry, symRootGuidStr)) {
      selves.push(entry);
      continue;
    }
    rest.push(entry);
  }
  return { selves, rest };
}

function isSelfOverrideTargetingRoot(
  entry: FigKiwiSymbolOverride,
  symRootGuidStr: string,
): boolean {
  const guids = entry.guidPath?.guids;
  if (!guids || guids.length !== 1) {
    return false;
  }
  return guidToString(guids[0]) === symRootGuidStr;
}
