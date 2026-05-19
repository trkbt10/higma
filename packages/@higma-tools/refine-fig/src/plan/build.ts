/**
 * @file `buildPlan` — combine an `Inventory` with the agent's
 * `Decisions` into a deterministic `RefinePlan`.
 *
 * Action order matters:
 *
 *   1. create-fill-style-definition   (any new fill styleDefinitions)
 *   2. create-text-style-definition   (any new text styleDefinitions)
 *   3. bind-fill-style     (rebind nodes to existing or fresh styleDefinitions)
 *   4. bind-text-style     (deferred when the source has no template)
 *   5. promote-icon-cluster (componentize)
 *   6. rename              (cluster names propagated to members)
 *
 * Renames produced by cluster decisions are emitted *after* the
 * promote actions, so the SYMBOL ends up named after the cluster
 * and so do its INSTANCEs.
 */
import type { Inventory, PaletteEntry, TypographyEntry, StructureClusterEntry } from "../inventory";
import type { Decisions, TypographyDecision } from "../decisions";
import type { RefineSource } from "../refine-source/load";
import type {
  RefinePlan,
  PlanAction,
  ActionEnsureInternalCanvas,
  ActionCreateFillStyleDefinition,
  ActionCreateTextStyleDefinition,
  ActionBindFillStyle,
  ActionBindTextStyle,
  ActionPromoteIconCluster,
  ActionPromoteVectorCluster,
  ActionGroupAsVariantSet,
  ActionSetLayout,
  ActionRename,
  StyleDefinitionRef,
} from "./types";
import { isPromotableCluster } from "../componentize";

const INTERNAL_CANVAS_NAME = "Internal Only Canvas";

export type BuildPlanOptions = {
  readonly file: string;
  readonly bytes: number;
};

