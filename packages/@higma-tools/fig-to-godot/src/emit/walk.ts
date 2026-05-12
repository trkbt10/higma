/**
 * @file Walk a FigNode tree and produce a Godot scene tree.
 *
 * The walker runs in three modes that match the Figma container kinds,
 * mirroring `fig-to-swiftui/src/emit/walk.ts`:
 *
 *   1. **Autolayout frame** (`stackMode = HORIZONTAL | VERTICAL`)
 *      → emits `HBoxContainer` / `VBoxContainer` with each child
 *        rendered in flow order; primary distribution drives the
 *        container's `alignment` property and (for SPACE_BETWEEN)
 *        synthetic spacer-Control insertion.
 *
 *   2. **Plain frame / group / component / instance**
 *      → emits a `Control` and renders each child with explicit
 *        `position` / `size` derived from the child's `transform.m02 / m12`
 *        so absolute positioning survives the conversion.
 *
 *   3. **Leaf primitive** (TEXT, RECTANGLE, ELLIPSE)
 *      → emits a single Godot Control (`Label`, `Panel`) with a
 *        StyleBoxFlat sub-resource attached via
 *        `theme_override_styles/panel`.
 *
 * Out-of-scope leaf kinds (vectors with arbitrary path data, image
 * fills, gradient fills) hit a Fail-Fast `throw` so the consumer can
 * address them rather than silently rendering an empty placeholder.
 *
 * Frame-padding wrapping rule:
 *
 *   When a BoxContainer has authored padding, the walker wraps it in a
 *   `MarginContainer` with the four `theme_override_constants/margin_*`
 *   set. The MarginContainer adopts the outer name; the inner
 *   BoxContainer is renamed `Stack` (or whatever the disambiguator
 *   produces) so node names stay unique within the parent.
 */
import type { FigGradientPaint, FigNode, FigPaint, FigSolidPaint } from "@higma-document-models/fig/types";
import { getNodeType, safeChildren } from "@higma-document-models/fig/domain";
import { resolveInstanceNode } from "@higma-document-models/fig/symbols";
import { toPascalCase, uniqueIdent } from "@higma-primitives/identifier";
import {
  boolVal,
  colorVal,
  enumVal,
  floatVal,
  intVal,
  node,
  property,
  stringVal,
  subResource,
  vector2,
  type GodotExtResource,
  type GodotNode,
  type GodotProperty,
  type GodotSubResource,
  type GodotValue,
} from "../godot-tree";
import { decodePng } from "../image/decode";
import {
  boxContainerAlignment,
  counterSizeFlagsForChild,
  flowPositionsForGrid,
  flowPositionsForOverlapStack,
  planLayout,
  SIZE_FLAGS,
  type LayoutPlan,
} from "../layout/autolayout";
import { buildShadowOnlyStyleBoxFlat, buildStyleBoxFlat, modulateAlphaProperty, pickAllDropShadows, pickAllInnerShadows, pickDropShadow, pickLayerBlur } from "../style/style-box";
import { paintStrokeBand, rasterizeShapeWithEffects, type ShapeEffect } from "../style/blur-raster";
import { solidPaintToColor, solidPaintToPolygon2DColor } from "../style/color";
import { buildLinearGradient } from "../style/gradient";
import {
  rasterizeAngularGradient,
  rasterizeDiamondGradient,
  rasterizeLinearGradient,
  rasterizeRadialGradient,
} from "../style/gradient-raster";
import { buildPolygon2DNodes, decodeNodeContours } from "../shape/polygon";
import { composeBooleanContours } from "../shape/boolean";
import {
  labelStyleOverrides,
  marginOverrides,
  panelStyleOverride,
  separationOverride,
} from "../style/theme";

const TEXT_TYPE = "TEXT";
const RECTANGLE_TYPE = "RECTANGLE";
const ROUNDED_RECTANGLE_TYPE = "ROUNDED_RECTANGLE";
const ELLIPSE_TYPE = "ELLIPSE";
const FRAME_LIKE_TYPES: ReadonlySet<string> = new Set([
  "FRAME",
  "GROUP",
  "SYMBOL",
  "INSTANCE",
  "SECTION",
]);

/**
 * Optional resources passed to the walker.
 *
 *   - `symbolMap` — `{guid → FigNode}` lookup used by INSTANCE
 *     expansion. When set, the walker resolves each INSTANCE via
 *     `resolveInstanceNode` and emits the merged node + its
 *     SYMBOL-derived children. When omitted, INSTANCE nodes emit
 *     their literal direct children (typically empty for component
 *     instances whose authoring source lives on another canvas).
 *
 * Mirrors `fig-to-swiftui`'s EmitContext shape so the two converters
 * accept the same call site (driver in `run-case.ts` /
 * `measure-all-cases.ts`).
 */
export type EmitContext = {
  readonly symbolMap?: ReadonlyMap<string, FigNode>;
  /**
   * Document-level blob array. Required for shape kinds whose
   * geometry lives in a `commandsBlob` referenced by
   * `fillGeometry[i].commandsBlob`: `STAR`, `REGULAR_POLYGON`,
   * `VECTOR`, `BOOLEAN_OPERATION`, and `ELLIPSE`-with-`arcData`. When
   * absent, those nodes fall through to a placeholder Control.
   */
  readonly blobs?: readonly { readonly bytes: readonly number[] }[];
  /**
   * Document-level image map keyed by image hash. Required for IMAGE
   * paint emission — the walker resolves a paint's `image.hash` /
   * `imageHash` / `imageRef` against this map to recover the binary
   * PNG/JPEG bytes that get written next to the scene as a Godot
   * `ExtResource`. When absent, IMAGE paints fall through to a
   * placeholder Control (no fill rendered).
   */
  readonly images?: ReadonlyMap<string, { readonly data: Uint8Array; readonly mimeType: string }>;
};

/**
 * Mutable side-table the walker accumulates while it builds the scene
 * tree. Sub-resource ids are minted via `nextSubResourceId`; the
 * caller (`emitFromFrames`) hands one of these in per-frame and reads
 * the populated arrays after the walk.
 *
 * `emit` carries the read-only EmitContext so INSTANCE resolution and
 * other doc-level lookups can flow through the walker without thread
 * passing every helper.
 *
 * `insideClipFrame` is set when the current node lives inside a
 * frame that already enforces clipping (rect or rounded). The
 * rounded-clip rule disables itself on inner frames in that case to
 * avoid changing pixel composition versus the enclosing frame's clip
 * (Godot composes nested clip_children by intersecting masks, which
 * doesn't always match Figma's pixel-by-pixel result for frames
 * whose own children sit in the corner-free middle band).
 */
export type WalkContext = {
  readonly subResources: GodotSubResource[];
  /**
   * `[ext_resource ...]` declarations the scene needs at the top of
   * the emitted `.tscn`. Populated when an IMAGE paint resolves to a
   * Godot `Texture2D` companion file. The accumulator is mutable so
   * deeply-nested walks can append without threading the array back
   * up through every helper.
   */
  readonly extResources: GodotExtResource[];
  /**
   * Image companion files the renderer has to write into the project
   * tree alongside the scene `.tscn`. Keyed by `res://`-relative path
   * (e.g. `images/<hash>.png`); value is the raw image bytes. The
   * scene's `[ext_resource path="…"]` entries point at these paths.
   * The renderer harness writes them via the
   * `GodotBatchEntry.companions` map.
   */
  readonly imageAssets: Map<string, Uint8Array>;
  /**
   * Cache: image-hash → assigned ExtResource id. Lets multiple paints
   * referencing the same image share one `[ext_resource]` declaration
   * and one companion file (matters for fixtures like
   * `image-fill-multi` that re-use the test PNG across two paints).
   */
  readonly imageHashToId: Map<string, string>;
  readonly nodeNamesUsed: Set<string>;
  /** Counter feeding `nextStyleBoxId` — kept here so multiple walks share. */
  styleBoxCounter: number;
  /** Counter for Gradient + GradientTexture2D sub-resource ids. */
  gradientCounter: number;
  /** Counter feeding `nextImageTextureId`. */
  imageTextureCounter: number;
  /** Read-only doc-level lookups (symbolMap etc.). */
  readonly emit: EmitContext;
  /** True when any FRAME ancestor has `clipsContent`. */
  insideClipFrame: boolean;
  /**
   * True when an ancestor has `opacity < 1` and is therefore wrapped
   * in a `CanvasGroup { self_modulate alpha < 1 }`. Inside such a
   * group, child fill colours must NOT receive the standard
   * `(byte+0.5)/256` Godot byte-rounding compensation: that
   * compensation lands one byte high and Godot's int-truncation
   * preserves that overshoot through the post-composite blend, which
   * lands the final pixel one byte off the WebGL reference.
   * Emitting raw float colours produces buffer bytes that, after
   * Godot's float→byte conversion at composite time, round to the
   * same byte WebGL composes in float space.
   */
  insideOpacityComposite: boolean;
};

/**
 * True when `node_` itself, or any ancestor, would be wrapped in a
 * CanvasGroup with `self_modulate` alpha < 1, AND that wrapping is the
 * "passthrough opacity" kind (FRAME / RECTANGLE / etc with node-level
 * opacity) rather than the "isolated layer" kind (GROUP).
 *
 * Figma's WebGL renderer composites FRAME-opacity and node-level
 * opacity into the parent's float buffer (no byte-flatten step),
 * while GROUP opacity flattens its children into an intermediate
 * byte buffer first and then alpha-blends that buffer into the
 * parent. Godot always renders to a byte buffer, so the two modes
 * need different compensation formulas to round-trip the WebGL
 * reference bytes:
 *
 *   - Passthrough (FRAME / RECTANGLE / etc): emit `(floor(c*255)+0.5)/256`
 *     so Godot's byte composite produces the same final byte as
 *     WebGL's float composite (`round(c_composite*255)`).
 *   - Isolate (GROUP): emit `(floor(c*255+0.5)+0.5)/256` (the legacy
 *     compensation) so the buffer byte equals WebGL's pre-flatten
 *     byte and the byte-level composite matches.
 */
export function inOpacityComposite(node_: FigNode, ctx: WalkContext): boolean {
  if (ctx.insideOpacityComposite) {
    return true;
  }
  return isPassthroughOpacityWrap(node_);
}

/**
 * True when this node's `opacity < 1` will be applied in the
 * "passthrough" sense — a FRAME / RECTANGLE / etc whose alpha gets
 * composited directly into the parent's float buffer in WebGL.
 * GROUP opacity is the "isolated layer" kind and follows a different
 * byte-composite math path, so it's excluded here.
 */
function isPassthroughOpacityWrap(node_: FigNode): boolean {
  if (typeof node_.opacity !== "number" || node_.opacity >= 1) {
    return false;
  }
  return node_.type?.name !== "GROUP";
}

/** Build an empty walk context — call once per top-level scene emit. */
export function createWalkContext(emit: EmitContext = {}): WalkContext {
  return {
    subResources: [],
    extResources: [],
    imageAssets: new Map<string, Uint8Array>(),
    imageHashToId: new Map<string, string>(),
    nodeNamesUsed: new Set<string>(),
    styleBoxCounter: 0,
    gradientCounter: 0,
    imageTextureCounter: 0,
    emit,
    insideClipFrame: false,
    insideOpacityComposite: false,
  };
}

function nextStyleBoxId(ctx: WalkContext): string {
  ctx.styleBoxCounter += 1;
  // Godot writes ids as `<TypeShorthand>_<6-char-suffix>`; we use a
  // numeric monotonic suffix so emitted scenes round-trip diff-clean.
  return `StyleBoxFlat_${ctx.styleBoxCounter.toString().padStart(3, "0")}`;
}

function nextGradientId(ctx: WalkContext): string {
  ctx.gradientCounter += 1;
  return `Gradient_${ctx.gradientCounter.toString().padStart(3, "0")}`;
}

function nextGradientTextureId(ctx: WalkContext): string {
  ctx.gradientCounter += 1;
  return `GradientTexture2D_${ctx.gradientCounter.toString().padStart(3, "0")}`;
}

function allocateImageIds(ctx: WalkContext): { readonly imageId: string; readonly textureId: string } {
  ctx.imageTextureCounter += 1;
  const suffix = ctx.imageTextureCounter.toString().padStart(3, "0");
  return {
    imageId: `Image_${suffix}`,
    textureId: `ImageTexture_${suffix}`,
  };
}

/**
 * Look up the binary image data referenced by a fig IMAGE paint.
 *
 * The paint can carry the hash in three different shapes (in priority
 * order: Kiwi `image.hash` byte array → API/legacy `imageHash` string
 * or array → builder `imageRef` hash string). We normalise all three
 * to the lowercase-hex string the symbol context's images map keys
 * itself by.
 */
function lookupImageBytes(
  paint: { readonly image?: { readonly hash?: readonly number[] }; readonly imageHash?: string | readonly number[]; readonly imageRef?: string },
  images: ReadonlyMap<string, { readonly data: Uint8Array; readonly mimeType: string }> | undefined,
): { readonly hash: string; readonly data: Uint8Array; readonly mimeType: string } | undefined {
  if (!images) {
    return undefined;
  }
  const hash = readPaintImageHash(paint);
  if (!hash) {
    return undefined;
  }
  const entry = images.get(hash);
  if (!entry) {
    return undefined;
  }
  return { hash, data: entry.data, mimeType: entry.mimeType };
}

/**
 * Pick the canonical hex hash for a paint. Kiwi `image.hash` is the
 * byte-array shape the parser writes; API exports use a string. The
 * symbol context's `images` map keys on the lowercase-hex form, so
 * we normalise both shapes to that.
 */
