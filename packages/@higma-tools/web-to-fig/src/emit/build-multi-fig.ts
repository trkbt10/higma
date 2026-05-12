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
 * The pipeline goes through the canonical `FigDesignDocument`
 * builder (`createEmptyFigDesignDocument` + `addNode` + `exportFig`).
 * Per-node emission lives in `ir-to-spec.ts`; this module is the
 * multi-viewport driver that orchestrates wrapper FRAMEs, asset
 * pooling, and SYMBOL/INSTANCE substitution.
 */
import {
  addNode,
  addPage,
  createEmptyFigDesignDocument,
  exportFig,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type {
  FigDesignDocument,
  FigNodeId,
  FigPageId,
} from "@higma-document-models/fig/domain";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FrameNodeSpec, InstanceNodeSpec, SymbolNodeSpec } from "@higma-document-io/fig/types";
import type { MultiViewportIR, NodeIR, ViewportIR } from "@higma-bridges/web-fig";
import { installAssets } from "./build-document";
import { irToSpecGraph } from "./ir-to-spec";

const BREAKPOINT_GUTTER = 64;

export type MultiFigBuildResult = {
  readonly bytes: Uint8Array;
  /** breakpoint name → IR id → assigned FigNodeId. */
  readonly idMap: ReadonlyMap<string, ReadonlyMap<string, FigNodeId>>;
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

  // ----- doc setup -----
  const initialDoc = createEmptyFigDesignDocument("Web Capture");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 1 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId = initialDoc.pages[0]!.id;

  // Pool every viewport's assets into the document's image map so
  // the produced `.fig` is self-contained no matter which viewport
  // owns the original asset reference.
  const docWithAssets = multi.viewports.reduce<FigDesignDocument>(
    (acc, viewport) => installAssets(acc, viewport.assets),
    initialDoc,
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
  const sharedSymbolMap = new Map<string, FigNodeId>();
  const docAfterSymbols = emitSharedSymbols({
    viewports: multi.viewports,
    sharedKeys,
    doc: docWithAssets,
    state,
    pageId,
    columnX: symbolColumnX,
    output: sharedSymbolMap,
  });

  // Lay each viewport's wrapper FRAME left-to-right and emit its
  // body underneath. The cursor and the per-viewport IR id map
  // thread through `reduce` so we don't need a mutable cursor.
  const idMap = new Map<string, ReadonlyMap<string, FigNodeId>>();
  const docAfterWrappers = multi.viewports.reduce<{
    readonly doc: FigDesignDocument;
    readonly cursorX: number;
  }>(
    (acc, viewport) => emitOneViewportWrapper({
      doc: acc.doc,
      state,
      pageId,
      cursorX: acc.cursorX,
      viewport,
      sharedSymbolMap,
      idMap,
    }),
    { doc: docAfterSymbols, cursorX: 0 },
  );

  // Real Figma exports always carry a second CANVAS marked
  // `internalOnly: true` that hosts style-definition proxy nodes.
  // Even with no proxies to host the page must exist or Figma's
  // importer rejects the file.
  const finalDoc = addPage({
    state,
    doc: docAfterWrappers.doc,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).doc;

  const exported = await exportFig(finalDoc);
  return { bytes: exported.data, idMap };
}

type EmitOneWrapperOptions = {
  readonly doc: FigDesignDocument;
  readonly state: FigBuilderState;
  readonly pageId: FigPageId;
  readonly cursorX: number;
  readonly viewport: ViewportIR;
  readonly sharedSymbolMap: ReadonlyMap<string, FigNodeId>;
  readonly idMap: Map<string, ReadonlyMap<string, FigNodeId>>;
};

/**
 * Fall back to white when the captured viewport background is fully
 * transparent. Browsers paint the body's "no explicit color" as
 * `rgba(0,0,0,0)`, but emitting a SOLID α=0 fill makes naive
 * renderers paint solid black instead of letting the canvas show.
 */
function resolveViewportBackground(
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
 * Build the `layoutConstraints.stackPositioning = ABSOLUTE` patch for
 * INSTANCE nodes whose IR sizing is absolute. Non-absolute modes return
 * `undefined` to leave the field unset on the spec.
 */
function buildAbsoluteLayoutConstraints(
  sizingMode: NodeIR["sizing"]["mode"],
): { stackPositioning: { value: number; name: "ABSOLUTE" } } | undefined {
  if (sizingMode !== "absolute") return undefined;
  return { stackPositioning: { value: 1, name: "ABSOLUTE" } };
}

function emitOneViewportWrapper(opts: EmitOneWrapperOptions): {
  readonly doc: FigDesignDocument;
  readonly cursorX: number;
} {
  const { viewport, sharedSymbolMap, state, pageId, idMap } = opts;
  // The captured `viewport.background` is the body's
  // `getComputedStyle().backgroundColor`. Sites whose body has no
  // explicit color resolve that to `rgba(0,0,0,0)` — visually
  // identical to white because the surrounding browser chrome paints
  // behind it. Don't emit a (0,0,0,0) fill in that case: a SOLID
  // paint with α=0 confuses renderers that ignore alpha and paints a
  // solid black rectangle. White is the correct default the browser
  // would paint for a transparent body.
  const bg = resolveViewportBackground(viewport.background);
  const wrapperSpec: FrameNodeSpec = {
    type: "FRAME",
    name: `${viewport.breakpoint} / ${Math.round(viewport.box.width)}×${Math.round(viewport.box.height)}`,
    x: opts.cursorX,
    y: 0,
    width: viewport.box.width,
    height: viewport.box.height,
    clipsContent: true,
    fills: [{
      type: "SOLID",
      color: bg,
      opacity: 1,
      visible: true,
      blendMode: "NORMAL",
    }],
  };
  const wrapperResult = addNode({ state, doc: opts.doc, pageId, parentId: null, spec: wrapperSpec });
  const wrapperId = wrapperResult.nodeId;

  // The captured root's `body` child is the visible page content.
  // Emit it as a single FRAME inside the wrapper. Its IR `box` is
  // body-relative and child boxes are body-content-rect-relative, so
  // the wrapper hosts the body at (0,0) and every descendant FRAME's
  // box lays out exactly where the browser put it. Force
  // `stackPositioning=ABSOLUTE` on the body so the wrapper (no auto-
  // layout) doesn't try to flow-stack children at the parent origin.
  const rootBodyNode: NodeIR = viewport.root.children.find((c) => c.visible) ?? viewport.root;
  const bodyForEmit: NodeIR = forceAbsoluteSizingOnFrame(rootBodyNode);
  const perViewport = new Map<string, FigNodeId>();
  const docAfterBody = appendIRWithSharedSymbols({
    doc: wrapperResult.doc,
    state,
    pageId,
    parentId: wrapperId,
    irNode: bodyForEmit,
    idMap: perViewport,
    sharedSymbolMap,
  });
  const docAfterLayer = viewport.viewportLayer.reduce<FigDesignDocument>(
    (doc, layerNode) => appendIRWithSharedSymbols({
      doc,
      state,
      pageId,
      parentId: wrapperId,
      irNode: layerNode,
      idMap: perViewport,
      sharedSymbolMap,
    }),
    docAfterBody,
  );
  idMap.set(viewport.breakpoint, perViewport);

  return {
    doc: docAfterLayer,
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
  readonly doc: FigDesignDocument;
  readonly state: FigBuilderState;
  readonly pageId: FigPageId;
  readonly columnX: number;
  readonly output: Map<string, FigNodeId>;
};

/**
 * Emit one SYMBOL per shared componentKey, keyed off the **widest**
 * viewport's instance of the subtree (Figma INSTANCEs resize
 * naturally narrower; authoring at the widest size keeps text wraps
 * minimal so smaller INSTANCEs reflow correctly). Populates the
 * `output` map from `componentKey` to the SYMBOL's `FigNodeId`.
 * Returns the updated document.
 */
function emitSharedSymbols(opts: EmitSharedSymbolsOptions): FigDesignDocument {
  const { viewports, sharedKeys, doc, state, pageId, columnX, output } = opts;
  if (sharedKeys.size === 0) {
    return doc;
  }
  // Pick the widest viewport as the authoring source. INSTANCE
  // shrinks naturally; the widest source carries the fewest forced
  // wraps.
  const representative = viewports.reduce<ViewportIR>(
    (best, current) => (current.box.width > best.box.width ? current : best),
    viewports[0]!,
  );
  return walkAndEmitSymbols({
    doc,
    state,
    pageId,
    columnX,
    sharedKeys,
    output,
    node: representative.root,
    stackY: 0,
  }).doc;
}

type WalkSymbolOptions = {
  readonly doc: FigDesignDocument;
  readonly state: FigBuilderState;
  readonly pageId: FigPageId;
  readonly columnX: number;
  readonly sharedKeys: ReadonlySet<string>;
  readonly output: Map<string, FigNodeId>;
  readonly node: NodeIR;
  readonly stackY: number;
};

function walkAndEmitSymbols(opts: WalkSymbolOptions): {
  readonly doc: FigDesignDocument;
  readonly stackY: number;
} {
  const { node, sharedKeys, output } = opts;
  if (sharedKeys.has(node.componentKey) && !output.has(node.componentKey)) {
    return emitSymbolForNode(opts);
  }
  if (node.kind !== "frame") {
    return { doc: opts.doc, stackY: opts.stackY };
  }
  return node.children.reduce<{ readonly doc: FigDesignDocument; readonly stackY: number }>(
    (acc, child) => walkAndEmitSymbols({
      ...opts,
      doc: acc.doc,
      node: child,
      stackY: acc.stackY,
    }),
    { doc: opts.doc, stackY: opts.stackY },
  );
}

function emitSymbolForNode(opts: WalkSymbolOptions): {
  readonly doc: FigDesignDocument;
  readonly stackY: number;
} {
  const { node, columnX, output, state, pageId } = opts;
  const symbolSpec: SymbolNodeSpec = {
    type: "SYMBOL",
    name: node.name || "Component",
    x: columnX,
    y: opts.stackY,
    width: node.box.width,
    height: node.box.height,
  };
  const symbolResult = addNode({ state, doc: opts.doc, pageId, parentId: null, spec: symbolSpec });
  output.set(node.componentKey, symbolResult.nodeId);
  // Children of the shared node become the SYMBOL's body. Re-anchor
  // the inner copy at (0,0) inside the SYMBOL — the outer SYMBOL's
  // `position` already places the component on the canvas — and pass
  // an empty shared map so a SYMBOL containing another SYMBOL'd
  // descendant doesn't recursively emit an INSTANCE inside its own
  // definition (that would form a cycle).
  const innerNode: NodeIR = reanchorSymbolBody(node);
  const docAfterBody = appendIRWithSharedSymbols({
    doc: symbolResult.doc,
    state,
    pageId,
    parentId: symbolResult.nodeId,
    irNode: innerNode,
    idMap: new Map<string, FigNodeId>(),
    sharedSymbolMap: new Map<string, FigNodeId>(),
  });
  // Don't recurse into children at the outer level — pruneInnerKeys
  // already trimmed nested shared keys, so any descendants are non-
  // shared and we'd just be re-walking through children that the
  // SYMBOL body already covers.
  return {
    doc: docAfterBody,
    stackY: opts.stackY + node.box.height + BREAKPOINT_GUTTER,
  };
}

type AppendIRWithSymbolsOptions = {
  readonly doc: FigDesignDocument;
  readonly state: FigBuilderState;
  readonly pageId: FigPageId;
  readonly parentId: FigNodeId;
  readonly irNode: NodeIR;
  readonly idMap: Map<string, FigNodeId>;
  readonly sharedSymbolMap: ReadonlyMap<string, FigNodeId>;
};

/**
 * Variant of `appendIR` (single-viewport SoT) that consults a
 * SYMBOL map before recursing. When the current IR node's
 * `componentKey` is in the map, emit an INSTANCE pointing at the
 * matching SYMBOL and stop descending — the SYMBOL's body already
 * carries the subtree. Otherwise fall through to the standard
 * IR → spec emission via `appendIR`'s logic (we don't reuse
 * `appendIR` directly because the recursion needs to know about
 * the shared map at every level).
 */
function appendIRWithSharedSymbols(opts: AppendIRWithSymbolsOptions): FigDesignDocument {
  // sharedSymbolMap is keyed by `componentKey` (see emitSharedSymbols).
  // Match the IR node's componentKey against the map; a hit means we
  // emit an INSTANCE of the matching SYMBOL instead of recursing into
  // the subtree (which would re-emit the SYMBOL's body in-place).
  const matchedSymbolId = opts.sharedSymbolMap.get(opts.irNode.componentKey);
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
      layoutConstraints: buildAbsoluteLayoutConstraints(opts.irNode.sizing.mode),
    };
    const result = addNode({
      state: opts.state,
      doc: opts.doc,
      pageId: opts.pageId,
      parentId: opts.parentId,
      spec: instanceSpec,
    });
    opts.idMap.set(opts.irNode.id, result.nodeId);
    return result.doc;
  }

  // No symbol match — fall through to the standard
  // `appendIR`-style emission, with the caveat that we need the
  // shared map to propagate to descendants for nested matches.
  // We can't reuse `appendIR` directly (it has no shared-map
  // parameter), so inline the equivalent walk here.
  const graph = irToSpecGraphLocal(opts.irNode);
  const { doc: afterAdd, nodeId } = addNode({
    state: opts.state,
    doc: opts.doc,
    pageId: opts.pageId,
    parentId: opts.parentId,
    spec: graph,
  });
  opts.idMap.set(opts.irNode.id, nodeId);

  if (opts.irNode.kind !== "frame") {
    return afterAdd;
  }
  return opts.irNode.children.reduce<FigDesignDocument>(
    (doc, child) => appendIRWithSharedSymbols({
      doc,
      state: opts.state,
      pageId: opts.pageId,
      parentId: nodeId,
      irNode: child,
      idMap: opts.idMap,
      sharedSymbolMap: opts.sharedSymbolMap,
    }),
    afterAdd,
  );
}

// Unwrap the `SpecGraph` returned by `irToSpecGraph` to its `spec`
// field. The multi-viewport path drives recursion itself (to consult
// `sharedSymbolMap` at every level), so the graph's `children`
// slot — useful for callers that emit children in lock-step — is
// not needed here.
function irToSpecGraphLocal(node: NodeIR): ReturnType<typeof irToSpecGraph>["spec"] {
  return irToSpecGraph(node).spec;
}
