/**
 * @file FigDesignNode INSTANCE → effective tree resolver.
 *
 * Implements Figma's INSTANCE/SYMBOL resolution pipeline at the
 * FigDesignNode layer:
 *
 *   1. Property merge — SYMBOL visual properties dominate; INSTANCE
 *      provides paints/strokes only when SYMBOL declares none.
 *   2. Self-overrides — `symbolOverrides` whose `guidPath` targets the
 *      SYMBOL frame itself restore INSTANCE-specific values that Step 1
 *      overwrote.
 *   3. Descendant override application — per-child `symbolOverrides`,
 *      including variant-swap (`overriddenSymbolID` with single-guid
 *      path), property overrides, and outer-cascade forwarding through
 *      nested INSTANCE chains.
 *   4. Component property assignments (CPA) — text, visibility, and
 *      instance-swap overrides.
 *   5. Derived symbol data (DSD) — pre-computed layout pins for resized
 *      INSTANCE descendants, with field-level pinning so an outer
 *      cascade beats a nested SYMBOL-default DSD.
 *   6. Constraint resolution — re-layouts descendants of a resized
 *      INSTANCE when no DSD is authored.
 *   7. Nested INSTANCE recursion — descendants that are themselves
 *      INSTANCE nodes are resolved against the same symbol map and
 *      flattened to FRAME.
 *
 * Renderers consume this through `resolveDesignInstance`; the resolver
 * is pure-domain (FigDesignNode in, FigDesignNode out) and lives in
 * `document-models` so every backend uses the same INSTANCE semantics.
 */

import {
  applyOverrideToNode,
  guidToString,
  isSelfOverride,
  isValidOverridePath,
  overrideFieldKeys,
  overridePathToIds,
  type ComponentPropertyAssignment,
  type ComponentPropertyValue,
  type FigBlob,
  type FigDesignNode,
  type FigStyleRegistry,
  type MutableFigDesignNode,
  type SymbolOverride,
} from "../domain";
import { dfsById } from "@higma-primitives/tree";
import { FIG_NODE_TYPE } from "../types";
import { reresolveOverridesForVariant } from "./design-override-resolver";
import { resolvePaintRef } from "./style-registry";
import { resolveChildConstraints } from "./resolve-child-constraints";
import {
  deepCloneDesignNode,
  getDesignNodeTypeName,
  hasPaintDeclaration,
} from "./design-node-helpers";

/**
 * Pure-domain subset of the renderer's build context. Holds only the
 * inputs the INSTANCE resolution pipeline needs — symbol map, style
 * registry, blob storage (for variant re-resolution), and a warnings
 * sink. Any renderer-specific fields (caches, font resolvers, etc.)
 * stay in the caller's context and never leak into this module.
 */
export type InstanceResolveDesignContext = {
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly blobs: readonly FigBlob[];
  readonly warnings: string[];
};

/**
 * Mutable design node augmented with resolver-internal bookkeeping that
 * needs to travel with the node across deep-clone boundaries (spread
 * copy keeps the Set reference live so a clone of an already-pinned
 * node remains pinned). External callers see this as
 * `MutableFigDesignNode`; the `__pinnedDsdFields` field is consumed
 * exclusively inside this module.
 */
type PinnedDesignNode = MutableFigDesignNode & {
  /**
   * DSD field-name set recording which `size` / `transform` field has
   * been applied by an outer cascade. Inner cascades consult this to
   * avoid clobbering the closer-to-root pin with a SYMBOL-default
   * layout value.
   */
  __pinnedDsdFields?: Set<string>;
};

/**
 * Result of resolving an INSTANCE node against its SYMBOL.
 *
 * `children` is a mutable tree of cloned nodes — every step in the
 * resolution pipeline mutates these clones.
 */
export type ResolvedDesignInstance = {
  /** Effective node with visual properties merged from SYMBOL. */
  readonly effectiveNode: FigDesignNode;
  /** Resolved children (from instance or inherited from symbol). */
  readonly children: readonly MutableFigDesignNode[];
};

/**
 * Single primitive: DFS-find a node by id within a design sub-tree,
 * lazily materialising nested INSTANCE children from `symbolMap` so
 * multi-level paths that descend through INSTANCE slots reach the
 * authored target.
 *
 * SoT for "does id X exist under these children?" at the domain
 * FigDesignNode layer — every consumer calls this directly.
 * Reachability = `findInDesignTree(...) !== undefined`.
 */