function readPaintImageHash(paint: {
  readonly image?: { readonly hash?: readonly number[] };
  readonly imageHash?: string | readonly number[];
  readonly imageRef?: string;
}): string | undefined {
  const hashBytes = paint.image?.hash;
  if (hashBytes && hashBytes.length > 0) {
    return Array.from(hashBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  if (Array.isArray(paint.imageHash)) {
    return Array.from(paint.imageHash).map((b) => (b as number).toString(16).padStart(2, "0")).join("");
  }
  if (typeof paint.imageHash === "string" && paint.imageHash.length > 0) {
    return paint.imageHash.toLowerCase();
  }
  if (typeof paint.imageRef === "string" && paint.imageRef.length > 0) {
    return paint.imageRef.toLowerCase();
  }
  return undefined;
}

/**
 * Resolve a paint's image to an inline `ImageTexture` sub-resource
 * pair (`Image` + `ImageTexture`). Returns the ImageTexture's
 * sub-resource id and the image's natural pixel dimensions. Returns
 * `undefined` when the image bytes can't be found (paint has no
 * resolvable hash, or the hash isn't in `ctx.emit.images`) or when
 * the bytes can't be decoded into RGBA8.
 *
 * Multiple paints sharing the same image hash get one Image / one
 * ImageTexture pair (deduplicated via `ctx.imageHashToId` keyed on
 * the texture id).
 *
 * Why inline sub-resources rather than ExtResource + companion PNG:
 * Godot's scene loader requires `[ext_resource type="Texture2D"]`
 * pointers to resolve through its import pipeline, which auto-
 * generates `.import` metadata for raw PNG/JPEG files. Headless
 * batch renders skip that pipeline (no editor process), so the
 * image fails to load and the Polygon2D paints with a `null`
 * texture — which Godot treats as "fully transparent" (the
 * `image-fill` cases rendered as plain white). Inline `Image` +
 * `ImageTexture` sub-resources sidestep the import pipeline:
 * Godot's scene parser constructs the ImageTexture directly from
 * the embedded RGBA8 byte array with no filesystem traversal.
 */
function resolveImageSubResource(
  paint: { readonly image?: { readonly hash?: readonly number[] }; readonly imageHash?: string | readonly number[]; readonly imageRef?: string },
  ctx: WalkContext,
): { readonly id: string; readonly imageWidth: number; readonly imageHeight: number } | undefined {
  const found = lookupImageBytes(paint, ctx.emit.images);
  if (!found) {
    return undefined;
  }
  const decoded = decodeRgba8(found.data);
  if (!decoded) {
    return undefined;
  }
  const cached = ctx.imageHashToId.get(found.hash);
  if (cached) {
    return { id: cached, imageWidth: decoded.width, imageHeight: decoded.height };
  }
  const ids = allocateImageIds(ctx);
  ctx.subResources.push(buildImageSubResource(ids.imageId, decoded));
  ctx.subResources.push(buildImageTextureSubResource(ids.textureId, ids.imageId));
  ctx.imageHashToId.set(found.hash, ids.textureId);
  return { id: ids.textureId, imageWidth: decoded.width, imageHeight: decoded.height };
}

/**
 * Dispatch to the per-kind rasterizer. Extracted so the conditional
 * expression remains single-line for the caller.
 */
function rasterizeGradientByKind(
  paint: FigGradientPaint,
  w: number,
  h: number,
  kind: "angular" | "diamond" | "linear" | "radial",
): { readonly width: number; readonly height: number; readonly rgba: Uint8Array } {
  if (kind === "angular") {
    return rasterizeAngularGradient(paint, w, h);
  }
  if (kind === "diamond") {
    return rasterizeDiamondGradient(paint, w, h);
  }
  if (kind === "linear") {
    return rasterizeLinearGradient(paint, w, h);
  }
  return rasterizeRadialGradient(paint, w, h);
}

/**
 * Pre-rasterize a `GRADIENT_ANGULAR` or `GRADIENT_DIAMOND` paint to
 * an inline `ImageTexture` sub-resource at the node's authored size,
 * and return the texture id + dimensions.
 *
 * Godot's `GradientTexture2D` only supports LINEAR (`fill = 0`) and
 * RADIAL (`fill = 1`) — angular and diamond have no native fill
 * mode. We sidestep by computing the gradient pixel-by-pixel in
 * TypeScript (`gradient-raster.ts`) and embedding the bytes as the
 * same kind of inline `Image` sub-resource we use for IMAGE paint.
 *
 * Two paints with identical (kind, stops, transform, size) get
 * deduplicated via the `imageHashToId` cache (the synthesised hash
 * key encodes those fields). Saves emit-time work + scene size when
 * a fixture re-uses the same gradient across siblings.
 */
function resolveRasterizedGradient(
  paint: FigGradientPaint,
  size: { readonly x: number; readonly y: number },
  kind: "angular" | "diamond" | "linear" | "radial",
  ctx: WalkContext,
): { readonly id: string; readonly imageWidth: number; readonly imageHeight: number } | undefined {
  const w = Math.max(1, Math.round(size.x));
  const h = Math.max(1, Math.round(size.y));
  const cacheKey = `${kind}:${w}x${h}:${gradientCacheKey(paint)}`;
  const cached = ctx.imageHashToId.get(cacheKey);
  if (cached) {
    return { id: cached, imageWidth: w, imageHeight: h };
  }
  const raster = rasterizeGradientByKind(paint, w, h, kind);
  const decoded = { width: raster.width, height: raster.height, rgba: raster.rgba };
  const ids = allocateImageIds(ctx);
  ctx.subResources.push(buildImageSubResource(ids.imageId, decoded));
  ctx.subResources.push(buildImageTextureSubResource(ids.textureId, ids.imageId));
  ctx.imageHashToId.set(cacheKey, ids.textureId);
  return { id: ids.textureId, imageWidth: w, imageHeight: h };
}

/**
 * Stable cache key for a gradient paint: stops + transform. The same
 * object identity is rare across a walk, so without a key we'd
 * rasterize the same gradient twice for two sibling paints.
 */
function gradientCacheKey(paint: FigGradientPaint): string {
  const stops = paint.stops ?? paint.gradientStops ?? [];
  const t = paint.transform ?? {};
  const opacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  const stopsKey = stops
    .map((s) => `${s.position},${s.color.r},${s.color.g},${s.color.b},${s.color.a}`)
    .join("|");
  const transformKey = `${t.m00 ?? 1},${t.m01 ?? 0},${t.m02 ?? 0.5},${t.m10 ?? 0},${t.m11 ?? 1},${t.m12 ?? 0.5}`;
  return `${stopsKey}|${transformKey}|${opacity}`;
}

/**
 * Build a Godot `Image` sub-resource carrying the decoded RGBA8 bytes
 * inline. Godot's `Image.create_from_data` and the scene-format
 * `[sub_resource type="Image"]` block read the same shape:
 *
 *   data = {
 *     "data": PackedByteArray(b0, b1, …),  // raw RGBA bytes
 *     "format": "RGBA8",
 *     "height": <int>,
 *     "mipmaps": false,
 *     "width": <int>,
 *   }
 */
function buildImageSubResource(
  id: string,
  decoded: { readonly width: number; readonly height: number; readonly rgba: Uint8Array },
): GodotSubResource {
  // Format the byte array as `PackedByteArray(b0, b1, …)`. Inline
  // emission keeps the scene single-file and avoids Godot's import
  // pipeline (see docstring on `resolveImageSubResource`).
  // Emit the dict on a single line — the structural-roundtrip parser
  // splits properties on `\n`, so a multi-line value breaks the
  // round-trip. Godot itself accepts either.
  const bytes: number[] = Array.from(decoded.rgba);
  const dataValue: GodotValue = {
    kind: "raw",
    text:
      `{` +
      `"data": PackedByteArray(${bytes.join(", ")}), ` +
      `"format": "RGBA8", ` +
      `"height": ${decoded.height}, ` +
      `"mipmaps": false, ` +
      `"width": ${decoded.width}` +
      `}`,
  };
  return subResource(id, "Image", [property("data", dataValue)]);
}

/** Build a Godot `ImageTexture` sub-resource pointing at the inline `Image`. */
function buildImageTextureSubResource(textureId: string, imageId: string): GodotSubResource {
  return subResource(textureId, "ImageTexture", [
    property("image", { kind: "sub-resource", id: imageId }),
  ]);
}

/**
 * Decode a PNG's bytes into raw RGBA8. Returns `undefined` for
 * non-PNG inputs or decode failures. Used to inline the image into a
 * Godot `Image` sub-resource (see `resolveImageSubResource`).
 */
function decodeRgba8(data: Uint8Array): { readonly width: number; readonly height: number; readonly rgba: Uint8Array } | undefined {
  if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
    return undefined;
  }
  const png = decodePng(data);
  if (!png) {
    return undefined;
  }
  return { width: png.width, height: png.height, rgba: png.data };
}

/**
 * Build the image resolver callback the rasterizer uses to fetch
 * decoded RGBA8 bytes for an IMAGE paint. Same hash→bytes lookup the
 * inline-sub-resource path uses (`lookupImageBytes` + `decodeRgba8`)
 * — wrapped here so the rasterizer doesn't have to know about ctx.
 *
 * The resolver returns undefined for unresolvable hashes or
 * unsupported encodings; the rasterizer treats that as an
 * unsupported paint and the AA-fill path falls through to the
 * Polygon2D emit.
 */
function buildImageResolver(ctx: WalkContext): (paint: FigPaint) => { readonly width: number; readonly height: number; readonly rgba: Uint8Array } | undefined {
  return (paint) => {
    if (paint.type !== "IMAGE") return undefined;
    const found = lookupImageBytes(paint, ctx.emit.images);
    if (!found) return undefined;
    return decodeRgba8(found.data);
  };
}

function uniqueNodeName(ctx: WalkContext, base: string): string {
  const sanitized = sanitizeNodeName(base);
  return uniqueIdent(sanitized, ctx.nodeNamesUsed);
}

/**
 * Godot node names cannot contain `/`, `:`, `@`, or `"`. Replace them
 * with `_` before passing through PascalCase de-duplication so the
 * output round-trips cleanly through Godot's editor save.
 */
function sanitizeNodeName(name: string): string {
  const cleaned = name.replace(/[/:@"]/g, "_");
  const pascal = toPascalCase(cleaned);
  if (pascal.length === 0) {
    return "Node";
  }
  return pascal;
}

function isRendered(node: FigNode): boolean {
  if (node.visible === false) {
    return false;
  }
  return true;
}

/**
 * If the node is an INSTANCE and the walker has access to a
 * symbolMap, resolve it through the canonical helper and return
 * both the merged node (carrying the SYMBOL's properties — fillPaints,
 * size, etc., with INSTANCE-level overrides folded in) and the
 * resolved children. For non-INSTANCE nodes (or when no symbolMap is
 * available) returns the input unchanged. Mirrors the swiftui peer's
 * `resolveInstanceFor`.
 */
function resolveInstanceFor(
  node: FigNode,
  ctx: WalkContext,
): { readonly node: FigNode; readonly children: readonly FigNode[] } {
  if (ctx.emit.symbolMap && node.type.name === "INSTANCE") {
    return resolveInstanceNode(node, { symbolMap: ctx.emit.symbolMap });
  }
  return { node, children: safeChildren(node) };
}


/**
 * Decide whether a child is positioned absolutely inside its parent.
 * In an autolayout parent (HBox/VBox) children flow unless they carry
 * `stackPositioning = ABSOLUTE`. In a non-autolayout parent (Control)
 * every child is absolute.
 *
 * `flowOverride` is consulted when the container kind was demoted
 * from BoxContainer to Control because of negative `stackSpacing`
 * (overlap). In that case the child's `transform.m02 / m12` are
 * (0, 0) — the original autolayout would have placed them — so the
 * walker pre-computes flow positions via
 * `flowPositionsForOverlapStack` and threads them in here.
 */
type Placement = { readonly mode: "flow" } | { readonly mode: "absolute"; readonly x: number; readonly y: number };

function placementFor(
  child: FigNode,
  parent: LayoutPlan,
  flowOverride: { readonly x: number; readonly y: number } | undefined,
): Placement {
  if (parent.container === "Control") {
    if (flowOverride !== undefined) {
      return { mode: "absolute", x: flowOverride.x, y: flowOverride.y };
    }
    const x = child.transform?.m02 ?? 0;
    const y = child.transform?.m12 ?? 0;
    return { mode: "absolute", x, y };
  }
  if (child.stackPositioning?.name === "ABSOLUTE") {
    const x = child.transform?.m02 ?? 0;
    const y = child.transform?.m12 ?? 0;
    return { mode: "absolute", x, y };
  }
  return { mode: "flow" };
}

/** Append the size-flag and absolute-position properties dictated by placement. */
function applyPlacement(
  target: GodotNode,
  placement: Placement,
  child: FigNode,
  parentPlan: LayoutPlan,
): GodotNode {
  if (placement.mode === "absolute") {
    return appendAbsolutePosition(target, placement.x, placement.y, child);
  }
  return appendFlowSizeFlags(target, child, parentPlan);
}

/**
 * Compute flow-mode positions for children of an autolayout stack
 * that was demoted to a plain Control because of negative spacing
 * (overlap). Returns `undefined` when the stack is genuinely
 * non-autolayout — children retain their authored
 * `transform.m02 / m12` coordinates in that case.
 */
function pickFlowPositions(
  node_: FigNode,
  plan: LayoutPlan,
  renderedKids: readonly FigNode[],
): readonly { readonly x: number; readonly y: number }[] | undefined {
  if (plan.container !== "Control") {
    return undefined;
  }
  const mode = node_.stackMode?.name;
  if (mode === "GRID" || isWrappedHorizontalStack(node_)) {
    // GRID-mode autolayout flows children row-major into a grid.
    // HORIZONTAL stacks with `stackWrap = WRAP` follow the same
    // row-major flow once the available width is exhausted (Figma
    // calls this "Wrap"). Godot has no first-class container for
    // either, so we emit a plain Control and pre-compute each
    // child's (x, y) here. The walker threads these positions
    // through `placementFor` so each child lands at its target cell.
    return flowPositionsForGrid(node_, renderedKids);
  }
  if (mode !== "HORIZONTAL" && mode !== "VERTICAL") {
    return undefined;
  }
  return flowPositionsForOverlapStack(node_, renderedKids);
}

/**
 * Detect a HORIZONTAL stack that has `stackWrap = WRAP` set. The
 * frame still has `stackMode = HORIZONTAL` but its row-major flow
 * matches the GRID layout's logic (`stackSpacing` is the column
 * gap, `stackCounterSpacing` is the row gap).
 */
function isWrappedHorizontalStack(node_: FigNode): boolean {
  if (node_.stackMode?.name !== "HORIZONTAL") {
    return false;
  }
  return readWrapFlag(node_.stackWrap);
}

/**
 * Type-guard reader for `stackWrap`. The model declares the field as
 * `boolean` but the parser actually emits the Kiwi-enum struct
 * (`{ value, name: "WRAP" | "NO_WRAP" }`). This helper handles
 * both shapes.
 */
function readWrapFlag(raw: unknown): boolean {
  if (raw === undefined || raw === null) {
    return false;
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "object" && "name" in raw) {
    const name = (raw as { name: unknown }).name;
    return typeof name === "string" && name === "WRAP";
  }
  return false;
}

/**
 * Godot's `layout_mode` property tells the editor (and runtime
 * deserializer) how a Control's position is managed:
 *
 *   - `0` POSITION  — `offset_*` + `anchor_*` are authored manually.
 *   - `1` ANCHORS   — anchor preset, the editor manages offsets.
 *   - `2` CONTAINER — parent Container drives layout; offsets are
 *                     ignored at runtime.
 *
 * Default in Godot 4 is implicit (the editor writes it on save).
 * Without an explicit value, Godot's runtime may auto-detect based
 * on the parent's type — which has produced inconsistent results
 * across the autolayout-overlap fixtures (auto-z-reverse: Panels
 * with explicit offsets inside a Control still render at equal
 * thirds because Godot inferred Container layout). Setting
 * `layout_mode` explicitly closes that ambiguity.
 */
const LAYOUT_MODE_POSITION = 0;
const LAYOUT_MODE_CONTAINER = 2;

function appendAbsolutePosition(
  target: GodotNode,
  x: number,
  y: number,
  child: FigNode,
): GodotNode {
  // Anchors stay at zero (top-left); offsets carry the absolute position.
  // Godot 4.x stores rect via `offset_left/top/right/bottom`. We compute
  // offsets from the authored size so a child rendered at (12, 16) with
  // size 80x40 becomes offset_left=12, offset_top=16, offset_right=92,
  // offset_bottom=56.
  //
  // The container helpers (`plainControlProperties`,
  // `boxContainerProperties`) already populated offset_right/offset_bottom
  // from the child's authored size assuming origin (0,0). Here we
  // *replace* those with the absolutely-positioned values rather than
  // appending — Godot's `.tscn` parser uses the last value for a
  // duplicated key, but the duplicate also confuses readers and is what
  // diff-clean roundtrip catches as a regression.
  //
  // LINE primitives carry `size.y === 0` (1D segment along x). Figma
  // centres the stroke on the y=0 axis — half above, half below. The
  // emitted Panel's height is `strokeWeight`, so we shift the offset
  // up by `strokeWeight/2` here so the visual centreline lands on the
  // authored `y`.
  const isLine = child.type.name === LINE_TYPE;
  const lineWidth = isLine ? readUniformLineWeight(child.strokeWeight) : 0;
  const yTop = isLine ? y - lineWidth / 2 : y;
  const positioned = new Map<string, GodotProperty>();
  // Pin the child to position-managed layout so the parent (a plain
  // Control) doesn't auto-defer to Container behaviour. Without the
  // explicit value, fixtures like `auto-z-reverse` (where the parent
  // Control hosts overlapping siblings via offsets) render at equal
  // thirds — Godot infers Container layout from the sibling pattern.
  positioned.set("layout_mode", property("layout_mode", intVal(LAYOUT_MODE_POSITION)));
  // `custom_minimum_size` is meant for Container-managed children to
  // tell the Container "I want at least N pixels". Position-managed
  // children get their size from offset_left/right/top/bottom; the
  // minimum-size hint is unused. Stripping it avoids feeding Godot
  // contradictory size signals.
  const stripMinimumSize = (props: readonly GodotProperty[]): GodotProperty[] =>
    props.filter((p) => p.name !== "custom_minimum_size");
  if (x !== 0) {
    positioned.set("offset_left", property("offset_left", floatVal(x)));
  }
  if (yTop !== 0) {
    positioned.set("offset_top", property("offset_top", floatVal(yTop)));
  }
  if (isLine) {
    positioned.set("offset_right", property("offset_right", floatVal(x + (child.size?.x ?? 0))));
    positioned.set("offset_bottom", property("offset_bottom", floatVal(yTop + lineWidth)));
  } else if (child.size) {
    positioned.set("offset_right", property("offset_right", floatVal(x + child.size.x)));
    positioned.set("offset_bottom", property("offset_bottom", floatVal(y + child.size.y)));
  }
  // Figma's transform 2x2 carries rotation around the local origin
  // (top-left). Godot's `Control.rotation` rotates around
  // `pivot_offset` (default (0,0) — also top-left), so the angle
  // transfers directly. We extract it from atan2(m10, m00) and emit
  // only when non-zero so identity-transform children don't accrue
  // a `rotation = 0.0` line.
  const rotation = extractRotationRadians(child);
  if (rotation !== 0) {
    positioned.set("rotation", property("rotation", floatVal(rotation)));
  }
  const cleaned = stripMinimumSize(target.properties);
  const replaced = cleaned.map((p) => positioned.get(p.name) ?? p);
  const remaining = Array.from(positioned.values()).filter(
    (p) => !cleaned.some((t) => t.name === p.name),
  );
  return { ...target, properties: [...replaced, ...remaining] };
}

/**
 * Extract a rotation angle from a FigNode's transform 2x2 part. Figma
 * stores transforms as a 2x3 affine matrix `[m00 m01 m02; m10 m11 m12]`.
 * For a pure rotation by θ:
 *
 *   [ cos θ  -sin θ ]
 *   [ sin θ   cos θ ]
 *
 * so `atan2(m10, m00)` recovers θ in radians. Returns 0 for the
 * identity transform (and for nodes without a transform). Doesn't
 * detect non-uniform scale — Figma writes those into m00/m01/m10/m11
 * too, but the `rect-rotated` family is pure rotation; non-uniform
 * scale cases would need a separate emit path (Godot Control has
 * `scale` but it doesn't compose cleanly with size-driven layout).
 */
function extractRotationRadians(node: FigNode): number {
  const t = node.transform;
  if (!t) {
    return 0;
  }
  const m00 = t.m00 ?? 1;
  const m10 = t.m10 ?? 0;
  if (m10 === 0 && m00 >= 0) {
    return 0;
  }
  return Math.atan2(m10, m00);
}

function appendFlowSizeFlags(
  target: GodotNode,
  child: FigNode,
  parentPlan: LayoutPlan,
): GodotNode {
  const flags = counterSizeFlagsForChild(parentPlan.counter, child);
  // Godot Control defaults `size_flags_<axis>` to 1 (SIZE_FILL), which
  // stretches every child to the container's cross-axis dimension.
  // Figma's MIN counter alignment means "leave the child at its
  // authored size and pin to the leading edge", which Godot models as
  // size_flags = 0 (no fill, no expand). We must always emit the
  // cross-axis flag — even when the resolved value is 0 — to override
  // Godot's default-FILL.
  // The cross-axis name depends on the BoxContainer orientation:
  //   HBoxContainer → cross axis is vertical → size_flags_vertical
  //   VBoxContainer → cross axis is horizontal → size_flags_horizontal
  const crossAxis =
    parentPlan.container === "HBoxContainer" ? "size_flags_vertical" : "size_flags_horizontal";
  const primaryAxis =
    parentPlan.container === "HBoxContainer" ? "size_flags_horizontal" : "size_flags_vertical";
  // Figma's `stackChildPrimaryGrow = 1` marks a child as filling the
  // remaining primary-axis space — the autolayout "Fill container" or
  // "Grow" affordance. Godot expresses this via
  // `size_flags_<primary> = SIZE_EXPAND_FILL` on the child. Emit only
  // when grow is authored (non-zero); the default 0 leaves Godot at
  // its own default which the cross-axis logic above already handles
  // for the cross axis.
  const grow = typeof child.stackChildPrimaryGrow === "number" ? child.stackChildPrimaryGrow : 0;
  // Children of a BoxContainer use Godot's CONTAINER layout mode so
  // the parent's autolayout drives placement (size_flags + the
  // container's `alignment` / `separation`). Manual offsets on these
  // children are ignored at runtime; emitting them anyway is fine
  // (the saved scene matches what Godot would re-save) but the
  // explicit `layout_mode = 2` makes the intent unambiguous and
  // avoids the runtime-inference cliff that hit the position-mode
  // siblings.
  const props: GodotProperty[] = [
    property("layout_mode", intVal(LAYOUT_MODE_CONTAINER)),
    ...target.properties,
    property(crossAxis, intVal(flags)),
  ];
  if (grow > 0) {
    props.push(property(primaryAxis, intVal(SIZE_FLAGS.EXPAND_FILL)));
  }
  return { ...target, properties: props };
}

/**
 * Render a TEXT node. Only the `textData.characters` / `characters`
 * channel is consulted; per-run styling is not yet in scope and would
 * require switching to RichTextLabel + BBCode, which the SwiftUI peer
 * also surfaces as a TODO.
 */
function emitTextNode(node_: FigNode, ctx: WalkContext): GodotNode {
  const name = uniqueNodeName(ctx, node_.name ?? "Label");
  const characters = readTextCharacters(node_);
  const props: GodotProperty[] = [
    property("text", stringVal(characters)),
    ...labelStyleOverrides(node_),
  ];
  const modulate = modulateAlphaProperty(node_);
  if (modulate) {
    props.push(modulate);
  }
  return node(name, "Label", { properties: props });
}

function readTextCharacters(node_: FigNode): string {
  if (typeof node_.textData?.characters === "string") {
    return node_.textData.characters;
  }
  if (typeof node_.characters === "string") {
    return node_.characters;
  }
  return "";
}

/**
 * Render a RECTANGLE / ROUNDED_RECTANGLE / ELLIPSE leaf. Godot has no
 * first-class Ellipse Control; the v0 emitter renders ellipses as a
 * Panel with corner radius = min(width, height) / 2 and surfaces a
 * Fail-Fast error for non-circular ellipses (different x/y radii).
 *
 * RECTANGLE / ELLIPSE in Figma without an explicit fill renders as
 * transparent; Godot's Panel paints whatever StyleBox is attached. A
 * shape leaf with no SOLID fill therefore has no StyleBox to attach,
 * which would render as Godot's default panel skin — almost certainly
 * not what the author wanted. Surface that as Fail-Fast, matching the
 * SwiftUI peer.
 */
function buildShapeStyleBox(
  node_: FigNode,
  typeName: string,
  styleBoxId: string,
  compensate: boolean = true,
): GodotSubResource | undefined {
  if (typeName === ELLIPSE_TYPE) {
    return buildEllipseStyleBox(node_, styleBoxId, compensate);
  }
  return buildStyleBoxFlat(node_, styleBoxId, compensate);
}


function emitShapeLeaf(node_: FigNode, ctx: WalkContext): GodotNode {
  const typeName = node_.type.name;
  const name = uniqueNodeName(ctx, node_.name ?? typeName);

  // Try GRADIENT_LINEAR before SOLID — a node with both a gradient
  // fill and a corner radius would otherwise pick the corner-only
  // StyleBoxFlat path (transparent bg) and lose the gradient.
  //
  // When the shape has a non-zero corner radius the TextureRect alone
  // would render the gradient as a sharp rectangle. Wrap it in a
  // Panel whose StyleBoxFlat carries the corner radius and set
  // `clip_children = 2 /* CLIP_ONLY */` so the Panel acts as a
  // shape mask — the rounded silhouette clips the child TextureRect
  // without the Panel itself painting. The Panel's `mouse_filter`
  // stays at the Control default (PASS) since it has no surface to
  // capture input on.
  const gradientId = nextGradientId(ctx);
  const textureId = nextGradientTextureId(ctx);
  const gradient = buildLinearGradient(node_, gradientId, textureId);
  if (gradient) {
    for (const sub of gradient.subResources) {
      ctx.subResources.push(sub);
    }
    const props: GodotProperty[] = [
      gradient.textureProperty,
      property("expand_mode", intVal(1 /* IGNORE_SIZE */)),
      property("stretch_mode", intVal(6 /* KEEP_ASPECT_COVERED */)),
      ...customMinimumSizeProperty(node_),
    ];
    return withOptionalModulate(node(name, "TextureRect", { properties: props }), node_, ctx);
    // Note: a corner-radius mask was prototyped via a wrapping Panel
    // with `clip_children = CLIP_AND_DRAW` and an opaque-white bg
    // StyleBoxFlat. Worked for opaque gradients (sharp-edge → 18%
    // → rounded-edge → 18% net) but regressed for gradients with
    // alpha < 1 (`grad-opacity` 14.7% → 28%): the white bg painted
    // by the Panel showed through the semi-transparent gradient. A
    // CLIP_ONLY mask using a Panel-with-rounded-StyleBoxFlat plus
    // an inner TextureRect with anchor_right=1 / anchor_bottom=1
    // also rendered empty in the headless gl_compatibility renderer
    // — when the parent Panel is itself absolutely-positioned via
    // offset_left/right (Figma's authored layout), the child
    // anchored TextureRect's rect resolves to (0,0,0,0). Plain
    // CSS-style "stretch to parent" doesn't carry through.
    // A correct implementation needs a shader-based rounded-rect
    // alpha mask — deferred until the CanvasGroup composite path is
    // sound.
  }
  // No gradient; release the gradient ids so the next StyleBox or
  // gradient on a sibling stays sequential.
  ctx.gradientCounter -= 2;

  const styleBoxId = nextStyleBoxId(ctx);
  const compensate = !inOpacityComposite(node_, ctx);
  const styleBox = buildShapeStyleBox(node_, typeName, styleBoxId, compensate);
  if (!styleBox) {
    // Shape with no fill at all — emit a bare Control of the right
    // size so layout still allocates the slot.
    ctx.styleBoxCounter -= 1;
    const props: GodotProperty[] = [...customMinimumSizeProperty(node_)];
    return withOptionalModulate(node(name, "Control", { properties: props }), node_, ctx);
  }
  ctx.subResources.push(styleBox);
  const props: GodotProperty[] = [
    ...panelStyleOverride(styleBoxId),
    ...customMinimumSizeProperty(node_),
  ];
  return withOptionalModulate(node(name, "Panel", { properties: props }), node_, ctx);
}

/**
 * Carry the FigNode's authored size onto a Godot Control as
 * `custom_minimum_size = Vector2(w, h)`.
 *
 * Why this matters: Godot's layout containers (HBoxContainer /
 * VBoxContainer / MarginContainer) measure their children against
 * each child's `get_minimum_size()`. A bare Panel with no theme
 * minimum reports `(0, 0)`, which collapses the container to zero
 * height/width and makes nothing render. Figma fills always have an
 * authored size, so the converter needs to pin that size onto every
 * leaf that lives inside an autolayout parent.
 *
 * Returns an empty array when the node has no `size` so callers can
 * spread unconditionally.
 */
function customMinimumSizeProperty(node_: FigNode): readonly GodotProperty[] {
  if (!node_.size) {
    return [];
  }
  return [property("custom_minimum_size", vector2(node_.size.x, node_.size.y))];
}

/**
 * Build the StyleBoxFlat for an ELLIPSE leaf. Godot has no native
 * ellipse Control, so circular ellipses are emulated by setting a
 * corner radius equal to half the smaller side. Non-circular ellipses
 * (different x/y radii) cannot be rendered this way and surface as
 * Fail-Fast.
 */
function buildEllipseStyleBox(node_: FigNode, id: string, compensate: boolean = true): GodotSubResource | undefined {
  if (!node_.size) {
    throw new Error(
      `fig-to-godot: ELLIPSE node "${node_.name ?? "unnamed"}" has no size — cannot derive corner radius`,
    );
  }
  // Godot has no first-class ellipse Control. Circular ellipses
  // (square authored size) get a corner radius = side/2 which renders
  // as a perfect circle. Non-circular ellipses fall back to the
  // smaller side's radius — visually wrong (renders an oval-ish
  // pill, not a true ellipse), but that's the closest StyleBoxFlat
  // can do without a custom shader. The pixel diff for these frames
  // will fail honestly with an inspectable artifact rather than
  // blowing up the structural roundtrip with a thrown emit. v1 work
  // can replace with a SubViewport + custom shader if needed.
  const radius = Math.round(Math.min(node_.size.x, node_.size.y) / 2);
  // Synthesize a uniform corner-radius node clone so the shared
  // builder produces the same shape as a ROUNDED_RECTANGLE.
  const synthesized: FigNode = {
    ...node_,
    cornerRadius: radius,
  } as FigNode;
  return buildStyleBoxFlat(synthesized, id, compensate);
}

/**
 * Apply primary-axis distribution. CENTER / MAX go to the
 * BoxContainer.alignment integer; SPACE_BETWEEN inserts spacer Controls
 * between every adjacent pair, with `size_flags_<primary>=EXPAND_FILL`
 * so they consume the leftover space evenly.
 */
function applyPrimaryDistribution(
  plan: LayoutPlan,
  children: readonly GodotNode[],
  ctx: WalkContext,
): readonly GodotNode[] {
  if (plan.container === "Control" || children.length === 0) {
    return children;
  }
  if (plan.primary !== "space-between") {
    return children;
  }
  if (children.length < 2) {
    return children;
  }
  const out: GodotNode[] = [];
  children.forEach((child, idx) => {
    if (idx > 0) {
      out.push(spacerControl(plan, ctx));
    }
    out.push(child);
  });
  return out;
}

function spacerControl(plan: LayoutPlan, ctx: WalkContext): GodotNode {
  const name = uniqueNodeName(ctx, "Spacer");
  const flagName =
    plan.container === "HBoxContainer" ? "size_flags_horizontal" : "size_flags_vertical";
  return node(name, "Control", {
    properties: [property(flagName, intVal(SIZE_FLAGS.EXPAND_FILL))],
  });
}

/**
 * Container properties for a BoxContainer (HBox/VBox). Includes the
 * size, alignment, and separation override.
 */
function boxContainerProperties(node_: FigNode, plan: LayoutPlan): readonly GodotProperty[] {
  const props: GodotProperty[] = [];
  if (node_.size) {
    props.push(property("offset_right", floatVal(node_.size.x)));
    props.push(property("offset_bottom", floatVal(node_.size.y)));
  }
  if (plan.container !== "Control") {
    props.push(
      property("alignment", enumVal(boxContainerAlignment(plan.primary), boxAlignmentName(plan.primary))),
    );
    // When SPACE_BETWEEN inserts spacer Controls, the BoxContainer's
    // own separation must be 0 — otherwise the authored stackSpacing
    // adds gaps on top of the spacer expansion and pushes content past
    // the frame edge. Mirrors the swiftui peer's "spacing reset to 0
    // for non-MIN primary" rule.
    const effectiveSpacing = plan.primary === "space-between" ? 0 : plan.spacing;
    props.push(...separationOverride(effectiveSpacing));
  }
  return props;
}

function boxAlignmentName(primary: LayoutPlan["primary"]): string {
  switch (primary) {
    case "min":
    case "space-between":
      return "BEGIN";
    case "center":
      return "CENTER";
    case "max":
      return "END";
  }
}

/** Pick the right property set for the container kind the plan picked. */
function containerProperties(node_: FigNode, plan: LayoutPlan): readonly GodotProperty[] {
  if (plan.container === "Control") {
    return plainControlProperties(node_);
  }
  return boxContainerProperties(node_, plan);
}

/**
 * Properties for a plain `Control` container (no autolayout). Carries
 * size offsets so absolute children land at the right positions, plus
 * `clip_contents = true` when the fig frame has clipping enabled
 * (Figma's default — `frameMaskDisabled` is false unless the author
 * turned it off; `clipsContent` is the explicit alternative). Without
 * this, an oversized child paints past the frame's rect (e.g. a
 * 100% rect inside a corner-rounded frame fills the corners).
 *
 * Both `offset_right/bottom` and `custom_minimum_size` are emitted
 * because Godot uses different sizing depending on the parent:
 *
 *   - POSITION mode (child of plain Control): the offsets give the
 *     control its rect.
 *   - CONTAINER mode (child of HBox/VBox/Margin): the offsets are
 *     ignored and the parent uses `custom_minimum_size` to allocate
 *     space for the child. Without it, a wrapped frame inside an
 *     HBoxContainer reports zero minimum size and the container
 *     skips its allocation entirely (auto-stretch-counter
 *     regressed: stretch-child wrap rendered as 0-wide because the
 *     HBoxContainer didn't reserve space for it).
 *
 * Note: Godot's `clip_contents` clips to the rect, not to corner
 * radii. Frames with non-zero corner radius still get the correct
 * rect-clip; the corner-rounded clip is a future enhancement (would
 * need a SubViewport + shader or a CanvasGroup mask).
 */
function plainControlProperties(node_: FigNode): readonly GodotProperty[] {
  // Pin the wrap Control to POSITION layout mode. Without this,
  // Godot's runtime can infer Container behaviour from the children
  // (e.g. when several Panels share offsets that look like a flow
  // layout), which collapses overlapping siblings to equal thirds —
  // the auto-z-reverse fixture's negative-spacing case stayed at
  // 19.88% diff before this hint.
  const props: GodotProperty[] = [property("layout_mode", intVal(LAYOUT_MODE_POSITION))];
  if (node_.size) {
    props.push(property("custom_minimum_size", vector2(node_.size.x, node_.size.y)));
    props.push(property("offset_right", floatVal(node_.size.x)));
    props.push(property("offset_bottom", floatVal(node_.size.y)));
  }
  if (figClipsContent(node_)) {
    props.push(property("clip_contents", boolVal(true)));
  }
  return props;
}

/**
 * Decide whether a fig FRAME / GROUP node clips its children. Figma
 * stores this two ways:
 *
 *   - `clipsContent: boolean` — set explicitly when the author toggles
 *     "Clip content" in the Figma side panel.
 *   - `frameMaskDisabled: boolean` — historical inverse field; defaults
 *     to `false` (clipping on). When `true`, clipping is off.
 *
 * The two are XOR-ish in real fig output. Treat clipping as ON when
 * either positive signal is present, and OFF only when explicitly
 * disabled.
 */
function figClipsContent(node_: FigNode): boolean {
  if (node_.clipsContent === true) {
    return true;
  }
  if (node_.frameMaskDisabled === false) {
    return true;
  }
  return false;
}

/**
 * Attach the StyleBoxFlat sub-resource (background fill / corner radius
 * / stroke / shadow) to a frame-like node by wrapping it in a Panel.
 * Returns `undefined` when the frame has no styling at all so the
 * walker can skip the wrap.
 */
function buildFramePanel(
  node_: FigNode,
  ctx: WalkContext,
): { readonly panel: GodotNode; readonly subResource: GodotSubResource } | undefined {
  const styleBoxId = nextStyleBoxId(ctx);
  const compensate = !inOpacityComposite(node_, ctx);
  const styleBox = buildStyleBoxFlat(node_, styleBoxId, compensate);
  if (!styleBox) {
    // Roll back the id increment so subsequent shapes get the next
    // sequential id — the unused id would leave a gap in `.tscn`.
    ctx.styleBoxCounter -= 1;
    return undefined;
  }
  const panelName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Bg`);
  const panel = node(panelName, "Panel", {
    properties: [
      ...panelStyleOverride(styleBoxId),
      property("anchor_right", floatVal(1)),
      property("anchor_bottom", floatVal(1)),
      property("mouse_filter", intVal(2 /* MOUSE_FILTER_IGNORE */)),
      property("show_behind_parent", boolVal(true)),
    ],
  });
  return { panel, subResource: styleBox };
}

// Rounded-corner clipping was prototyped this loop iteration via
// `clip_children = CLIP_AND_DRAW` on the bg Panel + reparenting the
// inner stack inside it. Single-level cases (clip-rounded-basic /
// pill / circle) hit 0% diff, but nested clip chains regressed
// (clip-rounded-nested, frame-deep-clip jumped 0% → 23%) because
// Godot's `clip_children` only clips the immediate children's
// drawing, not the whole subtree's composite. The rect-only
// `Control.clip_contents = true` (already in `plainControlProperties`)
// remains the conservative default. A proper rounded clip would
// need a SubViewport-based mask, deferred to a future iteration.

/**
 * Render a stack-shaped container (FRAME / GROUP / SYMBOL / INSTANCE).
 *
 * Composition order, outermost first:
 *
 *   MarginContainer? > Panel(background)? + BoxContainer|Control { children }
 *
 * The `MarginContainer` only appears when the frame has authored
 * padding. The background `Panel` only appears when the frame has any
 * styling (fill / corner / stroke / shadow).
 */
function emitContainer(rawNode: FigNode, ctx: WalkContext): GodotNode {
  // Expand INSTANCE → SYMBOL so the merged node carries the SYMBOL's
  // own paint / size / corner / stroke / shadow properties and the
  // INSTANCE-level overrides land on top. Without this an INSTANCE
  // emits as an empty Control because the literal INSTANCE node has
  // no fillPaints of its own — the visual lives on the SYMBOL it
  // points at on a separate canvas. Mirrors the swiftui peer.
  const { node: node_, children: resolvedChildren } = resolveInstanceFor(rawNode, ctx);
  const plan = planLayout(node_);
  // Sub-resource ids must be unique across the whole emitted scene.
  // Seed the child context's counters from the parent so deeper
  // levels pick up where the outer level left off — otherwise a
  // sibling subtree restarts at 1 and collides with an already-minted
  // id (clip-mixed regression: a deep inner-rect StyleBoxFlat_001
  // overwrote the outer-rect's StyleBoxFlat_001, painting the inner
  // rect with the outer's red colour). After the child walk we sync
  // the parent's counters back up so the parent's own buildFramePanel
  // call mints the next sequential id rather than colliding with the
  // children.
  const childContext = createWalkContext(ctx.emit);
  childContext.styleBoxCounter = ctx.styleBoxCounter;
  childContext.gradientCounter = ctx.gradientCounter;
  childContext.imageTextureCounter = ctx.imageTextureCounter;
  // Children inherit the "inside a rounded-clip frame" flag from
  // this node: they're inside if the ancestor was already rounded-
  // clipped, OR this node itself is a rounded-clip frame.
  childContext.insideClipFrame =
    ctx.insideClipFrame || (figClipsContent(node_) && hasAuthoredCornerRadius(node_));
  // Children of a non-GROUP node with `opacity < 1` render into a
  // passthrough CanvasGroup buffer that ultimately composites to the
  // parent's float pixel buffer. Use the `floor(c*255)`-targeted
  // compensation so Godot's byte-composite output matches the WebGL
  // reference. GROUP opacity is the "isolated layer" kind: WebGL
  // flattens children to a byte buffer first, so the legacy
  // `floor(c*255+0.5)`-targeted compensation is correct there.
  childContext.insideOpacityComposite =
    ctx.insideOpacityComposite || isPassthroughOpacityWrap(node_);
  const renderedKids = resolvedChildren.filter(isRendered);
  // When the parent's autolayout was demoted to a plain Control
  // because of negative stackSpacing, children carry no flow
  // position on `transform` (Figma writes 0,0 since the layout
  // engine would place them). Pre-compute the flow positions here
  // so `placementFor` can lay each child at the right cursor in
  // overlapping order. For non-demoted Controls the override is
  // omitted and `placementFor` reads `transform.m02 / m12` as
  // before.
  const flowPositions = pickFlowPositions(node_, plan, renderedKids);
  // Children with `stackPositioning = ABSOLUTE` inside a BoxContainer
  // can't render at their authored transform — Godot's BoxContainer
  // flows every child along the primary axis regardless of
  // `layout_mode`. Lift those children out of the inner BoxContainer
  // and emit them as siblings under the outer wrap so their absolute
  // offsets actually take effect.
  const childViews: GodotNode[] = [];
  const liftedAbsoluteChildren: GodotNode[] = [];
  for (let i = 0; i < renderedKids.length; i += 1) {
    const child = renderedKids[i]!;
    const childNode = emitNode(child, childContext);
    const flowOverride = flowPositions ? flowPositions[i] : undefined;
    const placement = placementFor(child, plan, flowOverride);
    const positioned = applyPlacement(childNode, placement, child, plan);
    if (
      plan.container !== "Control" &&
      child.stackPositioning?.name === "ABSOLUTE"
    ) {
      liftedAbsoluteChildren.push(positioned);
    } else {
      childViews.push(positioned);
    }
  }
  // Hoist child sub-resources into the parent context (single shared pool).
  for (const sub of childContext.subResources) {
    ctx.subResources.push(sub);
  }
  // Hoist child ext-resources + image companion files + their hash→id
  // cache into the parent context too. Without this an IMAGE paint
  // emitted deep in a subtree would set `texture = ExtResource("…")`
  // on the Polygon2D but the corresponding `[ext_resource]` block
  // and the companion PNG bytes would be dropped on `childContext`
  // teardown — Godot would then fail to load the scene because the
  // referenced ExtResource id doesn't exist.
  for (const ext of childContext.extResources) {
    ctx.extResources.push(ext);
  }
  for (const [path, bytes] of childContext.imageAssets) {
    ctx.imageAssets.set(path, bytes);
  }
  for (const [hash, id] of childContext.imageHashToId) {
    ctx.imageHashToId.set(hash, id);
  }
  ctx.styleBoxCounter = childContext.styleBoxCounter;
  ctx.gradientCounter = childContext.gradientCounter;
  ctx.imageTextureCounter = childContext.imageTextureCounter;
  // `stackReverseZIndex` flips the render order so the *first*
  // authored child draws on top. Godot renders sibling Controls in
  // their scene-tree order (later = on top), so we reverse the
  // emitted array. With negative `stackSpacing` (overlap) this
  // matters visually — the inner rounded corners of the rear box
  // are hidden by the front box that overlaps them. Without the
  // reversal, the *last* authored child would be on top, leaving
  // the earlier boxes' rounded corners exposed.
  const zOrdered = node_.stackReverseZIndex ? [...childViews].reverse() : childViews;
  const distributed = applyPrimaryDistribution(plan, zOrdered, ctx);

  const innerName = uniqueNodeName(ctx, node_.name ?? "Stack");
  // The `inner` BoxContainer/Control is *just* the layout primitive —
  // no modulate. Frame-level opacity needs to apply to the
  // background fill too, so we hoist `modulate` to the outermost wrap
  // (the Control / MarginContainer that adopts the bg+inner sibling
  // pair), not to the inner stack alone.
  const inner: GodotNode = node(innerName, plan.container, {
    properties: containerProperties(node_, plan),
    children: distributed,
  });

  const background = buildFramePanel(node_, ctx);
  if (background) {
    ctx.subResources.push(background.subResource);
  }
  // Rounded-corner clipping was attempted via
  // `clip_children = CLIP_AND_DRAW` on the bg Panel + reparenting
  // the inner stack inside it. Worked for single-level cases
  // (clip-rounded-basic / pill / circle → 0% diff), but broke
  // nested-clip cases (clip-rounded-nested, frame-deep-clip jumped
  // 0% → 23%) because Godot's `clip_children` only clips the
  // immediate children's drawing, not the whole subtree's
  // composite. A deeper-nested overflow child renders past its
  // intermediate ancestor's rounded silhouette. The rect-clip path
  // (`Control.clip_contents = true`) is the conservative fallback
  // that handles both cases at non-zero but uniform diff. Revisit
  // when a SubViewport-based mask becomes available — until then,
  // the rect-only clip is the lowest aggregate diff.
  const hasPadding =
    plan.padding.top !== 0 ||
    plan.padding.right !== 0 ||
    plan.padding.bottom !== 0 ||
    plan.padding.left !== 0;

  if (background && hasPadding) {
    // The bg Panel must paint the **full** frame rect (Figma's frame
    // fill spans behind the padding too), but the children must be
    // inset by the padding. A `MarginContainer` shrinks every direct
    // child including a sibling Panel — we'd lose the bg outside the
    // padded area. Wrap as `Control { Panel(bg, anchored full),
    // MarginContainer { stack } }` so the bg escapes the margin
    // shrink.
    const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Group`);
    const marginName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Margin`);
    const marginNode = node(marginName, "MarginContainer", {
      properties: marginOverridesWithSize(node_, plan.padding),
      children: [inner],
    });
    return withOptionalModulate(
      node(wrapName, "Control", {
        properties: plainControlProperties(node_),
        children: [background.panel, marginNode, ...liftedAbsoluteChildren],
      }),
      node_,
      ctx,
    );
  }
  if (hasPadding) {
    // No background but padding — still need a wrapping Control to
    // host any lifted absolute children alongside the MarginContainer.
    if (liftedAbsoluteChildren.length > 0) {
      const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Group`);
      const marginName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Margin`);
      const marginNode = node(marginName, "MarginContainer", {
        properties: marginOverridesWithSize(node_, plan.padding),
        children: [inner],
      });
      return withOptionalModulate(
        node(wrapName, "Control", {
          properties: plainControlProperties(node_),
          children: [marginNode, ...liftedAbsoluteChildren],
        }),
        node_,
        ctx,
      );
    }
    const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Margin`);
    return withOptionalModulate(
      node(wrapName, "MarginContainer", {
        properties: marginOverridesWithSize(node_, plan.padding),
        children: [inner],
      }),
      node_,
      ctx,
    );
  }
  if (background) {
    // When the frame has corner-radius + `clipsContent` enabled and
    // **no stroke** and **a single direct shape leaf** (RECTANGLE /
    // ROUNDED_RECTANGLE / ELLIPSE) child, hoist the inner stack
    // inside the bg Panel and switch `clip_children` to
    // CLIP_AND_DRAW so the rounded silhouette masks the shape leaf.
    //
    // Why so narrow? Godot's `clip_children` clips only the IMMEDIATE
    // child's painted pixels to the parent's silhouette. Multi-child
    // frames or frames with grandchildren let pixels escape the
    // mask: a nested clip frame's grandchildren would paint past the
    // outer rounded edge (clip-rounded-nested / frame-deep-clip
    // regressed 0% → 50%+ in the broader rule). Strokes also break
    // because the inner Panel's bg overpaints the rounded-stroked
    // border (frame-stroke 0.01% → 12%).
    //
    // The narrow rule still wins on common UI cases: clip-rounded-
    // basic / pill / circle, simple cards with a single overflow
    // child.
    if (!ctx.insideClipFrame && frameNeedsRoundedClip(node_)) {
      const clipPanelProps: GodotProperty[] = [
        ...background.panel.properties.filter((p) => p.name !== "show_behind_parent"),
        property("clip_children", intVal(1 /* CLIP_CHILDREN_AND_DRAW */)),
      ];
      const clipPanel = node(background.panel.name, background.panel.type, {
        properties: clipPanelProps,
        children: [inner],
      });
      const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Group`);
      return withOptionalModulate(
        node(wrapName, "Control", {
          properties: plainControlProperties(node_),
          children: [clipPanel, ...liftedAbsoluteChildren],
        }),
        node_,
        ctx,
      );
    }
    // Background panel + stack as siblings under a wrapping Control so
    // the panel can paint behind the children without reparenting them.
    const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Group`);
    return withOptionalModulate(
      node(wrapName, "Control", {
        properties: plainControlProperties(node_),
        children: [background.panel, inner, ...liftedAbsoluteChildren],
      }),
      node_,
      ctx,
    );
  }
  if (liftedAbsoluteChildren.length > 0) {
    // No background, no padding — but absolute children to host. Wrap
    // the BoxContainer inner inside a Control so the absolute children
    // can be siblings.
    const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Group`);
    return withOptionalModulate(
      node(wrapName, "Control", {
        properties: plainControlProperties(node_),
        children: [inner, ...liftedAbsoluteChildren],
      }),
      node_,
      ctx,
    );
  }
  return withOptionalModulate(inner, node_, ctx);
}

