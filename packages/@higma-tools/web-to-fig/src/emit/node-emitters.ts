/**
 * @file Single Source of Truth for `NodeIR` → `.fig` emission.
 *
 * Both `buildFigFileBytes` (single-viewport) and
 * `buildMultiFigFileBytes` (multi-breakpoint) walk the same IR tree
 * and call into the same fig-file builder API. Earlier those two
 * entry points each owned their own `emitFrame` / `emitText` /
 * `emitRectangle` / `emitVector`, and the implementations slowly
 * diverged: lineHeight emitted in one but not the other; image
 * fills wired through one path but silently dropped on rectangles
 * in the other; corner radius applied to frames in one path only;
 * decoration / ABSOLUTE positioning / degenerate-vector skipping
 * present in one but missing in the other. Two callers each
 * paying the cost of authoring their own emitter is a Single-
 * Source-of-Truth violation — the `.fig` semantics must not change
 * with the entry point.
 *
 * This module is the canonical implementation. Both build files
 * should reduce to thin wrappers that:
 *
 *   1. Create the fig file + canvas + asset map (the per-entry
 *      bookkeeping that genuinely differs between single-viewport
 *      and multi-breakpoint).
 *   2. Call `emitNode` with their root frame and the shared
 *      `EmitContext`.
 *
 * Anything that can change the produced bytes for a given
 * `NodeIR` lives here, not on the caller side.
 */
import {
  createFigFile,
  frameNode,
  imagePaint,
  instanceNode,
  rectNode,
  roundedRectNode,
  textNode,
  vectorNode,
  type EffectData,
  type TextStyleRunData,
} from "@higma-document-io/fig/fig-file";
import type {
  StackAlign,
  StackJustify,
  StackMode,
} from "@higma-document-models/fig/constants";
import type {
  AutoLayoutIR,
  FrameNodeIR,
  NodeIR,
  PaintIR,
  RectNodeIR,
  TextNodeIR,
  VectorNodeIR,
} from "@higma-bridges/web-fig";
import { resolveCornerRadius } from "@higma-bridges/web-fig";
import { fontQueryToStyleName, normalizeWeight } from "@higma-document-models/fig/font";
import { splitSubpathsRespectingFillRule } from "./split-subpaths";

/**
 * Counter-axis alignment value carried from a parent auto-layout
 * container down to its children. Excludes the `none` discriminant
 * of `AutoLayoutIR` because callers only set this when the parent
 * actually had a stack direction; otherwise they pass `undefined`.
 */
export type ParentCounterAlign = "start" | "center" | "end" | "stretch";

/** Auto-incrementing fig localID generator. */
export type IdCounter = { readonly next: () => number };

/** Construct an id counter starting at `start` (defaults to 10). */
export function createIdCounter(start = 10): IdCounter {
  const ref = { value: start };
  return { next: () => ref.value++ };
}

/**
 * Per-emit context: the open fig file we're appending to, the
 * counter handing out fresh localIDs, the IR-id → localID map the
 * caller wants to read back, and the asset map binding IR
 * `imageId` to the SHA-1 ref the writer assigned when the bytes
 * were embedded. This bag is stable for the duration of one emit
 * pass and gets passed to every recursive call.
 */
export type EmitContext = {
  readonly file: ReturnType<typeof createFigFile>;
  readonly idCounter: IdCounter;
  readonly idMap: Map<string, number>;
  /** IR `imageId` → fig `imageRef` (SHA-1) for every embedded asset. */
  readonly imageRefs: ReadonlyMap<string, string>;
  /**
   * Optional SYMBOL resolution hook. When set, every node visited
   * by `emitNode` is offered to this function before falling
   * through to the per-kind emit branch. Returning a fig localID
   * causes an INSTANCE referencing that SYMBOL to be emitted in
   * place of the per-kind output; returning `undefined` (the
   * default behaviour when the hook is omitted) keeps the standard
   * frame / text / rect / vector emission.
   *
   * The multi-viewport path uses this to share one SYMBOL
   * definition across breakpoints when the same logical component
   * (matched by `componentKey`) appears in every captured viewport.
   * Single-viewport callers leave it undefined.
   */
  readonly resolveSymbol?: (node: NodeIR) => number | undefined;
};