function findInDesignTree(
  nodes: readonly MutableFigDesignNode[],
  id: string,
  symbolMap: ReadonlyMap<string, FigDesignNode>,
): MutableFigDesignNode | undefined {
  // First try exact GUID match. Override entries authored against the
  // node's own GUID resolve here.
  const directHit = dfsById(nodes, id, {
    getId: (n) => n.id,
    getChildren: (n) => mutableChildren(n),
    onVisit: (n) => {
      if (n.type !== FIG_NODE_TYPE.INSTANCE) { return; }
      if (mutableChildren(n).length > 0) { return; }
      const nestedSym = n.symbolId ? symbolMap.get(n.symbolId) : undefined;
      if (!nestedSym) { return; }
      n.children = (nestedSym.children ?? []).map(deepCloneDesignNode);
    },
  });
  if (directHit) { return directHit; }

  // Fall back to `overrideKey` match. DSD entries on an INSTANCE
  // address its SYMBOL-side slots by overrideKey, not by the cloned
  // descendant's freshly-assigned GUID. The cloned children retain the
  // original SYMBOL-descendant overrideKey so we can locate them.
  return dfsById(nodes, id, {
    getId: (n) => guidToString(n.overrideKey),
    getChildren: (n) => mutableChildren(n),
    onVisit: (n) => {
      if (n.type !== FIG_NODE_TYPE.INSTANCE) { return; }
      if (mutableChildren(n).length > 0) { return; }
      const nestedSym = n.symbolId ? symbolMap.get(n.symbolId) : undefined;
      if (!nestedSym) { return; }
      n.children = (nestedSym.children ?? []).map(deepCloneDesignNode);
    },
  });
}

/**
 * Materialise a found INSTANCE's children from its SYMBOL when they
 * are empty. The path-walker calls this after each successful step so
 * the next step has descendants to descend into; without it, a
 * multi-guid override addressing slots inside a freshly-cloned but
 * unexpanded INSTANCE would dead-end on the second guid.
 *
 * SoT for "after a path-walk lands on an INSTANCE, expose its
 * SYMBOL-descendant slot tree".
 */
function expandInstanceChildrenIfEmpty(
  found: MutableFigDesignNode,
  symbolMap: ReadonlyMap<string, FigDesignNode>,
): void {
  if (found.type !== FIG_NODE_TYPE.INSTANCE) { return; }
  if (mutableChildren(found).length > 0) { return; }
  const nestedSym = found.symbolId ? symbolMap.get(found.symbolId) : undefined;
  if (!nestedSym) { return; }
  found.children = (nestedSym.children ?? []).map(deepCloneDesignNode);
}

/**
 * Walk a sequence of GUID-strings through a design sub-tree, returning
 * the node located at the requested step (last element of `ids`).
 *
 * Each step delegates to `findInDesignTree` (the slot-lookup SoT) and
 * to `expandInstanceChildrenIfEmpty` (the materialization SoT) so the
 * entire override-path traversal is a single shared algorithm.
 */
function walkOverridePathIds(
  nodes: readonly MutableFigDesignNode[],
  ids: readonly string[],
  symbolMap: ReadonlyMap<string, FigDesignNode>,
): MutableFigDesignNode | undefined {
  if (ids.length === 0) { return undefined; }
  const [head, ...tail] = ids;
  const found = findInDesignTree(nodes, head, symbolMap);
  if (!found) { return undefined; }
  expandInstanceChildrenIfEmpty(found, symbolMap);
  if (tail.length === 0) { return found; }
  return walkOverridePathIds(mutableChildren(found), tail, symbolMap);
}

/**
 * Resolve the descendant a multi-guid override addresses. Convenience
 * wrapper around `walkOverridePathIds` that takes the override directly.
 */
function findNodeByOverridePath(
  nodes: readonly MutableFigDesignNode[],
  override: SymbolOverride,
  symbolMap: ReadonlyMap<string, FigDesignNode>,
): PinnedDesignNode | undefined {
  return walkOverridePathIds(nodes, overridePathToIds(override), symbolMap);
}

/**
 * Sole gateway for "view a MutableFigDesignNode's children as mutable".
 *
 * `MutableFigDesignNode = -readonly { … }` only removes the *outer*
 * `readonly` modifier on each property; the array element type
 * `readonly FigDesignNode[]` keeps its own readonly. Centralising the
 * structural widening here means the cast appears exactly once. The
 * runtime invariant — children we look at via this gateway have
 * already been deep-cloned by `deepCloneDesignNode` and are safe to
 * mutate — is enforced by caller-side discipline of the override / DSD
 * pipeline.
 */
function mutableChildren(
  node: MutableFigDesignNode,
): readonly MutableFigDesignNode[] {
  const cs = node.children;
  if (!cs) { return []; }
  return cs as readonly MutableFigDesignNode[];
}

/**
 * Apply symbol overrides to cloned children.
 *
 * Pass 1: variant switches (`overriddenSymbolID` on a single-guid path).
 * The targeted INSTANCE has its `symbolId` replaced with the variant
 * and its `children` re-cloned from the new variant's SYMBOL. The
 * domain-convert layer has already re-keyed each multi-level override's
 * tail guids into the variant's namespace, so Pass 2 finds its targets
 * directly against the freshly cloned children.
 *
 * Pass 2: property overrides. Each non-variant override locates its
 * target by the already-translated path and has its fields applied.
 */