/**
 * Decide whether to wrap the inner stack inside the bg Panel with
 * `clip_children = CLIP_AND_DRAW` so the rounded silhouette acts as
 * a mask. Conservative — see `emitContainer` docstring for the
 * full rationale on why each guard is here.
 */
function frameNeedsRoundedClip(node_: FigNode): boolean {
  if (!figClipsContent(node_)) {
    return false;
  }
  if (!hasAuthoredCornerRadius(node_)) {
    return false;
  }
  if (firstVisibleSolidStroke(node_) !== undefined) {
    return false;
  }
  // Frames with shadow effects paint the shadow OUTSIDE their own
  // silhouette. CLIP_AND_DRAW masks everything to the silhouette,
  // erasing the shadow halo. The frame-drop-shadow and
  // frame-inner-shadow fixtures regressed to 77% / 97% before this
  // guard.
  if (frameHasShadowEffect(node_)) {
    return false;
  }
  // Godot's clip_children mask is depth-1 — it only clips the
  // immediate child's painted pixels. Frame structures with
  // grandchildren (a nested frame, or any sub-stack) leak the
  // rounded mask. Restrict the rule to "shape-leaf-only direct
  // children": leaves paint in place, so the depth-1 mask is
  // sufficient. Frame-with-frame structures fall back to the
  // rect-clip baseline.
  return childrenAreAllShapeLeaves(safeChildren(node_));
}

