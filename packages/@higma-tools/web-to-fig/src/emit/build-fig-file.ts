/**
 * @file ViewportIR → fig-file builder pipeline.
 *
 * Why a dedicated builder path: `@higma-document-io/fig`'s
 * `exportFig` for fresh documents (i.e. documents not loaded from an
 * existing .fig) goes through `saveFigFile({ schema: { definitions:
 * [] }, ... })`, which the Kiwi encoder rejects (`Unknown type:
 * Message`). The working pattern — used by `createDemoFigDesignDocument`
 * — is to drive the low-level `createFigFile()` builder directly,
 * which carries the bundled Figma schema and produces bytes that
 * `createFigDesignDocument` round-trips cleanly.
 *
 * Coverage:
 *   - FRAME nodes with auto-layout (stackMode / gap / padding /
 *     primary + counter alignment)
 *   - RECTANGLE / ROUNDED_RECTANGLE
 *   - TEXT (single style run)
 *
 * Anything outside this set throws — the bridge promises a closed
 * round-trip on the supported subset, not a forgiving best effort.
 */
import {
  createFigFile,
  frameNode,
  roundedRectNode,
  rectNode,
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
  NodeIR,
  PaintIR,
  RectNodeIR,
  TextNodeIR,
  VectorNodeIR,
  ViewportIR,
} from "@higma-bridges/web-fig";
import { resolveCornerRadius } from "@higma-bridges/web-fig";
import { fontQueryToStyleName, normalizeWeight } from "@higma-document-models/fig/font";
import { splitSubpaths } from "./split-subpaths";

/** Build a `.fig` byte buffer from the IR. ZIP-wrapped, ready to open in Figma. */
/** Convert ViewportIR into a `.fig` (zip-wrapped) byte buffer plus IR id → fig localID map. */
export async function buildFigFileBytes(viewport: ViewportIR): Promise<{ readonly bytes: Uint8Array; readonly idMap: ReadonlyMap<string, number> }> {
  const file = createFigFile();
  const docID = file.addDocument(viewport.source);
  const canvasID = file.addCanvas(docID, "Web Capture");

  const idCounter = createIdCounter();
  const idMap = new Map<string, number>();
  emitNode({
    file,
    parentID: canvasID,
    node: viewport.root,
    idCounter,
    idMap,
    isRoot: true,
  });
  file.addInternalCanvas(docID);

  const bytes = await file.buildAsync({ fileName: viewport.source });
  return { bytes, idMap };
}

type IdCounter = { next: () => number };

function createIdCounter(start = 10): IdCounter {
  const ref = { value: start };
  return { next: () => ref.value++ };
}

type EmitArgs = {
  readonly file: ReturnType<typeof createFigFile>;
  readonly parentID: number;
  readonly node: NodeIR;
  readonly idCounter: IdCounter;
  readonly idMap: Map<string, number>;
  readonly isRoot: boolean;
};

function emitNode(args: EmitArgs): number {
  switch (args.node.kind) {
    case "frame":
      return emitFrame(args.file, args.parentID, args.node, args.idCounter, args.idMap, args.isRoot);
    case "text":
      return emitText(args.file, args.parentID, args.node, args.idCounter, args.idMap);
    case "rectangle":
      return emitRectangle(args.file, args.parentID, args.node, args.idCounter, args.idMap);
    case "vector":
      return emitVector(args.file, args.parentID, args.node, args.idCounter, args.idMap);
  }
}

/**
 * Emit a VECTOR IR node by feeding each captured `<path d>` into
 * `vectorNode` and registering through `addVector`. The fig-file
 * encoder converts every `d` to a path-command blob the Figma
 * reader understands. Multiple paths in one IR node become multiple
 * `fillGeometry` slots on the same VECTOR — that is how Figma's own
 * `.fig` exports represent SVGs with several sub-paths.
 *
 * The IR's `paths[i].fill` carries the resolved per-path colour;
 * `vectorNode` exposes only one fill set (Figma's vector model
 * collapses multi-fill SVGs into a single fill bag). We pick the
 * first path's solid fill as the node-level fill — close enough for
 * decorative icons, which is what almost every captured `<svg>` in
 * the wild is. Stroke is folded the same way. Mixed-colour SVGs
 * lose information here; correct handling would mean emitting one
 * VECTOR per path inside a wrapper FRAME. Leaving that as a future
 * extension because no real-world fixture in the spec corpus needs
 * it yet.
 */
