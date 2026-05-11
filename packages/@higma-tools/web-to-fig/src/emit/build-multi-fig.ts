/**
 * @file MultiViewportIR → .fig with per-breakpoint top-level frames.
 *
 * Each breakpoint becomes its own wrapper FRAME under the canvas,
 * laid out left-to-right with a fixed gutter so designers can see
 * all sizes side-by-side. The frame name carries the breakpoint
 * label (`mobile / 375×667` etc.) for navigation in Figma's layers
 * panel.
 *
 * Per-node emission semantics live in `node-emitters.ts`. This
 * file is responsible only for the multi-viewport bookkeeping the
 * single-viewport path doesn't need: registering every breakpoint's
 * assets into one shared image map, building the per-breakpoint
 * wrapper FRAME, and threading the captured root through the
 * shared `emitNode` for each viewport's body.
 *
 * SYMBOL / INSTANCE collapse — recognising that the per-breakpoint
 * trees are the same component at different sizes and emitting one
 * SYMBOL with three INSTANCE references — is intentionally not
 * implemented. Real responsive sites (Wikipedia, Yahoo) ship
 * genuinely different element trees per breakpoint, so a shared
 * SYMBOL would corrupt the visual fidelity contract.
 */
import { createFigFile, frameNode, symbolNode } from "@higma-document-io/fig/fig-file";
import type { MultiViewportIR, NodeIR, ViewportIR } from "@higma-bridges/web-fig";
import { createIdCounter, emitNode, type EmitContext } from "./node-emitters";

const BREAKPOINT_GUTTER = 64;

