/**
 * @file MultiViewportIR → .fig with per-breakpoint top-level frames.
 *
 * Each breakpoint becomes its own FRAME under the canvas, laid out
 * left-to-right with a fixed gutter so designers can see all sizes
 * side-by-side. The frame name carries the breakpoint label
 * (`mobile / 375×667` etc.) for navigation in Figma's layers panel.
 *
 * SYMBOL/INSTANCE collapse — i.e. recognising that the three viewport
 * trees are the same component at different sizes and emitting a
 * single SYMBOL referenced by three INSTANCE wrappers — is a
 * follow-on enhancement layered on this foundation. The current
 * structure is the prerequisite: writing every viewport as its own
 * frame first proves the visual fidelity contract end-to-end.
 */
import {
  createFigFile,
  frameNode,
  imagePaint,
  instanceNode,
  roundedRectNode,
  rectNode,
  symbolNode,
  textNode,
  vectorNode,
  type TextStyleRunData,
} from "@higma-document-io/fig/fig-file";
import type {
  StackMode,
  StackAlign,
  StackJustify,
} from "@higma-document-models/fig/constants";
import type {
  AutoLayoutIR,
  FrameNodeIR,
  MultiViewportIR,
  NodeIR,
  PaintIR,
  RectNodeIR,
  TextNodeIR,
  VectorNodeIR,
  ViewportIR,
} from "@higma-bridges/web-fig";
import { inferAutoLayout, resolveCornerRadius } from "@higma-bridges/web-fig";
import { fontQueryToStyleName, normalizeWeight } from "@higma-document-models/fig/font";
import { splitSubpaths } from "./split-subpaths";

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
 *     SYMBOL "Page" (authored at the largest viewport's content size)
 *       <root tree from the representative viewport>
 *     FRAME "mobile / 375×667"        ← background = body bg
 *       INSTANCE → SYMBOL "Page", sized to mobile viewport
 *     FRAME "tablet / 768×1024"
 *       INSTANCE → SYMBOL "Page", sized to tablet viewport
 *     FRAME "desktop / 1280×800"
 *       INSTANCE → SYMBOL "Page", sized to desktop viewport
 *
 * The three INSTANCE references share the same SYMBOL definition —
 * editing any text or color inside the SYMBOL propagates to all
 * three viewports automatically. Resizing an INSTANCE drives the
 * SYMBOL's auto-layout constraints, which is the concrete proof
 * that the captured page is responsive.
 *
 * Representative viewport selection: we pick the **largest** viewport
 * by width because Figma's INSTANCE resizes naturally shrink — when
 * the SYMBOL is authored at the smallest size, the larger INSTANCEs
 * either stretch awkwardly or hit constraint corner cases. The
 * largest viewport's content has all the wrapping decisions baked
 * in, so smaller INSTANCEs can re-flow on contraint resolution.
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
  const imageRefMap = new Map<string, string>();
  for (const viewport of multi.viewports) {
    for (const [, asset] of viewport.assets) {
      if (imageRefMap.has(asset.id)) {
        continue;
      }
      const ref = await file.addImage(asset.bytes, asset.mime);
      imageRefMap.set(asset.id, ref);
    }
  }

  // SYMBOL/INSTANCE collapse intentionally disabled. Earlier
  // iterations authored a single SYMBOL from the widest viewport
  // and instantiated it for the others, but real responsive sites
  // (Wikipedia, Yahoo, Zozo) ship genuinely different element
  // trees per breakpoint — desktop-only puzzle-logo banners,
  // mobile-only icon strips, sticky topbars that exist only above
  // 1024px. A shared SYMBOL bakes the dominant viewport's
  // structure into all the others and the diff diverges. Each
  // viewport now emits its own independent FRAME tree so per-
  // breakpoint DOM differences survive into the .fig.

  // Each viewport wrapper hosts a single INSTANCE pointing at the
  // SYMBOL. The wrapper carries the body's background colour so
  // viewport-canvas paint stays correct; the INSTANCE itself
  // inherits the SYMBOL's transparent root and lets the wrapper
  // colour show through.
  const layoutCursor = { x: 0 };
  for (const viewport of multi.viewports) {
    const wrapperLocalID = idCounter.next();
    // The wrapper FRAME is itself an auto-layout VERTICAL container.
    // Its padding mirrors the captured body's offset inside the
    // viewport (left/right inset = browser-resolved horizontal
    // centring, top/bottom inset = browser-resolved vertical
    // anchoring). The INSTANCE sits inside as the sole child with
    // `counterSizing=FILL` and `primarySizing=HUG`, so resizing the
    // wrapper FRAME re-flows through the INSTANCE → SYMBOL → STRETCH
    // text chain the way Figma's own auto-layout solver does. A plain
    // (non-auto-layout) wrapper would have nothing to FILL into and
    // leave the INSTANCE locked at its emit-time width.
    const contentBox = pickContentRect(viewport);
    const padTop = clampNonNeg(contentBox.y);
    const padBottom = clampNonNeg(viewport.box.height - (contentBox.y + contentBox.height));
    const padLeft = clampNonNeg(contentBox.x);
    const padRight = clampNonNeg(viewport.box.width - (contentBox.x + contentBox.width));
    // The captured background is the body's `getComputedStyle().
    // backgroundColor`. Sites whose body has no explicit color
    // resolve that to `rgba(0,0,0,0)` — visually identical to white
    // because the surrounding browser chrome paints behind it. Don't
    // emit a fill in that case: a `(r=0,g=0,b=0,α=0)` SOLID paint
    // confuses renderers that ignore the alpha channel and paints a
    // solid black rectangle. White is the correct default the
    // browser would paint for a transparent body.
    // The wrapper FRAME is laid out by absolute positioning, not
    // auto-layout. With SYMBOL/INSTANCE collapse removed, there's
    // nothing for the wrapper's auto-layout to drive — each child
    // FRAME knows its own viewport-absolute position. Auto-layout
    // would instead stack children at the padding origin and clobber
    // the captured x/y. Authoring the body wrapper as a single
    // absolutely-positioned FRAME at (contentBox.x, contentBox.y)
    // keeps the captured layout intact while still letting the
    // wrapper carry the body background colour.
    const wrapperBuilder = frameNode(wrapperLocalID, canvasID)
      .name(`${viewport.breakpoint} / ${Math.round(viewport.box.width)}×${Math.round(viewport.box.height)}`)
      .size(viewport.box.width, viewport.box.height)
      .position(layoutCursor.x, 0)
      .clipsContent(true);
    const bg = viewport.background;
    const wrapperFinal = bg.a > 0 ? wrapperBuilder.background(bg) : wrapperBuilder.background({ r: 1, g: 1, b: 1, a: 1 });
    file.addFrame(wrapperFinal.build());
    // The captured root's `body` child is the visible page content.
    // Emit it as a single FRAME inside the wrapper. Its IR `box` is
    // body-relative (always (0,0,bodyW,bodyH)) and child boxes are
    // body-content-rect-relative — for `<body>` whose padding is 0
    // (the default) those equal viewport-absolute coordinates, so
    // the wrapper hosts the body at (0,0) and every descendant
    // FRAME's `position(box.x, box.y)` lays out exactly where the
    // browser put it. We force `stackPositioning=ABSOLUTE` so the
    // wrapper (no auto-layout) doesn't try to flow-stack children
    // at the parent origin.
    const perViewport = new Map<string, number>();
    const rootBodyNode = viewport.root.children.find((c) => c.visible) ?? viewport.root;
    const bodyForEmit = rootBodyNode.kind === "frame"
      ? { ...rootBodyNode, sizing: { mode: "absolute" as const } }
      : rootBodyNode;
    emitNode({
      file,
      parentID: wrapperLocalID,
      node: bodyForEmit,
      idCounter,
      idMap: perViewport,
      parentCounterAlign: undefined,
      imageRefs: imageRefMap,
    });
    // padTop/padBottom/padLeft/padRight unused now — kept the
    // captured content rect for future positioning sanity checks.
    void padTop; void padBottom; void padLeft; void padRight;
    void contentBox;
    for (const layerNode of viewport.viewportLayer) {
      emitNode({
        file,
        parentID: wrapperLocalID,
        node: layerNode,
        idCounter,
        idMap: perViewport,
        parentCounterAlign: undefined,
        imageRefs: imageRefMap,
      });
    }
    layoutCursor.x += viewport.box.width + BREAKPOINT_GUTTER;
    idMap.set(viewport.breakpoint, perViewport);
  }
  file.addInternalCanvas(docID);

  const bytes = await file.buildAsync({ fileName: multi.source });
  return { bytes, idMap };
}