/** Build a deterministic plan from an inventory + decisions. */
export function buildPlan(
  source: RefineSource,
  inventory: Inventory,
  decisions: Decisions,
  options: BuildPlanOptions,
): RefinePlan {
  const actions: PlanAction[] = [];
  const skippedNonPromotableClusters: string[] = [];
  const variantSets = decisions.variantSets;
  if (variantSets !== undefined && Object.keys(variantSets).length > 0) {
    assertNoSharedClusterAcrossSets(variantSets);
    assertClustersExistAndArePromoteToSymbol(variantSets, inventory, decisions);
  }

  // ---- Fill styleDefinitions + bindings ------------------------------------------
  const tokenByPaletteKey = new Map<string, string>();
  for (const entry of inventory.palette) {
    const decision = decisions.palette[entry.key];
    if (!decision || !decision.name.trim()) {
      continue;
    }
    if (entry.existingStyleDefinitionGuid) {
      // No styleDefinition creation needed — bind to the existing GUID.
      pushFillBindings(actions, entry, { kind: "existing", guid: entry.existingStyleDefinitionGuid });
      continue;
    }
    // No template? Bootstrap path in apply will build a styleDefinition from
    // scratch — emit the create action either way.
    const token = `fill:${entry.key}`;
    tokenByPaletteKey.set(entry.key, token);
    const create: ActionCreateFillStyleDefinition = {
      kind: "create-fill-style-definition",
      token,
      name: decision.name,
      color: entry.color,
    };
    actions.push(create);
    pushFillBindings(actions, entry, { kind: "token", token });
  }

  // ---- Text styleDefinitions + bindings ------------------------------------------
  // Pre-resolve every text entry's bind target so a merge can point at
  // either the merge target's existing styleDefinition or the token allocated
  // for its create-text-style-definition action in this same plan.
  const typographyByKey = new Map<string, TypographyEntry>(
    inventory.typography.map((entry) => [entry.key, entry] as const),
  );
  const textStyleDefinitionRefByKey = new Map<string, StyleDefinitionRef>();
  for (const entry of inventory.typography) {
    const decision = decisions.typography[entry.key];
    if (!decision) {
      continue;
    }
    // A merge decision contributes only bindings — its own name is
    // ignored; the bind target lives elsewhere.
    if (decision.merge) {
      continue;
    }
    if (!decision.name.trim()) {
      continue;
    }
    if (entry.existingStyleDefinitionGuid) {
      textStyleDefinitionRefByKey.set(entry.key, { kind: "existing", guid: entry.existingStyleDefinitionGuid });
      continue;
    }
    const token = `text:${entry.key}`;
    const create: ActionCreateTextStyleDefinition = {
      kind: "create-text-style-definition",
      token,
      name: decision.name,
      fontFamily: entry.descriptor.fontFamily,
      fontStyle: entry.descriptor.fontStyle,
      fontWeight: entry.descriptor.fontWeight,
      fontSize: entry.descriptor.fontSize,
    };
    actions.push(create);
    textStyleDefinitionRefByKey.set(entry.key, { kind: "token", token });
  }
  for (const entry of inventory.typography) {
    const decision = decisions.typography[entry.key];
    if (!decision) {
      continue;
    }
    const styleDefinitionRef = resolveTypographyRef(entry, decision, decisions, typographyByKey, textStyleDefinitionRefByKey);
    if (!styleDefinitionRef) {
      continue;
    }
    pushTextBindings(actions, entry, styleDefinitionRef);
  }

  // ---- Cluster promote -------------------------------------------------
  // Promotes have to land BEFORE variant-set grouping (group-as-variant-set
  // references the promoted SYMBOLs by clusterId). Renames go AFTER both,
  // so the variant-set step can rewrite the SYMBOL's name to `Prop=Value`
  // without a subsequent rename overwriting it.
  const promotedClusterIds = new Set<string>();
  for (const cluster of inventory.structureClusters) {
    const decision = decisions.clusters[cluster.clusterId];
    if (!decision || !decision.name.trim()) {
      continue;
    }
    if (decision.promoteToSymbol !== true) {
      continue;
    }
    const exemplarGuid = decision.exemplarGuid ?? pickDeterministicExemplar(cluster);
    if (!isPromotableCluster(source.loaded, exemplarGuid)) {
      skippedNonPromotableClusters.push(cluster.clusterId);
      continue;
    }
    const promote: ActionPromoteIconCluster = {
      kind: "promote-icon-cluster",
      clusterId: cluster.clusterId,
      clusterName: decision.name,
      exemplarGuid,
      memberGuids: cluster.members.map((m) => m.nodeGuid),
    };
    actions.push(promote);
    promotedClusterIds.add(cluster.clusterId);
  }

  // ---- Promote vector clusters ----------------------------------------
  pushPromoteVectorClusters(actions, inventory, decisions);

  // ---- Group as variant set -------------------------------------------
  pushVariantSetActions(actions, inventory, decisions, promotedClusterIds);

  // ---- Set layout -----------------------------------------------------
  pushSetLayoutActions(actions, inventory, decisions);

  // ---- Cluster member renames -----------------------------------------
  // Every cluster — promoted or not — gets explicit renames so the
  // agent's chosen name lands on each member node.
  const variantClusterIds = collectVariantClusterIds(decisions);
  for (const cluster of inventory.structureClusters) {
    const decision = decisions.clusters[cluster.clusterId];
    if (!decision || !decision.name.trim()) {
      continue;
    }
    // Skip the SYMBOL exemplar when this cluster is part of a variant
    // set: `group-as-variant-set` already rewrote that SYMBOL's name
    // to `<propertyName>=<value>` and a generic rename here would
    // clobber it.
    const exemplarGuid = decision.exemplarGuid ?? pickDeterministicExemplar(cluster);
    const isInVariantSet = variantClusterIds.has(cluster.clusterId);
    for (const member of cluster.members) {
      if (isInVariantSet && member.nodeGuid === exemplarGuid) {
        continue;
      }
      const overrideName = decision.memberOverrides?.[member.nodeGuid];
      const name = overrideName ?? decision.name;
      const rename: ActionRename = {
        kind: "rename",
        nodeGuid: member.nodeGuid,
        newName: name,
        reason: `cluster ${cluster.clusterId}`,
      };
      actions.push(rename);
    }
  }

  const finalActions = prependEnsureCanvasIfNeeded(actions, source);

  return {
    source: { file: options.file, bytes: options.bytes },
    actions: finalActions,
    diagnostics: { skippedNonPromotableClusters },
  };
}