export type MultiFigBuildResult = {
  readonly bytes: Uint8Array;
  /** breakpoint name → IR id → assigned fig localID. */
  readonly idMap: ReadonlyMap<string, ReadonlyMap<string, number>>;
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
 *
 * Each viewport emits its own independent FRAME tree so per-
 * breakpoint DOM differences (mobile-only menu, desktop-only hero,
 * sticky topbars whose existence depends on a media query) survive
 * into the `.fig`.
 */
export async function buildMultiFigFileBytes(multi: MultiViewportIR): Promise<MultiFigBuildResult> {
  if (multi.viewports.length === 0) {
    throw new Error("buildMultiFigFileBytes: MultiViewportIR has no viewports");
  }
  const file = createFigFile();
  const docID = file.addDocument(multi.source);
  const canvasID = file.addCanvas(docID, "Web Capture");

  const idCounter = createIdCounter();
  const idMap = new Map<string, ReadonlyMap<string, number>>();

  // Register every asset captured by the in-page walker as a fig
  // image and remember the SHA-1 ref the writer assigned. Each
  // image fill in the IR carries the original `imageId`; emit-time
  // we look that ID up here to produce a paint with the right
  // `imageRef`. Without this pass `<img>` and inline `<svg>`
  // content emits as empty frames.
  const imageRefs = new Map<string, string>();
  for (const viewport of multi.viewports) {
    for (const [, asset] of viewport.assets) {
      if (imageRefs.has(asset.id)) {
        continue;
      }
      const ref = await file.addImage(asset.bytes, asset.mime);
      imageRefs.set(asset.id, ref);
    }
  }

  // Identify subtrees that appear in *every* viewport with the
  // same `componentKey` — those are the genuinely shared logical
  // components (page headers, footers, navigation rails the page's
  // CSS keeps responsive across breakpoints). Emit one SYMBOL per
  // shared component, then let the per-viewport emit replace each
  // occurrence with an INSTANCE that points back to the SYMBOL.
  const sharedKeys = collectSharedComponentKeys(multi.viewports);
  const totalContentWidth = multi.viewports.reduce<number>(
    (acc, v) => acc + v.box.width,
    0,
  ) + BREAKPOINT_GUTTER * Math.max(multi.viewports.length - 1, 0);
  const symbolColumnX = totalContentWidth + BREAKPOINT_GUTTER * 2;
  const componentKeyToSymbolID = await emitSharedSymbols({
    viewports: multi.viewports,
    sharedKeys,
    file,
    canvasID,
    idCounter,
    imageRefs,
    columnX: symbolColumnX,
  });

  const layoutCursor = { x: 0 };
  for (const viewport of multi.viewports) {
    const wrapperLocalID = idCounter.next();
    const wrapperBuilder = frameNode(wrapperLocalID, canvasID)
      .name(`${viewport.breakpoint} / ${Math.round(viewport.box.width)}×${Math.round(viewport.box.height)}`)
      .size(viewport.box.width, viewport.box.height)
      .position(layoutCursor.x, 0)
      .clipsContent(true);
    // The captured `viewport.background` is the body's
    // `getComputedStyle().backgroundColor`. Sites whose body has no
    // explicit color resolve that to `rgba(0,0,0,0)` — visually
    // identical to white because the surrounding browser chrome
    // paints behind it. Don't emit a fill in that case: a
    // `(r=0,g=0,b=0,α=0)` SOLID paint confuses renderers that
    // ignore the alpha channel and paints a solid black rectangle.
    // White is the correct default the browser would paint for a
    // transparent body.
    const bg = viewport.background;
    const wrapperFinal = bg.a > 0
      ? wrapperBuilder.background(bg)
      : wrapperBuilder.background({ r: 1, g: 1, b: 1, a: 1 });
    file.addFrame(wrapperFinal.build());

    const perViewport = new Map<string, number>();
    const ctx: EmitContext = {
      file,
      idCounter,
      idMap: perViewport,
      imageRefs,
      resolveSymbol: (node) => {
        if (sharedKeys.has(node.componentKey)) {
          return componentKeyToSymbolID.get(node.componentKey);
        }
        return undefined;
      },
    };

    // The captured root's `body` child is the visible page content.
    // Emit it as a single FRAME inside the wrapper. Its IR `box` is
    // body-relative and child boxes are body-content-rect-relative,
    // so the wrapper hosts the body at (0,0) and every descendant
    // FRAME's `position(box.x, box.y)` lays out exactly where the
    // browser put it. We force `stackPositioning=ABSOLUTE` so the
    // wrapper (no auto-layout) doesn't try to flow-stack children
    // at the parent origin.
    const rootBodyNode: NodeIR = viewport.root.children.find((c) => c.visible) ?? viewport.root;
    const bodyForEmit: NodeIR = rootBodyNode.kind === "frame"
      ? { ...rootBodyNode, sizing: { mode: "absolute" as const } }
      : rootBodyNode;
    emitNode(ctx, wrapperLocalID, bodyForEmit);

    for (const layerNode of viewport.viewportLayer) {
      emitNode(ctx, wrapperLocalID, layerNode);
    }
    layoutCursor.x += viewport.box.width + BREAKPOINT_GUTTER;
    idMap.set(viewport.breakpoint, perViewport);
  }
  file.addInternalCanvas(docID);

  const bytes = await file.buildAsync({ fileName: multi.source });
  return { bytes, idMap };
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

/**
 * Emit one SYMBOL per shared componentKey, keyed off the **widest**
 * viewport's instance of the subtree (Figma INSTANCEs resize
 * naturally narrower; authoring at the widest size keeps text
 * wraps minimal so smaller INSTANCEs reflow correctly). Returns a
 * map from `componentKey` to the SYMBOL's localID so the per-
 * viewport emit pass can resolve INSTANCE references.
 */
async function emitSharedSymbols(args: {
  readonly viewports: readonly ViewportIR[];
  readonly sharedKeys: ReadonlySet<string>;
  readonly file: ReturnType<typeof createFigFile>;
  readonly canvasID: number;
  readonly idCounter: ReturnType<typeof createIdCounter>;
  readonly imageRefs: ReadonlyMap<string, string>;
  readonly columnX: number;
}): Promise<Map<string, number>> {
  const { viewports, sharedKeys, file, canvasID, idCounter, imageRefs, columnX } = args;
  const out = new Map<string, number>();
  if (sharedKeys.size === 0) {
    return out;
  }
  // Pick the widest viewport as the authoring source. Same
  // rationale as the disabled-but-correct earlier `pickRepresentative`:
  // INSTANCE shrinks naturally; the widest source carries the
  // fewest forced wraps.
  const representative = viewports.reduce<ViewportIR>(
    (best, current) => (current.box.width > best.box.width ? current : best),
    viewports[0]!,
  );
  // Walk the representative tree and emit a SYMBOL for each
  // shared key the first time we see it. Use a SYMBOL-local
  // EmitContext that does NOT have `resolveSymbol` set — otherwise
  // a SYMBOL containing another SYMBOL'd descendant would emit an
  // INSTANCE inside its own definition, creating a cycle.
  const stackY = { y: 0 };
  function visit(node: NodeIR): void {
    if (sharedKeys.has(node.componentKey) && !out.has(node.componentKey)) {
      const symbolLocalID = idCounter.next();
      const symbolBuilder = symbolNode(symbolLocalID, canvasID)
        .name(node.name || "Component")
        .size(node.box.width, node.box.height)
        .position(columnX, stackY.y);
      file.addSymbol(symbolBuilder.build());
      out.set(node.componentKey, symbolLocalID);
      // Emit the SYMBOL's body using the standard per-kind path.
      const bodyCtx: EmitContext = {
        file,
        idCounter,
        idMap: new Map<string, number>(),
        imageRefs,
        // No resolveSymbol — see comment above.
      };
      // Children of the shared node become the SYMBOL's body. We
      // re-emit the entire node as a frame inside the SYMBOL so
      // its own styling propagates. The SYMBOL builder owns the
      // outer box, so the inner FRAME we recurse on takes the
      // root-relative position (0, 0).
      // Re-anchor the inner copy at (0,0) inside the SYMBOL — the
      // outer SYMBOL's `position` already places the component on
      // the canvas. Sizing stays "fixed" on both axes so the
      // SYMBOL's content doesn't try to hug or fill against a
      // parent it doesn't know.
      const innerNode: NodeIR = node.kind === "frame"
        ? { ...node, box: { ...node.box, x: 0, y: 0 }, sizing: { mode: "flow", primary: "fixed", counter: "fixed" } }
        : node;
      emitNode(bodyCtx, symbolLocalID, innerNode);
      stackY.y += node.box.height + BREAKPOINT_GUTTER;
      // Don't recurse — pruneInnerKeys already trimmed nested
      // shared keys, so any descendants are non-shared.
      return;
    }
    if (node.kind === "frame") {
      for (const c of node.children) {
        visit(c);
      }
    }
  }
  visit(representative.root);
  return out;
}