function applySymbolOverridesToChildren(
  children: readonly MutableFigDesignNode[],
  overrides: readonly SymbolOverride[],
  symbolId: string,
  styleRegistry: FigStyleRegistry,
  symbolMap: ReadonlyMap<string, FigDesignNode>,
  blobs: readonly FigBlob[],
  warnings: string[],
): void {
  // Pass 1: variant switches.
  for (const override of overrides) {
    if (!isValidOverridePath(override)) { continue; }
    if (isSelfOverride(override, symbolId)) { continue; }
    if (!override.overriddenSymbolID) { continue; }
    if (overridePathToIds(override).length !== 1) { continue; }

    const target = findNodeByOverridePath(children, override, symbolMap);
    if (!target || getDesignNodeTypeName(target) !== FIG_NODE_TYPE.INSTANCE) { continue; }

    // Capture the **old** symbolId before `applyOverrideToNode` rewrites
    // it — `reresolveOverridesForVariant` needs both old and new ids so
    // it can rewrite self-override paths (guidPath = [oldSymbolId]) to
    // point at the new variant's SYMBOL guid.
    const oldSymId = target.symbolId ?? "";
    applyOverrideToNode(target, override);

    const newSymId = guidToString(override.overriddenSymbolID);
    const variantSymbol = symbolMap.get(newSymId);
    if (variantSymbol) {
      const mutableTarget: MutableFigDesignNode = target;
      mutableTarget.children =
        (variantSymbol.children ?? []).map(deepCloneDesignNode);

      if (mutableTarget.overrides && mutableTarget.overrides.length > 0 && oldSymId) {
        mutableTarget.overrides = reresolveOverridesForVariant({
          overrides: mutableTarget.overrides,
          variantSymbolChildren: variantSymbol.children ?? [],
          ownDerivedSymbolData: mutableTarget.derivedSymbolData,
          ownComponentPropertyAssignments: mutableTarget.componentPropertyAssignments,
          blobs,
          oldSymbolId: oldSymId,
          newSymbolId: newSymId,
        }) as readonly SymbolOverride[];
      }
    }
  }

  // Pass 2: property overrides against the variant-switched tree.
  for (const override of overrides) {
    if (!isValidOverridePath(override)) {
      const w = `symbolOverride has no guidPath — skipped (symbolId=${symbolId})`;
      if (!warnings.includes(w)) { warnings.push(w); }
      continue;
    }
    if (isSelfOverride(override, symbolId)) { continue; }
    if (override.overriddenSymbolID && overridePathToIds(override).length === 1) {
      continue;
    }

    const target = findNodeByOverridePath(children, override, symbolMap);
    if (!target) {
      // Target unreachable in this INSTANCE's subtree. Happens with the
      // residual overrides that survive domain-level filtering because
      // the INSTANCE was variant-switched multiple levels deep. Figma's
      // renderer silently skips these; mirror that behaviour.
      continue;
    }

    applyOverrideToNode(target, override);

    // Forward multi-guid overrides through the INSTANCE chain so the
    // inner INSTANCE's resolve pass picks them up on freshly-cloned
    // descendants.
    forwardOverrideToDescendantInstance(override, children, symbolMap, "overrides");

    const targetFills = resolvePaintRef(target.styleIdForFill, styleRegistry);
    if (targetFills) { target.fills = targetFills; }
    const targetStrokes = resolvePaintRef(target.styleIdForStrokeFill, styleRegistry);
    if (targetStrokes) { target.strokes = targetStrokes; }
  }
}

/**
 * Apply component property assignments (CPA) to cloned children.
 * Component properties allow INSTANCE nodes to override specific
 * fields on child nodes (text content, visibility, instance swap).
 */
/**
 * Per-call CPA propagation context. The CPA cascade walks the SYMBOL
 * body — including descendants behind INSTANCE expansions — so it needs
 * (a) the `assignments` map (the SoT for "which defId resolves to which
 * value") and (b) the document-wide `symbolMap` (the SoT for "what does
 * an INSTANCE expand into"). Bundling them into one resolve context
 * keeps the function signature aligned with the unit of work, instead
 * of threading the same pair through every recursive call.
 *
 * `outerSymbol` is the SYMBOL the outermost INSTANCE was resolved
 * against. It is currently unused by the walk itself but preserved on
 * the context so future hooks (e.g. validating that an INSTANCE's CPA
 * targets one of its declared `componentPropertyDefs`) can consult it
 * without a separate plumbing pass.
 */
type CpaResolveContext = {
  readonly assignments: ReadonlyMap<string, ComponentPropertyValue>;
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly outerSymbol: FigDesignNode;
};