/**
 * Recompute the SYMBOL's auto-layout against the *viewport* box
 * rather than the root element's content rect. The captured root
 * (`<html>`) often shrinks to its content height — example.com
 * gives an html rect of 1280×336 inside an 800-tall viewport — so
 * inferring auto-layout from `root.box` produces vertically-symmetric
 * insets and a misleading `primary=center`. Recomputing against
 * `viewport.box` keeps the page anchored at the captured top.
 */
function inferAutoLayoutForViewport(viewport: ViewportIR): AutoLayoutIR {
  const visibleChildren = viewport.root.children.filter((c) => c.visible);
  if (visibleChildren.length === 0) {
    return viewport.root.autoLayout;
  }
  const inferred = inferAutoLayout({
    parent: { x: 0, y: 0, width: viewport.box.width, height: viewport.box.height },
    children: visibleChildren.map((c) => c.box),
  });
  if (inferred.direction === "none") {
    return viewport.root.autoLayout;
  }
  return {
    direction: inferred.direction,
    gap: inferred.gap,
    paddingTop: inferred.paddingTop,
    paddingRight: inferred.paddingRight,
    paddingBottom: inferred.paddingBottom,
    paddingLeft: inferred.paddingLeft,
    primaryAlign: inferred.primaryAlign,
    counterAlign: inferred.counterAlign,
    wrap: inferred.wrap,
  };
}