/**
 * Emit `ensure-internal-canvas` at the head of the plan iff the
 * source carries no internal canvas AND the plan contains at least
 * one action that needs one (styleDefinition creation). When the source already
 * has a canvas we emit nothing — re-creating it would orphan the
 * existing fill / text styleDefinitions. When nothing is named, the plan stays
 * empty — there is no work to do, so introducing a canvas would be a
 * pointless side effect.
 */
function prependEnsureCanvasIfNeeded(
  actions: readonly PlanAction[],
  source: RefineSource,
): readonly PlanAction[] {
  if (source.internalCanvas) {
    return actions;
  }
  const needsCanvas = actions.some(
    (a) => a.kind === "create-fill-style-definition" || a.kind === "create-text-style-definition",
  );
  if (!needsCanvas) {
    return actions;
  }
  const ensure: ActionEnsureInternalCanvas = {
    kind: "ensure-internal-canvas",
    name: INTERNAL_CANVAS_NAME,
  };
  return [ensure, ...actions];
}

/**
 * Resolve which StyleDefinitionRef a typography entry's bind actions should
 * target. Honours `decision.merge`, throws on broken merges.
 *
 *   - `decision.merge = otherKey` → use otherKey's resolved StyleDefinitionRef.
 *     The target must itself produce a StyleDefinitionRef (own name + create, or
 *     existingStyleDefinitionGuid). Throws when the merge target is unknown,
 *     unnamed, or itself merged.
 *   - `decision.name` empty + no merge → no bind for this entry.
 *   - `existingStyleDefinitionGuid` already in inventory → reuse.
 *   - Otherwise → token from the just-emitted `create-text-style-definition`.
 */
function resolveTypographyRef(
  entry: TypographyEntry,
  decision: TypographyDecision,
  decisions: Decisions,
  typographyByKey: ReadonlyMap<string, TypographyEntry>,
  textStyleDefinitionRefByKey: ReadonlyMap<string, StyleDefinitionRef>,
): StyleDefinitionRef | undefined {
  if (decision.merge) {
    return resolveMergedTypographyRef(entry, decision.merge, decisions, typographyByKey, textStyleDefinitionRefByKey);
  }
  return resolveOwnTypographyRef(entry, decision, textStyleDefinitionRefByKey);
}

function resolveMergedTypographyRef(
  entry: TypographyEntry,
  targetKey: string,
  decisions: Decisions,
  typographyByKey: ReadonlyMap<string, TypographyEntry>,
  textStyleDefinitionRefByKey: ReadonlyMap<string, StyleDefinitionRef>,
): StyleDefinitionRef {
  const targetEntry = typographyByKey.get(targetKey);
  if (!targetEntry) {
    throw new Error(
      `buildPlan: typography["${entry.key}"].merge points at "${targetKey}", `
      + `which is not an inventory entry. Use the exact descriptor key from inventory.typography[].key.`,
    );
  }
  const targetDecision = decisions.typography[targetKey];
  if (targetDecision?.merge) {
    throw new Error(
      `buildPlan: typography["${entry.key}"].merge → "${targetKey}", but the target is itself merged into `
      + `"${targetDecision.merge}". Merge chains are not allowed — bind directly to the leaf target.`,
    );
  }
  const ref = textStyleDefinitionRefByKey.get(targetKey);
  if (!ref) {
    throw new Error(
      `buildPlan: typography["${entry.key}"].merge → "${targetKey}", but the target has no resolved styleDefinition `
      + `(neither an existing styleDefinition nor a non-empty name). Name the target or pick a different merge.`,
    );
  }
  return ref;
}

function resolveOwnTypographyRef(
  entry: TypographyEntry,
  decision: TypographyDecision,
  textStyleDefinitionRefByKey: ReadonlyMap<string, StyleDefinitionRef>,
): StyleDefinitionRef | undefined {
  if (!decision.name.trim()) {
    return undefined;
  }
  const own = textStyleDefinitionRefByKey.get(entry.key);
  if (own) {
    return own;
  }
  // Unreachable in practice — the create loop populates textStyleDefinitionRefByKey
  // for every named entry. The defensive throw documents the invariant.
  throw new Error(
    `buildPlan: typography["${entry.key}"] is named but has no resolved styleDefinition. This is a bug in build-plan; please report.`,
  );
}

