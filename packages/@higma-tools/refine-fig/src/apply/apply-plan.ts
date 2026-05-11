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
import type { FigNode } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import { getNodeType } from "@higma-document-models/fig/domain";
import { addNodeChange, createGuidAllocator, patchNodeChange } from "@higma-document-io/fig/roundtrip";
import { bootstrapFillProxy, bootstrapTextProxy, synthesiseFillProxy, synthesiseTextProxy } from "../proxies";
import { promoteIconCluster } from "../componentize";
import { promoteVectorCluster } from "../componentize/promote-vector-cluster";
import type {
  PlanAction,
  ActionEnsureInternalCanvas,
  ActionCreateFillProxy,
  ActionCreateTextProxy,
  ActionBindFillStyle,
  ActionBindTextStyle,
  ActionPromoteIconCluster,
  ActionPromoteVectorCluster,
  ActionGroupAsVariantSet,
  ActionSetLayout,
  ActionRename,
  ProxyRef,
  RefinePlan,
} from "../plan";

export type ApplyResult = {
  /** Whether the plan inserted a brand-new Internal Only Canvas. */
  readonly internalCanvasCreated: boolean;
  readonly fillProxiesCreated: number;
  readonly textProxiesCreated: number;
  readonly fillBound: number;
  readonly textBound: number;
  readonly clustersPromoted: number;
  readonly instancesRewritten: number;
  readonly vectorClustersPromoted: number;
  readonly vectorInstancesRewritten: number;
  readonly variantSetsCreated: number;
  readonly layoutsApplied: number;
  readonly renamed: number;
  readonly skipped: readonly { readonly action: PlanAction; readonly reason: string }[];
};

export type ApplyContext = {
  /**
   * GUID of an existing Internal Only Canvas. When undefined, the plan
   * must contain an `ensure-internal-canvas` action — the apply layer
   * will create the canvas and store its GUID internally before any
   * `create-*-proxy` action references it.
   */
  readonly internalCanvasGuid: string | undefined;
  /** GUID of any existing FILL-style proxy in the file, used as a template. */
  readonly fillTemplateGuid: string | undefined;
  /** GUID of any existing TEXT-style proxy in the file, used as a template. */
  readonly textTemplateGuid: string | undefined;
};

/**
 * Mutable per-pass state. Tokens, skipped actions, counts, and the
 * resolved internal canvas guid are all populated by individual
 * handlers. A single `applyPlan` call keeps one allocator, one token
 * table, and one canvas guid so the ensure-internal-canvas action's
 * effect threads through every subsequent create-*-proxy.
 */
type ApplyState = {
  readonly allocator: ReturnType<typeof createGuidAllocator>;
  readonly tokens: Map<string, string>;
  /** SYMBOL guid produced by each successful `promote-icon-cluster`. */
  readonly promotedSymbolByClusterId: Map<string, string>;
  readonly skipped: { action: PlanAction; reason: string }[];
  internalCanvasGuid: string | undefined;
  internalCanvasCreated: boolean;
  counts: {
    fillProxiesCreated: number;
    textProxiesCreated: number;
    fillBound: number;
    textBound: number;
    clustersPromoted: number;
    instancesRewritten: number;
    vectorClustersPromoted: number;
    vectorInstancesRewritten: number;
    variantSetsCreated: number;
    layoutsApplied: number;
    renamed: number;
  };
};