/**
 * The captured body rect for a viewport — the dimensions Chromium
 * actually used for word-wrap. INSTANCE is sized to this so the
 * renderer's wrap pass sees the same width the browser did.
 *
 * Falls back to the viewport box when no body-level child exists
 * (e.g. minimal documents whose root carries text directly).
 */
function pickContentRect(viewport: ViewportIR): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const firstVisible = viewport.root.children.find((c) => c.visible);
  if (!firstVisible) {
    return { x: 0, y: 0, width: viewport.box.width, height: viewport.box.height };
  }
  // The IR carries `box` in parent-relative coordinates; for the
  // root frame's direct children that maps to viewport-relative
  // already.
  return {
    x: firstVisible.box.x,
    y: firstVisible.box.y,
    width: firstVisible.box.width,
    height: firstVisible.box.height,
  };
}

/**
 * Pick the **widest** viewport's content box as the SYMBOL's
 * authoring extent. Figma's INSTANCE resize does not re-flow text
 * wraps automatically — when an INSTANCE is narrower than the SYMBOL
 * the children keep their authored line breaks and overflow clips
 * the rest. Authoring at the widest viewport keeps the SYMBOL's text
 * wraps minimal (single-line where the page allows) and matches what
 * Figma actually displays for every INSTANCE: the SYMBOL's content
 * laid out at the SYMBOL's content rect, the INSTANCE box just
 * defining the visible window onto it. Smaller INSTANCEs clip on
 * both axes, which is the legitimate Figma rendering for this
 * structure; round-tripping through the renderer reflects the same
 * limitation rather than fabricating a reflow Figma itself does not
 * perform.
 */
function pickRepresentative(viewports: readonly MultiViewportIR["viewports"][number][]): MultiViewportIR["viewports"][number] {
  return viewports.reduce<MultiViewportIR["viewports"][number]>((best, current) => {
    if (current.box.width > best.box.width) {
      return current;
    }
    return best;
  }, viewports[0]!);
}

type CollapsedHost = {
  /** Node whose style (opacity / clipsContent / fills) the SYMBOL adopts. */
  readonly styleNode: NodeIR;
  /** Node whose auto-layout / children the SYMBOL adopts. */
  readonly layoutNode: NodeIR;
};

/**
 * Collapse a single-auto-layout-child wrapper into one host. Many
 * captured pages have a `<body>` whose only visible child is a
 * `<div>` carrying the actual auto-layout, with the wrapper itself a
 * pure positioning shell (no padding, no background, child fills the
 * full content rect). Treat the pair as one node so the SYMBOL's
 * auto-layout is the inner container's, eliminating the fixed-size
 * inner FRAME that would otherwise clip overflow when the INSTANCE
 * reflows on a smaller viewport.
 *
 * The collapse only fires for the exact pattern: the wrapper has
 * exactly one visible child, both are FRAME, the wrapper has no
 * padding / gap, the inner container starts at (0,0) and matches the
 * wrapper's size. Anything else is preserved verbatim — multi-child
 * `<body>`s, padded wrappers, and bodies with their own auto-layout
 * declarations all keep their original structure.
 */
