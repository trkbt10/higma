/**
 * @file Apply a `RefinePlan` via the editor reducer.
 *
 * Phase 2 of the SoT consolidation: this module used to mutate
 * `LoadedFigFile.nodeChanges` in place through `addNodeChange` /
 * `patchNodeChange` / hand-written Kiwi node construction. That route
 * bypassed `FigDesignDocument` (the high-level model that
 * `document-to-tree.ts` projects into Kiwi as a single SoT) and
 * therefore produced .fig files that drifted from real Figma exports —
 * SYMBOLs without `isSymbolPublishable`, FRAMEs with broken
 * `frameMaskDisabled`, INSTANCEs without `derivedSymbolData`.
 *
 * The new pipeline:
 *
 *   1. `createFigDesignDocumentFromLoaded(loaded)` lifts the raw file
 *      into the domain model.
 *   2. Each `PlanAction` is mapped to one or more `figEditorReducer`
 *      actions (Phase 1) and dispatched. The reducer's pure handlers
 *      mutate `FigDesignDocument` only — they never touch Kiwi nodes.
 *   3. `documentToTree(doc)` re-projects the mutated document back
 *      into a `nodeChanges` array, which we splice into `loaded` so
 *      the caller's existing `saveFigFile(loaded)` flow continues to
 *      work without changes.
 *
 * The plan still speaks in raw GUID strings because that's how the
 * planner emits actions. We convert GUIDs to branded `FigNodeId`s at
 * the boundary; we never accept FigNodeIds at the plan surface.
 */
import type { LoadedFigFile, FigNodeId, FigPageId, FigDesignDocument, FigDesignNode } from "@higma-document-models/fig/domain";
import { toNodeId } from "@higma-document-models/fig/domain";
import type { FigStyleId } from "@higma-document-models/fig/types";
import { documentToTree, treeToDocument } from "@higma-document-io/fig/context";
import { createFigSymbolContextFromLoaded } from "@higma-document-io/fig/context";
import { createFigEditorState, figEditorReducer } from "@higma-document-editors/fig";
import type { FigEditorState } from "@higma-document-editors/fig";
import { dfsById } from "@higma-primitives/tree";
import {
  isPromotableCluster,
  subtreeFingerprint,
} from "../componentize/promote-icon-cluster";
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
   * GUID of an existing Internal Only Canvas in the loaded file (the
   * page itself — `internalOnly: true`). Used as the host page for
   * `create-*-proxy` actions. When undefined, the plan must contain
   * an `ensure-internal-canvas` action.
   */
  readonly internalCanvasGuid: string | undefined;
  /**
   * GUID of the user-visible CANVAS that hosts promoted vector
   * SYMBOLs. Figma rejects SYMBOLs parented under the Internal Only
   * Canvas (their INSTANCEs render blank), so they live alongside
   * existing user content. Required when the plan contains any
   * `promote-vector-cluster` action.
   */
  readonly userCanvasGuid: string | undefined;
  /**
   * Reserved for backwards compatibility with the previous apply
   * implementation that cloned existing FILL/TEXT proxies. Phase 1's
   * `ADD_FILL_PROXY` / `ADD_TEXT_PROXY` actions bootstrap proxies from
   * scratch with their own geometry blob, so the template GUIDs are
   * unused. Kept on the type so existing CLI / spec callers compile.
   */
  readonly fillTemplateGuid: string | undefined;
  readonly textTemplateGuid: string | undefined;
};

// =============================================================================
// Mutable per-pass state — bridges plan-local concepts (tokens, cluster
// IDs) onto the document-side identifiers each reducer action expects.
// =============================================================================

