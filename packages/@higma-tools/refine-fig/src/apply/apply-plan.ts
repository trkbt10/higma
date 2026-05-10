/**
 * @file Apply a `RefinePlan` to a `LoadedFigFile`.
 *
 * Walks the plan in order. The only state shared across actions is
 * the token table — proxy creation actions register the new GUID
 * for their `token`, and bind actions resolve `{ kind: "token" }`
 * proxy refs against it.
 *
 * Apply does no policy. It refuses unknown action kinds and reports
 * skipped actions with a structured reason. Safety invariants
 * (paint stack eligibility, leaf-icon-only) are the plan layer's
 * responsibility — re-checking here would duplicate the SoT.
 */
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import { createGuidAllocator, patchNodeChange } from "@higma-document-io/fig/roundtrip";
import { bootstrapFillProxy, bootstrapTextProxy, synthesiseFillProxy, synthesiseTextProxy } from "../proxies";
import { promoteIconCluster } from "../componentize";
import type {
  PlanAction,
  ActionCreateFillProxy,
  ActionCreateTextProxy,
  ActionBindFillStyle,
  ActionBindTextStyle,
  ActionPromoteIconCluster,
  ActionRename,
  ProxyRef,
  RefinePlan,
} from "../plan";

export type ApplyResult = {
  readonly fillProxiesCreated: number;
  readonly textProxiesCreated: number;
  readonly fillBound: number;
  readonly textBound: number;
  readonly clustersPromoted: number;
  readonly instancesRewritten: number;
  readonly renamed: number;
  readonly skipped: readonly { readonly action: PlanAction; readonly reason: string }[];
};

export type ApplyContext = {
  readonly internalCanvasGuid: string;
  /** GUID of any existing FILL-style proxy in the file, used as a template. */
  readonly fillTemplateGuid: string | undefined;
  /** GUID of any existing TEXT-style proxy in the file, used as a template. */
  readonly textTemplateGuid: string | undefined;
};

/** Apply every action in plan order, mutating `loaded.nodeChanges`. */
export function applyPlan(loaded: LoadedFigFile, plan: RefinePlan, ctx: ApplyContext): ApplyResult {
  const allocator = createGuidAllocator(loaded);
  const tokens = new Map<string, string>();
  const skipped: { action: PlanAction; reason: string }[] = [];
  const counts = {
    fillProxiesCreated: 0,
    textProxiesCreated: 0,
    fillBound: 0,
    textBound: 0,
    clustersPromoted: 0,
    instancesRewritten: 0,
    renamed: 0,
  };

  for (const action of plan.actions) {
    if (action.kind === "create-fill-proxy") {
      applyCreateFill(action, loaded, ctx, allocator, tokens, counts, skipped);
      continue;
    }
    if (action.kind === "create-text-proxy") {
      applyCreateText(action, loaded, ctx, allocator, tokens, counts, skipped);
      continue;
    }
    if (action.kind === "bind-fill-style") {
      applyBindFill(action, loaded, tokens, counts, skipped);
      continue;
    }
    if (action.kind === "bind-text-style") {
      applyBindText(action, loaded, tokens, counts, skipped);
      continue;
    }
    if (action.kind === "promote-icon-cluster") {
      applyPromote(action, loaded, counts, skipped);
      continue;
    }
    if (action.kind === "rename") {
      applyRename(action, loaded, counts, skipped);
      continue;
    }
  }
  return { ...counts, skipped };
}

function applyCreateFill(
  action: ActionCreateFillProxy,
  loaded: LoadedFigFile,
  ctx: ApplyContext,
  allocator: ReturnType<typeof createGuidAllocator>,
  tokens: Map<string, string>,
  counts: { fillProxiesCreated: number },
  skipped: { action: PlanAction; reason: string }[],
): void {
  void skipped;
  const created = createFillProxy(action, loaded, ctx, allocator);
  tokens.set(action.token, created.guid);
  counts.fillProxiesCreated = counts.fillProxiesCreated + 1;
}

/**
 * Pick the right FILL proxy strategy: clone an existing template
 * when one exists, otherwise bootstrap from scratch. Bootstrap
 * appends a fresh commands blob and assembles the proxy by hand,
 * so the create action lands either way.
 */
function createFillProxy(
  action: ActionCreateFillProxy,
  loaded: LoadedFigFile,
  ctx: ApplyContext,
  allocator: ReturnType<typeof createGuidAllocator>,
): { readonly guid: string } {
  if (ctx.fillTemplateGuid) {
    return synthesiseFillProxy({
      loaded,
      internalCanvasGuid: ctx.internalCanvasGuid,
      templateProxyGuid: ctx.fillTemplateGuid,
      allocator,
      name: action.name,
      color: action.color,
    });
  }
  return bootstrapFillProxy({
    loaded,
    internalCanvasGuid: ctx.internalCanvasGuid,
    allocator,
    name: action.name,
    color: action.color,
  });
}

