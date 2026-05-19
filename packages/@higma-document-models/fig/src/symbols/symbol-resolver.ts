/**
 * @file Symbol resolution for INSTANCE nodes
 */

import type {
  FigComponentPropAssignment,
  FigDerivedTextData,
  FigGuid,
  FigKiwiSymbolData,
  FigKiwiSymbolOverride,
  FigNode,
  MutableFigNode,
} from "@higma-document-models/fig/types";
import {
  findNodeByGuid,
  getNodeType,
  guidToString,
  isFigGuid,
  type FigKiwiDocumentIndex,
} from "../domain";
import { resolveInstanceLayout } from "./constraints";
import type { FigStyleRegistry } from "../domain";
import { resolveStyleIdOnMutableNode } from "./style-registry";
import { resolveVariantOverride } from "./variable-resolution";

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
  "blendMode",
  "clipsContent",
  "frameMaskDisabled",
  "mask",
  // Style-id slots — the `{guid: 0xFFFFFFFF:0xFFFFFFFF}` sentinel
  // detaches a style binding; concrete style ids re-bind. The
  // applier writes the field onto the merged node; style-id-for-fill /
  // style-id-for-stroke trigger a `resolveStyleIdOnMutableNode`
  // pass to expand style bindings into concrete paint arrays.
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
};

export type SymbolResolver = {
  readonly resolveReferences: (node: FigNode) => InstanceResolution;
  readonly resolveInstanceTarget: (node: FigNode, overrideSymbolID?: FigGuid) => ResolvedSymbolTarget | undefined;
  readonly resolveInstance: (node: FigNode) => ResolvedInstanceNode;
  readonly childrenOfResolvedNode: (node: FigNode) => readonly FigNode[];
};

export type SymbolResolverInput = {
  readonly document: FigKiwiDocumentIndex;
  readonly styleRegistry?: FigStyleRegistry;
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
  document: FigKiwiDocumentIndex,
): ResolvedSymbolTarget | undefined {
  const exact = findNodeByGuid(document, symbolID);
  if (exact === undefined) { return undefined; }
  if (getNodeType(exact) !== "SYMBOL") { return undefined; }
  return { node: exact, guid: exact.guid };
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
  const resolveInstanceTarget = (node: FigNode, overrideSymbolID?: FigGuid): ResolvedSymbolTarget | undefined => {
    const pair = extractSymbolIDPair(node);
    if (!pair) { return undefined; }
    const targetSymbolID = overrideSymbolID ?? pair.overriddenSymbolID ?? pair.symbolID;
    return resolveSymbolTarget(targetSymbolID, document);
  };
  const resolveReferences = (node: FigNode): InstanceResolution => resolveReferencesForNode(node, document);
  const resolveInstance = (node: FigNode): ResolvedInstanceNode => resolveInstanceNodeWithResolver(node, {
    document,
    resolveReferences,
    styleRegistry: input.styleRegistry,
  });

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
 *   1. `overriddenSymbolID` (explicit author-set variant override).
 *   2. `symbolID` + RESOLVE_VARIANT (variable-driven variant selection
 *      via `variableConsumptionMap`).
 *   3. `symbolID` (the static reference).
 *
 * `RESOLVE_VARIANT` only fires when the INSTANCE has no
 * `overriddenSymbolID` AND its `symbolID`'s parent is a Variant Set
 * (a FRAME with `isStateGroup` + VARIANT-typed `componentPropDefs`).
 * The canonical schema has no COMPONENT_SET NodeType — see
 * `docs/refactor/component-type-cleanup.md`. Most fixtures have all
 * properties resolving to library-only aliases, in which case the
 * evaluator bails and we fall through to step 3 — this is the same
 * behaviour the renderer had before this evaluator landed.
 */
function resolveReferencesForNode(
  node: FigNode,
  document: FigKiwiDocumentIndex,
): InstanceResolution {
  const pair = extractSymbolIDPair(node);
  if (!pair) { return { effectiveSymbol: undefined, allDependencyGuids: [] }; }

  const allDeps: FigGuid[] = [];

  const primaryResolved = resolveSymbolTarget(pair.symbolID, document);
  if (primaryResolved) { allDeps.push(primaryResolved.guid); }

  const overrideResolved = resolveOverriddenSymbolTarget(pair.overriddenSymbolID, document);
  if (overrideResolved) { allDeps.push(overrideResolved.guid); }

  const variantResolved = resolveVariantSymbolTarget(node, primaryResolved, overrideResolved, document);
  if (variantResolved !== undefined) {
    allDeps.push(variantResolved.guid);
  }

  return {
    effectiveSymbol: overrideResolved ?? variantResolved ?? primaryResolved,
    allDependencyGuids: allDeps,
  };
}

function resolveOverriddenSymbolTarget(
  overriddenSymbolID: FigGuid | undefined,
  document: FigKiwiDocumentIndex,
): ResolvedSymbolTarget | undefined {
  if (overriddenSymbolID === undefined) {
    return undefined;
  }
  return resolveSymbolTarget(overriddenSymbolID, document);
}

function resolveVariantSymbolTarget(
  node: FigNode,
  primaryResolved: ResolvedSymbolTarget | undefined,
  overrideResolved: ResolvedSymbolTarget | undefined,
  document: FigKiwiDocumentIndex,
): ResolvedSymbolTarget | undefined {
  if (overrideResolved !== undefined || primaryResolved === undefined) {
    return undefined;
  }
  const variantOutcome = resolveVariantOverride(node, primaryResolved.node, {
    document,
    childrenOf: document.childrenOf,
  });
  if (variantOutcome.resolvedSymbolID === undefined) {
    return undefined;
  }
  return resolveSymbolTarget(variantOutcome.resolvedSymbolID, document);
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
  /** Style registry for resolving styleIdForFill overrides to fillPaints */
  readonly styleRegistry?: FigStyleRegistry;
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

  const registry = options?.styleRegistry;

  // Apply symbol overrides (property overrides)
  if (options?.symbolOverrides && options.symbolOverrides.length > 0) {
    applyOverrides(cloned, options.symbolOverrides, registry);
  }

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
  if (options?.derivedSymbolData && options.derivedSymbolData.length > 0) {
    applyOverrides(cloned, options.derivedSymbolData, registry);
  }

  // Clean up stale derivedTextData:
  //  1. CPA-overridden TEXT nodes whose glyphs weren't re-supplied by DSD.
  //  2. Any TEXT node whose derivedTextData glyph count grossly mismatches
  //     its final characters.
  cleanupStaleDerivedTextData(cloned, textOverrideGuids, options?.derivedSymbolData);

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
  node.textData = {
    ...(existingTextData ?? { characters: "" }),
    characters: textValue.characters,
    lines: textValue.lines ?? existingTextData?.lines,
  };
  node.characters = textValue.characters;
  if (isNoOp) {
    return;
  }
  delete node.derivedTextData;
  if (textOverrideGuids === undefined || node.guid === undefined) {
    return;
  }
  textOverrideGuids.add(guidToString(node.guid));
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
    const key = guidToString(node.guid);
    const cpaTarget = cpaGuids.has(key);
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
    const mismatchByLength = typeof chars === "string" && !matches && !truncated;
    const riskyCpaKeep = cpaTarget && matches && !hasPUA && !truncated;
    if (mismatchByLength || riskyCpaKeep) {
      delete node.derivedTextData;
    }
  });
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
  styleRegistry?: FigStyleRegistry,
): void {
  for (const override of overrides) {
    applyOverrideAtPath(nodes, override, styleRegistry);
  }
}

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
  styleRegistry?: FigStyleRegistry,
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
    throw new Error(`SymbolResolver: override target ${guidToString(targetGuid)} is not present in the cloned SYMBOL descendants`);
  }
  if (guids.length === 1) {
    applyDirectOverride(child, override, styleRegistry);
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
  applyOverrideAtPath(mutableChildren(child), tail, styleRegistry);
}