/** Apply every action in plan order, mutating `loaded.nodeChanges`. */
export function applyPlan(loaded: LoadedFigFile, plan: RefinePlan, ctx: ApplyContext): ApplyResult {
  const state: ApplyState = {
    allocator: createGuidAllocator(loaded),
    tokens: new Map<string, string>(),
    promotedSymbolByClusterId: new Map<string, string>(),
    skipped: [],
    internalCanvasGuid: ctx.internalCanvasGuid,
    internalCanvasCreated: false,
    counts: {
      fillProxiesCreated: 0,
      textProxiesCreated: 0,
      fillBound: 0,
      textBound: 0,
      clustersPromoted: 0,
      instancesRewritten: 0,
      vectorClustersPromoted: 0,
      vectorInstancesRewritten: 0,
      variantSetsCreated: 0,
      layoutsApplied: 0,
      renamed: 0,
    },
  };

  for (const action of plan.actions) {
    if (action.kind === "ensure-internal-canvas") {
      applyEnsureCanvas(action, loaded, state);
      continue;
    }
    if (action.kind === "create-fill-proxy") {
      applyCreateFill(action, loaded, ctx, state);
      continue;
    }
    if (action.kind === "create-text-proxy") {
      applyCreateText(action, loaded, ctx, state);
      continue;
    }
    if (action.kind === "bind-fill-style") {
      applyBindFill(action, loaded, state);
      continue;
    }
    if (action.kind === "bind-text-style") {
      applyBindText(action, loaded, state);
      continue;
    }
    if (action.kind === "promote-icon-cluster") {
      applyPromote(action, loaded, state);
      continue;
    }
    if (action.kind === "promote-vector-cluster") {
      applyPromoteVectorCluster(action, loaded, state);
      continue;
    }
    if (action.kind === "group-as-variant-set") {
      applyGroupAsVariantSet(action, loaded, state);
      continue;
    }
    if (action.kind === "set-layout") {
      applySetLayout(action, loaded, state);
      continue;
    }
    if (action.kind === "rename") {
      applyRename(action, loaded, state);
      continue;
    }
  }
  return {
    internalCanvasCreated: state.internalCanvasCreated,
    ...state.counts,
    skipped: state.skipped,
  };
}

/**
 * Group every promoted SYMBOL named by the action under one new
 * FRAME with `isStateGroup = true` and a single VARIANT-typed
 * `componentPropDefs[]` entry. Each grouped SYMBOL is renamed to
 * `<propertyName>=<value>` and re-parented onto the new FRAME.
 *
 * Apply-time checks:
 *
 *   - Every cited cluster must have a promotedSymbolByClusterId entry
 *     (i.e. its earlier `promote-icon-cluster` action succeeded).
 *   - All SYMBOLs must share a common parent canvas — we inherit the
 *     new FRAME's parent from the first SYMBOL. The plan layer is
 *     expected to keep cross-canvas grouping out; mixing canvases at
 *     apply time produces a still-valid FRAME but possibly surprising
 *     placement, so we record a skip with a clear reason rather than
 *     silently re-parenting cross-canvas.
 */
function applyGroupAsVariantSet(
  action: ActionGroupAsVariantSet,
  loaded: LoadedFigFile,
  state: ApplyState,
): void {
  if (action.variants.length === 0) {
    state.skipped.push({ action, reason: "variant set has zero variants" });
    return;
  }
  const symbolGuids = action.variants.map((v) => state.promotedSymbolByClusterId.get(v.clusterId));
  const missing = action.variants
    .map((v, i) => (symbolGuids[i] ? undefined : v.clusterId))
    .filter((id): id is string => Boolean(id));
  if (missing.length > 0) {
    state.skipped.push({
      action,
      reason: `promoted SYMBOL missing for cluster(s): ${missing.join(", ")}`,
    });
    return;
  }
  // Resolve parent canvas from the first SYMBOL.
  const firstSymbol = loaded.nodeChanges.find((n) => guidStr(n) === symbolGuids[0]);
  if (!firstSymbol) {
    state.skipped.push({ action, reason: "first SYMBOL not in nodeChanges" });
    return;
  }
  const sharedParent = firstSymbol.parentIndex?.guid;
  if (!sharedParent) {
    state.skipped.push({ action, reason: "first SYMBOL has no parent" });
    return;
  }
  // Refuse to mix canvases at apply time — the plan layer should not
  // produce this case in practice; fail-fast.
  for (const sg of symbolGuids) {
    const node = loaded.nodeChanges.find((n) => guidStr(n) === sg);
    const p = node?.parentIndex?.guid;
    if (!p || `${p.sessionID}:${p.localID}` !== `${sharedParent.sessionID}:${sharedParent.localID}`) {
      state.skipped.push({
        action,
        reason: `cluster SYMBOLs do not share a common parent canvas`,
      });
      return;
    }
  }

  // Build the propDef + FRAME.
  const propDefId = state.allocator.next();
  const frameGuid = state.allocator.next();
  const setFrame: FigNode = {
    guid: frameGuid,
    phase: { value: 0, name: "CREATED" },
    parentIndex: { guid: sharedParent, position: nextChildSortPosition(loaded, sharedParent) },
    type: { value: 4, name: "FRAME" },
    name: action.setName,
    isStateGroup: true,
    componentPropDefs: [
      {
        id: propDefId,
        // ComponentPropType.VARIANT = 4 in the canonical Kiwi schema
        // (figma-schema.json). Other values: BOOL=0, TEXT=1, COLOR=2,
        // INSTANCE_SWAP=3, NUMBER=5, IMAGE=6, SLOT=7. Using the wrong
        // value would round-trip back as TEXT and isVariantSetFrame
        // would reject the result.
        name: action.propertyName,
        type: { value: 4, name: "VARIANT" },
      },
    ],
  };
  addNodeChange(loaded, setFrame);

  // Move every SYMBOL into the new FRAME and rewrite its name.
  for (const [idx, variant] of action.variants.entries()) {
    const symbolGuid = symbolGuids[idx];
    if (!symbolGuid) {
      continue;
    }
    const symbolNode = loaded.nodeChanges.find((n) => guidStr(n) === symbolGuid);
    if (!symbolNode) {
      continue;
    }
    const variantName = `${action.propertyName}=${variant.propertyValue}`;
    const ok = patchNodeChange(loaded, symbolGuid, {
      name: variantName,
      parentIndex: { guid: frameGuid, position: `variant-${idx}` },
      variantPropSpecs: [{ propDefId, value: variant.propertyValue }],
    });
    if (!ok) {
      state.skipped.push({
        action,
        reason: `patch failed for symbol ${symbolGuid}`,
      });
      return;
    }
  }
  state.counts.variantSetsCreated = state.counts.variantSetsCreated + 1;
}