function applyComponentPropertyAssignments(
  children: readonly MutableFigDesignNode[],
  assignments: readonly ComponentPropertyAssignment[],
  symbol: FigDesignNode,
  ctx: InstanceResolveDesignContext,
): void {
  if (assignments.length === 0) { return; }

  const assignmentMap = new Map<string, ComponentPropertyValue>();
  for (const assign of assignments) {
    assignmentMap.set(assign.defId, assign.value);
  }

  applyPropsRecursive(children, {
    assignments: assignmentMap,
    symbolMap: ctx.symbolMap,
    outerSymbol: symbol,
  });
}

function applyPropsRecursive(
  nodes: readonly MutableFigDesignNode[],
  ctx: CpaResolveContext,
): void {
  for (const node of nodes) {
    // Expand INSTANCE descendants on demand so the CPA cascade can
    // reach any node carrying `componentPropertyRefs`, including
    // descendants of a nested INSTANCE whose SYMBOL body hadn't yet
    // been materialised. Without this, an outer INSTANCE's
    // `componentPropertyAssignments` whose target lives behind two or
    // more INSTANCE hops — e.g. the App Store template's Screenshot
    // INSTANCE → iPhone INSTANCE → Screen INSTANCE chain where the
    // outer Screenshot CPA assigns OVERRIDDEN_SYMBOL_ID to the Screen
    // INSTANCE — silently fails to fire because `applyPropsRecursive`
    // would not see Screen INSTANCE during its tree walk. The
    // SoT-aligned semantic: CPA propagation traverses the SYMBOL body
    // every INSTANCE expands into, matching how Figma resolves
    // descendant property pins.
    if (node.type === FIG_NODE_TYPE.INSTANCE
        && (!node.children || node.children.length === 0)
        && node.symbolId) {
      const nestedSym = ctx.symbolMap.get(node.symbolId);
      if (nestedSym) {
        node.children = (nestedSym.children ?? []).map(deepCloneDesignNode);
      }
    }
    if (node.componentPropertyRefs) {
      for (const ref of node.componentPropertyRefs) {
        const assignedValue = ctx.assignments.get(ref.defId);
        if (assignedValue === undefined) { continue; }

        switch (ref.nodeField) {
          case "TEXT_DATA": {
            // Override text content from textValue.characters. When the
            // new characters differ from the node's existing ones we
            // must invalidate `derivedTextData` (cached glyph contours
            // no longer match). But when the CPA re-asserts the same
            // string (common for variant INSTANCEs whose CPA redeclares
            // the SYMBOL's default), preserving dtd avoids throwing
            // away a perfectly valid pre-computed glyph path.
            const textChars = assignedValue.textValue?.characters;
            if (textChars !== undefined && node.textData) {
              const prevChars = node.textData.characters;
              node.textData = { ...node.textData, characters: textChars };
              if (textChars !== prevChars) {
                node.derivedTextData = undefined;
              }
            }
            break;
          }
          case "VISIBLE": {
            const boolVal = assignedValue.boolValue;
            if (boolVal !== undefined) {
              node.visible = boolVal;
            }
            break;
          }
          case "OVERRIDDEN_SYMBOL_ID": {
            const refVal = assignedValue.referenceValue;
            if (refVal !== undefined && refVal !== node.symbolId) {
              // CPA-driven variant swap. If the descendant INSTANCE has
              // already had its children materialised from the OLD
              // symbol (which is the case whenever an earlier
              // path-walk landed inside it — e.g. the outer INSTANCE's
              // multi-guid override descended through this slot before
              // Step 4 ran), those cloned children belong to the wrong
              // SYMBOL after the swap and must be discarded. Clearing
              // `children` lets the next `expandInstanceChildrenIfEmpty`
              // walk re-clone from the NEW symbol so downstream steps
              // (Step 5 derived-data application, scene-graph builder)
              // see the post-swap tree. Without this, the App Store
              // template's Screenshot INSTANCE cascade leaves the
              // resized iPhone screen showing the default Mockup
              // rectangle instead of the digit TEXT 8:9263 / 8:9269 /
              // 8:9275 that lives inside the swapped-in `1:1711` /
              // `1:1724` / `1:1725` variants.
              node.symbolId = refVal;
              (node as MutableFigDesignNode).children = undefined;
            }
            break;
          }
        }
      }
    }

    if (node.children) {
      applyPropsRecursive(mutableChildren(node), ctx);
    }
  }
}