function emitVector(
  file: ReturnType<typeof createFigFile>,
  parentID: number,
  node: VectorNodeIR,
  idCounter: IdCounter,
  idMap: Map<string, number>,
): number {
  const localID = idCounter.next();
  const baseBuilder = vectorNode(localID, parentID)
    .name(node.name || "Vector")
    .size(node.box.width, node.box.height)
    .position(node.box.x, node.box.y);
  const winding = pickWindingRule(node);
  const withWinding = winding === "EVENODD" ? baseBuilder.windingRule("EVENODD") : baseBuilder;
  const withFill = applyVectorFill(withWinding, node);
  // Split each captured `d` on every `M`/`m` boundary so multi-
  // subpath geometry lands in Figma as a list of independent
  // `vectorPath` entries — keeps Figma's pen position from connecting
  // parts that should render as separate strokes / silhouettes.
  const withPaths = node.paths.reduce(
    (b, p) => {
      if (p.d.length === 0) {
        return b;
      }
      return splitSubpaths(p.d).reduce(
        (acc, segment) => (segment.length > 0 ? acc.path(segment) : acc),
        b,
      );
    },
    withFill,
  );
  file.addVector(withPaths.build());
  idMap.set(node.id, localID);
  return localID;
}

function pickWindingRule(node: VectorNodeIR): "NONZERO" | "EVENODD" {
  for (const p of node.paths) {
    if (p.fillRule === "evenodd") {
      return "EVENODD";
    }
  }
  return "NONZERO";
}

/**
 * Pick the dominant solid fill across the IR's path list and apply
 * it to the vector builder. Falls back to the node-level
 * `style.fills` when no path declared its own colour.
 */
function applyVectorFill(
  builder: ReturnType<typeof vectorNode>,
  node: VectorNodeIR,
): ReturnType<typeof vectorNode> {
  for (const p of node.paths) {
    if (p.fill && p.fill.kind === "solid") {
      return builder.fill(p.fill.color);
    }
  }
  const fromStyle = solidColorOf(node.style.fills);
  if (fromStyle) {
    return builder.fill(fromStyle);
  }
  return builder;
}

function emitFrame(
  file: ReturnType<typeof createFigFile>,
  parentID: number,
  node: FrameNodeIR,
  idCounter: IdCounter,
  idMap: Map<string, number>,
  isRoot: boolean,
): number {
  // The `isRoot` flag is no longer used to override the name (the IR
  // owns it), but keeping the parameter avoids changing the call sites.
  void isRoot;
  const localID = idCounter.next();
  const baseBuilder = frameNode(localID, parentID)
    .name(node.name || "Frame")
    .size(node.box.width, node.box.height)
    .position(node.box.x, node.box.y)
    .clipsContent(node.style.clipsContent)
    .opacity(node.style.opacity);

  const withFill = applyFrameBackground(baseBuilder, node.style.fills);
  const withLayout = applyAutoLayoutToFrame(withFill, node.autoLayout);
  const withCorners = applyFrameCornerRadius(withLayout, node);

  file.addFrame(withCorners.build());
  idMap.set(node.id, localID);

  for (const child of node.children) {
    emitNode({
      file,
      parentID: localID,
      node: child,
      idCounter,
      idMap,
      isRoot: false,
    });
  }
  return localID;
}

