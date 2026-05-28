/**
 * @file MultiViewportIR → .fig with per-breakpoint top-level frames.
 *
 * Each breakpoint becomes its own wrapper FRAME under the canvas,
 * laid out left-to-right with a fixed gutter so designers can see
 * all sizes side-by-side. The frame name carries the breakpoint
 * label (`mobile / 375×667` etc.) for navigation in Figma's layers
 * panel.
 *
 * SYMBOL / INSTANCE collapse — recognising that the per-breakpoint
 * trees represent the same logical component at different sizes —
 * runs as a pre-pass: subtrees whose `componentKey` appears in every
 * viewport are emitted once as a shared SYMBOL on the canvas and
 * each per-viewport occurrence becomes an INSTANCE referencing it.
 *
 * The pipeline appends Kiwi nodeChanges directly; no projected document
 * model is created between IR and export.
 */
import {
  addNode,
  addPage,
  createEmptyFigDocument,
  exportFig,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { BLEND_MODE_VALUES, PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigDocumentContext } from "@higma-document-io/fig";
import type { FigGuid } from "@higma-document-models/fig/types";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FrameNodeSpec, InstanceNodeSpec, SymbolNodeSpec } from "@higma-document-io/fig/types";
import type { MultiViewportIR, NodeIR, ViewportIR } from "@higma-bridges/web-fig";
import { installAssets } from "./build-document";
import { irToSpecGraph } from "./ir-to-spec";

const BREAKPOINT_GUTTER = 64;

export type MultiFigBuildResult = {
  readonly bytes: Uint8Array;
  /** breakpoint name → IR id → assigned FigGuid. */
  readonly idMap: ReadonlyMap<string, ReadonlyMap<string, FigGuid>>;
};

/**
 * Build a `.fig` from a multi-viewport capture.
 *
 * Layout (Figma side):
 *
 *   CANVAS "Web Capture"
 *     FRAME "mobile / 375×667"      ← wrapper, background = body bg
 *       <root tree from the mobile viewport>
 *     FRAME "tablet / 768×1024"
 *       <root tree from the tablet viewport>
 *     FRAME "desktop / 1280×800"
 *       <root tree from the desktop viewport>
 *     SYMBOL "Page Header"          ← shared component column on right
 *     SYMBOL "Site Footer"
 *
 * Each viewport emits its own independent FRAME tree so per-
 * breakpoint DOM differences (mobile-only menu, desktop-only hero,
 * sticky topbars whose existence depends on a media query) survive
 * into the `.fig`. Subtrees whose `componentKey` appears in every
 * viewport collapse into one SYMBOL with INSTANCE references in
 * each wrapper.
 */