/**
 * Apply an auto-layout inference. Patches the FRAME with `stackMode`,
 * `stackSpacing`, and per-side padding so Figma treats it as an
 * auto-layout container. Values come straight from the action; the
 * apply layer does not re-infer.
 *
 * StackMode enum (figma-schema.json → StackMode): HORIZONTAL=1,
 * VERTICAL=2. Other padding fields are doubles; the plan rounded them
 * before emitting.
 */
function counterAxisEnumValue(align: "MIN" | "CENTER" | "MAX"): number {
  if (align === "MIN") {
    return 0;
  }
  if (align === "CENTER") {
    return 1;
  }
  return 2;
}

function applySetLayout(
  action: ActionSetLayout,
  loaded: LoadedFigFile,
  state: ApplyState,
): void {
  const stackModeValue = action.layoutMode === "HORIZONTAL" ? 1 : 2;
  // StackCounterAlign enum (figma-schema.json): MIN=0, CENTER=1, MAX=2.
  const counterValue = counterAxisEnumValue(action.counterAxisAlign);
  const ok = patchNodeChange(loaded, action.nodeGuid, {
    stackMode: { value: stackModeValue, name: action.layoutMode },
    stackSpacing: action.itemSpacing,
    stackHorizontalPadding: action.paddingLeft,
    stackPaddingRight: action.paddingRight,
    stackVerticalPadding: action.paddingTop,
    stackPaddingBottom: action.paddingBottom,
    stackCounterAlignItems: { value: counterValue, name: action.counterAxisAlign },
  });
  if (!ok) {
    state.skipped.push({ action, reason: "node not in nodeChanges" });
    return;
  }
  state.counts.layoutsApplied = state.counts.layoutsApplied + 1;
}

function guidStr(node: FigNode): string {
  const g = node.guid;
  if (!g) {
    return "";
  }
  return `${g.sessionID}:${g.localID}`;
}

function nextChildSortPosition(
  loaded: LoadedFigFile,
  parentGuid: { sessionID: number; localID: number },
): string {
  const parentKey = `${parentGuid.sessionID}:${parentGuid.localID}`;
  const positions = loaded.nodeChanges
    .filter((n) => {
      const p = n.parentIndex?.guid;
      if (!p) {
        return false;
      }
      return `${p.sessionID}:${p.localID}` === parentKey;
    })
    .map((n) => n.parentIndex?.position ?? "");
  if (positions.length === 0) {
    return "z";
  }
  const max = positions.reduce((best, p) => (p > best ? p : best), positions[0] ?? "");
  return `${max}z`;
}

/**
 * Insert a fresh DOCUMENT-rooted CANVAS marked `internalOnly: true`.
 * The new GUID overwrites `state.internalCanvasGuid` for any
 * subsequent `create-*-proxy` action. Idempotent guard: if an
 * internal canvas already exists in state we skip — at most one ensure
 * action per plan and the builder enforces that.
 */