/**
 * Emit one `promote-vector-cluster` per `decisions.geometryClusters[id]`
 * with a non-empty name. The cluster id must exist in the inventory;
 * unknown ids fail fast at plan time.
 */
function pushPromoteVectorClusters(
  actions: PlanAction[],
  inventory: Inventory,
  decisions: Decisions,
): void {
  const choices = decisions.geometryClusters;
  if (!choices || Object.keys(choices).length === 0) {
    return;
  }
  const byId = new Map<string, Inventory["geometryClusters"][number]>();
  for (const c of inventory.geometryClusters) {
    byId.set(c.clusterId, c);
  }
  for (const [clusterId, decision] of Object.entries(choices)) {
    if (!decision.name.trim()) {
      continue;
    }
    const cluster = byId.get(clusterId);
    if (!cluster) {
      throw new Error(
        `buildPlan: geometryClusters["${clusterId}"] is named but does not match any inventory.geometryClusters entry. `
        + `Re-run inventory if the file changed; otherwise fix the cluster id.`,
      );
    }
    const memberGuids = cluster.members.map((m) => m.nodeGuid);
    const exemplarGuid = memberGuids.reduce((best, g) => (g < best ? g : best));
    const action: ActionPromoteVectorCluster = {
      kind: "promote-vector-cluster",
      clusterId,
      clusterName: decision.name,
      exemplarGuid,
      memberGuids,
    };
    actions.push(action);
  }
}

function collectVariantClusterIds(decisions: Decisions): ReadonlySet<string> {
  const out = new Set<string>();
  const sets = decisions.variantSets;
  if (!sets) {
    return out;
  }
  for (const set of Object.values(sets)) {
    for (const id of Object.values(set.variants)) {
      out.add(id);
    }
  }
  return out;
}

/**
 * Emit one `group-as-variant-set` action per `decisions.variantSets`
 * entry. Throws on the four invalid configurations a downstream apply
 * cannot recover from:
 *
 *   - the cited cluster is not in the inventory
 *   - the cited cluster is not being promoted (no SYMBOL to group)
 *   - the same cluster appears in more than one variant set
 *   - the cited cluster's promote action was suppressed (e.g. by the
 *     non-promotable gate) — apply would have no SYMBOL to consume
 */
function pushVariantSetActions(
  actions: PlanAction[],
  inventory: Inventory,
  decisions: Decisions,
  promotedClusterIds: ReadonlySet<string>,
): void {
  const sets = decisions.variantSets;
  if (!sets || Object.keys(sets).length === 0) {
    return;
  }
  // The static authoring checks run before promote analysis in
  // `buildPlan`; here only the actual promote outcome remains.
  for (const [setName, set] of Object.entries(sets)) {
    const variants: { clusterId: string; propertyValue: string }[] = [];
    for (const [propertyValue, clusterId] of Object.entries(set.variants)) {
      if (!promotedClusterIds.has(clusterId)) {
        throw new Error(
          `buildPlan: variantSets["${setName}"].variants["${propertyValue}"] cites cluster "${clusterId}", `
          + `but its promote action was suppressed (the exemplar is not promotable). Resolve the promote skip first.`,
        );
      }
      variants.push({ clusterId, propertyValue });
    }
    const action: ActionGroupAsVariantSet = {
      kind: "group-as-variant-set",
      setName,
      propertyName: set.propertyName,
      variants,
    };
    actions.push(action);
  }
}

function assertNoSharedClusterAcrossSets(
  sets: Readonly<Record<string, { readonly variants: Readonly<Record<string, string>> }>>,
): void {
  const seenInSet = new Map<string, string>();
  for (const [setName, set] of Object.entries(sets)) {
    for (const clusterId of Object.values(set.variants)) {
      const prior = seenInSet.get(clusterId);
      if (prior && prior !== setName) {
        throw new Error(
          `buildPlan: cluster "${clusterId}" appears in more than one variant set ("${prior}" and "${setName}"). `
          + `Each cluster's SYMBOL can only live under one variant-set FRAME.`,
        );
      }
      seenInSet.set(clusterId, setName);
    }
  }
}

