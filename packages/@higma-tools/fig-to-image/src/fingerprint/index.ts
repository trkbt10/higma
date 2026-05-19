/**
 * @file Fingerprint a raw fig subtree so downstream tools can
 * detect whether a re-rasterisation is required.
 *
 * The fingerprint is a SHA-256 of a canonical JSON serialisation
 * of every render-affecting field on the root node + every
 * descendant + every transitively-referenced SYMBOL. The shape
 * deliberately mirrors what the WebGL renderer actually consumes
 * (geometry, paints, strokes, effects, text data, autolayout,
 * blend modes) — fields that the renderer ignores (`name`,
 * `parentIndex`, `guid`, layout grids) are excluded so a noisy
 * rename of a node doesn't invalidate every downstream PNG.
 *
 * Rendering inputs that live outside the node tree (pixel ratio,
 * viewport, background colour) are folded into the digest at the
 * caller's discretion — `fingerprintFigSubtree` takes them as
 * explicit options so a `--scale 2` flip vs. `--scale 1` flips
 * the fingerprint without forcing every node walk to carry the
 * render config.
 */
import { createHash } from "node:crypto";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import type { SymbolResolver } from "@higma-document-models/fig/symbols";

const FINGERPRINT_ALGORITHM = "sha256";
const FINGERPRINT_VERSION = "v1";

/**
 * Options influencing the fingerprint beyond the node tree
 * itself. Bumping any of these MUST flip the resulting digest so
 * cached PNGs don't get reused after a render configuration
 * change.
 */
export type FingerprintOptions = {
  /** Output pixel ratio (e.g. 1 for @1x, 2 for @2x). */
  readonly pixelRatio: number;
  /**
   * SymbolResolver is the only authority for INSTANCE expansion.
   */
  readonly symbolResolver: SymbolResolver;
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
  /**
   * Canvas background colour as RGBA in 0..1. Optional so
   * callers that only consume vector shapes (no background
   * influence) can omit it. When supplied, each component is
   * folded into the digest so a transparent → white flip
   * invalidates the cached PNG.
   */
  readonly backgroundColor?: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
};

/**
 * Compute the fingerprint digest for `root` and the configured
 * render context. Returns a lowercase hex string prefixed with
 * `fig-fp-v1:`.
 *
 * The version prefix is part of the returned string — bumping
 * the format version on a future change keeps cached PNGs from
 * being mistaken for v1-fingerprinted assets when the
 * canonicalisation rules evolve.
 */
export function fingerprintFigSubtree(
  root: FigNode,
  options: FingerprintOptions,
): string {
  const visited = new Set<string>();
  const canonical = canonicaliseNode(root, options, visited);
  const payload = {
    version: FINGERPRINT_VERSION,
    pixelRatio: options.pixelRatio,
    backgroundColor: options.backgroundColor,
    root: canonical,
  };
  const json = canonicalJsonStringify(payload);
  const hex = createHash(FINGERPRINT_ALGORITHM).update(json).digest("hex");
  return `fig-fp-${FINGERPRINT_VERSION}:${hex}`;
}

// ---------------------------------------------------------------------------
// Canonical serialiser
// ---------------------------------------------------------------------------

/**
 * Stable `JSON.stringify` that sorts object keys lexicographically
 * before emitting. JavaScript's standard `JSON.stringify` preserves
 * insertion order — but a small upstream construction change (a
 * spread reordered, an extra field assigned later) silently flips
 * the digest. Sorting keys at serialisation time guarantees the
 * digest depends only on the *content* of the canonical payload.
 *
 * Arrays preserve their order (semantic — child order matters for
 * z-stacking, paints order matters for layering). Only object keys
 * are sorted.
 */
function canonicalJsonStringify(value: unknown): string {
  if (value === undefined || value === null) {
    return "null";
  }
  if (typeof value === "number") {
    return canonicaliseNumber(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return canonicaliseArray(value);
  }
  if (typeof value === "object") {
    return canonicaliseObject(value as Record<string, unknown>);
  }
  return "null";
}

function canonicaliseNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "null";
  }
  return JSON.stringify(value);
}

function canonicaliseArray(values: readonly unknown[]): string {
  const body = values.map((entry) => canonicalJsonStringify(entry)).join(",");
  return `[${body}]`;
}