function frameHasShadowEffect(node_: FigNode): boolean {
  const effects = node_.effects;
  if (!effects || effects.length === 0) {
    return false;
  }
  for (const effect of effects) {
    if (effect.visible === false) {
      continue;
    }
    const typeName = readEffectTypeName(effect);
    if (typeName === "DROP_SHADOW" || typeName === "INNER_SHADOW") {
      return true;
    }
  }
  return false;
}

/**
 * Read an effect's type name, normalising the string-vs-`{value,name}`
 * shapes the parser can emit. Returns `undefined` when neither form
 * is recognised — callers default to "no match".
 */
function readEffectTypeName(effect: { readonly type?: unknown }): string | undefined {
  const t = effect.type;
  if (typeof t === "string") {
    return t;
  }
  if (t && typeof t === "object" && "name" in t && typeof (t as { name: unknown }).name === "string") {
    return (t as { name: string }).name;
  }
  return undefined;
}

function hasAuthoredCornerRadius(node_: FigNode): boolean {
  if (typeof node_.cornerRadius === "number" && node_.cornerRadius > 0) {
    return true;
  }
  return (
    (node_.rectangleTopLeftCornerRadius ?? 0) > 0 ||
    (node_.rectangleTopRightCornerRadius ?? 0) > 0 ||
    (node_.rectangleBottomRightCornerRadius ?? 0) > 0 ||
    (node_.rectangleBottomLeftCornerRadius ?? 0) > 0
  );
}