function collapseAutoLayoutWrapper(host: NodeIR): CollapsedHost {
  if (host.kind !== "frame") {
    return { styleNode: host, layoutNode: host };
  }
  const visibleChildren = host.children.filter((c) => c.visible);
  if (visibleChildren.length !== 1) {
    return { styleNode: host, layoutNode: host };
  }
  const inner = visibleChildren[0]!;
  if (inner.kind !== "frame") {
    return { styleNode: host, layoutNode: host };
  }
  if (inner.autoLayout.direction === "none") {
    return { styleNode: host, layoutNode: host };
  }
  const wrapperAL = host.autoLayout;
  const wrapperHasOwnLayout =
    wrapperAL.direction !== "none"
    && (wrapperAL.gap > 0
      || wrapperAL.paddingTop > 0
      || wrapperAL.paddingRight > 0
      || wrapperAL.paddingBottom > 0
      || wrapperAL.paddingLeft > 0);
  if (wrapperHasOwnLayout) {
    return { styleNode: host, layoutNode: host };
  }
  const fillsHost = host.box;
  const innerBox = inner.box;
  const matchesHost =
    Math.abs(innerBox.x) <= 0.5
    && Math.abs(innerBox.y) <= 0.5
    && Math.abs(innerBox.width - fillsHost.width) <= 0.5
    && Math.abs(innerBox.height - fillsHost.height) <= 0.5;
  if (!matchesHost) {
    return { styleNode: host, layoutNode: host };
  }
  return { styleNode: inner, layoutNode: inner };
}

function applySymbolAutoLayout(
  builder: ReturnType<typeof symbolNode>,
  layout: AutoLayoutIR,
): ReturnType<typeof symbolNode> {
  if (layout.direction === "none") {
    return builder;
  }
  const mode: StackMode = layout.direction === "row" ? "HORIZONTAL" : "VERTICAL";
  const stacked = builder
    .autoLayout(mode)
    .gap(layout.gap)
    .padding({
      top: layout.paddingTop,
      right: layout.paddingRight,
      bottom: layout.paddingBottom,
      left: layout.paddingLeft,
    })
    .primaryAlign(primaryAlignToFig(layout.primaryAlign))
    .counterAlign(counterAlignToFig(layout.counterAlign));
  return layout.wrap === true ? stacked.wrap(true) : stacked;
}

function clampNonNeg(n: number): number {
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return n;
}

function symbolColumnX(viewports: readonly MultiViewportIR["viewports"][number][]): number {
  // Place the SYMBOL definition to the right of the breakpoint
  // strip so it doesn't overlap any wrapper frame.
  const totalWidth = viewports.reduce<number>(
    (acc, v) => acc + v.box.width,
    0,
  );
  const gutterWidth = BREAKPOINT_GUTTER * (viewports.length - 1);
  return totalWidth + gutterWidth + BREAKPOINT_GUTTER * 2;
}

type IdCounter = { next: () => number };

function createIdCounter(start = 10): IdCounter {
  const ref = { value: start };
  return { next: () => ref.value++ };
}

/**
 * Counter-axis alignment value carried from a parent auto-layout
 * container down to its children. Excludes the `none` discriminant of
 * `AutoLayoutIR` because callers only set this when the parent
 * actually had a stack direction; otherwise they pass `undefined`.
 */
type ParentCounterAlign = "start" | "center" | "end" | "stretch";

type EmitArgs = {
  readonly file: ReturnType<typeof createFigFile>;
  readonly parentID: number;
  readonly node: NodeIR;
  readonly idCounter: IdCounter;
  readonly idMap: Map<string, number>;
  /**
   * Parent's `AutoLayoutIR.counterAlign` if the parent was an
   * auto-layout container. Used to translate IR-level
   * `counterAlign=stretch` into `stackChildAlignSelf=STRETCH` on each
   * child — the only Figma-schema-valid encoding for "fill the
   * counter axis of the parent".
   */
  readonly parentCounterAlign?: ParentCounterAlign;
  /** IR `imageId` → fig SHA-1 image ref. */
  readonly imageRefs: ReadonlyMap<string, string>;
};

function emitNode(args: EmitArgs): number {
  switch (args.node.kind) {
    case "frame":
      return emitFrame(args.file, args.parentID, args.node, args.idCounter, args.idMap, args.parentCounterAlign, args.imageRefs);
    case "text":
      return emitText(args.file, args.parentID, args.node, args.idCounter, args.idMap, args.parentCounterAlign);
    case "rectangle":
      return emitRectangle(args.file, args.parentID, args.node, args.idCounter, args.idMap, args.imageRefs);
    case "vector":
      return emitVector(args.file, args.parentID, args.node, args.idCounter, args.idMap);
  }
}