function applyCreateText(
  action: ActionCreateTextProxy,
  loaded: LoadedFigFile,
  ctx: ApplyContext,
  allocator: ReturnType<typeof createGuidAllocator>,
  tokens: Map<string, string>,
  counts: { textProxiesCreated: number },
  skipped: { action: PlanAction; reason: string }[],
): void {
  void skipped;
  const created = createTextProxy(action, loaded, ctx, allocator);
  tokens.set(action.token, created.guid);
  counts.textProxiesCreated = counts.textProxiesCreated + 1;
}

/**
 * Pick the right TEXT proxy strategy: clone an existing template
 * when one exists, otherwise bootstrap from scratch. The bootstrap
 * path emits a proxy whose `derivedTextData` is left for Figma to
 * rebuild on next open — same fail-fast assumption the synthesise
 * path already relies on.
 */
function createTextProxy(
  action: ActionCreateTextProxy,
  loaded: LoadedFigFile,
  ctx: ApplyContext,
  allocator: ReturnType<typeof createGuidAllocator>,
): { readonly guid: string } {
  const fontName = { family: action.fontFamily, style: action.fontStyle, postscript: "" };
  if (ctx.textTemplateGuid) {
    return synthesiseTextProxy({
      loaded,
      internalCanvasGuid: ctx.internalCanvasGuid,
      templateProxyGuid: ctx.textTemplateGuid,
      allocator,
      name: action.name,
      descriptor: { fontName, fontSize: action.fontSize },
    });
  }
  return bootstrapTextProxy({
    loaded,
    internalCanvasGuid: ctx.internalCanvasGuid,
    allocator,
    name: action.name,
    fontName,
    fontSize: action.fontSize,
  });
}

function resolveProxy(ref: ProxyRef, tokens: ReadonlyMap<string, string>): string | undefined {
  if (ref.kind === "existing") {
    return ref.guid;
  }
  return tokens.get(ref.token);
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

function applyBindFill(
  action: ActionBindFillStyle,
  loaded: LoadedFigFile,
  tokens: ReadonlyMap<string, string>,
  counts: { fillBound: number },
  skipped: { action: PlanAction; reason: string }[],
): void {
  const proxyGuid = resolveProxy(action.proxy, tokens);
  if (!proxyGuid) {
    skipped.push({ action, reason: "proxy token did not resolve" });
    return;
  }
  const ok = patchNodeChange(loaded, action.nodeGuid, {
    styleIdForFill: { guid: parseGuidString(proxyGuid) },
  });
  if (!ok) {
    skipped.push({ action, reason: "node not in nodeChanges" });
    return;
  }
  counts.fillBound = counts.fillBound + 1;
}

function applyBindText(
  action: ActionBindTextStyle,
  loaded: LoadedFigFile,
  tokens: ReadonlyMap<string, string>,
  counts: { textBound: number },
  skipped: { action: PlanAction; reason: string }[],
): void {
  const proxyGuid = resolveProxy(action.proxy, tokens);
  if (!proxyGuid) {
    skipped.push({ action, reason: "proxy token did not resolve" });
    return;
  }
  const ok = patchNodeChange(loaded, action.nodeGuid, {
    textStyleId: parseGuidString(proxyGuid),
  });
  if (!ok) {
    skipped.push({ action, reason: "node not in nodeChanges" });
    return;
  }
  counts.textBound = counts.textBound + 1;
}

function applyPromote(
  action: ActionPromoteIconCluster,
  loaded: LoadedFigFile,
  counts: { clustersPromoted: number; instancesRewritten: number },
  skipped: { action: PlanAction; reason: string }[],
): void {
  try {
    const result = promoteIconCluster({
      loaded,
      clusterName: action.clusterName,
      memberGuids: action.memberGuids,
      exemplarGuid: action.exemplarGuid,
    });
    counts.clustersPromoted = counts.clustersPromoted + 1;
    counts.instancesRewritten = counts.instancesRewritten + result.instanceGuids.length;
  } catch (err) {
    skipped.push({ action, reason: err instanceof Error ? err.message : String(err) });
  }
}

function applyRename(
  action: ActionRename,
  loaded: LoadedFigFile,
  counts: { renamed: number },
  skipped: { action: PlanAction; reason: string }[],
): void {
  const trimmed = action.newName.trim();
  if (!trimmed) {
    skipped.push({ action, reason: "empty newName" });
    return;
  }
  const ok = patchNodeChange(loaded, action.nodeGuid, { name: trimmed });
  if (!ok) {
    skipped.push({ action, reason: "node not in nodeChanges" });
    return;
  }
  counts.renamed = counts.renamed + 1;
}