/**
 * Apply a depth-1 override's payload to its target node, and resolve
 * any styleId references it set into concrete paint arrays.
 */
function applyDirectOverride(
  node: MutableFigNode,
  override: FigKiwiSymbolOverride,
  styleRegistry: FigStyleRegistry | undefined,
): void {
  applyKiwiOverrideToNode(node, override);
  if (styleRegistry && (override.styleIdForFill !== undefined || override.styleIdForStrokeFill !== undefined)) {
    resolveStyleIdOnMutableNode(node, styleRegistry);
  }
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
  readonly resolveReferences: (node: FigNode) => InstanceResolution;
  readonly styleRegistry?: FigStyleRegistry;
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
  styleRegistry?: FigStyleRegistry,
): void {
  const hasStyleIdOverride = overrides.some((override) => applySelfOverrideEntry(mergedNode, override, symbolGuidStr));
  if (hasStyleIdOverride && styleRegistry) {
    resolveStyleIdOnMutableNode(mergedNode, styleRegistry);
  }
}

function applySelfOverrideEntry(
  mergedNode: MutableFigNode,
  override: FigKiwiSymbolOverride,
  symbolGuidStr: string,
): boolean {
  const guids = override.guidPath?.guids;
  if (!guids || guids.length !== 1) {
    return false;
  }
  if (guidToString(guids[0]) !== symbolGuidStr) {
    return false;
  }
  const styleKeys = (Object.keys(override) as (keyof FigKiwiSymbolOverride)[])
    .map((key) => applySelfOverrideField(mergedNode, override, key));
  return styleKeys.includes(true);
}