/**
 * SoT for DSD application across nested INSTANCE re-resolution.
 *
 * Figma's auto-layout sizing model (encoded on each layout-aware node
 * as `stackPrimarySizing` / `stackCounterSizing`, with values FIXED /
 * HUG / FILL) governs which DSD entry is authoritative for a given
 * descendant's size:
 *
 *   - FIXED nodes have their size determined by the **closest
 *     enclosing INSTANCE that pinned it** (Figma writes that pin into
 *     the outer INSTANCE's DSD as a `size` field on the descendant's
 *     path).
 *   - SYMBOL-time DSD entries on intermediate INSTANCEs encode the
 *     descendant's size **before** that pin (the SYMBOL-default
 *     layout). When an outer INSTANCE wraps and pins, the inner
 *     INSTANCE's DSD must yield to the outer.
 *
 * We therefore record (per node) the fields any DSD apply has touched.
 * A later DSD apply — including the inner cascade triggered by
 * `resolveNestedInstances` — checks the record and strips fields the
 * closer ancestor has already pinned before forwarding the entry.
 *
 * `outer=true/false` is informational: we always record, always
 * honour. The flag is kept in the signature so callers can opt-in to
 * *not* recording in the future without breaking the contract.
 */
function applyDerivedSymbolData(
  children: readonly MutableFigDesignNode[],
  derivedData: readonly SymbolOverride[],
  ctx: InstanceResolveDesignContext,
  outer: boolean = true,
): readonly SymbolOverride[] {
  // Entries the caller should retry once `resolveNestedInstances` has
  // exposed swapped-in descendants. Only outer-cascade entries are
  // captured — inner cascades' SYMBOL-time DSD is a snapshot of the
  // intermediate INSTANCE's resized layout and doesn't need to outlive
  // nested resolution.
  const deferred: SymbolOverride[] = [];
  for (const entry of derivedData) {
    if (!isValidOverridePath(entry)) { continue; }
    const target: PinnedDesignNode | undefined = findNodeByOverridePath(children, entry, ctx.symbolMap);
    if (!target) {
      if (outer) {
        deferred.push(entry);
      }
      continue;
    }
    target.__pinnedDsdFields ??= new Set<string>();
    const pinned = target.__pinnedDsdFields;
    // Strip fields the closer ancestor has already pinned (size,
    // transform) when this is the inner cascade. Honouring the seal in
    // both directions would let an inner cascade undo an authoritative
    // outer pin.
    if (!outer) {
      const sizeConflict = entry.size !== undefined && pinned.has("size");
      const transformConflict = entry.transform !== undefined && pinned.has("transform");
      if (sizeConflict || transformConflict) {
        const stripped = stripOverrideFields(entry, sizeConflict, transformConflict);
        if (stripped === undefined) { continue; }
        applyOverrideToNode(target, stripped);
        continue;
      }
    }
    applyOverrideToNode(target, entry);
    if (entry.size !== undefined) { pinned.add("size"); }
    if (entry.transform !== undefined) { pinned.add("transform"); }
    // Forward multi-guid DSD entries through the INSTANCE chain so the
    // inner INSTANCE's Step 5 (applyDerivedSymbolData) picks them up
    // on freshly-cloned descendants.
    forwardOverrideToDescendantInstance(entry, children, ctx.symbolMap, "derivedSymbolData");
  }
  return deferred;
}

/**
 * Which slot on a descendant INSTANCE should an outer-cascade override
 * be appended to? Both `overrides` and `derivedSymbolData` are arrays
 * of `SymbolOverride`, but the inner INSTANCE's resolve pass iterates
 * them in different steps — the caller picks the right one.
 */
type ForwardingSlot = "overrides" | "derivedSymbolData";

/**
 * Forward an outer-cascade override down to the penultimate INSTANCE
 * in its `guidPath`, so the inner INSTANCE's own resolve pass re-applies
 * the override and beats any authored `[finalGuid]` entry the inner
 * already carries.
 *
 * Returns `true` when a forwarded entry was appended, `false`
 * otherwise (path too short, no payload, penultimate node not an
 * INSTANCE, or path broken).
 */
function forwardOverrideToDescendantInstance(
  override: SymbolOverride,
  children: readonly MutableFigDesignNode[],
  symbolMap: ReadonlyMap<string, FigDesignNode>,
  slot: ForwardingSlot,
): boolean {
  const guids = override.guidPath?.guids;
  if (!guids || guids.length < 2) { return false; }
  // Payload check: `overriddenSymbolID` alone is a variant-swap
  // directive the inner INSTANCE already resolves through its own
  // pipeline; forwarding it would be a no-op.
  const hasPayload = overrideFieldKeys(override).some((key) => key !== "overriddenSymbolID");
  if (!hasPayload) { return false; }
  const ids = overridePathToIds(override);
  const finalGuid = guids[guids.length - 1];
  const pen = walkOverridePathIds(children, ids.slice(0, -1), symbolMap);
  if (!pen || pen.type !== FIG_NODE_TYPE.INSTANCE) { return false; }
  const forwarded: SymbolOverride = { ...override, guidPath: { guids: [finalGuid] } };
  if (slot === "overrides") {
    pen.overrides = [...(pen.overrides ?? []), forwarded];
  } else {
    pen.derivedSymbolData = [...(pen.derivedSymbolData ?? []), forwarded];
  }
  return true;
}