/**
 * Per-call options that are NOT part of the parent context — they
 * change with each child visit.
 */
export type EmitOptions = {
  /**
   * Parent's `AutoLayoutIR.counterAlign` if the parent was an auto-
   * layout container. Used to translate IR-level
   * `counterAlign=stretch` into `stackChildAlignSelf=STRETCH` on
   * each child — the only Figma-schema-valid encoding for "fill
   * the counter axis of the parent".
   */
  readonly parentCounterAlign?: ParentCounterAlign;
};

/**
 * Top-level dispatch on `NodeIR.kind`. Returns the assigned fig
 * localID, or `-1` if the node was deliberately skipped (e.g. a
 * degenerate vector with a 0-axis box).
 */
export function emitNode(
  ctx: EmitContext,
  parentID: number,
  node: NodeIR,
  opts: EmitOptions = {},
): number {
  // SYMBOL resolution comes first: if the multi-viewport pre-pass
  // identified this node as a shared component (same `componentKey`
  // across every viewport), emit an INSTANCE pointing at the
  // already-built SYMBOL instead of duplicating its subtree. The
  // INSTANCE inherits the SYMBOL's structure verbatim and we don't
  // recurse into its children — that would re-emit the contents
  // and defeat the purpose.
  const symbolID = ctx.resolveSymbol?.(node);
  if (symbolID !== undefined) {
    return emitInstance(ctx, parentID, node, symbolID, opts);
  }
  switch (node.kind) {
    case "frame":
      return emitFrame(ctx, parentID, node, opts);
    case "text":
      return emitText(ctx, parentID, node, opts);
    case "rectangle":
      return emitRectangle(ctx, parentID, node);
    case "vector":
      return emitVector(ctx, parentID, node);
  }
}

/**
 * Emit an INSTANCE node referencing an already-built SYMBOL. The
 * INSTANCE carries its own `box` (so resizing it on the canvas
 * exercises the SYMBOL's auto-layout) and an optional `name`
 * override; everything else propagates through the SYMBOL.
 */
function emitInstance(
  ctx: EmitContext,
  parentID: number,
  node: NodeIR,
  symbolID: number,
  opts: EmitOptions,
): number {
  const localID = ctx.idCounter.next();
  const baseBuilder = instanceNode(localID, parentID, symbolID)
    .name(node.name || "Instance")
    .size(node.box.width, node.box.height)
    .position(node.box.x, node.box.y)
    .visible(node.visible);
  const stretched = opts.parentCounterAlign === "stretch"
    ? baseBuilder.childAlignSelf("STRETCH")
    : baseBuilder;
  const positioned = node.sizing.mode === "absolute"
    ? stretched.positioning("ABSOLUTE")
    : stretched;
  ctx.file.addInstance(positioned.build());
  ctx.idMap.set(node.id, localID);
  return localID;
}

// ------------------------------ FRAME ------------------------------