type ApplyState = {
  /** `state.documentHistory.present` is the live `FigDesignDocument`. */
  editor: FigEditorState;
  /** Plan-local proxy token → resolved FigNodeId. */
  readonly tokens: Map<string, FigNodeId>;
  /** `promote-icon-cluster.clusterId` → SYMBOL FigNodeId (== exemplar). */
  readonly promotedSymbolByClusterId: Map<string, FigNodeId>;
  /** FigPageId of the Internal Only Canvas, resolved once. */
  internalCanvasPageId: FigPageId | undefined;
  internalCanvasCreated: boolean;
  readonly skipped: { action: PlanAction; reason: string }[];
  counts: ApplyCounts;
};

type ApplyCounts = {
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

function newCounts(): ApplyCounts {
  return {
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
  };
}

// =============================================================================
// Public entry — same signature the CLI and specs already call.
// =============================================================================

/**
 * Apply every action in plan order. Splices the resulting
 * `nodeChanges` / `blobs` back into the caller's `loaded` so the
 * existing `saveFigFile(loaded)` continues to produce a valid .fig.
 */
export function applyPlan(loaded: LoadedFigFile, plan: RefinePlan, ctx: ApplyContext): ApplyResult {
  // refine-fig's plan layer hosts style proxies on the Internal Only
  // Canvas, so we must keep that page in the editing document.
  // `treeToDocument(..., canvasVisibility: "all")` is the only entry
  // that includes the internal canvas; the round-trip fidelity of
  // that path is Phase 0a's responsibility (see phase-0a.md item H).
  const symbolCtx = createFigSymbolContextFromLoaded(loaded);
  const doc = treeToDocument(symbolCtx.tree, {
    blobs: loaded.blobs,
    images: loaded.images,
    metadata: loaded.metadata,
    canvasVisibility: "all",
  }, { styleRegistry: symbolCtx.styleRegistry });
  const editor = createFigEditorState(doc);
  const state: ApplyState = {
    editor,
    tokens: new Map<string, FigNodeId>(),
    promotedSymbolByClusterId: new Map<string, FigNodeId>(),
    internalCanvasPageId: resolveInitialInternalCanvasPageId(doc, ctx),
    internalCanvasCreated: false,
    skipped: [],
    counts: newCounts(),
  };

  for (const action of plan.actions) {
    dispatchPlanAction(loaded, action, state);
  }

  // Reproject the final document into nodeChanges and write it back
  // onto the caller's `loaded`. This is the single point where the
  // domain model meets Kiwi — every load-bearing field is materialised
  // by `document-to-tree.designNodeToFigNode`.
  const finalDoc = state.editor.documentHistory.present;
  const projected = documentToTree(finalDoc);
  // `LoadedFigFile` is declared fully readonly post-Phase 3-C. Splice
  // the freshly-projected node tree + blobs in via an `unknown` widening
  // — the legacy refine-fig pipeline still expects to thread the same
  // `loaded` handle through downstream consumers. This is the one
  // exception left in the codebase; a follow-up will convert
  // `applyPlanInPlace` to return a new `LoadedFigFile` instead of
  // mutating the input.
  const mutableLoaded = loaded as unknown as {
    nodeChanges: typeof projected.nodeChanges;
    blobs: typeof projected.blobs;
  };
  mutableLoaded.nodeChanges = projected.nodeChanges;
  mutableLoaded.blobs = projected.blobs;

  return {
    internalCanvasCreated: state.internalCanvasCreated,
    ...state.counts,
    skipped: state.skipped,
  };
}

// =============================================================================
// Internal Only Canvas resolution
// =============================================================================

function resolveInitialInternalCanvasPageId(
  doc: FigDesignDocument,
  ctx: ApplyContext,
): FigPageId | undefined {
  const page = doc.pages.find((p) => p.internalOnly === true);
  if (page) {
    return page.id;
  }
  // The plan layer historically supplied the guid in `ctx`. Convert it
  // to a FigPageId when we can; otherwise wait for an
  // `ensure-internal-canvas` action.
  if (ctx.internalCanvasGuid !== undefined) {
    return doc.pages.find((p) => p.id === ctx.internalCanvasGuid)?.id;
  }
  return undefined;
}

// =============================================================================
// Plan action dispatch
// =============================================================================

function dispatchPlanAction(loaded: LoadedFigFile, action: PlanAction, state: ApplyState): void {
  switch (action.kind) {
    case "ensure-internal-canvas":
      return applyEnsureInternalCanvas(action, state);
    case "create-fill-proxy":
      return applyCreateFillProxy(action, state);
    case "create-text-proxy":
      return applyCreateTextProxy(action, state);
    case "bind-fill-style":
      return applyBindFillStyle(action, state);
    case "bind-text-style":
      return applyBindTextStyle(action, state);
    case "promote-icon-cluster":
      return applyPromoteIconCluster(loaded, action, state);
    case "promote-vector-cluster":
      return applyPromoteVectorCluster(loaded, action, state);
    case "group-as-variant-set":
      return applyGroupAsVariantSet(action, state);
    case "set-layout":
      return applySetLayout(action, state);
    case "rename":
      return applyRename(action, state);
  }
}

// =============================================================================
// Internal canvas
// =============================================================================

function applyEnsureInternalCanvas(action: ActionEnsureInternalCanvas, state: ApplyState): void {
  if (state.internalCanvasPageId !== undefined) {
    state.skipped.push({ action, reason: "internal canvas already exists" });
    return;
  }
  const before = countInternalPages(state.editor.documentHistory.present);
  state.editor = figEditorReducer(state.editor, {
    type: "ENSURE_INTERNAL_CANVAS",
    name: action.name,
  });
  const after = state.editor.documentHistory.present;
  const internal = after.pages.find((p) => p.internalOnly === true);
  if (!internal) {
    state.skipped.push({ action, reason: "ENSURE_INTERNAL_CANVAS reducer did not create a page" });
    return;
  }
  state.internalCanvasPageId = internal.id;
  state.internalCanvasCreated = countInternalPages(after) > before;
}

function countInternalPages(doc: FigDesignDocument): number {
  return doc.pages.filter((p) => p.internalOnly === true).length;
}

// =============================================================================
// FILL / TEXT proxies
// =============================================================================

function applyCreateFillProxy(action: ActionCreateFillProxy, state: ApplyState): void {
  const pageId = state.internalCanvasPageId;
  if (!pageId) {
    state.skipped.push({
      action,
      reason: "no internal canvas; plan must emit ensure-internal-canvas first",
    });
    return;
  }
  const beforeIds = collectChildIds(state.editor.documentHistory.present, pageId);
  state.editor = figEditorReducer(state.editor, {
    type: "ADD_FILL_PROXY",
    internalPageId: pageId,
    name: action.name,
    color: { r: action.color.r, g: action.color.g, b: action.color.b, a: action.color.a },
  });
  const after = state.editor.documentHistory.present;
  const newId = pickNewChildId(after, pageId, beforeIds);
  if (!newId) {
    state.skipped.push({ action, reason: "ADD_FILL_PROXY did not produce a new node" });
    return;
  }
  state.tokens.set(action.token, newId);
  state.counts.fillProxiesCreated = state.counts.fillProxiesCreated + 1;
}

function applyCreateTextProxy(action: ActionCreateTextProxy, state: ApplyState): void {
  const pageId = state.internalCanvasPageId;
  if (!pageId) {
    state.skipped.push({
      action,
      reason: "no internal canvas; plan must emit ensure-internal-canvas first",
    });
    return;
  }
  const beforeIds = collectChildIds(state.editor.documentHistory.present, pageId);
  state.editor = figEditorReducer(state.editor, {
    type: "ADD_TEXT_PROXY",
    internalPageId: pageId,
    name: action.name,
    fontName: { family: action.fontFamily, style: action.fontStyle, postscript: "" },
    fontSize: action.fontSize,
  });
  const after = state.editor.documentHistory.present;
  const newId = pickNewChildId(after, pageId, beforeIds);
  if (!newId) {
    state.skipped.push({ action, reason: "ADD_TEXT_PROXY did not produce a new node" });
    return;
  }
  state.tokens.set(action.token, newId);
  state.counts.textProxiesCreated = state.counts.textProxiesCreated + 1;
}

function collectChildIds(doc: FigDesignDocument, pageId: FigPageId): Set<FigNodeId> {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) {
    return new Set();
  }
  return new Set(page.children.map((c) => c.id));
}