function emitVector(
  file: ReturnType<typeof createFigFile>,
  parentID: number,
  node: VectorNodeIR,
  idCounter: IdCounter,
  idMap: Map<string, number>,
): number {
  // Degenerate VECTORs (one or both axes collapsed to 0) are
  // undefined territory in Figma — observed first-hand to render as
  // an oversized black rectangle in some renderers and as nothing at
  // all in others. Skip them at emit time: a path geometry without a
  // bounding box can't be cropped consistently, and the "no node"
  // outcome matches what the captured page actually shows on screen
  // (the parent collapsed it for a reason).
  if (node.box.width <= 0 || node.box.height <= 0) {
    return -1;
  }
  const localID = idCounter.next();
  // The vector pulls its visible style from the first path's fill —
  // Figma's VECTOR carries one fill stack per node, with per-path
  // overrides living elsewhere (`vectorData.styleOverrideTable`).
  // Picking the leading path's fill is the right approximation
  // until that override table is wired through.
  const firstFill = node.paths.find((p) => p.fill?.kind === "solid")?.fill;
  const fillColor = firstFill && firstFill.kind === "solid" ? firstFill.color : undefined;
  let builder = vectorNode(localID, parentID)
    .name(node.name || "Vector")
    .size(node.box.width, node.box.height)
    .position(node.box.x, node.box.y);
  // Split each `d` on every `M`/`m` boundary so multi-subpath paths
  // (icons authored as `M ... Z M ... Z`, compound silhouettes,
  // open-then-closed clusters) land in Figma as a list of independent
  // `vectorPath` entries. Without the split Figma's renderer keeps
  // the pen position across the implicit subpath boundary inside one
  // `vectorPath`, which connects parts that should render
  // independently — the symptom users observed as "things that
  // shouldn't be linked are linked".
  for (const path of node.paths) {
    for (const subpath of splitSubpaths(path.d)) {
      builder = builder.path(subpath);
    }
  }
  // Winding rule comes from the first path that declares one.
  const winding = node.paths.find((p) => p.fillRule !== undefined)?.fillRule;
  if (winding === "evenodd") {
    builder = builder.windingRule("EVENODD");
  }
  if (fillColor) {
    builder = builder.fill({
      type: { value: 0, name: "SOLID" },
      color: fillColor,
      opacity: 1,
      visible: true,
      blendMode: { value: 1, name: "NORMAL" },
    });
  }
  if (node.sizing.mode === "absolute") {
    builder = builder.positioning("ABSOLUTE");
  }
  file.addVector(builder.build());
  idMap.set(node.id, localID);
  return localID;
}

function emitFrame(
  file: ReturnType<typeof createFigFile>,
  parentID: number,
  node: FrameNodeIR,
  idCounter: IdCounter,
  idMap: Map<string, number>,
  parentCounterAlign: ParentCounterAlign | undefined,
  imageRefs: ReadonlyMap<string, string>,
): number {
  const localID = idCounter.next();
  const baseBuilder = frameNode(localID, parentID)
    .name(node.name || "Frame")
    .size(node.box.width, node.box.height)
    .position(node.box.x, node.box.y)
    .clipsContent(node.style.clipsContent)
    .opacity(node.style.opacity);
  const withFill = applyFrameBackground(baseBuilder, node.style.fills, imageRefs);
  const withLayout = applyAutoLayoutToFrame(withFill, node.autoLayout);
  // Apply child-side counter-axis stretch when the parent's IR
  // counterAlign is "stretch" — the schema's
  // `stackCounterAlignItems` only allows MIN/CENTER/MAX/BASELINE, so
  // STRETCH must travel as `stackChildAlignSelf=STRETCH` instead.
  const withChildAlign = parentCounterAlign === "stretch"
    ? withLayout.childAlignSelf("STRETCH")
    : withLayout;
  // Out-of-flow children (position:fixed / sticky / absolute) opt
  // out of the parent's auto-layout via `stackPositioning=ABSOLUTE`.
  // Without this they would be laid out in flow with negative offsets
  // (a fixed header at viewport y=0 inside a body div at y=200 ends
  // up at flow-y=-200 and gets clipped or rearranged).
  const finalBuilder = node.sizing.mode === "absolute"
    ? withChildAlign.positioning("ABSOLUTE")
    : withChildAlign;
  file.addFrame(finalBuilder.build());
  idMap.set(node.id, localID);

  // When this frame has no auto-layout (`direction: "none"`), every
  // child paints at its captured (x, y) absolute position — no flow
  // stacking. Force each child's `stackPositioning=ABSOLUTE` before
  // recursion so the renderer respects the captured offsets instead
  // of laying flow children out top-to-left at the parent origin.
  // The recursive emit also normalises any descendants of those
  // children that themselves have flow sizing — but only when the
  // immediate parent has no auto-layout, so child auto-layout
  // (Wikipedia's `<ul>`, etc.) keeps its flow semantics.
  const childrenForEmit = node.autoLayout.direction === "none"
    ? node.children.map((c) => c.sizing.mode === "absolute" ? c : { ...c, sizing: { mode: "absolute" as const } })
    : node.children;
  for (const child of childrenForEmit) {
    emitNode({
      file,
      parentID: localID,
      node: child,
      idCounter,
      idMap,
      parentCounterAlign: node.autoLayout.direction !== "none"
        ? node.autoLayout.counterAlign
        : undefined,
      imageRefs,
    });
  }
  return localID;
}