function applyEnsureCanvas(
  action: ActionEnsureInternalCanvas,
  loaded: LoadedFigFile,
  state: ApplyState,
): void {
  if (state.internalCanvasGuid !== undefined) {
    state.skipped.push({ action, reason: "internal canvas already exists" });
    return;
  }
  const documentGuid = findDocumentGuid(loaded);
  if (!documentGuid) {
    state.skipped.push({ action, reason: "loaded file has no DOCUMENT node" });
    return;
  }
  const newGuid = state.allocator.next();
  const canvas: FigNode = {
    guid: newGuid,
    phase: { value: 0, name: "CREATED" },
    parentIndex: { guid: documentGuid, position: nextDocumentChildSortPosition(loaded, documentGuid) },
    type: { value: 2, name: "CANVAS" },
    name: action.name,
    internalOnly: true,
    visible: true,
  };
  addNodeChange(loaded, canvas);
  state.internalCanvasGuid = `${newGuid.sessionID}:${newGuid.localID}`;
  state.internalCanvasCreated = true;
}

function findDocumentGuid(loaded: LoadedFigFile): { sessionID: number; localID: number } | undefined {
  const doc = loaded.nodeChanges.find((n) => getNodeType(n) === "DOCUMENT");
  return doc?.guid;
}

/**
 * Pick a sortPosition past every direct child of the document. Same
 * idea as the per-canvas allocator in `bootstrap-fill.ts` — Figma's
 * lex-string positions only need monotonic uniqueness here.
 */
function nextDocumentChildSortPosition(
  loaded: LoadedFigFile,
  documentGuid: { sessionID: number; localID: number },
): string {
  const docKey = `${documentGuid.sessionID}:${documentGuid.localID}`;
  const positions = loaded.nodeChanges
    .filter((n) => {
      const p = n.parentIndex?.guid;
      if (!p) {
        return false;
      }
      return `${p.sessionID}:${p.localID}` === docKey;
    })
    .map((n) => n.parentIndex?.position ?? "");
  if (positions.length === 0) {
    return "z";
  }
  const max = positions.reduce((best, p) => (p > best ? p : best), positions[0] ?? "");
  return `${max}z`;
}

function applyCreateFill(
  action: ActionCreateFillProxy,
  loaded: LoadedFigFile,
  ctx: ApplyContext,
  state: ApplyState,
): void {
  const internalCanvasGuid = state.internalCanvasGuid;
  if (!internalCanvasGuid) {
    state.skipped.push({ action, reason: "no internal canvas; plan must emit ensure-internal-canvas first" });
    return;
  }
  const created = createFillProxyNode(action, loaded, ctx, state, internalCanvasGuid);
  state.tokens.set(action.token, created.guid);
  state.counts.fillProxiesCreated = state.counts.fillProxiesCreated + 1;
}

/**
 * Pick the right FILL proxy strategy: clone an existing template when
 * one exists, otherwise bootstrap from scratch. Bootstrap appends a
 * fresh commands blob and assembles the proxy by hand, so the create
 * action lands either way.
 */
function createFillProxyNode(
  action: ActionCreateFillProxy,
  loaded: LoadedFigFile,
  ctx: ApplyContext,
  state: ApplyState,
  internalCanvasGuid: string,
): { readonly guid: string } {
  if (ctx.fillTemplateGuid) {
    return synthesiseFillProxy({
      loaded,
      internalCanvasGuid,
      templateProxyGuid: ctx.fillTemplateGuid,
      allocator: state.allocator,
      name: action.name,
      color: action.color,
    });
  }
  return bootstrapFillProxy({
    loaded,
    internalCanvasGuid,
    allocator: state.allocator,
    name: action.name,
    color: action.color,
  });
}

function applyCreateText(
  action: ActionCreateTextProxy,
  loaded: LoadedFigFile,
  ctx: ApplyContext,
  state: ApplyState,
): void {
  const internalCanvasGuid = state.internalCanvasGuid;
  if (!internalCanvasGuid) {
    state.skipped.push({ action, reason: "no internal canvas; plan must emit ensure-internal-canvas first" });
    return;
  }
  const created = createTextProxyNode(action, loaded, ctx, state, internalCanvasGuid);
  state.tokens.set(action.token, created.guid);
  state.counts.textProxiesCreated = state.counts.textProxiesCreated + 1;
}

/**
 * Pick the right TEXT proxy strategy: clone an existing template when
 * one exists, otherwise bootstrap from scratch. The bootstrap path
 * emits a proxy whose `derivedTextData` is left for Figma to rebuild
 * on next open — same fail-fast assumption the synthesise path
 * already relies on.
 */