/**
 * Build a copy of a SymbolOverride with `size` and/or `transform`
 * dropped. Returns `undefined` when the resulting override would carry
 * no actionable fields (only routing fields like guidPath remain).
 */
function stripOverrideFields(
  entry: SymbolOverride,
  dropSize: boolean,
  dropTransform: boolean,
  dropDerivedTextData: boolean = false,
): SymbolOverride | undefined {
  const stripped: SymbolOverride = {
    ...entry,
    ...(dropSize ? { size: undefined } : {}),
    ...(dropTransform ? { transform: undefined } : {}),
    ...(dropDerivedTextData ? { derivedTextData: undefined } : {}),
  };
  for (const key of overrideFieldKeys(stripped)) {
    // overriddenSymbolID is a routing field (instance swap) — present
    // even on otherwise-empty entries; skip it.
    if (key === "overriddenSymbolID") { continue; }
    return stripped;
  }
  return undefined;
}

/**
 * Apply constraint-based layout resolution to children of a resized
 * INSTANCE. When an INSTANCE has a different size than its SYMBOL and
 * no derivedSymbolData is available, each child's position and size
 * are adjusted according to their horizontal/vertical constraints.
 */
function applyConstraintResolution(
  children: readonly MutableFigDesignNode[],
  symbolSize: { x: number; y: number },
  instanceSize: { x: number; y: number },
): void {
  for (const child of children) {
    const constraintChild = {
      horizontalConstraint: child.layoutConstraints?.horizontalConstraint,
      verticalConstraint: child.layoutConstraints?.verticalConstraint,
      transform: { m02: child.transform.m02, m12: child.transform.m12 },
      size: { x: child.size.x, y: child.size.y },
    };

    const resolution = resolveChildConstraints(
      constraintChild,
      symbolSize,
      instanceSize,
    );

    if (!resolution) { continue; }
    if (!resolution.posChanged && !resolution.sizeChanged) { continue; }

    child.transform = {
      ...child.transform,
      m02: resolution.posX,
      m12: resolution.posY,
    };

    if (resolution.sizeChanged) {
      child.size = { x: resolution.dimX, y: resolution.dimY };
    }
  }
}

/**
 * Resolve an INSTANCE node against its SYMBOL.
 *
 * Full resolution pipeline:
 *
 *   1. Property merge — inherit SYMBOL's visual properties where the
 *      INSTANCE has none.
 *   2. Self-overrides — apply overrides targeting the SYMBOL frame
 *      itself.
 *   3. Clone & override children — deep clone symbol children, apply
 *      per-child overrides.
 *   4. Component property assignments — text/visibility/swap
 *      overrides.
 *   5. Derived symbol data — pre-computed layout pins.
 *   6. Constraint resolution — re-layout descendants for size delta.
 *   7. Recursively resolve nested INSTANCE children.
 *
 * The INSTANCE retains its own transform (placement); its size is
 * applied when the children layout has a mechanism to redistribute or
 * the SYMBOL has no children to disturb.
 */