function assertClustersExistAndArePromoteToSymbol(
  sets: Readonly<Record<string, { readonly variants: Readonly<Record<string, string>> }>>,
  inventory: Inventory,
  decisions: Decisions,
): void {
  const clusterById = new Set<string>();
  for (const c of inventory.structureClusters) {
    clusterById.add(c.clusterId);
  }
  for (const [setName, set] of Object.entries(sets)) {
    for (const [propertyValue, clusterId] of Object.entries(set.variants)) {
      if (!clusterById.has(clusterId)) {
        throw new Error(
          `buildPlan: variantSets["${setName}"].variants["${propertyValue}"] points at unknown cluster "${clusterId}". `
          + `Use one of inventory.structureClusters[].clusterId.`,
        );
      }
      const decision = decisions.clusters[clusterId];
      if (!decision || decision.promoteToSymbol !== true) {
        throw new Error(
          `buildPlan: variantSets["${setName}"].variants["${propertyValue}"] cites cluster "${clusterId}" `
          + `but its cluster decision does not set promoteToSymbol=true. Only promoted SYMBOLs can be grouped.`,
        );
      }
    }
  }
}

/**
 * Emit one `set-layout` per `decisions.layouts[guid].apply = true`.
 * Values come from the inventory hint — no override channel: by
 * design, the agent's review of the inventory is the authoritative
 * signal, so the plan layer keeps the hint values verbatim.
 *
 * Fail-fast on the two clearly-wrong configurations the agent can
 * land in: an opt-in for a guid with no hint, or an opt-in flag that
 * is `false` (which would be a no-op and likely a typo — agents who
 * mean "don't apply" omit the entry).
 */
function pushSetLayoutActions(actions: PlanAction[], inventory: Inventory, decisions: Decisions): void {
  const layouts = decisions.layouts;
  if (!layouts || Object.keys(layouts).length === 0) {
    return;
  }
  const hintsByGuid = new Map<string, Inventory["layoutHints"][number]>();
  for (const h of inventory.layoutHints) {
    hintsByGuid.set(h.nodeGuid, h);
  }
  for (const [nodeGuid, decision] of Object.entries(layouts)) {
    if (decision.apply !== true) {
      throw new Error(
        `buildPlan: layouts["${nodeGuid}"].apply must be true to opt in. `
        + `Remove the entry instead of setting apply=false.`,
      );
    }
    const hint = hintsByGuid.get(nodeGuid);
    if (!hint) {
      throw new Error(
        `buildPlan: layouts["${nodeGuid}"] has no matching inventory.layoutHints entry. `
        + `Only auto-layouts the analyser surfaced can be applied — re-run inventory if the file changed.`,
      );
    }
    const action: ActionSetLayout = {
      kind: "set-layout",
      nodeGuid,
      layoutMode: hint.layoutMode,
      itemSpacing: hint.itemSpacing,
      paddingTop: hint.paddingTop,
      paddingRight: hint.paddingRight,
      paddingBottom: hint.paddingBottom,
      paddingLeft: hint.paddingLeft,
      counterAxisAlign: hint.counterAxisAlign,
    };
    actions.push(action);
  }
}

function pushFillBindings(actions: PlanAction[], entry: PaletteEntry, styleDefinition: StyleDefinitionRef): void {
  for (const usage of entry.usages) {
    if (usage.role !== "fill") {
      continue;
    }
    if (!usage.bindEligible) {
      continue;
    }
    const action: ActionBindFillStyle = {
      kind: "bind-fill-style",
      nodeGuid: usage.nodeGuid,
      styleDefinition,
    };
    actions.push(action);
  }
}

function pushTextBindings(actions: PlanAction[], entry: TypographyEntry, styleDefinition: StyleDefinitionRef): void {
  for (const usage of entry.usages) {
    const action: ActionBindTextStyle = {
      kind: "bind-text-style",
      nodeGuid: usage.nodeGuid,
      styleDefinition,
    };
    actions.push(action);
  }
}

function pickDeterministicExemplar(cluster: StructureClusterEntry): string {
  return cluster.members
    .map((m) => m.nodeGuid)
    .reduce((best, candidate) => (candidate < best ? candidate : best));
}