function applySelfOverrideField(
  mergedNode: MutableFigNode,
  override: FigKiwiSymbolOverride,
  key: keyof FigKiwiSymbolOverride,
): boolean {
  if (key === "guidPath" || !SELF_OVERRIDE_PAYLOAD_FIELDS.has(key)) {
    return false;
  }
  const value = override[key];
  if (value === undefined) {
    return false;
  }
  (mergedNode as Record<string, unknown>)[key] = value;
  return key === "styleIdForFill" || key === "styleIdForStrokeFill";
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

  function visit(nodes: readonly FigNode[]): void {
    for (const node of nodes) {
      registerSymbolSlot(node, guidToSlot, exactSlotMap);
      visit(childrenOf(node));
    }
  }

  visit(childrenOf(symbolRoot));
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
    symbolRoot,
    derivedSymbolData,
    symbolOverrides,
    childrenOf,
  }: {
    readonly symbolRoot: FigNode;
    readonly derivedSymbolData?: readonly FigKiwiSymbolOverride[];
    readonly symbolOverrides?: readonly FigKiwiSymbolOverride[];
    readonly childrenOf: KiwiChildrenOf;
  },
): SymbolOverrideSlotResolution {
  const slotIndex = buildSymbolSlotIndex(symbolRoot, childrenOf);
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
    const mapped = slotResolution.get(guidToString(guids[0]));
    if (mapped === undefined) {
      return entry;
    }
    return {
      ...entry,
      guidPath: {
        guids: [mapped, ...guids.slice(1)],
      },
    };
  });
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
function resolveInstanceNodeWithResolver(
  node: FigNode,
  ctx: InstanceResolveRuntime,
): ResolvedInstanceNode {
  // 1. Resolve INSTANCE → SYMBOL
  const resolution = ctx.resolveReferences(node);
  if (!resolution.effectiveSymbol) {
    throw new Error(`SymbolResolver: INSTANCE ${guidToString(node.guid)} does not resolve to a SYMBOL`);
  }

  const { node: symNode } = resolution.effectiveSymbol;
  const originalSymNode = symNode;

  // 2. Merge SYMBOL properties into INSTANCE
  const mergedNode = mergeSymbolProperties(node, symNode);

  // 3. Resolve overrideKey addresses to descendant GUIDs.
  const componentPropAssignments = collectComponentPropAssignments(node);
  const sourceSymbolOverrides = node.symbolData?.symbolOverrides;
  // Move self-override entries (single-guid path carrying only
  // INSTANCE-only fields like name/size/variableConsumptionMap/
  // parameterConsumptionMap) onto the SYMBOL root before the
  // descendant-slot address resolution runs.
  const symRootGuid = symNode.guid;
  const symbolRootBoundOverrides = bindSelfOverridesToSymbolRoot(sourceSymbolOverrides, symRootGuid);
  const symbolRootBoundDerivedData = bindSelfOverridesToSymbolRoot(
    node.derivedSymbolData as FigDerivedSymbolData | undefined,
    symRootGuid,
  );
  // Strip self-override entries (path = SYMBOL root) before descendant
  // address resolution. Self-overrides apply only to the INSTANCE's merged node.
  const symRootGuidStr = guidToString(symRootGuid);
  const ovPart = partitionSymbolRootOverrides(symbolRootBoundOverrides, symRootGuidStr);
  const dsdPart = partitionSymbolRootOverrides(symbolRootBoundDerivedData, symRootGuidStr);
  const slotResolution = resolveOverrideSlotAddresses({
    symbolRoot: originalSymNode,
    derivedSymbolData: dsdPart.rest,
    symbolOverrides: ovPart.rest,
    childrenOf: ctx.document.childrenOf,
  });
  const symbolOverrides = bindOverridesToResolvedSlots(slotResolution, ovPart.rest);
  const derivedSymbolData = bindOverridesToResolvedSlots(slotResolution, dsdPart.rest);
  const symbolSelfOverrides = ovPart.selves;

  // 4. Apply self-referencing overrides — only the entries we
  // partitioned out above (path = SYMBOL root). They never went
  // through descendant address resolution so they keep their INSTANCE-only fields.
  if (symbolSelfOverrides.length > 0) {
    applySelfOverridesToMergedNode(mergedNode, symbolSelfOverrides, guidToString(symNode.guid), ctx.styleRegistry);
  }

  // 5. Clone SYMBOL children with overrides
  const children = cloneSymbolChildren(symNode, {
    childrenOf: ctx.document.childrenOf,
    symbolOverrides,
    derivedSymbolData,
    componentPropAssignments: componentPropAssignments.length > 0 ? componentPropAssignments : undefined,
    styleRegistry: ctx.styleRegistry,
  });

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
    return { node: mergedNode, children: resized.children };
  }

  return { node: mergedNode, children };
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

function bindSelfOverridesToSymbolRoot<T extends FigKiwiSymbolOverride>(
  entries: readonly T[] | undefined,
  symRootGuid: FigGuid,
): readonly T[] | undefined {
  if (entries === undefined) {
    return entries;
  }
  const bound = entries.map((entry) => {
    if (!isInstanceSelfOverride(entry)) {
      return entry;
    }
    return { ...entry, guidPath: { guids: [symRootGuid] } } as T;
  });
  const changed = bound.some((entry, index) => entry !== entries[index]);
  return changed ? bound : entries;
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