export function resolveDesignInstance(
  node: FigDesignNode,
  /**
   * Pre-cloned mutable children from an outer cascade, or an empty
   * array when this is the first resolve and we should clone from
   * `symbol.children`. Caller contract: every node in this array is
   * already a deep clone — the resolver mutates them in place.
   */
  ownChildren: readonly MutableFigDesignNode[],
  ctx: InstanceResolveDesignContext,
  /**
   * `true` when this resolve is called from `resolveNestedInstances`
   * (i.e. an outer INSTANCE has already cascaded its DSD over our
   * descendants). Inner cascade then honours fields the outer pinned.
   * The top-level call passes `false`.
   */
  nested: boolean = false,
): ResolvedDesignInstance {
  const symbolId = node.symbolId;
  if (!symbolId) {
    return { effectiveNode: node, children: ownChildren };
  }

  const symbol = ctx.symbolMap.get(symbolId);
  if (!symbol) {
    const warning = `INSTANCE symbol not found in symbolMap: id=${symbolId}`;
    if (!ctx.warnings.includes(warning)) {
      ctx.warnings.push(warning);
    }
    return { effectiveNode: node, children: ownChildren };
  }

  // ── Step 1: Property merge ──
  // Mirrors `mergeSymbolProperties` (the SoT for FigNode-level
  // INSTANCE resolution): SYMBOL's visual properties always override
  // INSTANCE-level values. INSTANCE-specific tweaks arrive via
  // self-referencing `symbolOverrides` applied in Step 2. Reading
  // directly-set INSTANCE `fillPaints` here would treat author tooling
  // artefacts as authoritative and diverge from Figma's own export.
  const instanceSize = node.size;
  const symbolSize = symbol.size;
  const sameSize = instanceSize.x === symbolSize.x && instanceSize.y === symbolSize.y;
  const symbolFills = symbol.fills ?? [];
  const symbolStrokes = symbol.strokes ?? [];
  const nodeFills = node.fills ?? [];
  const nodeStrokes = node.strokes ?? [];

  const merged: MutableFigDesignNode = {
    ...node,

    // Paint — SYMBOL wins unconditionally when it declares paints; the
    // INSTANCE's fills/strokes are only used when the SYMBOL has none.
    fills: hasPaintDeclaration(symbolFills) ? symbolFills : nodeFills,
    strokes: hasPaintDeclaration(symbolStrokes) ? symbolStrokes : nodeStrokes,
    strokeWeight: symbol.strokeWeight ?? node.strokeWeight,
    strokeJoin: symbol.strokeJoin ?? node.strokeJoin,
    strokeCap: symbol.strokeCap ?? node.strokeCap,
    strokeDashes: symbol.strokeDashes ?? node.strokeDashes,

    // Geometry — inherit from SYMBOL.
    cornerRadius: symbol.cornerRadius ?? node.cornerRadius,
    rectangleCornerRadii: symbol.rectangleCornerRadii ?? node.rectangleCornerRadii,
    cornerSmoothing: symbol.cornerSmoothing ?? node.cornerSmoothing,

    // fillGeometry/strokeGeometry — inherit only when same size
    // (geometry is resolution-dependent; different size invalidates).
    fillGeometry: sameSize ? (symbol.fillGeometry ?? node.fillGeometry) : node.fillGeometry,
    strokeGeometry: sameSize ? (symbol.strokeGeometry ?? node.strokeGeometry) : node.strokeGeometry,

    // Effects — SYMBOL is authoritative.
    effects: symbol.effects ?? [],

    // Compositing.
    blendMode: symbol.blendMode ?? node.blendMode,
    opacity: symbol.opacity ?? node.opacity,
    mask: symbol.mask ?? node.mask,

    // Container.
    clipsContent: node.clipsContent ?? symbol.clipsContent,

    // Size — use SYMBOL's size for frame rendering; INSTANCE size is
    // used for constraint resolution later.
    size: symbol.size,
  };

  // ── Step 2: Self-overrides ──
  if (node.overrides && node.overrides.length > 0) {
    for (const override of node.overrides) {
      if (!isSelfOverride(override, symbolId) && !isSelfOverride(override, node.id)) {
        continue;
      }
      applyOverrideToNode(merged, override);
    }
    // If self-overrides set styleIdForFill/styleIdForStrokeFill,
    // resolve through the style registry.
    const mergedFills = resolvePaintRef(merged.styleIdForFill, ctx.styleRegistry);
    if (mergedFills) { merged.fills = mergedFills; }
    const mergedStrokes = resolvePaintRef(merged.styleIdForStrokeFill, ctx.styleRegistry);
    if (mergedStrokes) { merged.strokes = mergedStrokes; }
  }

  const effectiveNode: MutableFigDesignNode = merged;

  // ── Step 3: Clone children with overrides ──
  const children = resolveInstanceChildrenForMutation(ownChildren, symbol);

  if (node.overrides && node.overrides.length > 0) {
    applySymbolOverridesToChildren(
      children,
      node.overrides,
      symbolId,
      ctx.styleRegistry,
      ctx.symbolMap,
      ctx.blobs,
      ctx.warnings,
    );
  }

  // ── Step 4: Component property assignments ──
  if (node.componentPropertyAssignments && node.componentPropertyAssignments.length > 0) {
    applyComponentPropertyAssignments(children, node.componentPropertyAssignments, symbol, ctx);
  }

  // ── Step 5: Derived symbol data ──
  // `outer = !nested` — the top-level resolve owns its INSTANCE's
  // resize and is the SoT for descendant pinned fields. A nested
  // re-resolve skips fields the outer cascade already pinned.
  //
  // Some outer-cascade entries target descendants that only become
  // reachable AFTER nested INSTANCEs resolve — typically because a
  // descendant INSTANCE is variant-swapped by a nested CPA and the
  // target glyph lives in the new symbol's body. Those entries are
  // captured here and re-applied after Step 7, when the descendant
  // tree is fully materialised.
  const deferredOuterDsd: readonly SymbolOverride[] = (() => {
    if (node.derivedSymbolData && node.derivedSymbolData.length > 0) {
      return applyDerivedSymbolData(children, node.derivedSymbolData, ctx, !nested);
    }
    return [];
  })();

  // ── Step 6: Constraint resolution for resized instances ──
  // Mirrors `resolveInstanceLayout`: the INSTANCE size is honoured
  // when either (a) there is a mechanism to redistribute the SYMBOL's
  // children to the new extent — authored constraint settings or
  // pre-computed derivedSymbolData — or (b) the SYMBOL has no
  // children, so there is nothing to redistribute and the INSTANCE
  // size can be applied directly (leaf INSTANCE).
  const sizeChanged = instanceSize.x !== symbolSize.x || instanceSize.y !== symbolSize.y;
  if (sizeChanged) {
    const hasDerivedData = node.derivedSymbolData !== undefined && node.derivedSymbolData.length > 0;
    const hasConstraints = children.some((child) => {
      const hc = child.layoutConstraints?.horizontalConstraint;
      const vc = child.layoutConstraints?.verticalConstraint;
      // Anything other than MIN/MIN means the child has an explicit
      // layout rule authored against the SYMBOL extent, so it is valid
      // to redistribute it to the INSTANCE extent.
      return (hc !== undefined && hc.name !== "MIN") || (vc !== undefined && vc.name !== "MIN");
    });
    // Leaf INSTANCE: SYMBOL has no children to redistribute, so
    // applying the INSTANCE size is unambiguous.
    const isLeafInstance = children.length === 0;

    if (hasDerivedData || hasConstraints || isLeafInstance) {
      if (!hasDerivedData && !isLeafInstance) {
        applyConstraintResolution(children, symbolSize, instanceSize);
      }
      effectiveNode.size = instanceSize;
      // When the INSTANCE is shrunk below the SYMBOL's bounds AND the
      // SYMBOL's children would extend past that shrunken extent,
      // Figma visually clips the overflow.
      const symbolLargerThanInstance =
        symbolSize.x - instanceSize.x > 0.5 || symbolSize.y - instanceSize.y > 0.5;
      if (symbolLargerThanInstance && effectiveNode.clipsContent !== true) {
        effectiveNode.clipsContent = true;
      }
    }
    // Otherwise: keep SYMBOL size and the original child layout.
  }

  // ── Step 7: Recursively resolve nested INSTANCE children ──
  const resolvedChildren = resolveNestedInstances(children, ctx);

  // ── Step 5b: Re-apply outer-cascade DSD entries whose target only
  // became reachable AFTER nested resolution (e.g. a descendant
  // INSTANCE was variant-swapped by a nested CPA, exposing a new
  // SYMBOL body that holds the entry's target). Outer wins by going
  // last; the recursion has already pinned inner SYMBOL-time values,
  // which the outer apply then overwrites cleanly because
  // `applyDerivedSymbolData` skips the strip-on-pin step when called
  // with `outer=true`.
  if (deferredOuterDsd.length > 0) {
    applyDerivedSymbolData(resolvedChildren, deferredOuterDsd, ctx, true);
  }

  return { effectiveNode, children: resolvedChildren };
}