export function emitFrame(
  ctx: EmitContext,
  parentID: number,
  node: FrameNodeIR,
  opts: EmitOptions,
): number {
  const localID = ctx.idCounter.next();
  const baseBuilder = frameNode(localID, parentID)
    .name(node.name || "Frame")
    .size(node.box.width, node.box.height)
    .position(node.box.x, node.box.y)
    .clipsContent(node.style.clipsContent)
    .opacity(node.style.opacity);
  const withFill = applyFrameBackground(baseBuilder, node.style.fills, ctx.imageRefs);
  const withStroke = applyFrameStroke(withFill, node.style.strokes);
  const withEffects = applyFrameEffects(withStroke, node.style.effects);
  const withLayout = applyAutoLayoutToFrame(withEffects, node.autoLayout);
  const withCorners = applyFrameCornerRadius(withLayout, node);
  // Apply child-side counter-axis stretch when the parent's IR
  // counterAlign is "stretch" — the schema's
  // `stackCounterAlignItems` only allows MIN/CENTER/MAX/BASELINE,
  // so STRETCH must travel as `stackChildAlignSelf=STRETCH` instead.
  const withChildAlign = opts.parentCounterAlign === "stretch"
    ? withCorners.childAlignSelf("STRETCH")
    : withCorners;
  // Out-of-flow children (position:fixed / sticky / absolute) opt
  // out of the parent's auto-layout via `stackPositioning=ABSOLUTE`.
  // Without this they would be laid out in flow with negative
  // offsets (a fixed header at viewport y=0 inside a body div at
  // y=200 would land at flow-y=-200 and be clipped).
  const finalBuilder = node.sizing.mode === "absolute"
    ? withChildAlign.positioning("ABSOLUTE")
    : withChildAlign;
  ctx.file.addFrame(finalBuilder.build());
  ctx.idMap.set(node.id, localID);

  // When this frame has no auto-layout (`direction: "none"`), every
  // child paints at its captured (x, y) absolute position — no flow
  // stacking. Force each child's `stackPositioning=ABSOLUTE` before
  // recursion so the renderer respects the captured offsets instead
  // of laying flow children out top-to-left at the parent origin.
  const childrenForEmit = node.autoLayout.direction === "none"
    ? node.children.map((c) => c.sizing.mode === "absolute" ? c : { ...c, sizing: { mode: "absolute" as const } })
    : node.children;
  const childCounterAlign = node.autoLayout.direction !== "none"
    ? node.autoLayout.counterAlign
    : undefined;
  for (const child of childrenForEmit) {
    emitNode(ctx, localID, child, { parentCounterAlign: childCounterAlign });
  }
  return localID;
}