function canonicaliseObject(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj)
    .filter(([, value]) => value !== undefined)
    .sort(compareEntryKeys);
  const body = entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonStringify(v)}`)
    .join(",");
  return `{${body}}`;
}

function compareEntryKeys(a: readonly [string, unknown], b: readonly [string, unknown]): number {
  if (a[0] < b[0]) {
    return -1;
  }
  if (a[0] > b[0]) {
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// FigNode canonicalisation
// ---------------------------------------------------------------------------

/**
 * Reduce a `FigNode` to a plain object containing only the
 * fields the renderer actually consumes, in a deterministic key
 * order. The `visited` set guards against SYMBOL cycles (a
 * SYMBOL transitively referencing itself through nested
 * INSTANCEs).
 */
function canonicaliseNode(
  node: FigNode,
  options: FingerprintOptions,
  visited: Set<string>,
  resolvedChildren?: readonly FigNode[],
  expandInstance: boolean = true,
  childrenOf: (node: FigNode) => readonly FigNode[] = options.childrenOf,
): unknown {
  if (expandInstance && getNodeType(node) === "INSTANCE") {
    return canonicaliseResolvedInstance(node, options, visited);
  }
  return {
    type: getNodeType(node),
    visible: node.visible,
    opacity: node.opacity,
    transform: canonicaliseTransform(node.transform),
    size: canonicaliseSize(node.size),
    fills: canonicalisePaints(node.fillPaints),
    strokes: canonicalisePaints(node.strokePaints),
    strokeWeight: node.strokeWeight,
    strokeAlign: node.strokeAlign,
    strokeJoin: node.strokeJoin,
    strokeCap: node.strokeCap,
    strokeDashes: copyNumberArray(node.strokeDashes),
    individualStrokeWeights: canonicaliseInsets(node.individualStrokeWeights),
    cornerRadius: node.cornerRadius,
    rectangleCornerRadii: copyNumberArray(node.rectangleCornerRadii),
    cornerSmoothing: node.cornerSmoothing,
    mask: node.mask,
    arcData: canonicaliseArcData(node.arcData),
    vectorPaths: mapOrUndefined(node.vectorPaths, canonicaliseVectorPath),
    vectorData: shallowCloneOrUndefined(node.vectorData),
    fillGeometry: mapOrUndefined(node.fillGeometry, canonicaliseFillGeometry),
    strokeGeometry: mapOrUndefined(node.strokeGeometry, canonicaliseFillGeometry),
    blendMode: node.blendMode,
    effects: mapOrUndefined(node.effects, canonicaliseEffect),
    clipsContent: node.clipsContent,
    stackMode: node.stackMode,
    stackSpacing: node.stackSpacing,
    stackPadding: node.stackPadding,
    stackPrimaryAlignItems: node.stackPrimaryAlignItems,
    stackCounterAlignItems: node.stackCounterAlignItems,
    stackPrimaryAlignContent: node.stackPrimaryAlignContent,
    stackCounterAlignContent: node.stackCounterAlignContent,
    stackWrap: node.stackWrap,
    stackCounterSpacing: node.stackCounterSpacing,
    stackReverseZIndex: node.stackReverseZIndex,
    textData: extractTextData(node),
    children: mapOrUndefined(
      resolvedChildren ?? childrenOf(node),
      (child) => canonicaliseNode(child, options, visited, undefined, true, childrenOf),
    ),
  };
}

function canonicaliseResolvedInstance(
  node: FigNode,
  options: FingerprintOptions,
  visited: Set<string>,
): unknown {
  const reference = options.symbolResolver.resolveReferences(node).effectiveSymbol;
  if (reference === undefined) {
    return canonicaliseNode({ ...node, symbolData: undefined }, options, visited, [], false);
  }
  const referenceGuid = guidToString(reference.guid);
  if (visited.has(referenceGuid)) {
    return { __cycle: referenceGuid };
  }
  visited.add(referenceGuid);
  const resolved = options.symbolResolver.resolveInstance(node);
  const expansion = canonicaliseNode(
    resolved.node,
    options,
    visited,
    resolved.children,
    false,
    options.symbolResolver.childrenOfResolvedNode,
  );
  visited.delete(referenceGuid);
  return expansion;
}

type FigTransform = {
  readonly m00: number;
  readonly m01: number;
  readonly m02: number;
  readonly m10: number;
  readonly m11: number;
  readonly m12: number;
};

function canonicaliseTransform(transform: FigTransform | undefined): FigTransform | undefined {
  if (!transform) {
    return undefined;
  }
  return {
    m00: transform.m00,
    m01: transform.m01,
    m02: transform.m02,
    m10: transform.m10,
    m11: transform.m11,
    m12: transform.m12,
  };
}

type FigVector = { readonly x: number; readonly y: number };

function canonicaliseSize(size: FigVector | undefined): FigVector | undefined {
  if (!size) {
    return undefined;
  }
  return { x: size.x, y: size.y };
}

type FigInsets = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

function canonicaliseInsets(insets: FigInsets | undefined): FigInsets | undefined {
  if (!insets) {
    return undefined;
  }
  return {
    top: insets.top,
    right: insets.right,
    bottom: insets.bottom,
    left: insets.left,
  };
}

type FigArcData = {
  readonly startingAngle?: number;
  readonly endingAngle?: number;
  readonly innerRadius?: number;
};

function canonicaliseArcData(arc: FigArcData | undefined): FigArcData | undefined {
  if (!arc) {
    return undefined;
  }
  return {
    startingAngle: arc.startingAngle,
    endingAngle: arc.endingAngle,
    innerRadius: arc.innerRadius,
  };
}

function copyNumberArray(values: readonly number[] | undefined): readonly number[] | undefined {
  if (!values) {
    return undefined;
  }
  return [...values];
}

function mapOrUndefined<T, R>(
  values: readonly T[] | undefined,
  fn: (value: T) => R,
): readonly R[] | undefined {
  if (!values) {
    return undefined;
  }
  return values.map(fn);
}

function shallowCloneOrUndefined(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return { ...(value as Record<string, unknown>) };
}

function extractTextData(node: FigNode): unknown {
  return node.textData ?? {
    characters: node.characters,
    fontSize: node.fontSize,
    fontName: node.fontName,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing,
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    textAutoResize: node.textAutoResize,
    textDecoration: node.textDecoration,
    textCase: node.textCase,
  };
}

// ---------------------------------------------------------------------------
// Paints & geometry
// ---------------------------------------------------------------------------

function canonicalisePaints(
  paints: readonly unknown[] | undefined,
): readonly unknown[] | undefined {
  if (!paints) {
    return undefined;
  }
  // Paints are already plain objects — but they
  // can carry `Uint8Array` for image bytes, which JSON.stringify
  // drops. Re-emit images as their byte length + a 16-byte head
  // slice so a paint swap flips the digest without forcing us to
  // hash megabytes of image data per paint.
  return paints.map((paint) => canonicalisePaint(paint));
}

function canonicalisePaint(paint: unknown): unknown {
  if (!paint || typeof paint !== "object") {
    return paint;
  }
  const p = paint as Record<string, unknown>;
  const out: Record<string, unknown> = { ...p };
  const image = p.image;
  if (image && typeof image === "object") {
    out.image = canonicaliseImageDescriptor(image as Record<string, unknown>);
  }
  return out;
}

function canonicaliseImageDescriptor(image: Record<string, unknown>): Record<string, unknown> {
  const data = image.data;
  if (!(data instanceof Uint8Array)) {
    return image;
  }
  return {
    ...image,
    data: { byteLength: data.byteLength, head: bytesHead(data, 16) },
  };
}

function bytesHead(bytes: Uint8Array, n: number): string {
  const slice = bytes.subarray(0, Math.min(n, bytes.byteLength));
  return Buffer.from(slice).toString("hex");
}

function canonicaliseVectorPath(path: unknown): unknown {
  if (!path || typeof path !== "object") {
    return path;
  }
  return { ...(path as Record<string, unknown>) };
}

function canonicaliseFillGeometry(geom: unknown): unknown {
  if (!geom || typeof geom !== "object") {
    return geom;
  }
  // `commandsBlob` is an index into the document's blobs array.
  // The blobs themselves contain the actual path bytes — but
  // since the fingerprint can't peek into document-wide blobs
  // from here, we record the index. A blob-content change with a
  // stable index would not flip the digest; we treat that as
  // acceptable because the document loader rebuilds blobs from
  // scratch on every load (the index is stable iff the bytes
  // are).
  return { ...(geom as Record<string, unknown>) };
}

function canonicaliseEffect(effect: unknown): unknown {
  if (!effect || typeof effect !== "object") {
    return effect;
  }
  return { ...(effect as Record<string, unknown>) };
}