function resolveInstanceChildrenForMutation(
  ownChildren: readonly MutableFigDesignNode[],
  symbol: FigDesignNode,
): readonly MutableFigDesignNode[] {
  if (ownChildren.length > 0) {
    // ownChildren are the *already-resolved* clones an outer INSTANCE
    // handed us. They are not shared with any other resolve pass, so
    // we must NOT deep-clone them again — re-cloning produces fresh
    // node objects that lose per-node bookkeeping the outer cascade
    // attached (e.g. the pinned-field Set that prevents an inner DSD
    // from overwriting outer-pinned size/transform).
    return ownChildren;
  }
  // SYMBOL children are read-only and shared across every INSTANCE
  // that references the SYMBOL. Clone before mutating.
  return (symbol.children ?? []).map(deepCloneDesignNode);
}

/**
 * Recursively resolve INSTANCE nodes within a children array.
 *
 * When SYMBOL children contain nested INSTANCE nodes, those must be
 * resolved (property merge + override + children) before they can be
 * built into scene graph nodes. Each nested INSTANCE is flattened to
 * FRAME after resolution so the consumer never sees an unresolved
 * INSTANCE in the tree.
 */
export function resolveNestedInstances(
  children: readonly MutableFigDesignNode[],
  ctx: InstanceResolveDesignContext,
): readonly MutableFigDesignNode[] {
  return children.map((child) => {
    const typeName = getDesignNodeTypeName(child);
    if (typeName !== FIG_NODE_TYPE.INSTANCE) {
      if (child.children && child.children.length > 0) {
        const resolvedGrandchildren = resolveNestedInstances(mutableChildren(child), ctx);
        if (resolvedGrandchildren !== child.children) {
          const updated: MutableFigDesignNode = { ...child, children: resolvedGrandchildren };
          return updated;
        }
      }
      return child;
    }

    const resolved = resolveDesignInstance(child, mutableChildren(child), ctx, /* nested */ true);
    const flattened: MutableFigDesignNode = {
      ...resolved.effectiveNode,
      type: "FRAME",
      children: resolveNestedInstances(resolved.children, ctx),
    };
    return flattened;
  });
}