/** Apply the IR's fill stack to a frame builder. Image > solid > none. */
function applyFrameBackground(
  builder: ReturnType<typeof frameNode>,
  fills: readonly PaintIR[],
  imageRefs: ReadonlyMap<string, string>,
): ReturnType<typeof frameNode> {
  // Image fills win over solid backgrounds: `<img>` and inline
  // `<svg>` carry the visible content, while any `background-color`
  // typically renders behind them. We emit a single image paint —
  // the fig builder's `fill()` API replaces the whole stack — and
  // delegate the optional bg colour to the renderer's fallback when
  // the image can't decode.
  const imageFill = pickImageFillBuilt(fills, imageRefs);
  if (imageFill !== undefined) {
    return builder.fill(imageFill);
  }
  const firstSolid = solidColorOf(fills);
  if (firstSolid) {
    return builder.background(firstSolid);
  }
  return builder.noFill();
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

/**
 * Apply the IR's stroke (CSS `border`) stack to a frame builder.
 *
 * The IR's `style.strokes` is a uniform-perimeter list (any
 * asymmetric border was already converted to per-edge child
 * FRAMEs by the normaliser's `synthesiseBorderEdgeFrames`). Each
 * entry carries `color` and `weight`; we feed the *first solid*
 * entry's colour and the maximum weight across the stack so the
 * Figma stroke matches the rendered CSS perimeter.
 */
function applyFrameStroke(
  builder: ReturnType<typeof frameNode>,
  strokes: FrameNodeIR["style"]["strokes"],
): ReturnType<typeof frameNode> {
  if (strokes.length === 0) {
    return builder;
  }
  const color = pickFirstSolidStrokeColor(strokes);
  if (color === undefined) {
    return builder;
  }
  const weight = strokes.reduce<number>((max, s) => (s.weight > max ? s.weight : max), 0);
  if (weight <= 0) {
    return builder;
  }
  return builder.stroke(color).strokeWeight(weight);
}

/**
 * Apply the IR's effects stack (CSS `box-shadow`, `filter: blur()`,
 * `backdrop-filter: blur()`) to a frame builder. The IR carries
 * one entry per CSS-source effect; we map each to the matching
 * Figma EffectData kind, preserving CSS ordering (top-of-stack
 * paints first in CSS / first in Figma).
 */
function applyFrameEffects(
  builder: ReturnType<typeof frameNode>,
  effects: FrameNodeIR["style"]["effects"],
): ReturnType<typeof frameNode> {
  if (effects.length === 0) {
    return builder;
  }
  const data = effects.map(irEffectToFig).filter((e): e is EffectData => e !== undefined);
  if (data.length === 0) {
    return builder;
  }
  return builder.effects(data);
}

/**
 * Translate one IR effect into the fig-file's `EffectData` shape.
 * The Figma Kiwi enum values for the four effect kinds are pinned
 * by the schema profile (`EFFECT_TYPE_VALUES`); we hand the matching
 * literal back so the encoder writes the byte-correct enum index.
 */
function irEffectToFig(eff: FrameNodeIR["style"]["effects"][number]): EffectData | undefined {
  if (eff.kind === "drop-shadow") {
    return {
      type: { value: 1, name: "DROP_SHADOW" },
      visible: eff.visible !== false,
      color: eff.color,
      offset: { x: eff.offsetX, y: eff.offsetY },
      radius: eff.blurRadius,
      spread: eff.spread,
      blendMode: { value: 1, name: "NORMAL" },
      showShadowBehindNode: false,
    };
  }
  if (eff.kind === "inner-shadow") {
    return {
      type: { value: 0, name: "INNER_SHADOW" },
      visible: eff.visible !== false,
      color: eff.color,
      offset: { x: eff.offsetX, y: eff.offsetY },
      radius: eff.blurRadius,
      spread: eff.spread,
      blendMode: { value: 1, name: "NORMAL" },
    };
  }
  if (eff.kind === "layer-blur") {
    return {
      type: { value: 2, name: "FOREGROUND_BLUR" },
      visible: eff.visible !== false,
      radius: eff.radius,
    };
  }
  if (eff.kind === "background-blur") {
    return {
      type: { value: 3, name: "BACKGROUND_BLUR" },
      visible: eff.visible !== false,
      radius: eff.radius,
    };
  }
  return undefined;
}

/**
 * Pull the first solid-colour from the stroke stack. CSS `border`
 * is monochrome by spec, so the leading solid is authoritative.
 * Image-paint strokes (legitimate Figma feature, but never produced
 * by the web-to-fig normaliser) are ignored.
 */
function pickFirstSolidStrokeColor(
  strokes: FrameNodeIR["style"]["strokes"],
): { readonly r: number; readonly g: number; readonly b: number; readonly a: number } | undefined {
  for (const s of strokes) {
    if (s.paint.kind === "solid") {
      return s.paint.color;
    }
  }
  return undefined;
}

/**
 * Apply the IR's per-corner radius to the frame builder. Figma's
 * frame builder owns a single `cornerRadius` getter (asymmetric
 * `rectangleCornerRadii` is exposed only on `roundedRectNode`);
 * when the four corners agree we feed that uniform value, otherwise
 * we fall back to the largest corner so a CSS panel with mixed
 * corners still appears rounded rather than square.
 */
function applyFrameCornerRadius(
  builder: ReturnType<typeof frameNode>,
  node: FrameNodeIR,
): ReturnType<typeof frameNode> {
  const radii = node.style.cornerRadius;
  if (!radii) {
    return builder;
  }
  const resolved = radii.map((r) => resolveCornerRadius(r, node.box));
  const max = Math.max(...resolved);
  if (max <= 0) {
    return builder;
  }
  return builder.cornerRadius(max);
}

// ------------------------------ TEXT -------------------------------

export function emitText(
  ctx: EmitContext,
  parentID: number,
  node: TextNodeIR,
  opts: EmitOptions,
): number {
  const localID = ctx.idCounter.next();
  // The captured `box.height` already reflects whether the browser
  // laid the text out on a single line or wrapped it onto several.
  // Browsers' line-stride for a single-line paragraph is ~`fontSize`
  // (e.g. SF Pro 16px → 18px height); a wrapped paragraph reports a
  // multiple of that. Re-deriving wrap inside the renderer requires
  // perfect agreement between opentype.js's variable-font advance
  // and CoreText's, which is approximate at best. Picking
  // `WIDTH_AND_HEIGHT` for single-line capture lets the renderer
  // honour the browser's wrap decision instead of recomputing one,
  // which is the dominant remaining diff source on
  // `example-com-fullpage` (the body paragraph fits on one line in
  // the captured screenshot but the renderer wraps it onto two).
  const resizeMode = resolveTextResizeMode(node);
  // Honour the captured CSS line-height. textNode's builder defaults
  // to `fontSize × 100%` (i.e. lineHeight = fontSize), which collapses
  // wrapped paragraphs to ascender-only line stride and makes
  // multi-line text overlap the next sibling. For numeric line-height
  // we honour the IR value verbatim; for `line-height: normal` we
  // use the captured single-line `box.height` because that already
  // reflects the browser's font-native stride for this exact font.
  const lineHeightPx = resolveEmittedLineHeight(node);
  // CSS `letter-spacing` is captured in CSS pixels (the IR field is
  // numeric px). Figma's text builder accepts both `PIXELS` and
  // `PERCENT`; PIXELS is the lossless mapping. The default the
  // builder applies (`0 PERCENT`) is also correct for the absent
  // case, so a 0 here is harmless on text that didn't author a
  // tracking value.
  // The IR's `box` is the canonical text rect — emit it verbatim.
  // Any divergence between IR box and the emitted `.fig` size
  // creates a second source of truth for "how wide is this text" and
  // forces the renderer's auto-resize logic to reconcile two
  // mismatched widths (the IR's narrow paragraph rect vs the
  // emitter-widened figma box), which historically squished the
  // trailing glyphs of single-line paragraphs against the parent
  // frame's right edge. If a future change wants to honour the
  // browser-measured single line specifically, it must do so at the
  // IR level (e.g. widen `box.width` on the paragraph node so every
  // downstream consumer sees the same value).
  const baseBuilder = textNode(localID, parentID)
    .name(node.name || "Text")
    .text(node.characters)
    .font(node.textStyle.fontFamily, fontStyleName(node.textStyle))
    .fontSize(node.textStyle.fontSize)
    .lineHeight(lineHeightPx, "PIXELS")
    .letterSpacing(node.textStyle.letterSpacing, "PIXELS")
    .size(node.box.width, node.box.height)
    .position(node.box.x, node.box.y)
    .autoResize(resizeMode);
  // TEXT inside an auto-layout SYMBOL/FRAME carries
  // `stackChildAlignSelf=STRETCH` so its counter axis follows the
  // parent's resolved width. Combined with `autoResize=HEIGHT` this
  // is what lets Figma re-flow paragraphs when the parent's width
  // changes.
  const stretched = opts.parentCounterAlign !== undefined
    ? baseBuilder.childAlignSelf("STRETCH")
    : baseBuilder;
  const decorated = applyTextDecoration(stretched, node.textStyle);
  const horizontally = applyTextAlignHorizontal(decorated, node.textStyle);
  const vertically = applyTextAlignVertical(horizontally, node.textStyle);
  const firstSolid = solidColorOf(node.style.fills);
  const withColor = firstSolid ? vertically.color(firstSolid) : vertically;
  const withRuns = applyTextRuns(withColor, node);
  const positioned = node.sizing.mode === "absolute"
    ? withRuns.positioning("ABSOLUTE")
    : withRuns;
  ctx.file.addTextNode(positioned.build());
  ctx.idMap.set(node.id, localID);
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

function applyTextRuns(
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

function runFontName(
  run: { readonly fontFamily?: string; readonly fontWeight?: number; readonly fontStyle?: "normal" | "italic" | "oblique" },
  base: TextNodeIR["textStyle"],
): { readonly family: string; readonly style: string; readonly postscript: string } | undefined {
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
/**
 * Decide whether the emitted TEXT node should re-flow its contents
 * (`HEIGHT` mode) or honour the browser's already-determined line
 * count (`WIDTH_AND_HEIGHT`).
 *
 * The canonical signal is `capturedLineRects` — the per-line client
 * rects the in-page walker pulled off `Range.getClientRects()`. A
 * single entry means the browser fit the entire `characters` onto
 * one line; emitting `HEIGHT` would let the renderer re-derive a
 * wrap point that almost certainly disagrees with what the browser
 * picked, because opentype.js's variable-font advance metrics don't
 * match CoreText's exactly.
 *
 * When `capturedLineRects` is absent (hand-built IR / non-browser
 * source), fall back to a height-vs-font-size heuristic: text whose
 * `box.height` fits within ~1.3 × fontSize is treated as
 * single-line. The 1.3 multiplier covers wider line-height ratios
 * (`line-height: 1.25` etc).
 *
 * Multi-line capture keeps `HEIGHT` so the renderer re-flows — its
 * wrap break may still differ slightly from Chromium's, but at
 * least the line count stays consistent. A future change can swap
 * `HEIGHT` for an emitted `derivedLines` list so the renderer
 * trusts the captured break points verbatim.
 */
function resolveTextResizeMode(node: TextNodeIR): "WIDTH_AND_HEIGHT" | "HEIGHT" {
  if (node.capturedLineRects !== undefined) {
    return node.capturedLineRects.length <= 1 ? "WIDTH_AND_HEIGHT" : "HEIGHT";
  }
  const fontSize = node.textStyle.fontSize;
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return "HEIGHT";
  }
  const singleLineThresholdPx = fontSize * 1.3;
  if (node.box.height <= singleLineThresholdPx) {
    return "WIDTH_AND_HEIGHT";
  }
  return "HEIGHT";
}

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
  // `box.height > fontSize` because the browser includes ascent
  // and descent in the line box.
  if (node.box.height > 0) {
    return node.box.height;
  }
  return node.textStyle.fontSize * 1.2;
}

// ----------------------------- RECT --------------------------------

export function emitRectangle(
  ctx: EmitContext,
  parentID: number,
  node: RectNodeIR,
): number {
  const localID = ctx.idCounter.next();
  // Image fill takes precedence over solid (same rule as
  // `applyFrameBackground`).
  const imageFill = pickImageFillBuilt(node.style.fills, ctx.imageRefs);
  const firstSolid = solidColorOf(node.style.fills);
  const strokeColor = pickFirstSolidStrokeColor(node.style.strokes);
  const strokeWeight = node.style.strokes.reduce<number>((max, s) => (s.weight > max ? s.weight : max), 0);
  const effectData = node.style.effects
    .map(irEffectToFig)
    .filter((e): e is EffectData => e !== undefined);
  if (node.style.cornerRadius) {
    const [tl] = node.style.cornerRadius;
    const baseBuilder = roundedRectNode(localID, parentID)
      .name(node.name || "Rectangle")
      .size(node.box.width, node.box.height)
      .position(node.box.x, node.box.y)
      .cornerRadius(resolveCornerRadius(tl, node.box));
    const filled = imageFill !== undefined
      ? baseBuilder.fill(imageFill)
      : firstSolid
        ? baseBuilder.fill(firstSolid)
        : baseBuilder;
    const stroked = strokeColor !== undefined && strokeWeight > 0
      ? filled.stroke(strokeColor).strokeWeight(strokeWeight)
      : filled;
    const effected = effectData.length > 0 ? stroked.effects(effectData) : stroked;
    const finalBuilder = node.sizing.mode === "absolute"
      ? effected.positioning("ABSOLUTE")
      : effected;
    ctx.file.addRoundedRectangle(finalBuilder.build());
  } else {
    const baseBuilder = rectNode(localID, parentID)
      .name(node.name || "Rectangle")
      .size(node.box.width, node.box.height)
      .position(node.box.x, node.box.y);
    const filled = imageFill !== undefined
      ? baseBuilder.fill(imageFill)
      : firstSolid
        ? baseBuilder.fill(firstSolid)
        : baseBuilder;
    const stroked = strokeColor !== undefined && strokeWeight > 0
      ? filled.stroke(strokeColor).strokeWeight(strokeWeight)
      : filled;
    const effected = effectData.length > 0 ? stroked.effects(effectData) : stroked;
    const finalBuilder = node.sizing.mode === "absolute"
      ? effected.positioning("ABSOLUTE")
      : effected;
    ctx.file.addRectangle(finalBuilder.build());
  }
  ctx.idMap.set(node.id, localID);
  return localID;
}

// ---------------------------- VECTOR -------------------------------

export function emitVector(
  ctx: EmitContext,
  parentID: number,
  node: VectorNodeIR,
): number {
  // Degenerate VECTORs (one or both axes collapsed to 0) are
  // undefined territory in Figma — observed first-hand to render as
  // an oversized black rectangle in some renderers and as nothing
  // at all in others. Skip them at emit time: a path geometry
  // without a bounding box can't be cropped consistently, and the
  // "no node" outcome matches what the captured page actually
  // shows on screen (the parent collapsed it for a reason).
  if (node.box.width <= 0 || node.box.height <= 0) {
    return -1;
  }
  const localID = ctx.idCounter.next();
  // The vector pulls its visible style from the first path's fill
  // — Figma's VECTOR carries one fill stack per node, with per-
  // path overrides living elsewhere (`vectorData.styleOverrideTable`).
  const firstFill = node.paths.find((p) => p.fill?.kind === "solid")?.fill;
  const fillColor = firstFill && firstFill.kind === "solid" ? firstFill.color : undefined;
  // eslint-disable-next-line no-restricted-syntax -- builder is a fluent chain; the let here mirrors the document-io API.
  let builder = vectorNode(localID, parentID)
    .name(node.name || "Vector")
    .size(node.box.width, node.box.height)
    .position(node.box.x, node.box.y);
  // Split each `d` on every `M`/`m` boundary so multi-subpath
  // paths land in Figma as a list of independent `vectorPath`
  // entries — *unless* the path is `fill-rule: evenodd`, where
  // splitting destroys cross-subpath winding cancellation (donut
  // hole). See `splitSubpathsRespectingFillRule` for the contract.
  for (const path of node.paths) {
    for (const subpath of splitSubpathsRespectingFillRule(path.d, path.fillRule)) {
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
  ctx.file.addVector(builder.build());
  ctx.idMap.set(node.id, localID);
  return localID;
}

// --------------------------- HELPERS -------------------------------

/**
 * If the IR's fill stack carries an `image` paint whose imageId
 * has been embedded as an asset, return a built fig `Paint`.
 * Otherwise return `undefined`.
 */
function pickImageFillBuilt(
  fills: readonly PaintIR[],
  imageRefs: ReadonlyMap<string, string>,
): ReturnType<ReturnType<typeof imagePaint>["build"]> | undefined {
  for (const fill of fills) {
    if (fill.kind === "image") {
      const ref = imageRefs.get(fill.imageId);
      if (ref !== undefined) {
        const figScale = scaleModeToFigName(fill.scaleMode);
        return imagePaint(ref)
          .scaleMode(figScale)
          .scale(1)
          .opacity(fill.opacity ?? 1)
          .visible(fill.visible ?? true)
          .build();
      }
    }
  }
  return undefined;
}

function scaleModeToFigName(mode: "cover" | "contain" | "tile" | "stretch"): "FILL" | "FIT" | "TILE" | "STRETCH" {
  switch (mode) {
    case "cover": return "FILL";
    case "contain": return "FIT";
    case "tile": return "TILE";
    case "stretch": return "STRETCH";
  }
}

export function solidColorOf(fills: readonly PaintIR[]): { readonly r: number; readonly g: number; readonly b: number; readonly a: number } | undefined {
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
 * child carries `stackChildAlignSelf=STRETCH` instead (handled by
 * `emitFrame` / `emitText` via `parentCounterAlign`).
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
 * Routes through the canonical `fontQueryToStyleName` +
 * `normalizeWeight` SoT so the label format here always matches
 * what `figmaFontToQuery` will parse back to the same numeric
 * weight on the round-trip side.
 */
export function fontStyleName(style: TextNodeIR["textStyle"]): string {
  return fontQueryToStyleName({
    family: style.fontFamily,
    weight: normalizeWeight(style.fontWeight),
    style: style.fontStyle,
  });
}