export async function buildMultiFigFileBytes(multi: MultiViewportIR): Promise<MultiFigBuildResult> {
  if (multi.viewports.length === 0) {
    throw new Error("buildMultiFigFileBytes: MultiViewportIR has no viewports");
  }

  // ----- Kiwi document setup -----
  const initialContext = createEmptyFigDocument("Web Capture");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 1 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const page = initialContext.document.nodeChanges.find((node) => node.type.name === "CANVAS");
  if (page === undefined) {
    throw new Error("buildMultiFigFileBytes: createEmptyFigDocument did not create a CANVAS");
  }
  const pageGuid = page.guid;

  // Pool every viewport's assets into the document's image map so
  // the produced `.fig` is self-contained no matter which viewport
  // owns the original asset reference.
  const contextWithAssets = multi.viewports.reduce<FigDocumentContext>(
    (acc, viewport) => installAssets(acc, viewport.assets),
    initialContext,
  );

  // Emit shared SYMBOLs in a right-side column. Each shared key
  // becomes one SYMBOL plus its body subtree; the per-viewport pass
  // replaces matching occurrences with an INSTANCE.
  const sharedKeys = collectSharedComponentKeys(multi.viewports);
  const totalContentWidth = multi.viewports.reduce<number>(
    (acc, v) => acc + v.box.width,
    0,
  ) + BREAKPOINT_GUTTER * Math.max(multi.viewports.length - 1, 0);
  const symbolColumnX = totalContentWidth + BREAKPOINT_GUTTER * 2;
  const sharedSymbolGuidsByComponentKey = new Map<string, FigGuid>();
  const contextAfterSymbols = emitSharedSymbols({
    viewports: multi.viewports,
    sharedKeys,
    context: contextWithAssets,
    state,
    pageGuid,
    columnX: symbolColumnX,
    output: sharedSymbolGuidsByComponentKey,
  });

  // Lay each viewport's wrapper FRAME left-to-right and emit its
  // body underneath. The cursor and the per-viewport IR id map
  // thread through `reduce` so we don't need a mutable cursor.
  const idMap = new Map<string, ReadonlyMap<string, FigGuid>>();
  const contextAfterWrappers = multi.viewports.reduce<{
    readonly context: FigDocumentContext;
    readonly cursorX: number;
  }>(
    (acc, viewport) => emitOneViewportWrapper({
      context: acc.context,
      state,
      pageGuid,
      cursorX: acc.cursorX,
      viewport,
      sharedSymbolGuidsByComponentKey,
      idMap,
    }),
    { context: contextAfterSymbols, cursorX: 0 },
  );

  // Real Figma exports always carry a second CANVAS marked
  // `internalOnly: true` that hosts style-definition proxy nodes.
  // Even with no proxies to host the page must exist or Figma's
  // importer rejects the file.
  const finalContext = addPage({
    state,
    context: contextAfterWrappers.context,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).context;

  const exported = await exportFig(finalContext);
  return { bytes: exported.data, idMap };
}

type EmitOneWrapperOptions = {
  readonly context: FigDocumentContext;
  readonly state: FigBuilderState;
  readonly pageGuid: FigGuid;
  readonly cursorX: number;
  readonly viewport: ViewportIR;
  readonly sharedSymbolGuidsByComponentKey: ReadonlyMap<string, FigGuid>;
  readonly idMap: Map<string, ReadonlyMap<string, FigGuid>>;
};

/**
 * Resolve the visible browser canvas color when the captured body
 * background is fully transparent. The browser canvas behind a normal
 * document is white; the emitted wrapper FRAME needs that visible color
 * because `.fig` has no browser canvas layer behind it.
 */
function resolveBrowserViewportBackground(
  background: { r: number; g: number; b: number; a: number },
): { r: number; g: number; b: number; a: number } {
  if (background.a > 0) return background;
  return { r: 1, g: 1, b: 1, a: 1 };
}

/**
 * Force `sizing.mode = "absolute"` on a FRAME-kind IR node so the
 * wrapper (which has no auto-layout) doesn't try to flow-stack the body
 * at the parent origin. Non-FRAME kinds pass through unchanged.
 */
function forceAbsoluteSizingOnFrame(node: NodeIR): NodeIR {
  if (node.kind !== "frame") return node;
  return { ...node, sizing: { mode: "absolute" as const } };
}

/**
 * Re-anchor a FRAME-kind IR node at (0,0) and switch its sizing to
 * fixed-flow when emitting it as a SYMBOL body. Non-FRAME kinds pass
 * through unchanged.
 */
function reanchorSymbolBody(node: NodeIR): NodeIR {
  if (node.kind !== "frame") return node;
  return {
    ...node,
    box: { ...node.box, x: 0, y: 0 },
    sizing: { mode: "flow", primary: "fixed", counter: "fixed" },
  };
}

/**
 * Build the `stackPositioning = ABSOLUTE` patch for INSTANCE nodes
 * whose IR sizing is absolute. Non-absolute modes return `undefined`
 * to leave the field unset on the spec.
 */
function buildAbsoluteStackPositioning(
  sizingMode: NodeIR["sizing"]["mode"],
): { stackPositioning: { value: number; name: "ABSOLUTE" } } | undefined {
  if (sizingMode !== "absolute") return undefined;
  return { stackPositioning: { value: 1, name: "ABSOLUTE" } };
}

function emitOneViewportWrapper(opts: EmitOneWrapperOptions): {
  readonly context: FigDocumentContext;
  readonly cursorX: number;
} {
  const { viewport, sharedSymbolGuidsByComponentKey, state, pageGuid, idMap } = opts;
  // The captured `viewport.background` is the body's
  // `getComputedStyle().backgroundColor`. Sites whose body has no
  // explicit color resolve that to `rgba(0,0,0,0)` — visually
  // identical to white because the surrounding browser chrome paints
  // behind it. Don't emit a (0,0,0,0) fill in that case: a SOLID
  // paint with α=0 confuses renderers that ignore alpha and paints a
  // solid black rectangle. White is the correct default the browser
  // would paint for a transparent body.
  const bg = resolveBrowserViewportBackground(viewport.background);
  const wrapperSpec: FrameNodeSpec = {
    type: "FRAME",
    name: `${viewport.breakpoint} / ${Math.round(viewport.box.width)}×${Math.round(viewport.box.height)}`,
    x: opts.cursorX,
    y: 0,
    width: viewport.box.width,
    height: viewport.box.height,
    visible: true,
    opacity: 1,
    clipsContent: true,
    fills: [{
      type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
      color: bg,
      opacity: 1,
      visible: true,
      blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
    }],
  };
  const wrapperResult = addNode({ state, context: opts.context, pageGuid, parentGuid: null, spec: wrapperSpec });
  const wrapperGuid = wrapperResult.nodeGuid;

  // The captured root's `body` child is the visible page content.
  // Emit it as a single FRAME inside the wrapper. Its IR `box` is
  // body-relative and child boxes are body-content-rect-relative, so
  // the wrapper hosts the body at (0,0) and every descendant FRAME's
  // box lays out exactly where the browser put it. Force
  // `stackPositioning=ABSOLUTE` on the body so the wrapper (no auto-
  // layout) doesn't try to flow-stack children at the parent origin.
  const rootBodyNode: NodeIR = viewport.root.children.find((c) => c.visible) ?? viewport.root;
  const bodyForEmit: NodeIR = forceAbsoluteSizingOnFrame(rootBodyNode);
  const perViewport = new Map<string, FigGuid>();
  const contextAfterBody = appendIRWithSharedSymbols({
    context: wrapperResult.context,
    state,
    pageGuid,
    parentGuid: wrapperGuid,
    irNode: bodyForEmit,
    idMap: perViewport,
    sharedSymbolGuidsByComponentKey,
  });
  const contextAfterLayer = viewport.viewportLayer.reduce<FigDocumentContext>(
    (context, layerNode) => appendIRWithSharedSymbols({
      context,
      state,
      pageGuid,
      parentGuid: wrapperGuid,
      irNode: layerNode,
      idMap: perViewport,
      sharedSymbolGuidsByComponentKey,
    }),
    contextAfterBody,
  );
  idMap.set(viewport.breakpoint, perViewport);

  return {
    context: contextAfterLayer,
    cursorX: opts.cursorX + viewport.box.width + BREAKPOINT_GUTTER,
  };
}

// ---------------------- SYMBOL identification ----------------------

/**
 * Walk every viewport's tree and return the set of `componentKey`
 * values that appear in **every** viewport. Those are the shared
 * logical components — emit them once as a SYMBOL and replace each
 * occurrence with an INSTANCE.
 *
 * Why all-of-N rather than any-of-N: a SYMBOL whose definition
 * exists in only some viewports would be unreferenced from the
 * others, and visiting an INSTANCE on a breakpoint where the
 * SYMBOL doesn't apply would lose that breakpoint's specific
 * structure. Restricting SYMBOLs to keys that appear everywhere
 * matches the cross-viewport identity contract on
 * `NodeBaseIR.componentKey`.
 */
function collectSharedComponentKeys(viewports: readonly ViewportIR[]): Set<string> {
  if (viewports.length < 2) {
    // A single-viewport `MultiViewportIR` has nothing to share —
    // SYMBOL/INSTANCE has no payoff, every node would just be its
    // own SYMBOL referenced by exactly one INSTANCE.
    return new Set();
  }
  const perViewportKeys = viewports.map((v) => keysReachableFrom(v.root));
  const candidates = perViewportKeys[0]!;
  const shared = new Set<string>();
  for (const key of candidates) {
    if (key === "") {
      continue;
    }
    const inAll = perViewportKeys.every((set) => set.has(key));
    if (inAll) {
      shared.add(key);
    }
  }
  // Trim away keys whose ancestor is also shared. Emitting a
  // nested SYMBOL inside another SYMBOL is legal (Figma supports
  // nested components), but the outer INSTANCE *already* contains
  // the inner one through its SYMBOL's body, so emitting an
  // additional INSTANCE for the inner key would double the node.
  // We keep only "outermost" matches — the nearest shared
  // ancestor wins.
  for (const viewport of viewports) {
    pruneInnerKeys(viewport.root, shared, false);
  }
  return shared;
}

function keysReachableFrom(root: NodeIR): Set<string> {
  const out = new Set<string>();
  function walk(node: NodeIR): void {
    out.add(node.componentKey);
    if (node.kind === "frame") {
      for (const c of node.children) {
        walk(c);
      }
    }
  }
  walk(root);
  return out;
}

/**
 * Walk one viewport's tree and remove any componentKey from
 * `shared` that has an ancestor also in `shared` — only outermost
 * wins. Mutates `shared` in place; pass the same set across all
 * viewports.
 */
function pruneInnerKeys(node: NodeIR, shared: Set<string>, ancestorIsShared: boolean): void {
  const selfShared = shared.has(node.componentKey);
  if (selfShared && ancestorIsShared) {
    shared.delete(node.componentKey);
  }
  if (node.kind === "frame") {
    const passedDown = ancestorIsShared || selfShared;
    for (const child of node.children) {
      pruneInnerKeys(child, shared, passedDown);
    }
  }
}

type EmitSharedSymbolsOptions = {
  readonly viewports: readonly ViewportIR[];
  readonly sharedKeys: ReadonlySet<string>;
  readonly context: FigDocumentContext;
  readonly state: FigBuilderState;
  readonly pageGuid: FigGuid;
  readonly columnX: number;
  readonly output: Map<string, FigGuid>;
};

/**
 * Emit one SYMBOL per shared componentKey, keyed off the **widest**
 * viewport's instance of the subtree (Figma INSTANCEs resize
 * naturally narrower; authoring at the widest size keeps text wraps
 * minimal so smaller INSTANCEs reflow correctly). Populates the
 * `output` map from `componentKey` to the SYMBOL's FigGuid.
 * Returns the updated context.
 */
function emitSharedSymbols(opts: EmitSharedSymbolsOptions): FigDocumentContext {
  const { viewports, sharedKeys, context, state, pageGuid, columnX, output } = opts;
  if (sharedKeys.size === 0) {
    return context;
  }
  // Pick the widest viewport as the authoring source. INSTANCE
  // shrinks naturally; the widest source carries the fewest forced
  // wraps.
  const representative = viewports.reduce<ViewportIR>(
    (best, current) => (current.box.width > best.box.width ? current : best),
    viewports[0]!,
  );
  return walkAndEmitSymbols({
    context,
    state,
    pageGuid,
    columnX,
    sharedKeys,
    output,
    node: representative.root,
    stackY: 0,
  }).context;
}

type WalkSymbolOptions = {
  readonly context: FigDocumentContext;
  readonly state: FigBuilderState;
  readonly pageGuid: FigGuid;
  readonly columnX: number;
  readonly sharedKeys: ReadonlySet<string>;
  readonly output: Map<string, FigGuid>;
  readonly node: NodeIR;
  readonly stackY: number;
};

function walkAndEmitSymbols(opts: WalkSymbolOptions): {
  readonly context: FigDocumentContext;
  readonly stackY: number;
} {
  const { node, sharedKeys, output } = opts;
  if (sharedKeys.has(node.componentKey) && !output.has(node.componentKey)) {
    return emitSymbolForNode(opts);
  }
  if (node.kind !== "frame") {
    return { context: opts.context, stackY: opts.stackY };
  }
  return node.children.reduce<{ readonly context: FigDocumentContext; readonly stackY: number }>(
    (acc, child) => walkAndEmitSymbols({
      ...opts,
      context: acc.context,
      node: child,
      stackY: acc.stackY,
    }),
    { context: opts.context, stackY: opts.stackY },
  );
}

function emitSymbolForNode(opts: WalkSymbolOptions): {
  readonly context: FigDocumentContext;
  readonly stackY: number;
} {
  const { node, columnX, output, state, pageGuid } = opts;
  const symbolSpec: SymbolNodeSpec = {
    type: "SYMBOL",
    name: node.name || "Component",
    x: columnX,
    y: opts.stackY,
    width: node.box.width,
    height: node.box.height,
    visible: true,
    opacity: 1,
  };
  const symbolResult = addNode({ state, context: opts.context, pageGuid, parentGuid: null, spec: symbolSpec });
  output.set(node.componentKey, symbolResult.nodeGuid);
  // Children of the shared node become the SYMBOL's body. Re-anchor
  // the inner copy at (0,0) inside the SYMBOL — the outer SYMBOL's
  // `position` already places the component on the canvas — and pass
  // an empty component-key index so a SYMBOL containing another SYMBOL'd
  // descendant doesn't recursively emit an INSTANCE inside its own
  // definition (that would form a cycle).
  const innerNode: NodeIR = reanchorSymbolBody(node);
  const contextAfterBody = appendIRWithSharedSymbols({
    context: symbolResult.context,
    state,
    pageGuid,
    parentGuid: symbolResult.nodeGuid,
    irNode: innerNode,
    idMap: new Map<string, FigGuid>(),
    sharedSymbolGuidsByComponentKey: new Map<string, FigGuid>(),
  });
  // Don't recurse into children at the outer level — pruneInnerKeys
  // already trimmed nested shared keys, so any descendants are non-
  // shared and we'd just be re-walking through children that the
  // SYMBOL body already covers.
  return {
    context: contextAfterBody,
    stackY: opts.stackY + node.box.height + BREAKPOINT_GUTTER,
  };
}

type AppendIRWithSymbolsOptions = {
  readonly context: FigDocumentContext;
  readonly state: FigBuilderState;
  readonly pageGuid: FigGuid;
  readonly parentGuid: FigGuid;
  readonly irNode: NodeIR;
  readonly idMap: Map<string, FigGuid>;
  readonly sharedSymbolGuidsByComponentKey: ReadonlyMap<string, FigGuid>;
};

/**
 * Variant of `appendIR` (single-viewport SoT) that consults the
 * shared component-key index before recursing. When the current IR
 * node's `componentKey` is in the index, emit an INSTANCE pointing at the
 * matching SYMBOL and stop descending — the SYMBOL's body already
 * carries the subtree. Otherwise continue with the standard
 * IR → spec emission via `appendIR`'s logic (we don't reuse
 * `appendIR` directly because the recursion needs to know about
 * the shared component-key index at every level).
 */
function appendIRWithSharedSymbols(opts: AppendIRWithSymbolsOptions): FigDocumentContext {
  // sharedSymbolGuidsByComponentKey is keyed by `componentKey` (see emitSharedSymbols).
  // Match the IR node's componentKey against the index; a hit means we
  // emit an INSTANCE of the matching SYMBOL instead of recursing into
  // the subtree (which would re-emit the SYMBOL's body in-place).
  const matchedSymbolId = opts.sharedSymbolGuidsByComponentKey.get(opts.irNode.componentKey);
  if (matchedSymbolId !== undefined) {
    const instanceSpec: InstanceNodeSpec = {
      type: "INSTANCE",
      symbolId: matchedSymbolId,
      name: opts.irNode.name || "Instance",
      x: opts.irNode.box.x,
      y: opts.irNode.box.y,
      width: opts.irNode.box.width,
      height: opts.irNode.box.height,
      visible: opts.irNode.visible,
      opacity: 1,
      ...buildAbsoluteStackPositioning(opts.irNode.sizing.mode),
    };
    const result = addNode({
      state: opts.state,
      context: opts.context,
      pageGuid: opts.pageGuid,
      parentGuid: opts.parentGuid,
      spec: instanceSpec,
    });
    opts.idMap.set(opts.irNode.id, result.nodeGuid);
    return result.context;
  }

  // No symbol match — continue with the standard `appendIR`-style
  // emission, with the caveat that we need the shared component-key
  // index to propagate to descendants for nested matches.
  // We can't reuse `appendIR` directly (it has no shared-index
  // parameter), so inline the equivalent walk here.
  const graph = irToSpecGraphLocal(opts.irNode);
  const { context: afterAdd, nodeGuid } = addNode({
    state: opts.state,
    context: opts.context,
    pageGuid: opts.pageGuid,
    parentGuid: opts.parentGuid,
    spec: graph,
  });
  opts.idMap.set(opts.irNode.id, nodeGuid);

  if (opts.irNode.kind !== "frame") {
    return afterAdd;
  }
  return opts.irNode.children.reduce<FigDocumentContext>(
    (context, child) => appendIRWithSharedSymbols({
      context,
      state: opts.state,
      pageGuid: opts.pageGuid,
      parentGuid: nodeGuid,
      irNode: child,
      idMap: opts.idMap,
      sharedSymbolGuidsByComponentKey: opts.sharedSymbolGuidsByComponentKey,
    }),
    afterAdd,
  );
}

// Unwrap the `SpecGraph` returned by `irToSpecGraph` to its `spec`
// field. The multi-viewport path drives recursion itself (to consult
// `sharedSymbolGuidsByComponentKey` at every level), so the graph's `children`
// slot — useful for callers that emit children in lock-step — is
// not needed here.
function irToSpecGraphLocal(node: NodeIR): ReturnType<typeof irToSpecGraph>["spec"] {
  return irToSpecGraph(node).spec;
}