function applyFrameBackground(
  builder: ReturnType<typeof frameNode>,
  fills: ViewportIR["root"]["style"]["fills"],
  imageRefs: ReadonlyMap<string, string>,
): ReturnType<typeof frameNode> {
  // Image fills win over solid backgrounds: `<img>` and inline
  // `<svg>` carry the visible content, while any `background-color`
  // typically renders behind them. We emit a single image paint —
  // the fig builder's `fill()` API replaces the whole stack — and
  // delegate the optional bg colour to the renderer's fallback when
  // the image can't decode.
  for (const fill of fills) {
    if (fill.kind === "image") {
      const ref = imageRefs.get(fill.imageId);
      if (ref !== undefined) {
        const figScale = scaleModeToFigName(fill.scaleMode);
        const paint = imagePaint(ref)
          .scaleMode(figScale)
          // CSS `background-size: auto` paints the image at its
          // intrinsic dimensions; that maps to a TILE paint with
          // scalingFactor=1. Other scale modes don't consume the
          // factor — the builder safely omits it.
          .scale(1)
          .opacity(fill.opacity ?? 1)
          .visible(fill.visible ?? true)
          .build();
        return builder.fill(paint);
      }
    }
  }
  const firstSolid = solidColorOf(fills);
  if (firstSolid) {
    return builder.background(firstSolid);
  }
  // No fill collected — the captured container had no
  // `background-color` (or it was transparent). Drop the builder's
  // default opaque white so an ancestor's color shows through, the
  // way the browser renders see-through wrappers.
  return builder.noFill();
}

function scaleModeToFigName(mode: "cover" | "contain" | "tile" | "stretch"): "FILL" | "FIT" | "TILE" | "STRETCH" {
  switch (mode) {
    case "cover": return "FILL";
    case "contain": return "FIT";
    case "tile": return "TILE";
    case "stretch": return "STRETCH";
  }
}

function applyAutoLayoutToFrame(
  builder: ReturnType<typeof frameNode>,
  layout: AutoLayoutIR,
): ReturnType<typeof frameNode> {
  if (layout.direction === "none") {
    return builder;
  }
  const mode: StackMode = layout.direction === "row" ? "HORIZONTAL" : "VERTICAL";
  const stacked = builder
    .autoLayout(mode)
    .gap(layout.gap)
    .padding({
      top: layout.paddingTop,
      right: layout.paddingRight,
      bottom: layout.paddingBottom,
      left: layout.paddingLeft,
    })
    .primaryAlign(primaryAlignToFig(layout.primaryAlign))
    .counterAlign(counterAlignToFig(layout.counterAlign));
  return layout.wrap === true ? stacked.wrap(true) : stacked;
}

function emitText(
  file: ReturnType<typeof createFigFile>,
  parentID: number,
  node: TextNodeIR,
  idCounter: IdCounter,
  idMap: Map<string, number>,
  parentCounterAlign: ParentCounterAlign | undefined,
): number {
  const localID = idCounter.next();
  // autoResize=HEIGHT + childAlignSelf=STRETCH is the canonical Figma
  // pattern observed in a hand-authored sample: the parent SYMBOL is
  // auto-layout VERTICAL, every text child fills the counter axis
  // (STRETCH) and grows on the primary axis (HEIGHT) when its width
  // changes. Resizing the INSTANCE counter dimension propagates
  // through the chain and Figma re-flows the text. Any other
  // combination (WIDTH_AND_HEIGHT, no STRETCH) breaks the responsive
  // contract.
  const resizeMode = "HEIGHT";
  // Honour the captured CSS line-height. textNode's builder defaults
  // to `fontSize × 100%` (i.e. lineHeight = fontSize), which collapses
  // wrapped paragraphs to ascender-only line stride and makes
  // multi-line text overlap the next sibling. For numeric line-height
  // we honour the IR value verbatim; for `line-height: normal` we
  // use the captured single-line `box.height` because that already
  // reflects the browser's font-native stride for this exact font.
  const lineHeightPx = resolveEmittedLineHeight(node);
  const baseBuilder = textNode(localID, parentID)
    .name(node.name || "Text")
    .text(node.characters)
    .font(node.textStyle.fontFamily, fontStyleName(node.textStyle))
    .fontSize(node.textStyle.fontSize)
    .lineHeight(lineHeightPx, "PIXELS")
    .size(node.box.width, node.box.height)
    .position(node.box.x, node.box.y)
    .autoResize(resizeMode);
  // TEXT inside an auto-layout SYMBOL/FRAME always carries
  // `stackChildAlignSelf=STRETCH` so its counter axis follows the
  // parent's resolved width. Combined with `autoResize=HEIGHT` this
  // is what lets Figma re-flow paragraphs when the INSTANCE width
  // changes — observed verbatim in a hand-authored sample fig. The
  // parent-level `counterAlign` is what the IR happens to record,
  // but the schema-correct way to express counter-stretch is per
  // child, not on the parent's `stackCounterAlignItems` enum (which
  // cannot encode STRETCH).
  const stretched = parentCounterAlign !== undefined
    ? baseBuilder.childAlignSelf("STRETCH")
    : baseBuilder;
  const decorated = applyTextDecoration(stretched, node.textStyle);
  // CSS `text-align` carries horizontal alignment intent from the
  // captured page (e.g. `text-align: center` on a centred heading).
  // Pass it through to Figma's `textAlignHorizontal` so labels arrive
  // with the authored alignment instead of every TEXT collapsing to
  // LEFT.
  const horizontally = applyTextAlignHorizontal(decorated, node.textStyle);
  const vertically = applyTextAlignVertical(horizontally, node.textStyle);
  const firstSolid = solidColorOf(node.style.fills);
  const withColor = firstSolid ? vertically.color(firstSolid) : vertically;
  const withRuns = applyRuns(withColor, node);
  const positioned = node.sizing.mode === "absolute" ? withRuns.positioning("ABSOLUTE") : withRuns;
  file.addTextNode(positioned.build());
  idMap.set(node.id, localID);
  return localID;
}

