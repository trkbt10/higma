/**
 * @file Apply a `RefinePlan` to a `LoadedFigFile`.
 *
 * Curate contract:
 *
 *   The agent reviews the visual workbench and edits the plan. Two
 *   simple flags drop a proposal:
 *
 *     - rename: set `suggestedName` to "" → drop. Otherwise the
 *       value (which the agent may relabel) is used verbatim.
 *
 *     - fill-style-bind: set `proxyGuid` to "" → drop. Relabeling the
 *       proxy is not supported — the proxy GUID is the address of an
 *       existing style node, not a free-text field.
 *
 *   Component candidates and text-style proposals are reported only
 *   in v1; nothing is applied for them, so editing them has no effect.
 *
 * v1 mutation scope:
 *
 *   - rename                — set the node's `name`.
 *   - fill-style-bind       — set the node's `styleIdForFill = { guid }`,
 *                             pointing at an existing FILL-style proxy.
 *                             The inline `fillPaints` cache is left in
 *                             place so older Figma renderers still see
 *                             the colour (Figma itself caches like this).
 *
 * Mutation goes through `patchNodeChange` — the only blessed entry-point
 * for editing `LoadedFigFile.nodeChanges`. Apply does no structural
 * casting on `FigNode`; the type-safe surface is the patch object.
 *
 * Safety invariants (paint-stack eligibility, proxy GUID match) are
 * the analyser's responsibility (see `bindablePaintsFor` in
 * `analysis/palette.ts`). Apply trusts the curated plan and applies
 * patches as-is — re-checking here would be a duplicate SoT.
 */
import type { FigNode, FigStyleId } from "@higma-document-models/fig/types";
import { patchNodeChange } from "@higma-document-io/fig/roundtrip";
import type { LoadedFigFile } from "@higma-document-io/fig/roundtrip";
import { guidToString } from "@higma-document-models/fig/domain";
import type { RefinePlan } from "../plan/types";

export type ApplyResult = {
  readonly renamed: number;
  readonly bound: number;
  readonly skippedRenames: readonly SkippedAction[];
  readonly skippedBindings: readonly SkippedAction[];
};

export type SkippedAction = {
  readonly nodeGuid: string;
  readonly reason: string;
};

/** Apply the v1 subset of a plan to a loaded file. Mutates `loaded.nodeChanges`. */
export function applyPlan(loaded: LoadedFigFile, plan: RefinePlan): ApplyResult {
  const byGuid = indexLoadedNodes(loaded);
  const renameOutcome = applyRenames(loaded, plan, byGuid);
  const bindOutcome = applyBindings(loaded, plan, byGuid);
  return {
    renamed: renameOutcome.applied,
    bound: bindOutcome.applied,
    skippedRenames: renameOutcome.skipped,
    skippedBindings: bindOutcome.skipped,
  };
}

function indexLoadedNodes(loaded: LoadedFigFile): ReadonlyMap<string, FigNode> {
  const out = new Map<string, FigNode>();
  for (const node of loaded.nodeChanges) {
    if (node.guid) {
      out.set(guidToString(node.guid), node);
    }
  }
  return out;
}

function parseGuidString(s: string): { sessionID: number; localID: number } {
  const [a, b] = s.split(":");
  if (a === undefined || b === undefined) {
    throw new Error(`applyPlan: bad guid string "${s}"`);
  }
  const sessionID = Number.parseInt(a, 10);
  const localID = Number.parseInt(b, 10);
  if (!Number.isFinite(sessionID) || !Number.isFinite(localID)) {
    throw new Error(`applyPlan: non-numeric guid "${s}"`);
  }
  return { sessionID, localID };
}

type ActionOutcome = {
  readonly applied: number;
  readonly skipped: readonly SkippedAction[];
};

function applyRenames(
  loaded: LoadedFigFile,
  plan: RefinePlan,
  byGuid: ReadonlyMap<string, FigNode>,
): ActionOutcome {
  const init: { applied: number; skipped: SkippedAction[] } = { applied: 0, skipped: [] };
  return plan.renames.reduce<ActionOutcome>((acc, action) => {
    const trimmed = (action.newName ?? "").trim();
    if (trimmed === "") {
      return appendSkip(acc, action.nodeGuid, "dropped by curator (empty newName)");
    }
    const node = byGuid.get(action.nodeGuid);
    if (!node) {
      return appendSkip(acc, action.nodeGuid, "node not in nodeChanges");
    }
    if (node.name !== action.oldName) {
      return appendSkip(
        acc,
        action.nodeGuid,
        `name drifted: expected "${action.oldName}", saw "${node.name ?? "(unset)"}"`,
      );
    }
    const updated = patchNodeChange(loaded, action.nodeGuid, { name: trimmed });
    if (!updated) {
      return appendSkip(acc, action.nodeGuid, "patchNodeChange could not match guid");
    }
    return { applied: acc.applied + 1, skipped: acc.skipped };
  }, init);
}

function applyBindings(
  loaded: LoadedFigFile,
  plan: RefinePlan,
  byGuid: ReadonlyMap<string, FigNode>,
): ActionOutcome {
  const init: { applied: number; skipped: SkippedAction[] } = { applied: 0, skipped: [] };
  return plan.fillStyleBindings.reduce<ActionOutcome>((acc, action) => {
    const trimmedProxy = (action.proxyGuid ?? "").trim();
    if (trimmedProxy === "") {
      return appendSkip(acc, action.nodeGuid, "dropped by curator (empty proxyGuid)");
    }
    if (!byGuid.has(action.nodeGuid)) {
      return appendSkip(acc, action.nodeGuid, "node not in nodeChanges");
    }
    const styleIdForFill: FigStyleId = { guid: parseGuidString(trimmedProxy) };
    const updated = patchNodeChange(loaded, action.nodeGuid, { styleIdForFill });
    if (!updated) {
      return appendSkip(acc, action.nodeGuid, "patchNodeChange could not match guid");
    }
    return { applied: acc.applied + 1, skipped: acc.skipped };
  }, init);
}

function appendSkip(
  acc: { readonly applied: number; readonly skipped: readonly SkippedAction[] },
  nodeGuid: string,
  reason: string,
): ActionOutcome {
  return { applied: acc.applied, skipped: [...acc.skipped, { nodeGuid, reason }] };
}