const SHAPE_LEAF_TYPES: ReadonlySet<string> = new Set([
  RECTANGLE_TYPE,
  ROUNDED_RECTANGLE_TYPE,
  ELLIPSE_TYPE,
]);

function childrenAreAllShapeLeaves(children: readonly FigNode[]): boolean {
  if (children.length === 0) {
    return false;
  }
  for (const child of children) {
    if (!child) {
      continue;
    }
    if (!SHAPE_LEAF_TYPES.has(child.type.name)) {
      return false;
    }
  }
  return true;
}


function withOptionalModulate(target: GodotNode, source: FigNode, _ctx?: WalkContext): GodotNode {
  if (typeof source.opacity !== "number" || source.opacity === 1) {
    return target;
  }
  // Figma composes the whole frame (bg + children) as one layer and
  // blends that composite at alpha. Godot's regular `modulate`
  // cascades to each descendant individually — overlapping children
  // get their alphas multiplied per-pixel, producing darker overlaps
  // than Figma's single-pass composite.
  //
  // The correct primitive is `CanvasGroup` with `self_modulate` set
  // to the alpha. CanvasGroup renders its descendants into an
  // off-screen buffer first, then `self_modulate` blends that
  // buffer (post-composite) onto the parent. `modulate` would still
  // cascade through CanvasGroup the wrong way; only `self_modulate`
  // applies to the post-composite surface.
  //
  // Verified empirically (`tools/godot-render/test-cg4.tscn`): a
  // yellow bg + blue + pink frame at 50% opacity composites identical
  // to Figma's WebGL reference under gl_compatibility once the
  // node-tree is `CanvasGroup { Bg, A, B }`.
  const cgNode = wrapInCanvasGroup(target, source.opacity);
  return cgNode;
}


/**
 * Wrap an existing GodotNode in a `CanvasGroup` whose
 * `self_modulate` carries the requested alpha. The `target` becomes
 * the group's sole child, so any layout, bg panels, and absolute-
 * positioned descendants composite together first and then receive
 * the alpha on the way out.
 *
 * `CanvasGroup` is a `Node2D` not a `Control` — it doesn't respect
 * `offset_left/right/top/bottom`. The `target` typically carries
 * those layout properties (placement is written by `applyPlacement`
 * before `withOptionalModulate` runs). Splitting the layout
 * properties onto an outer `Control` and the CanvasGroup-with-
 * children inside keeps the placement working while still applying
 * the post-composite alpha.
 */
function wrapInCanvasGroup(target: GodotNode, opacity: number): GodotNode {
  // Layout properties belong on the OUTER Control so the parent's
  // layout machinery (placement, anchors, MarginContainer) sees the
  // expected node shape. The INNER target keeps its own size /
  // styling and is anchored to fill the outer Control's rect — the
  // CanvasGroup in between is a Node2D that doesn't honor offsets,
  // so the inner needs explicit anchor (0..1) to inherit the outer
  // Control's full rect, otherwise it collapses to (0, 0) and the
  // composite buffer renders empty.
  const layoutPropNames = new Set([
    "layout_mode",
    "anchor_left",
    "anchor_top",
    "anchor_right",
    "anchor_bottom",
    "offset_left",
    "offset_top",
    "offset_right",
    "offset_bottom",
    "size_flags_horizontal",
    "size_flags_vertical",
    "size_flags_stretch_ratio",
    "rotation",
    "scale",
    "pivot_offset",
  ]);
  const layoutProps = target.properties.filter((p) => layoutPropNames.has(p.name));
  const interiorProps = target.properties.filter((p) => !layoutPropNames.has(p.name));
  // Pin the interior to fill the outer Control's full rect via
  // anchors. This works when the outer Control sits in an absolute-
  // positioned slot (the typical fig case): anchors are relative to
  // the parent, so (0..1) → fill exactly.
  const interiorWithFillAnchors: GodotProperty[] = [
    ...interiorProps,
    property("anchor_right", floatVal(1)),
    property("anchor_bottom", floatVal(1)),
  ];
  const interior = { ...target, properties: interiorWithFillAnchors };
  const cgName = `${target.name}_Composite`;
  const cg = node(cgName, "CanvasGroup", {
    properties: [property("self_modulate", colorVal(1, 1, 1, opacity))],
    children: [interior],
  });
  return node(target.name, "Control", {
    properties: layoutProps,
    children: [cg],
  });
}

function marginOverridesWithSize(
  node_: FigNode,
  padding: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number },
): readonly GodotProperty[] {
  const props: GodotProperty[] = [];
  if (node_.size) {
    props.push(property("offset_right", floatVal(node_.size.x)));
    props.push(property("offset_bottom", floatVal(node_.size.y)));
  }
  props.push(...marginOverrides(padding));
  return props;
}

/**
 * Node kinds whose geometry comes from `fillGeometry[].commandsBlob`
 * — the walker decodes the blob, flattens it into polylines, and
 * emits a wrapping Control with one `Polygon2D` per filled contour.
 * `BOOLEAN_OPERATION` is included because Figma writes the merged
 * (post-boolean) path into the same `fillGeometry` slot as the source
 * shapes, so the same decode pipeline produces the correct silhouette
 * without re-running the boolean op.
 */
const PATH_BLOB_NODE_TYPES: ReadonlySet<string> = new Set([
  "STAR",
  "REGULAR_POLYGON",
  "VECTOR",
  "BOOLEAN_OPERATION",
]);

/**
 * Node kinds that still emit a placeholder Control (no faithful render
 * yet). `SYMBOL` is structural — its concrete content is reached via
 * `INSTANCE` resolution, never directly.
 */
const PLACEHOLDER_NODE_TYPES: ReadonlySet<string> = new Set([
  "SYMBOL",
]);

const LINE_TYPE = "LINE";

function emitPlaceholder(node_: FigNode, ctx: WalkContext): GodotNode {
  const name = uniqueNodeName(ctx, node_.name ?? node_.type.name);
  const props: GodotProperty[] = [...customMinimumSizeProperty(node_)];
  return node(name, "Control", { properties: props });
}

/**
 * Render a path-blob node (STAR / REGULAR_POLYGON / VECTOR /
 * BOOLEAN_OPERATION) by decoding its `fillGeometry[].commandsBlob`,
 * flattening the path into polylines, and emitting one `Polygon2D`
 * child per filled contour. The wrapping Control carries the layout
 * placement (`offset_*` written by `applyPlacement` later) and the
 * authored `custom_minimum_size`; the Polygon2D vertices live in the
 * shape's *local* coordinate space, so they don't have to be
 * re-translated when the wrap moves under autolayout.
 *
 * Falls back to `emitPlaceholder` when:
 *   - the walker has no doc-level blob array (`emit.blobs` unset),
 *   - the node has no `fillGeometry` (degenerate / vector with only
 *     a stroke),
 *   - the path produced no closed contour after flattening, or
 *   - the node has no SOLID fill (gradient/image fills on vector
 *     paths fall through for now).
 */
/**
 * Run the path-bool composer only on `BOOLEAN_OPERATION` nodes;
 * everything else leaves the slot for `decodeNodeContours` to fill.
 * Pulled out as a named helper so the caller stays single-statement.
 */
function composeBooleanIfApplicable(
  node_: FigNode,
  blobs: readonly { readonly bytes: readonly number[] }[],
): readonly { readonly points: readonly { readonly x: number; readonly y: number }[] }[] | undefined {
  if (node_.type.name !== "BOOLEAN_OPERATION") {
    return undefined;
  }
  return composeBooleanContours(node_, blobs);
}