function applyTextAlignHorizontal(
  builder: ReturnType<typeof textNode>,
  style: TextNodeIR["textStyle"],
): ReturnType<typeof textNode> {
  switch (style.textAlign) {
    case "center":
      return builder.alignHorizontal("CENTER");
    case "right":
      return builder.alignHorizontal("RIGHT");
    case "justify":
      return builder.alignHorizontal("JUSTIFIED");
    case "left":
      return builder;
  }
}

function applyTextAlignVertical(
  builder: ReturnType<typeof textNode>,
  style: TextNodeIR["textStyle"],
): ReturnType<typeof textNode> {
  switch (style.textAlignVertical) {
    case "center":
      return builder.alignVertical("CENTER");
    case "bottom":
      return builder.alignVertical("BOTTOM");
    case "top":
      return builder;
  }
}

function applyTextDecoration(
  builder: ReturnType<typeof textNode>,
  style: TextNodeIR["textStyle"],
): ReturnType<typeof textNode> {
  switch (style.textDecoration) {
    case "underline":
      return builder.decoration("UNDERLINE");
    case "line-through":
      return builder.decoration("STRIKETHROUGH");
    case "none":
      return builder;
  }
}

function applyRuns(
  builder: ReturnType<typeof textNode>,
  node: TextNodeIR,
): ReturnType<typeof textNode> {
  const runs = node.runs;
  if (!runs || runs.length === 0) {
    return builder;
  }
  const baseColor = solidColorOf(node.style.fills) ?? { r: 0, g: 0, b: 0, a: 1 };
  const data: TextStyleRunData[] = runs.map((run) => ({
    start: run.start,
    end: run.end,
    fillColor: run.color ?? baseColor,
    fontName: runFontName(run, node.textStyle),
  }));
  return builder.styleRuns(data);
}

function runFontName(run: TextNodeIR["runs"] extends readonly (infer R)[] | undefined ? R : never, base: TextNodeIR["textStyle"]): { readonly family: string; readonly style: string; readonly postscript: string } | undefined {
  // Only emit a fontName override when the run actually changes
  // family / weight / style — otherwise the fig builder would treat
  // the override as authoritative and drop the node-level base.
  if (run.fontFamily === undefined && run.fontWeight === undefined && run.fontStyle === undefined) {
    return undefined;
  }
  const family = run.fontFamily ?? base.fontFamily;
  const weight = run.fontWeight ?? base.fontWeight;
  const style = run.fontStyle ?? base.fontStyle;
  const styleLabel = fontStyleName({ ...base, fontFamily: family, fontWeight: weight, fontStyle: style });
  return {
    family,
    style: styleLabel,
    postscript: `${family.replace(/\s+/g, "")}-${styleLabel.replace(/\s+/g, "")}`,
  };
}