function pickNewChildId(
  doc: FigDesignDocument,
  pageId: FigPageId,
  before: ReadonlySet<FigNodeId>,
): FigNodeId | undefined {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) {
    return undefined;
  }
  for (const child of page.children) {
    if (!before.has(child.id)) {
      return child.id;
    }
  }
  return undefined;
}

// =============================================================================
// Style bind
// =============================================================================

function applyBindFillStyle(action: ActionBindFillStyle, state: ApplyState): void {
  const styleId = resolveStyleIdForFill(action.proxy, state.tokens);
  if (!styleId) {
    state.skipped.push({ action, reason: "proxy token did not resolve" });
    return;
  }
  const nodeId = toNodeId(action.nodeGuid);
  if (!nodeExists(state.editor.documentHistory.present, nodeId)) {
    state.skipped.push({ action, reason: "node not in document" });
    return;
  }
  state.editor = figEditorReducer(state.editor, {
    type: "BIND_FILL_STYLE",
    nodeId,
    styleId,
  });
  state.counts.fillBound = state.counts.fillBound + 1;
}

function applyBindTextStyle(action: ActionBindTextStyle, state: ApplyState): void {
  const styleId = resolveStyleIdForFill(action.proxy, state.tokens);
  if (!styleId) {
    state.skipped.push({ action, reason: "proxy token did not resolve" });
    return;
  }
  const nodeId = toNodeId(action.nodeGuid);
  if (!nodeExists(state.editor.documentHistory.present, nodeId)) {
    state.skipped.push({ action, reason: "node not in document" });
    return;
  }
  state.editor = figEditorReducer(state.editor, {
    type: "BIND_TEXT_STYLE",
    nodeId,
    styleId,
  });
  state.counts.textBound = state.counts.textBound + 1;
}