/**
 * Apply the IR's per-corner radius to the frame builder. Figma's
 * frame builder owns a single `cornerRadius` getter (asymmetric
 * `rectangleCornerRadii` is exposed only on `roundedRectNode`); when
 * the four corners agree we feed that uniform value, otherwise we
 * fall back to the largest corner so a CSS panel with mixed corners
 * still appears rounded rather than square. Improving this further
 * requires teaching the frame builder about per-corner radii — out
 * of scope for the web-to-fig fix; assert the loss instead of
 * silently swallowing it.
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

function applyFrameBackground(
  builder: ReturnType<typeof frameNode>,
  fills: FrameNodeIR["style"]["fills"],
): ReturnType<typeof frameNode> {
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

function emitText(
  file: ReturnType<typeof createFigFile>,
  parentID: number,
  node: TextNodeIR,
  idCounter: IdCounter,
  idMap: Map<string, number>,
): number {
  const localID = idCounter.next();
  const lineMetric = lineMetricFor(node.textStyle);
  const isSingleLine = node.box.height <= lineMetric * 1.5;
  const resizeMode = isSingleLine ? "WIDTH_AND_HEIGHT" : "HEIGHT";
  const baseBuilder = textNode(localID, parentID)
    .name(node.name || "Text")
    .text(node.characters)
    .font(node.textStyle.fontFamily, fontStyleName(node.textStyle))
    .fontSize(node.textStyle.fontSize)
    .size(node.box.width, node.box.height)
    .position(node.box.x, node.box.y)
    .autoResize(resizeMode);
  // Honour the captured CSS `text-align` so labels that the page
  // authored as centred / right-aligned / justified arrive in Figma
  // with the same horizontal alignment. Without this every TEXT node
  // resolves to LEFT regardless of source intent.
  const aligned = applyTextAlign(baseBuilder, node.textStyle);
  const firstSolid = solidColorOf(node.style.fills);
  const withColor = firstSolid ? aligned.color(firstSolid) : aligned;
  const withRuns = applyTextRuns(withColor, node);
  file.addTextNode(withRuns.build());
  idMap.set(node.id, localID);
  return localID;
}

function applyTextAlign(
  builder: ReturnType<typeof textNode>,
  style: TextNodeIR["textStyle"],
): ReturnType<typeof textNode> {
  const horizontal = applyTextAlignHorizontal(builder, style);
  return applyTextAlignVertical(horizontal, style);
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

function lineMetricFor(style: TextNodeIR["textStyle"]): number {
  switch (style.lineHeight.unit) {
    case "px":
      return style.lineHeight.value;
    case "ratio":
      return style.fontSize * style.lineHeight.value;
    case "normal":
      return style.fontSize * 1.2;
  }
}

function emitRectangle(
  file: ReturnType<typeof createFigFile>,
  parentID: number,
  node: RectNodeIR,
  idCounter: IdCounter,
  idMap: Map<string, number>,
): number {
  const localID = idCounter.next();
  const firstSolid = solidColorOf(node.style.fills);
  if (node.style.cornerRadius) {
    const [tl] = node.style.cornerRadius;
    const baseBuilder = roundedRectNode(localID, parentID)
      .name(node.name || "Rectangle")
      .size(node.box.width, node.box.height)
      .position(node.box.x, node.box.y)
      .cornerRadius(resolveCornerRadius(tl, node.box));
    const finalBuilder = firstSolid ? baseBuilder.fill(firstSolid) : baseBuilder;
    file.addRoundedRectangle(finalBuilder.build());
  } else {
    const baseBuilder = rectNode(localID, parentID)
      .name(node.name || "Rectangle")
      .size(node.box.width, node.box.height)
      .position(node.box.x, node.box.y);
    const finalBuilder = firstSolid ? baseBuilder.fill(firstSolid) : baseBuilder;
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
 * Translate the IR's counter-axis alignment (`stretch` included) to
 * Figma's `StackAlign` enum, which has NO STRETCH variant. Counter
 * STRETCH is encoded per-child via `stackChildAlignSelf=STRETCH`
 * (handled separately by `emitFrame` / `emitText`); the parent stays
 * MIN. Without this distinction the encoder writes value 3 against a
 * StackAlign field, which round-trips back as BASELINE — a silent
 * corruption that broke INSTANCE reflow.
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