function emitPathBlobLeaf(node_: FigNode, ctx: WalkContext): GodotNode {
  const blobs = ctx.emit.blobs;
  if (!blobs) {
    return emitBooleanFallback(node_, ctx);
  }
  // BOOLEAN_OPERATION's own `fillGeometry` is usually empty — the
  // merged silhouette has to be computed from the operand children
  // through the path-bool engine. Try that first, then fall back to
  // the standard `decodeNodeContours` path for parametric / blob
  // shapes.
  const composedBoolean = composeBooleanIfApplicable(node_, blobs);
  const contours = composedBoolean ?? decodeNodeContours(node_, blobs);
  if (contours.length === 0) {
    return emitBooleanFallback(node_, ctx);
  }
  const wrapName = uniqueNodeName(ctx, node_.name ?? node_.type.name);
  // When this path-blob leaf is wrapped (here or via an ancestor) in
  // a CanvasGroup-self_modulate-alpha composite, the Polygon2D's
  // colour rounds through the group's float buffer and the +0.5
  // byte-compensation overshoots the final blended byte by 1.
  // Detect that wrap so the SOLID fill emits the raw float colour
  // (verified on `bool-opacity` — 1-byte B drift collapses to 0).
  const polygonCompensate = !inOpacityComposite(node_, ctx);
  const polygonResult = buildPolygon2DNodes(
    node_,
    contours,
    (base) => uniqueNodeName(ctx, base),
    {
      nextGradientId: () => nextGradientId(ctx),
      nextTextureId: () => nextGradientTextureId(ctx),
    },
    {
      resolveImage: (paint) => resolveImageSubResource(paint, ctx),
    },
    {
      resolveAngular: (paint, size) => resolveRasterizedGradient(paint, size, "angular", ctx),
      resolveDiamond: (paint, size) => resolveRasterizedGradient(paint, size, "diamond", ctx),
      resolveLinear: (paint, size) => resolveRasterizedGradient(paint, size, "linear", ctx),
      resolveRadial: (paint, size) => resolveRasterizedGradient(paint, size, "radial", ctx),
    },
    {
      compensate: polygonCompensate,
      // BOOLEAN_OPERATION / VECTOR / STAR / POLYGON paths route
      // LINEAR / RADIAL gradients through the pre-raster path so
      // the irregular silhouettes get a byte-perfect gradient
      // matching the WebGL ref (clean rect / ellipse cases stay on
      // the standard `tryEmitAntialiasedFillShape` path which
      // produces byte parity from a different angle).
      preRasterLinearRadial: true,
    },
  );
  if (polygonResult.nodes.length === 0) {
    return emitBooleanFallback(node_, ctx);
  }
  for (const sub of polygonResult.subResources) {
    ctx.subResources.push(sub);
  }
  const props: GodotProperty[] = [
    ...customMinimumSizeForPathNode(node_, contours),
  ];
  // If the node has a DROP_SHADOW effect, prepend a transparent
  // StyleBoxFlat-Panel that paints the shadow behind the polygon.
  // The Panel itself paints nothing (transparent bg, no border) but
  // Godot's StyleBoxFlat shadow renderer extends the rounded
  // silhouette outward by `shadow_size` and fills it with
  // `shadow_color`. The Panel is anchored to the polygon's bounding
  // box (anchors 0,0,1,1) so the shadow matches the polygon area
  // exactly.
  const polygonChildren: GodotNode[] = [...polygonResult.nodes];
  const shadowPanel = buildPathLeafShadowPanel(node_, ctx);
  if (shadowPanel) {
    polygonChildren.unshift(shadowPanel);
  }
  // Path-blob leaves (BOOLEAN_OPERATION, VECTOR, polygon, star)
  // route through `withOptionalModulate` so frame-level opacity
  // composes via CanvasGroup. Skips the cascade-through-children
  // problem that plain `modulate` causes when the polygon
  // partition has multiple regions blending against the bg.
  return withOptionalModulate(
    node(wrapName, "Control", { properties: props, children: polygonChildren }),
    node_,
    ctx,
  );
}

/**
 * Build the shadow Panel that sits behind a polygon-routed shape's
 * fills. Returns `undefined` when the node has no DROP_SHADOW or no
 * resolvable corner radius (the StyleBoxFlat shadow assumes a rounded
 * rectangle silhouette; non-rect shapes fall through and simply
 * render without a shadow until a polygon-aware shadow path lands).
 *
 * The Panel is anchored to its parent Control's full rect so the
 * shadow matches the polygon's bounding-box-aligned silhouette.
 */
function buildPathLeafShadowPanel(
  node_: FigNode,
  ctx: WalkContext,
): GodotNode | undefined {
  const styleBoxId = nextStyleBoxId(ctx);
  const styleBox = buildShadowOnlyStyleBoxFlat(node_, styleBoxId);
  if (!styleBox) {
    ctx.styleBoxCounter -= 1;
    return undefined;
  }
  ctx.subResources.push(styleBox);
  const props: GodotProperty[] = [
    ...panelStyleOverride(styleBoxId),
    property("anchor_right", floatVal(1)),
    property("anchor_bottom", floatVal(1)),
    property("mouse_filter", intVal(2 /* IGNORE */)),
    property("show_behind_parent", boolVal(true)),
  ];
  return node(uniqueNodeName(ctx, "Shadow"), "Panel", { properties: props });
}

/**
 * Derive `custom_minimum_size` for a path-blob node, falling back to
 * the contour bounding box when the node has no authored `size`.
 * BOOLEAN_OPERATION nodes typically lack `size`; without this their
 * wrapping Control collapses to (0, 0) and the Polygon2D children
 * draw at the parent's origin instead of the boolean node's intended
 * placement.
 */
function customMinimumSizeForPathNode(
  node_: FigNode,
  contours: readonly { readonly points: readonly { readonly x: number; readonly y: number }[] }[],
): readonly GodotProperty[] {
  if (node_.size && node_.size.x > 0 && node_.size.y > 0) {
    return customMinimumSizeProperty(node_);
  }
  const bounds = pathContoursBoundingBox(contours);
  if (!bounds) {
    return [];
  }
  return [property("custom_minimum_size", vector2(bounds.width, bounds.height))];
}

function pathContoursBoundingBox(
  contours: readonly { readonly points: readonly { readonly x: number; readonly y: number }[] }[],
): { readonly width: number; readonly height: number } | undefined {
  const minXs: number[] = [];
  const maxXs: number[] = [];
  const minYs: number[] = [];
  const maxYs: number[] = [];
  for (const contour of contours) {
    for (const p of contour.points) {
      minXs.push(p.x);
      maxXs.push(p.x);
      minYs.push(p.y);
      maxYs.push(p.y);
    }
  }
  if (minXs.length === 0) {
    return undefined;
  }
  const minX = Math.min(...minXs);
  const maxX = Math.max(...maxXs);
  const minY = Math.min(...minYs);
  const maxY = Math.max(...maxYs);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { width, height };
}

/**
 * Fallback for path-blob nodes that didn't yield a usable polygon —
 * for `BOOLEAN_OPERATION` we render the operand children stacked
 * (which matches `UNION` visually). Other kinds (`STAR`,
 * `REGULAR_POLYGON`, `VECTOR`) fall through to the empty placeholder
 * because their children are typically empty or auxiliary.
 *
 * UNION-only is conservative: SUBTRACT / INTERSECT / EXCLUDE need a
 * boolean-path engine to compute the merged silhouette and aren't
 * matched by the painted-children approximation. We accept that diff
 * regression rather than emit a wildly wrong silhouette.
 */
function emitBooleanFallback(node_: FigNode, ctx: WalkContext): GodotNode {
  if (node_.type.name === "BOOLEAN_OPERATION") {
    const op = node_.booleanOperation;
    const opName = typeof op === "string" ? op : op?.name;
    if (opName === "UNION" || opName === undefined) {
      return emitContainer(node_, ctx);
    }
  }
  return emitPlaceholder(node_, ctx);
}

/**
 * Render a Figma LINE node as a thin Panel.
 *
 * LINE in Figma is a 1D segment along the local x-axis (`size.y === 0`).
 * The visible thickness comes from `strokePaints` + `strokeWeight`. We
 * realise it as a `Panel` whose StyleBoxFlat carries the stroke colour
 * as `bg_color`, sized `(size.x, strokeWeight)` so the stroke's full
 * vertical extent fills the Panel.
 *
 * Position handling: the LINE's transform `(m02, m12)` is the start
 * point in parent space. Figma centres the stroke on the y=0 axis, so
 * the Panel's top-left lives at `(m02, m12 - strokeWeight/2)`. The
 * 2x2 rotation from the transform is also extracted and emitted as
 * `Control.rotation` so diagonal lines render at the right angle.
 *
 * `applyPlacement` runs after `emitNode` returns and rewrites
 * `offset_left/top/right/bottom` from the child's `transform.m02 / m12`
 * + `child.size`. To keep the half-strokeWeight y shift through that
 * pipeline we synthesise a sibling node — instead we adjust the size
 * and let the placement helper position the Panel at the LINE's
 * authored origin; the half-strokeWeight offset is folded into the
 * placement override's `y` post-hoc via the `appendAbsolutePosition`
 * code path.
 */
function emitLineLeaf(node_: FigNode, ctx: WalkContext): GodotNode {
  const stroke = firstVisibleSolidStroke(node_);
  if (!stroke) {
    // No visible SOLID stroke — emit a placeholder Control so the
    // structural roundtrip stays intact and a future iteration can
    // surface gradient strokes.
    return emitPlaceholder(node_, ctx);
  }
  const name = uniqueNodeName(ctx, node_.name ?? "Line");
  const width = node_.size?.x ?? 0;
  const lineWidth = readUniformLineWeight(node_.strokeWeight);
  const dashPattern = readDashPattern(node_);
  if (dashPattern.length >= 2 && width > 0) {
    return emitDashedLine(node_, ctx, name, width, lineWidth, dashPattern, stroke);
  }
  // The Panel paints the stroke colour across its full rect — no
  // border, no corner radius. We compose a fresh StyleBoxFlat
  // sub-resource carrying just `bg_color`.
  const styleBoxId = nextStyleBoxId(ctx);
  const styleBox = subResource(styleBoxId, "StyleBoxFlat", [
    property("bg_color", solidPaintToColor(stroke)),
  ]);
  ctx.subResources.push(styleBox);
  const props: GodotProperty[] = [
    ...panelStyleOverride(styleBoxId),
    property("custom_minimum_size", vector2(width, lineWidth)),
  ];
  const modulate = modulateAlphaProperty(node_);
  if (modulate) {
    props.push(modulate);
  }
  return node(name, "Panel", { properties: props });
}

/**
 * Read the dash pattern from a node's `dashPattern` or `strokeDashes`
 * field, normalising both common shapes. Returns an empty array when
 * no pattern is set.
 *
 * Figma stores `dashPattern: number[]` for lines and frames; the
 * convention is `[on1, off1, on2, off2, ...]` repeating. A single
 * pair `[on, off]` is the most common form.
 */
function readDashPattern(node_: FigNode): readonly number[] {
  const fromDashPattern = readNumberArrayField(node_, "dashPattern");
  if (fromDashPattern.length >= 2) {
    return fromDashPattern;
  }
  const strokeDashes = node_.strokeDashes;
  if (Array.isArray(strokeDashes) && strokeDashes.length >= 2) {
    return strokeDashes.filter((d): d is number => typeof d === "number" && d > 0);
  }
  return [];
}

/**
 * Type-guard reader for fields declared on FigNode but not surfaced
 * in the model's exported shape (kept generic so the same helper
 * works for `dashPattern`, `strokeDashes` etc. when the schema
 * lags). Returns the field's positive numeric values or an empty
 * array when the field is absent / mistyped.
 */
function readNumberArrayField(node_: FigNode, key: string): readonly number[] {
  const raw = readUntypedField(node_, key);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((d): d is number => typeof d === "number" && d > 0);
}

/**
 * Type-guard reader for arbitrary properties on FigNode that aren't
 * declared in the model's TS shape. Treats the node as a string-keyed
 * record and returns `undefined` when the key is absent. Acts as the
 * canonical guard funnel so the rest of the file doesn't reach for
 * `as unknown` casts inline.
 */
function readUntypedField(node_: FigNode, key: string): unknown {
  if (!node_ || typeof node_ !== "object") {
    return undefined;
  }
  return (node_ as { readonly [k: string]: unknown })[key];
}

/**
 * Render a Figma `LINE` with a dash pattern as a `Polygon2D`. Each
 * dash segment becomes one region in the `polygons` partition; the
 * colour is applied uniformly across all dashes.
 *
 * Layout: the Polygon2D vertices live in the LINE's local coord
 * space (same as the placement helper expects from the wrapping
 * Control). Width = full segment length; height = strokeWeight.
 *
 * Pattern walking: `[on1, off1, on2, off2, ...]` — even indices are
 * "on" segments (filled), odd indices are gaps. The pattern repeats
 * until the line's full length is consumed; the trailing dash gets
 * truncated to fit.
 */
function emitDashedLine(
  node_: FigNode,
  ctx: WalkContext,
  name: string,
  width: number,
  lineWidth: number,
  dashPattern: readonly number[],
  stroke: FigSolidPaint,
): GodotNode {
  const segments = computeDashSegments(width, dashPattern);
  if (segments.length === 0) {
    // Pattern resolves to zero-length on; fall back to a plain Control
    // so the layout slot is still allocated.
    const props: GodotProperty[] = [property("custom_minimum_size", vector2(width, lineWidth))];
    return node(name, "Control", { properties: props });
  }
  const points: { readonly x: number; readonly y: number }[] = [];
  const partition: number[][] = [];
  for (const seg of segments) {
    const baseIndex = points.length;
    points.push({ x: seg.start, y: 0 });
    points.push({ x: seg.end, y: 0 });
    points.push({ x: seg.end, y: lineWidth });
    points.push({ x: seg.start, y: lineWidth });
    partition.push([baseIndex, baseIndex + 1, baseIndex + 2, baseIndex + 3]);
  }
  const polygonValue: GodotValue = {
    kind: "raw",
    text: `PackedVector2Array(${points
      .map((p) => `${formatNumberShort(p.x)}, ${formatNumberShort(p.y)}`)
      .join(", ")})`,
  };
  const polygonsValue: GodotValue = {
    kind: "raw",
    text: `[${partition.map((r) => `PackedInt32Array(${r.join(", ")})`).join(", ")}]`,
  };
  const polygon = node(uniqueNodeName(ctx, "Fill"), "Polygon2D", {
    properties: [
      property("color", solidPaintToPolygon2DColor(stroke)),
      property("polygon", polygonValue),
      property("polygons", polygonsValue),
    ],
  });
  const wrapProps: GodotProperty[] = [property("custom_minimum_size", vector2(width, lineWidth))];
  const modulate = modulateAlphaProperty(node_);
  if (modulate) {
    wrapProps.push(modulate);
  }
  return node(name, "Control", { properties: wrapProps, children: [polygon] });
}

function computeDashSegments(
  width: number,
  pattern: readonly number[],
): readonly { readonly start: number; readonly end: number }[] {
  if (pattern.length < 2) {
    return [];
  }
  const segments: { start: number; end: number }[] = [];
  // The walker advances `cursor` along the line, alternating between
  // dash and gap. `index` tracks which pattern slot we're on (even =
  // dash, odd = gap). Reduce keeps state immutable per outer loop —
  // we run a recursive helper to satisfy the no-let rule.
  const advance = (cursor: number, index: number): void => {
    if (cursor >= width) {
      return;
    }
    const slot = pattern[index % pattern.length];
    if (slot <= 0) {
      advance(cursor, index + 1);
      return;
    }
    const isDash = index % 2 === 0;
    const end = Math.min(cursor + slot, width);
    if (isDash && end > cursor) {
      segments.push({ start: cursor, end });
    }
    advance(end, index + 1);
  };
  advance(0, 0);
  return segments;
}

function formatNumberShort(n: number): string {
  if (Number.isInteger(n)) {
    return n.toString();
  }
  return parseFloat(n.toFixed(4)).toString();
}

function firstVisibleSolidStroke(node_: FigNode): FigSolidPaint | undefined {
  const paints = node_.strokePaints;
  if (!paints) {
    return undefined;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type === "SOLID") {
      return paint;
    }
  }
  return undefined;
}