function resolveStyleIdForFill(
  ref: ProxyRef,
  tokens: ReadonlyMap<string, FigNodeId>,
): FigStyleId | undefined {
  const proxyId = ref.kind === "existing" ? toNodeId(ref.guid) : tokens.get(ref.token);
  if (!proxyId) {
    return undefined;
  }
  return styleIdFromNodeId(proxyId);
}

function styleIdFromNodeId(id: FigNodeId): FigStyleId {
  const [sessionStr, localStr] = String(id).split(":");
  const sessionID = Number.parseInt(sessionStr ?? "0", 10);
  const localID = Number.parseInt(localStr ?? "0", 10);
  return { guid: { sessionID, localID } };
}

// =============================================================================
// Promote icon / vector cluster
// =============================================================================

function applyPromoteIconCluster(
  loaded: LoadedFigFile,
  action: ActionPromoteIconCluster,
  state: ApplyState,
): void {
  if (!action.memberGuids.includes(action.exemplarGuid)) {
    state.skipped.push({ action, reason: "exemplarGuid must be one of memberGuids" });
    return;
  }
  // Promotable / fingerprint gating uses the original `loaded` raw
  // snapshot because the analysis primitives in promote-icon-cluster
  // are written against the Kiwi tree. The document-level mutation
  // below is what actually flips types — the loaded inspection is
  // read-only.
  if (!isPromotableCluster(loaded, action.exemplarGuid)) {
    state.skipped.push({
      action,
      reason: "exemplar carries a non-promotable descendant (e.g. GRADIENT paint or unsupported node type)",
    });
    return;
  }
  const exemplarFingerprint = subtreeFingerprint(loaded, action.exemplarGuid);
  const eligibleOthers = action.memberGuids
    .filter((g) => g !== action.exemplarGuid)
    .filter((g) => subtreeFingerprint(loaded, g) === exemplarFingerprint);

  const exemplarId = toNodeId(action.exemplarGuid);
  if (!nodeExists(state.editor.documentHistory.present, exemplarId)) {
    state.skipped.push({ action, reason: "exemplar not in document" });
    return;
  }

  // 1. Flip the exemplar into a SYMBOL.
  state.editor = figEditorReducer(state.editor, {
    type: "PROMOTE_TO_SYMBOL",
    nodeId: exemplarId,
    name: action.clusterName,
  });

  // 2. Flip every fingerprint-equal member into an INSTANCE pointing
  //    at the new SYMBOL. `dropChildren: true` matches the previous
  //    implementation's "removed descendants" behaviour — the INSTANCE
  //    inherits its visual from the SYMBOL.
  const instances: FigNodeId[] = [];
  for (const memberGuid of eligibleOthers) {
    const memberId = toNodeId(memberGuid);
    if (!nodeExists(state.editor.documentHistory.present, memberId)) {
      continue;
    }
    state.editor = figEditorReducer(state.editor, {
      type: "PROMOTE_TO_INSTANCE",
      nodeId: memberId,
      symbolId: exemplarId,
      dropChildren: true,
    });
    instances.push(memberId);
  }

  state.promotedSymbolByClusterId.set(action.clusterId, exemplarId);
  state.counts.clustersPromoted = state.counts.clustersPromoted + 1;
  state.counts.instancesRewritten = state.counts.instancesRewritten + instances.length;
}