/**
 * Pixel line-height to emit on a TEXT node.
 *
 * For `unit: "px"` and `unit: "ratio"` the value is exact. For
 * `unit: "normal"` we trust the captured box height — the browser
 * already resolved its font-native line metrics into a single-line
 * rect height, and feeding that back here keeps wrapping decisions
 * (and overall stride) tied to the font Chromium actually used.
 */
function resolveEmittedLineHeight(node: TextNodeIR): number {
  const lh = node.textStyle.lineHeight;
  if (lh.unit === "px") {
    return lh.value;
  }
  if (lh.unit === "ratio") {
    return node.textStyle.fontSize * lh.value;
  }
  // `normal`: prefer the captured single-line stride over a generic
  // 1.2 multiplier. Single-line text always satisfies
  // `box.height > fontSize` because the browser includes ascent and
  // descent in the line box.
  if (node.box.height > 0) {
    return node.box.height;
  }
  return node.textStyle.fontSize * 1.2;
}

function lineMetricFor(style: TextNodeIR["textStyle"]): number {
  switch (style.lineHeight.unit) {
    case "px":
      return style.lineHeight.value;
    case "ratio":
      return style.fontSize * style.lineHeight.value;
    case "normal":
      // Treat the CSS `normal` keyword as the font's typical 1.2×
      // multiplier — close enough for the single-line heuristic, and
      // never observed to misclassify on captured page text.
      return style.fontSize * 1.2;
  }
}

function emitRectangle(
  file: ReturnType<typeof createFigFile>,
  parentID: number,
  node: RectNodeIR,
  idCounter: IdCounter,
  idMap: Map<string, number>,
  imageRefs: ReadonlyMap<string, string>,
): number {
  void imageRefs;
  const localID = idCounter.next();
  const firstSolid = solidColorOf(node.style.fills);
  if (node.style.cornerRadius) {
    const [tl] = node.style.cornerRadius;
    const baseBuilder = roundedRectNode(localID, parentID)
      .name(node.name || "Rectangle")
      .size(node.box.width, node.box.height)
      .position(node.box.x, node.box.y)
      .cornerRadius(resolveCornerRadius(tl, node.box));
    const filled = firstSolid ? baseBuilder.fill(firstSolid) : baseBuilder;
    const finalBuilder = node.sizing.mode === "absolute" ? filled.positioning("ABSOLUTE") : filled;
    file.addRoundedRectangle(finalBuilder.build());
  } else {
    const baseBuilder = rectNode(localID, parentID)
      .name(node.name || "Rectangle")
      .size(node.box.width, node.box.height)
      .position(node.box.x, node.box.y);
    const filled = firstSolid ? baseBuilder.fill(firstSolid) : baseBuilder;
    const finalBuilder = node.sizing.mode === "absolute" ? filled.positioning("ABSOLUTE") : filled;
    file.addRectangle(finalBuilder.build());
  }
  idMap.set(node.id, localID);
  return localID;
}

function solidColorOf(fills: readonly PaintIR[]): { readonly r: number; readonly g: number; readonly b: number; readonly a: number } | undefined {
  for (const fill of fills) {
    if (fill.kind === "solid" && fill.visible !== false) {
      return fill.color;
    }
  }
  return undefined;
}

function primaryAlignToFig(align: "start" | "center" | "end" | "space-between"): StackJustify {
  switch (align) {
    case "center":
      return "CENTER";
    case "end":
      return "MAX";
    case "space-between":
      return "SPACE_BETWEEN";
    case "start":
      return "MIN";
  }
}

/**
 * `stackCounterAlignItems` is encoded as the `StackAlign` Kiwi enum
 * (no STRETCH variant). The IR's `counterAlign === "stretch"` case
 * must NOT round-trip through here — the parent stays MIN and each
 * child carries `stackChildAlignSelf=STRETCH` instead. See {@link
 * counterAlignToChildSelf} for the child-side translation.
 */
function counterAlignToFig(align: "start" | "center" | "end" | "stretch"): StackAlign {
  switch (align) {
    case "center":
      return "CENTER";
    case "end":
      return "MAX";
    case "stretch":
      return "MIN";
    case "start":
      return "MIN";
  }
}

/**
 * Build a Figma `fontName.style` label from an IR text style.
 *
 * Routes through the canonical `fontQueryToStyleName` + `normalizeWeight`
 * SoT so the label format here always matches what `figmaFontToQuery`
 * will parse back to the same numeric weight on the round-trip side.
 * Re-implementing the weight→label mapping locally would silently
 * drift from `detectWeight` and corrupt every weight bucket.
 */
function fontStyleName(style: TextNodeIR["textStyle"]): string {
  return fontQueryToStyleName({
    family: style.fontFamily,
    weight: normalizeWeight(style.fontWeight),
    style: style.fontStyle,
  });
}
