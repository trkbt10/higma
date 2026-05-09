/**
 * @file `buildPlan` — combine an `Inventory` with the agent's
 * `Decisions` into a deterministic `RefinePlan`.
 *
 * Action order matters:
 *
 *   1. create-fill-proxy   (any new fill proxies)
 *   2. create-text-proxy   (any new text proxies)
 *   3. bind-fill-style     (rebind nodes to existing or fresh proxies)
 *   4. bind-text-style     (deferred when the source has no template)
 *   5. promote-icon-cluster (componentize)
 *   6. rename              (cluster names propagated to members)
 *
 * Renames produced by cluster decisions are emitted *after* the
 * promote actions, so the SYMBOL ends up named after the cluster
 * and so do its INSTANCEs.
 */
import type { Inventory, PaletteEntry, TypographyEntry, SubtreeClusterEntry } from "../inventory";
import type { Decisions } from "../decisions";
import type { RefineSource } from "../refine-source/load";
import type {
  RefinePlan,
  PlanAction,
  ActionCreateFillProxy,
  ActionCreateTextProxy,
  ActionBindFillStyle,
  ActionBindTextStyle,
  ActionPromoteIconCluster,
  ActionRename,
  ProxyRef,
} from "./types";
import { isLeafIconCluster } from "../componentize";

const LEAF_ICON_ROLE_RE = /^FRAME<(container|raw)>\(((FRAME<[^>]+>\((VECTOR|BOOLEAN_OPERATION)<[^>]+>(,(VECTOR|BOOLEAN_OPERATION)<[^>]+>)*\))|(VECTOR|BOOLEAN_OPERATION)<[^>]+>(,(VECTOR|BOOLEAN_OPERATION)<[^>]+>)*)\)$/;

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
  const skippedNonIconClusters: string[] = [];
  const missingTemplates: { kind: "fill" | "text"; name: string }[] = [];

  // ---- Fill proxies + bindings ------------------------------------------
  const tokenByPaletteKey = new Map<string, string>();
  for (const entry of inventory.palette) {
    const decision = decisions.palette[entry.key];
    if (!decision || !decision.name.trim()) {
      continue;
    }
    if (entry.existingProxyGuid) {
      // No proxy creation needed — bind to the existing GUID.
      pushFillBindings(actions, entry, { kind: "existing", guid: entry.existingProxyGuid });
      continue;
    }
    if (source.fillStyleProxies.length === 0) {
      missingTemplates.push({ kind: "fill", name: decision.name });
      continue;
    }
    const token = `fill:${entry.key}`;
    tokenByPaletteKey.set(entry.key, token);
    const create: ActionCreateFillProxy = {
      kind: "create-fill-proxy",
      token,
      name: decision.name,
      color: entry.color,
    };
    actions.push(create);
    pushFillBindings(actions, entry, { kind: "token", token });
  }

  // ---- Text proxies + bindings ------------------------------------------
  for (const entry of inventory.typography) {
    const decision = decisions.typography[entry.key];
    if (!decision || !decision.name.trim()) {
      continue;
    }
    if (entry.existingProxyGuid) {
      pushTextBindings(actions, entry, { kind: "existing", guid: entry.existingProxyGuid });
      continue;
    }
    if (source.textStyleProxies.length === 0) {
      missingTemplates.push({ kind: "text", name: decision.name });
      continue;
    }
    const token = `text:${entry.key}`;
    const create: ActionCreateTextProxy = {
      kind: "create-text-proxy",
      token,
      name: decision.name,
      fontFamily: entry.descriptor.fontFamily,
      fontStyle: entry.descriptor.fontStyle,
      fontWeight: entry.descriptor.fontWeight,
      fontSize: entry.descriptor.fontSize,
    };
    actions.push(create);
    pushTextBindings(actions, entry, { kind: "token", token });
  }

  // ---- Cluster promote + rename ----------------------------------------
  for (const cluster of inventory.subtreeClusters) {
    const decision = decisions.clusters[cluster.clusterId];
    if (!decision || !decision.name.trim()) {
      continue;
    }
    const exemplarGuid = decision.exemplarGuid ?? pickDeterministicExemplar(cluster);
    if (decision.promoteToSymbol === true) {
      // We can only honour this if the cluster is a leaf-icon and
      // the exemplar still resolves to one. Otherwise log + skip
      // promote, but still emit a rename for every member so the
      // cluster gets its authored name even without componentize.
      if (LEAF_ICON_ROLE_RE.test(cluster.roleSignature) && isLeafIconCluster(source.loaded, exemplarGuid)) {
        const promote: ActionPromoteIconCluster = {
          kind: "promote-icon-cluster",
          clusterId: cluster.clusterId,
          clusterName: decision.name,
          exemplarGuid,
          memberGuids: cluster.members.map((m) => m.nodeGuid),
        };
        actions.push(promote);
      } else {
        skippedNonIconClusters.push(cluster.clusterId);
      }
    }
    // Always emit explicit renames for cluster members (even when
    // promoted — Figma will display the SYMBOL's name on every
    // INSTANCE by default, but explicit names on the INSTANCEs help
    // the agent verify the result).
    for (const member of cluster.members) {
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

  return {
    source: { file: options.file, bytes: options.bytes },
    actions,
    diagnostics: { skippedNonIconClusters, missingTemplates },
  };
}

function pushFillBindings(actions: PlanAction[], entry: PaletteEntry, proxy: ProxyRef): void {
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
      proxy,
    };
    actions.push(action);
  }
}

function pushTextBindings(actions: PlanAction[], entry: TypographyEntry, proxy: ProxyRef): void {
  for (const usage of entry.usages) {
    const action: ActionBindTextStyle = {
      kind: "bind-text-style",
      nodeGuid: usage.nodeGuid,
      proxy,
    };
    actions.push(action);
  }
}

function pickDeterministicExemplar(cluster: SubtreeClusterEntry): string {
  return cluster.members
    .map((m) => m.nodeGuid)
    .reduce((best, candidate) => (candidate < best ? candidate : best));
}