function applyPromoteVectorCluster(
  _loaded: LoadedFigFile,
  action: ActionPromoteVectorCluster,
  state: ApplyState,
): void {
  if (!state.internalCanvasPageId) {
    state.skipped.push({
      action,
      reason: "no internal canvas; promote-vector-cluster needs the Internal Only Canvas, plan must emit ensure-internal-canvas first",
    });
    return;
  }
  if (!action.memberGuids.includes(action.exemplarGuid)) {
    state.skipped.push({ action, reason: "exemplarGuid must be one of memberGuids" });
    return;
  }
  const exemplarId = toNodeId(action.exemplarGuid);
  const memberIds = action.memberGuids.map((g) => toNodeId(g));
  const docBefore = state.editor.documentHistory.present;
  if (!nodeExists(docBefore, exemplarId)) {
    state.skipped.push({ action, reason: "exemplar not in document" });
    return;
  }
  state.editor = figEditorReducer(state.editor, {
    type: "CREATE_SYMBOL_WITH_INSTANCES",
    hostPageId: state.internalCanvasPageId,
    name: action.clusterName,
    exemplarNodeId: exemplarId,
    memberNodeIds: memberIds,
  });
  // CREATE_SYMBOL_WITH_INSTANCES adds a fresh SYMBOL whose ID was
  // allocated by the reducer. Record the cluster → SYMBOL mapping so
  // a later group-as-variant-set action can pick it up; locate the
  // new SYMBOL by name on the internal canvas (it lands as the last
  // child added).
  const docAfter = state.editor.documentHistory.present;
  const internalPage = docAfter.pages.find((p) => p.id === state.internalCanvasPageId);
  if (internalPage) {
    const newSymbol = [...internalPage.children]
      .reverse()
      .find((c) => c.name === action.clusterName && c.type === "SYMBOL");
    if (newSymbol) {
      state.promotedSymbolByClusterId.set(action.clusterId, newSymbol.id);
    }
  }
  state.counts.vectorClustersPromoted = state.counts.vectorClustersPromoted + 1;
  state.counts.vectorInstancesRewritten = state.counts.vectorInstancesRewritten + memberIds.length;
}

// =============================================================================
// Variant set / layout / rename
// =============================================================================