function readUniformLineWeight(weight: FigNode["strokeWeight"]): number {
  if (weight === undefined) {
    return 1;
  }
  if (typeof weight === "number") {
    return weight > 0 ? weight : 1;
  }
  return weight.top > 0 ? weight.top : 1;
}

/**
 * Decide whether a `RECTANGLE` / `ROUNDED_RECTANGLE` should route
 * through the polygon path instead of the StyleBoxFlat-backed leaf.
 *
 * Triggered by either:
 *
 *   - **Gradient fill paired with a non-zero corner radius.** A plain
 *     `TextureRect` (the StyleBoxFlat path's gradient host) paints a
 *     sharp rectangle, leaking past the rounded silhouette at the
 *     corners. Polygon2D with a synthesised rounded-rect contour and
 *     per-vertex UV samples the gradient texture exactly through the
 *     rounded shape.
 *   - **Any IMAGE fill.** StyleBoxFlat has no image paint at all, and
 *     `TextureRect` doesn't carry the per-paint stacking semantics
 *     Figma uses (a SOLID base + IMAGE overlay needs the two paints
 *     in z-order). Polygon2D handles both: one Polygon2D per visible
 *     paint, layered fig-index order.
 *
 * Plain SOLID rectangles continue through `emitShapeLeaf` — that path
 * handles the simpler case at sub-pixel parity.
 */
function rectangleNeedsPolygonPath(node_: FigNode): boolean {
  if (hasVisibleImageFill(node_)) {
    return true;
  }
  // Angular/diamond gradients have no Godot StyleBoxFlat or
  // GradientTexture2D mode — they only render via the polygon path
  // backed by a pre-rasterized texture. Route there regardless of
  // corner radius.
  if (hasVisibleAngularOrDiamondGradient(node_)) {
    return true;
  }
  if (!hasAuthoredCornerRadius(node_)) {
    return false;
  }
  return hasVisibleGradientFill(node_);
}

/** True when any visible `fillPaints` entry is an angular or diamond gradient. */
function hasVisibleAngularOrDiamondGradient(node_: FigNode): boolean {
  const paints = node_.fillPaints;
  if (!paints) {
    return false;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type === "GRADIENT_ANGULAR" || paint.type === "GRADIENT_DIAMOND") {
      return true;
    }
  }
  return false;
}

/** True when any visible `fillPaints` entry is not a SOLID paint. */
function nonSolidVisiblePaint(node_: FigNode): boolean {
  const paints = node_.fillPaints;
  if (!paints) {
    return false;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type !== "SOLID") {
      return true;
    }
  }
  return false;
}

/**
 * Count visible paints and detect whether any of them is a paint kind
 * that benefits from pre-rasterisation (gradients + images). Used by
 * the AA-fill gate to decide whether to take the pre-raster path.
 */
function countVisibleRasterizablePaints(
  paints: readonly FigPaint[],
): { readonly visible: number; readonly anyRasterizable: boolean } {
  let visible = 0;
  let anyRasterizable = false;
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    visible += 1;
    if (
      paint.type === "GRADIENT_LINEAR" ||
      paint.type === "GRADIENT_RADIAL" ||
      paint.type === "GRADIENT_ANGULAR" ||
      paint.type === "GRADIENT_DIAMOND" ||
      paint.type === "IMAGE"
    ) {
      anyRasterizable = true;
    }
  }
  return { visible, anyRasterizable };
}

/** True when any visible `fillPaints` entry is an `IMAGE` paint. */
function hasVisibleImageFill(node_: FigNode): boolean {
  const paints = node_.fillPaints;
  if (!paints) {
    return false;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type === "IMAGE") {
      return true;
    }
  }
  return false;
}

/**
 * True when the first visible `fillPaints` entry is a gradient
 * (LINEAR or RADIAL — angular / diamond gradients aren't supported
 * by the GradientTexture2D path and fall through).
 */
