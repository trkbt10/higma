/**
 * @file Structural signatures for nested FigNode content.
 *
 * Two flavours, used together by the duplicate-cluster detector:
 *
 *   - `structuralSignature(node, maxDepth)` — depth-bounded
 *     parenthesised type string. Catches "same shape" structures that
 *     differ only by literal content (colour values, exact text).
 *
 *   - `roleSignature(node, maxDepth)` — same shape but each node
 *     contributes a role hint instead of just its raw type. The hint
 *     is derived from explicit geometry and
 *     children: a 1-character TEXT inside a 24×24 FRAME is "icon"; a
 *     ROUNDED_RECTANGLE the size of a hit-target is "button-bg"; an
 *     ELLIPSE next to text-pair is "avatar-row". This makes it much
 *     less likely to cluster two unrelated structures that happen to
 *     share `FRAME(VECTOR(),VECTOR())`.
 *
 * Signatures are deterministic and order-sensitive. Both are stable
 * across loads as long as the resolved hierarchy shape is stable.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { asImagePaint } from "@higma-document-models/fig/color";
import { getNodeType, type FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";

const DEFAULT_DEPTH = 4;

/** Compute a depth-bounded structural signature like `FRAME(VECTOR,TEXT)`. */
export function structuralSignature(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
  maxDepth = DEFAULT_DEPTH,
): string {
  return walkStructural(node, childrenOf, 0, maxDepth);
}

function walkStructural(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
  depth: number,
  maxDepth: number,
): string {
  const t = getNodeType(node);
  if (depth >= maxDepth) {
    return t;
  }
  const kids = childrenOf(node)
    .map((c) => walkStructural(c, childrenOf, depth + 1, maxDepth))
    .join(",");
  if (!kids) {
    return t;
  }
  return `${t}(${kids})`;
}

/** A coarse role hint — used to tighten signatures so unrelated clusters don't merge. */
export type NodeRoleHint =
  | "icon"
  | "avatar"
  | "button-bg"
  | "thumbnail"
  | "text-line"
  | "text-block"
  | "row"
  | "card"
  | "container"
  | "decoration"
  | "raw";

const ICON_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION"]);

function isSquareish(node: FigNode): boolean {
  const sz = node.size;
  if (!sz) {
    return false;
  }
  if (sz.x <= 0 || sz.y <= 0) {
    return false;
  }
  const ratio = sz.x / sz.y;
  return ratio >= 0.85 && ratio <= 1.18;
}

function geometricArea(node: FigNode): number {
  const sz = node.size;
  if (!sz) {
    return 0;
  }
  return sz.x * sz.y;
}

function isCircular(node: FigNode): boolean {
  return getNodeType(node) === "ELLIPSE" && isSquareish(node);
}

function isIconCandidate(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): boolean {
  if (!isSquareish(node)) {
    return false;
  }
  const sz = node.size;
  if (!sz) {
    return false;
  }
  if (sz.x > 64) {
    return false;
  }
  const kids = childrenOf(node);
  if (kids.length === 0) {
    return false;
  }
  return kids.every((c) => ICON_TYPES.has(getNodeType(c)));
}

function isAvatarCandidate(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): boolean {
  if (getNodeType(node) === "ELLIPSE" && isSquareish(node)) {
    const sz = node.size;
    return sz !== undefined && sz.x >= 16 && sz.x <= 96;
  }
  if (getNodeType(node) !== "FRAME" || !isSquareish(node)) {
    return false;
  }
  const kids = childrenOf(node);
  const sole = kids.length === 1 ? kids[0] : undefined;
  if (!sole || getNodeType(sole) !== "ELLIPSE") {
    return false;
  }
  const sz = node.size;
  return sz !== undefined && sz.x >= 16 && sz.x <= 96;
}

function isThumbnailCandidate(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): boolean {
  const t = getNodeType(node);
  if (t !== "FRAME" && t !== "RECTANGLE" && t !== "ROUNDED_RECTANGLE") {
    return false;
  }
  const sz = node.size;
  if (!sz) {
    return false;
  }
  // Wide media surfaces (≥ 100px) — typical for a video/card thumbnail.
  if (sz.x < 100) {
    return false;
  }
  const fp = node.fillPaints ?? [];
  const hasImage = fp.some((p) => asImagePaint(p) !== undefined);
  if (hasImage) {
    return true;
  }
  return geometricArea(node) >= 16000 && childrenOf(node).length === 0;
}

function isButtonBgCandidate(node: FigNode): boolean {
  const t = getNodeType(node);
  if (t !== "ROUNDED_RECTANGLE" && t !== "RECTANGLE") {
    return false;
  }
  const sz = node.size;
  if (!sz) {
    return false;
  }
  // Roughly button-sized: 60–320 wide, 24–64 tall.
  if (sz.x < 40 || sz.x > 480) {
    return false;
  }
  if (sz.y < 20 || sz.y > 80) {
    return false;
  }
  return true;
}

function isHorizontalShape(node: FigNode): boolean {
  const sz = node.size;
  if (!sz) {
    return false;
  }
  if (sz.x <= 0 || sz.y <= 0) {
    return false;
  }
  // 4:1 or wider — the frame is materially "long horizontally".
  return sz.x / sz.y >= 4;
}

/** Coarse role hint based on geometry + child kinds. */
export function roleHintFor(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): NodeRoleHint {
  const t = getNodeType(node);
  if (t === "TEXT") {
    const chars = node.characters ?? "";
    return chars.length > 24 ? "text-block" : "text-line";
  }
  if (isIconCandidate(node, childrenOf)) {
    return "icon";
  }
  if (isAvatarCandidate(node, childrenOf)) {
    return "avatar";
  }
  if (isCircular(node)) {
    return "decoration";
  }
  if (isButtonBgCandidate(node)) {
    return "button-bg";
  }
  if (isThumbnailCandidate(node, childrenOf)) {
    return "thumbnail";
  }
  if (t !== "FRAME" && t !== "GROUP") {
    return "raw";
  }
  const kids = childrenOf(node);
  // A "row" is *any* frame whose layout is dominantly horizontal:
  // either by child count (≥ 3 children) or by aspect ratio (a
  // long thin frame with at least 2 children is typically a
  // toolbar / header / list-item row even when it only carries a
  // logo on the left and an icon cluster on the right). Without
  // the aspect-ratio rule, header-style frames misclassify as
  // "container" and the naming pipeline ends up borrowing whatever
  // text happens to live inside, which is rarely the frame's role.
  if (kids.length >= 3) {
    return "row";
  }
  if (kids.length >= 2 && isHorizontalShape(node)) {
    return "row";
  }
  if (kids.length >= 1) {
    return "container";
  }
  return "card";
}

/** Like `structuralSignature` but each entry is annotated with its `roleHintFor` tag. */
export function roleSignature(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
  maxDepth = DEFAULT_DEPTH,
): string {
  return walkRole(node, childrenOf, 0, maxDepth);
}

function walkRole(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
  depth: number,
  maxDepth: number,
): string {
  const t = getNodeType(node);
  const hint = roleHintFor(node, childrenOf);
  const head = `${t}<${hint}>`;
  if (depth >= maxDepth) {
    return head;
  }
  const kids = childrenOf(node)
    .map((c) => walkRole(c, childrenOf, depth + 1, maxDepth))
    .join(",");
  if (!kids) {
    return head;
  }
  return `${head}(${kids})`;
}