function createTextProxyNode(
  action: ActionCreateTextProxy,
  loaded: LoadedFigFile,
  ctx: ApplyContext,
  state: ApplyState,
  internalCanvasGuid: string,
): { readonly guid: string } {
  const fontName = { family: action.fontFamily, style: action.fontStyle, postscript: "" };
  if (ctx.textTemplateGuid) {
    return synthesiseTextProxy({
      loaded,
      internalCanvasGuid,
      templateProxyGuid: ctx.textTemplateGuid,
      allocator: state.allocator,
      name: action.name,
      descriptor: { fontName, fontSize: action.fontSize },
    });
  }
  return bootstrapTextProxy({
    loaded,
    internalCanvasGuid,
    allocator: state.allocator,
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
  state: ApplyState,
): void {
  const proxyGuid = resolveProxy(action.proxy, state.tokens);
  if (!proxyGuid) {
    state.skipped.push({ action, reason: "proxy token did not resolve" });
    return;
  }
  const ok = patchNodeChange(loaded, action.nodeGuid, {
    styleIdForFill: { guid: parseGuidString(proxyGuid) },
  });
  if (!ok) {
    state.skipped.push({ action, reason: "node not in nodeChanges" });
    return;
  }
  state.counts.fillBound = state.counts.fillBound + 1;
}

function applyBindText(
  action: ActionBindTextStyle,
  loaded: LoadedFigFile,
  state: ApplyState,
): void {
  const proxyGuid = resolveProxy(action.proxy, state.tokens);
  if (!proxyGuid) {
    state.skipped.push({ action, reason: "proxy token did not resolve" });
    return;
  }
  const ok = patchNodeChange(loaded, action.nodeGuid, {
    textStyleId: parseGuidString(proxyGuid),
  });
  if (!ok) {
    state.skipped.push({ action, reason: "node not in nodeChanges" });
    return;
  }
  state.counts.textBound = state.counts.textBound + 1;
}

function applyPromote(
  action: ActionPromoteIconCluster,
  loaded: LoadedFigFile,
  state: ApplyState,
): void {
  try {
    const result = promoteIconCluster({
      loaded,
      clusterName: action.clusterName,
      memberGuids: action.memberGuids,
      exemplarGuid: action.exemplarGuid,
    });
    state.counts.clustersPromoted = state.counts.clustersPromoted + 1;
    state.counts.instancesRewritten = state.counts.instancesRewritten + result.instanceGuids.length;
    // Record the promoted SYMBOL's guid so a later
    // group-as-variant-set action can find it. promoteIconCluster
    // returns symbolGuid === exemplarGuid; we use the action's
    // clusterId as the key.
    state.promotedSymbolByClusterId.set(action.clusterId, result.symbolGuid);
  } catch (err) {
    state.skipped.push({ action, reason: err instanceof Error ? err.message : String(err) });
  }
}

function applyPromoteVectorCluster(
  action: ActionPromoteVectorCluster,
  loaded: LoadedFigFile,
  state: ApplyState,
): void {
  const internalCanvasGuid = state.internalCanvasGuid;
  if (!internalCanvasGuid) {
    state.skipped.push({
      action,
      reason: "no internal canvas; plan must emit ensure-internal-canvas first",
    });
    return;
  }
  try {
    const result = promoteVectorCluster({
      loaded,
      clusterName: action.clusterName,
      memberGuids: action.memberGuids,
      exemplarGuid: action.exemplarGuid,
      internalCanvasGuid,
      allocator: state.allocator,
    });
    state.counts.vectorClustersPromoted = state.counts.vectorClustersPromoted + 1;
    state.counts.vectorInstancesRewritten = state.counts.vectorInstancesRewritten + result.instanceGuids.length;
  } catch (err) {
    state.skipped.push({ action, reason: err instanceof Error ? err.message : String(err) });
  }
}

function applyRename(
  action: ActionRename,
  loaded: LoadedFigFile,
  state: ApplyState,
): void {
  const trimmed = action.newName.trim();
  if (!trimmed) {
    state.skipped.push({ action, reason: "empty newName" });
    return;
  }
  const ok = patchNodeChange(loaded, action.nodeGuid, { name: trimmed });
  if (!ok) {
    state.skipped.push({ action, reason: "node not in nodeChanges" });
    return;
  }
  state.counts.renamed = state.counts.renamed + 1;
}