function applyGroupAsVariantSet(action: ActionGroupAsVariantSet, state: ApplyState): void {
  if (action.variants.length === 0) {
    state.skipped.push({ action, reason: "variant set has zero variants" });
    return;
  }
  const variantsResolved: { readonly symbolId: FigNodeId; readonly value: string }[] = [];
  const missing: string[] = [];
  for (const variant of action.variants) {
    const symbolId = state.promotedSymbolByClusterId.get(variant.clusterId);
    if (!symbolId) {
      missing.push(variant.clusterId);
      continue;
    }
    variantsResolved.push({ symbolId, value: variant.propertyValue });
  }
  if (missing.length > 0) {
    state.skipped.push({
      action,
      reason: `promoted SYMBOL missing for cluster(s): ${missing.join(", ")}`,
    });
    return;
  }
  // The reducer enforces the "same parent page" rule; capture its
  // skip path through the document snapshot. If grouping fails, the
  // document is unchanged and we report a skip.
  const docBefore = state.editor.documentHistory.present;
  state.editor = figEditorReducer(state.editor, {
    type: "GROUP_AS_VARIANT_SET",
    setName: action.setName,
    propertyName: action.propertyName,
    variants: variantsResolved,
  });
  const docAfter = state.editor.documentHistory.present;
  if (docAfter === docBefore) {
    state.skipped.push({
      action,
      reason: "GROUP_AS_VARIANT_SET refused (variant SYMBOLs not on the same page or missing)",
    });
    return;
  }
  state.counts.variantSetsCreated = state.counts.variantSetsCreated + 1;
}

function applySetLayout(action: ActionSetLayout, state: ApplyState): void {
  const nodeId = toNodeId(action.nodeGuid);
  if (!nodeExists(state.editor.documentHistory.present, nodeId)) {
    state.skipped.push({ action, reason: "node not in document" });
    return;
  }
  const stackModeValue = action.layoutMode === "HORIZONTAL" ? 1 : 2;
  const counterAxisValue = counterAxisEnumValue(action.counterAxisAlign);
  state.editor = figEditorReducer(state.editor, {
    type: "UPDATE_NODE",
    nodeId,
    source: "test",
    updater: (node) => ({
      ...node,
      autoLayout: {
        stackMode: { value: stackModeValue, name: action.layoutMode },
        stackSpacing: action.itemSpacing,
        stackPadding: {
          top: action.paddingTop,
          right: action.paddingRight,
          bottom: action.paddingBottom,
          left: action.paddingLeft,
        },
        stackCounterAlignItems: { value: counterAxisValue, name: action.counterAxisAlign },
      },
    }),
  });
  state.counts.layoutsApplied = state.counts.layoutsApplied + 1;
}

function counterAxisEnumValue(align: "MIN" | "CENTER" | "MAX"): number {
  if (align === "MIN") {
    return 0;
  }
  if (align === "CENTER") {
    return 1;
  }
  return 2;
}

function applyRename(action: ActionRename, state: ApplyState): void {
  const trimmed = action.newName.trim();
  if (!trimmed) {
    state.skipped.push({ action, reason: "empty newName" });
    return;
  }
  const nodeId = toNodeId(action.nodeGuid);
  if (!nodeExists(state.editor.documentHistory.present, nodeId)) {
    state.skipped.push({ action, reason: "node not in document" });
    return;
  }
  state.editor = figEditorReducer(state.editor, {
    type: "RENAME_NODE",
    nodeId,
    name: trimmed,
    source: "test",
  });
  state.counts.renamed = state.counts.renamed + 1;
}

// =============================================================================
// Document helpers
// =============================================================================

function nodeExists(doc: FigDesignDocument, id: FigNodeId): boolean {
  for (const page of doc.pages) {
    if (
      dfsById<FigDesignNode>(page.children, id, {
        getId: (n) => n.id,
        getChildren: (n) => n.children ?? [],
      })
    ) {
      return true;
    }
  }
  return false;
}