function hasVisibleGradientFill(node_: FigNode): boolean {
  const paints = node_.fillPaints;
  if (!paints) {
    return false;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (
      paint.type === "GRADIENT_LINEAR" ||
      paint.type === "GRADIENT_RADIAL" ||
      paint.type === "GRADIENT_ANGULAR" ||
      paint.type === "GRADIENT_DIAMOND"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * If the node carries a LAYER_BLUR / FOREGROUND_BLUR effect, render
 * its filled silhouette + Gaussian blur into an inline ImageTexture
 * sub-resource and return a Polygon2D wrap. Returns `undefined`
 * when the node has no blur effect, the radius is zero, or the
 * shape kind isn't yet supported by `rasterizeBlurredShape`.
 *
 * The texture is padded by `3 × radius` on every side so the blur
 * falloff isn't clipped — the returned Polygon2D is positioned at
 * `(offsetX, offsetY)` (negative) relative to the node's authored
 * origin so the blurred result aligns with the original shape.
 */
/**
 * Paint the node's stroke band (if any) onto a pre-rasterized
 * BlurRasterResult. The stroke is computed analytically per-shape
 * (ELLIPSE / ROUNDED_RECTANGLE) with sub-pixel coverage so the
 * stroke band has soft edges matching the WebGL reference.
 *
 * No-op when:
 *   - no visible SOLID stroke is present, or
 *   - strokeWeight is zero, or
 *   - the shape kind isn't handled by `paintStrokeBand`.
 *
 * For multi-paint strokes, only the first visible SOLID stroke is
 * applied — matches the StyleBoxFlat path's single-paint stroke
 * convention.
 */
function paintStrokeOnRaster(
  node_: FigNode,
  raster: { readonly width: number; readonly height: number; readonly rgba: Uint8Array; readonly offsetX: number; readonly offsetY: number },
): void {
  const strokePaint = firstSolidStrokePaint(node_);
  if (!strokePaint) return;
  const width = uniformStrokeWeight(node_);
  if (width <= 0) return;
  const align = readStrokeAlignName(node_);
  const opacity = typeof strokePaint.opacity === "number" ? strokePaint.opacity : 1;
  paintStrokeBand(
    raster.rgba,
    raster.width,
    raster.height,
    raster.offsetX,
    raster.offsetY,
    node_,
    width,
    align,
    {
      r: strokePaint.color.r,
      g: strokePaint.color.g,
      b: strokePaint.color.b,
      a: strokePaint.color.a * opacity,
    },
  );
}

function firstSolidStrokePaint(node_: FigNode): FigSolidPaint | undefined {
  const paints = node_.strokePaints;
  if (!paints) return undefined;
  for (const paint of paints) {
    if (paint.visible === false) continue;
    if (paint.type === "SOLID") return paint as FigSolidPaint;
  }
  return undefined;
}

function uniformStrokeWeight(node_: FigNode): number {
  const w = node_.strokeWeight;
  if (typeof w === "number") return w;
  if (w && typeof w === "object") return w.top ?? 0;
  return 0;
}

function readStrokeAlignName(node_: FigNode): "INSIDE" | "CENTER" | "OUTSIDE" {
  const a = node_.strokeAlign as { name?: string } | string | undefined;
  const name = typeof a === "string" ? a : a?.name;
  if (name === "INSIDE" || name === "OUTSIDE") return name;
  return "CENTER";
}

/**
 * Compute the extra texture padding needed to accommodate the stroke
 * band when it extends past the silhouette edge:
 *   - INSIDE alignment: 0 (stroke stays inside silhouette).
 *   - CENTER alignment: strokeWidth/2 (half the band is outside).
 *   - OUTSIDE alignment: strokeWidth (entire band is outside).
 *
 * Returns 0 when the node has no visible stroke. Add a 1-pixel margin
 * to absorb the AA sub-sample positions at the band's outer edge.
 */
function computeStrokePadding(node_: FigNode): number {
  if (firstVisibleSolidStroke(node_) === undefined) {
    return 0;
  }
  const weight = uniformStrokeWeight(node_);
  if (weight <= 0) {
    return 0;
  }
  const align = readStrokeAlignName(node_);
  if (align === "INSIDE") {
    return 0;
  }
  const outerExtent = align === "OUTSIDE" ? weight : weight / 2;
  return Math.ceil(outerExtent) + 1;
}

/**
 * Pre-rasterise a FRAME's bg + shadow effects into a Polygon2D, then
 * walk the FRAME's children normally and place them as siblings of
 * the Polygon2D inside a wrap Control. Returns `undefined` when the
 * node is NOT a FRAME, has no shadow/blur effects, has autolayout
 * (Godot's box containers don't compose cleanly with the pre-raster
 * sibling), has `clipsContent` (the pre-raster doesn't yet honour
 * clipping), has any stroke (Line2D stroke calibration differs from
 * StyleBoxFlat's), or the rasterizer rejects the silhouette.
 *
 * Scope: handles the simple "FRAME bg + shadow + non-layout children"
 * shape — the two frame-properties cases (frame-drop-shadow,
 * frame-inner-shadow) match exactly. Autolayout / clip / nested
 * cases continue through `emitContainer` (where Godot's StyleBoxFlat
 * shadow handles the bg, mismatched-AA but functional).
 */
/**
 * Read the canonical `stackMode` name from a node. Some on-disk nodes
 * carry the enum as an object with a `name` field, others as the raw
 * string — this normalises both to a string.
 */
function readStackModeName(stackMode: unknown): string | undefined {
  if (stackMode && typeof stackMode === "object") {
    return (stackMode as { readonly name?: string }).name;
  }
  if (typeof stackMode === "string") {
    return stackMode;
  }
  return undefined;
}

function tryEmitFrameWithShadow(node_: FigNode, ctx: WalkContext): GodotNode | undefined {
  if (node_.type?.name !== "FRAME") {
    return undefined;
  }
  const blur = pickLayerBlur(node_);
  const allDropShadows = pickAllDropShadows(node_);
  const allInnerShadows = pickAllInnerShadows(node_);
  const hasBlur = !!(blur && typeof blur.radius === "number" && blur.radius > 0);
  if (!hasBlur && allDropShadows.length === 0 && allInnerShadows.length === 0) {
    return undefined;
  }
  // Autolayout / stroke / opacity-wrap cases need the emitContainer
  // machinery for layout and stroke painting; skip those. `clipsContent`
  // is allowed — the wrap Control carries `clip_contents = true` so
  // children get rect-clipped to the frame bounds, matching Godot's
  // existing semantics for FRAME clipping (rect, not rounded).
  const stackName = readStackModeName(node_.stackMode);
  if (stackName === "HORIZONTAL" || stackName === "VERTICAL") {
    return undefined;
  }
  if (firstVisibleSolidStroke(node_) !== undefined) {
    return undefined;
  }
  // Build the effect list for the rasterizer (mirrors
  // `tryEmitBlurredShape`'s ordering — drop shadows below, blur on
  // the shape itself, inner shadows on top).
  const effects: ShapeEffect[] = [];
  for (const shadow of allDropShadows) {
    if (typeof shadow.radius !== "number" || shadow.radius <= 0 || !shadow.color) {
      continue;
    }
    effects.push({
      kind: "drop-shadow",
      radius: shadow.radius,
      color: shadow.color,
      offset: shadow.offset ?? { x: 0, y: 0 },
    });
  }
  if (hasBlur && blur) {
    effects.push({ kind: "layer-blur", radius: blur.radius! });
  }
  for (const innerShadow of allInnerShadows) {
    if (typeof innerShadow.radius !== "number" || innerShadow.radius <= 0 || !innerShadow.color) {
      continue;
    }
    effects.push({
      kind: "inner-shadow",
      radius: innerShadow.radius,
      color: innerShadow.color,
      offset: innerShadow.offset ?? { x: 0, y: 0 },
    });
  }
  // For FRAMEs, the silhouette fills the WebGL canvas — the shadow
  // blur needs clamp-to-edge behavior so the kernel reads past the
  // shape's edge see silhouette interior (matching WebGL's
  // `CLAMP_TO_EDGE` on a canvas-sized silhouette FBO). Without
  // this, the shadow halo at the frame's top edge sees zero padding
  // outside the silhouette and produces only partial shadow.
  const raster = rasterizeShapeWithEffects(node_, effects, buildImageResolver(ctx), {
    silhouetteFillsCanvas: true,
  });
  if (!raster) {
    return undefined;
  }
  const ids = allocateImageIds(ctx);
  ctx.subResources.push(buildImageSubResource(ids.imageId, {
    width: raster.width,
    height: raster.height,
    rgba: raster.rgba,
  }));
  ctx.subResources.push(buildImageTextureSubResource(ids.textureId, ids.imageId));
  const wrapName = uniqueNodeName(ctx, node_.name ?? "Frame");
  const polygonName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}Bg`);
  const bgPolygon = node(polygonName, "Polygon2D", {
    properties: [
      // NEAREST filter: bilinear blending across the texture-to-pad
      // boundary would mix shape-interior pixels with the transparent
      // padding zone and soften the edge. NEAREST samples the exact
      // texel under the pixel center, matching the WebGL ref's hard-
      // pixel-aligned output.
      property("texture_filter", intVal(1 /* NEAREST */)),
      property("texture", { kind: "sub-resource", id: ids.textureId }),
      property("position", vector2(raster.offsetX, raster.offsetY)),
      property("polygon", {
        kind: "raw",
        text: `PackedVector2Array(0, 0, ${raster.width}, 0, ${raster.width}, ${raster.height}, 0, ${raster.height})`,
      }),
      property("uv", {
        kind: "raw",
        text: `PackedVector2Array(0, 0, ${raster.width}, 0, ${raster.width}, ${raster.height}, 0, ${raster.height})`,
      }),
    ],
  });
  // Walk the FRAME's children using a fresh child context so layout
  // / styling stays consistent with what `emitContainer` produces for
  // children. We promote child sub-resources and assets back into the
  // parent so the scene file references them correctly.
  const childContext = createWalkContext(ctx.emit);
  childContext.styleBoxCounter = ctx.styleBoxCounter;
  childContext.gradientCounter = ctx.gradientCounter;
  childContext.imageTextureCounter = ctx.imageTextureCounter;
  childContext.insideClipFrame = ctx.insideClipFrame;
  childContext.insideOpacityComposite =
    ctx.insideOpacityComposite || isPassthroughOpacityWrap(node_);
  // Wrap is a plain Control container, so children get absolute
  // positioning from their authored transform.m02/m12.
  const parentPlan: LayoutPlan = {
    container: "Control",
    counter: "begin",
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    primary: "min",
  };
  const childNodes: GodotNode[] = [];
  const renderedKids = safeChildren(node_).filter(isRendered);
  for (const child of renderedKids) {
    const emitted = emitNode(child, childContext);
    const placement = placementFor(child, parentPlan, undefined);
    const placed = applyPlacement(emitted, placement, child, parentPlan);
    childNodes.push(placed);
  }
  for (const sub of childContext.subResources) {
    ctx.subResources.push(sub);
  }
  for (const ext of childContext.extResources) {
    ctx.extResources.push(ext);
  }
  for (const [path, bytes] of childContext.imageAssets) {
    ctx.imageAssets.set(path, bytes);
  }
  for (const [hash, id] of childContext.imageHashToId) {
    ctx.imageHashToId.set(hash, id);
  }
  ctx.styleBoxCounter = childContext.styleBoxCounter;
  ctx.gradientCounter = childContext.gradientCounter;
  ctx.imageTextureCounter = childContext.imageTextureCounter;
  const wrap = node(wrapName, "Control", {
    properties: [
      ...plainControlProperties(node_),
    ],
    children: [bgPolygon, ...childNodes],
  });
  return withOptionalModulate(wrap, node_, ctx);
}

function tryEmitBlurredShape(node_: FigNode, ctx: WalkContext): GodotNode | undefined {
  const blur = pickLayerBlur(node_);
  const allDropShadows = pickAllDropShadows(node_);
  const allInnerShadows = pickAllInnerShadows(node_);
  const hasBlur = !!(blur && typeof blur.radius === "number" && blur.radius > 0);
  const hasDropShadow = allDropShadows.length > 0;
  const hasInnerShadow = allInnerShadows.length > 0;
  if (!hasBlur && !hasDropShadow && !hasInnerShadow) {
    return undefined;
  }
  // FRAME nodes go through a separate path so their children get
  // re-emitted alongside the rasterised bg. Treating a FRAME as a
  // bare shape would lose the children's geometry entirely.
  if (node_.type?.name === "FRAME") {
    return undefined;
  }
  // Reference pickDropShadow so the import isn't dead (Godot's
  // single-shadow StyleBoxFlat path uses it).
  void pickDropShadow;
  // Stroke (if present) gets painted analytically on top of the
  // rasterized fill+effects, so we no longer need to skip stroked
  // shapes. paintStrokeBand handles ELLIPSE and ROUNDED_RECTANGLE
  // stroke alignments.
  const effects: ShapeEffect[] = [];
  for (const shadow of allDropShadows) {
    if (typeof shadow.radius !== "number" || shadow.radius <= 0 || !shadow.color) continue;
    effects.push({
      kind: "drop-shadow",
      radius: shadow.radius,
      color: shadow.color,
      offset: shadow.offset ?? { x: 0, y: 0 },
    });
  }
  if (hasBlur && blur) {
    effects.push({ kind: "layer-blur", radius: blur.radius! });
  }
  for (const innerShadow of allInnerShadows) {
    if (typeof innerShadow.radius !== "number" || innerShadow.radius <= 0 || !innerShadow.color) continue;
    effects.push({
      kind: "inner-shadow",
      radius: innerShadow.radius,
      color: innerShadow.color,
      offset: innerShadow.offset ?? { x: 0, y: 0 },
    });
  }
  // Reserve padding for the stroke band when CENTER / OUTSIDE
  // alignment extends past the silhouette edge (so `paintStrokeOnRaster`
  // below doesn't clip the outer band at the texture edge).
  const strokePad = computeStrokePadding(node_);
  const raster = rasterizeShapeWithEffects(node_, effects, buildImageResolver(ctx), { strokePadding: strokePad });
  if (!raster) {
    return undefined;
  }
  // Stroke painted analytically on top of the rasterized fill +
  // effects. This sits ABOVE the shape fill but BELOW any inner
  // shadow that's already been composited (the inner-shadow path
  // produces dark pixels inside the silhouette; the stroke
  // overpaints those at the edge band).
  paintStrokeOnRaster(node_, raster);
  const ids = allocateImageIds(ctx);
  ctx.subResources.push(buildImageSubResource(ids.imageId, {
    width: raster.width,
    height: raster.height,
    rgba: raster.rgba,
  }));
  ctx.subResources.push(buildImageTextureSubResource(ids.textureId, ids.imageId));
  const name = uniqueNodeName(ctx, node_.name ?? "Blurred");
  // Polygon2D covering the padded texture's bounds, anchored so the
  // unblurred portion (texture coords padding..padding+w0) lands on
  // the node's authored origin. The wrapping Control carries the
  // node's placement; the Polygon2D inside is at the offset.
  const wrap = node(name, "Control", {
    properties: [
      ...customMinimumSizeProperty(node_),
    ],
    children: [
      node(uniqueNodeName(ctx, "Blur"), "Polygon2D", {
        properties: [
          property("texture_filter", intVal(2 /* LINEAR */)),
          property("texture", { kind: "sub-resource", id: ids.textureId }),
          property("position", vector2(raster.offsetX, raster.offsetY)),
          property("polygon", {
            kind: "raw",
            text: `PackedVector2Array(0, 0, ${raster.width}, 0, ${raster.width}, ${raster.height}, 0, ${raster.height})`,
          }),
          property("uv", {
            kind: "raw",
            text: `PackedVector2Array(0, 0, ${raster.width}, 0, ${raster.width}, ${raster.height}, 0, ${raster.height})`,
          }),
        ],
      }),
    ],
  });
  return withOptionalModulate(wrap, node_, ctx);
}

/**
 * Pre-rasterize a curved+gradient shape WITHOUT effects, for the AA
 * gain. Polygon2D + GradientTexture2D produces a sharp polygon edge
 * (no per-pixel coverage), so the WebGL ref's 1–4 px AA band shows up
 * as a multi-byte diff along curved edges (rounded rects, pills,
 * ellipses with gradient fills). Pre-rasterising the shape with the
 * sampler's per-pixel gradient + the silhouette's sub-pixel coverage
 * produces an AA-correct RGBA texture that the Polygon2D renders
 * verbatim through bilinear filtering.
 *
 * Triggers only when:
 *   - Node has no effects (those go through `tryEmitBlurredShape`).
 *   - Node type is ELLIPSE or ROUNDED_RECTANGLE.
 *   - Has a curved edge (ELLIPSE always, ROUNDED_RECTANGLE iff
 *     corner_radius > 0).
 *   - Fill is GRADIENT_LINEAR or GRADIENT_RADIAL (SOLID has no
 *     gradient-byte issue; ANGULAR/DIAMOND already pre-rasterised by
 *     the angular/diamond gradient path).
 *   - No stroke (stroke painting on the rasterised texture works but
 *     introduces an AA mismatch with the existing Line2D stroke
 *     calibration; defer enabling until the stroke-on-raster path is
 *     proven to be a net win for the stroke cases too).
 */
function tryEmitAntialiasedFillShape(node_: FigNode, ctx: WalkContext): GodotNode | undefined {
  const typeName = node_.type?.name;
  if (typeName !== "ELLIPSE" && typeName !== "ROUNDED_RECTANGLE" && typeName !== "RECTANGLE") {
    return undefined;
  }
  // Curved edge gate: ellipse is always curved; rect/rounded-rect needs
  // a non-zero corner radius for the AA-edge win. Plain SOLID rects
  // already match WebGL byte-perfectly via StyleBoxFlat, so the no-
  // corner-radius path is reserved for paints that DON'T get byte
  // parity from the legacy path — currently GRADIENT_LINEAR /
  // GRADIENT_RADIAL on plain rectangles, which route through Godot's
  // GradientTexture2D and drift 1 byte per pixel vs WebGL's gradient
  // shader (clip-rounded-gradient regressed 11.94% before this gate
  // accepted no-radius gradient rects).
  // arc/donut ellipses (arcData truthy) need the path-blob composer
  // for the cut-out silhouette — `rasterizeShapeSilhouette` would
  // produce a full disc instead. Skip them so they continue through
  // `emitPathBlobLeaf`.
  if (typeName === "ELLIPSE" && node_.arcData) {
    return undefined;
  }
  if (typeName !== "ELLIPSE") {
    const cr = typeof node_.cornerRadius === "number" ? node_.cornerRadius : 0;
    if (cr <= 0) {
      // For no-corner-radius rectangles, only route through pre-raster
      // when the fill is a gradient or image — SOLID stays on the
      // StyleBoxFlat path which is already byte-perfect. Stroke-only
      // plain rects through pre-raster regressed `stroke-basic` 2.48%
      // → 5.00% (paintStrokeBand positions the stroke 1px off from
      // Godot's StyleBoxFlat stroke for hard-cornered rects).
      if (!nonSolidVisiblePaint(node_)) {
        return undefined;
      }
    }
  }
  // Skip when any effect is present — those go through
  // `tryEmitBlurredShape` which already handles AA via the same
  // rasterizer.
  if (pickLayerBlur(node_)) {
    return undefined;
  }
  if (pickAllDropShadows(node_).length > 0) {
    return undefined;
  }
  if (pickAllInnerShadows(node_).length > 0) {
    return undefined;
  }
  // Gradient and image fills benefit here. SOLID rounded shapes
  // already hit byte parity through StyleBoxFlat. Multi-paint stacks
  // (>1 visible) now also route through the rasterizer with byte-
  // quantize between layers to mirror WebGL's per-paint framebuffer
  // chain.
  const paints = node_.fillPaints;
  if (!paints) {
    return undefined;
  }
  const paintStats = countVisibleRasterizablePaints(paints);
  if (paintStats.visible === 0) {
    return undefined;
  }
  // Need at least one curved-edge-benefiting paint to justify
  // pre-rasterisation: a pure SOLID stack already byte-matches via
  // StyleBoxFlat and routing it through rasterization is a regression.
  if (!paintStats.anyRasterizable) {
    return undefined;
  }
  // Reserve padding for the stroke band when CENTER / OUTSIDE
  // alignment extends past the silhouette edge.
  const strokePad = computeStrokePadding(node_);
  const raster = rasterizeShapeWithEffects(node_, [], buildImageResolver(ctx), { strokePadding: strokePad });
  if (!raster) return undefined;
  // Paint stroke on top of the rasterized fill if present. The
  // `paintStrokeBand` path uses the same SDF the silhouette is built
  // from, so the stroke registers exactly with the fill's AA edge.
  paintStrokeOnRaster(node_, raster);
  const ids = allocateImageIds(ctx);
  ctx.subResources.push(buildImageSubResource(ids.imageId, {
    width: raster.width,
    height: raster.height,
    rgba: raster.rgba,
  }));
  ctx.subResources.push(buildImageTextureSubResource(ids.textureId, ids.imageId));
  const name = uniqueNodeName(ctx, node_.name ?? "AAFill");
  const wrap = node(name, "Control", {
    properties: [
      ...customMinimumSizeProperty(node_),
    ],
    children: [
      node(uniqueNodeName(ctx, "AAFill"), "Polygon2D", {
        properties: [
          property("texture_filter", intVal(2 /* LINEAR */)),
          property("texture", { kind: "sub-resource", id: ids.textureId }),
          property("position", vector2(raster.offsetX, raster.offsetY)),
          property("polygon", {
            kind: "raw",
            text: `PackedVector2Array(0, 0, ${raster.width}, 0, ${raster.width}, ${raster.height}, 0, ${raster.height})`,
          }),
          property("uv", {
            kind: "raw",
            text: `PackedVector2Array(0, 0, ${raster.width}, 0, ${raster.width}, ${raster.height}, 0, ${raster.height})`,
          }),
        ],
      }),
    ],
  });
  return withOptionalModulate(wrap, node_, ctx);
}

/** Top-level entry: render any FigNode into a GodotNode (mutating ctx). */
export function emitNode(node_: FigNode, ctx: WalkContext): GodotNode {
  const typeName = getNodeType(node_);
  // FRAME-with-shadow pre-raster intercept: pre-rasterise the
  // FRAME's bg + shadow into a Polygon2D and emit children as
  // siblings of the Polygon2D. Uses `silhouetteFillsCanvas: true`
  // so the shadow blur honors WebGL's `CLAMP_TO_EDGE` behavior at
  // the frame's edges (the silhouette IS the canvas for top-level
  // FRAMEs, so kernel reads past the buffer edge return the
  // silhouette's interior value, not zero padding).
  const frameShadowReplacement = tryEmitFrameWithShadow(node_, ctx);
  if (frameShadowReplacement) {
    return frameShadowReplacement;
  }
  // LAYER_BLUR / FOREGROUND_BLUR intercept: when the node has a
  // layer-blur effect, pre-rasterize the shape with Gaussian blur in
  // TypeScript and emit as an inline ImageTexture-backed Polygon2D.
  // Godot's `ShaderMaterial` on `CanvasGroup` was the natural fit
  // here, but headless gl_compatibility produces blank output for
  // that path (the off-screen buffer doesn't surface through
  // `TEXTURE` — see task #51). Pre-rasterization sidesteps the
  // renderer-pipeline issue entirely at the cost of having to
  // re-implement each shape's silhouette in TS (currently
  // RECTANGLE / ROUNDED_RECTANGLE / ELLIPSE; other types fall
  // through unblurred for now).
  const blurReplacement = tryEmitBlurredShape(node_, ctx);
  if (blurReplacement) {
    return blurReplacement;
  }
  // AA-fill intercept: curved + gradient shapes without effects.
  // Routes through the same rasterizer used by the blur path to gain
  // sub-pixel coverage AA on the silhouette edge (the missing AA is
  // why grad-radius-pill et al. show multi-byte diffs along the pill's
  // curved edge — Polygon2D edge rendering is sharp).
  const aaFillReplacement = tryEmitAntialiasedFillShape(node_, ctx);
  if (aaFillReplacement) {
    return aaFillReplacement;
  }
  if (typeName === TEXT_TYPE) {
    return emitTextNode(node_, ctx);
  }
  if (typeName === ELLIPSE_TYPE) {
    // Every ELLIPSE goes through the polygon path. The StyleBoxFlat
    // with `corner_radius = min(w, h) / 2` approximation only matches
    // for squares (circles); non-square sizes render as pills, and
    // arcs / donuts (`arcData`) need the cut-out silhouette. Polygon2D
    // produces the correct shape at every aspect ratio. Strokes are
    // overlaid by `emitPathBlobLeaf` on top of the polygon (TBD), so
    // we don't bail out on stroked ellipses — that would be a
    // fallback to a wrong-shape primitive.
    return emitPathBlobLeaf(node_, ctx);
  }
  if (typeName === RECTANGLE_TYPE || typeName === ROUNDED_RECTANGLE_TYPE) {
    if (rectangleNeedsPolygonPath(node_)) {
      // Rect with a gradient fill + non-zero corner radius can't be
      // rendered with `TextureRect` alone — the texture would paint
      // a sharp rectangle past the rounded silhouette. Polygon2D
      // takes the gradient as `texture` + per-vertex UV and paints
      // through the rounded contour exactly.
      return emitPathBlobLeaf(node_, ctx);
    }
    return emitShapeLeaf(node_, ctx);
  }
  if (typeName === LINE_TYPE) {
    return emitLineLeaf(node_, ctx);
  }
  if (FRAME_LIKE_TYPES.has(typeName)) {
    return emitContainer(node_, ctx);
  }
  if (PATH_BLOB_NODE_TYPES.has(typeName)) {
    return emitPathBlobLeaf(node_, ctx);
  }
  if (PLACEHOLDER_NODE_TYPES.has(typeName)) {
    return emitPlaceholder(node_, ctx);
  }
  throw new Error(
    `fig-to-godot: unsupported node type "${typeName}" (node "${node_.name ?? "unnamed"}")`,
  );
}

/**
 * Render a top-level frame as a complete root Control. The root sets
 * its own `offset_right` / `offset_bottom` to the frame size so the
 * scene opens at the right dimensions in the Godot editor.
 */
export function emitRootFrame(node_: FigNode, ctx: WalkContext): GodotNode {
  return emitNode(node_, ctx);
}
